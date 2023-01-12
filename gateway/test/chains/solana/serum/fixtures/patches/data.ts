import { Orderbook } from '@project-serum/serum/lib/market';
import { Slab } from '@project-serum/serum/lib/slab';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { SerumMarket } from '../../../../../../src/connectors/serum/serum.types';

const data = new Map<string, any>();

const slab = Slab.decode(
  Buffer.from(
    '0900000000000000020000000000000008000000000000000400000000000000010000001e00000000000040952fe4da5c1f3c860200000004000000030000000d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d7b0000000000000000000000000000000200000002000000000000a0ca17726dae0f1e43010000001111111111111111111111111111111111111111111111111111111111111111410100000000000000000000000000000200000001000000d20a3f4eeee073c3f60fe98e010000000d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d7b000000000000000000000000000000020000000300000000000040952fe4da5c1f3c8602000000131313131313131313131313131313131313131313131313131313131313131340e20100000000000000000000000000010000001f0000000500000000000000000000000000000005000000060000000d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d7b0000000000000000000000000000000200000004000000040000000000000000000000000000001717171717171717171717171717171717171717171717171717171717171717020000000000000000000000000000000100000020000000000000a0ca17726dae0f1e430100000001000000020000000d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d7b000000000000000000000000000000040000000000000004000000000000000000000000000000171717171717171717171717171717171717171717171717171717171717171702000000000000000000000000000000030000000700000005000000000000000000000000000000171717171717171717171717171717171717171717171717171717171717171702000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', // noqa: mock
    'hex'
  )
);

for (const node of slab.nodes) {
  if (node.leafNode) node.leafNode.key = new BN('31219269670346045155772'); // noqa: mock

  if (node.innerNode) node.innerNode.key = new BN('31219269670346045155772'); // noqa: mock
}

// Tokens information
data.set('solana/getTokenList', {
  name: 'Solana Token List',
  logoURI:
    'https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/solana/info/logo.png',
  keywords: ['solana', 'spl'],
  tags: {
    stablecoin: {
      name: 'stablecoin',
      description:
        'Tokens that are fixed to an external asset, e.g. the US dollar',
    },
    ethereum: {
      name: 'ethereum',
      description: 'Asset bridged from ethereum',
    },
    'lp-token': {
      name: 'lp-token',
      description: 'Asset representing liquidity provider token',
    },
    'wrapped-sollet': {
      name: 'wrapped-sollet',
      description: 'Asset wrapped using sollet bridge',
    },
    wrapped: {
      name: 'wrapped',
      description: 'Asset wrapped using wormhole bridge',
    },
    leveraged: {
      name: 'leveraged',
      description: 'Leveraged asset',
    },
    bull: {
      name: 'bull',
      description: 'Leveraged Bull asset',
    },
    bear: {
      name: 'bear',
      description: 'Leveraged Bear asset',
    },
    nft: {
      name: 'nft',
      description: 'Non-fungible token',
    },
    'security-token': {
      name: 'security-token',
      description:
        'Tokens that are used to gain access to an electronically restricted resource',
    },
    'utility-token': {
      name: 'utility-token',
      description:
        'Tokens that are designed to be spent within a certain blockchain ecosystem e.g. most of the SPL-Tokens',
    },
    'tokenized-stock': {
      name: 'tokenized-stock',
      description:
        'Tokenized stocks are tokenized derivatives that represent traditional securities, particularly shares in publicly firms traded on regulated exchanges',
    },
  },
  timestamp: '2021-03-03T19:57:21+0000',
  tokens: [
    {
      chainId: 101,
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Wrapped SOL',
      decimals: 9,
      logoURI:
        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      extensions: {
        coingeckoId: 'solana',
        serumV3Usdc: '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT',
        serumV3Usdt: 'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1',
        website: 'https://solana.com/',
      },
    },
    {
      chainId: 101,
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI:
        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      tags: ['stablecoin'],
      extensions: {
        coingeckoId: 'usd-coin',
        serumV3Usdt: '77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS',
        website: 'https://www.centre.io/',
      },
    },
    {
      chainId: 101,
      address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      symbol: 'USDT',
      name: 'USDT',
      decimals: 6,
      logoURI:
        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
      tags: ['stablecoin'],
      extensions: {
        coingeckoId: 'tether',
        serumV3Usdc: '77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS',
        website: 'https://tether.to/',
      },
    },
    {
      chainId: 101,
      address: '9AaKcdu5eymQwR19qwYFsqiqcXgL3iAxMQyshRpbqg6z',
      symbol: 'SRM',
      name: 'SRM token coin',
      decimals: 0,
      logoURI:
        'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/9AaKcdu5eymQwR19qwYFsqiqcXgL3iAxMQyshRpbqg6z/logo.png',
      tags: ['utility-token'],
    },
    {
      chainId: 101,
      address: '8duXAgN6AYMi1jVAoQaBRnF9YKtLfRSC2h8kdquUQtcE',
      symbol: 'DUMMY',
      name: 'DUMMY',
      decimals: 9,
      logoURI:
        'https://xo3jbgawennyb4txdr4lp5z4ipmmrafz6ba6bntz6tsqlcgpgrlq.arweave.net/u7aQmBYjW4Dydxx4t_c8Q9jIgLnwQeC2efTlBYjPNFc',
      tags: ['test-token'],
    },
  ],
  version: {
    major: 0,
    minor: 3,
    patch: 3,
  },
});

