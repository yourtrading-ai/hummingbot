import { Account } from '@solana/web3.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import BN from 'bn.js';
import 'jest-extended';
import { Solana } from '../../../src/chains/solana/solana';
import { Serum } from '../../../src/connectors/serum/serum';
import { sleep } from '../../../src/connectors/serum/serum.helpers';
import { IMap, Market } from '../../../src/connectors/serum/serum.types';
import { default as config } from '../../../test/chains/solana/serum/fixtures/config';
import { unpatch } from '../../../test/services/patch';

jest.setTimeout(30 * 60 * 1000);

let solana: Solana;
let serum: Serum;

beforeAll(async () => {
  solana = await Solana.getInstance(config.serum.network);

  serum = await Serum.getInstance(config.serum.chain, config.serum.network);

  await solana.init();
  await serum.init();
});

afterEach(() => {
  unpatch();
});

const commonParameters = {
  chain: config.serum.chain,
  network: config.serum.network,
  connector: config.serum.connector,
};
const allMarketNames = ['SOL/USDC', 'SOL/USDT', 'SRM/SOL', 'DUMMY/USDC'];
const marketNames = allMarketNames.slice(0, 4);

const delayInMilliseconds = 1000;

const publicKey =
  process.env['TEST_SOLANA_WALLET_PUBLIC_KEY'] ||
  config.solana.wallet.owner.publicKey;

it('Cancel all orders and settle all funds', async () => {
  let attempts = 1;
  let error = false;

  do {
    try {
      const connection = serum.getConnection();
      const markets: IMap<string, Market> = await (
        await Serum.getInstance(
          commonParameters.chain,
          commonParameters.network
        )
      ).getMarkets(marketNames);
      const ownerKeyPair = await solana.getKeypair(publicKey);
      const owner = new Account(ownerKeyPair.secretKey);

      for (const market of Array.from(markets.values())) {
        console.log(`Resetting market ${market.name}:`);

        const serumMarket = market.market;
        const openOrders = await serumMarket.loadOrdersForOwner(
          connection,
          owner.publicKey
        );

        console.log('Open orders found:', JSON.stringify(openOrders));

        for (const openOrder of openOrders) {
          try {
            const result = serumMarket.cancelOrder(
              connection,
              owner,
              openOrder
            );
            console.log(
              `Cancelling order ${openOrder.orderId}:`,
              JSON.stringify(result)
            );
          } catch (exception: any) {
            if (
              exception.message.includes(
                'It is unknown if it succeeded or failed.'
              )
            ) {
              console.log(exception);
            } else {
              throw exception;
            }
          }
        }

        for (const openOrders of await serumMarket.findOpenOrdersAccountsForOwner(
          connection,
          owner.publicKey
        )) {
          console.log(`Settling funds for orders:`, JSON.stringify(openOrders));

          if (
            openOrders.baseTokenFree.gt(new BN(0)) ||
            openOrders.quoteTokenFree.gt(new BN(0))
          ) {
            const base = await serumMarket.findBaseTokenAccountsForOwner(
              connection,
              owner.publicKey,
              true
            );
            const baseTokenAccount = base[0].pubkey;
            const quote = await serumMarket.findQuoteTokenAccountsForOwner(
              connection,
              owner.publicKey,
              true
            );
            const quoteTokenAccount = quote[0].pubkey;

            try {
              const result = await serumMarket.settleFunds(
                connection,
                owner,
                openOrders,
                baseTokenAccount,
                quoteTokenAccount
              );

              console.log(`Result of settling funds:`, JSON.stringify(result));
            } catch (exception: any) {
              if (
                exception.message.includes(
                  'It is unknown if it succeeded or failed.'
                )
              ) {
                console.log(exception);
              } else {
                throw exception;
              }
            }
          }
        }
      }

      error = false;

      console.log('Reset done.');
    } catch (exception) {
      console.log(
        `Cancel all orders and settle all funds, attempt ${attempts} with error: `,
        exception
      );

      attempts += 1;

      error = true;

      await sleep(delayInMilliseconds);
    }
  } while (error);
});

it('List all open orders', async () => {
  const connection = serum.getConnection();
  const markets = await (
    await Serum.getInstance(commonParameters.chain, commonParameters.network)
  ).getMarkets(marketNames);
  const ownerKeyPair = await solana.getKeypair(publicKey);
  const owner = new Account(ownerKeyPair.secretKey);

  for (const market of Array.from(markets.values())) {
    let attempts = 1;
    let error = false;

    do {
      try {
        const serumMarket = market.market;
        const openOrders = await serumMarket.loadOrdersForOwner(
          connection,
          owner.publicKey
        );

        console.log('Open orders found:', JSON.stringify(openOrders));

        error = false;
      } catch (exception) {
        console.log(
          `List open orders for market ${market.name}, attempt ${attempts} with error: `,
          exception
        );

        attempts += 1;

        error = true;

        await sleep(delayInMilliseconds);
      }
    } while (error);
  }
});
