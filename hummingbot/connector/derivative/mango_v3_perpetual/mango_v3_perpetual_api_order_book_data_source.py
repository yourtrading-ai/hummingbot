import asyncio
import time
from typing import List, Dict, Any

from hummingbot.connector.exchange_base import ClientOrderBookRow, Decimal
from hummingbot.core.data_type.order_book import OrderBook, OrderBookMessage

from hummingbot.connector.derivative.mango_v3_perpetual.mango_v3_perpetual_order_book import MangoV3PerpetualOrderBook
from hummingbot.connector.gateway_base import gateway_get_request
from hummingbot.core.data_type.order_book_tracker_data_source import OrderBookTrackerDataSource


class MangoV3PerpetualAPIOrderBookDataSource(OrderBookTrackerDataSource):
    @staticmethod
    async def fetch_trading_pairs() -> List[str]:
        try:
            response = await gateway_get_request("solana/mango/markets")
            pairs = [spot['name'] for spot in response['spot']]
            pairs.extend([perp['name'] for perp in response['perp']])
            return pairs
        except Exception:
            # Do nothing if the request fails -- there will be no autocomplete for mango trading pairs
            pass

        return []

    @classmethod
    async def get_last_traded_prices(cls, trading_pairs: List[str]) -> Dict[str, float]:
        response = await gateway_get_request("solana/mango/ticker", {'marketNames': trading_pairs})
        return {item['marketName']: float(item['price']) for item in response['lastTradedPrices']}

    async def get_snapshot(self, trading_pair: str) -> Dict[str, any]:
        return await gateway_get_request("solana/mango/orderbook", {'marketName': trading_pair})

    async def get_new_order_book(self, trading_pair: str) -> OrderBook:
        snapshot: Dict[str, Any] = await self.get_snapshot(trading_pair)
        snapshot_timestamp: float = time.time()
        snapshot_msg: OrderBookMessage = MangoV3PerpetualOrderBook.snapshot_message_from_exchange(
            snapshot, snapshot_timestamp, metadata={"id": trading_pair, "rest": True}
        )
        order_book: OrderBook = self.order_book_create_function()
        bids = [
            ClientOrderBookRow(Decimal(bid["price"]), Decimal(bid["amount"]), snapshot_msg.update_id)
            for bid in snapshot_msg.bids
        ]
        asks = [
            ClientOrderBookRow(Decimal(ask["price"]), Decimal(ask["amount"]), snapshot_msg.update_id)
            for ask in snapshot_msg.asks
        ]
        order_book.apply_snapshot(bids, asks, snapshot_msg.update_id)
        return order_book

    async def listen_for_order_book_diffs(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        pass

    async def listen_for_order_book_snapshots(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        pass

    async def listen_for_trades(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
        pass


async def listen_for_trades(self, ev_loop: asyncio.BaseEventLoop, output: asyncio.Queue):
    pass
