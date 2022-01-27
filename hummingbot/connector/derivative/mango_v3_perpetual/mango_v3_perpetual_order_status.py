from enum import Enum


class MangoV3PerpetualOrderStatus(Enum):
    PENDING = 0
    active = 100
    OPEN = 101
    done = 300
    FILLED = 301
    failed = 400
    UNKNOWN = 500
    expired = 501
    CANCELED = 502

    def __ge__(self, other):
        if self.__class__ is other.__class__:
            return self.value >= other.value
        return NotImplemented

    def __gt__(self, other):
        if self.__class__ is other.__class__:
            return self.value > other.value
        return NotImplemented

    def __le__(self, other):
        if self.__class__ is other.__class__:
            return self.value <= other.value
        return NotImplemented

    def __lt__(self, other):
        if self.__class__ is other.__class__:
            return self.value < other.value
        return NotImplemented