// Markets information
data.set('serum/serumGetMarketsInformation', [
  {
    address: 'B37pZmwrwXHjpgvd9hHDAx1yeDsNevTnbbrN9W12BoGK', // noqa: mock
    deprecated: true,
    name: 'soALEPH/soUSDC',
    programId: '4ckmDgGdxQoPDLUkDT3vHgSAkzA3QRdNq5ywwY4sUSJn', // noqa: mock
  },
  {
    address: 'jyei9Fpj2GtHLDDGgcuhDacxYLLiSyxU4TY7KxB2xai', // noqa: mock
    deprecated: false,
    name: 'SRM/SOL',
    programId: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // noqa: mock
  },
  {
    address: '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT', // noqa: mock
    deprecated: false,
    name: 'SOL/USDC',
    programId: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // noqa: mock
  },
  {
    address: 'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1', // noqa: mock
    deprecated: false,
    name: 'SOL/USDT',
    programId: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // noqa: mock
  },
]);

const markets: any[] = data.get('serum/serumGetMarketsInformation');
const SOL_USDC = markets.find((val) => val.name === 'SOL/USDC').address;
// Market SOL/USDC
data.set(
  `serum/market/${SOL_USDC}`,
  new SerumMarket(
    {
      accountFlags: {
        initialized: true,
        market: true,
        openOrders: false,
        requestQueue: false,
        eventQueue: false,
        bids: false,
        asks: false,
      },
      ownAddress: new PublicKey('9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT'), // noqa: mock
      vaultSignerNonce: new BN('01', 'hex'),
      baseMint: new PublicKey('So11111111111111111111111111111111111111112'), // noqa: mock
      quoteMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // noqa: mock
      baseVault: new PublicKey('36c6YqAwyGKQG66XEp2dJc5JqjaBNv7sVghEtJv4c7u6'), // noqa: mock
      baseDepositsTotal: new BN('38ffa8cfb300', 'hex'),
      baseFeesAccrued: new BN('00', 'hex'),
      quoteVault: new PublicKey('8CFo8bL8mZQK8abbFyypFMwEDd8tVJjHTTojMLgQTUSZ'), // noqa: mock
      quoteDepositsTotal: new BN('0394280a510a', 'hex'), // noqa: mock
      quoteFeesAccrued: new BN('8eefb0a13a', 'hex'), // noqa: mock
      quoteDustThreshold: new BN('64', 'hex'),
      requestQueue: new PublicKey(
        'AZG3tFCFtiCqEwyardENBQNpHqxgzbMw8uKeZEw2nRG5' // noqa: mock
      ),
      eventQueue: new PublicKey('5KKsLVU6TcbVDK4BS6K1DGDxnh4Q9xjYJ8XaDCG5t8ht'), // noqa: mock
      bids: new PublicKey('14ivtgssEBoBjuZJtSAPKYgpUK7DmnSwuPMqJoVTSgKJ'), // noqa: mock
      asks: new PublicKey('CEQdAFKdycHugujQg9k2wbmxjcpdYZyVLfV9WerTnafJ'), // noqa: mock
      baseLotSize: new BN('05f5e100', 'hex'), // noqa: mock
      quoteLotSize: new BN('64', 'hex'),
      feeRateBps: new BN('00', 'hex'),
      referrerRebatesAccrued: new BN('1082ee555a', 'hex'),
    },
    9,
    6,
    {},
    new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin') // noqa: mock
  )
);

// OrderBook Asks SOL/USDC
data.set(
  `serum/market/${SOL_USDC}/asks`,
  new Orderbook(
    data.get(`serum/market/${SOL_USDC}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: false,
      asks: true,
    },
    slab
  )
);

// OrderBook Bids SOL/USDC
data.set(
  `serum/market/${SOL_USDC}/bids`,
  new Orderbook(
    data.get(`serum/market/${SOL_USDC}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: true,
      asks: false,
    },
    slab
  )
);

