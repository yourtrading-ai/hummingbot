import asyncio
import textwrap
from array import array
from decimal import Decimal
from logging import DEBUG, ERROR, INFO
from os import path
from pathlib import Path
from typing import Any, Dict

import jsonpickle
import yaml

from hummingbot.client.hummingbot_application import HummingbotApplication
from hummingbot.core.clock import Clock
from hummingbot.strategy.script_strategy_base import ScriptStrategyBase

from .utils import (
    alignment_column,
    calculate_waiting_time,
    decimal_zero,
    format_currency,
    format_line,
    format_lines,
    format_percentage,
    get_random_choice,
)
from .worker import Worker


class Orchestrator(ScriptStrategyBase):
    def __init__(self):
        try:
            self._log(DEBUG, """__init__... start""")

            super().__init__()

            self._script_name = path.basename(Path(__file__).parent)
            self._configuration: Dict[str, Any]
            self._environment: str
            self._workers: Dict[str, Worker] = {}
            self._summary: Dict[str, Any] = {}
            self._is_busy: bool = False
            self._refresh_timestamp: int
        finally:
            self._log(DEBUG, """__init__... end""")

    def _load_configuration(self) -> Dict[str, Any]:
        try:
            self._log(DEBUG, """_create_or_load_configuration... start""")

            configuration: Dict[str, Any]

            main_configuration_filepath = Path(Path.cwd(), "conf", "scripts", self._script_name, "main.yml")

            if main_configuration_filepath.exists():
                configuration = yaml.safe_load(main_configuration_filepath.read_text())
            else:
                raise FileNotFoundError(
                    f"""Main orchestrator configuration file ({main_configuration_filepath}) not found.""")

            environment = configuration["environment"]

            environment_configuration_filepath = Path(Path.cwd(), "conf", "scripts", self._script_name, "environment",
                                                      environment, f"{environment}.yml")

            if environment_configuration_filepath.exists():
                configuration = {
                    **configuration,
                    **yaml.safe_load(environment_configuration_filepath.read_text())
                }
            else:
                raise FileNotFoundError(
                    f"""Orchestrator {environment} configuration file ({environment_configuration_filepath}) not found.""")

            return configuration
        finally:
            self._log(DEBUG, """_create_or_load_configuration... end""")

    async def initialize(self, start_command):
        try:
            self._log(DEBUG, """_initialize... start""")

            # noinspection PyAttributeOutsideInit
            self._configuration = self._load_configuration()
            # noinspection PyAttributeOutsideInit
            self._environment = self._configuration["environment"]

            # noinspection PyAttributeOutsideInit
            self._workers = {}
            for strategy in self._configuration["workers"]:
                worker = Worker()
                self._workers[strategy] = worker
                worker.id = strategy
                worker.environment = self._environment

                while not worker.initialized:
                    try:
                        await worker.initialize(start_command)
                    except Exception as exception:
                        self._handle_error(exception)

                self._summary["worker"] = {}
                self._summary["worker"][worker.id] = worker.summary

            tick_interval = get_random_choice(self._configuration["strategy"]["tick_interval"])
            waiting_time = calculate_waiting_time(tick_interval)
            self._log(DEBUG, f"""Waiting for {waiting_time}s.""")
            self._refresh_timestamp = waiting_time + self.current_timestamp
        except Exception as exception:
            self._handle_error(exception)

            HummingbotApplication.main_application().stop()
        finally:
            self._log(DEBUG, """_initialize... start""")

    async def on_tick(self):
        try:
            self._log(DEBUG, """on_tick... start""")

            for worker in self._workers.values():
                try:
                    # noinspection PyUnresolvedReferences
                    self._log(DEBUG, f"""worker {worker.id}... start""")

                    asyncio.ensure_future(self._handle_worker_tick(worker))
                except Exception as exception:
                    self._handle_error(exception)
                finally:
                    # noinspection PyUnresolvedReferences
                    self._log(DEBUG, f"""worker {worker.id}... end""")

            if self._is_busy or (self._refresh_timestamp > self.current_timestamp):
                return

            try:
                self._is_busy = True
                self._calculate_global_summary()
                self._show_summary()
            except Exception as exception:
                self._handle_error(exception)
            finally:
                tick_interval = get_random_choice(self._configuration["strategy"]["tick_interval"])
                waiting_time = calculate_waiting_time(tick_interval)
                self._log(DEBUG, f"""Waiting for {waiting_time}s.""")
                self._refresh_timestamp = waiting_time + self.current_timestamp
                self._is_busy = False
        finally:
            self._log(DEBUG, """on_tick... end""")

    def stop(self, clock: Clock):
        try:
            self._log(DEBUG, """stop... start""")

            for worker in self._workers.values():
                try:
                    # noinspection PyUnresolvedReferences
                    self._log(DEBUG, f"""stopping worker {worker.id}... start""")

                    asyncio.get_event_loop().run_until_complete(self._handle_worker_stop(worker))
                except Exception as exception:
                    self._handle_error(exception)
                finally:
                    # noinspection PyUnresolvedReferences
                    self._log(DEBUG, f"""stopping worker {worker.id}... end""")

            super().stop(clock)
        finally:
            self._log(DEBUG, """stop... end""")

    async def _handle_worker_tick(self, worker: Worker):
        self._log(DEBUG, """_handle_worker_tick... start""")

        await worker.on_tick()
        # noinspection PyUnresolvedReferences
        self._summary["worker"][worker.id] = worker.summary

        self._log(DEBUG, """_handle_worker_tick... end""")

    async def _handle_worker_stop(self, worker: Worker):
        self._log(DEBUG, """_handle_worker_stop... start""")

        worker.can_run = False
        await worker.stop()

        self._log(DEBUG, """_handle_worker_stop... end""")

    def _calculate_global_summary(self):
        self._summary["global"] = {}
        self._summary["global"]["balances"] = {}
        self._summary["global"]["wallet"] = {}
        self._summary["global"]["wallet"]["initial_value"] = decimal_zero
        self._summary["global"]["wallet"]["previous_value"] = decimal_zero
        self._summary["global"]["wallet"]["current_value"] = decimal_zero

        for (id, summary) in dict(self._summary["worker"]).items():
            self._summary["global"]["wallet"]["initial_value"] += summary["wallet"]["initial_value"]
            self._summary["global"]["wallet"]["previous_value"] += summary["wallet"]["previous_value"]
            self._summary["global"]["wallet"]["current_value"] += summary["wallet"]["current_value"]

            worker = self._workers[id]

            if "balances" in worker.balances:
                for token, balance in worker.balances["balances"].items():
                    if token not in self._summary["global"]["balances"]:
                        self._summary["global"]["balances"][token] = Decimal(balance)
                    else:
                        self._summary["global"]["balances"][token] += Decimal(balance)

        self._summary["global"]["wallet"]["current_initial_pnl"] = \
            Decimal(
                round(
                    100 * ((self._summary["global"]["wallet"]["current_value"] / self._summary["global"]["wallet"][
                        "initial_value"]) - 1),
                    9
                )
            ) \
                if self._summary["global"]["wallet"]["initial_value"] > 0 \
                else decimal_zero

        self._summary["global"]["wallet"]["current_previous_pnl"] = \
            Decimal(
                round(
                    100 * ((self._summary["global"]["wallet"]["current_value"] / self._summary["global"]["wallet"][
                        "previous_value"]) - 1),
                    9
                )
            ) \
                if self._summary["global"]["wallet"]["previous_value"] > 0 \
                else decimal_zero

    def _show_summary(self):
        if len(self._summary["global"]["balances"]):
            groups: array[array[str]] = [[], []]
            for (token, balance) in dict(self._summary["global"]["balances"]).items():
                groups[0].append(token)
                # groups[1].append(format_currency(balance, 4))
                groups[1].append(format_currency(balance, 4))

            balances_summary = format_lines(groups, align="left")
        else:
            balances_summary = ""

        self._log(
            INFO,
            textwrap.dedent(
                f"""\
                <b>GLOBAL</b>
                <b>PnL</b>: {format_line("", format_percentage(self._summary["global"]["wallet"]["current_initial_pnl"]), alignment_column - 4)}
                <b>Wallet</b>:
                {format_line(" Wo:", format_currency(self._summary["global"]["wallet"]["initial_value"], 4))}
                {format_line(" Wp:", format_currency(self._summary["global"]["wallet"]["previous_value"], 4))}
                {format_line(" Wc:", format_currency(self._summary["global"]["wallet"]["current_value"], 4))}
                {format_line(" Wc/Wo:", (format_percentage(self._summary["global"]["wallet"]["current_initial_pnl"])))}
                {format_line(" Wc/Wp:", format_percentage(self._summary["global"]["wallet"]["current_previous_pnl"]))}\
                """
            ),
            True
        )

        if balances_summary:
            self._log(
                INFO,
                f"""<b>Balances:</b>\n{balances_summary}""",
                True
            )

    def _log(self, level: int, message: str, use_telegram: bool = False, *args, **kwargs):
        self.logger().log(level, message, *args, **kwargs)

        if use_telegram:
            self.notify_hb_app(f"""{message}""")

    def _handle_error(self, exception: Exception):
        if isinstance(exception, asyncio.exceptions.TimeoutError):
            message = f"""<b>ERROR</b>: {type(exception).__name__} {str(exception)}"""
        else:
            users = ', '.join(self._configuration["kill_switch"]["notify"]["telegram"]["users"])
            message = f"""<b>ERROR</b>: {type(exception).__name__} {str(exception)}\n/cc {users}"""

        self._log(ERROR, message, True)

    @staticmethod
    def _dump(target: Any):
        try:
            return jsonpickle.encode(target, unpicklable=True, indent=2)
        except (Exception,):
            return target
