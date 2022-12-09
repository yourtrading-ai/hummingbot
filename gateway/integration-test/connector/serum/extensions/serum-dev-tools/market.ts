import { DexInstructions, Market } from '@project-serum/serum';
import {
  OpenOrders,
  Order,
  OrderParams,
} from '@project-serum/serum/lib/market';
import {
  createInitializeAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Market as SerumMarket } from '@project-serum/serum';
import { Coin } from './coin';
import { getDecimalCount, withAssociatedTokenAccount } from './utils';
import { OrderType, SelfTradeBehaviour, TransactionWithSigners } from './types';

const REQUEST_QUEUE_SIZE = 5120 + 12; // https://github.com/mithraiclabs/psyoptions/blob/f0c9f73408a27676e0c7f156f5cae71f73f59c3f/programs/psy_american/src/lib.rs#L1003
const EVENT_QUEUE_SIZE = 262144 + 12; // https://github.com/mithraiclabs/psyoptions-ts/blob/ba1888ea83e634e1c7a8dad820fe67d053cf3f5c/packages/psy-american/src/instructions/initializeSerumMarket.ts#L84
const BIDS_SIZE = 65536 + 12; // Same reference as EVENT_QUEUE_SIZE
const ASKS_SIZE = 65536 + 12; // Same reference as EVENT_QUEUE_SIZE

export interface MarketAccounts {
  market: Keypair;
  requestQueue: Keypair;
  eventQueue: Keypair;
  bids: Keypair;
  asks: Keypair;
}

/**
 * A wrapper class around `serum-ts`'s `Market` class.
 */
export class DexMarket {
  private _address: PublicKey;

  private _serumMarket: Market;

  private _baseCoin: Coin;

  private _quoteCoin: Coin;

  private _marketSymbol: string;

  private constructor(
    address: PublicKey,
    serumMarket: Market,
    baseCoin: Coin,
    quoteCoin: Coin
  ) {
    this._address = address;
    this._serumMarket = serumMarket;
    this._baseCoin = baseCoin;
    this._quoteCoin = quoteCoin;
    this._marketSymbol = `${baseCoin.symbol}/${quoteCoin.symbol}`;
  }

  public get address() {
    return this._address;
  }

  public get serumMarket() {
    return this._serumMarket;
  }

  public get baseCoin() {
    return this._baseCoin;
  }

  public get quoteCoin() {
    return this._quoteCoin;
  }

  public get marketSymbol() {
    return this._marketSymbol;
  }

  /**
   * Load a `DexMarket` instance from a given market address.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param programID The address of the `serum-dex` program deployed.
   * @param marketAddress The address of the market to load.
   * @param baseCoin The base `Coin` object provided by the `Coin` class.
   * @param quoteCoin The quote `Coin` object provided by the `Coin` class.
   * @returns
   */
  static async load(
    connection: Connection,
    programID: PublicKey,
    marketAddress: PublicKey,
    baseCoin: Coin,
    quoteCoin: Coin
  ): Promise<DexMarket> {
    const serumMarket = await SerumMarket.load(
      connection,
      marketAddress,
      { commitment: 'confirmed' },
      programID
    );

    const dexMarket = new DexMarket(
      marketAddress,
      serumMarket,
      baseCoin,
      quoteCoin
    );

    return dexMarket;
  }

