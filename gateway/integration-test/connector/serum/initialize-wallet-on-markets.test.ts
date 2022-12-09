import { Keypair, PublicKey } from '@solana/web3.js';
import {
  Coin,
  DexMarket,
  OrderType,
  SelfTradeBehaviour,
} from './extensions/serum-dev-tools';
import bs58 from 'bs58';
import { Solana } from '../../../src/chains/solana/solana';
import { Serum } from '../../../src/connectors/serum/serum';
import { unpatch } from '../../../test/services/patch';
import { disablePatches } from '../../../test/chains/solana/serum/fixtures/patches/patches';
import { default as config } from '../../../test/chains/solana/serum/fixtures/config';

jest.setTimeout(60 * 60 * 1000);

disablePatches();

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

describe('Serum Dev Tools', () => {
  const ownerPrivateKey =
    process.env['TEST_SOLANA_WALLET_PRIVATE_KEY'] ||
    config.solana.wallet.owner.privateKey;

  it('Initialize wallet on markets placing orders', async () => {
    const keypair = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));

    const connection = serum.getConnection();

    const markets = [
      {
        marketName: 'SOL/USDC',
        marketAddress: '8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6',
        baseTokenName: 'SOL',
        baseTokenAddress: 'So11111111111111111111111111111111111111112',
        quoteTokenName: 'USDC',
        quoteTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        programId: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
        orderSide: 'buy',
        orderType: 'postOnly',
        orderSize: 0.1,
        orderPrice: 1,
        orderSelfTradeBehavior: 'abortTransaction',
      },
      // {
      //   marketName: 'WETH/USDC',
      //   marketAddress: 'FZxi3yWkE5mMjyaZj6utmYL54QQYfMCKMcLaQZq4UwnA',
      //   baseTokenName: 'WETH',
      //   baseTokenAddress: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
      //   quoteTokenName: 'USDC',
      //   quoteTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      //   programId: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
      //   orderSide: 'buy',
      //   orderType: 'postOnly',
      //   orderSize: 0.1,
      //   orderPrice: 1,
      //   orderSelfTradeBehavior: 'abortTransaction',
      // },
      // {
      //   marketName: 'USDT/USDC',
      //   marketAddress: 'B2na8Awyd7cpC59iEU43FagJAPLigr3AP3s38KM982bu',
      //   baseTokenName: 'USDT',
      //   baseTokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      //   quoteTokenName: 'USDC',
      //   quoteTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      //   programId: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
      //   orderSide: 'buy',
      //   orderType: 'postOnly',
      //   orderSize: 1,
      //   orderPrice: 0.1,
      //   orderSelfTradeBehavior: 'abortTransaction',
      // },
      // {
      //   marketName: 'mSOL/USDC',
      //   marketAddress: '9Lyhks5bQQxb9EyyX55NtgKQzpM4WK7JCmeaWuQ5MoXD',
      //   baseTokenName: 'mSOL',
      //   baseTokenAddress: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      //   quoteTokenName: 'USDC',
      //   quoteTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      //   programId: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
      //   orderSide: 'buy',
      //   orderType: 'postOnly',
      //   orderSize: 0.1,
      //   orderPrice: 0.1,
      //   orderSelfTradeBehavior: 'abortTransaction',
      // },
      // {
    ];

    for (const market of markets) {
      const programId = new PublicKey(market.programId);
      const marketAddress = new PublicKey(market.marketAddress);
      const baseAddress = new PublicKey(market.baseTokenAddress);
      const quoteAddress = new PublicKey(market.quoteTokenAddress);

      const baseCoin = await Coin.load(
        connection,
        market.baseTokenName,
        baseAddress,
        null as unknown as Keypair,
        null
      );

      const quoteCoin = await Coin.load(
        connection,
        market.quoteTokenName,
        quoteAddress,
        null as unknown as Keypair,
        null
      );

      const dexMarket = await DexMarket.load(
        connection,
        programId,
        marketAddress,
        baseCoin,
        quoteCoin
      );

      const transactionSignature = await DexMarket.placeOrder(
        connection,
        keypair,
        dexMarket.serumMarket,
        market.orderSide as 'buy' | 'sell',
        market.orderType as OrderType,
        market.orderSize,
        market.orderPrice,
        market.orderSelfTradeBehavior as SelfTradeBehaviour
      );

      console.log(
        `\
Market: ${market.marketName}
POST ${market.orderType} ${market.orderSide} order of ${market.orderSize} ${market.baseTokenName} by ${market.orderPrice} ${market.quoteTokenName}
Signature: ${transactionSignature}\
        `
      );
    }
  });
});
