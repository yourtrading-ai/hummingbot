import asyncio
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from hummingbot.client.config.config_helpers import ClientConfigAdapter
from hummingbot.connector.constants import s_decimal_NaN
from hummingbot.connector.exchange_py_base import ExchangePyBase
from hummingbot.connector.gateway.common_types import Chain
from hummingbot.connector.hybrid.serum import serum_constants as constants, serum_web_utils as web_utils
from hummingbot.connector.hybrid.serum.serum_api_order_book_data_source import SerumAPIOrderBookDataSource
from hummingbot.connector.hybrid.serum.serum_api_user_stream_data_source import SerumAPIUserStreamDataSource
from hummingbot.connector.hybrid.serum.serum_in_flight_order import OrderUpdate, SerumInFlightOrder, TradeUpdate
from hummingbot.connector.hybrid.serum.serum_order_book_tracker import SerumOrderBookTracker
from hummingbot.connector.hybrid.serum.serum_utils import convert_trading_pair
from hummingbot.connector.trading_rule import TradingRule
from hummingbot.core.data_type.common import SerumOrderType, SerumTradeType
from hummingbot.core.data_type.order_book_tracker_data_source import OrderBookTrackerDataSource
from hummingbot.core.data_type.trade_fee import AddedToCostTradeFee, TokenAmount, TradeFeeBase
from hummingbot.core.data_type.user_stream_tracker_data_source import UserStreamTrackerDataSource
from hummingbot.core.gateway.gateway_http_client import GatewayHttpClient
from hummingbot.core.network_iterator import NetworkStatus
from hummingbot.core.utils.async_utils import safe_ensure_future
from hummingbot.core.web_assistant.web_assistants_factory import WebAssistantsFactory
from hummingbot.logger import HummingbotLogger


