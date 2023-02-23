from hummingbot.connector.time_synchronizer import TimeSynchronizer


class SerumAuth():
    def __init__(self, private_key: str, time_provider: TimeSynchronizer):
        self.private_key = private_key
        self.time_provider = time_provider
