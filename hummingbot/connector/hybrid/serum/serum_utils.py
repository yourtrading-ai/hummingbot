# from typing import List
from pydantic import Field, SecretStr

import hummingbot.connector.hybrid.serum.serum_constants as constants
from hummingbot.client.config.config_data_types import BaseConnectorConfigMap, ClientFieldData
from hummingbot.core.data_type.trade_fee import SolanaTradeFeeSchema

CENTRALIZED = False
EXAMPLE_PAIR = "SOL-USDC"

DEFAULT_FEES = SolanaTradeFeeSchema()  # Empty for default values


class SerumDEXConfigMap(BaseConnectorConfigMap):

    network = constants.REST_URL

    connector: str = Field(default="serum", const=True, client_data=None)

    private_key: SecretStr = Field(
        default=...,
        client_data=ClientFieldData(
            prompt=lambda cm: "Enter your wallet private key (Base58) >>> ",
            prompt_on_new=True,
            is_secure=True,
            is_connect_key=False
        )
    )

    class Config:
        title = "Serum DEX"


def convert_trading_pair(trading_pair: str) -> [str]:
    base_currency = trading_pair.split('-')[0]
    quote_currency = trading_pair.split('-')[1]

    return [base_currency, quote_currency]


# def convert_trading_pairs(hummingbot_trading_pairs: List[str]) -> List[str]:
#     return [convert_trading_pair(trading_pair) for trading_pair in hummingbot_trading_pairs]


KEYS = SerumDEXConfigMap.construct()
