# Docker

## Client

### Creation

Run:

> ./client/create-client.sh

to create a Client instance. Follow the instructions on the screen.

Important: it is needed to be located at the scripts folders, seeing the client folder, otherwise the Dockerfile
will not be able to copy the required files.

### Configuration

From the Hummingbot command line type:

> gateway generate-certs

for creating the certificates. Take note about the passphrase used, it is needed for configuring the Gateway.

## Gateway

### Creation

Run:

> ./gateway/create-gateway.sh

to create a Gateway instance. Follow the instructions on the screen
and enter the same passphrase created when configuring the Client.

Important: it is needed to be located at the scripts folders, seeing the gateway folder, otherwise the Dockerfile
will not be able to copy the required files.

### Configuration

The Gateway will only start properly if the `./shared/common/certs` contains the certificates
and the informed passphrase is the correct one.

## PMM Script

To run the PMM script open the Client and connect the Serum wallet with:

> gateway connect serum

follow the instructions on the screen.

After the wallet configuration check if it is working with:

> balance

You should see the balances of each token you have in your wallet.

After that check if the

> ./shared/client/conf/scripts/pmm.yml

has the approprieate configurations. And if the 

> ./shared/client/scripts/pmm.py

exists in the correspondent folder.

Important: before running the script, check if you have a minimal balance in the two tokens
for the target market. For example, if the market is DUMMY-USDC, it is needed to have a minimal
amount in DUMMY and USDC tokens. This is needed because the Solana library will create a token
account, if they do not exist, for each token.

After that you can start the script as following:

> start --script pmm.py

The PMM script and strategy will start running after that.
It is possible to check the logs on the right side of the Client screen or with:

> tail -f shared/client/logs/* shared/gateway/logs/*