// Market SOL/USDT
const SOL_USDT = markets.find((val) => val.name === 'SOL/USDT').address;
data.set(
  `serum/market/${SOL_USDT}`,
  new SerumMarket(
    {
      accountFlags: {
        initialized: true,
        market: true,
        openOrders: false,
        requestQueue: false,
        eventQueue: false,
        bids: false,
        asks: false,
      },
      ownAddress: new PublicKey('HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1'), // noqa: mock
      vaultSignerNonce: new BN('01', 'hex'),
      baseMint: new PublicKey('So11111111111111111111111111111111111111112'), // noqa: mock
      quoteMint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'), // noqa: mock
      baseVault: new PublicKey('29cTsXahEoEBwbHwVc59jToybFpagbBMV6Lh45pWEmiK'), // noqa: mock
      baseDepositsTotal: new BN('68d96a437e00', 'hex'), // noqa: mock
      baseFeesAccrued: new BN('00', 'hex'),
      quoteVault: new PublicKey('EJwyNJJPbHH4pboWQf1NxegoypuY48umbfkhyfPew4E'), // noqa: mock
      quoteDepositsTotal: new BN('05809972e503', 'hex'), // noqa: mock
      quoteFeesAccrued: new BN('072ec1dc82', 'hex'), // noqa: mock
      quoteDustThreshold: new BN('64', 'hex'),
      requestQueue: new PublicKey(
        'GKrA1P2XVfpfZbpXaFcd2LNp7PfpnXZCbUusuFXQjfE9' // noqa: mock
      ),
      eventQueue: new PublicKey('GR363LDmwe25NZQMGtD2uvsiX66FzYByeQLcNFr596FK'), // noqa: mock
      bids: new PublicKey('2juozaawVqhQHfYZ9HNcs66sPatFHSHeKG5LsTbrS2Dn'), // noqa: mock
      asks: new PublicKey('ANXcuziKhxusxtthGxPxywY7FLRtmmCwFWDmU5eBDLdH'), // noqa: mock
      baseLotSize: new BN('05f5e100', 'hex'), // noqa: mock
      quoteLotSize: new BN('64', 'hex'),
      feeRateBps: new BN('00', 'hex'),
      referrerRebatesAccrued: new BN('0458e87c90', 'hex'), // noqa: mock
    },
    9,
    6,
    {},
    new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin') // noqa: mock
  )
);

// OrderBook Asks SOL/USDT
data.set(
  `serum/market/${SOL_USDT}/asks`,
  new Orderbook(
    data.get(`serum/market/${SOL_USDT}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: false,
      asks: true,
    },
    slab
  )
);

// OrderBook Bids SOL/USDT
data.set(
  `serum/market/${SOL_USDT}/bids`,
  new Orderbook(
    data.get(`serum/market/${SOL_USDT}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: true,
      asks: false,
    },
    slab
  )
);

// Market SRM/SOL
const SRM_SOL = markets.find((val) => val.name === 'SRM/SOL').address;
data.set(
  `serum/market/${SRM_SOL}`,
  new SerumMarket(
    {
      accountFlags: {
        initialized: true,
        market: true,
        openOrders: false,
        requestQueue: false,
        eventQueue: false,
        bids: false,
        asks: false,
      },
      ownAddress: new PublicKey('jyei9Fpj2GtHLDDGgcuhDacxYLLiSyxU4TY7KxB2xai'), // noqa: mock
      vaultSignerNonce: new BN('00', 'hex'),
      baseMint: new PublicKey('SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt'), // noqa: mock
      quoteMint: new PublicKey('So11111111111111111111111111111111111111112'), // noqa: mock
      baseVault: new PublicKey('EhAJTsW745jiWjViB7Q4xXcgKf6tMF7RcMX9cbTuXVBk'), // noqa: mock
      baseDepositsTotal: new BN('16f61d5d00', 'hex'), // noqa: mock
      baseFeesAccrued: new BN('00', 'hex'),
      quoteVault: new PublicKey('HFSNnAxfhDt4DnmY9yVs2HNFnEMaDJ7RxMVNB9Y5Hgjr'), // noqa: mock
      quoteDepositsTotal: new BN('d772f76602', 'hex'), // noqa: mock
      quoteFeesAccrued: new BN('2dcab54b', 'hex'), // noqa: mock
      quoteDustThreshold: new BN('64', 'hex'),
      requestQueue: new PublicKey(
        'Fx15MivJTQokQZKazxGCsbWxRsx3uGrawkTidoBDrHv8' // noqa: mock
      ),
      eventQueue: new PublicKey('nyZdeD16L5GxJq7Pso8R6KFfLA8R9v7c5A2qNaGWR44'), // noqa: mock
      bids: new PublicKey('4ZTJfhgKPizbkFXNvTRNLEncqg85yJ6pyT7NVHBAgvGw'), // noqa: mock
      asks: new PublicKey('7hLgwZhHD1MRNyiF1qfAjfkMzwvP3VxQMLLTJmKSp4Y3'), // noqa: mock
      baseLotSize: new BN('0186a0', 'hex'), // noqa: mock
      quoteLotSize: new BN('0186a0', 'hex'), // noqa: mock
      feeRateBps: new BN('00', 'hex'),
      referrerRebatesAccrued: new BN('0584531e3a', 'hex'), // noqa: mock
    },
    6,
    9,
    {},
    new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin') // noqa: mock
  )
);

