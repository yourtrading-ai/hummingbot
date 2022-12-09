import { MARKETS } from '@project-serum/serum';
import { TokenInfo } from '@solana/spl-token-registry';
import { Account as TokenAccount } from '@solana/spl-token/lib/types/state/account';
import {
  Account,
  AccountInfo,
  Connection,
  PublicKey,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import axios from 'axios';
import BN from 'bn.js';
import { Cache, CacheContainer } from 'node-ts-cache';
import { MemoryStorage } from 'node-ts-cache-storage-memory';
import { Solana } from '../../chains/solana/solana';
import {
  Config as SolanaConfig,
  getSolanaConfig,
} from '../../chains/solana/solana.config';
import { SerumConfig } from './serum.config';
import { default as constants } from './serum.constants';
import { default as solanaConstants } from '../../chains/solana/solana.constants';
import {
  convertArrayOfSerumOrdersToMapOfOrders,
  convertMarketBidsAndAsksToOrderBook,
  convertOrderSideToSerumSide,
  convertOrderTypeToSerumType,
  convertSerumMarketToMarket,
  convertSerumOrderToOrder,
  convertToTicker,
} from './serum.convertors';
import {
  getNotNullOrThrowError,
  getRandonBN,
  promiseAllInBatches,
  runWithRetryAndTimeout,
  splitInChunks,
} from './serum.helpers';
import {
  BasicSerumMarket,
  CancelOrderRequest,
  CancelOrdersRequest,
  CreateOrdersRequest,
  Fund,
  FundsSettlementError,
  GetFilledOrderRequest,
  GetFilledOrdersRequest,
  GetOpenOrderRequest,
  GetOpenOrdersRequest,
  GetOrderRequest,
  GetOrdersRequest,
  IMap,
  Market,
  MarketNotFoundError,
  Order,
  OrderBook,
  OrderNotFoundError,
  OrderSide,
  OrderStatus,
  SerumMarket,
  SerumMarketOptions,
  SerumOpenOrders,
  SerumOrder,
  SerumOrderBook,
  SerumOrderParams,
  SerumOrderParamsAccounts,
  SerumOrderParamsBase,
  Ticker,
  TickerNotFoundError,
  TickerSource,
  TransactionSignatures,
} from './serum.types';
import { PythCluster } from '@pythnetwork/client/lib/cluster';
import {
  getPythProgramKeyForCluster,
  PriceData,
  PythHttpClient,
} from '@pythnetwork/client';

const caches = {
  instances: new CacheContainer(new MemoryStorage()),
  markets: new CacheContainer(new MemoryStorage()),
  serumFindQuoteTokenAccountsForOwner: new CacheContainer(new MemoryStorage()),
  serumFindBaseTokenAccountsForOwner: new CacheContainer(new MemoryStorage()),
};

export type Serumish = Serum;

/**
 * Serum is a wrapper around the Serum  API.
 *
 * // TODO Listen the events from the serum API to automatically settle the funds (specially when filling orders)
 */
export class Serum {
  private initializing: boolean = false;

  private readonly config: SerumConfig.Config;
  private readonly solanaConfig: SolanaConfig;
  private readonly connection: Connection;
  private solana!: Solana;
  private _ready: boolean = false;

  chain: string;
  network: string;
  readonly connector: string = 'serum';

  /**
   * Creates a new instance of Serum.
   *
   * @param chain
   * @param network
   * @private
   */
  private constructor(chain: string, network: string) {
    this.chain = chain;
    this.network = network;

    this.config = SerumConfig.config;
    this.solanaConfig = getSolanaConfig(chain, network);

    this.connection = new Connection(this.solanaConfig.network.nodeUrl);
  }

  @Cache(caches.markets, { ttl: constants.cache.marketsInformation })
  async serumGetMarketsInformation(): Promise<BasicSerumMarket[]> {
    const marketsURL =
      this.config.markets.url ||
      'https://raw.githubusercontent.com/project-serum/serum-ts/master/packages/serum/src/markets.json';

    let marketsInformation: BasicSerumMarket[];

    try {
      if (!marketsURL.startsWith('https')) {
        marketsInformation = require(marketsURL);
      } else {
        marketsInformation = (
          await runWithRetryAndTimeout<any>(axios, axios.get, [marketsURL])
        ).data;
      }
    } catch (e) {
      marketsInformation = MARKETS;
    }

    return marketsInformation;
  }

  /**
   * 1 external API call.
   *
   * @param connection
   * @param address
   * @param options
   * @param programId
   * @param layoutOverride
   * @private
   */
  private async serumLoadMarket(
    connection: Connection,
    address: PublicKey,
    options: SerumMarketOptions | undefined,
    programId: PublicKey,
    layoutOverride?: any
  ): Promise<SerumMarket> {
    return await runWithRetryAndTimeout<Promise<SerumMarket>>(
      SerumMarket,
      SerumMarket.load,
      [
        connection,
        address,
        <SerumMarketOptions>options,
        programId,
        layoutOverride,
      ]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @private
   */
  private async serumMarketLoadBids(
    market: SerumMarket,
    connection: Connection
  ): Promise<SerumOrderBook> {
    return await runWithRetryAndTimeout<Promise<SerumOrderBook>>(
      market,
      market.loadBids,
      [connection]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @private
   */
  private async serumMarketLoadAsks(
    market: SerumMarket,
    connection: Connection
  ): Promise<SerumOrderBook> {
    return await runWithRetryAndTimeout<Promise<SerumOrderBook>>(
      market,
      market.loadAsks,
      [connection]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param limit
   * @private
   */
  private async serumMarketLoadFills(
    market: SerumMarket,
    connection: Connection,
    limit: number = constants.orders.filled.limit
  ): Promise<any[]> {
    return await runWithRetryAndTimeout<Promise<any[]>>(
      market,
      market.loadFills,
      [connection, limit]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param ownerAddress
   * @param cacheDurationMs
   * @private
   */
  private async serumMarketLoadOrdersForOwner(
    market: SerumMarket,
    connection: Connection,
    ownerAddress: PublicKey,
    cacheDurationMs?: number
  ): Promise<SerumOrder[]> {
    return await runWithRetryAndTimeout<Promise<SerumOrder[]>>(
      market,
      market.loadOrdersForOwner,
      [connection, ownerAddress, cacheDurationMs]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param owner
   * @param payer
   * @param side
   * @param price
   * @param size
   * @param orderType
   * @param clientId
   * @param openOrdersAddressKey
   * @param openOrdersAccount
   * @param feeDiscountPubkey
   * @param maxTs
   * @param replaceIfExists
   * @private
   */
  private async serumMarketPlaceOrder(
    market: SerumMarket,
    connection: Connection,
    {
      owner,
      payer,
      side,
      price,
      size,
      orderType,
      clientId,
      openOrdersAddressKey,
      openOrdersAccount,
      feeDiscountPubkey,
      maxTs,
      replaceIfExists,
    }: SerumOrderParams<Account>
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.placeOrder,
      [
        connection,
        {
          owner,
          payer,
          side,
          price,
          size,
          orderType,
          clientId,
          openOrdersAddressKey,
          openOrdersAccount,
          feeDiscountPubkey,
          maxTs,
          replaceIfExists,
        },
      ]
    );
  }

  /**
   * Place one or more orders in a single transaction for each owner informed.
   * $numberOfDifferentOwners external API calls.
   *
   * @param market
   * @param connection
   * @param owner
   * @param orders
   * @param matchOrdersLimit
   * @param consumeEventsLimit
   * @private
   */
  private async serumMarketPlaceOrders(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    orders: SerumOrderParams<Account>[],
    matchOrdersLimit?: number,
    consumeEventsLimit?: number
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.placeOrders,
      [connection, owner, orders, matchOrdersLimit, consumeEventsLimit]
    );
  }

  /**
   * Replace one or more orders in a single transaction.
   * 1 external API calls.
   *
   * @param market
   * @param connection
   * @param accounts
   * @param orders
   * @param cacheDurationMs
   * @private
   */
  private async serumMarketReplaceOrders(
    market: SerumMarket,
    connection: Connection,
    accounts: SerumOrderParamsAccounts,
    orders: SerumOrderParamsBase<Account>[],
    cacheDurationMs = 0
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.replaceOrders,
      [connection, accounts, orders, cacheDurationMs]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param owner
   * @param order
   * @private
   */
  private async serumMarketCancelOrder(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    order: SerumOrder
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.cancelOrder,
      [connection, owner, order]
    );
  }

  /**
   *
   * @param market
   * @param connection
   * @param owner
   * @param orders
   * @private
   */
  private async serumMarketCancelOrders(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    orders: SerumOrder[]
  ): Promise<TransactionSignatures> {
    const cancellationSignature = await runWithRetryAndTimeout<
      Promise<TransactionSignature>
    >(market, market.cancelOrders, [connection, owner, orders]);

    return {
      cancellation: cancellationSignature,
    };
  }

  /**
   * Cancel one or more order in a single transaction.
   * 2 external API call.
   *
   * @param market
   * @param connection
   * @param owner
   * @param orders
   * @private
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private async serumMarketCancelOrdersAndSettleFunds(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    orders: SerumOrder[]
  ): Promise<TransactionSignatures> {
    const cancellationSignature = await runWithRetryAndTimeout<
      Promise<TransactionSignature>
    >(market, market.cancelOrders, [connection, owner, orders]);

    const fundsSettlements: {
      owner: Account;
      openOrders: SerumOpenOrders;
      baseWallet: PublicKey;
      quoteWallet: PublicKey;
      referrerQuoteWallet: PublicKey | null;
    }[] = [];

    for (const openOrders of await this.serumFindOpenOrdersAccountsForOwner(
      market,
      connection,
      owner.publicKey
    )) {
      if (
        openOrders.baseTokenFree.gt(new BN(0)) ||
        openOrders.quoteTokenFree.gt(new BN(0))
      ) {
        const base = await this.serumFindBaseTokenAccountsForOwner(
          market,
          this.connection,
          owner.publicKey,
          true
        );
        const baseWallet = base[0].pubkey;

        const quote = await this.serumFindQuoteTokenAccountsForOwner(
          market,
          this.connection,
          owner.publicKey,
          true
        );
        const quoteWallet = quote[0].pubkey;

        fundsSettlements.push({
          owner,
          openOrders,
          baseWallet,
          quoteWallet,
          referrerQuoteWallet: null,
        });
      }
    }

    try {
      const fundsSettlementSignature = await this.serumSettleSeveralFunds(
        market,
        connection,
        fundsSettlements[0].owner, // There's only one owner.
        fundsSettlements,
        new Transaction() // There's only one owner.
      ); // There's only one owner.

      return {
        cancellation: cancellationSignature,
        fundsSettlement: fundsSettlementSignature,
      } as TransactionSignatures;
    } catch (exception: any) {
      if (
        exception.message.includes('It is unknown if it succeeded or failed.')
      ) {
        throw new FundsSettlementError(
          `Unknown state when settling the funds for the market: ${exception.message}`
        );
      } else {
        throw exception;
      }
    }
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param ownerAddress
   * @param cacheDurationMs
   * @private
   */
  private async serumFindOpenOrdersAccountsForOwner(
    market: SerumMarket,
    connection: Connection,
    ownerAddress: PublicKey,
    cacheDurationMs?: number
  ): Promise<SerumOpenOrders[]> {
    return await runWithRetryAndTimeout<Promise<SerumOpenOrders[]>>(
      market,
      market.findOpenOrdersAccountsForOwner,
      [connection, ownerAddress, cacheDurationMs]
    );
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param ownerAddress
   * @param includeUnwrappedSol
   * @private
   */
  @Cache(caches.serumFindBaseTokenAccountsForOwner, { isCachedForever: true })
  private async serumFindBaseTokenAccountsForOwner(
    market: SerumMarket,
    connection: Connection,
    ownerAddress: PublicKey,
    includeUnwrappedSol?: boolean
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>> {
    return await runWithRetryAndTimeout<
      Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>
    >(market, market.findBaseTokenAccountsForOwner, [
      connection,
      ownerAddress,
      includeUnwrappedSol,
    ]);
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param ownerAddress
   * @param includeUnwrappedSol
   * @private
   */
  @Cache(caches.serumFindQuoteTokenAccountsForOwner, { isCachedForever: true })
  private async serumFindQuoteTokenAccountsForOwner(
    market: SerumMarket,
    connection: Connection,
    ownerAddress: PublicKey,
    includeUnwrappedSol?: boolean
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>> {
    return await runWithRetryAndTimeout<
      Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>
    >(market, market.findQuoteTokenAccountsForOwner, [
      connection,
      ownerAddress,
      includeUnwrappedSol,
    ]);
  }

  /**
   * 1 external API call.
   *
   * @param market
   * @param connection
   * @param owner
   * @param openOrders
   * @param baseWallet
   * @param quoteWallet
   * @param referrerQuoteWallet
   * @param matchOrdersLimit
   * @param consumeEventsLimit
   * @private
   */
  private async serumSettleFunds(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    openOrders: SerumOpenOrders,
    baseWallet: PublicKey,
    quoteWallet: PublicKey,
    referrerQuoteWallet?: PublicKey | null,
    matchOrdersLimit?: number,
    consumeEventsLimit?: number
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.settleFunds,
      [
        connection,
        owner,
        openOrders,
        baseWallet,
        quoteWallet,
        referrerQuoteWallet,
        matchOrdersLimit,
        consumeEventsLimit,
      ]
    );
  }

  /**
   * Settle the funds in a single transaction for each owner.
   * $numberOfDifferentOwners external API calls.
   *
   * @param market
   * @param connection
   * @param owner
   * @param settlements
   * @param transaction
   * @private
   */
  private async serumSettleSeveralFunds(
    market: SerumMarket,
    connection: Connection,
    owner: Account,
    settlements: {
      owner: Account;
      openOrders: SerumOpenOrders;
      baseWallet: PublicKey;
      quoteWallet: PublicKey;
      referrerQuoteWallet: PublicKey | null;
    }[],
    transaction: Transaction = new Transaction()
  ): Promise<TransactionSignature> {
    return await runWithRetryAndTimeout<Promise<TransactionSignature>>(
      market,
      market.settleSeveralFunds,
      [connection, owner, settlements, transaction]
    );
  }

  private async getSolanaAccount(address: string): Promise<Account> {
    return await runWithRetryAndTimeout<Promise<Account>>(
      this.solana,
      this.solana.getAccount,
      [address]
    );
  }

  /**
   * Get the Serum instance for the given chain and network.
   * Is cached forever.
   *
   * $numberOfAllowedMarkets external API calls.
   *
   * @param chain
   * @param network
   */
  @Cache(caches.instances, { isCachedForever: true })
  static async getInstance(chain: string, network: string): Promise<Serum> {
    return new Serum(chain, network);
  }

  /**
   * Initialize the Serum instance.
   *
   * $numberOfAllowedMarkets external API calls.
   */
  async init() {
    if (!this._ready && !this.initializing) {
      this.initializing = true;

      this.solana = await Solana.getInstance(this.network);
      await this.solana.init();

      await this.getAllMarkets();

      this._ready = true;
      this.initializing = false;
    }
  }

  /**
   * 0 external API call.
   */
  ready(): boolean {
    return this._ready;
  }

  /**
   * 0 external API call.
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * 0 external API call.
   *
   * @param name
   */
  async getMarket(name?: string): Promise<Market> {
    if (!name) throw new MarketNotFoundError(`No market informed.`);

    const markets = await this.getAllMarkets();

    const market = markets.get(name);

    if (!market) throw new MarketNotFoundError(`Market "${name}" not found.`);

    return market;
  }

  /**
   * 0 external API calls.
   *
   * @param names
   */
  async getMarkets(names: string[]): Promise<IMap<string, Market>> {
    const markets = IMap<string, Market>().asMutable();

    const getMarket = async (name: string): Promise<void> => {
      const market = await this.getMarket(name);

      markets.set(name, market);
    };

    // The rate limits are defined here: https://docs.solana.com/cluster/rpc-endpoints
    await promiseAllInBatches(getMarket, names);

    return markets;
  }

  /**
   * $numberOfAllowedMarkets external API calls.
   */
  @Cache(caches.markets, { ttl: constants.cache.markets })
  async getAllMarkets(): Promise<IMap<string, Market>> {
    const allMarkets = IMap<string, Market>().asMutable();

    let marketsInformation: BasicSerumMarket[] =
      await this.serumGetMarketsInformation();

    marketsInformation = marketsInformation.filter(
      (item) =>
        !item.deprecated &&
        (this.config.markets.blacklist?.length
          ? !this.config.markets.blacklist.includes(item.name)
          : true) &&
        (this.config.markets.whiteList?.length
          ? this.config.markets.whiteList.includes(item.name)
          : true)
    );

    const loadMarket = async (market: BasicSerumMarket): Promise<void> => {
      const serumMarket = await this.serumLoadMarket(
        this.connection,
        new PublicKey(market.address),
        {
          // skipPreflight: true
        },
        new PublicKey(market.programId)
      );

      allMarkets.set(
        market.name,
        convertSerumMarketToMarket(serumMarket, market)
      );
    };

    // The rate limits are defined here: https://docs.solana.com/cluster/rpc-endpoints
    // It takes on average about 44s to load all the markets
    await promiseAllInBatches(loadMarket, marketsInformation);

    return allMarkets;
  }

  /**
   * 2 external API calls.
   *
   * @param marketName
   */
  async getOrderBook(marketName: string): Promise<OrderBook> {
    const market = await this.getMarket(marketName);

    const asks = await this.serumMarketLoadAsks(market.market, this.connection);
    const bids = await this.serumMarketLoadBids(market.market, this.connection);

    return convertMarketBidsAndAsksToOrderBook(market, asks, bids);
  }

  /**
   * 2*$numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   */
  async getOrderBooks(marketNames: string[]): Promise<IMap<string, OrderBook>> {
    const orderBooks = IMap<string, OrderBook>().asMutable();

    const getOrderBook = async (marketName: string): Promise<void> => {
      const orderBook = await this.getOrderBook(marketName);

      orderBooks.set(marketName, orderBook);
    };

    // The rate limits are defined here: https://docs.solana.com/cluster/rpc-endpoints
    await promiseAllInBatches(getOrderBook, marketNames);

    return orderBooks;
  }

  /**
   * 2*$numberOfAllowedMarkets external API calls.
   */
  async getAllOrderBooks(): Promise<IMap<string, OrderBook>> {
    const marketNames = Array.from((await this.getAllMarkets()).keys());

    return this.getOrderBooks(marketNames);
  }

  /**
   * 1 external API call.
   *
   * @param marketName
   */
  async getTicker(marketName: string): Promise<Ticker> {
    const market = await this.getMarket(marketName);

    for (const [source, config] of this.config.tickers.sources) {
      try {
        if (source === TickerSource.NOMIMCS) {
          const marketsInformation = await this.serumGetMarketsInformation();
          const basicMarketInformation: BasicSerumMarket =
            marketsInformation.filter(
              (item) => !item.deprecated && item.address == market.address
            )[0];

          let tickerAddress = market.address.toString();
          if (basicMarketInformation['tickerAddress'])
            tickerAddress = basicMarketInformation['tickerAddress'].toString();

          const finalUrl = (
            config.url ||
            'https://nomics.com/data/exchange-markets-ticker?convert=USD&exchange=serum_dex&interval=1m&market=${marketAddress}'
          ).replace('${marketAddress}', tickerAddress);

          const result: { price: any; last_updated_at: any } = (
            await runWithRetryAndTimeout(
              axios,
              axios.get,
              [finalUrl],
              solanaConstants.retry.all.maxNumberOfRetries,
              0
            )
          ).data.items[0];

          return convertToTicker(result);
        } else if (source == TickerSource.PYTH) {
          const pythPublicKey = getPythProgramKeyForCluster(
            this.network as PythCluster
          );
          const pythClient = new PythHttpClient(this.connection, pythPublicKey);

          const split = marketName.split('/');
          const base = split[0]
            .replace(/(.*)\s\(NEW\)/, '$1')
            .replace(/([A-Za-z]+)/, '$1');
          const quote = split[1]
            .replace(/(.*)\s\(NEW\)/, '$1')
            .replace(/([A-Za-z]+)/, '$1')
            .replace(/B*USD[CT]*/, 'USD');
          const symbol = `Crypto.${base}/${quote}`;

          const result = await runWithRetryAndTimeout(
            null,
            async function getPythPrice() {
              const data = await pythClient.getData();
              const result = data.productPrice.get(symbol);

              return getNotNullOrThrowError(result);
            },
            [symbol],
            solanaConstants.retry.all.maxNumberOfRetries,
            0
          );

          const ticker = {
            price: getNotNullOrThrowError<number>(
              getNotNullOrThrowError<PriceData>(result).price
            ),
            timestamp: Date.now(),
            ticker: result,
          };

          return ticker;
        } else if (source === TickerSource.LAST_FILLED_ORDER) {
          const filledOrders = await this.getFilledOrdersForMarket(market.name);

          if (filledOrders.size) {
            const lastFilledOrder = filledOrders.values().next().value;

            const ticker = {
              price: lastFilledOrder.price,
              timestamp: Date.now(),
              ticker: lastFilledOrder,
            };

            return ticker;
          } else {
            throw new TickerNotFoundError(
              `Ticker data is currently not available for market "${marketName}".`
            );
          }
        } else {
          throw new TickerNotFoundError(
            `Ticker source (${source}) not supported, check your serum configuration file.`
          );
        }
      } catch (exception) {
        // Ignoring so other sources can be tried.
      }
    }

    throw new TickerNotFoundError(
      `Ticker data is currently not available for market "${marketName}".`
    );
  }

  /**
   * $numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   */
  async getTickers(marketNames: string[]): Promise<IMap<string, Ticker>> {
    const tickers = IMap<string, Ticker>().asMutable();

    const getTicker = async (marketName: string): Promise<void> => {
      const ticker = await this.getTicker(marketName);

      tickers.set(marketName, ticker);
    };

    // The rate limits are defined here: https://docs.solana.com/cluster/rpc-endpoints
    await promiseAllInBatches(getTicker, marketNames);

    return tickers;
  }

  /**
   * $numberOfAllowedMarkets external API calls.
   */
  async getAllTickers(): Promise<IMap<string, Ticker>> {
    const marketNames = Array.from((await this.getAllMarkets()).keys());

    return await this.getTickers(marketNames);
  }

  /**
   * 1 or $numberOfAllowedMarkets external API calls.
   *
   * @param target
   */
  async getOpenOrder(target: GetOpenOrderRequest): Promise<Order> {
    if (!target.id && !target.exchangeId)
      throw new OrderNotFoundError('No client id or exchange id provided.');

    if (!target.ownerAddress)
      throw new OrderNotFoundError(
        `No owner address provided for order "${target.id} / ${target.exchangeId}".`
      );

    if (target.marketName) {
      const openOrder = (
        await this.getOpenOrdersForMarket(
          target.marketName,
          target.ownerAddress
        )
      ).find(
        (order) =>
          order.id === target.id || order.exchangeId === target.exchangeId
      );

      if (!openOrder)
        throw new OrderNotFoundError(
          `No open order found with id / exchange id "${target.id} / ${target.exchangeId}".`
        );

      openOrder.status = OrderStatus.OPEN;

      return openOrder;
    }

    const mapOfOpenOrdersForMarkets = await this.getAllOpenOrders(
      target.ownerAddress
    );

    for (const mapOfOpenOrdersForMarket of mapOfOpenOrdersForMarkets.values()) {
      for (const openOrder of mapOfOpenOrdersForMarket.values()) {
        if (
          openOrder.id === target.id ||
          openOrder.exchangeId === target.exchangeId
        ) {
          openOrder.status = OrderStatus.OPEN;

          return openOrder;
        }
      }
    }

    throw new OrderNotFoundError(
      `No open order found with id / exchange id "${target.id} / ${target.exchangeId}".`
    );
  }

  /**
   * $numberOfTargets or $numberOfTargets*$numberOfAllowedMarkets external API calls.
   *
   * @param targets
   */
  async getOpenOrders(
    targets: GetOpenOrdersRequest[]
  ): Promise<IMap<string, Order>> {
    const orders = IMap<string, Order>().asMutable();
    const temporary = IMap<string, Order>().asMutable();

    const getOrders = async (target: GetOrdersRequest) => {
      if (target.marketName) {
        temporary.concat(
          await this.getOpenOrdersForMarket(
            target.marketName,
            target.ownerAddress
          )
        );
      } else {
        (await this.getAllOpenOrders(target.ownerAddress)).reduce(
          (acc: IMap<string, Order>, mapOfOrders: IMap<string, Order>) => {
            return acc.concat(mapOfOrders);
          },
          temporary
        );
      }
    };

    await promiseAllInBatches(getOrders, targets);

    for (const target of targets) {
      orders.concat(
        temporary.filter((order: Order) => {
          return (
            order.ownerAddress === target.ownerAddress &&
            (target.marketName
              ? order.marketName === target.marketName
              : true) &&
            (target.ids?.length || target.exchangeIds?.length
              ? target.ids?.includes(<string>order.id) ||
                target.exchangeIds?.includes(<string>order.exchangeId)
              : true)
          );
        })
      );
    }

    return orders;
  }

  /**
   * 1 external API call.
   *
   * @param marketName
   * @param ownerAddress
   */
  async getOpenOrdersForMarket(
    marketName: string,
    ownerAddress: string
  ): Promise<IMap<string, Order>> {
    const market = await this.getMarket(marketName);

    const owner = await this.getSolanaAccount(ownerAddress);

    const serumOpenOrders = await this.serumMarketLoadOrdersForOwner(
      market.market,
      this.connection,
      owner.publicKey
    );

    return convertArrayOfSerumOrdersToMapOfOrders(
      market,
      serumOpenOrders,
      ownerAddress,
      OrderStatus.OPEN
    );
  }

  /**
   * $numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   * @param ownerAddress
   */
  async getOpenOrdersForMarkets(
    marketNames: string[],
    ownerAddress: string
  ): Promise<IMap<string, IMap<string, Order>>> {
    const result = IMap<string, IMap<string, Order>>().asMutable();

    const markets = await this.getMarkets(marketNames);

    const getOpenOrders = async (market: Market): Promise<void> => {
      result.set(
        market.name,
        await this.getOpenOrdersForMarket(market.name, ownerAddress)
      );
    };

    await promiseAllInBatches<Market, void>(
      getOpenOrders,
      Array.from(markets.values())
    );

    return result;
  }

  /**
   * $numberOfAllowedMarkets or $numberOfInformedMarkets external API calls.
   *
   * @param ownerAddress
   * @param marketName
   * @param marketNames
   */
  async getAllOpenOrders(
    ownerAddress: string,
    marketName?: string,
    marketNames?: string[]
  ): Promise<IMap<string, IMap<string, Order>>> {
    if (marketName) marketNames = [marketName];
    else if (!marketNames)
      marketNames = Array.from((await this.getAllMarkets()).keys());

    return await this.getOpenOrdersForMarkets(marketNames, ownerAddress);
  }

  /**
   * 1 or $numberOfAllowedMarkets external API calls.
   *
   * @param target
   * @param limit
   */
  async getFilledOrder(
    target: GetFilledOrderRequest,
    limit?: number
  ): Promise<Order> {
    if (!target.id && !target.exchangeId)
      throw new OrderNotFoundError('No client id or exchange id provided.');

    // if (!target.ownerAddress)
    //   throw new OrderNotFoundError(
    //     `No owner address provided for order "${target.id} / ${target.exchangeId}".`
    //   );

    if (target.marketName) {
      const filledOrder = (
        await this.getFilledOrdersForMarket(target.marketName, limit)
      ).find(
        (order) =>
          order.id === target.id || order.exchangeId === target.exchangeId
      );

      if (!filledOrder)
        throw new OrderNotFoundError(
          `No open order found with id / exchange id "${target.id} / ${target.exchangeId}".`
        );

      filledOrder.status = OrderStatus.FILLED;

      return filledOrder;
    }

    const mapOfFilledOrdersForMarkets = await this.getAllFilledOrders(
      undefined,
      undefined,
      limit
    );

    for (const mapOfFilledOrdersForMarket of mapOfFilledOrdersForMarkets.values()) {
      for (const filledOrder of mapOfFilledOrdersForMarket.values()) {
        if (
          filledOrder.id === target.id ||
          filledOrder.exchangeId === target.exchangeId
        ) {
          filledOrder.status = OrderStatus.FILLED;

          return filledOrder;
        }
      }
    }

    throw new OrderNotFoundError(
      `No filled order found with id / exchange id "${target.id} / ${target.exchangeId}".`
    );
  }

  /**
   * $numberOfTargets or $numberOfTargets*$numberOfAllowedMarkets external API calls.
   *
   * @param targets
   * @param limit
   */
  async getFilledOrders(
    targets: GetFilledOrdersRequest[],
    limit?: number
  ): Promise<IMap<string, Order>> {
    const orders = IMap<string, Order>().asMutable();
    const temporary = IMap<string, Order>().asMutable();

    const getOrders = async (target: GetOrdersRequest) => {
      if (target.marketName) {
        temporary.concat(
          await this.getFilledOrdersForMarket(target.marketName, limit)
        );
      } else {
        (await this.getAllFilledOrders()).reduce(
          (acc: IMap<string, Order>, mapOfOrders: IMap<string, Order>) => {
            return acc.concat(mapOfOrders);
          },
          temporary
        );
      }
    };

    await promiseAllInBatches(getOrders, targets);

    for (const target of targets) {
      orders.concat(
        temporary.filter((order: Order) => {
          return (
            // order.ownerAddress === target.ownerAddress &&
            (target.marketName
              ? order.marketName === target.marketName
              : true) &&
            (target.ids?.length || target.exchangeIds?.length
              ? target.ids?.includes(<string>order.id) ||
                target.exchangeIds?.includes(<string>order.exchangeId)
              : true)
          );
        })
      );
    }

    if (!orders.size) throw new OrderNotFoundError('No filled orders found.');

    return orders;
  }

  /**
   * 1 external API calls.
   *
   * @param marketName
   * @param limit
   */
  async getFilledOrdersForMarket(
    marketName: string,
    limit?: number
  ): Promise<IMap<string, Order>> {
    const market = await this.getMarket(marketName);

    const orders = await this.serumMarketLoadFills(
      market.market,
      this.connection,
      limit
    );

    // TODO check if it's possible to get the owner address
    return convertArrayOfSerumOrdersToMapOfOrders(
      market,
      orders,
      undefined,
      OrderStatus.FILLED
    );
  }

  /**
   * $numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   * @param limit
   */
  async getFilledOrdersForMarkets(
    marketNames: string[],
    limit?: number
  ): Promise<IMap<string, IMap<string, Order>>> {
    const result = IMap<string, IMap<string, Order>>().asMutable();

    const markets = await this.getMarkets(marketNames);

    const getFilledOrders = async (market: Market): Promise<void> => {
      result.set(
        market.name,
        await this.getFilledOrdersForMarket(market.name, limit)
      );
    };

    await promiseAllInBatches<Market, void>(
      getFilledOrders,
      Array.from(markets.values())
    );

    return result;
  }

  /**
   * $numberOfAllowedMarkets external API calls.
   */
  async getAllFilledOrders(
    marketName?: string,
    marketNames?: string[],
    limit?: number
  ): Promise<IMap<string, IMap<string, Order>>> {
    if (marketName) marketNames = [marketName];
    else if (!marketNames)
      marketNames = Array.from((await this.getAllMarkets()).keys());

    return await this.getFilledOrdersForMarkets(marketNames, limit);
  }

  /**
   * (1 or 2) or ($numberOfAllowedMarkets or 2*$numberOfAllowedMarkets) external API calls.
   *
   * @param target
   * @param limit
   */
  async getOrder(target: GetOrderRequest, limit?: number): Promise<Order> {
    if (!target.id && !target.exchangeId)
      throw new OrderNotFoundError('No client id or exchange id provided.');

    try {
      return await this.getOpenOrder(target);
    } catch (exception) {
      if (exception instanceof OrderNotFoundError) {
        try {
          return await this.getFilledOrder(target, limit);
        } catch (exception2) {
          if (exception2 instanceof OrderNotFoundError) {
            throw new OrderNotFoundError(
              `No order found with id / exchange id "${target.id} / ${target.exchangeId}".`
            );
          }
        }
      }

      throw exception;
    }
  }

  /**
   * 2*$numberOfTargets or 2*$numberOfTargets*$numberOfAllowedMarkets external API calls.
   *
   * @param targets
   * @param limit
   */
  async getOrders(
    targets: GetOrdersRequest[],
    limit?: number
  ): Promise<IMap<string, Order>> {
    const orders = IMap<string, Order>().asMutable();
    const temporary = IMap<string, Order>().asMutable();

    const getOrders = async (target: GetOrdersRequest) => {
      if (target.marketName) {
        const openOrders = await this.getOpenOrdersForMarket(
          target.marketName,
          target.ownerAddress
        );
        const filledOrders = await this.getFilledOrdersForMarket(
          target.marketName,
          target.limit || limit
        );
        temporary.concat(openOrders).concat(filledOrders);
      } else {
        (await this.getAllOpenOrders(target.ownerAddress)).reduce(
          (acc: IMap<string, Order>, mapOfOrders: IMap<string, Order>) => {
            return acc.concat(mapOfOrders);
          },
          temporary
        );

        (await this.getAllFilledOrders(undefined, undefined, limit)).reduce(
          (acc: IMap<string, Order>, mapOfOrders: IMap<string, Order>) => {
            return acc.concat(mapOfOrders);
          },
          temporary
        );
      }
    };

    await promiseAllInBatches(getOrders, targets);

    for (const target of targets) {
      orders.concat(
        temporary.filter((order: Order) => {
          return (
            order.ownerAddress === target.ownerAddress &&
            (target.marketName
              ? order.marketName === target.marketName
              : true) &&
            (target.ids?.length || target.exchangeIds?.length
              ? target.ids?.includes(<string>order.id) ||
                target.exchangeIds?.includes(<string>order.exchangeId)
              : true)
          );
        })
      );
    }

    return orders;
  }

  /**
   * 2 external API calls.
   *
   * @param marketName
   * @param ownerAddress
   * @param limit
   */
  async getOrdersForMarket(
    marketName: string,
    ownerAddress: string,
    limit?: number
  ): Promise<IMap<string, Order>> {
    const orders = await this.getOpenOrdersForMarket(marketName, ownerAddress);
    orders.concat(await this.getFilledOrdersForMarket(marketName, limit));

    return orders;
  }

  /**
   * 2*$numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   * @param ownerAddress
   * @param limit
   */
  async getOrdersForMarkets(
    marketNames: string[],
    ownerAddress: string,
    limit?: number
  ): Promise<IMap<string, IMap<string, Order>>> {
    const result = IMap<string, IMap<string, Order>>().asMutable();

    const markets = await this.getMarkets(marketNames);

    const getOrders = async (market: Market): Promise<void> => {
      result.set(
        market.name,
        await this.getOrdersForMarket(market.name, ownerAddress, limit)
      );
    };

    await promiseAllInBatches<Market, void>(
      getOrders,
      Array.from(markets.values())
    );

    return result;
  }

  /**
   * 2*$numberOfAllMarkets external API calls.
   *
   * @param ownerAddress
   * @param marketName
   * @param marketNames
   * @param limit
   */
  async getAllOrders(
    ownerAddress: string,
    marketName?: string,
    marketNames?: string[],
    limit?: number
  ): Promise<IMap<string, IMap<string, Order>>> {
    if (marketName) marketNames = [marketName];
    else if (!marketNames)
      marketNames = Array.from((await this.getAllMarkets()).keys());

    return await this.getOrdersForMarkets(marketNames, ownerAddress, limit);
  }

  /**
   * 1 external API call.
   *
   * @param candidate
   * @param replaceIfExists
   */
  async createOrder(
    candidate: CreateOrdersRequest,
    replaceIfExists: boolean = false
  ): Promise<Order> {
    return (await this.createOrders([candidate], replaceIfExists)).first();
  }

  /**
   * $numberOfDifferentOwners*$numberOfAllowedMarkets external API calls.
   *
   * @param candidates
   * @param replaceIfExists
   */
  async createOrders(
    candidates: CreateOrdersRequest[],
    replaceIfExists: boolean = false
  ): Promise<IMap<string, Order>> {
    const ordersMap = IMap<
      Market,
      IMap<
        string,
        { request: CreateOrdersRequest; serum: SerumOrderParams<Account> }[]
      >
    >().asMutable();

    const ownersMap = IMap<string, Account>().asMutable();

    for (const candidate of candidates) {
      const market = await this.getMarket(candidate.marketName);

      let marketMap = ordersMap.get(market);
      if (!marketMap) {
        marketMap = IMap<
          string,
          { request: CreateOrdersRequest; serum: SerumOrderParams<Account> }[]
        >().asMutable();
        ordersMap.set(market, getNotNullOrThrowError(marketMap));
      }

      const owner = await this.getSolanaAccount(candidate.ownerAddress);
      const ownerPublicKeyString = owner.publicKey.toString();

      // Using a ownersMap is a workaround because the Account class does not provide good equality.
      if (!ownersMap.has(ownerPublicKeyString)) {
        ownersMap.set(ownerPublicKeyString, owner);
      }

      let ownerOrders = marketMap?.get(ownerPublicKeyString);
      if (!ownerOrders) {
        ownerOrders = [];
        marketMap?.set(ownerPublicKeyString, ownerOrders);
      }

      let payer: PublicKey;
      if (candidate.payerAddress) {
        payer = new PublicKey(candidate.payerAddress);
      } else {
        const tokens = candidate.marketName.split('/');
        const baseToken = tokens[0];
        const quoteToken = tokens[1].replace(/(.*)\s\(NEW\)/, '$1');
        const targetToken =
          candidate.side == OrderSide.BUY ? quoteToken : baseToken;
        const keypair = await this.solana.getKeypair(candidate.ownerAddress);
        const tokenInfo: TokenInfo = getNotNullOrThrowError(
          this.solana.getTokenForSymbol(targetToken)
        );
        const mintAddress = new PublicKey(tokenInfo.address);
        const account = await runWithRetryAndTimeout(
          this.solana,
          this.solana.getOrCreateAssociatedTokenAccount,
          [keypair, mintAddress]
        );

        payer = getNotNullOrThrowError<TokenAccount>(account).address;
      }

      const candidateSerumOrder: SerumOrderParams<Account> = {
        side: convertOrderSideToSerumSide(candidate.side),
        price: candidate.price,
        size: candidate.amount,
        orderType: convertOrderTypeToSerumType(candidate.type),
        clientId: candidate.id ? new BN(candidate.id) : getRandonBN(),
        owner: owner,
        payer: payer,
        replaceIfExists: candidate.replaceIfExists,
      };

      ownerOrders.push({ request: candidate, serum: candidateSerumOrder });
    }

    const createdOrders = IMap<string, Order>().asMutable();
    for (const [market, marketMap] of ordersMap.entries()) {
      for (const [ownerPublicKeyString, orders] of marketMap.entries()) {
        const owner = getNotNullOrThrowError<Account>(
          ownersMap.get(ownerPublicKeyString)
        );
        let status: OrderStatus;
        let signatures: TransactionSignatures = {};
        try {
          if (replaceIfExists) {
            signatures.creation = await this.serumMarketReplaceOrders(
              market.market,
              this.connection,
              {
                owner: owner,
                payer: orders[0].serum.payer, // The Serum method accept the same payer only
              } as SerumOrderParamsAccounts,
              orders.map((order) => order.serum)
            );
          } else if (this.config.transactions.merge.createOrders) {
            signatures.creations = await promiseAllInBatches<
              SerumOrderParams<Account>[],
              TransactionSignature
            >(
              async (
                item: SerumOrderParams<Account>[]
              ): Promise<TransactionSignature> => {
                return await this.serumMarketPlaceOrders(
                  market.market,
                  this.connection,
                  owner,
                  item,
                  0, // constants.events.limit.matchOrders,
                  0 // constants.events.limit.consumeEvents
                );
              },
              [
                ...splitInChunks<SerumOrderParams<Account>>(
                  orders.map((order) => order.serum),
                  constants.orders.create.maxPerTransaction
                ),
              ]
            );
          } else {
            signatures.creations = [];
            for (const order of orders) {
              const signature = await this.serumMarketPlaceOrder(
                market.market,
                this.connection,
                order.serum
              );

              signatures.creations.push(signature);
            }
          }

          status = OrderStatus.OPEN;
        } catch (exception: any) {
          if (
            exception.message.includes(
              'It is unknown if it succeeded or failed.'
            )
          ) {
            signatures = {};
            status = OrderStatus.CREATION_PENDING;
          } else {
            throw exception;
          }
        }

        for (const [index, order] of orders.entries()) {
          let finalSignatures: TransactionSignatures = {};

          if (this.config.transactions.merge.createOrders) {
            finalSignatures = signatures;
          } else {
            finalSignatures.creation = getNotNullOrThrowError<
              TransactionSignature[]
            >(
              getNotNullOrThrowError<TransactionSignatures>(signatures)
                .creations
            )[index];
          }

          const id = getNotNullOrThrowError<string>(
            order.serum.clientId?.toString(),
            'Client id is not defined.'
          );

          const serumOrder = convertSerumOrderToOrder(
            market,
            undefined,
            order.request,
            order.serum,
            owner?.publicKey.toString(),
            status,
            finalSignatures
          );

          createdOrders.set(id, serumOrder);
        }
      }
    }

    return createdOrders;
  }

  /**
   * (4 + $numberOfOpenAccountsForOwner) or (3 + $numberOfAllowedMarkets + $numberOfOpenAccountsForOwner) external API calls.
   *
   * @param target
   */
  async cancelOrder(target: CancelOrderRequest): Promise<Order> {
    const market = await this.getMarket(target.marketName);

    const owner = await this.getSolanaAccount(target.ownerAddress);

    let order: Order;

    try {
      order = await this.getOpenOrder({ ...target });
    } catch (exception: any) {
      if (exception instanceof OrderNotFoundError) {
        order = target as Order;
        order.status = OrderStatus.CANCELED;

        return order;
      }

      throw exception;
    }

    try {
      // order.signature = (
      //   await this.serumMarketCancelOrdersAndSettleFunds(
      //     market.market,
      //     this.connection,
      //     owner,
      //     [getNotNullOrThrowError(order.order)]
      //   )
      // ).cancellation;

      const cancellationSignature = await this.serumMarketCancelOrder(
        market.market,
        this.connection,
        owner,
        getNotNullOrThrowError<SerumOrder>(order.order)
      );

      const fundsSettlementSignatures = await this.settleFundsForMarket(
        target.marketName,
        target.ownerAddress
      );

      order.signatures = {
        cancellation: cancellationSignature,
        fundsSettlements: getNotNullOrThrowError<TransactionSignature[]>(
          fundsSettlementSignatures
        ),
      };

      order.status = OrderStatus.CANCELED;

      return order;
    } catch (exception: any) {
      if (
        exception.message.includes('It is unknown if it succeeded or failed.')
      ) {
        order.status = OrderStatus.CANCELATION_PENDING;

        return order;
      } else {
        throw exception;
      }
    }
  }

  /**
   * $numberOfTargets + $numberOfDifferentMarkets*$numberOfDifferentOwnersForEachMarket external API calls.
   *
   * @param targets
   */
  async cancelOrders(
    targets: CancelOrdersRequest[]
  ): Promise<IMap<string, Order>> {
    const ordersMap = IMap<Market, IMap<string, Order[]>>().asMutable();

    const ownersMap = IMap<string, Account>().asMutable();

    for (const target of targets) {
      const market = await this.getMarket(target.marketName);

      // TODO tune this method in order to call less the below operation.
      const openOrders = await this.getOpenOrders([{ ...target }]);

      let marketMap = ordersMap.get(market);
      if (!marketMap) {
        marketMap = IMap<string, Order[]>().asMutable();
        ordersMap.set(market, getNotNullOrThrowError(marketMap));
      }

      const owner = await this.getSolanaAccount(target.ownerAddress);
      const ownerPublicKeyString = owner.publicKey.toString();

      // Using a ownersMap is a workaround because the Account class does not provide good equality.
      if (!ownersMap.has(ownerPublicKeyString)) {
        ownersMap.set(ownerPublicKeyString, owner);
      }

      let ownerOrders = marketMap?.get(ownerPublicKeyString);
      if (!ownerOrders) {
        ownerOrders = [];
        marketMap?.set(ownerPublicKeyString, ownerOrders);
      }

      ownerOrders.push(...openOrders.values());
    }

    const canceledOrders = IMap<string, Order>().asMutable();
    for (const [market, marketMap] of ordersMap.entries()) {
      for (const [ownerPublicKeyString, orders] of marketMap.entries()) {
        const owner = getNotNullOrThrowError<Account>(
          ownersMap.get(ownerPublicKeyString)
        );

        const serumOrders = orders.map((order) =>
          getNotNullOrThrowError(order.order)
        ) as SerumOrder[];

        if (!serumOrders.length) continue;

        let status: OrderStatus;
        let signatures: TransactionSignatures = {};
        try {
          if (this.config.transactions.merge.cancelOrders) {
            const allSignatures = await promiseAllInBatches<
              SerumOrder[],
              TransactionSignatures
            >(
              async (item: SerumOrder[]): Promise<TransactionSignatures> => {
                return await this.serumMarketCancelOrders(
                  market.market,
                  this.connection,
                  owner,
                  item
                );
              },
              [
                ...splitInChunks<SerumOrder>(
                  serumOrders,
                  constants.orders.cancel.maxPerTransaction
                ),
              ]
            );

            signatures.cancellations = getNotNullOrThrowError(
              allSignatures.map((item) => item.cancellation)
            );

            // signatures.fundsSettlements = await this.settleFundsForMarket(
            //   market.name,
            //   owner.publicKey.toString()
            // );

            // signatures = {
            //   cancellation:
            //     cancelationAndFundsSettlementSignatures.cancellation,
            //   fundsSettlements:
            //     cancelationAndFundsSettlementSignatures.fundsSettlements,
            // };

            // const cancelationAndFundsSettlementSignatures =
            //   await this.serumMarketCancelOrdersAndSettleFunds(
            //     market.market,
            //     this.connection,
            //     owner,
            //     serumOrders
            //   );
            //
            // signatures = {
            //   cancellation:
            //     cancelationAndFundsSettlementSignatures.cancellation,
            //   fundsSettlements:
            //     cancelationAndFundsSettlementSignatures.fundsSettlements,
            // };
          } else {
            signatures.cancellations = [];
            for (const order of orders) {
              const cancellationSignature = await this.serumMarketCancelOrder(
                market.market,
                this.connection,
                owner,
                getNotNullOrThrowError<SerumOrder>(order.order)
              );

              order.signatures = {
                cancellation: cancellationSignature,
              };
            }

            signatures.fundsSettlements = await this.settleFundsForMarket(
              market.name,
              ownerPublicKeyString
            );
          }

          status = OrderStatus.CANCELED;
        } catch (exception: any) {
          if (
            exception.message.includes(
              'It is unknown if it succeeded or failed.'
            )
          ) {
            signatures = {};
            status = OrderStatus.CANCELATION_PENDING;
          } else {
            throw exception;
          }
        }

        if (orders.length) {
          for (const order of orders) {
            order.status = status;
            if (this.config.transactions.merge.cancelOrders) {
              order.signatures = signatures;
            } else {
              getNotNullOrThrowError<TransactionSignatures>(
                order.signatures
              ).fundsSettlements = signatures.fundsSettlements;
            }

            canceledOrders.set(
              getNotNullOrThrowError(
                order.order?.orderId.toString(),
                'Exchange id is not defined.'
              ),
              order
            );
          }
        }
      }
    }

    return canceledOrders;
  }

  /**
   * $numberOfOpenOrders external API calls.
   *
   * @param ownerAddress
   * @param marketName
   * @param marketNames
   */
  async cancelAllOrders(
    ownerAddress: string,
    marketName?: string,
    marketNames?: string[]
  ): Promise<IMap<string, Order>> {
    if (marketName) marketNames = [marketName];
    else if (!marketNames)
      marketNames = Array.from((await this.getAllMarkets()).keys());

    const requests: CancelOrdersRequest[] = marketNames.map((marketName) => ({
      marketName,
      ownerAddress,
    }));

    return this.cancelOrders(requests);
  }

  /**
   * 3*$numberOfOpenOrdersAccountsForMarket external API calls.
   *
   * @param marketName
   * @param ownerAddress
   */
  async settleFundsForMarket(
    marketName: string,
    ownerAddress: string
  ): Promise<TransactionSignature[]> {
    const market = await this.getMarket(marketName);
    const owner = await this.getSolanaAccount(ownerAddress);
    const signatures: TransactionSignature[] = [];

    // const fundsSettlements: {
    //   owner: Account,
    //   openOrders: SerumOpenOrders,
    //   baseWallet: PublicKey,
    //   quoteWallet: PublicKey,
    //   referrerQuoteWallet: PublicKey | null
    // }[] = [];

    for (const openOrders of await this.serumFindOpenOrdersAccountsForOwner(
      market.market,
      this.connection,
      owner.publicKey
    )) {
      if (
        openOrders.baseTokenFree.gt(new BN(0)) ||
        openOrders.quoteTokenFree.gt(new BN(0))
      ) {
        const base = await this.serumFindBaseTokenAccountsForOwner(
          market.market,
          this.connection,
          owner.publicKey,
          true
        );
        const baseWallet = base[0].pubkey;

        const quote = await this.serumFindQuoteTokenAccountsForOwner(
          market.market,
          this.connection,
          owner.publicKey,
          true
        );
        const quoteWallet = quote[0].pubkey;

        try {
          signatures.push(
            await this.serumSettleFunds(
              market.market,
              this.connection,
              owner,
              openOrders,
              baseWallet,
              quoteWallet,
              null,
              constants.events.limit.matchOrders,
              constants.events.limit.consumeEvents
            )
          );
        } catch (exception: any) {
          if (
            exception.message.includes(
              'It is unknown if it succeeded or failed.'
            )
          ) {
            throw new FundsSettlementError(
              `Unknown state when settling the funds for the market "${marketName}": ${exception.message}`
            );
          } else {
            throw exception;
          }
        }

        // fundsSettlements.push({
        //   owner,
        //   openOrders,
        //   baseWallet,
        //   quoteWallet,
        //   referrerQuoteWallet: null
        // });
      }
    }

    // try {
    //   return await this.serumSettleSeveralFunds(
    //     market.market,
    //     this.connection,
    //     fundsSettlements
    //   );
    // } catch (exception: any) {
    //   if (exception.message.includes('It is unknown if it succeeded or failed.')) {
    //     throw new FundsSettlementError(`Unknown state when settling the funds for the market "${marketName}": ${exception.message}`);
    //   } else {
    //     throw exception;
    //   }
    // }

    return signatures;
  }

  /**
   * 3*$numberOfOpenOrdersAccountsForMarket*$numberOfInformedMarkets external API calls.
   *
   * @param marketNames
   * @param ownerAddress
   */
  async settleFundsForMarkets(
    marketNames: string[],
    ownerAddress: string
  ): Promise<IMap<string, Fund[]>> {
    const funds = IMap<string, Fund[]>().asMutable();

    const settleFunds = async (marketName: string): Promise<void> => {
      const signatures = await this.settleFundsForMarket(
        marketName,
        ownerAddress
      );

      funds.set(marketName, signatures);
    };

    // The rate limits are defined here: https://docs.solana.com/cluster/rpc-endpoints
    await promiseAllInBatches(settleFunds, marketNames);

    return funds;
  }

  /**
   * 3*$numberOfOpenOrdersAccountsForMarket*$numberOfAllowedMarkets external API calls.
   *
   * @param ownerAddress
   */
  async settleAllFunds(ownerAddress: string): Promise<IMap<string, Fund[]>> {
    const marketNames = Array.from((await this.getAllMarkets()).keys());

    return this.settleFundsForMarkets(marketNames, ownerAddress);
  }
}
