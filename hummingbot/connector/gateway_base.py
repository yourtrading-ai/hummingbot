import asyncio
import copy
import json
import logging
import ssl
import time
from decimal import Decimal
from typing import Dict, Any, List, Optional, Union

import aiohttp
from hummingbot.connector.connector_base import ConnectorBase, global_config_map
from hummingbot.connector.in_flight_order_base import InFlightOrderBase
from hummingbot.core.data_type.limit_order import LimitOrder
from hummingbot.core.network_iterator import NetworkStatus

from hummingbot.client.settings import GATEAWAY_CA_CERT_PATH, GATEAWAY_CLIENT_CERT_PATH, GATEAWAY_CLIENT_KEY_PATH
from hummingbot.core.api_throttler.async_throttler import AsyncThrottler
from hummingbot.core.utils.async_utils import safe_ensure_future
from hummingbot.logger import HummingbotLogger
from hummingbot.logger.struct_logger import METRICS_LOG_LEVEL

s_logger = None
s_decimal_0 = Decimal("0")
s_decimal_NaN = Decimal("nan")
logging.basicConfig(level=METRICS_LOG_LEVEL)


GATEWAY_BASE_URL = f"https://{global_config_map['gateway_api_host'].value}:"\
                   f"{global_config_map['gateway_api_port'].value}"