// OrderBook Asks SRM/SOL
data.set(
  `serum/market/${SRM_SOL}/asks`,
  new Orderbook(
    data.get(`serum/market/${SRM_SOL}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: false,
      asks: true,
    },
    slab
  )
);

// OrderBook Bids SRM/SOL
data.set(
  `serum/market/${SRM_SOL}/bids`,
  new Orderbook(
    data.get(`serum/market/${SRM_SOL}`),
    {
      initialized: true,
      market: false,
      openOrders: false,
      requestQueue: false,
      eventQueue: false,
      bids: true,
      asks: false,
    },
    slab
  )
);

// Ticker SOL/USDC
data.set(`serum/getTicker/${SOL_USDC}`, {
  exchange: 'serum_dex',
  market: '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT', // noqa: mock
  type: 'spot',
  price_exclude: false,
  volume_exclude: false,
  aggregated: true,
  base: 'SOL',
  quote: 'USDC',
  base_symbol: 'SOL',
  quote_symbol: 'USDC',
  price: '56.41405623',
  price_quote: '56.12099838',
  volume_usd: '52623210.03',
  last_updated: '2022-05-15T20:52:00Z',
  status: 'active',
  weight: '1.0000',
  first_candle: '2022-01-18T00:00:00Z',
  '1d': {
    volume: '52623210.03',
    volume_base: '1000523.34',
    volume_change: '-18266892.61',
    volume_base_change: '-414813.97',
    price_change: '6.40205519',
    price_quote_change: '6.10899734',
  },
  base_active: true,
  base_name: 'Solana',
  base_type: 1,
  exchange_integrated: false,
  exchange_name: 'Serum DEX',
  exchange_transparency: 'D',
  quote_active: true,
  quote_name: 'USD Coin',
  quote_type: 1,
});

// Ticker SOL/USDT
data.set(`serum/getTicker/${SOL_USDT}`, {
  exchange: 'serum_dex',
  market: 'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1', // noqa: mock
  type: 'spot',
  price_exclude: false,
  volume_exclude: false,
  aggregated: true,
  base: 'SOL',
  quote: 'USDT',
  base_symbol: 'SOL',
  quote_symbol: 'USDT',
  price: '55.72144534',
  price_quote: '55.49200058',
  volume_usd: '2043320.04',
  last_updated: '2022-05-15T20:52:00Z',
  status: 'active',
  weight: '1.0000',
  first_candle: '2022-01-18T00:00:00Z',
  '1d': {
    volume: '2043320.04',
    volume_base: '38734.24',
    volume_change: '-2930214.18',
    volume_base_change: '-59403.45',
    price_change: '5.49244524',
    price_quote_change: '5.26300049',
  },
  base_active: true,
  base_name: 'Solana',
  base_type: 1,
  exchange_integrated: false,
  exchange_name: 'Serum DEX',
  exchange_transparency: 'D',
  quote_active: true,
  quote_name: 'Tether',
  quote_type: 1,
});

// Ticker SRM/SOL
data.set(`serum/getTicker/${SRM_SOL}`, {
  exchange: 'serum_dex',
  market: 'jyei9Fpj2GtHLDDGgcuhDacxYLLiSyxU4TY7KxB2xai', // noqa: mock
  type: 'spot',
  price_exclude: false,
  volume_exclude: false,
  aggregated: true,
  base: 'SRMSOL',
  quote: 'SOL',
  base_symbol: 'SRM',
  quote_symbol: 'SOL',
  price: '1.36677691',
  price_quote: '0.024000000',
  volume_usd: '223.30',
  last_updated: '2022-05-15T20:52:00Z',
  status: 'active',
  weight: '1.0000',
  first_candle: '2022-01-18T00:00:00Z',
  '1d': {
    volume: '223.30',
    volume_base: '169.97',
    volume_change: '-18012.00',
    volume_base_change: '-14754.54',
    price_change: '1.34077691',
    price_quote_change: '-0.0020000003',
  },
  base_active: true,
  base_name: 'Serum (Solana)',
  base_type: 1,
  exchange_integrated: false,
  exchange_name: 'Serum DEX',
  exchange_transparency: 'D',
  quote_active: true,
  quote_name: 'Solana',
  quote_type: 1,
});

export default data;
