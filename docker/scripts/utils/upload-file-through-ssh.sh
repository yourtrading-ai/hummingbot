import asyncio
import os
from pathlib import Path

import nest_asyncio
import paramiko
import yaml


nest_asyncio.apply()
hostname = "<hostname>"
username = "<username>"
known_hosts = os.path.expanduser(os.path.join("~", ".ssh", "known_hosts"))
private_key_path = os.path.expanduser(os.path.join("~", ".ssh", "<private ssh key>"))
local_path = "/<local folder>/source.txt"
remote_path = "/<remote folder>/destination.txt"


async def main():
    ssh = paramiko.SSHClient(known_hosts)
    try:
        ssh.load_host_keys()
        ssh.connect(hostname, username=username, key_filename=private_key_path)
        sftp = ssh.open_sftp()
        try:
            sftp.get(remote_path, local_path)

            configuration = load_configuration(local_path)

            configuration = await heavy_computation(configuration)

            save_configuration(local_path, configuration)

            sftp.put(local_path, remote_path)
        finally:
            sftp.close()
    finally:
        ssh.close()


async def heavy_computation(configuration: dict) -> dict:
    return configuration


def load_configuration(filepath: str) -> dict:
    path = Path(filepath)

    if path.exists():
        result = yaml.safe_load(path.read_text())

        return result


def save_configuration(filepath: str, configuration: dict):
    path = Path(filepath)
    with open(path, mode="w+") as file:
        file.write(yaml.dump(configuration))


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(main())
