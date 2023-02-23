import asyncio
from typing import Any, Dict, List, Optional

from hummingbot.connector.hybrid.serum import serum_constants as CONSTANTS, serum_utils
from hummingbot.core.data_type.order_book_message import OrderBookMessage
from hummingbot.core.data_type.order_book_tracker_data_source import OrderBookTrackerDataSource
from hummingbot.core.web_assistant.connections.data_types import WSJSONRequest
from hummingbot.core.web_assistant.web_assistants_factory import WebAssistantsFactory
from hummingbot.core.web_assistant.ws_assistant import WSAssistant


class SerumAPIOrderBookDataSource(OrderBookTrackerDataSource):
    _trading_pair_symbol_map: Dict[str, str] = {}

    def __init__(self, trading_pairs: List[str], api_factory: WebAssistantsFactory):
        super().__init__(trading_pairs)
        self._trading_pairs: List[str] = trading_pairs
        self._ws_assistant: Optional[WSAssistant] = None
        self._api_factory = api_factory

    @classmethod
    async def init_trading_pair_symbols(cls):

        symbols: List[Dict[str, Any]] = [{}]
        cls._trading_pair_symbol_map = {
            symbol_data["id"]: (f"{serum_utils.convert_trading_pair(symbol_data['base_currency'])}-"
                                f"{serum_utils.convert_trading_pair(symbol_data['quote_currency'])}")
            for symbol_data in symbols
        }

    @classmethod
    async def trading_pair_symbol_map(cls) -> Dict[str, str]:
        if not cls._trading_pair_symbol_map:
            await cls.init_trading_pair_symbols()

        return cls._trading_pair_symbol_map

    @staticmethod
    async def trading_pair_associated_to_exchange_symbol(self, symbol: str) -> str:
        symbol_map = await self.trading_pair_symbol_map()
        return symbol_map[symbol]

    @staticmethod
    async def fetch_trading_pairs(self) -> List[str]:
        symbols_map = await self.trading_pair_symbol_map()
        return list(symbols_map.values())

    @staticmethod
    async def get_order_book_data(trading_pair: str) -> Dict[str, any]:
        pass

    async def get_last_traded_prices(
        self, trading_pairs: List[str],
        domain: Optional[str] = None
    ) -> Dict[str, float]:
        pass

    async def _parse_trade_message(
        self, raw_message: Dict[str, Any],
        message_queue: asyncio.Queue
    ):
        pass

    async def _parse_order_book_diff_message(
        self,
        raw_message: Dict[str, Any],
        message_queue: asyncio.Queue
    ):
        pass

    async def _parse_order_book_snapshot_message(
        self,
        raw_message: Dict[str, Any],
        message_queue: asyncio.Queue
    ):
        pass

    async def _order_book_snapshot(
        self,
        trading_pair: str
    ) -> OrderBookMessage:
        pass

    async def _connected_websocket_assistant(self) -> WSAssistant:
        ws: WSAssistant = await self._get_ws_assistant()
        url = f"{CONSTANTS.WSS_URL}"
        await ws.connect(ws_url=url, ping_timeout=CONSTANTS.WS_HEARTBEAT_TIME_INTERVAL)

        return ws

    async def _subscribe_channels(self, ws: WSAssistant):
        """
        Subscribes to the trade events and diff orders events through the provided websocket connection.
        :param ws: the websocket assistant used to connect to the exchange
        """
        try:
            markets = []
            for trading_pair in self._trading_pairs:
                # symbol = await self._connector.exchange_symbol_associated_to_pair(trading_pair=trading_pair)
                markets.append(trading_pair)
            payload = {
                "op": "subscribe",
                "channel": "trades",
                "markets": markets
            }
            subscribe_trade_request: WSJSONRequest = WSJSONRequest(payload=payload)

            await ws.send(subscribe_trade_request)

            self.logger().info("Subscribed to public order book and trade channels...")
        except asyncio.CancelledError:
            raise
        except Exception:
            self.logger().error(
                "Unexpected error occurred subscribing to order book trading and delta streams...",
                exc_info=True
            )
            raise

    def _channel_originating_message(self, event_message: Dict[str, Any]) -> str:
        pass

    async def _get_ws_assistant(self) -> WSAssistant:
        if self._ws_assistant is None:
            self._ws_assistant = await self._api_factory.get_ws_assistant()
        return self._ws_assistant
