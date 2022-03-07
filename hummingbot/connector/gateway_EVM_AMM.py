import logging
from decimal import Decimal
import asyncio
from typing import Dict, List, Optional, Any

from hummingbot.connector.evm_base import EVMBase
from hummingbot.logger.struct_logger import METRICS_LOG_LEVEL
from hummingbot.core.utils import async_ttl_cache
from hummingbot.core.gateway import gateway_http_client
from hummingbot.core.utils.async_utils import safe_ensure_future
from hummingbot.logger import HummingbotLogger
from hummingbot.core.utils.tracking_nonce import get_tracking_nonce
from hummingbot.core.data_type.limit_order import LimitOrder
from hummingbot.core.event.events import (
    MarketEvent,
    BuyOrderCreatedEvent,
    SellOrderCreatedEvent,
    MarketOrderFailureEvent,
    OrderType,
    TradeType,
)
from hummingbot.connector.ethereum_in_flight_order import EthereumInFlightOrder
from hummingbot.core.utils.ethereum import check_transaction_exceptions

s_logger = None
s_decimal_0 = Decimal("0")
s_decimal_NaN = Decimal("nan")
logging.basicConfig(level=METRICS_LOG_LEVEL)


class GatewayEVMAMM(EVMBase):
    """
    Defines basic funtions common to connectors that interract with Gateway.
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
                 trading_pairs: List[str] = [],
                 trading_required: bool = True
                 ):
        """
        :param connector_name: name of connector on gateway
        :param chain: refers to a block chain, e.g. ethereum or avalanche
        :param network: refers to a network of a particular blockchain e.g. mainnet or kovan
        :param wallet_address: the address of the eth wallet which has been added on gateway
        :param trading_pairs: a list of trading pairs
        :param trading_required: Whether actual trading is needed. Useful for some functionalities or commands like the balance command
        """
        super().__init__(connector_name, chain, network, wallet_address, trading_pairs, trading_required)

    @property
    def amm_orders(self) -> List[EthereumInFlightOrder]:
        return [
            in_flight_order
            for in_flight_order in self._in_flight_orders.values() if in_flight_order not in self.approval_orders
        ]

    @property
    def limit_orders(self) -> List[LimitOrder]:
        return [
            in_flight_order.to_limit_order()
            for in_flight_order in self.amm_orders
        ]

    @async_ttl_cache(ttl=5, maxsize=10)
    async def get_quote_price(self, trading_pair: str, is_buy: bool, amount: Decimal) -> Optional[Decimal]:
        """
        Retrieves a quote price.
        :param trading_pair: The market trading pair
        :param is_buy: True for an intention to buy, False for an intention to sell
        :param amount: The amount required (in base token unit)
        :return: The quote price.
        """

        try:
            base, quote = trading_pair.split("-")
            side: TradeType = TradeType.BUY if is_buy else TradeType.SELL
            resp: Dict[str, Any] = await gateway_http_client.get_price(
                self.chain, self.network, self.connector_name, base, quote, amount, side
            )
            required_items = ["price", "gasLimit", "gasPrice", "gasCost"]
            if any(item not in resp.keys() for item in required_items):
                if "info" in resp.keys():
                    self.logger().info(f"Unable to get price. {resp['info']}")
                else:
                    self.logger().info(f"Missing data from price result. Incomplete return result for ({resp.keys()})")
            else:
                gas_limit = resp["gasLimit"]
                gas_price = resp["gasPrice"]
                gas_cost = resp["gasCost"]
                price = resp["price"]
                account_standing = {
                    "allowances": self._allowances,
                    "balances": self._account_balances,
                    "base": base,
                    "quote": quote,
                    "amount": amount,
                    "side": side,
                    "gas_limit": gas_limit,
                    "gas_price": gas_price,
                    "gas_cost": gas_cost,
                    "price": price,
                    "swaps": len(resp["swaps"])
                }
                exceptions = check_transaction_exceptions(account_standing)
                for index in range(len(exceptions)):
                    self.logger().info(f"Warning! [{index+1}/{len(exceptions)}] {side} order - {exceptions[index]}")

                if price is not None and len(exceptions) == 0:
                    return Decimal(str(price))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger().network(
                f"Error getting quote price for {trading_pair}  {side} order for {amount} amount.",
                exc_info=True,
                app_warning_msg=str(e)
            )

    async def get_order_price(self, trading_pair: str, is_buy: bool, amount: Decimal) -> Decimal:
        """
        This is simply the quote price
        """
        return await self.get_quote_price(trading_pair, is_buy, amount)

    def get_price(self, trading_pair: str, is_buy: bool, amount: Decimal = s_decimal_NaN) -> Decimal:
        amount = Decimal(1) if amount == s_decimal_NaN else amount
        return safe_ensure_future(self.get_quote_price(trading_pair, is_buy, amount))

    def buy(self, trading_pair: str, amount: Decimal, order_type: OrderType, price: Decimal) -> str:
        """
        Buys an amount of base token for a given price (or cheaper).
        :param trading_pair: The market trading pair
        :param amount: The order amount (in base token unit)
        :param order_type: Any order type is fine, not needed for this.
        :param price: The maximum price for the order.
        :return: A newly created order id (internal).
        """
        return self.place_order(True, trading_pair, amount, price)

    def sell(self, trading_pair: str, amount: Decimal, order_type: OrderType, price: Decimal) -> str:
        """
        Sells an amount of base token for a given price (or at a higher price).
        :param trading_pair: The market trading pair
        :param amount: The order amount (in base token unit)
        :param order_type: Any order type is fine, not needed for this.
        :param price: The minimum price for the order.
        :return: A newly created order id (internal).
        """
        return self.place_order(False, trading_pair, amount, price)

    def place_order(self, is_buy: bool, trading_pair: str, amount: Decimal, price: Decimal) -> str:
        """
        Places an order.
        :param is_buy: True for buy order
        :param trading_pair: The market trading pair
        :param amount: The order amount (in base token unit)
        :param price: The minimum price for the order.
        :return: A newly created order id (internal).
        """
        side = TradeType.BUY if is_buy else TradeType.SELL
        order_id = f"{side.name.lower()}-{trading_pair}-{get_tracking_nonce()}"
        safe_ensure_future(self._create_order(side, order_id, trading_pair, amount, price))
        return order_id

    async def _create_order(self,
                            trade_type: TradeType,
                            order_id: str,
                            trading_pair: str,
                            amount: Decimal,
                            price: Decimal):
        """
        Calls buy or sell API end point to place an order, starts tracking the order and triggers relevant order events.
        :param trade_type: BUY or SELL
        :param order_id: Internal order id (also called client_order_id)
        :param trading_pair: The market to place order
        :param amount: The order amount (in base token value)
        :param price: The order price
        """

        amount = self.quantize_order_amount(trading_pair, amount)
        price = self.quantize_order_price(trading_pair, price)
        base, quote = trading_pair.split("-")
        await self._update_nonce()
        try:
            order_result: Dict[str, Any] = await gateway_http_client.amm_trade(
                self.chain,
                self.network,
                self.connector_name,
                self.address,
                base,
                quote,
                trade_type,
                amount,
                price,
                self._nonce
            )
            transaction_hash: str = order_result.get("txHash")
            nonce: int = order_result.get("nonce")
            gas_price = order_result.get("gasPrice")
            gas_limit = order_result.get("gasLimit")
            gas_cost = order_result.get("gasCost")
            self.start_tracking_order(order_id, None, trading_pair, trade_type, price, amount, gas_price)
            tracked_order = self._in_flight_orders.get(order_id)

            if tracked_order is not None:
                self.logger().info(f"Created {trade_type.name} order {order_id} txHash: {transaction_hash} "
                                   f"for {amount} {trading_pair} on {self.network}. Estimated Gas Cost: {gas_cost} "
                                   f" (gas limit: {gas_limit}, gas price: {gas_price})")
                tracked_order.update_exchange_order_id(transaction_hash)
                tracked_order.gas_price = gas_price
            if transaction_hash is not None:
                tracked_order.nonce = nonce
                tracked_order.fee_asset = self._native_currency
                tracked_order.executed_amount_base = amount
                tracked_order.executed_amount_quote = amount * price
                event_tag = MarketEvent.BuyOrderCreated if trade_type is TradeType.BUY else MarketEvent.SellOrderCreated
                event_class = BuyOrderCreatedEvent if trade_type is TradeType.BUY else SellOrderCreatedEvent
                self.trigger_event(event_tag, event_class(self.current_timestamp, OrderType.LIMIT, trading_pair, amount,
                                                          price, order_id, transaction_hash))
            else:
                self.trigger_event(MarketEvent.OrderFailure,
                                   MarketOrderFailureEvent(self.current_timestamp, order_id, OrderType.LIMIT))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.stop_tracking_order(order_id)
            self.logger().network(
                f"Error submitting {trade_type.name} swap order to {self.connector_name} on {self.network} for "
                f"{amount} {trading_pair} "
                f"{price}.",
                exc_info=True,
                app_warning_msg=str(e)
            )
            self.trigger_event(MarketEvent.OrderFailure,
                               MarketOrderFailureEvent(self.current_timestamp, order_id, OrderType.LIMIT))

    def get_taker_order_type(self):
        return OrderType.LIMIT

    def get_order_price_quantum(self, trading_pair: str, price: Decimal) -> Decimal:
        return Decimal("1e-15")

    def get_order_size_quantum(self, trading_pair: str, order_size: Decimal) -> Decimal:
        return Decimal("1e-15")
