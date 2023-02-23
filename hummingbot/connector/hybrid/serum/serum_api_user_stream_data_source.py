import asyncio
from typing import TYPE_CHECKING, List, Optional

# from hummingbot.connector.hybrid.serum import serum_constants as CONSTANTS, serum_web_utils as web_utils
from hummingbot.core.data_type.user_stream_tracker_data_source import UserStreamTrackerDataSource

# from hummingbot.core.utils.async_utils import safe_ensure_future
# from hummingbot.core.web_assistant.connections.data_types import RESTMethod
from hummingbot.core.web_assistant.web_assistants_factory import WebAssistantsFactory
from hummingbot.core.web_assistant.ws_assistant import WSAssistant
from hummingbot.logger import HummingbotLogger

if TYPE_CHECKING:
    from hummingbot.connector.hybrid.serum.serum_hybrid import SerumHybrid


class SerumAPIUserStreamDataSource(UserStreamTrackerDataSource):

    LISTEN_KEY_KEEP_ALIVE_INTERVAL = 1800  # Recommended to Ping/Update listen key to keep connection alive
    HEARTBEAT_TIME_INTERVAL = 30.0

    _logger: Optional[HummingbotLogger] = None

    def __init__(self,
                 # auth: SerumAuth,
                 trading_pairs: List[str],
                 connector: 'SerumHybrid',
                 api_factory: WebAssistantsFactory,
                 domain: str = ""):
        super().__init__()
        # self._auth: SerumAuth = auth
        self._current_listen_key = None
        self._domain = domain
        self._api_factory = api_factory

        self._listen_key_initialized_event: asyncio.Event = asyncio.Event()
        self._last_listen_key_ping_ts = 0

    async def _connected_websocket_assistant(self) -> WSAssistant:
        pass

    async def _subscribe_channels(self, websocket_assistant: WSAssistant):
        pass
