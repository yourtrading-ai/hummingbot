import asyncio
import math
import textwrap
import time
import traceback
from array import array
from decimal import Decimal
from logging import CRITICAL, DEBUG, ERROR, INFO, WARNING
from os import path
from pathlib import Path
from typing import Any, Dict, List

import jsonpickle
import yaml

from hummingbot.client.hummingbot_application import HummingbotApplication
from hummingbot.connector.gateway.clob.clob_types import OrderSide as SerumOrderSide, OrderType as SerumOrderType
from hummingbot.connector.gateway.clob.clob_utils import convert_order_side, convert_trading_pair
from hummingbot.connector.gateway.clob.gateway_sol_clob import GatewaySOLCLOB
from hummingbot.core.data_type.common import OrderType, TradeType
from hummingbot.core.data_type.order_candidate import OrderCandidate
from hummingbot.core.gateway.gateway_http_client import GatewayHttpClient
from hummingbot.strategy.script_strategy_base import ScriptStrategyBase

from .utils import (
    MiddlePriceStrategy,
    alignment_column,
    calculate_mid_price,
    calculate_waiting_time,
    decimal_zero,
    float_infinity,
    float_zero,
    format_currency,
    format_line,
    format_lines,
    format_percentage,
    get_float_or_random_float_in_interval,
    get_random_choice,
    parse_order_book,
)


