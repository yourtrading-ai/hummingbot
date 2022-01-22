import {
  BookSide,
  BookSideLayout,
  Config,
  getAllMarkets as getAllMarketConfigs,
  getMarketByBaseSymbolAndKind as getMarketConfigByBaseSymbolAndKind,
  getMarketByPublicKey as getMarketConfigByPublicKey,
  getMultipleAccounts,
  getTokenBySymbol,
  GroupConfig,
  makeCancelPerpOrderInstruction,
  makeCancelSpotOrderInstruction,
  makeSettleFundsInstruction,
  MangoAccount,
  MangoClient,
  MangoGroup,
  MarketConfig,
  PerpMarket,
  PerpMarketLayout,
  PerpOrder,
  QUOTE_INDEX,
  RootBank,
  TokenInfo,
} from '@blockworks-foundation/mango-client';
import { Market, Orderbook } from '@project-serum/serum';
import { Order as SpotOrder } from '@project-serum/serum/lib/market';
import {
  Account,
  AccountInfo,
  PublicKey,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import { logger } from '../../../services/logger';
import { zipDict } from '../../../services/base';
import { Solana } from '../solana';
import { MangoConfig } from './mango.config';
import {
  InitializationError,
  SERVICE_UNITIALIZED_ERROR_CODE,
  SERVICE_UNITIALIZED_ERROR_MESSAGE,
} from '../../../services/error-handler';
import { FilledOrder, OrderBook, OrderInfo, SimpleOrder } from './mango.types';
import BN from 'bn.js';

class Mango {
  public mangoGroupConfig: GroupConfig;

  private static _instance: Mango;
  private solana: Solana = Solana.getInstance();
  private client: MangoClient;
  private _mangoGroup: MangoGroup | undefined;
  private tokenList: Record<string, TokenInfo> = {};
  private owners: Record<string, Account> = {};
  private _ready: boolean = false;

  constructor() {
    this.mangoGroupConfig = Config.ids().groups.filter(
      (group) => group.name === MangoConfig.config.groupName
    )[0];

    this.client = new MangoClient(
      this.solana.connection,
      this.mangoGroupConfig.mangoProgramId
    );
  }

  /// initialization

  public static getInstance(): Mango {
    if (!Mango._instance) {
      Mango._instance = new Mango();
    }

    return Mango._instance;
  }

  public async init() {
    if (!Solana.getInstance().ready())
      throw new InitializationError(
        SERVICE_UNITIALIZED_ERROR_MESSAGE('SOL'),
        SERVICE_UNITIALIZED_ERROR_CODE
      );

    logger.info(`- fetching mango group`);
    this._mangoGroup = await this.client.getMangoGroup(
      this.mangoGroupConfig.publicKey
    );

    for (const token of this._mangoGroup.tokens) {
      this.tokenList[token.mint.toBase58()] = token;
    }

    // needs to be updated to fetch current borrow and deposit rates
    logger.info(`- loading root banks`);
    await this._mangoGroup.loadRootBanks(this.solana.connection);

    //
    logger.info(`- loading cache`);
    await this._mangoGroup.loadCache(this.solana.connection);

    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  public getTokenByAddress(address: string): TokenInfo {
    return this.tokenList[address];
  }

  private async getOwner(mangoAccount: MangoAccount): Promise<Account> {
    if (!this.owners[mangoAccount.owner.toBase58()])
      this.owners[mangoAccount.owner.toBase58()] = new Account(
        (await this.solana.getKeypair(mangoAccount.owner)).secretKey
      );
    return this.owners[mangoAccount.owner.toBase58()];
  }

  // to easily check initialization
  public mangoGroup(): MangoGroup {
    if (!this._mangoGroup)
      throw new InitializationError(
        SERVICE_UNITIALIZED_ERROR_MESSAGE('MANGO'),
        SERVICE_UNITIALIZED_ERROR_CODE
      );
    return <MangoGroup>this._mangoGroup;
  }

  /**
   * For some operations, one needs to refresh the mango group's caches.
   */
  public async refreshMangoGroup() {
    await this.mangoGroup().loadCache(this.solana.connection);
    await this.mangoGroup().loadRootBanks(this.solana.connection);
  }

  public async getFees(marketKind: 'spot' | 'perp') {
    // TODO: For now that's ok, but get fees dynamically from chain.
    if (marketKind === 'spot') return { maker: 0.0, taker: 0.00024 };
    else if (marketKind === 'perp') return { maker: -0.0004, taker: 0.0005 };
    else
      throw new RangeError(
        `Invalid marketKind ${marketKind}, choose 'spot' or 'perp'`
      );
  }

  /// accounts

  public async fetchMangoAccounts(address: PublicKey): Promise<MangoAccount[]> {
    try {
      return await this.client.getMangoAccountsForOwner(
        this.mangoGroup(),
        address
      );
    } catch (error) {
      throw new Error(
        `Error retrieving mango accounts for ${address.toBase58()}`
      );
    }
  }

  public async getMangoAccountFromPublicKey(
    pk: PublicKey
  ): Promise<MangoAccount> {
    return await this.client.getMangoAccount(
      pk,
      this.mangoGroup().dexProgramId
    );
  }

  /// market

  // e.g. USDT-USDC, BTC-USDC, BTC-PERP...
  // MarketConfigs contain all static information about a market
  private getMarketConfigByName(marketName: string): MarketConfig {
    const s = marketName.split('-');
    if (s[1] == 'PERP') {
      return getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        s[0],
        'perp'
      );
    } else {
      return getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        s[0],
        'spot'
      );
    }
  }

  public getAllMarketConfigs(): MarketConfig[] {
    return getAllMarketConfigs(this.mangoGroupConfig);
  }

  public async fetchMarket(marketName: string): Promise<Market | PerpMarket> {
    const marketConfig = this.getMarketConfigByName(marketName);
    const marketAccountInfo = await this.solana.connection.getAccountInfo(
      marketConfig.publicKey
    );
    if (marketAccountInfo && marketConfig)
      return this.configToMarket(marketConfig, marketAccountInfo);
    else
      throw new Error(
        `Error retrieving AccountInfo for Mango market ${marketConfig.name}`
      );
  }

  /**
   * Fetches requested markets as marketName -> Market dictionary.
   * @param marketConfigs
   */
  public async fetchMarkets(
    marketConfigs?: MarketConfig[]
  ): Promise<Record<string, Market | PerpMarket>> {
    if (marketConfigs === undefined) {
      marketConfigs = this.getAllMarketConfigs();
    }
    const marketPks = marketConfigs.map((m) => m.publicKey);
    const marketAccountInfos = await getMultipleAccounts(
      this.solana.connection,
      marketPks
    );
    const marketNames = marketConfigs.map((m) => m.name);
    const marketAccounts = marketConfigs.map(
      (config: MarketConfig, i: number) => {
        return this.configToMarket(config, marketAccountInfos[i].accountInfo);
      }
    );
    return zipDict(marketNames, marketAccounts);
  }

  private configToMarket(
    config: MarketConfig,
    marketAccountInfo: AccountInfo<Buffer>
  ): Market | PerpMarket {
    if (config.kind === 'spot') {
      const decoded = Market.getLayout(
        this.mangoGroupConfig.mangoProgramId
      ).decode(marketAccountInfo.data);
      return new Market(
        decoded,
        config.baseDecimals,
        config.quoteDecimals,
        undefined,
        this.mangoGroupConfig.serumProgramId
      );
    }
    if (config.kind === 'perp') {
      const decoded = PerpMarketLayout.decode(marketAccountInfo.data);
      return new PerpMarket(
        config.publicKey,
        config.baseDecimals,
        config.quoteDecimals,
        decoded
      );
    }
    throw new RangeError(`Invalid MarketConfig.kind: ${config.kind}`);
  }

  // orderbooks

  public async fetchOrderBook(market: Market | PerpMarket): Promise<OrderBook> {
    return {
      market: {
        account: market,
        config: <MarketConfig>(
          getMarketConfigByPublicKey(this.mangoGroupConfig, market.publicKey)
        ),
      },
      bids: await market
        .loadBids(this.solana.connection)
        .then((value) => value.getL2(1000))
        .then((l2) =>
          l2.map<SimpleOrder>((order) => {
            return {
              price: order[0],
              size: order[1],
            };
          })
        ),
      asks: await market
        .loadAsks(this.solana.connection)
        .then((value) => value.getL2(1000))
        .then((l2) =>
          l2.map<SimpleOrder>((order) => {
            return {
              price: order[0],
              size: order[1],
            };
          })
        ),
    };
  }

  // orders

  /**
   * Returns an array of arrays, the first index
   * @param marketConfigs
   */
  public async fetchOrders(
    marketConfigs?: MarketConfig[]
  ): Promise<OrderInfo[][]> {
    if (marketConfigs === undefined) {
      marketConfigs = this.getAllMarketConfigs();
    }

    const bidsAndAsksAccountInfos = await getMultipleAccounts(
      this.solana.connection,
      marketConfigs.map((m) => [m.bidsKey, m.asksKey]).flat()
    );

    const accountInfos: { [key: string]: AccountInfo<Buffer> } = {};
    bidsAndAsksAccountInfos.forEach(({ publicKey, accountInfo }) => {
      accountInfos[publicKey.toBase58()] = accountInfo;
    });

    const markets = await this.fetchMarkets();

    return Object.entries(markets).map(([name, market]) => {
      const marketConfig = this.getMarketConfigByName(name);
      if (marketConfig) {
        if (market instanceof Market) {
          return this.parseSpotOrders(market, marketConfig, accountInfos);
        } else if (market instanceof PerpMarket) {
          return this.parsePerpOpenOrders(market, marketConfig, accountInfos);
        } else {
          throw new Error(`Invalid market type: ${typeof market}`);
        }
      } else {
        throw new Error(`Unknown market name: ${name}`);
      }
    });
  }

  public getSpotOpenOrdersAccount(
    marketConfig: MarketConfig,
    mangoAccount: MangoAccount
  ): PublicKey | null {
    const spotOpenOrdersAccount =
      mangoAccount.spotOpenOrdersAccounts[marketConfig.marketIndex];
    return spotOpenOrdersAccount ? spotOpenOrdersAccount.publicKey : null;
  }

  public async fetchMostRecentPrice(
    market: Market | PerpMarket
  ): Promise<FilledOrder> {
    const fillEvent = (await market.loadFills(this.solana.connection, 1))[0];
    return Mango.parseFilledOrder(market, fillEvent);
  }

  private static parseFilledOrder(
    market: Market | PerpMarket,
    fillEvent: any
  ): FilledOrder {
    return {
      fee: market instanceof Market ? fillEvent.feeCost : fillEvent.fee,
      orderId: fillEvent.orderId,
      clientOrderId: fillEvent.clientOrderId,
      price: fillEvent.price,
      side: market instanceof Market ? fillEvent.side : fillEvent.takerSide,
      size: market instanceof Market ? fillEvent.size : fillEvent.quantity,
      timestamp: Date.now().toString(),
    };
  }

  /**
   * Fetches all recent fills for given MangoAccount
   * @param mangoAccount User's mango account
   */
  public async fetchAllSpotFills(
    mangoAccount: MangoAccount
  ): Promise<FilledOrder[]> {
    const allMarketConfigs = this.getAllMarketConfigs();
    const allMarkets = await this.fetchMarkets();

    // merge
    // 1. latest fills from on-chain
    let allRecentMangoAccountSpotFills: any[] = [];
    // 2. historic from off-chain REST service
    let allButRecentMangoAccountSpotFills: any[] = [];

    for (const config of allMarketConfigs) {
      if (config.kind === 'spot') {
        const openOrdersAccount =
          mangoAccount.spotOpenOrdersAccounts[config.marketIndex];
        if (openOrdersAccount === undefined) {
          continue;
        }
        const response = await fetch(
          `https://event-history-api.herokuapp.com/trades/open_orders/${openOrdersAccount.publicKey.toBase58()}`
        );
        const responseJson = await response.json();
        allButRecentMangoAccountSpotFills =
          allButRecentMangoAccountSpotFills.concat(
            responseJson?.data ? responseJson.data : []
          );

        const recentMangoAccountSpotFills: any[] = await allMarkets[config.name]
          .loadFills(this.solana.connection, 10000)
          .then((fills) => {
            fills = fills.filter((fill) => {
              return openOrdersAccount?.publicKey
                ? fill.openOrders.equals(openOrdersAccount?.publicKey)
                : false;
            });
            return fills.map((fill) => ({ ...fill, marketName: config.name }));
          });
        allRecentMangoAccountSpotFills = allRecentMangoAccountSpotFills.concat(
          recentMangoAccountSpotFills
        );
      }
    }

    const newMangoAccountSpotFills = allRecentMangoAccountSpotFills.filter(
      (fill: any) =>
        !allButRecentMangoAccountSpotFills.flat().find((t: any) => {
          if (t.orderId) {
            return t.orderId === fill.orderId?.toString();
          } else {
            return t.seqNum === fill.seqNum?.toString();
          }
        })
    );

    return [
      ...newMangoAccountSpotFills,
      ...allButRecentMangoAccountSpotFills,
    ].map((fill) => {
      return Mango.parseFilledOrder(allMarkets[fill.marketName], fill);
    });
  }

  public async fetchAllPerpFills(
    mangoAccount: MangoAccount
  ): Promise<FilledOrder[]> {
    const allMarkets = await this.fetchMarkets();

    // merge
    // 1. latest fills from on-chain
    let allRecentMangoAccountPerpFills: any[] = [];
    // 2. historic from off-chain REST service
    const response = await fetch(
      `https://event-history-api.herokuapp.com/perp_trades/${mangoAccount.publicKey.toBase58()}`
    );
    const responseJson = await response.json();
    const allButRecentMangoAccountPerpFills = responseJson?.data || [];
    for (const config of this.getAllMarketConfigs()) {
      if (config.kind === 'perp') {
        const recentMangoAccountPerpFills: any[] = await allMarkets[config.name]
          .loadFills(this.solana.connection)
          .then((fills) => {
            fills = fills.filter(
              (fill) =>
                fill.taker.equals(mangoAccount.publicKey) ||
                fill.maker.equals(mangoAccount.publicKey)
            );

            return fills.map((fill) => ({ ...fill, marketName: config.name }));
          });

        allRecentMangoAccountPerpFills = allRecentMangoAccountPerpFills.concat(
          recentMangoAccountPerpFills
        );
      }
    }
    const newMangoAccountPerpFills = allRecentMangoAccountPerpFills.filter(
      (fill: any) =>
        !allButRecentMangoAccountPerpFills.flat().find((t: any) => {
          if (t.orderId) {
            return t.orderId === fill.orderId?.toString();
          } else {
            return t.seqNum === fill.seqNum?.toString();
          }
        })
    );

    return [
      ...newMangoAccountPerpFills,
      ...allButRecentMangoAccountPerpFills,
    ].map((fill) => {
      return Mango.parseFilledOrder(allMarkets[fill.marketName], fill);
    });
  }

  public async placeOrder(
    mangoAccount: MangoAccount,
    market: Market | PerpMarket,
    side: 'buy' | 'sell',
    quantity: number,
    price?: number,
    orderType: 'ioc' | 'postOnly' | 'market' | 'limit' = 'limit',
    clientOrderId?: number
  ): Promise<TransactionSignature> {
    const owner = await this.getOwner(mangoAccount);
    if (market instanceof PerpMarket) {
      // TODO: this is a workaround, mango-v3 has a assertion for price>0 for all order types
      // this will be removed soon hopefully
      price = orderType !== 'market' ? price : 1;
      return await this.client.placePerpOrder(
        this.mangoGroup(),
        mangoAccount,
        this.mangoGroup().mangoCache,
        market,
        owner,
        side,
        <number>price,
        quantity,
        orderType,
        clientOrderId
      );
    } else {
      // serum doesn't really support market orders, calculate a pseudo market price
      price =
        orderType !== 'market'
          ? price
          : await this.calculateMarketOrderPrice(market, quantity, side);

      return await this.client.placeSpotOrder(
        this.mangoGroup(),
        mangoAccount,
        this.mangoGroup().mangoCache,
        market,
        owner,
        side,
        <number>price,
        quantity,
        orderType === 'market' ? 'limit' : orderType,
        new BN(<number>clientOrderId)
      );
    }
  }

  private async calculateMarketOrderPrice(
    market: Market | PerpMarket,
    quantity: number,
    side: 'buy' | 'sell'
  ): Promise<number> {
    const orderBook = await this.fetchOrderBook(market);
    const orders: SimpleOrder[] =
      side === 'buy' ? orderBook.asks : orderBook.bids;

    let acc = 0;
    let selectedOrder;
    for (const order of orders) {
      acc += order.size;
      if (acc >= quantity) {
        selectedOrder = order;
        break;
      }
    }
    if (!selectedOrder) {
      throw new Error('Orderbook empty!');
    }
    if (side === 'buy') {
      return selectedOrder.price * 1.05;
    } else {
      return selectedOrder.price * 0.95;
    }
  }

  public async cancelAllOrders(
    mangoAccount: MangoAccount,
    markets?: Record<string, Market | PerpMarket>
  ): Promise<void> {
    const tempMarkets = markets ?? (await this.fetchMarkets());
    const orders = (await this.fetchOrders()).flat();
    const transactions = await Promise.all(
      orders.map((orderInfo) =>
        this.buildCancelOrderTransaction(
          mangoAccount,
          orderInfo,
          tempMarkets[orderInfo.market.config.name]
        )
      )
    );

    let i;
    const j = transactions.length;
    // assuming we can fit 10 cancel order transactions in a solana transaction
    // we could switch to computing actual transactionSize every time we add an
    // instruction and use a dynamic chunk size
    const chunk = 10;
    const transactionsToSend: Transaction[] = [];

    for (i = 0; i < j; i += chunk) {
      const transactionsChunk = transactions.slice(i, i + chunk);
      const transactionToSend = new Transaction();
      for (const transaction of transactionsChunk) {
        for (const instruction of transaction.instructions) {
          transactionToSend.add(instruction);
        }
      }
      transactionsToSend.push(transactionToSend);
    }

    for (const transaction of transactionsToSend) {
      await this.client.sendTransaction(
        transaction,
        await this.solana.getKeypair(mangoAccount.publicKey),
        []
      );
    }
  }

  public async cancelOrder(
    mangoAccount: MangoAccount,
    orderInfo: OrderInfo,
    market?: Market | PerpMarket
  ): Promise<TransactionSignature> {
    const owner = await this.getOwner(mangoAccount);
    if (orderInfo.market.config.kind === 'perp') {
      const perpMarketConfig = getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        orderInfo.market.config.baseSymbol,
        'perp'
      );
      if (market === undefined) {
        market = await this.mangoGroup().loadPerpMarket(
          this.solana.connection,
          perpMarketConfig.marketIndex,
          perpMarketConfig.baseDecimals,
          perpMarketConfig.quoteDecimals
        );
      }
      return await this.client.cancelPerpOrder(
        this.mangoGroup(),
        mangoAccount,
        owner,
        market as PerpMarket,
        orderInfo.order as PerpOrder
      );
    } else {
      const spotMarketConfig = getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        orderInfo.market.config.baseSymbol,
        'spot'
      );
      if (market === undefined) {
        market = await Market.load(
          this.solana.connection,
          spotMarketConfig.publicKey,
          undefined,
          this.mangoGroupConfig.serumProgramId
        );
      }
      return await this.client.cancelSpotOrder(
        this.mangoGroup(),
        mangoAccount,
        owner,
        market as Market,
        <SpotOrder>orderInfo.order
      );
    }
  }

  public async buildCancelOrderTransaction(
    mangoAccount: MangoAccount,
    orderInfo: OrderInfo,
    market?: Market | PerpMarket
  ): Promise<Transaction> {
    const owner = await this.getOwner(mangoAccount);
    if (orderInfo.market.config.kind === 'perp') {
      const perpMarketConfig = getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        orderInfo.market.config.baseSymbol,
        'perp'
      );
      if (market === undefined) {
        market = await this.mangoGroup().loadPerpMarket(
          this.solana.connection,
          perpMarketConfig.marketIndex,
          perpMarketConfig.baseDecimals,
          perpMarketConfig.quoteDecimals
        );
      }
      return this.buildCancelPerpOrderInstruction(
        this.mangoGroup(),
        mangoAccount,
        owner,
        market as PerpMarket,
        orderInfo.order as PerpOrder
      );
    } else {
      const spotMarketConfig = getMarketConfigByBaseSymbolAndKind(
        this.mangoGroupConfig,
        orderInfo.market.config.baseSymbol,
        'spot'
      );
      if (market === undefined) {
        market = await Market.load(
          this.solana.connection,
          spotMarketConfig.publicKey,
          undefined,
          this.mangoGroupConfig.serumProgramId
        );
      }
      return this.buildCancelSpotOrderTransaction(
        this.mangoGroup(),
        mangoAccount,
        owner,
        market as Market,
        orderInfo.order as SpotOrder
      );
    }
  }

  public async getOrderByOrderId(orderId: string): Promise<OrderInfo[]> {
    const orders = (await this.fetchOrders()).flat();
    return orders.filter(
      (orderInfo) => orderInfo.order.orderId.toString() === orderId
    );
  }

  public async getOrderByClientId(clientId: string): Promise<OrderInfo[]> {
    const orders = (await this.fetchOrders()).flat();
    return orders.filter(
      (orderInfo) =>
        orderInfo.order.clientId?.toNumber().toString() === clientId
    );
  }

  public async withdraw(
    mangoAccount: MangoAccount,
    tokenSymbol: string,
    amount: number
  ): Promise<TransactionSignature> {
    const tokenToWithdraw = getTokenBySymbol(
      this.mangoGroupConfig,
      tokenSymbol
    );
    const tokenIndex = this.mangoGroup().getTokenIndex(tokenToWithdraw.mintKey);
    if (this.mangoGroup().rootBankAccounts[tokenIndex]) {
      return this.client.withdraw(
        this.mangoGroup(),
        mangoAccount,
        await this.getOwner(mangoAccount),
        this.mangoGroup().tokens[tokenIndex].rootBank,
        (<RootBank>this.mangoGroup().rootBankAccounts[tokenIndex])
          .nodeBankAccounts[0].publicKey,
        (<RootBank>this.mangoGroup().rootBankAccounts[tokenIndex])
          .nodeBankAccounts[0].vault,
        Number(amount),
        false
      );
    } else throw new Error();
  }

  /// private

  private parseSpotOrders(
    market: Market,
    config: MarketConfig,
    accountInfos: { [key: string]: AccountInfo<Buffer> },
    mangoAccount?: MangoAccount
  ): OrderInfo[] {
    const bidData = accountInfos[market['_decoded'].bids.toBase58()]?.data;
    const askData = accountInfos[market['_decoded'].asks.toBase58()]?.data;

    const bidOrderBook =
      market && bidData
        ? Orderbook.decode(market, bidData)
        : ([] as SpotOrder[]);
    const askOrderBook =
      market && askData
        ? Orderbook.decode(market, askData)
        : ([] as SpotOrder[]);

    let openOrdersForMarket = [...bidOrderBook, ...askOrderBook];
    if (mangoAccount !== undefined) {
      const openOrders =
        mangoAccount.spotOpenOrdersAccounts[config.marketIndex];
      if (!openOrders) return [];
      openOrdersForMarket = openOrdersForMarket.filter((o) =>
        o.openOrdersAddress.equals(openOrders.address)
      );
    }

    return openOrdersForMarket.map<OrderInfo>((order) => ({
      order,
      market: { account: market, config },
    }));
  }

  private parsePerpOpenOrders(
    market: PerpMarket,
    config: MarketConfig,
    accountInfos: { [key: string]: AccountInfo<Buffer> },
    mangoAccount?: MangoAccount
  ): OrderInfo[] {
    const bidData = accountInfos[market.bids.toBase58()]?.data;
    const askData = accountInfos[market.asks.toBase58()]?.data;

    const bidOrderBook =
      market && bidData
        ? new BookSide(market.bids, market, BookSideLayout.decode(bidData))
        : ([] as PerpOrder[]);
    const askOrderBook =
      market && askData
        ? new BookSide(market.asks, market, BookSideLayout.decode(askData))
        : ([] as PerpOrder[]);

    let openOrdersForMarket = [...bidOrderBook, ...askOrderBook];
    if (mangoAccount !== undefined) {
      openOrdersForMarket = openOrdersForMarket.filter((o) =>
        o.owner.equals(mangoAccount.publicKey)
      );
    }

    return openOrdersForMarket.map<OrderInfo>((order) => ({
      order,
      market: { account: market, config },
    }));
  }

  private buildCancelPerpOrderInstruction(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account,
    perpMarket: PerpMarket,
    order: PerpOrder,
    invalidIdOk = false // Don't throw error if order is invalid
  ): Transaction {
    const instruction = makeCancelPerpOrderInstruction(
      this.mangoGroupConfig.mangoProgramId,
      mangoGroup.publicKey,
      mangoAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      order,
      invalidIdOk
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    return transaction;
  }

  private async buildCancelSpotOrderTransaction(
    mangoGroup: MangoGroup,
    mangoAccount: MangoAccount,
    owner: Account,
    spotMarket: Market,
    order: SpotOrder
  ): Promise<Transaction> {
    const transaction = new Transaction();
    const instruction = makeCancelSpotOrderInstruction(
      this.mangoGroupConfig.mangoProgramId,
      mangoGroup.publicKey,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      mangoGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order
    );
    transaction.add(instruction);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId
    );

    const marketIndex = mangoGroup.getSpotMarketIndex(spotMarket.publicKey);
    if (!mangoGroup.rootBankAccounts.length) {
      await mangoGroup.loadRootBanks(this.solana.connection);
    }
    const baseRootBank = mangoGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = mangoGroup.rootBankAccounts[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }

    const settleFundsInstruction = makeSettleFundsInstruction(
      this.mangoGroupConfig.mangoProgramId,
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      owner.publicKey,
      mangoAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      mangoAccount.spotOpenOrders[marketIndex],
      mangoGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      mangoGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      mangoGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner
    );
    transaction.add(settleFundsInstruction);

    return transaction;
  }
}

export default Mango;
