//
// GET /accounts
//
import { FilledOrder, OpenClientOrder, SimpleOrder } from './mango.types';

interface BalanceRecord {
  marketName: string;
  deposits: string;
  borrows: string;
}

interface PerpPosition {
  marketName: string;
  side: 'LONG' | 'SHORT';
  basePosition: string; // how much of the underlying asset (like BTC) has been longed/shorted
  quotePosition: string; // how much this position is worth (in USD)
  averageOpenPrice: string;
  breakEvenPrice: string;
  unrealizedPnL: string;
}

interface MangoSpotAccount {
  publicKey: string;
  leverage: number;
  health: number;
  canOpenNewOrders: boolean;
  beingLiquidated: boolean; // health below 0
  netBalance: string; // = deposits - borrows
  balances: BalanceRecord[];
  perpPositions: PerpPosition[];
}

export interface MangoAccountsResponse {
  mangoAccounts: MangoSpotAccount[];
}

//
// GET /markets
//
export interface MangoMarketsRequest {
  marketNames?: string[];
}

interface FeeInfo {
  spot: {
    maker: string;
    taker: string;
  };
  perp: {
    maker: string;
    taker: string;
  };
}

interface Market {
  name: string;
  minimumOrderSize: string; // smallest allowed order size
  tickSize: string; // smallest possible price increment
}

interface SpotMarket extends Market {
  depositRate: string; //
  borrowRate: string;
}

interface PerpMarket extends Market {
  //fundingRate: number; // hourly APR, positive if long pays short, negative if otherwise
  baseLotSize: string; // smallest increment for the base (asset) amount
  quoteLotSize: string; // smallest possible change in quote (USD) amount
  openInterest: string; // the dollar volume of open positions
}

export interface MangoMarketsResponse {
  fees: FeeInfo;
  spot: SpotMarket[];
  perp: PerpMarket[];
}

//
// GET /ticker
//
export interface TickerItem {
  marketName: string;
  price: string;
  timestamp: string;
}

export interface MangoTickerResponse {
  lastTradedPrices: TickerItem[];
}

//
// GET /orderbook
//
export interface MangoOrderbookRequest {
  marketName: string;
}

export interface MangoOrderbookResponse {
  marketName: string;
  bids: SimpleOrder[];
  asks: SimpleOrder[];
}

//
// GET /orders
//
export interface MangoGetOrdersRequest {
  address?: string; // filter by owner
  marketName?: string; // filter by market (can speed up request dramatically)
  exchangeOrderId?: string; // filter by exchangeOrderId
  clientOrderId?: string; // filter by clientOrderId
}

export interface MangoGetOrdersResponse {
  spot: OpenClientOrder[];
  perp: OpenClientOrder[];
}

//
// POST /orders
//
export interface MangoPostOrderRequest {
  mangoAccountAddress: string;
  marketName: string;
  side: 'BUY' | 'SELL';
  amount: string;
  price: string;
  order_type: 'LIMIT' | 'MARKET'; // market == ioc (immediate-or-cancel)
  postOnly: boolean; // place only an order, if no liquidity has been taken
  clientOrderId?: string; // set a client's own orderId for tracking
}

export interface MangoOrderResponse {
  status: 'OPEN' | 'FILLED' | 'CANCELED' | 'UNKNOWN' | 'FAILED' | 'DONE';
  exchangeOrderId?: string;
  clientOrderId?: string;
}

//
// DELETE /orders
//
export interface MangoCancelOrderRequest {
  mangoAccountAddress: string; // mango account, which orders belong to
  exchangeOrderId?: string; // is simply 'orderId' in mango.ts
  clientOrderId?: string;
}

export interface MangoCancelOrdersResponse {
  orders: MangoOrderResponse;
}

//
// GET /fills
//
export interface MangoFillsResponse {
  // sorted from newest to oldest
  spot: FilledOrder[];
  perp: FilledOrder[];
}