class SerumHybrid(ExchangePyBase):
    web_utils = web_utils

    _chain: str
    _network: str
    _connector: str
    _wallet_address: str
    _connector_name: str
    _token_symbols: Dict[str, Any]

    def __init__(self,
                 client_config_map: ClientConfigAdapter,
                 connector_name: str,
                 chain: str,
                 network: str,
                 wallet_address: str,
                 trading_pairs: List[str],
                 additional_spenders: List[str],  # not implemented
                 trading_required: bool = True):
        self._connector_name = connector_name
        self._chain = chain
        self._network = network
        self._trading_pairs = trading_pairs
        self._wallet_address = wallet_address
        self._trading_required = trading_required
        self._gateway = GatewayHttpClient(is_serum_connector=True).get_instance(
            client_config_map=client_config_map)
        super().__init__(client_config_map)

        self._order_book_tracker = SerumOrderBookTracker(
            trading_pairs=trading_pairs)

    @classmethod
    def logger(cls) -> HummingbotLogger:
        if cls._logger is None:
            cls._logger = logging.getLogger(HummingbotLogger.logger_name_for_class(cls))
        return cls._logger

    @property
    def name(self) -> str:
        return "serum"

    @property
    def authenticator(self):
        return True

    @property
    def rate_limits_rules(self):
        return constants.RATE_LIMITS

    @property
    def domain(self):
        return ""

    @property
    def client_order_id_max_length(self):
        return

    @property
    def client_order_id_prefix(self):
        return

    @property
    def trading_rules_request_path(self):
        return ""

    @property
    def trading_pairs_request_path(self) -> str:
        return ""

    @property
    def check_network_request_path(self):
        raise ""

    @property
    def trading_pairs(self):
        return self._trading_pairs

    @property
    def is_cancel_request_in_exchange_synchronous(self) -> bool:
        return True

    @property
    def is_trading_required(self) -> bool:
        return self._trading_required

    def supported_order_types(self):
        order_types = [SerumOrderType.LIMIT, SerumOrderType.IOC, SerumOrderType.POST_ONLY]
        return order_types

    def _is_request_exception_related_to_time_synchronizer(self, request_exception: Exception):
        error_description = str(request_exception)
        is_time_synchronizer_related = ("-1021" in error_description
                                        and "Timestamp for this request" in error_description)
        return is_time_synchronizer_related

    def get_fee(self,
                base_currency: str,
                quote_currency: str,
                order_type: SerumOrderType,
                order_side: SerumTradeType,
                amount: Decimal,
                price: Decimal = s_decimal_NaN,
                is_maker: Optional[bool] = None) -> AddedToCostTradeFee:

        return AddedToCostTradeFee()

    async def _place_cancel(self, *exchange_order_id: str, trading_pair: str, **kwargs):

        order = [
            {
                "id": kwargs["order_id"],
                "exchangeId": exchange_order_id,
                "marketName": trading_pair,
                "ownerAddress": kwargs["ownerAddress"],
            }
        ]

        request = {
            "chain": self._chain,
            "network": self._network,
            "connector": self._connector_name,
            "orders": order
        }

        response = await self._gateway.clob_delete_orders(**request)

        if response['status'] == "CANCELED":
            return True
        return False

    async def _place_order(self,
                           order_id: str,
                           trading_pair: str,
                           amount: Decimal,
                           trade_type: SerumTradeType,
                           order_type: SerumOrderType,
                           price: Decimal,
                           **kwargs) -> Tuple[str, float]:

        order = [
            {
                "id": order_id,
                "marketName": trading_pair,
                "ownerAddress": self._wallet_address,
                "side": trade_type,
                "price": price,
                "amount": amount,
                "type": order_type,
            }
        ]

        request = {
            "chain": self._chain,
            "network": self._network,
            "connector": self._connector_name,
            "orders": order
        }

        response = await self._gateway.clob_post_orders(**request)

        return response['id'], response["amount"]

    def _get_fee(self, trading_pair: str, **kwargs) -> TokenAmount:

        gas_price_token: str = Chain.SOLANA.native_currency
        gas_cost: Decimal = constants.FIVE_THOUSAND_LAMPORTS
        self.network_transaction_fee = TokenAmount(gas_price_token, gas_cost)

        return self.network_transaction_fee

    async def _update_trading_fees(self):
        raise NotImplementedError

    async def _user_stream_event_listener(self):
        raise NotImplementedError

    async def _format_trading_rules(self, exchange_info_dict: Dict[str, Any]) -> List[TradingRule]:
        raise NotImplementedError

    async def _update_balances(self):
        token_list = self._get_tokens_from_active_markets_pairs()
        result = await self._gateway.solana_get_balances(
            self._network,
            self._wallet_address,
            token_list
        )
        return result

    async def update_balances(self):
        return await self._update_balances()

    async def _all_trade_updates_for_order(self, order: SerumInFlightOrder) -> List[TradeUpdate]:
        trade_updates = []

        if order.exchange_order_id is not None:
            exchange_order_id = int(order.exchange_order_id)
            trading_pair = await self.exchange_symbol_associated_to_pair(
                trading_pair=convert_trading_pair(self._trading_pairs[0])
            )
            all_fills_response = await self._api_get(
                params={
                    "symbol": trading_pair,
                    "orderId": exchange_order_id
                },
            )

            for trade in all_fills_response:
                exchange_order_id = str(trade["orderId"])
                fee = TradeFeeBase.new_spot_fee(
                    fee_schema=self.trade_fee_schema(),
                    trade_type=order.trade_type,
                    percent_token=trade["commissionAsset"],
                    flat_fees=[TokenAmount(
                        amount=Decimal(trade["commission"]),
                        token=trade["commissionAsset"]
                    )]
                )
                trade_update = TradeUpdate(
                    trade_id=str(trade["id"]),
                    client_order_id=order.client_order_id,
                    exchange_order_id=exchange_order_id,
                    trading_pair=trading_pair,
                    fee=fee,
                    fill_base_amount=Decimal(trade["qty"]),
                    fill_quote_amount=Decimal(trade["quoteQty"]),
                    fill_price=Decimal(trade["price"]),
                    fill_timestamp=trade["time"] * 1e-3,
                )
                trade_updates.append(trade_update)

        return trade_updates

    async def _request_order_status(self, tracked_order: SerumInFlightOrder) -> OrderUpdate:
        trading_pair = await self.exchange_symbol_associated_to_pair(
            trading_pair=convert_trading_pair(self._trading_pairs[0])
        )
        updated_order_data = await self._api_get(
            params={
                "symbol": trading_pair,
                "origClientOrderId": tracked_order.client_order_id},
        )

        new_state = constants.ORDER_STATE[updated_order_data["status"]]

        order_update = OrderUpdate(
            client_order_id=tracked_order.client_order_id,
            exchange_order_id=str(updated_order_data["orderId"]),
            trading_pair=tracked_order.trading_pair,
            update_timestamp=updated_order_data["updateTime"] * 1e-3,
            new_state=new_state,
        )

        return order_update

    def _create_web_assistants_factory(self) -> WebAssistantsFactory:
        return web_utils.build_api_factory(
            throttler=self._throttler,
            time_synchronizer=self._time_synchronizer
        )

    def _create_order_book_data_source(self) -> OrderBookTrackerDataSource:
        return SerumAPIOrderBookDataSource(
            trading_pairs=self._trading_pairs,
            api_factory=self._web_assistants_factory
        )

    def _create_user_stream_data_source(self) -> UserStreamTrackerDataSource:
        return SerumAPIUserStreamDataSource(
            trading_pairs=self._trading_pairs,
            connector=self,
            api_factory=self._web_assistants_factory,
            domain=self.domain,
        )

    def _initialize_trading_pair_symbols_from_exchange_info(self, exchange_info: Dict[str, Any]):
        return None

    async def _all_token_list(self):
        token_dict = await self._gateway.get_tokens(self._chain, self._network, fail_silently=False)
        token_list: List[str] = []
        for t in token_dict:
            token_list.append(t)
        return token_list

    @staticmethod
    def _get_tokens_from_active_markets_pairs() -> List[str]:
        whitelist_markets = constants.serum_configuration["markets"]["whitelist"]
        base_tokens_from_markets: List[str] = []
        quote_tokens_from_markets: List[str] = []
        for t in whitelist_markets:
            if t:
                base_currency = t.split('/')[0]
                quote_currency = t.split('/')[1]
                base_tokens_from_markets.append(base_currency)
                quote_tokens_from_markets.append(quote_currency)
        unique_quote_tokens_from_markets = set(quote_tokens_from_markets)
        token_list = base_tokens_from_markets
        for unique in unique_quote_tokens_from_markets:
            token_list.append(unique)
        return token_list

    async def get_ticker_price(self, market: str):
        ticker_price = await self._gateway.clob_get_tickers(
            chain=self._chain,
            network=self._network,
            connector=self._connector_name,
            market_name=market
        )
        return ticker_price

    async def start_network(self):
        """
        This function is required by the NetworkIterator base class and is called automatically.
        It starts tracking order books, polling trading rules, updating statuses, and tracking user data.
        """
        self._order_book_tracker.start()
        await self._update_trading_rules()
        self._trading_rules_polling_task = safe_ensure_future(self._trading_rules_polling_loop())
        if self._trading_required:
            self._status_polling_task = safe_ensure_future(self._status_polling_loop())
            self._user_stream_tracker_task = safe_ensure_future(self._user_stream_tracker.start())
            self._user_stream_event_listener_task = safe_ensure_future(self._user_stream_event_listener())

    async def stop_network(self):
        """
        This function is required by the NetworkIterator base class and is called automatically.
        It performs the necessary shut down procedure.
        """
        self._stop_network()

    async def check_network(self) -> NetworkStatus:
        """
        This function is required by NetworkIterator base class and is called periodically to check
        the network connection. Ping the network (or call any lightweight public API).
        """
        try:
            await self._api_request(path=constants.PING_URL)
        except asyncio.CancelledError:
            raise
        except Exception:
            return NetworkStatus.NOT_CONNECTED
        return NetworkStatus.CONNECTED
