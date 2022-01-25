from datetime import time
from decimal import Decimal
from typing import List, Optional, Dict

from hummingbot.connector.trading_rule import TradingRule
from hummingbot.core.utils.async_utils import safe_ensure_future

from hummingbot.connector.gateway_base import gateway_get_request
from hummingbot.connector.perpetual_trading import PerpetualTrading
from hummingbot.connector.solana_base import SolanaBase

from hummingbot.core.event.events import (
    PositionMode, OrderCancelledEvent, MarketEvent,
)

s_logger = None
s_decimal_0 = Decimal(0)
s_decimal_NaN = Decimal("nan")


def now():
    return int(time.time()) * 1000


class MangoV3PerpetualDerivative(SolanaBase, PerpetualTrading):
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
            response = await gateway_get_request(f"{self.network_base_path}/{self.base_path}/accounts")
            if len(response['mangoAccounts']) > 0:
                # TODO: Let user specify which to use
                self._mango_account_address = response['mangoAccounts'][0]['publicKey']

    @property
    def base_path(self):
        return f"{self.network_base_path}/mango"

    @staticmethod
    async def fetch_trading_pairs(self: 'MangoV3PerpetualDerivative') -> List[str]:
        response = await gateway_get_request(f"{self.base_path}/markets")
        return [market['name'] for market in response['perp']]

    async def get_order(self, client_order_id: str, trading_pair: str = None):
        response = await self.api_request('get',
                                          f"{self.base_path}/orders",
                                          {
                                              'account': self._mango_account_address,
                                              'clientOrderId': client_order_id,
                                              'marketName': trading_pair
                                          })

        return response['perp'][0] if len(response['perp']) > 0 else None

    async def get_orders(self, trading_pair: str) -> List[Dict[str, str]]:
        response = await self.api_request('get',
                                          f"{self.base_path}/orders",
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
            response = await self.api_request('delete', f"{self.base_path}/orders",
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
                                                          f"{self.base_path}/orders",
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

    @property
    def name(self):
        return 'mango-v3'

    def get_buy_collateral_token(self, trading_pair: str) -> str:
        # TODO: Implement _trading_rules
        trading_rule: TradingRule = self._trading_rules[trading_pair]
        return trading_rule.buy_order_collateral_token

    def get_sell_collateral_token(self, trading_pair: str) -> str:
        trading_rule: TradingRule = self._trading_rules[trading_pair]
        return trading_rule.sell_order_collateral_token
