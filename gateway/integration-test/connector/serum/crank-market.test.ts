import 'jest-extended';
import { Solana } from '../../../src/chains/solana/solana';
import { Serum } from '../../../src/connectors/serum/serum';
import { ConfigManagerV2 } from '../../../src/services/config-manager-v2';
import { unpatch } from '../../../test/services/patch';
import { default as config } from '../../../test/chains/solana/serum/fixtures/config';
import {
  default as patchesCreator,
  disablePatches,
} from '../../../test/chains/solana/serum/fixtures/patches/patches';
import { Account } from '@solana/web3.js';

jest.setTimeout(60 * 60 * 1000);

disablePatches();

let solana: Solana;
let serum: Serum;

let patches: Map<string, any>;

beforeAll(async () => {
  const configManager = ConfigManagerV2.getInstance();
  configManager.set('solana.timeout.all', 30 * 60 * 1000);
  configManager.set('solana.retry.all.maxNumberOfRetries', 5);
  configManager.set('solana.retry.all.delayBetweenRetries', 500);
  configManager.set('solana.parallel.all.batchSize', 100);
  configManager.set('solana.parallel.all.delayBetweenBatches', 500);

  solana = await Solana.getInstance(config.serum.network);

  serum = await Serum.getInstance(config.serum.chain, config.serum.network);

  patches = await patchesCreator(solana, serum);

  patches.get('solana/getTokenList')();

  patches.get('serum/serumGetMarketsInformation')();
  patches.get('serum/market/load')();

  await solana.init();
  await serum.init();
});

afterEach(() => {
  unpatch();
});

it('Crank the market', async () => {
  const ownerPublicKey =
    process.env['TEST_SOLANA_WALLET_PUBLIC_KEY'] ||
    config.solana.wallet.owner.publicKey;

  const ownerKeyPair = await solana.getKeypair(ownerPublicKey);
  const owner = new Account(ownerKeyPair.secretKey);

  const market = await serum.getMarket('DUMMY/USDC');
  const serumMarket = market.market;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // serumMarket._skipPreflight = true;
  const result = await serumMarket.crank(
    serum.getConnection(),
    owner,
    999,
    999
  );

  console.log(result);
});
