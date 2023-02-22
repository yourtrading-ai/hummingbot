from ast import literal_eval
from os import path
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    pass


class ScriptCommand:

    def __init__(self):
        super().__init__()

        self.placeholder_mode = False
        self.app["hide_input"] = False

    def handle_script_command(self, raw_command: str) -> bool:
        try:
            split = raw_command.split(" ")
            command = split[0]
            script = split[1]
            path = None

            if len(split) > 2:
                path = split[2]

            if command == "get":
                self._get(script, path)

                return True
            elif command == "set":
                value = split[3]
                self._set(script, path, value)

                return True
            else:
                return False
        except (Exception,):
            self.main_application().notify(f"""Command "{raw_command}" failed.""")

    def _get(self, script: str, path: str):
        self.placeholder_mode = True
        self.app.hide_input = True

        configuration = self._get_script_configuration(script)

        if path:
            split = path.split(".")
            key = configuration
            for piece in split:
                key = key[piece]
            value = key

            self.main_application().notify(f"""{script}/{path} has value: {value}""")
        else:
            script_path = self._get_script_path(script)
            value = script_path.read_text()

            self.main_application().notify(f"""Script {script} configuration:\n--------------------\n{value}""")

        self.placeholder_mode = False
        self.app.hide_input = False

    def _set(self, script: str, path: str, value: any):
        self.placeholder_mode = True
        self.app.hide_input = True

        configuration = self._get_script_configuration(script)

        split = path.split(".")
        key = configuration
        for piece in split[:-1]:
            key = key[piece]

        value = convert_string(value)

        key[split[-1]] = value

        self._save_script_configuration(script, configuration)

        self.main_application().notify(f"""Successfully set {script}/{path} to {value}""")

        self.placeholder_mode = False
        self.app.hide_input = False

    def _get_script_path(self, script) -> Path:
        return Path(Path.cwd(), "conf", "scripts", path.basename(script) + ".yml")

    def _get_script_configuration(self, script) -> dict:
        script_path = self._get_script_path(script)

        if script_path.exists():
            return yaml.safe_load(script_path.read_text())
        else:
            raise IOError(f"""File "{script_path}" does not exist.""")

    def _save_script_configuration(self, script, configuration):
        script_path = self._get_script_path(script)

        with open(script_path, mode="w+") as file:
            file.write(yaml.dump(configuration))


def convert_string(s):
    """
    This function will try to convert a string literal to a number or a bool
    such that '1.0' and '1' will both return 1.

    The point of this is to ensure that '1.0' and '1' return as int(1) and that
    'False' and 'True' are returned as bools not numbers.

    This is useful for generating text that may contain numbers for diff
    purposes.  For example you may want to dump two XML documents to text files
    then do a diff.  In this case you would want <blah value='1.0'/> to match
    <blah value='1'/>.

    The solution for me is to convert the 1.0 to 1 so that diff doesn't see a
    difference.

    If s doesn't evaluate to a literal then s will simply be returned UNLESS the
    literal is a float with no fractional part.  (i.e. 1.0 will become 1)

    If s evaluates to float or a float literal (i.e. '1.1') then a float will be
    returned if and only if the float has no fractional part.

    if s evaluates as a valid literal then the literal will be returned. (e.g.
    '1' will become 1 and 'False' will become False)
    """

    if isinstance(s, str):
        # It's a string.  Does it represnt a literal?
        #
        try:
            val = literal_eval(s)
        except (Exception,):
            # s doesn't represent any sort of literal so no conversion will be
            # done.
            #
            val = s
    else:
        # It's already something other than a string
        #
        val = s

    ##
    # Is the float actually an int? (i.e. is the float 1.0 ?)
    #
    if isinstance(val, float):
        if val.is_integer():
            return int(val)

        # It really is a float
        return val

    return val
