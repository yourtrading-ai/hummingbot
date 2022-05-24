import logging
from typing import Optional, Dict
from decimal import Decimal

from hummingbot.connector.derivative.mango_v3_perpetual.mango_v3_perpetual_order_book_message import \
    MangoV3PerpetualOrderBookMessage
from hummingbot.core.data_type.order_book_message import OrderBookMessage, OrderBookMessageType
from hummingbot.core.data_type.order_book import OrderBook
from hummingbot.logger import HummingbotLogger


class MangoV3PerpetualOrderBook(OrderBook):
    _bpob_logger = None

    @classmethod
    def logger(cls) -> HummingbotLogger:
        if cls._baobds_logger is None:
            cls._baobds_logger = logging.getLogger(__name__)
        return cls._baobds_logger

    @classmethod
    def snapshot_message_from_exchange(cls, msg: Dict[str, any], timestamp: Optional[float] = None,
                                       metadata: Optional[Dict] = None) -> OrderBookMessage:
        if metadata:
            msg.update(metadata)
        bids = [{"price": Decimal(bid["price"]), "amount": Decimal(bid["amount"])} for bid in msg["bids"]]
        asks = [{"price": Decimal(ask["price"]), "amount": Decimal(ask["amount"])} for ask in msg["asks"]]
        return MangoV3PerpetualOrderBookMessage(OrderBookMessageType.SNAPSHOT, {
            "trading_pair": msg["marketName"],
            "update_id": timestamp,
            "bids": bids,
            "asks": asks
        }, timestamp=timestamp)

    @classmethod
    def trade_message_from_exchange(cls, msg: Dict[str, any], metadata: Optional[Dict] = None):
        if metadata:
            msg.update(metadata)
        return MangoV3PerpetualOrderBookMessage(OrderBookMessageType.TRADE, {
            "trading_pair": msg["id"],
            "trade_type": msg["side"],
            "trade_id": msg["ts"],
            "update_id": msg["ts"],
            "price": Decimal(msg["price"]),
            "amount": Decimal(msg["amount"])
        }, timestamp=msg["ts"] * 1e-3)
