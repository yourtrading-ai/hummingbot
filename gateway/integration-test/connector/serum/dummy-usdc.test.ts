import 'jest-extended';
import { Solana } from '../../../src/chains/solana/solana';
import { Serum } from '../../../src/connectors/serum/serum';
import {
  cancelOrders,
  createOrders,
  getFilledOrders,
  getMarkets,
  getOpenOrders,
  getOrderBooks,
  getTickers,
  settleFunds,
} from '../../../src/connectors/serum/serum.controllers';
import { ConfigManagerV2 } from '../../../src/services/config-manager-v2';
import { unpatch } from '../../../test/services/patch';
import { default as config } from '../../../test/chains/solana/serum/fixtures/config';
import {
  default as patchesCreator,
  disablePatches,
} from '../../../test/chains/solana/serum/fixtures/patches/patches';
import { StatusCodes } from 'http-status-codes';
import {
  CreateOrdersRequest,
  OrderSide,
} from '../../../src/connectors/serum/serum.types';
import {
  dump,
  getNewCandidateOrderTemplate,
  getRandomNumberInInterval,
} from '../../../test/chains/solana/serum/fixtures/helpers';

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

const ownerPublicKey =
  process.env['TEST_SOLANA_WALLET_PUBLIC_KEY'] ||
  config.solana.wallet.owner.publicKey;

const commonParameters = {
  chain: config.serum.chain,
  network: config.serum.network,
  connector: config.serum.connector,
};

const marketName = 'DUMMY/USDC';
const initialId = 1;
const quantity = 10;
const candidateOrders: CreateOrdersRequest[] = [];
for (let id = initialId; id < initialId + quantity; id += 2) {
  candidateOrders.push(
    getNewCandidateOrderTemplate({
      id: id.toString(),
      marketName: marketName,
      side: OrderSide.BUY,
      price: getRandomNumberInInterval(0.00001, 0.00002),
      amount: Math.floor(getRandomNumberInInterval(11, 20)),
      replaceIfExists: true,
    })
  );

  candidateOrders.push(
    getNewCandidateOrderTemplate({
      id: (id + 1).toString(),
      marketName: marketName,
      side: OrderSide.SELL,
      price: getRandomNumberInInterval(999, 1000),
      amount: Math.floor(getRandomNumberInInterval(1, 10)),
      replaceIfExists: true,
    })
  );
}

let request: any;

let response: any;

describe('DUMMY/USDC Market Tests', () => {
  it('Get market', async () => {
    request = {
      ...commonParameters,
      name: marketName,
    };

    dump('getMarkets -> request:', request);

    response = await getMarkets(solana, serum, request);

    dump('getMarkets -> response:', response);
  });

  it('Get orderbook', async () => {
    await patches.get('serum/market/loadAsks')('SOL/USDT');
    await patches.get('serum/market/loadBids')('SOL/USDT');

    request = {
      ...commonParameters,
      marketName: marketName,
    };

    dump('getOrderBooks -> request:', request);

    response = await getOrderBooks(solana, serum, request);

    console.log(
      'getOrderBooks -> response:',
      JSON.stringify(response, null, 2)
    );
  });

  it('Get ticker', async () => {
    patches.get('serum/getTicker')();

    request = {
      ...commonParameters,
      marketName: marketName,
    };

    dump('getTickers -> request:', request);

    response = await getTickers(solana, serum, request);

    dump('getTickers -> response:', response);
  });

  it('Get all open orders - begin', async () => {
    await patches.get('serum/market/asksBidsForAllMarkets')();
    patches.get('solana/getKeyPair')();
    await patches.get('serum/market/loadOrdersForOwner')([]);

    request = {
      ...commonParameters,
      ownerAddress: ownerPublicKey,
      marketNames: [marketName],
    };

    dump('getOpenOrders -> request:', request);

    response = await getOpenOrders(solana, serum, request);

    dump('getOpenOrders -> response:', response);
  });

  it('Cancel all orders', async () => {
    await patches.get('serum/market/asksBidsForAllMarkets')();
    patches.get('solana/getKeyPair')();
    patches.get('serum/serumMarketCancelOrdersAndSettleFunds')();
    await patches.get('serum/market/loadOrdersForOwner')([]);

    request = {
      ...commonParameters,
      ownerAddress: ownerPublicKey,
      marketNames: [marketName],
    };

    dump('cancelOrders -> request:', request);

    response = await cancelOrders(solana, serum, request);

    expect(response.status).toBe(StatusCodes.OK);

    dump('cancelOrders -> response:', response);
  });

  it('Settle all funds', async () => {
    await patches.get('serum/market/asksBidsForAllMarkets')();
    patches.get('solana/getKeyPair')();
    patches.get('serum/settleFundsForMarket')();
    patches.get('serum/serumMarketLoadFills')();
    await patches.get('serum/market/loadOrdersForOwner')([]);

    request = {
      ...commonParameters,
      marketName: marketName,
      ownerAddress: ownerPublicKey,
    };

    dump('settleFunds -> request:', request);

    response = await settleFunds(solana, serum, request);

    dump('settleFunds -> response:', response);
  });

  it('Create several orders', async () => {
    patches.get('solana/getKeyPair')();
    patches.get('serum/serumMarketPlaceOrders')();

    request = {
      ...commonParameters,
      orders: candidateOrders,
      // replaceIfExists: true,
    };

    dump('createOrders -> request:', request);

    response = await createOrders(solana, serum, request);

    dump('createOrders -> response:', response);
  });

  it('Get all open orders - end', async () => {
    await patches.get('serum/market/asksBidsForAllMarkets')();
    patches.get('solana/getKeyPair')();
    await patches.get('serum/market/loadOrdersForOwner')([]);

    request = {
      ...commonParameters,
      ownerAddress: ownerPublicKey,
      marketNames: [marketName],
    };

    dump('getOpenOrders -> request:', request);

    response = await getOpenOrders(solana, serum, request);

    dump('getOpenOrders -> response:', response);
  });

  it('Get all filled orders', async () => {
    await patches.get('serum/market/asksBidsForAllMarkets')();
    patches.get('solana/getKeyPair')();
    patches.get('serum/serumMarketLoadFills')();

    request = {
      ...commonParameters,
      ownerAddress: ownerPublicKey,
      marketNames: [marketName],
      limit: 1000,
    };

    dump('getFilledOrders -> request:', request);

    response = await getFilledOrders(solana, serum, request);

    dump('getFilledOrders -> response:', response);
  });
});
