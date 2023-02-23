import re
from decimal import Decimal
from pathlib import Path

import yaml

from hummingbot import root_path
from hummingbot.connector.hybrid.serum.serum_in_flight_order import SerumOrderState
from hummingbot.core.api_throttler.data_types import RateLimit

# Others constants in clob_constants.py

root_path = root_path()

solana_yml = Path(root_path, "gateway", "conf", "solana.yml")
solana_configuration = yaml.safe_load(solana_yml.read_text())

serum_yml = Path(root_path, "gateway", "conf", "serum.yml")
serum_configuration = yaml.safe_load(serum_yml.read_text())

DOMAIN = "serum"
PING_URL = "localhost"

HBOT_ORDER_ID_PREFIX = ""

# Base URL
REST_URL = solana_configuration["networks"]["mainnet-beta"]["nodeURL"]
WSS_URL = "ws://localhost:8000/v1/ws"   # when running serum-vial on your localhost

WS_HEARTBEAT_TIME_INTERVAL = 30

SIDE_BUY = 'BUY'
SIDE_SELL = 'SELL'

# Rate Limit time intervals
ONE_MINUTE = 60
ONE_SECOND = 1
ONE_DAY = 86400
INFINITY = float(Decimal("infinity"))

MAX_REQUEST = 5000

# Cache
MARKETS_INFORMATION = 3600  # in seconds
MARKETS = 3600  # in seconds

# Orders
FILLED = 1000
CREATE = 8
CANCEL = 25

# Events Limit
CONSUME_EVENTS = 10
MATCH_ORDERS = 10

# Order States <-> serum.types.ts
ORDER_STATE = {
    "OPEN": SerumOrderState.OPEN,
    "CANCELED": SerumOrderState.CANCELED,
    "FILLED": SerumOrderState.FILLED,
    "CREATION_PENDING": SerumOrderState.CREATION_PENDING,
    "CANCELATION_PENDING": SerumOrderState.CANCELATION_PENDING,
    "UNKNOWN": SerumOrderState.UNKNOWN,
}


# Websocket event types
DIFF_EVENT_TYPE = "depthUpdate"
TRADE_EVENT_TYPE = "trade"

# Rate Limit Type
ORDERS = "ORDERS"
RAW_REQUESTS = "RAW_REQUESTS"

# Mainnet Beta Rate Limits <-> https://api.mainnet-beta.solana.com
# https://docs.solana.com/cluster/rpc-endpoints#mainnet-beta
MAXIMUM_REQUESTS_PER_10_SECONDS_PER_IP = 100
MAXIMUM_REQUESTS_PER_10_SECONDS_PER_IP_SINGLE_RPC = 40
MAXIMUM_CONCURRENT_CONNECTIONS_PER_IP = 40
MAXIMUM_CONNECTION_RATE_PER_10_SECONDS_PER_IP = 40
MAXIMUM_AMOUNT_DATA_PER_30_SECOND = 100  # In MB

REQUESTS_PER_10_SECONDS = "REQUESTS_PER_10_SECONDS"
REQUESTS_PER_10_SECONDS_SINGLE_RPC = "REQUESTS_PER_10_SECONDS_SINGLE_RPC"
MAX_CONCURRENT_CONNECTIONS_PER_IP = "MAX_CONCURRENT_CONNECTIONS_PER_IP"
MAX_CONNECTION_RATE_PER_10_SECONDS_PER_IP = "MAX_CONNECTION_RATE_PER_10_SECONDS_PER_IP"
MAX_AMOUNT_DATA_PER_30_SECOND = "MAX_AMOUNT_DATA_PER_30_SECOND"

RATE_LIMITS = [
    RateLimit(
        limit_id=REQUESTS_PER_10_SECONDS,
        limit=MAXIMUM_REQUESTS_PER_10_SECONDS_PER_IP,
        time_interval=ONE_SECOND * 10,
    ),
    RateLimit(
        limit_id=REQUESTS_PER_10_SECONDS_SINGLE_RPC,
        limit=MAXIMUM_REQUESTS_PER_10_SECONDS_PER_IP_SINGLE_RPC,
        time_interval=ONE_SECOND * 10,
    ),
    RateLimit(
        limit_id=MAX_CONCURRENT_CONNECTIONS_PER_IP,
        limit=MAXIMUM_CONCURRENT_CONNECTIONS_PER_IP,
        time_interval=INFINITY,
    ),
    RateLimit(
        limit_id=MAX_CONNECTION_RATE_PER_10_SECONDS_PER_IP,
        limit=MAXIMUM_CONNECTION_RATE_PER_10_SECONDS_PER_IP,
        time_interval=ONE_SECOND * 10,
    ),
    RateLimit(
        limit_id=MAX_AMOUNT_DATA_PER_30_SECOND,
        limit=MAXIMUM_AMOUNT_DATA_PER_30_SECOND,
        time_interval=ONE_SECOND * 30,
    ),
]

# Clob Constants <=> clob_constants.py
POLL_INTERVAL = 1.0
UPDATE_BALANCE_INTERVAL = 30.0
APPROVAL_ORDER_ID_PATTERN = re.compile(r"approve-(\w+)-(\w+)")
ONE_LAMPORT = Decimal('1e-9')
FIVE_THOUSAND_LAMPORTS = 5000 * ONE_LAMPORT
ONE = 1
ZERO = 0
SOL_USDC_MARKET = 'SOL/USDC'

DECIMAL_ZERO = Decimal("0")
DECIMAL_ONE = Decimal("1")
DECIMAL_NaN = Decimal("nan")
DECIMAL_INFINITY = Decimal("infinity")
