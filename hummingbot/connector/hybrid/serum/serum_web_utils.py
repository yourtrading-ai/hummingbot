from typing import Callable, List, Optional

import hummingbot.connector.hybrid.serum.serum_constants as constants
from hummingbot.connector.hybrid.serum.serum_utils import convert_trading_pair
from hummingbot.connector.time_synchronizer import TimeSynchronizer
from hummingbot.connector.utils import TimeSynchronizerRESTPreProcessor
from hummingbot.core.api_throttler.async_throttler import AsyncThrottler
from hummingbot.core.web_assistant.web_assistants_factory import WebAssistantsFactory


def public_rest_url(rest_url: str = constants.REST_URL) -> str:
    return rest_url


def private_rest_url(rest_url: str = constants.REST_URL) -> str:
    return rest_url


def build_api_factory(
        throttler: Optional[AsyncThrottler] = None,
        time_synchronizer: Optional[TimeSynchronizer] = None,
        time_provider: Optional[Callable] = None,) -> WebAssistantsFactory:
    throttler = throttler or create_throttler()
    time_synchronizer = time_synchronizer or TimeSynchronizer()
    api_factory = WebAssistantsFactory(
        throttler=throttler,
        rest_pre_processors=[
            TimeSynchronizerRESTPreProcessor(synchronizer=time_synchronizer, time_provider=time_provider),
        ])
    return api_factory


def build_api_factory_without_time_synchronizer_pre_processor(
    throttler: AsyncThrottler
) -> WebAssistantsFactory:
    api_factory = WebAssistantsFactory(throttler=throttler)
    return api_factory


def create_throttler() -> AsyncThrottler:
    return AsyncThrottler(constants.RATE_LIMITS)


def get_symbols_from_markets() -> [str]:
    market_pairs = constants.solana_configuration["markets"]["url"]

    base_symbols: List[str] = []
    quote_symbols: List[str] = []

    for m in market_pairs:
        base_symbols.append(convert_trading_pair(m)["base_currency"])
        quote_symbols.append(convert_trading_pair(m)["quote_currency"])

    unique_base_symbols = set(base_symbols)
    unique_quote_symbols = set(quote_symbols)

    symbols_from_markets = unique_base_symbols.union(unique_quote_symbols)

    return symbols_from_markets