  /**
   * Create a `Transaction` object for creating the vaults required for a DexMarket.
   *
   * @param payer The `Keypair` of the account that will pay for the transaction.
   * @param vaultOwner The address assigned as the owner of the vault.
   * @param baseVault The Token Account that would be used as the base vault.
   * @param quoteVault The Token Account that would be used as the quote vault.
   * @param baseCoin The base `Coin` object provided by the `Coin` class.
   * @param quoteCoin The quote `Coin` object provided by the `Coin` class.
   * @param connection The `Connection` object to connect to Solana.
   * @returns
   */
  static async createMarketVaultsTransaction(
    payer: Keypair,
    vaultOwner: PublicKey,
    baseVault: Keypair,
    quoteVault: Keypair,
    baseCoin: Coin,
    quoteCoin: Coin,
    connection: Connection
  ): Promise<Transaction> {
    const tx = new Transaction();

    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: baseVault.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(165),
        space: 165,
        programId: TOKEN_PROGRAM_ID,
      }),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: quoteVault.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(165),
        space: 165,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccountInstruction(
        baseVault.publicKey,
        baseCoin.mint,
        vaultOwner,
        TOKEN_PROGRAM_ID
      ),
      createInitializeAccountInstruction(
        quoteVault.publicKey,
        quoteCoin.mint,
        vaultOwner,
        TOKEN_PROGRAM_ID
      )
    );

    return tx;
  }

  /**
   *  Create a `Transaction` object for creating the accounts required for a DexMarket.
   *
   * @param accounts The `MarketAccounts` object containing the accounts needed for initializing the market.
   * @param payer The `Keypair` object of the account that will pay for the transaction.
   * @param connection The `Connection` object to connect to Solana.
   * @param programID The address of the `serum-dex` program deployed.
   * @returns
   */
  static async createMarketAccountsInstructions(
    accounts: MarketAccounts,
    payer: Keypair,
    connection: Connection,
    programID: PublicKey
  ): Promise<TransactionInstruction[]> {
    const { market, requestQueue, eventQueue, bids, asks } = accounts;

    const marketIx = SystemProgram.createAccount({
      newAccountPubkey: market.publicKey,
      fromPubkey: payer.publicKey,
      space: Market.getLayout(programID).span,
      lamports: await connection.getMinimumBalanceForRentExemption(
        Market.getLayout(programID).span
      ),
      programId: programID,
    });

    const requestQueueIx = SystemProgram.createAccount({
      newAccountPubkey: requestQueue.publicKey,
      fromPubkey: payer.publicKey,
      space: REQUEST_QUEUE_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(
        REQUEST_QUEUE_SIZE
      ),
      programId: programID,
    });

    const eventQueueIx = SystemProgram.createAccount({
      newAccountPubkey: eventQueue.publicKey,
      fromPubkey: payer.publicKey,
      space: EVENT_QUEUE_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(
        EVENT_QUEUE_SIZE
      ),
      programId: programID,
    });

    const bidsIx = SystemProgram.createAccount({
      newAccountPubkey: bids.publicKey,
      fromPubkey: payer.publicKey,
      space: BIDS_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(BIDS_SIZE),
      programId: programID,
    });

    const asksIx = SystemProgram.createAccount({
      newAccountPubkey: asks.publicKey,
      fromPubkey: payer.publicKey,
      space: ASKS_SIZE,
      lamports: await connection.getMinimumBalanceForRentExemption(ASKS_SIZE),
      programId: programID,
    });

    return [marketIx, requestQueueIx, eventQueueIx, bidsIx, asksIx];
  }

  static sanityCheck(serumMarket: SerumMarket, price: number, size: number) {
    const formattedMinOrderSize =
      serumMarket.minOrderSize?.toFixed(
        getDecimalCount(serumMarket.minOrderSize)
      ) || serumMarket.minOrderSize;

    const formattedTickSize =
      serumMarket.tickSize?.toFixed(getDecimalCount(serumMarket.tickSize)) ||
      serumMarket.tickSize;

    const isIncrement = (num: any, step: any) =>
      Math.abs((num / step) % 1) < 1e-3 ||
      Math.abs(((num / step) % 1) - 1) < 1e-3;

    if (isNaN(price)) throw new Error('Invalid Price');

    if (isNaN(size)) throw new Error('Invalid Size');

    if (!isIncrement(size, serumMarket.minOrderSize))
      throw new Error(`Size must be an increment of ${formattedMinOrderSize}`);

    if (size < serumMarket.minOrderSize)
      throw new Error(`Size must be greater than ${formattedMinOrderSize}`);

    if (!isIncrement(price, serumMarket.tickSize))
      throw new Error(
        `Price: ${price} must be an increment of ${formattedTickSize}`
      );

    if (price < serumMarket.tickSize)
      throw new Error(`Price must be greater than ${formattedTickSize}`);
  }

  /**
   * Create a `Transaction` object for placing an order.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param owner The `Keypair` of the owner of the order.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param side The `Side` of the order.
   * @param orderType The `OrderType` of the order.
   * @param size The `size` of the order.
   * @param price The `price` of the order.
   * @param selfTradeBehaviour The `SelfTradeBehaviour` action to follow for the order placed.
   * @returns
   */
  static async getPlaceOrderTransaction(
    connection: Connection,
    owner: Keypair,
    serumMarket: SerumMarket,
    side: 'buy' | 'sell',
    orderType: OrderType,
    size: number,
    price: number,
    selfTradeBehaviour?: SelfTradeBehaviour
  ): Promise<TransactionWithSigners> {
    try {
      DexMarket.sanityCheck(serumMarket, price, size);
    } catch (e) {
      console.log(e);
      throw new Error('Sanity check failed');
    }

    const openOrders = await DexMarket.getOrCreateOpenOrderAccount(
      owner,
      serumMarket,
      connection
    );

    const transaction = new Transaction();
    const signers: Keypair[] = [];

    signers.push(owner);

    const baseCurrencyAccount = await withAssociatedTokenAccount(
      connection,
      serumMarket.baseMintAddress,
      owner,
      transaction
    );
    const quoteCurrencyAccount = await withAssociatedTokenAccount(
      connection,
      serumMarket.quoteMintAddress,
      owner,
      transaction
    );

    const payer = side === 'sell' ? baseCurrencyAccount : quoteCurrencyAccount;
    if (!payer) {
      throw new Error('Need an SPL token account for cost currency as payer');
    }

    const params: OrderParams<PublicKey> = {
      owner: owner.publicKey,
      payer,
      side,
      price,
      size,
      orderType,
      feeDiscountPubkey: null,
      openOrdersAddressKey: openOrders.address,
      selfTradeBehavior: selfTradeBehaviour,
    };

    const { transaction: placeOrderTx, signers: placeOrderSigners } =
      await serumMarket.makePlaceOrderTransaction(
        connection,
        params,
        120_000,
        120_000
      );

    transaction.add(placeOrderTx);
    signers.push(
      ...placeOrderSigners.map((signer) =>
        Keypair.fromSecretKey(signer.secretKey)
      )
    );

    return { transaction, signers };
  }

  /**
   * Place an order on the DexMarket.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param owner The `Keypair` of the owner of the order.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param side The `Side` of the order.
   * @param orderType The `OrderType` of the order.
   * @param size The `size` of the order.
   * @param price The `price` of the order.
   * @param selfTradeBehaviour The `SelfTradeBehaviour` action to follow for the order placed.
   * @returns
   */
  static async placeOrder(
    connection: Connection,
    owner: Keypair,
    serumMarket: SerumMarket,
    side: 'buy' | 'sell',
    orderType: OrderType,
    size: number,
    price: number,
    selfTradeBehaviour?: SelfTradeBehaviour
  ): Promise<string> {
    const { transaction, signers } = await DexMarket.getPlaceOrderTransaction(
      connection,
      owner,
      serumMarket,
      side,
      orderType,
      size,
      price,
      selfTradeBehaviour
    );

    const txSig = await connection.sendTransaction(transaction, signers);
    await connection.confirmTransaction(txSig, 'confirmed');

    return txSig;
  }

  /**
   * Create a `Transaction` object for cancelling an order.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param owner The `Keypair` of the owner of the order.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param order The `Order` object to cancel.
   * @returns
   */
  static async getCancelOrderTransaction(
    connection: Connection,
    owner: Keypair,
    serumMarket: SerumMarket,
    order: Order
  ): Promise<TransactionWithSigners> {
    const transaction = await serumMarket.makeCancelOrderTransaction(
      connection,
      owner.publicKey,
      order
    );

    return {
      transaction,
      signers: [owner],
    };
  }

  /**
   * Cancel an order on the DexMarket.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param owner The `PublicKey` of the owner of the order.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param order The `Order` object to cancel.
   * @returns
   */
  static async cancelOrder(
    connection: Connection,
    owner: Keypair,
    serumMarket: SerumMarket,
    order: Order
  ): Promise<string> {
    const { transaction, signers } = await DexMarket.getCancelOrderTransaction(
      connection,
      owner,
      serumMarket,
      order
    );

    const txSig = await connection.sendTransaction(transaction, signers);
    await connection.confirmTransaction(txSig, 'confirmed');

    return txSig;
  }

  /**
   * Get all orders placed by a keypair.
   *
   * @param owner The `Keypair` for which orders have to be fetched.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param connection The `Connection` object to connect to Solana.
   * @returns
   */
  static async getOrdersForOwner(
    owner: Keypair,
    serumMarket: SerumMarket,
    connection: Connection
  ): Promise<Order[]> {
    const orders = await serumMarket.loadOrdersForOwner(
      connection,
      owner.publicKey
    );

    return orders;
  }

  /**
   * Get or create an OpenOrder account for the specified owner.
   *
   * @param owner The `Keypair` for which OpenOrders account is required.
   * @param serumMarket The `Market` object from `serum-ts` package.
   * @param connection The `Connection` object to connect to Solana.
   * @returns
   */
  static async getOrCreateOpenOrderAccount(
    owner: Keypair,
    serumMarket: SerumMarket,
    connection: Connection
  ): Promise<OpenOrders> {
    let openOrdersAccounts = await serumMarket.findOpenOrdersAccountsForOwner(
      connection,
      owner.publicKey,
      0
    );

    if (openOrdersAccounts.length > 0) {
      return openOrdersAccounts[0];
    } else {
      const openOrderKP = Keypair.generate();

      const tx = new Transaction();
      tx.add(
        await OpenOrders.makeCreateAccountTransaction(
          connection,
          serumMarket.address,
          owner.publicKey,
          openOrderKP.publicKey,
          serumMarket.programId
        ),
        await DexInstructions.initOpenOrders({
          market: serumMarket.publicKey,
          openOrders: openOrderKP.publicKey,
          owner: owner.publicKey,
          programId: serumMarket.programId,
          marketAuthority: null,
        })
      );

      const txSig = await connection.sendTransaction(tx, [owner, openOrderKP]);
      await connection.confirmTransaction(txSig, 'confirmed');

      openOrdersAccounts = await serumMarket.findOpenOrdersAccountsForOwner(
        connection,
        owner.publicKey,
        0
      );

      if (openOrdersAccounts.length === 0) {
        throw new Error('Could not create open orders account');
      }

      return openOrdersAccounts[0];
    }
  }
}
