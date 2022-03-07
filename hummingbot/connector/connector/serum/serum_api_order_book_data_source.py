#!/usr/bin/env python

import asyncio
import aiohttp
import logging
import pandas as pd
import time

import hummingbot.connector.connector.serum.serum_constants as CONSTANTS

from typing import (
    Any,
    AsyncIterable,
    Dict,
    List,
    Optional
)
from decimal import Decimal

from hummingbot.connector.connector.serum.serum_order_book import SerumOrderBook
from hummingbot.connector.gateway_base import GatewayBase
from hummingbot.core.api_throttler.async_throttler import AsyncThrottler
from hummingbot.core.utils import async_ttl_cache
from hummingbot.core.data_type.order_book_tracker_data_source import OrderBookTrackerDataSource
from hummingbot.core.data_type.order_book_message import OrderBookMessage
from hummingbot.core.data_type.order_book import OrderBook
from hummingbot.logger import HummingbotLogger


class SerumAPIOrderBookDataSource(OrderBookTrackerDataSource):
    HEARTBEAT_TIME_INTERVAL = 30.0
    TRADE_STREAM_ID = 1
    DIFF_STREAM_ID = 2

    _saobds_logger: Optional[HummingbotLogger] = None

    @classmethod
    def logger(cls) -> HummingbotLogger:
        if cls._saobds_logger is None:
            cls._saobds_logger = logging.getLogger(__name__)
        return cls._saobds_logger

    def __init__(self, trading_pairs: List[str], throttler: Optional[AsyncThrottler] = None):
        super().__init__(trading_pairs)
        self._order_book_create_function = lambda: OrderBook()
        self._throttler = throttler or self._get_throttler_instance()

    @classmethod
    async def get_last_traded_prices(cls,
                                     trading_pairs: List[str],
                                     throttler: Optional[AsyncThrottler] = None) -> Dict[str, float]:
        throttler = throttler or cls._get_throttler_instance()
        response = await GatewayBase.get_request(CONSTANTS.TICKER_URL,
                                                 {'marketNames': trading_pairs},
                                                 throttler)
        return {ticker['marketName']: float(ticker['price']) for ticker in response['lastTradedPrices']}

    @classmethod
    async def get_last_traded_price(cls, trading_pair: str, throttler: Optional[AsyncThrottler] = None) -> float:
        return (await cls.get_last_traded_prices([trading_pair], throttler))[trading_pair]

    @staticmethod
    @async_ttl_cache(ttl=2, maxsize=1)
    async def get_all_mid_prices() -> Dict[str, Decimal]:
        throttler = SerumAPIOrderBookDataSource._get_throttler_instance()
        trading_pairs = await SerumAPIOrderBookDataSource.fetch_trading_pairs()
        response = await GatewayBase.get_request(CONSTANTS.ORDERBOOKS_URL,
                                                 {
                                                             'marketNames': trading_pairs,
                                                             'depth': 1
                                                         },
                                                 throttler)
        return {ob['marketName']: (Decimal(ob['bids'][0] if len(ob) > 0 else "0") +
                                   Decimal(ob['asks'][0] if len(ob) > 0 else "0")) / Decimal("2")
                for ob in response['orderBooks']}

    @staticmethod
    @async_ttl_cache(ttl=3600, maxsize=1)
    async def fetch_trading_pairs() -> List[str]:
        try:
            throttler = SerumAPIOrderBookDataSource._get_throttler_instance()
            response = await GatewayBase.get_request(CONSTANTS.MARKETS_URL, {}, throttler)
            return [market['name'] for market in response['markets']]

        except Exception:
            # Do nothing if the request fails -- there will be no autocomplete for binance trading pairs
            pass

        return []

    @classmethod
    def _get_throttler_instance(cls) -> AsyncThrottler:
        throttler = AsyncThrottler(CONSTANTS.RATE_LIMITS)
        return throttler

    @staticmethod
    async def get_snapshots(trading_pairs: List[str],
                            limit: int = 1000,
                            throttler: Optional[AsyncThrottler] = None) -> Dict[str, Any]:
        throttler = throttler or SerumAPIOrderBookDataSource._get_throttler_instance()
        response = await GatewayBase.get_request(CONSTANTS.ORDERBOOKS_URL,
                                                 {
                                                             'marketNames': trading_pairs,
                                                             'depth': limit
                                                         },
                                                 throttler)
        return response

    @staticmethod
    async def get_snapshot(trading_pair,
                           limit: int = 1000,
                           throttler: Optional[AsyncThrottler] = None) -> Dict[str, Any]:
        return (await SerumAPIOrderBookDataSource.get_snapshots([trading_pair], limit, throttler))['orderBooks'][0]

    async def get_new_order_book(self, trading_pair: str) -> OrderBook:
        snapshot: Dict[str, Any] = await self.get_snapshot(trading_pair, 1000, self._throttler)
        snapshot_msg: OrderBookMessage = SerumOrderBook.snapshot_message_from_exchange(
            snapshot,
            snapshot['timestamp']  # TODO: Check compatibility of python and JS timestamps
        )
        order_book = self.order_book_create_function()
        order_book.apply_snapshot(snapshot_msg.bids, snapshot_msg.asks, snapshot_msg.update_id)
        return order_book

    # TODO: Implement WebSockets with Serum-Vial
    async def _create_websocket_connection(self) -> aiohttp.ClientWebSocketResponse:
        """
        Initialize WebSocket client for APIOrderBookDataSource
        """
        try:
            return await aiohttp.ClientSession().ws_connect(url=CONSTANTS.WSS_URL,
                                                            heartbeat=self.HEARTBEAT_TIME_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger().network(f"Unexpected error occured when connecting to WebSocket server. "
                                  f"Error: {e}")
            raise

    async def _iter_messages(self, ws: aiohttp.ClientWebSocketResponse) -> AsyncIterable[Any]:
        try:
            while True:
                yield await ws.receive_json()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger().network(f"Unexpected error occured when parsing websocket payload. "
                                  f"Error: {e}")
            raise
        finally:
            await ws.close()

    async def listen_for_trades(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        ws = None
        while True:
            try:
                ws = await self._create_websocket_connection()
                payload = {
                    "method": "SUBSCRIBE",
                    "params":
                        [
                            f"{trading_pair}@trade"
                            for trading_pair in self._trading_pairs
                        ],
                    "id": self.TRADE_STREAM_ID
                }
                await ws.send_json(payload)

                async for json_msg in self._iter_messages(ws):
                    if "result" in json_msg:
                        continue
                    trade_msg: OrderBookMessage = SerumOrderBook.trade_message_from_exchange(json_msg)
                    output.put_nowait(trade_msg)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.logger().error("Unexpected error with WebSocket connection. Retrying after 30 seconds...",
                                    exc_info=True)
            finally:
                ws and await ws.close()
                await self._sleep(30.0)

    async def listen_for_order_book_diffs(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        ws = None
        while True:
            try:
                ws = await self._create_websocket_connection()
                payload = {
                    "method": "SUBSCRIBE",
                    "params":
                        [
                            f"{trading_pair}@depth"
                            for trading_pair in self._trading_pairs
                        ],
                    "id": self.DIFF_STREAM_ID
                }
                await ws.send_json(payload)

                async for json_msg in self._iter_messages(ws):
                    if "result" in json_msg:
                        continue
                    order_book_message: OrderBookMessage = SerumOrderBook.diff_message_from_exchange(
                        json_msg, time.time())
                    output.put_nowait(order_book_message)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.logger().error("Unexpected error with WebSocket connection. Retrying after 30 seconds...",
                                    exc_info=True)
            finally:
                ws and await ws.close()
                await self._sleep(30.0)

    async def listen_for_order_book_snapshots(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        while True:
            try:
                for trading_pair in self._trading_pairs:
                    try:
                        snapshot: Dict[str, Any] = await self.get_snapshot(trading_pair=trading_pair,
                                                                           throttler=self._throttler)
                        snapshot_msg: OrderBookMessage = SerumOrderBook.snapshot_message_from_exchange(
                            snapshot,
                            snapshot['timestamp']
                        )
                        output.put_nowait(snapshot_msg)
                        self.logger().debug(f"Saved order book snapshot for {trading_pair}")
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        self.logger().error(f"Unexpected error fetching order book snapshot for {trading_pair}.",
                                            exc_info=True)
                        await self._sleep(5.0)
                this_hour: pd.Timestamp = pd.Timestamp.utcnow().replace(minute=0, second=0, microsecond=0)
                next_hour: pd.Timestamp = this_hour + pd.Timedelta(hours=1)
                delta: float = next_hour.timestamp() - time.time()
                await self._sleep(delta)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.logger().error("Unexpected error.", exc_info=True)
                await self._sleep(5.0)