class GatewayBase(ConnectorBase):
    """
    Defines basic functions common to connectors that interact with DEXes through Gateway.
    """

    _gateway_connector: aiohttp.TCPConnector

    API_CALL_TIMEOUT = 10.0
    POLL_INTERVAL = 1.0
    UPDATE_BALANCE_INTERVAL = 30.0

    @classmethod
    def logger(cls) -> HummingbotLogger:
        global s_logger
        if s_logger is None:
            s_logger = logging.getLogger(cls.__name__)
        return s_logger

    @classmethod
    def get_client(cls) -> aiohttp.ClientSession:
        if cls._gateway_connector is None:
            ssl_ctx = ssl.create_default_context(cafile=GATEAWAY_CA_CERT_PATH)
            ssl_ctx.load_cert_chain(GATEAWAY_CLIENT_CERT_PATH, GATEAWAY_CLIENT_KEY_PATH)
            cls._gateway_connector = aiohttp.TCPConnector(ssl_context=ssl_ctx)
        return aiohttp.ClientSession(connector=cls._gateway_connector)

    @classmethod
    def gateway_url(cls, path_url: str):
        return f"{GATEWAY_BASE_URL}/{path_url}"

    @classmethod
    async def api_request(cls,
                          method: str,
                          path_url: str,
                          params: Dict[str, Any] = None,
                          throttler: Optional[AsyncThrottler] = None) -> Union[List, Dict[str, Any]]:
        url = cls.gateway_url(path_url)
        method = method.upper()
        async with cls.get_client() as client:
            async with throttler.execute_task(limit_id=path_url):
                if method == "GET":
                    response = await client.get(url, params=params)
                elif method == "POST":
                    response = await client.post(url, params=params)
                elif method == "PUT":
                    response = await client.put(url, params=params)
                elif method == "DELETE":
                    response = await client.delete(url, params=params)
                return await cls._parse_response(response, url)

    @classmethod
    async def add_wallet(cls, private_key: str = None, chain: str = None, network: str = None):
        if chain is None or network is None or private_key is None:
            raise ValueError(f"Missing parameters: private_key = {private_key}, chain = {chain}, network = {network}")
        await cls.api_request("POST", "wallet/add", {
            'chain': chain,  # self.name,
            'network': network,  # global_config_map[f'{self.name}_chain_name'],
            'privateKey': private_key,  # self.private_key
        })

    @classmethod
    async def get_wallets(cls) -> List[Dict[str, str]]:
        """
        Returns a list of objects containing:
        {
            chain: str  // name of the chain the wallets belong to
            walletAddresses: List[str]  // all stored wallets' public keys
        }
        """
        return await cls.api_request("GET", "wallet/")

    @classmethod
    async def _parse_response(cls, response: aiohttp.ClientResponse, url: str) -> Union[List, Dict[str, Any]]:
        parsed_response = json.loads(await response.text())
        if response.status != 200:
            err_msg = ""
            if "error" in parsed_response:
                err_msg = f" Message: {parsed_response['error']}"
            elif "message" in parsed_response:
                err_msg = f" Message: {parsed_response['message']}"
            raise IOError(f"Error fetching data from {url}. HTTP status is {response.status}.{err_msg}")
        if "error" in parsed_response:
            raise Exception(f"Error: {parsed_response['error']} {parsed_response['message']}")
        return parsed_response

    def __init__(self,
                 trading_pairs: List[str],
                 trading_required: bool = True
                 ):
        """
        :param trading_pairs: a list of trading pairs
        :param trading_required: Whether actual trading is needed. Useful for some functionalities or commands like the balance command
        """
        super().__init__()
        self._trading_pairs = trading_pairs
        self._tokens = set()
        for trading_pair in trading_pairs:
            self._tokens.update(set(trading_pair.split("-")))
        self._trading_required = trading_required
        self._ev_loop = asyncio.get_event_loop()
        self._shared_client = None
        self._last_poll_timestamp = 0.0
        self._last_balance_poll_timestamp = time.time()
        self._in_flight_orders = {}
        self._chain_info = {}
        self._status_polling_task = None
        self._init_task = None
        self._get_chain_info_task = None
        self._poll_notifier = None

    @property
    def name(self):
        """
        This should be overwritten to return the appropriate name of new connector when inherited.
        """
        return "GatewayServer"

    @property
    def network_base_path(self):
        raise NotImplementedError

    @property
    def base_path(self):
        raise NotImplementedError

    @property
    def private_key(self):
        raise NotImplementedError

    @property
    def public_key(self):
        raise NotImplementedError

    async def init(self):
        """
        Function to prepare the wallet, which was connected. For Ethereum this might include approving allowances,
        for Solana the initialization of token accounts. If finished, should set self.ready = True.
        """
        raise NotImplementedError

    @property
    def ready(self):
        raise NotImplementedError

    @property
    def amm_orders(self) -> List[InFlightOrderBase]:
        return [
            in_flight_order
            for in_flight_order in self._in_flight_orders.values() if
            in_flight_order.client_order_id.split("_")[0] != "approve"
        ]

    @property
    def limit_orders(self) -> List[LimitOrder]:
        return [
            in_flight_order.to_limit_order()
            for in_flight_order in self.amm_orders
        ]

    async def get_chain_info(self):
        """
        Calls the base endpoint of the connector on Gateway to know basic info about chain being used.
        """
        try:
            resp = await self._api_request("get", f"{self.base_path}/")
            if bool(str(resp["success"])):
                self._chain_info = resp
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger().network(
                "Error fetching chain info",
                exc_info=True,
                app_warning_msg=str(e)
            )

    async def get_gateway_status(self):
        """
        Calls the status endpoint on Gateway to know basic info about connected networks.
        """
        try:
            return await self._api_request("get", "/status")
        except Exception as e:
            self.logger().network(
                "Error fetching gateway status info",
                exc_info=True,
                app_warning_msg=str(e)
            )

    def start_tracking_order(self, *args, **kwargs):
        """
        Starts tracking an order by simply adding it into _in_flight_orders dictionary.
        """
        raise NotImplementedError

    def stop_tracking_order(self, order_id: str):
        """
        Stops tracking an order by simply removing it from _in_flight_orders dictionary.
        """
        if order_id in self._in_flight_orders:
            del self._in_flight_orders[order_id]

    async def start_network(self):
        if self._trading_required:
            self._status_polling_task = safe_ensure_future(self._status_polling_loop())
            self._init_task = safe_ensure_future(self.init())

    async def stop_network(self):
        if self._status_polling_task is not None:
            self._status_polling_task.cancel()
            self._status_polling_task = None
        if self._init_task is not None:
            self._init_task.cancel()
            self._init_task = None
        if self._get_chain_info_task is not None:
            self._get_chain_info_task.cancel()
            self._get_chain_info_task = None

    async def check_network(self) -> NetworkStatus:
        try:
            response = await self._api_request("get", "")
            if response.get('message', None) == 'ok' or response.get('status', None) == 'ok':
                pass
            else:
                raise Exception(f"Error connecting to Gateway API. Response is {response}.")
        except asyncio.CancelledError:
            raise
        except Exception:
            return NetworkStatus.NOT_CONNECTED
        return NetworkStatus.CONNECTED

    def tick(self, timestamp: float):
        """
        Is called automatically by the clock for each clock's tick (1 second by default).
        It checks if status polling task is due for execution.
        """
        if time.time() - self._last_poll_timestamp > self.POLL_INTERVAL:
            if self._poll_notifier is not None and not self._poll_notifier.is_set():
                self._poll_notifier.set()

    async def _update(self):
        """Async function to query all independent endpoints, like balances, approvals and order status."""
        raise NotImplementedError

    async def _status_polling_loop(self):
        await self._update_balances(on_interval=False)
        while True:
            try:
                self._poll_notifier = asyncio.Event()
                await self._poll_notifier.wait()
                await self._update()
                self._last_poll_timestamp = self.current_timestamp
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.logger().error(str(e), exc_info=True)
                self.logger().network("Unexpected error while fetching account updates.",
                                      exc_info=True,
                                      app_warning_msg="Could not fetch balances from Gateway API.")

    async def _update_balances(self, on_interval=False):
        """
        Calls Gateway API to update total and available balances.
        """
        last_tick = self._last_balance_poll_timestamp
        current_tick = self.current_timestamp
        if not on_interval or (current_tick - last_tick) > self.UPDATE_BALANCE_INTERVAL:
            self._last_balance_poll_timestamp = current_tick
            local_asset_names = set(self._account_balances.keys())
            remote_asset_names = set()
            resp_json = await self._api_request("post", f"{self.network_base_path}/balances",
                                                {
                                                    "tokenSymbols": list(self._tokens)
                                                })
            for token, bal in resp_json["balances"].items():
                self._account_available_balances[token] = Decimal(str(bal))
                self._account_balances[token] = Decimal(str(bal))
                remote_asset_names.add(token)

            asset_names_to_remove = local_asset_names.difference(remote_asset_names)
            for asset_name in asset_names_to_remove:
                del self._account_available_balances[asset_name]
                del self._account_balances[asset_name]

            self._in_flight_orders_snapshot = {k: copy.copy(v) for k, v in self._in_flight_orders.items()}
            self._in_flight_orders_snapshot_timestamp = self.current_timestamp

    async def _api_request(self,
                           method: str,
                           path_url: str,
                           params: Dict[str, Any] = {},
                           throttler: Optional[AsyncThrottler] = None) -> Dict[str, Any]:
        """
        Sends an aiohttp request and waits for a response.
        :param method: The HTTP method, e.g. get or post
        :param path_url: The path url or the API end point
        :param params: A dictionary of required params for the end point
        :returns A response in json format.
        """
        params['address'] = self.public_key
        return await self.api_request(method, path_url, params, throttler)

    @property
    def in_flight_orders(self) -> Dict[str, InFlightOrderBase]:
        return self._in_flight_orders
