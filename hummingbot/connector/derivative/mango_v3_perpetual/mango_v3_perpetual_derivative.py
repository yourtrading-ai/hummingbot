import logging
from datetime import time
from decimal import Decimal
from typing import List, Optional, Dict

from hummingbot.connector.exchange_base import ExchangeBase
from hummingbot.connector.trading_rule import TradingRule
from hummingbot.core.data_type.limit_order import LimitOrder
from hummingbot.core.data_type.order_book import OrderBook
from hummingbot.core.data_type.transaction_tracker import TransactionTracker

from hummingbot.connector.derivative.mango_v3_perpetual.mango_v3_perpetual_constants import EXCHANGE_NAME, MARKETS_URL, \
    ORDERS_URL, ACCOUNTS_URL
from hummingbot.connector.derivative.mango_v3_perpetual.mango_v3_perpetual_in_flight_order import \
    MangoV3PerpetualInFlightOrder
from hummingbot.connector.derivative.mango_v3_perpetual.mango_v3_perpetual_order_book_tracker import \
    MangoV3PerpetualOrderBookTracker
from hummingbot.connector.derivative.perpetual_budget_checker import PerpetualBudgetChecker
from hummingbot.logger import HummingbotLogger

from hummingbot.core.utils.async_utils import safe_ensure_future

from hummingbot.connector.gateway_base import gateway_get_request
from hummingbot.connector.perpetual_trading import PerpetualTrading
from hummingbot.connector.solana_base import SolanaBase

from hummingbot.core.event.events import (
    PositionMode, OrderCancelledEvent, MarketEvent, OrderType,
)

s_logger = None
s_decimal_0 = Decimal(0)
s_decimal_NaN = Decimal("nan")


def now():
    return int(time.time()) * 1000


class MangoV3PerpetualDerivativeTransactionTracker(TransactionTracker):
    def __init__(self, owner):
        super().__init__()
        self._owner = owner

    def did_timeout_tx(self, tx_id: str):
        TransactionTracker.c_did_timeout_tx(self, tx_id)
        self._owner.did_timeout_tx(tx_id)


