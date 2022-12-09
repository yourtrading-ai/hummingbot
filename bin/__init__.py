import atexit
import signal

from hummingbot.client.hummingbot_application import HummingbotApplication


def handle_exit():
    message = "Hummingbot has stopped."
    print(message)
    HummingbotApplication.main_application().notify(message)

atexit.register(handle_exit)
signal.signal(signal.SIGTERM, handle_exit)
signal.signal(signal.SIGINT, handle_exit)