# noinspection DuplicatedCode
class Worker(ScriptStrategyBase):

    def __init__(self):
        try:
            # self._log(DEBUG, """__init__... start""")

            super().__init__()

            self.id: str
            self.environment: str
            self.can_run: bool = True
            self._script_name = path.basename(Path(__file__).parent)
            self.configuration: Dict[str, Any]
            self._owner_address = None
            self._market_definitions: Dict[str, List[str]] = {}
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
            self.balances: Dict[str, Any] = {}
            self._tickers: Dict[str, Any]
            self._open_orders: Dict[str, Any]
            self._filled_orders: Dict[str, Any]
            self.summary = {
                "price": {
                    "expected_price": decimal_zero,
                    "ticker_price": decimal_zero,
                    "last_filled_order_price": decimal_zero,
                    "adjusted_market_price": decimal_zero,
                    "sap": decimal_zero,
                    "wap": decimal_zero,
                    "vwap": decimal_zero,
                    "used_price": decimal_zero
                },
                "balance": {
                    "wallet": {
                        "base": decimal_zero,
                        "quote": decimal_zero
                    },
                    "orders": {
                        "base": {
                            "bids": decimal_zero,
                            "asks": decimal_zero,
                            "total": decimal_zero
                        },
                        "quote": {
                            "bids": decimal_zero,
                            "asks": decimal_zero,
                            "total": decimal_zero
                        },
                    }
                },
                "orders": {
                    "replaced": {},
                    "canceled": {},
                },
                "wallet": {
                    "initial_value": decimal_zero,
                    "previous_value": decimal_zero,
                    "current_value": decimal_zero,
                    "current_initial_pnl": decimal_zero,
                    "current_previous_pnl": decimal_zero
                },
                "token": {
                    "initial_price": decimal_zero,
                    "previous_price": decimal_zero,
                    "current_price": decimal_zero,
                    "current_initial_pnl": decimal_zero,
                    "current_previous_pnl": decimal_zero
                },
                "profit_and_loss": decimal_zero
            }
        finally:
            pass
        #     self._log(DEBUG, """__init__... end""")

    def get_markets_definitions(self):
        return self._market_definitions

    # noinspection PyAttributeOutsideInit
    async def initialize(self, start_command):
        try:
            self._log(DEBUG, """_initialize... start""")

            # noinspection PyUnresolvedReferences
            self.notify_hb_app(f"Starting worker {self.id}...")

            self.configuration = self._load_configuration()

            self.logger().setLevel(self.configuration["logger"].get("level", "INFO"))

            self._market_definitions = self.configuration["markets"]

            await super().initialize(start_command)
            self.initialized = False

            self._connector_id = next(iter(self.configuration["markets"]))

            self._hb_trading_pair = self.configuration["markets"][self._connector_id][0]
            self._market = convert_trading_pair(self._hb_trading_pair)

            split = self._market.split("/")
            self._base_token = split[0]
            self._quote_token = split[1].replace(" (NEW)", "")

            self._owner_address = self.configuration["wallets"][0]

            # noinspection PyTypeChecker
            self._connector: GatewaySOLCLOB = self.connectors[self._connector_id]
            self._gateway: GatewayHttpClient = self._connector.get_gateway_instance()

            self._market_info = await self._get_market()

            await self._auto_create_token_accounts()

            if self.configuration["strategy"]["cancel_all_orders_on_start"]:
                await self.cancel_all_orders()

            await self._settle_funds()

            tick_interval = get_random_choice(self.configuration["strategy"]["tick_interval"])
            waiting_time = calculate_waiting_time(tick_interval)
            self._log(DEBUG, f"""Waiting for {waiting_time}s.""")
            self._refresh_timestamp = waiting_time + self.current_timestamp

            self.initialized = True
        except Exception as exception:
            self._handle_error(exception)
        finally:
            self._log(DEBUG, """_initialize... end""")

    async def on_tick(self):
        if (not self.can_run) or self._is_busy or (self._refresh_timestamp > self.current_timestamp):
            return

        try:
            self._log(DEBUG, """on_tick... start""")

            self._is_busy = True

            # noinspection PyAttributeOutsideInit
            self.configuration = self._load_configuration()

            self.logger().setLevel(self.configuration["logger"].get("level", "INFO"))

            # noinspection PyTypedDict
            self.summary["orders"]["canceled"] = {}

            try:
                await self._settle_funds()
            except Exception as exception:
                self._handle_error(exception)

            await self._get_open_orders(use_cache=False)
            await self._get_filled_orders(use_cache=False)
            balances = await self._get_balances(use_cache=False)
            self.summary["balance"]["wallet"]["base"] = Decimal(balances["balances"][self._base_token])
            self.summary["balance"]["wallet"]["quote"] = Decimal(balances["balances"][self._quote_token])

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

            await self._get_open_orders(use_cache=False)
            await self._get_filled_orders(use_cache=False)
            balances = await self._get_balances(use_cache=False)
            self.summary["balance"]["wallet"]["base"] = Decimal(balances["balances"][self._base_token])
            self.summary["balance"]["wallet"]["quote"] = Decimal(balances["balances"][self._quote_token])

            await self._should_stop_loss()

            self._show_summary()

            if (not self.can_run) and self.configuration["strategy"]["cancel_all_orders_on_stop"]:
                await self.cancel_all_orders()
                await self._settle_funds()
        except Exception as exception:
            self._handle_error(exception)
        finally:
            tick_interval = get_random_choice(self.configuration["strategy"]["tick_interval"])
            waiting_time = calculate_waiting_time(tick_interval)

            # noinspection PyAttributeOutsideInit
            self._refresh_timestamp = waiting_time + self.current_timestamp
            self._is_busy = False

            self._log(DEBUG, f"""Waiting for {waiting_time}s.""")

            self._log(DEBUG, """on_tick... end""")

            if self.configuration["strategy"]["run_only_once"]:
                HummingbotApplication.main_application().stop()

    async def stop(self):
        try:
            self._log(DEBUG, """_stop... start""")

            if self.configuration["strategy"]["cancel_all_orders_on_stop"]:
                await self.cancel_all_orders()
                await self._settle_funds()
        finally:
            self._log(DEBUG, """_stop... end""")

    def _load_configuration(self) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_create_or_load_configuration... start""")

            configuration_filepath = Path(Path.cwd(), "conf", "scripts", self._script_name, "environment",
                                          self.environment, "workers", f"{self.id}.yml")

            if configuration_filepath.exists():
                result = yaml.safe_load(configuration_filepath.read_text())

                return result
            else:
                raise FileNotFoundError(f"""Worker configuration file ({configuration_filepath}) not found.""")
        finally:
            self._log(DEBUG, """_create_or_load_configuration... end""")

    async def _create_proposal(self) -> List[OrderCandidate]:
        try:
            self._log(DEBUG, """_create_proposal... start""")

            order_book = await self._get_order_book()
            bids, asks = parse_order_book(order_book)

            ticker_price = await self._get_market_price()
            try:
                last_filled_order_price = await self._get_last_filled_order_price()
            except Exception as exception:
                self._handle_error(exception)

                last_filled_order_price = decimal_zero

            sap = await self._get_market_mid_price(bids, asks, MiddlePriceStrategy.SAP)
            wap = await self._get_market_mid_price(bids, asks, MiddlePriceStrategy.WAP)
            vwap = await self._get_market_mid_price(bids, asks, MiddlePriceStrategy.VWAP)

            price_strategy = self.configuration["strategy"]["price_strategy"]
            if price_strategy == "ticker":
                used_price = ticker_price
            elif price_strategy == "middle":
                used_price = await self._get_market_mid_price(
                    bids,
                    asks,
                    MiddlePriceStrategy[
                        self.configuration["strategy"].get(
                            "middle_price_strategy",
                            "VWAP"
                        )
                    ]
                )
            elif price_strategy == "last_fill":
                used_price = last_filled_order_price
            else:
                raise ValueError("""Invalid "strategy.middle_price_strategy" configuration value.""")

            if self.configuration["strategy"]["use_adjusted_price"]:
                adjusted_market_price = await self._calculate_adjusted_market_price(used_price, bids, asks)
                used_price = adjusted_market_price
            else:
                adjusted_market_price = decimal_zero

            self.summary["price"]["ticker_price"] = ticker_price
            self.summary["price"]["last_filled_order_price"] = last_filled_order_price
            self.summary["price"]["sap"] = sap
            self.summary["price"]["wap"] = wap
            self.summary["price"]["vwap"] = vwap
            self.summary["price"]["adjusted_market_price"] = adjusted_market_price
            self.summary["price"]["used_price"] = used_price

            if used_price is None or used_price <= decimal_zero:
                raise ValueError(f"Invalid price: {used_price}")

            tick_size = Decimal(self._market_info["tickSize"])
            min_order_size = Decimal(self._market_info["minimumOrderSize"])

            order_id = 1
            proposal = []

            bid_orders = []
            for index, layer in enumerate(self.configuration["strategy"]["layers"], start=1):
                best_ask = Decimal(next(iter(asks), {"price": float_infinity})["price"])
                bid_quantity = int(layer["bid"]["quantity"])
                bid_spread_percentage = Decimal(
                    get_float_or_random_float_in_interval(layer["bid"]["spread_percentage"]))
                bid_market_price = ((100 - bid_spread_percentage) / 100) * min(used_price, best_ask)
                bid_max_liquidity_in_dollars = Decimal(
                    get_float_or_random_float_in_interval(layer["bid"]["max_liquidity_in_dollars"]))
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
            for index, layer in enumerate(self.configuration["strategy"]["layers"], start=1):
                best_bid = Decimal(next(iter(bids), {"price": float_zero})["price"])
                ask_quantity = int(layer["ask"]["quantity"])
                ask_spread_percentage = Decimal(
                    get_float_or_random_float_in_interval(layer["ask"]["spread_percentage"]))
                ask_market_price = ((100 + ask_spread_percentage) / 100) * max(used_price, best_bid)
                ask_max_liquidity_in_dollars = Decimal(
                    get_float_or_random_float_in_interval(layer["ask"]["max_liquidity_in_dollars"]))
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

            return Decimal((await self._get_tickers(use_cache=False))[self._market]["price"])
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
                return calculate_mid_price(bids, asks, strategy)

            try:
                return calculate_mid_price(bids, asks, MiddlePriceStrategy.VWAP)
            except (Exception,):
                try:
                    return calculate_mid_price(bids, asks, MiddlePriceStrategy.WAP)
                except (Exception,):
                    try:
                        return calculate_mid_price(bids, asks, MiddlePriceStrategy.SAP)
                    except (Exception,):
                        return await self._get_market_price()
        finally:
            self._log(DEBUG, """_get_market_mid_price... end""")

    def _calculate_expected_market_price(self, timestamp: int = int(time.time_ns() / 1000000)) -> Decimal:
        """
        E[P(t)]
        """

        try:
            self._log(DEBUG, """_calculate_expected_market_price... start""")

            # (price_end - price_begin) / (timestamp_end - timestamp_begin) = (price - price_begin) / (timestamp - timestamp_begin)
            # price -> (price_end * (timestamp_begin - timestamp) + price_begin * (timestamp - timestamp_end)) / (timestamp_begin - timestamp_end)

            price_begin = Decimal(self.configuration["strategy"]["begin"]["price"])
            price_end = Decimal(self.configuration["strategy"]["end"]["price"])
            timestamp_begin = int(self.configuration["strategy"]["begin"]["timestamp"])
            timestamp_end = int(self.configuration["strategy"]["end"]["timestamp"])

            price = (price_end * (timestamp_begin - timestamp) + price_begin * (timestamp - timestamp_end)) / (
                timestamp_begin - timestamp_end)

            self._log(INFO, f"""expected_market_price: {price}""")

            return price
        finally:
            self._log(DEBUG, """_calculate_expected_market_price... end""")

    def _calculate_expected_inventory_percentage(self, timestamp: int = int(time.time_ns() / 1000000)) -> Decimal:
        """
        E[I(t)]
        """

        try:
            self._log(DEBUG, """_calculate_expected_inventory... start""")

            # (inventory_end - inventory_begin) / (timestamp_end - timestamp_begin) = (inventory - inventory_begin) / (timestamp - timestamp_begin)
            # inventory -> (inventory_end * (timestamp_begin - timestamp) + inventory_begin * (timestamp - timestamp_end)) / (timestamp_begin - timestamp_end)

            inventory_begin = Decimal(self.configuration["strategy"]["begin"]["inventory"]["percentage"])
            inventory_end = Decimal(self.configuration["strategy"]["end"]["inventory"]["percentage"])
            timestamp_begin = int(self.configuration["strategy"]["begin"]["timestamp"])
            timestamp_end = int(self.configuration["strategy"]["end"]["timestamp"])

            inventory = (inventory_end * (timestamp_begin - timestamp) + inventory_begin * (
                timestamp - timestamp_end)) / (timestamp_begin - timestamp_end)

            self._log(INFO, f"""expected_market_inventory_percentage: {inventory}""")

            return inventory
        finally:
            self._log(DEBUG, """_calculate_expected_inventory... end""")

    async def _calculate_adjusted_market_price(self, current_market_price: Decimal, bids, asks) -> Decimal:
        """
        PriceEffect(t) := Abs(ExpectedPrice(t) + (Abs(ExpectedInventory(t) - ActualInventory(t)))^Strictness × log(ExpectedPrice(t))))
        PriceReservation(t) := PriceEffect(t) * Confidence + ExpectedPrice(t) * (1 - Confidence)
        """

        try:
            self._log(DEBUG, """_calculate_adjusted_market_price... start""")

            strictness = Decimal(self.configuration["strategy"]["strictness"])
            confidence = Decimal(self.configuration["strategy"]["confidence"])

            current_timestamp = int(time.time_ns() / 1000000)

            expected_market_price = self._calculate_expected_market_price(current_timestamp)

            self.summary["price"]["expected_price"] = expected_market_price

            balances = await self._get_balances()
            base_value = Decimal(balances["balances"][self._base_token]) * current_market_price
            quote_value = Decimal(balances["balances"][self._quote_token])
            total_value = base_value + quote_value

            current_inventory_rate = base_value / total_value
            expected_inventory_rate = self._calculate_expected_inventory_percentage(current_timestamp) / 100

            market_price_effect = Decimal(math.fabs(expected_market_price + Decimal(
                math.fabs((expected_inventory_rate - current_inventory_rate) ** Decimal(strictness))) * Decimal(
                math.log(current_market_price))))
            market_price_reservation = market_price_effect * Decimal(confidence) + current_market_price * (
                1 - Decimal(confidence))

            self._log(INFO, f"""market_price_reservation: {market_price_reservation}""")

            return market_price_reservation
        finally:
            self._log(DEBUG, """_calculate_adjusted_market_price... end""")

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
                    self.configuration["network"],
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
                    "network": self.configuration["network"],
                    "address": self._owner_address,
                    "token_symbols": []
                }

                self._log(INFO, f"""gateway.solana_get_balances:\nrequest:\n{self._dump(request)}""")

                if use_cache and self.balances is not None:
                    response = self.balances
                else:
                    response = await self._gateway.solana_get_balances(**request)

                    self.summary["balance"]["wallet"]["UNWRAPPED_SOL"] = Decimal(
                        response["balances"].get("UNWRAPPED_SOL", 0))
                    self.summary["balance"]["wallet"]["WRAPPED_SOL"] = Decimal(response["balances"].get("SOL", 0))
                    self.summary["balance"]["wallet"]["ALL_SOL"] = Decimal(response["balances"].get("ALL_SOL", 0))

                    self.balances = {"balances": {}}
                    for (token, balance) in dict(response["balances"]).items():
                        decimal_balance = Decimal(balance)
                        if decimal_balance > decimal_zero:
                            self.balances["balances"][token] = Decimal(balance)

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
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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

    async def _get_tickers(self, use_cache: bool = True) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_get_tickers... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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
                        # "ownerAddress": random_wallet(self._wallets),
                        "side": convert_order_side(candidate.order_side).value[0],
                        "price": float(candidate.price),
                        "amount": float(candidate.amount),
                        "type": SerumOrderType[self.configuration["strategy"].get("serum_order_type", "LIMIT")].value[
                            0],
                        "replaceIfExists": True
                    })

                request = {
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
                    "orders": orders
                }

                self._log(INFO, f"""gateway.clob_post_orders:\nrequest:\n{self._dump(request)}""")

                if len(orders):
                    response = await self._gateway.clob_post_orders(**request)
                else:
                    self._log(WARNING, "No order was defined for placement/replacement. Skipping.", True)
                    response = []

                self.summary["orders"]["replaced"] = response

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
                        "chain": self.configuration["chain"],
                        "network": self.configuration["network"],
                        "connector": self.configuration["connector"],
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

                # noinspection PyTypedDict
                self.summary["orders"]["canceled"] = {**self.summary["orders"]["canceled"], **response}

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
                        "chain": self.configuration["chain"],
                        "network": self.configuration["network"],
                        "connector": self.configuration["connector"],
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

                # noinspection PyTypedDict
                self.summary["orders"]["canceled"] = {**self.summary["orders"]["canceled"], **response}

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_delete_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_cancel_duplicated_and_remaining_orders... end""")

    async def _cancel_bot_orders(self):
        try:
            self._log(DEBUG, """_cancel_bot_orders... start""")

            request = None
            response = None
            try:
                bot_orders_exchange_ids = await self._get_bot_orders_exchange_ids()

                if len(bot_orders_exchange_ids) > 0:
                    request = {
                        "chain": self.configuration["chain"],
                        "network": self.configuration["network"],
                        "connector": self.configuration["connector"],
                        "orders": [{
                            "ids": [],
                            "exchangeIds": bot_orders_exchange_ids,
                            "marketName": self._market,
                            "ownerAddress": self._owner_address,
                        }]
                    }

                    response = await self._gateway.clob_delete_orders(**request)
                else:
                    self._log(INFO, "No order needed to be canceled.")
                    response = []

                # noinspection PyTypedDict
                self.summary["orders"]["canceled"] = {**self.summary["orders"]["canceled"], **response}

                return response
            except Exception as exception:
                response = traceback.format_exc()

                raise exception
            finally:
                self._log(INFO,
                          f"""gateway.clob_delete_orders:\nrequest:\n{self._dump(request)}\nresponse:\n{self._dump(response)}""")
        finally:
            self._log(DEBUG, """_cancel_bot_orders... end""")

    async def cancel_all_orders(self):
        try:
            self._log(DEBUG, """_cancel_all_orders... start""")

            request = None
            response = None
            try:
                request = {
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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

            request = None
            response = None
            try:
                request = {
                    "chain": self.configuration["chain"],
                    "network": self.configuration["network"],
                    "connector": self.configuration["connector"],
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

    async def _get_bot_orders_exchange_ids(self) -> List[str]:
        self._log(DEBUG, """_get_bot_orders_exchange_ids... start""")

        try:
            open_orders = (await self._get_open_orders())[self._market].values()

            bot_orders_exchange_ids = []

            for open_order in open_orders:
                if not (open_order["id"] == "0"):  # Avoid touching manually created orders.
                    bot_orders_exchange_ids.append(open_order["exchangeId"])

            self._log(INFO, f"""bot_orders_exchange_ids:\n{self._dump(bot_orders_exchange_ids)}""")

            return bot_orders_exchange_ids
        finally:
            self._log(DEBUG, """_get_bot_orders_exchange_ids... end""")

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

    async def _get_wallet_value(self):
        try:
            self._log(DEBUG, """_get_wallet_value... start""")

            tickers = await self._get_tickers()
            balances = await self._get_balances()

            open_orders_balance = await self._get_open_orders_balance()

            wallet_value = Decimal(0)

            for token in balances["balances"].keys():
                if token == "SOL" or token == "UNWRAPPED_SOL":
                    continue

                token_balance = Decimal(balances["balances"][token])

                # Here we assume that the valid quotes are only "USDC", "USDT", "soUSDC", and "soUSDT".
                if token in ["USDC", "USDT", "soUSDC", "soUSDT"]:
                    if token == self._quote_token:
                        token_balance += Decimal(open_orders_balance["quote"])
                    wallet_value += token_balance

                    continue

                if token_balance == decimal_zero:
                    continue

                final_token = token
                if token == "ALL_SOL":
                    final_token = "SOL"

                token_price = Decimal(0)
                if f"{final_token}/USDC" in tickers:
                    token_price = tickers[f"{final_token}/USDC"]["price"]
                elif f"{final_token}/USDT" in tickers:
                    token_price = tickers[f"{final_token}/USDT"]["price"]
                elif f"{final_token}/soUSDC" in tickers:
                    token_price = tickers[f"{final_token}/soUSDC"]["price"]
                elif f"{final_token}/soUSDT" in tickers:
                    token_price = tickers[f"{final_token}/soUSDT"]["price"]
                elif f"{final_token}/USDC (NEW)" in tickers:
                    token_price = tickers[f"{final_token}/USDC (NEW)"]["price"]
                elif f"{final_token}/USDT (NEW)" in tickers:
                    token_price = tickers[f"{final_token}/USDT (NEW)"]["price"]
                elif f"{final_token}/soUSDC (NEW)" in tickers:
                    token_price = tickers[f"{final_token}/soUSDC (NEW)"]["price"]
                elif f"{final_token}/soUSDT (NEW)" in tickers:
                    token_price = tickers[f"{final_token}/soUSDT (NEW)"]["price"]

                if final_token == self._base_token:
                    token_balance += Decimal(open_orders_balance["base"])

                token_price = Decimal(token_price)

                wallet_value += token_balance * token_price

            return wallet_value
        finally:
            self._log(DEBUG, """_get_wallet_value... end""")

    async def _should_stop_loss(self):
        try:
            self._log(DEBUG, """_should_stop_loss... start""")

            if self.summary["wallet"]["initial_value"] == decimal_zero:
                self.summary["token"]["initial_price"] = await self._get_market_price()
                self.summary["token"]["previous_price"] = self.summary["token"]["initial_price"]
                self.summary["token"]["current_price"] = self.summary["token"]["initial_price"]

                self.summary["wallet"]["initial_value"] = await self._get_wallet_value()
                self.summary["wallet"]["previous_value"] = self.summary["wallet"]["initial_value"]
                self.summary["wallet"]["current_value"] = self.summary["wallet"]["initial_value"]
            else:
                max_wallet_loss_from_initial_value = round(
                    self.configuration["kill_switch"]["max_wallet_loss_from_initial_value"], 9)
                max_wallet_loss_from_previous_value = round(
                    self.configuration["kill_switch"]["max_wallet_loss_from_previous_value"], 9)
                max_wallet_loss_compared_to_token_variation = round(
                    self.configuration["kill_switch"]["max_wallet_loss_compared_to_token_variation"], 9)
                max_token_loss_from_initial = round(
                    self.configuration["kill_switch"]["max_token_loss_from_initial_price"], 9)

                self.summary["token"]["previous_price"] = self.summary["token"]["current_price"]
                self.summary["token"]["current_price"] = await self._get_market_price()

                open_orders_balance = await self._get_open_orders_balance()
                self.summary["balance"]["orders"]["base"]["bids"] = open_orders_balance["quote"] / \
                                                                    self.summary["token"]["current_price"]
                self.summary["balance"]["orders"]["base"]["asks"] = open_orders_balance["base"]
                self.summary["balance"]["orders"]["base"]["total"] = self.summary["balance"]["orders"]["base"][
                                                                         "bids"] + \
                                                                     self.summary["balance"]["orders"]["base"]["asks"]
                self.summary["balance"]["orders"]["quote"]["bids"] = open_orders_balance["quote"]
                self.summary["balance"]["orders"]["quote"]["asks"] = open_orders_balance["base"] * \
                                                                     self.summary["token"]["current_price"]
                self.summary["balance"]["orders"]["quote"]["total"] = self.summary["balance"]["orders"]["quote"][
                                                                          "bids"] + \
                                                                      self.summary["balance"]["orders"]["quote"][
                                                                          "asks"]

                self.summary["wallet"]["previous_value"] = self.summary["wallet"]["current_value"]
                self.summary["wallet"]["current_value"] = await self._get_wallet_value()

                wallet_previous_initial_pnl = Decimal(round(
                    100 * ((self.summary["wallet"]["previous_value"] / self.summary["wallet"]["initial_value"]) - 1),
                    9))
                wallet_current_initial_pnl = Decimal(round(
                    100 * ((self.summary["wallet"]["current_value"] / self.summary["wallet"]["initial_value"]) - 1),
                    9))
                wallet_current_previous_pnl = Decimal(round(
                    100 * ((self.summary["wallet"]["current_value"] / self.summary["wallet"]["previous_value"]) - 1),
                    9))
                token_previous_initial_pnl = Decimal(round(
                    100 * ((self.summary["token"]["previous_price"] / self.summary["token"]["initial_price"]) - 1),
                    9))
                token_current_initial_pnl = Decimal(round(
                    100 * ((self.summary["token"]["current_price"] / self.summary["token"]["initial_price"]) - 1), 9))
                token_current_previous_pnl = Decimal(round(
                    100 * ((self.summary["token"]["current_price"] / self.summary["token"]["previous_price"]) - 1),
                    9))

                self.summary["wallet"]["previous_initial_pnl"] = wallet_previous_initial_pnl
                self.summary["wallet"]["current_initial_pnl"] = wallet_current_initial_pnl
                self.summary["wallet"]["current_previous_pnl"] = wallet_current_previous_pnl
                self.summary["token"]["previous_initial_pnl"] = token_previous_initial_pnl
                self.summary["token"]["current_initial_pnl"] = token_current_initial_pnl
                self.summary["token"]["current_previous_pnl"] = token_current_previous_pnl

                users = ', '.join(self.configuration["kill_switch"]["notify"]["telegram"]["users"])

                if wallet_current_initial_pnl < 0:
                    if self.configuration["kill_switch"]["max_wallet_loss_from_initial_value"]:
                        if math.fabs(wallet_current_initial_pnl) >= math.fabs(max_wallet_loss_from_initial_value):
                            self._log(CRITICAL,
                                      f"""The bot has been stopped because the wallet lost {-wallet_current_initial_pnl}%, which is at least {max_wallet_loss_from_initial_value}% distant from the wallet initial value.\n/cc {users}""",
                                      True)
                            self.can_run = False

                            return

                    if self.configuration["kill_switch"]["max_wallet_loss_from_previous_value"]:
                        if math.fabs(wallet_current_previous_pnl) >= math.fabs(max_wallet_loss_from_previous_value):
                            self._log(CRITICAL,
                                      f"""The bot has been stopped because the wallet lost {-wallet_current_previous_pnl}%, which is at least {max_wallet_loss_from_previous_value}% distant from the wallet previous value.\n/cc {users}""",
                                      True)
                            self.can_run = False

                            return

                    if self.configuration["kill_switch"]["max_wallet_loss_compared_to_token_variation"]:
                        if math.fabs(wallet_current_initial_pnl - token_current_initial_pnl) >= math.fabs(
                            max_wallet_loss_compared_to_token_variation):
                            self._log(CRITICAL,
                                      f"""The bot has been stopped because the wallet lost {-wallet_current_initial_pnl}%, which is at least {max_wallet_loss_compared_to_token_variation}% distant from the token price variation ({token_current_initial_pnl}) from its initial price.\n/cc {users}""",
                                      True)
                            self.can_run = False

                            return

                if token_current_initial_pnl < 0 and math.fabs(token_current_initial_pnl) >= math.fabs(
                    max_token_loss_from_initial):
                    self._log(CRITICAL,
                              f"""The bot has been stopped because the token lost {-token_current_initial_pnl}%, which is at least {max_token_loss_from_initial}% distant from the token initial price.\n/cc {users}""",
                              True)
                    self.can_run = False

                    return

        finally:
            self._log(DEBUG, """_should_stop_loss... end""")

    async def _get_open_orders_balance(self) -> Dict[str, Decimal]:
        open_orders = await self._get_open_orders()
        open_orders_base_amount = decimal_zero
        open_orders_quote_amount = decimal_zero
        for market in open_orders.values():
            for order in market.values():
                if order['side'] == SerumOrderSide.SELL.value[0]:
                    open_orders_base_amount += Decimal(order["amount"])
                if order['side'] == SerumOrderSide.BUY.value[0]:
                    open_orders_quote_amount += Decimal(order["amount"]) * Decimal(order['price'])

        return {"base": open_orders_base_amount, "quote": open_orders_quote_amount}

    def _show_summary(self):
        replaced_orders_summary = ""
        canceled_orders_summary = ""

        if len(self.summary["orders"]["replaced"]):
            orders: List[Dict[str, Any]] = list(dict(self.summary["orders"]["replaced"]).values())
            orders.sort(key=lambda item: item["price"])

            groups: array[array[str]] = [[], [], [], [], [], [], []]
            for order in orders:
                groups[0].append(str(order["type"]).lower())
                groups[1].append(str(order["side"]).lower())
                # groups[2].append(format_currency(order["amount"], 3))
                groups[2].append(format_currency(order["amount"], 3))
                groups[3].append(self._base_token)
                groups[4].append("by")
                # groups[5].append(format_currency(order["price"], 3))
                groups[5].append(format_currency(order["price"], 3))
                groups[6].append(self._quote_token)

            replaced_orders_summary = format_lines(groups)

        if len(self.summary["orders"]["canceled"]):
            orders: List[Dict[str, Any]] = list(dict(self.summary["orders"]["canceled"]).values())
            orders.sort(key=lambda item: item["price"])

            groups: array[array[str]] = [[], [], [], [], [], []]
            for order in orders:
                groups[0].append(str(order["side"]).lower())
                # groups[1].append(format_currency(order["amount"], 3))
                groups[1].append(format_currency(order["amount"], 3))
                groups[2].append(self._base_token)
                groups[3].append("by")
                # groups[4].append(format_currency(order["price"], 3))
                groups[4].append(format_currency(order["price"], 3))
                groups[5].append(self._quote_token)

            canceled_orders_summary = format_lines(groups)

        self._log(
            INFO,
            textwrap.dedent(
                f"""\
                <b>Market</b>: <b>{self._market}</b>
                <b>PnL</b>: {format_line("", format_percentage(self.summary["wallet"]["current_initial_pnl"]), alignment_column - 4)}
                <b>Wallet</b>:
                {format_line(" Wo:", format_currency(self.summary["wallet"]["initial_value"], 4))}
                {format_line(" Wp:", format_currency(self.summary["wallet"]["previous_value"], 4))}
                {format_line(" Wc:", format_currency(self.summary["wallet"]["current_value"], 4))}
                {format_line(" Wc/Wo:", (format_percentage(self.summary["wallet"]["current_initial_pnl"])))}
                {format_line(" Wc/Wp:", format_percentage(self.summary["wallet"]["current_previous_pnl"]))}
                <b>Token</b>:
                {format_line(" To:", format_currency(self.summary["token"]["initial_price"], 6))}
                {format_line(" Tp:", format_currency(self.summary["token"]["previous_price"], 6))}
                {format_line(" Tc:", format_currency(self.summary["token"]["current_price"], 6))}
                {format_line(" Tc/To:", format_percentage(self.summary["token"]["current_initial_pnl"]))}
                {format_line(" Tc/Tp:", format_percentage(self.summary["token"]["current_previous_pnl"]))}
                <b>Price</b>:
                {format_line(" Used:", format_currency(self.summary["price"]["used_price"], 6))}
                {format_line(" External:", format_currency(self.summary["price"]["ticker_price"], 6))}
                {format_line(" Last fill:", format_currency(self.summary["price"]["last_filled_order_price"], 6))}
                {format_line(" Expected:", format_currency(self.summary["price"]["expected_price"], 6))}
                {format_line(" Adjusted:", format_currency(self.summary["price"]["adjusted_market_price"], 6))}
                {format_line(" SAP:", format_currency(self.summary["price"]["sap"], 6))}
                {format_line(" WAP:", format_currency(self.summary["price"]["wap"], 6))}
                {format_line(" VWAP:", format_currency(self.summary["price"]["vwap"], 6))}
                <b>Balance</b>:
                 <b>Wallet</b>:
                {format_line(f"  {self._base_token}:", format_currency(self.summary["balance"]["wallet"]["base"], 4))}
                {format_line(f"  {self._quote_token}:", format_currency(self.summary["balance"]["wallet"]["quote"], 4))}
                {format_line(f"  W SOL:", format_currency(self.summary["balance"]["wallet"]["WRAPPED_SOL"], 4))}
                {format_line(f"  UW SOL:", format_currency(self.summary["balance"]["wallet"]["UNWRAPPED_SOL"], 4))}
                {format_line(f"  ALL SOL:", format_currency(self.summary["balance"]["wallet"]["ALL_SOL"], 4))}
                 <b>Orders (in {self._quote_token})</b>:
                {format_line(f"  Bids:", format_currency(self.summary["balance"]["orders"]["quote"]["bids"], 4))}
                {format_line(f"  Asks:", format_currency(self.summary["balance"]["orders"]["quote"]["asks"], 4))}
                {format_line(f"  Total:", format_currency(self.summary["balance"]["orders"]["quote"]["total"], 4))}
                <b>Orders</b>:
                {format_line(" Replaced:", str(len(self.summary["orders"]["replaced"])))}
                {format_line(" Canceled:", str(len(self.summary["orders"]["canceled"])))}\
                """
            ),
            True
        )

        if replaced_orders_summary:
            self._log(
                INFO,
                f"""<b>Replaced Orders:</b>\n{replaced_orders_summary}""",
                True
            )

        if canceled_orders_summary:
            self._log(
                INFO,
                f"""<b>Canceled Orders:</b>\n{canceled_orders_summary}""",
                True
            )

    def _log(self, level: int, message: str, use_telegram: bool = False, *args, **kwargs):
        # noinspection PyUnresolvedReferences
        message = f"""{self.id}:\n{message}"""

        self.logger().log(level, message, *args, **kwargs)

        if use_telegram:
            self.notify_hb_app(f"""{message}""")

    def _handle_error(self, exception: Exception):
        if isinstance(exception, asyncio.exceptions.TimeoutError):
            message = f"""<b>ERROR</b>: {type(exception).__name__} {str(exception)}"""
        else:
            users = ', '.join(self.configuration["kill_switch"]["notify"]["telegram"]["users"])
            message = f"""<b>ERROR</b>: {type(exception).__name__} {str(exception)}\n/cc {users}"""

        self._log(ERROR, message, True)

    @staticmethod
    def _dump(target: Any):
        try:
            return jsonpickle.encode(target, unpicklable=True, indent=2)
        except (Exception,):
            return target
