import math
import random
import time
from array import array
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Union

import numpy as np

from hummingbot.connector.gateway.clob.clob_types import OrderSide

vwap_threshold = 50
int_zero = int(0)
float_zero = float(0)
float_infinity = float('inf')
decimal_zero = Decimal(0)
decimal_infinity = Decimal("Infinity")
alignment_column = 11


class MiddlePriceStrategy(Enum):
    SAP = 'SIMPLE_AVERAGE_PRICE'
    WAP = 'WEIGHTED_AVERAGE_PRICE'
    VWAP = 'VOLUME_WEIGHTED_AVERAGE_PRICE'


def parse_order_book(orderbook: Dict[str, Any]) -> List[Union[List[Dict[str, Any]], List[Dict[str, Any]]]]:
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


def split_percentage(bids: [Dict[str, Any]], asks: [Dict[str, Any]]) -> List[Any]:
    asks = asks[:math.ceil((vwap_threshold / 100) * len(asks))]
    bids = bids[:math.ceil((vwap_threshold / 100) * len(bids))]

    return [bids, asks]


def compute_volume_weighted_average_price(book: [Dict[str, Any]]) -> np.array:
    prices = [order['price'] for order in book]
    amounts = [order['amount'] for order in book]

    prices = np.array(prices)
    amounts = np.array(amounts)

    vwap = (np.cumsum(amounts * prices) / np.cumsum(amounts))

    return vwap


def remove_outliers(order_book: [Dict[str, Any]], side: OrderSide) -> [Dict[str, Any]]:
    prices = [order['price'] for order in order_book]

    q75, q25 = np.percentile(prices, [75, 25])

    # https://www.askpython.com/python/examples/detection-removal-outliers-in-python
    # intr_qr = q75-q25
    # max_threshold = q75+(1.5*intr_qr)
    # min_threshold = q75-(1.5*intr_qr) # Error: Sometimes this function assigns negative value for min

    max_threshold = q75 * 1.5
    min_threshold = q25 * 0.5

    orders = []
    if side == OrderSide.SELL:
        orders = [order for order in order_book if order['price'] < max_threshold]
    elif side == OrderSide.BUY:
        orders = [order for order in order_book if order['price'] > min_threshold]

    return orders


def calculate_mid_price(bids: [Dict[str, Any]], asks: [Dict[str, Any]], strategy: MiddlePriceStrategy) -> Decimal:
    if strategy == MiddlePriceStrategy.SAP:
        bid_prices = [item['price'] for item in bids]
        ask_prices = [item['price'] for item in asks]

        best_ask_price = 0
        best_bid_price = 0

        if len(ask_prices) > 0:
            best_ask_price = min(ask_prices)

        if len(bid_prices) > 0:
            best_bid_price = max(bid_prices)

        return Decimal((best_ask_price + best_bid_price) / 2.0)
    elif strategy == MiddlePriceStrategy.WAP:
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
            return decimal_zero
    elif strategy == MiddlePriceStrategy.VWAP:
        bids, asks = split_percentage(bids, asks)

        if len(bids) > 0:
            bids = remove_outliers(bids, OrderSide.BUY)

        if len(asks) > 0:
            asks = remove_outliers(asks, OrderSide.SELL)

        book = [*bids, *asks]

        if len(book) > 0:
            vwap = compute_volume_weighted_average_price(book)

            return Decimal(vwap[-1])
        else:
            return decimal_zero
    else:
        raise ValueError(f'Unrecognized mid price strategy "{strategy}".')


def format_line(left, right, column=alignment_column):
    right = str(right) if str(right).startswith("-") else f" {str(right)}"

    return f"""<code>{left}{" " * (column - len(left))}{right}</code>"""


def format_currency(target: Decimal, precision: int) -> str:
    return ("{:0,." + str(precision) + "f}").format(round(target, precision))


def format_percentage(target: Decimal, precision: int = 2) -> str:
    decimal_near_zero = Decimal("0E-2")

    value = round(target, precision)
    if math.isclose(value, decimal_zero, rel_tol=decimal_near_zero, abs_tol=decimal_near_zero):
        return f"{math.fabs(value)}%"
    elif target < 0:
        return f"{value}% 🔴"
    else:
        return f"{value}% 🟢"


def format_lines(groups: List[List[str]], align: str = "right") -> str:
    lines: array[str] = [""] * len(groups[0])
    for items in groups:
        length = len(max(items, key=lambda i: len(i)))

        for index, item in enumerate(items):
            if align == "left":
                lines[index] += f"""{item}{" " * (length - len(item))} """
            elif align == "right":
                lines[index] += f"""{" " * (length - len(item))}{item} """
            else:
                raise ValueError(f"""Align option "{align}" not recognized.""")

    for line in range(len(lines)):
        lines[line] = f"""<code>{lines[line].rstrip(" ")}</code>"""

    return "\n".join(lines)


def is_int(value: int) -> bool:
    return isinstance(value, int)


def is_float(value: float) -> bool:
    return isinstance(value, float)


def is_list_of_floats(items: List[any]) -> bool:
    for item in items:
        if not is_float(item):
            return False

    return True


def is_number(value: any) -> bool:
    return isinstance(value, (int, float))


def is_list_of_numbers(items: List[any]) -> bool:
    for item in items:
        if not is_number(item):
            return False

    return True


def is_list(value: any) -> bool:
    return type(value) is list


def is_valid_interval(interval: List) -> bool:
    return interval is not None \
        and len(interval) == 2 \
        and is_number(interval[0]) \
        and is_number(interval[1]) \
        and interval[0] <= interval[1]


def is_valid_non_negative_interval(interval: List) -> bool:
    return interval is not None \
        and len(interval) == 2 \
        and is_number(interval[0]) \
        and is_number(interval[1]) \
        and interval[0] >= 0 \
        and interval[1] >= 0 \
        and interval[0] <= interval[1]


def get_int_or_random_int_in_interval(target: any) -> int:
    return int(get_float_or_random_float_in_interval(target))


def get_float_or_random_float_in_interval(target: any) -> float:
    if is_number(target):
        return target
    elif is_valid_interval(target):
        return random.uniform(target[0], target[1])
    else:
        raise ValueError(f"Invalid number or interval: {target}")


def get_random_choice(items: List[any]) -> any:
    chosen = random.randint(0, len(items) - 1)

    return items[chosen]


def calculate_waiting_time(number: int) -> int:
    current_timestamp_in_milliseconds = int(time.time() * 1000)
    result = number - (current_timestamp_in_milliseconds % number)

    return result


def redefine_precision(number: Decimal, decimal_place: int) -> str:
    integer_part = int(number)
    length_integer_part = len(str(integer_part))
    precision = decimal_place
    if length_integer_part == 1:
        return ("{:0,." + str(precision) + "f}").format(round(number, precision))
    elif length_integer_part <= 3:
        precision -= (length_integer_part - 1)
        return ("{:0,." + str(precision) + "f}").format(round(number, precision))
    elif length_integer_part == 4:
        precision -= length_integer_part
        return ("{:0,." + str(precision) + "f}").format(number).replace(",", "")
    else:
        return "{:.1e}".format(number)
