import logging
from decimal import Decimal
from typing import Dict, List, Any

from hummingbot.connector.ethereum_in_flight_order import EthereumInFlightOrder
from hummingbot.connector.gateway_base import GatewayBase
from hummingbot.core.data_type.cancellation_result import CancellationResult
from hummingbot.core.data_type.trade_fee import TokenAmount, AddedToCostTradeFee
from hummingbot.core.event.events import (
    MarketEvent,
    BuyOrderCompletedEvent,
    SellOrderCompletedEvent,
    MarketOrderFailureEvent,
    OrderFilledEvent,
    OrderType,
    TradeType
)
from hummingbot.core.gateway import gateway_http_client
from hummingbot.core.utils.async_utils import safe_gather
from hummingbot.logger import HummingbotLogger
from hummingbot.logger.struct_logger import METRICS_LOG_LEVEL

s_logger = None
s_decimal_0 = Decimal("0")
s_decimal_NaN = Decimal("nan")
logging.basicConfig(level=METRICS_LOG_LEVEL)


class EVMBase(GatewayBase):
    """
    Defines basic functions common to connectors that interact with Ethereum through Gateway.
    """

    API_CALL_TIMEOUT = 10.0
    POLL_INTERVAL = 1.0
    UPDATE_BALANCE_INTERVAL = 30.0

    @classmethod
    def logger(cls) -> HummingbotLogger:
        global s_logger
        if s_logger is None:
            s_logger = logging.getLogger(cls.__name__)
        return s_logger

    def __init__(self,
                 connector_name: str,
                 chain: str,
                 network: str,
                 wallet_address: str,
                 trading_pairs: List[str],
                 trading_required: bool = True
                 ):
        """
        :param trading_pairs: a list of trading pairs
        :param trading_required: Whether actual trading is needed.
        Useful for some functionalities or commands like the balance command
        """
        super().__init__(connector_name, chain, network, wallet_address, trading_pairs, trading_required)
        self._last_est_gas_cost_reported = 0
        self._allowances = {}
        self._nonce = None
        self._native_currency = "ETH"  # make ETH the default asset

    async def init_connector(self):
        await self.auto_approve()

    @property
    def status_dict(self) -> Dict[str, bool]:
        return {
            "account_balance": len(self._account_balances) > 0 if self._trading_required else True,
            "allowances": self.has_allowances() if self._trading_required else True
        }

    async def get_chain_info(self):
        """
        Calls the base endpoint of the connector on Gateway to know basic info about chain being used.
        """
        try:
            self._chain_info = await gateway_http_client.get_network_status(chain=self.chain, network=self.network)
            if type(self._chain_info) != list:
                self._native_currency = self._chain_info.get("nativeCurrency", "ETH")
        except Exception as e:
            self.logger().network(
                "Error fetching chain info",
                exc_info=True,
                app_warning_msg=str(e)
            )

    @property
    def approval_orders(self) -> List[EthereumInFlightOrder]:
        return [
            approval_order
            for approval_order in self._in_flight_orders.values()
            if approval_order.client_order_id.split("_")[0] == "approve"
        ]

    def is_pending_approval(self, token: str) -> bool:
        pending_approval_tokens = [tk.split("_")[2] for tk in self._in_flight_orders.keys()]
        return True if token in pending_approval_tokens else False

    async def auto_approve(self):
        """
        Automatically approves trading pair tokens for contract(s).
        It first checks if there are any already approved amount (allowance)
        """
        self._allowances = await self.get_allowances()
        for token, amount in self._allowances.items():
            if amount <= s_decimal_0 and not self.is_pending_approval(token):
                await self.approve_token(token)

    async def approve_token(self, token_symbol: str):
        """
        Approves contract as a spender for a token.
        :param token_symbol: token to approve.
        """
        order_id = f"approve_{self.connector_name}_{token_symbol}"
        await self._update_nonce()
        resp: Dict[str, Any] = await gateway_http_client.approve_token(
            self.chain,
            self.network,
            self.address,
            token_symbol,
            self.connector_name,
            self._nonce
        )
        self.start_tracking_order(order_id, None, token_symbol)

        if "hash" in resp.get("approval", {}).keys():
            hash = resp["approval"]["hash"]
            tracked_order = self._in_flight_orders.get(order_id)
            tracked_order.update_exchange_order_id(hash)
            tracked_order.nonce = resp["nonce"]
            self.logger().info(
                f"Maximum {token_symbol} approval for {self.connector_name} contract sent, hash: {hash}.")
        else:
            self.stop_tracking_order(order_id)
            self.logger().info(f"Approval for {token_symbol} on {self.connector_name} failed.")

    async def get_allowances(self) -> Dict[str, Decimal]:
        """
        Retrieves allowances for token in trading_pairs
        :return: A dictionary of token and its allowance.
        """
        ret_val = {}
        resp: Dict[str, Any] = await gateway_http_client.get_allowances(
            self.chain, self.network, self.address, list(self._tokens), self.connector_name
        )
        for token, amount in resp["approvals"].items():
            ret_val[token] = Decimal(str(amount))
        return ret_val

    def has_allowances(self) -> bool:
        """
        Checks if all tokens have allowance (an amount approved)
        """
        return len(self._allowances.values()) == len(self._tokens) and \
            all(amount > s_decimal_0 for amount in self._allowances.values())

    def start_tracking_order(self,
                             order_id: str,
                             exchange_order_id: str,
                             trading_pair: str = "",
                             trade_type: TradeType = TradeType.BUY,
                             price: Decimal = s_decimal_0,
                             amount: Decimal = s_decimal_0,
                             gas_price: Decimal = s_decimal_0):
        """
        Starts tracking an order by simply adding it into _in_flight_orders dictionary.
        """
        self._in_flight_orders[order_id] = EthereumInFlightOrder(
            client_order_id=order_id,
            exchange_order_id=exchange_order_id,
            trading_pair=trading_pair,
            order_type=OrderType.LIMIT,
            trade_type=trade_type,
            price=price,
            amount=amount,
            gas_price=gas_price,
            creation_timestamp=self.current_timestamp
        )

    async def _update_approval_order_status(self, tracked_orders: List[EthereumInFlightOrder]):
        """
        Calls REST API to get status update for each in-flight order.
        This function can also be used to update status of simple swap orders.
        """
        if len(tracked_orders) > 0:
            tasks = []
            for tracked_order in tracked_orders:
                tx_hash: str = await tracked_order.get_exchange_order_id()
                tasks.append(gateway_http_client.get_transaction_status(self.chain, self.network, tx_hash))
            update_results = await safe_gather(*tasks, return_exceptions=True)
            for tracked_order, update_result in zip(tracked_orders, update_results):
                self.logger().info(f"Polling for order status updates of {len(tasks)} orders.")
                if isinstance(update_result, Exception):
                    raise update_result
                if "txHash" not in update_result:
                    self.logger().info(f"_update_order_status txHash not in resp: {update_result}")
                    continue
                if update_result["txStatus"] == 1:
                    if update_result["txReceipt"]["status"] == 1:
                        if tracked_order in self.approval_orders:
                            self.logger().info(f"Approval transaction id {update_result['txHash']} confirmed.")
                        else:
                            gas_used = update_result["txReceipt"]["gasUsed"]
                            gas_price = tracked_order.gas_price
                            fee = Decimal(str(gas_used)) * Decimal(str(gas_price)) / Decimal(str(1e9))
                            self.trigger_event(
                                MarketEvent.OrderFilled,
                                OrderFilledEvent(
                                    self.current_timestamp,
                                    tracked_order.client_order_id,
                                    tracked_order.trading_pair,
                                    tracked_order.trade_type,
                                    tracked_order.order_type,
                                    Decimal(str(tracked_order.price)),
                                    Decimal(str(tracked_order.amount)),
                                    AddedToCostTradeFee(
                                        flat_fees=[TokenAmount(tracked_order.fee_asset, Decimal(str(fee)))]
                                    ),
                                    exchange_trade_id=tracked_order.get_exchange_order_id()
                                )
                            )
                            tracked_order.last_state = "FILLED"
                            self.logger().info(f"The {tracked_order.trade_type.name} order "
                                               f"{tracked_order.client_order_id} has completed "
                                               f"according to order status API.")
                            event_tag = MarketEvent.BuyOrderCompleted if tracked_order.trade_type is TradeType.BUY \
                                else MarketEvent.SellOrderCompleted
                            event_class = BuyOrderCompletedEvent if tracked_order.trade_type is TradeType.BUY \
                                else SellOrderCompletedEvent
                            self.trigger_event(event_tag,
                                               event_class(self.current_timestamp,
                                                           tracked_order.client_order_id,
                                                           tracked_order.base_asset,
                                                           tracked_order.quote_asset,
                                                           tracked_order.fee_asset,
                                                           tracked_order.executed_amount_base,
                                                           tracked_order.executed_amount_quote,
                                                           float(fee),
                                                           tracked_order.order_type))
                        self.stop_tracking_order(tracked_order.client_order_id)
                    else:
                        self.logger().info(
                            f"The market order {tracked_order.client_order_id} has failed according to order status API. ")
                        self.trigger_event(MarketEvent.OrderFailure,
                                           MarketOrderFailureEvent(
                                               self.current_timestamp,
                                               tracked_order.client_order_id,
                                               tracked_order.order_type
                                           ))
                        self.stop_tracking_order(tracked_order.client_order_id)

    async def _update_order_status(self, tracked_orders: List[EthereumInFlightOrder]):
        """
        Calls REST API to get status update for each in-flight amm orders.
        """
        await self._update_approval_order_status(tracked_orders)

    async def _update_nonce(self):
        """
        Call the gateway API to get the current nonce for self.address
        """
        resp_json = await gateway_http_client.get_evm_nonce(self.chain, self.network, self.address)
        self._nonce = resp_json['nonce']

    async def _update(self):
        await safe_gather(
            self._update_balances(on_interval=True),
            self._update_approval_order_status(self.approval_orders),
            self._update_order_status(self.amm_orders)
        )

    async def cancel_all(self, timeout_seconds: float) -> List[CancellationResult]:
        return []