class MangoV3PerpetualDerivative(ExchangeBase, SolanaBase, PerpetualTrading):
    @classmethod
    def logger(cls) -> HummingbotLogger:
        global s_logger
        if s_logger is None:
            s_logger = logging.getLogger(__name__)
        return s_logger

    def __init__(
            self,
            solana_wallet_private_key: str,
            mango_account_address: str = None,
            trading_pairs: Optional[List[str]] = None,
            trading_required: bool = True,
    ):
        SolanaBase.__init__(self, trading_pairs, solana_wallet_private_key, trading_required)
        PerpetualTrading.__init__(self)
        if mango_account_address:
            self._mango_account_address = mango_account_address
        else:
            response = await gateway_get_request(f"{self.network_base_path}/{self.base_path}{ACCOUNTS_URL}")
            if len(response['mangoAccounts']) > 0:
                # TODO: Let user specify which to use
                self._mango_account_address = response['mangoAccounts'][0]['publicKey']

        self._order_book_tracker = MangoV3PerpetualOrderBookTracker(trading_pairs=trading_pairs)
        self._tx_tracker = MangoV3PerpetualDerivativeTransactionTracker(self)
        self._budget_checker = PerpetualBudgetChecker(self)
        self._trading_rules = {}
        self._in_flight_orders_by_exchange_id = {}

    @property
    def name(self):
        return EXCHANGE_NAME

    @property
    def base_path(self):
        return f"{self.network_base_path}/mango"

    @property
    def status_dict(self) -> Dict[str, bool]:
        return {
            "order_books_initialized": len(self._order_book_tracker.order_books) > 0,
            "account_balances": len(self._account_balances) > 0 if self._trading_required else True,
            "trading_rule_initialized": len(self._trading_rules) > 0 if self._trading_required else True,
            "funding_info_available": len(self._funding_info) > 0 if self._trading_required else True,

        }

    # ----------------------------------------
    # Markets & Order Books

    @staticmethod
    async def fetch_trading_pairs(self: 'MangoV3PerpetualDerivative') -> List[str]:
        response = await gateway_get_request(f"{self.base_path}{MARKETS_URL}")
        return [market['name'] for market in response['perp']]

    @property
    def order_books(self) -> Dict[str, OrderBook]:
        return self._order_book_tracker.order_books

    def get_order_book(self, trading_pair: str):
        order_books = self._order_book_tracker.order_books
        if trading_pair not in order_books:
            raise ValueError(f"No order book exists for '{trading_pair}'.")
        return order_books[trading_pair]

    @property
    def limit_orders(self) -> List[LimitOrder]:
        retval = []

        for in_flight_order in self._in_flight_orders.values():
            mango_v3_flight_order = in_flight_order
            if mango_v3_flight_order.order_type in [OrderType.LIMIT, OrderType.LIMIT_MAKER]:
                retval.append(mango_v3_flight_order.to_limit_order())
        return retval

    @property
    def budget_checker(self) -> PerpetualBudgetChecker:
        return self._budget_checker

    # ----------------------------------------
    # Account Balances

    def get_balance(self, currency: str):
        return self._account_balances.get(currency, Decimal(0))

    def get_available_balance(self, currency: str):
        return self._account_available_balances.get(currency, Decimal(0))

    # ==========================================================
    # Order Submission
    # ----------------------------------------------------------

    @property
    def in_flight_orders(self) -> Dict[str, MangoV3PerpetualInFlightOrder]:
        return self._in_flight_orders

    def supported_order_types(self):
        return [OrderType.LIMIT, OrderType.LIMIT_MAKER]

    def _set_exchange_id(self, in_flight_order, exchange_order_id):
        in_flight_order.update_exchange_order_id(exchange_order_id)
        self._in_flight_orders_by_exchange_id[exchange_order_id] = in_flight_order

    async def get_order(self, client_order_id: str, trading_pair: str = None):
        response = await self.api_request('get',
                                          f"{self.base_path}{ORDERS_URL}",
                                          {
                                              'account': self._mango_account_address,
                                              'clientOrderId': client_order_id,
                                              'marketName': trading_pair
                                          })

        return response['perp'][0] if len(response['perp']) > 0 else None

    async def get_orders(self, trading_pair: str) -> List[Dict[str, str]]:
        response = await self.api_request('get',
                                          f"{self.base_path}{ORDERS_URL}",
                                          {
                                              'marketName': trading_pair,
                                              'mangoAccountAddress': self._mango_account_address
                                          })
        return response['perp']

    def start_tracking_order(self, *args, **kwargs):
        pass

    def cancel_order(self, client_order_id: str, trading_pair: str = None):
        in_flight_order = self._in_flight_orders.get(client_order_id)
        cancellation_event = OrderCancelledEvent(now(), client_order_id)

        if in_flight_order is None:
            self.logger().warning(f"Cancelled an untracked order {client_order_id}")
            self.trigger_event(MarketEvent.OrderCancelled, cancellation_event)
            return False

        try:
            response = await self.api_request('delete', f"{self.base_path}{ORDERS_URL}",
                                              {'clientOrderId': client_order_id})
            for order in response['orders']:
                if order['clientOrderId'] == client_order_id:
                    if order['status'] == 'cancelled':
                        return True
                    elif order['status'] == 'unknown':
                        self.logger().warning(f"Order {client_order_id} does not exist on-chain")
                        self.trigger_event(MarketEvent.OrderCancelled, cancellation_event)
                        return False
                    elif order['status'] == 'filled':
                        response = await self.api_request('get',
                                                          f"{self.base_path}{ORDERS_URL}",
                                                          {
                                                              'account': self._mango_account_address,
                                                              'clientOrderId': client_order_id,
                                                              'marketName': trading_pair
                                                          })
                        order_status = response["order"]
                        in_flight_order.update(order_status)
                        self._issue_order_events(in_flight_order)
                        self.stop_tracking_order(in_flight_order.client_order_id)
                        return False
                    elif order['status'] == 'open':
                        self.logger().warning(f"Unable to cancel order {client_order_id}")
                        return False
        except Exception as e:
            self.logger().warning(f"Failed to cancel order {client_order_id}")
            self.logger().info(e)
            return False

    def cancel(self, trading_pair: str, client_order_id: str):
        return safe_ensure_future(self.cancel_order(client_order_id))

    def c_stop_tracking_order(self, order_id):
        pass

    def get_price(self, trading_pair: str, is_buy: bool, amount: Decimal = s_decimal_NaN) -> Decimal:
        pass

    def supported_position_modes(self) -> List[PositionMode]:
        pass

    def get_buy_collateral_token(self, trading_pair: str) -> str:
        # TODO: Implement _trading_rules
        trading_rule: TradingRule = self._trading_rules[trading_pair]
        return trading_rule.buy_order_collateral_token

    def get_sell_collateral_token(self, trading_pair: str) -> str:
        trading_rule: TradingRule = self._trading_rules[trading_pair]
        return trading_rule.sell_order_collateral_token
