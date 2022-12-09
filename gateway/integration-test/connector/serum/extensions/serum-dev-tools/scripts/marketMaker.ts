import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
} from '@solana/web3.js';
import { Market as SerumMarket } from '@project-serum/serum';
import { FileKeypair } from '../fileKeypair';
import { DexMarket } from '../market';
import axios from 'axios';
import { delay, getDecimalCount, logIfVerbose, roundToDecimal } from '../utils';
import { MessageType } from '../types';

process.on('message', async (message: MessageType) => {
  if (message.action === 'start') {
    await marketMaker(message.args);
  }
});

const getMidPrice = async (
  baseSymbol: string,
  quoteSymbol: string
): Promise<number> => {
  const API_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${baseSymbol}&vs_currencies=${quoteSymbol}`;
  const response = await axios.get(API_URL);
  return response.data[baseSymbol][quoteSymbol];
};

const cancelOrders = async (
  owner: Keypair,
  serumMarket: SerumMarket,
  connection: Connection,
  isVerbose: boolean
) => {
  const orders = await serumMarket.loadOrdersForOwner(
    connection,
    owner.publicKey
  );

  const tx = new Transaction();
  const signersArray: Signer[][] = [];

  for (const order of orders) {
    const { transaction, signers } = await DexMarket.getCancelOrderTransaction(
      connection,
      owner,
      serumMarket,
      order
    );
    tx.add(transaction);
    signersArray.push(signers);
  }

  const signersUnion: Signer[] = [...new Set(signersArray.flat())];

  const txSig = await connection.sendTransaction(tx, signersUnion);

  await connection.confirmTransaction(txSig, 'confirmed');

  logIfVerbose(
    `----- ${orders.length} CancelOrders Confirmed -----`,
    isVerbose
  );
};

const placeOrders = async (
  owner: Keypair,
  serumMarket: SerumMarket,
  connection: Connection,
  opts: {
    orderCount: number;
    initialBidSize: number;
    baseGeckoSymbol: string;
    quoteGeckoSymbol: string;
    isVerbose: boolean;
  }
) => {
  let midPrice: number;
  try {
    midPrice = await getMidPrice(opts.baseGeckoSymbol, opts.quoteGeckoSymbol);
  } catch (e) {
    console.error("Couldn't fetch price from CoinGecko.");
    process.exit(1);
  }

  logIfVerbose(`Mid price: ${midPrice}`, opts.isVerbose);

  const { orderCount, initialBidSize } = opts;

  const tx = new Transaction();
  const signersArray: Signer[][] = [];

  let bidSizeMultiplier = 1;

  for (let i = 0; i < orderCount; i++, bidSizeMultiplier++) {
    const buyPrice = roundToDecimal(
      midPrice * (1 - 0.01 * (i + 1)),
      getDecimalCount(serumMarket.tickSize)
    );
    const sellPrice = roundToDecimal(
      midPrice * (1 + 0.01 * (i + 1)),
      getDecimalCount(serumMarket.tickSize)
    );

    const buySize = roundToDecimal(
      initialBidSize * bidSizeMultiplier,
      getDecimalCount(serumMarket.minOrderSize)
    );
    const sellSize = roundToDecimal(
      (initialBidSize * bidSizeMultiplier) / midPrice,
      getDecimalCount(serumMarket.minOrderSize)
    );

    const { transaction: buyTransaction, signers: buySigners } =
      await DexMarket.getPlaceOrderTransaction(
        connection,
        owner,
        serumMarket,
        'buy',
        'postOnly',
        buySize,
        buyPrice,
        'decrementTake'
      );
    tx.add(buyTransaction);
    signersArray.push(buySigners);

    logIfVerbose(
      `Bid placed with price ${buyPrice} and size ${buySize}`,
      opts.isVerbose
    );

    const { transaction: sellTransaction, signers: sellSigners } =
      await DexMarket.getPlaceOrderTransaction(
        connection,
        owner,
        serumMarket,
        'sell',
        'postOnly',
        sellSize,
        sellPrice,
        'decrementTake'
      );
    tx.add(sellTransaction);
    signersArray.push(sellSigners);

    logIfVerbose(
      `Ask placed with price ${sellPrice} and size ${sellSize}`,
      opts.isVerbose
    );
  }

  const signersUnion: Signer[] = [...new Set(signersArray.flat())];

  const txSig = await connection.sendTransaction(tx, signersUnion);

  await connection.confirmTransaction(txSig, 'confirmed');

  logIfVerbose(
    `----- ${orderCount * 2} PlaceOrders Confirmed -----`,
    opts.isVerbose
  );
};

const marketMaker = async (args: any) => {
  setTimeout(() => {
    console.log(`Exiting Market Maker @ ${process.pid}`);
    process.exit(0);
  }, Number.parseInt(args.duration));

  const isVerbose = args.verbose === 'true';

  const owner = FileKeypair.load(args.ownerFilePath);
  const connection = new Connection(args.rpcEndpoint, 'confirmed');

  const serumMarket = await SerumMarket.load(
    connection,
    new PublicKey(args.marketAddress),
    { commitment: 'confirmed' },
    new PublicKey(args.programID)
  );

  do {
    await placeOrders(owner.keypair, serumMarket, connection, {
      orderCount: Number.parseInt(args.orderCount),
      initialBidSize: Number.parseInt(args.initialBidSize),
      baseGeckoSymbol: args.baseGeckoSymbol,
      quoteGeckoSymbol: args.quoteGeckoSymbol,
      isVerbose,
    });
    await delay(10000);
    await cancelOrders(owner.keypair, serumMarket, connection, isVerbose);
    // eslint-disable-next-line no-constant-condition
  } while (true);
};
