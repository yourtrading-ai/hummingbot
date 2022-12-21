import asyncio
import math
import time
import traceback
from decimal import Decimal
from enum import Enum
from logging import DEBUG, ERROR, INFO, WARNING
from os import path
from pathlib import Path
from typing import Any, Dict, List, Union

import jsonpickle
import numpy as np

from hummingbot.client.hummingbot_application import HummingbotApplication
from hummingbot.connector.gateway.clob.clob_types import OrderSide as SerumOrderSide, OrderType as SerumOrderType
from hummingbot.connector.gateway.clob.clob_utils import convert_order_side, convert_trading_pair
from hummingbot.connector.gateway.clob.gateway_sol_clob import GatewaySOLCLOB
from hummingbot.core.clock import Clock
from hummingbot.core.data_type.common import OrderType, TradeType
from hummingbot.core.data_type.order_candidate import OrderCandidate
from hummingbot.core.gateway.gateway_http_client import GatewayHttpClient
from hummingbot.strategy.script_strategy_base import ScriptStrategyBase


# noinspection DuplicatedCode
class CLOBPMMExample(ScriptStrategyBase):

    class MiddlePriceStrategy(Enum):
        SAP = 'SIMPLE_AVERAGE_PRICE'
        WAP = 'WEIGHTED_AVERAGE_PRICE'
        VWAP = 'VOLUME_WEIGHTED_AVERAGE_PRICE'

    def __init__(self):
        try:
            # self._log(DEBUG, """__init__... start""")

            super().__init__()

            self._can_run: bool = True
            self._script_name = path.basename(Path(__file__))
            self._configuration = {
                "chain": "solana",
                "network": "mainnet-beta",
                "connector": "serum",
                "markets": {
                    "serum_solana_mainnet-beta": [  # Only one market can be used
                        # "SOL-USDC",
                        # "ETH-USDC",
                        # "USDT-USDC",
                        # "mSOL-USDC",
                        # "SLND-USDC",
                        "DUMMY-USDC",
                        # "SOL-USDC (NEW)",
                        # "ETH-USDC (NEW)",
                        # "USDT-USDC (NEW)",
                        # "mSOL-USDC (NEW)",
                        # "SLND-USDC (NEW)"
                    ]
                },
                "strategy": {
                    "layers": [
                        {
                            "bid": {
                                "quantity": 1,
                                "spread_percentage": 1,
                                "max_liquidity_in_dollars": 5
                            },
                            "ask": {
                                "quantity": 1,
                                "spread_percentage": 1,
                                "max_liquidity_in_dollars": 5
                            }
                        },
                        {
                            "bid": {
                                "quantity": 1,
                                "spread_percentage": 5,
                                "max_liquidity_in_dollars": 5
                            },
                            "ask": {
                                "quantity": 1,
                                "spread_percentage": 5,
                                "max_liquidity_in_dollars": 5
                            }
                        },
                        {
                            "bid": {
                                "quantity": 1,
                                "spread_percentage": 10,
                                "max_liquidity_in_dollars": 5
                            },
                            "ask": {
                                "quantity": 1,
                                "spread_percentage": 10,
                                "max_liquidity_in_dollars": 5
                            }
                        },
                    ],
                    "tick_interval": 59,
                    "serum_order_type": "LIMIT",
                    "price_strategy": "middle",
                    "middle_price_strategy": "VWAP",
                    "cancel_all_orders_on_start": False,
                    "cancel_all_orders_on_stop": False,
                    "run_only_once": False
                },
                "logger": {
                    "level": "INFO"
                }
            }
            self._owner_address = None
            self._connector_id = None
            self._quote_token = None
            self._base_token = None
            self._hb_trading_pair = None
            self._is_busy: bool = False
            self._refresh_timestamp: int
            self._market: str
            self._gateway: GatewayHttpClient
            self._connector: GatewaySOLCLOB
            self._market_info: Dict[str, Any]
            self._balances: Dict[str, Any] = {}
            self._tickers: Dict[str, Any]
            self._open_orders: Dict[str, Any]
            self._filled_orders: Dict[str, Any]
            self._vwap_threshold = 50
            self._int_zero = int(0)
            self._float_zero = float(0)
            self._float_infinity = float('inf')
            self._decimal_zero = Decimal(0)
            self._decimal_infinity = Decimal("Infinity")
        finally:
            pass
        #     self._log(DEBUG, """__init__... end""")

    def get_markets_definitions(self) -> Dict[str, List[str]]:
        return self._configuration["markets"]

    # noinspection PyAttributeOutsideInit
    async def initialize(self, start_command):
        try:
            self._log(DEBUG, """_initialize... start""")

            self.logger().setLevel(self._configuration["logger"].get("level", "INFO"))

            await super().initialize(start_command)
            self.initialized = False

            self._connector_id = next(iter(self._configuration["markets"]))

            self._hb_trading_pair = self._configuration["markets"][self._connector_id][0]
            self._market = convert_trading_pair(self._hb_trading_pair)

            split = self._market.split("/")
            self._base_token = split[0]
            self._quote_token = split[1].replace(" (NEW)", "")

            # noinspection PyTypeChecker
            self._connector: GatewaySOLCLOB = self.connectors[self._connector_id]
            self._gateway: GatewayHttpClient = self._connector.get_gateway_instance()

            self._owner_address = self._connector.address

            self._market_info = await self._get_market()

            await self._auto_create_token_accounts()

            if self._configuration["strategy"]["cancel_all_orders_on_start"]:
                await self._cancel_all_orders()

            await self._settle_funds()

            waiting_time = self._calculate_waiting_time(self._configuration["strategy"]["tick_interval"])
            self._log(DEBUG, f"""Waiting for {waiting_time}s.""")
            self._refresh_timestamp = waiting_time + self.current_timestamp

            self.initialized = True
        except Exception as exception:
            self._handle_error(exception)

            HummingbotApplication.main_application().stop()
        finally:
            self._log(DEBUG, """_initialize... end""")

    async def on_tick(self):
        if (not self._is_busy) and (not self._can_run):
            HummingbotApplication.main_application().stop()

        if self._is_busy or (self._refresh_timestamp > self.current_timestamp):
            return

        try:
            self._log(DEBUG, """on_tick... start""")

            self._is_busy = True

            try:
                await self._settle_funds()
            except Exception as exception:
                self._handle_error(exception)

            await self._get_open_orders(use_cache=False)
            await self._get_filled_orders(use_cache=False)
            await self._get_balances(use_cache=False)

            try:
                await self._cancel_duplicated_orders()
            except Exception as exception:
                self._handle_error(exception)

            proposal: List[OrderCandidate] = await self._create_proposal()
            candidate_orders: List[OrderCandidate] = await self._adjust_proposal_to_budget(proposal)

            replaced_orders = await self._replace_orders(candidate_orders)

            try:
                await self._cancel_remaining_orders(candidate_orders, replaced_orders)
            except Exception as exception:
                self._handle_error(exception)
        except Exception as exception:
            self._handle_error(exception)
        finally:
            waiting_time = self._calculate_waiting_time(self._configuration["strategy"]["tick_interval"])

            # noinspection PyAttributeOutsideInit
            self._refresh_timestamp = waiting_time + self.current_timestamp
            self._is_busy = False

            self._log(DEBUG, f"""Waiting for {waiting_time}s.""")

            self._log(DEBUG, """on_tick... end""")

            if self._configuration["strategy"]["run_only_once"]:
                HummingbotApplication.main_application().stop()

    def stop(self, clock: Clock):
        asyncio.get_event_loop().run_until_complete(self.async_stop(clock))

    async def async_stop(self, clock: Clock):
        try:
            self._log(DEBUG, """_stop... start""")

            self._can_run = False

            if self._configuration["strategy"]["cancel_all_orders_on_stop"]:
                await self._cancel_all_orders()
                await self._settle_funds()

            super().stop(clock)
        finally:
            self._log(DEBUG, """_stop... end""")

    async def _create_proposal(self) -> List[OrderCandidate]:
        try:
            self._log(DEBUG, """_create_proposal... start""")

            order_book = await self._get_order_book()
            bids, asks = self._parse_order_book(order_book)

            ticker_price = await self._get_market_price()
            try:
                last_filled_order_price = await self._get_last_filled_order_price()
            except Exception as exception:
                self._handle_error(exception)

                last_filled_order_price = self._decimal_zero

            price_strategy = self._configuration["strategy"]["price_strategy"]
            if price_strategy == "ticker":
                used_price = ticker_price
            elif price_strategy == "middle":
                used_price = await self._get_market_mid_price(
                    bids,
                    asks,
                    self.MiddlePriceStrategy[
                        self._configuration["strategy"].get(
                            "middle_price_strategy",
                            "VWAP"
                        )
                    ]
                )
            elif price_strategy == "last_fill":
                used_price = last_filled_order_price
            else:
                raise ValueError("""Invalid "strategy.middle_price_strategy" configuration value.""")

            if used_price is None or used_price <= self._decimal_zero:
                raise ValueError(f"Invalid price: {used_price}")

            tick_size = Decimal(self._market_info["tickSize"])
            min_order_size = Decimal(self._market_info["minimumOrderSize"])

            order_id = 1
            proposal = []

            bid_orders = []
            for index, layer in enumerate(self._configuration["strategy"]["layers"], start=1):
                best_ask = Decimal(next(iter(asks), {"price": self._float_infinity})["price"])
                bid_quantity = int(layer["bid"]["quantity"])
                bid_spread_percentage = Decimal(layer["bid"]["spread_percentage"])
                bid_market_price = ((100 - bid_spread_percentage) / 100) * min(used_price, best_ask)
                bid_max_liquidity_in_dollars = Decimal(layer["bid"]["max_liquidity_in_dollars"])
                bid_size = bid_max_liquidity_in_dollars / bid_market_price / bid_quantity if bid_quantity > 0 else 0

                if bid_market_price < tick_size:
                    self._log(
                        WARNING,
                        f"""Skipping orders placement from layer {index}, bid price too low:\n\n{'{:^30}'.format(round(bid_market_price, 6))}"""
                    )
                elif bid_size < min_order_size:
                    self._log(
                        WARNING,
                        f"""Skipping orders placement from layer {index}, bid size too low:\n\n{'{:^30}'.format(round(bid_size, 9))}"""
                    )
                else:
                    for i in range(bid_quantity):
                        bid_order = OrderCandidate(
                            trading_pair=self._hb_trading_pair.replace(" (NEW)", ""),
                            is_maker=True,
                            order_type=OrderType.LIMIT,
                            order_side=TradeType.BUY,
                            amount=bid_size,
                            price=bid_market_price
                        )

                        bid_order.id = str(order_id)

                        bid_orders.append(bid_order)

                        order_id += 1

            ask_orders = []
            for index, layer in enumerate(self._configuration["strategy"]["layers"], start=1):
                best_bid = Decimal(next(iter(bids), {"price": self._float_zero})["price"])
                ask_quantity = int(layer["ask"]["quantity"])
                ask_spread_percentage = Decimal(layer["ask"]["spread_percentage"])
                ask_market_price = ((100 + ask_spread_percentage) / 100) * max(used_price, best_bid)
                ask_max_liquidity_in_dollars = Decimal(layer["ask"]["max_liquidity_in_dollars"])
                ask_size = ask_max_liquidity_in_dollars / ask_market_price / ask_quantity if ask_quantity > 0 else 0

                if ask_market_price < tick_size:
                    self._log(WARNING,
                              f"""Skipping orders placement from layer {index}, ask price too low:\n\n{'{:^30}'.format(round(ask_market_price, 9))}""",
                              True)
                elif ask_size < min_order_size:
                    self._log(WARNING,
                              f"""Skipping orders placement from layer {index}, ask size too low:\n\n{'{:^30}'.format(round(ask_size, 9))}""",
                              True)
                else:
                    for i in range(ask_quantity):
                        ask_order = OrderCandidate(
                            trading_pair=self._hb_trading_pair,
                            is_maker=True,
                            order_type=OrderType.LIMIT,
                            order_side=TradeType.SELL,
                            amount=ask_size,
                            price=ask_market_price
                        )

                        ask_order.id = str(order_id)

                        ask_orders.append(ask_order)

                        order_id += 1

            proposal = [*proposal, *bid_orders, *ask_orders]

            self._log(DEBUG, f"""proposal:\n{self._dump(proposal)}""")

            return proposal
        finally:
            self._log(DEBUG, """_create_proposal... end""")

    async def _adjust_proposal_to_budget(self, candidate_proposal: List[OrderCandidate]) -> List[OrderCandidate]:
        try:
            self._log(DEBUG, """_adjust_proposal_to_budget... start""")

            adjusted_proposal: List[OrderCandidate] = []

            balances = await self._get_balances()
            base_balance = Decimal(balances["balances"][self._base_token])
            quote_balance = Decimal(balances["balances"][self._quote_token])
            current_base_balance = base_balance
            current_quote_balance = quote_balance

            for order in candidate_proposal:
                if order.order_side == TradeType.BUY:
                    if current_quote_balance > order.amount:
                        current_quote_balance -= order.amount
                        adjusted_proposal.append(order)
                    else:
                        continue
                elif order.order_side == TradeType.SELL:
                    if current_base_balance > order.amount:
                        current_base_balance -= order.amount
                        adjusted_proposal.append(order)
                    else:
                        continue
                else:
                    raise ValueError(f"""Unrecognized order size "{order.order_side}".""")

            self._log(DEBUG, f"""adjusted_proposal:\n{self._dump(adjusted_proposal)}""")

            return adjusted_proposal
        finally:
            self._log(DEBUG, """_adjust_proposal_to_budget... end""")

    async def _get_base_ticker_price(self) -> Decimal:
        try:
            self._log(DEBUG, """_get_ticker_price... start""")

            return Decimal((await self._get_ticker(use_cache=False))["price"])
        finally:
            self._log(DEBUG, """_get_ticker_price... end""")

    async def _get_last_filled_order_price(self) -> Decimal:
        try:
            self._log(DEBUG, """_get_last_filled_order_price... start""")

            return Decimal((await self._get_last_filled_order())["price"])
        finally:
            self._log(DEBUG, """_get_last_filled_order_price... end""")

    async def _get_market_price(self) -> Decimal:
        return await self._get_base_ticker_price()

    async def _get_market_mid_price(self, bids, asks, strategy: MiddlePriceStrategy = None) -> Decimal:
        try:
            self._log(DEBUG, """_get_market_mid_price... start""")

            if strategy:
                return self._calculate_mid_price(bids, asks, strategy)

            try:
                return self._calculate_mid_price(bids, asks, self.MiddlePriceStrategy.VWAP)
            except (Exception,):
                try:
                    return self._calculate_mid_price(bids, asks, self.MiddlePriceStrategy.WAP)
                except (Exception,):
                    try:
                        return self._calculate_mid_price(bids, asks, self.MiddlePriceStrategy.SAP)
                    except (Exception,):
                        return await self._get_market_price()
        finally:
            self._log(DEBUG, """_get_market_mid_price... end""")

    async def _get_base_balance(self) -> Decimal:
        try:
            self._log(DEBUG, """_get_base_balance... start""")

            base_balance = Decimal((await self._get_balances())["balances"][self._base_token])

            return base_balance
        finally:
            self._log(DEBUG, """_get_base_balance... end""")

    async def _get_quote_balance(self) -> Decimal:
        try:
            self._log(DEBUG, """_get_quote_balance... start""")

            quote_balance = Decimal((await self._get_balances())["balances"][self._quote_token])

            return quote_balance
        finally:
            self._log(DEBUG, """_get_quote_balance... start""")

    async def _auto_create_token_accounts(self):
        try:
            self._log(DEBUG, """_auto_create_token_accounts... start""")

            for token in [self._base_token, self._quote_token]:
                await GatewayHttpClient.get_instance().solana_post_token(
                    self._configuration["network"],
                    self._owner_address,
                    token
                )
        finally:
            self._log(DEBUG, """_auto_create_token_accounts... end""")

    async def _get_balances(self, use_cache: bool = True) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_balances... start""")

            response = None
            try:
                request = {
                    "network": self._configuration["network"],
                    "address": self._owner_address,
                    "token_symbols": []
                }

                self._log(INFO, f"""gateway.solana_get_balances:\nrequest:\n{self._dump(request)}""")

                if use_cache and self._balances is not None:
                    response = self._balances
                else:
                    response = await self._gateway.solana_get_balances(**request)

                    self._balances = {"balances": {}}
                    for (token, balance) in dict(response["balances"]).items():
                        decimal_balance = Decimal(balance)
                        if decimal_balance > self._decimal_zero:
                            self._balances["balances"][token] = Decimal(balance)

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO, f"""gateway.solana_get_balances:\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_get_balances... end""")

    async def _get_market(self):
        try:
            self._log(DEBUG, """_get_market... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "name": self._market
                }

                response = await self._gateway.clob_get_markets(**request)

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_get_markets:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_get_market... end""")

    async def _get_order_book(self):
        try:
            self._log(DEBUG, """_get_order_book... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "market_name": self._market
                }

                response = await self._gateway.clob_get_order_books(**request)

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(DEBUG,
                          f"""gateway.clob_get_order_books:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_get_order_book... end""")

    async def _get_ticker(self, use_cache: bool = True) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_tickers... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "market_name": self._market
                }

                if use_cache and self._tickers is not None:
                    response = self._tickers
                else:
                    response = await self._gateway.clob_get_tickers(**request)

                    self._tickers = response

                return response
            except Exception as exception:
                response = exception

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_get_tickers:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")

        finally:
            self._log(DEBUG, """_get_tickers... end""")

    async def _get_open_orders(self, use_cache: bool = True) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_open_orders... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "market_name": self._market,
                    "owner_address": self._owner_address
                }

                if use_cache and self._open_orders is not None:
                    response = self._open_orders
                else:
                    response = await self._gateway.clob_get_open_orders(**request)
                    self._open_orders = response

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_get_open_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_get_open_orders... end""")

    async def _get_last_filled_order(self) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_last_filled_order... start""")

            filled_orders = await self._get_filled_orders()

            last_filled_order = list(dict(filled_orders[self._market]).values())[0]

            return last_filled_order
        finally:
            self._log(DEBUG, """_get_last_filled_order... end""")

    async def _get_filled_orders(self, use_cache: bool = True) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_filled_orders... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "market_name": self._market,
                    "owner_address": self._owner_address
                }

                if use_cache and self._filled_orders is not None:
                    response = self._filled_orders
                else:
                    response = await self._gateway.clob_get_filled_orders(**request)
                    self._filled_orders = response

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(DEBUG,
                          f"""gateway.clob_get_filled_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")

        finally:
            self._log(DEBUG, """_get_filled_orders... end""")

    async def _replace_orders(self, proposal: List[OrderCandidate]) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_replace_orders... start""")

            response = None
            try:
                orders = []
                for candidate in proposal:
                    orders.append({
                        "id": candidate.id,
                        "marketName": self._market,
                        "ownerAddress": self._owner_address,
                        "side": convert_order_side(candidate.order_side).value[0],
                        "price": float(candidate.price),
                        "amount": float(candidate.amount),
                        "type": SerumOrderType[self._configuration["strategy"].get("serum_order_type", "LIMIT")].value[
                            0],
                        "replaceIfExists": True
                    })

                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "orders": orders
                }

                self._log(INFO, f"""gateway.clob_post_orders:\nrequest:\n{self._dump(request)}""")

                if len(orders):
                    response = await self._gateway.clob_post_orders(**request)
                else:
                    self._log(WARNING, "No order was defined for placement/replacement. Skipping.", True)
                    response = []

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO, f"""gateway.clob_post_orders:\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_replace_orders... end""")

    async def _cancel_duplicated_orders(self):
        try:
            self._log(DEBUG, """_cancel_duplicated_orders... start""")

            request = None
            response = None
            try:
                duplicated_orders_exchange_ids = await self._get_duplicated_orders_exchange_ids()

                if len(duplicated_orders_exchange_ids) > 0:
                    request = {
                        "chain": self._configuration["chain"],
                        "network": self._configuration["network"],
                        "connector": self._configuration["connector"],
                        "orders": [{
                            "ids": [],
                            "exchangeIds": duplicated_orders_exchange_ids,
                            "marketName": self._market,
                            "ownerAddress": self._owner_address,
                        }]
                    }

                    response = await self._gateway.clob_delete_orders(**request)
                else:
                    self._log(INFO, "No order needed to be canceled.")
                    response = {}

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_delete_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_cancel_duplicated_orders... end""")

    async def _cancel_remaining_orders(self, candidate_orders, created_orders):
        try:
            self._log(DEBUG, """_cancel_duplicated_and_remaining_orders... start""")

            request = None
            response = None
            try:
                remaining_orders_ids = await self._get_remaining_orders_client_ids(candidate_orders, created_orders)

                if len(remaining_orders_ids) > 0:
                    request = {
                        "chain": self._configuration["chain"],
                        "network": self._configuration["network"],
                        "connector": self._configuration["connector"],
                        "orders": [{
                            "ids": remaining_orders_ids,
                            "exchangeIds": [],
                            "marketName": self._market,
                            "ownerAddress": self._owner_address,
                        }]
                    }

                    response = await self._gateway.clob_delete_orders(**request)
                else:
                    self._log(INFO, "No order needed to be canceled.")
                    response = {}

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_delete_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_cancel_duplicated_and_remaining_orders... end""")

    async def _cancel_all_orders(self):
        try:
            self._log(DEBUG, """_cancel_all_orders... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "order": {
                        "marketName": self._market,
                        "ownerAddress": self._owner_address,
                    }
                }

                response = await self._gateway.clob_delete_orders(**request)
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_delete_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_cancel_all_orders... end""")

    async def _settle_funds(self):
        try:
            self._log(DEBUG, """_settle_funds... start""")

            response = None
            try:
                request = {
                    "chain": self._configuration["chain"],
                    "network": self._configuration["network"],
                    "connector": self._configuration["connector"],
                    "owner_address": self._owner_address,
                    "market_name": self._market,
                }

                self._log(INFO, f"""gateway.clob_post_settle_funds:\nrequest:\n{self._dump(request)}""")

                response = await self._gateway.clob_post_settle_funds(**request)
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_post_settle_funds:\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_settle_funds... end""")

    async def _get_remaining_orders_client_ids(self, candidate_orders, created_orders) -> List[str]:
        self._log(DEBUG, """_get_remaining_orders_ids... end""")

        try:
            candidate_orders_ids = [order.id for order in candidate_orders] if len(candidate_orders) else []
            created_orders_ids = [order["id"] for order in created_orders.values()] if len(created_orders) else []
            remaining_orders_ids = list(set(candidate_orders_ids) - set(created_orders_ids))

            self._log(INFO, f"""remaining_orders_ids:\n{self._dump(remaining_orders_ids)}""")

            return remaining_orders_ids
        finally:
            self._log(DEBUG, """_get_remaining_orders_ids... end""")

    async def _get_duplicated_orders_exchange_ids(self) -> List[str]:
        self._log(DEBUG, """_get_duplicated_orders_exchange_ids... start""")

        try:
            open_orders = (await self._get_open_orders())[self._market].values()

            open_orders_map = {}
            duplicated_orders_exchange_ids = []

            for open_order in open_orders:
                if open_order["id"] == "0":  # Avoid touching manually created orders.
                    continue
                elif open_order["id"] not in open_orders_map:
                    open_orders_map[open_order["id"]] = [open_order]
                else:
                    open_orders_map[open_order["id"]].append(open_order)

            for orders in open_orders_map.values():
                orders.sort(key=lambda order: order["exchangeId"])

                duplicated_orders_exchange_ids = [
                    *duplicated_orders_exchange_ids,
                    *[order["exchangeId"] for order in orders[:-1]]
                ]

            self._log(INFO, f"""duplicated_orders_exchange_ids:\n{self._dump(duplicated_orders_exchange_ids)}""")

            return duplicated_orders_exchange_ids
        finally:
            self._log(DEBUG, """_get_duplicated_orders_exchange_ids... end""")

    # noinspection PyMethodMayBeStatic
    def _parse_order_book(self, orderbook: Dict[str, Any]) -> List[Union[List[Dict[str, Any]], List[Dict[str, Any]]]]:
        bids_list = []
        asks_list = []

        bids: Dict[str, Any] = orderbook["bids"]
        asks: Dict[str, Any] = orderbook["asks"]

        for value in bids.values():
            bids_list.append({'price': value["price"], 'amount': value["amount"]})

        for value in asks.values():
            asks_list.append({'price': value["price"], 'amount': value["amount"]})

        bids_list.sort(key=lambda x: x['price'], reverse=True)
        asks_list.sort(key=lambda x: x['price'], reverse=False)

        return [bids_list, asks_list]

    def _split_percentage(self, bids: [Dict[str, Any]], asks: [Dict[str, Any]]) -> List[Any]:
        asks = asks[:math.ceil((self._vwap_threshold / 100) * len(asks))]
        bids = bids[:math.ceil((self._vwap_threshold / 100) * len(bids))]

        return [bids, asks]

    # noinspection PyMethodMayBeStatic
    def _compute_volume_weighted_average_price(self, book: [Dict[str, Any]]) -> np.array:
        prices = [order['price'] for order in book]
        amounts = [order['amount'] for order in book]

        prices = np.array(prices)
        amounts = np.array(amounts)

        vwap = (np.cumsum(amounts * prices) / np.cumsum(amounts))

        return vwap

    # noinspection PyMethodMayBeStatic
    def _remove_outliers(self, order_book: [Dict[str, Any]], side: SerumOrderSide) -> [Dict[str, Any]]:
        prices = [order['price'] for order in order_book]

        q75, q25 = np.percentile(prices, [75, 25])

        # https://www.askpython.com/python/examples/detection-removal-outliers-in-python
        # intr_qr = q75-q25
        # max_threshold = q75+(1.5*intr_qr)
        # min_threshold = q75-(1.5*intr_qr) # Error: Sometimes this function assigns negative value for min

        max_threshold = q75 * 1.5
        min_threshold = q25 * 0.5

        orders = []
        if side == SerumOrderSide.SELL:
            orders = [order for order in order_book if order['price'] < max_threshold]
        elif side == SerumOrderSide.BUY:
            orders = [order for order in order_book if order['price'] > min_threshold]

        return orders

    def _calculate_mid_price(self, bids: [Dict[str, Any]], asks: [Dict[str, Any]], strategy: MiddlePriceStrategy) -> Decimal:
        if strategy == self.MiddlePriceStrategy.SAP:
            bid_prices = [item['price'] for item in bids]
            ask_prices = [item['price'] for item in asks]

            best_ask_price = 0
            best_bid_price = 0

            if len(ask_prices) > 0:
                best_ask_price = min(ask_prices)

            if len(bid_prices) > 0:
                best_bid_price = max(bid_prices)

            return Decimal((best_ask_price + best_bid_price) / 2.0)
        elif strategy == self.MiddlePriceStrategy.WAP:
            ask_prices = [item['price'] for item in asks]
            bid_prices = [item['price'] for item in bids]

            best_ask_price = 0
            best_ask_volume = 0
            best_bid_price = 0
            best_bid_amount = 0

            if len(ask_prices) > 0:
                best_ask_idx = ask_prices.index(min(ask_prices))
                best_ask_price = asks[best_ask_idx]['price']
                best_ask_volume = asks[best_ask_idx]['amount']

            if len(bid_prices) > 0:
                best_bid_idx = bid_prices.index(max(bid_prices))
                best_bid_price = bids[best_bid_idx]['price']
                best_bid_amount = bids[best_bid_idx]['amount']

            if best_ask_volume + best_bid_amount > 0:
                return Decimal(
                    (best_ask_price * best_ask_volume + best_bid_price * best_bid_amount)
                    / (best_ask_volume + best_bid_amount)
                )
            else:
                return self._decimal_zero
        elif strategy == self.MiddlePriceStrategy.VWAP:
            bids, asks = self._split_percentage(bids, asks)

            if len(bids) > 0:
                bids = self._remove_outliers(bids, SerumOrderSide.BUY)

            if len(asks) > 0:
                asks = self._remove_outliers(asks, SerumOrderSide.SELL)

            book = [*bids, *asks]

            if len(book) > 0:
                vwap = self._compute_volume_weighted_average_price(book)

                return Decimal(vwap[-1])
            else:
                return self._decimal_zero
        else:
            raise ValueError(f'Unrecognized mid price strategy "{strategy}".')

    # noinspection PyMethodMayBeStatic
    def _calculate_waiting_time(self, number: int) -> int:
        current_timestamp_in_milliseconds = int(time.time() * 1000)
        result = number - (current_timestamp_in_milliseconds % number)

        return result

    def _log(self, level: int, message: str, *args, **kwargs):
        # noinspection PyUnresolvedReferences
        message = f"""{message}"""

        self.logger().log(level, message, *args, **kwargs)

    def _handle_error(self, exception: Exception):
        message = f"""ERROR: {type(exception).__name__} {str(exception)}"""
        self._log(ERROR, message, True)

    @staticmethod
    def _dump(target: Any):
        try:
            return jsonpickle.encode(target, unpicklable=True, indent=2)
        except (Exception,):
            return target
