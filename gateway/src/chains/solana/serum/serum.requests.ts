//
// GET /accounts
//

//
// GET /markets
//
import { FilledOrder, OpenClientOrder, SimpleOrder } from './serum.types';

export interface SerumMarketsRequest {
  marketNames?: string[];
}

interface FeeInfo {
  maker: string;
  taker: string;
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

export interface SerumMarketsResponse {
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

export interface SerumTickerResponse {
  lastTradedPrices: TickerItem[];
}

//
// GET /orderbook
//
export interface SerumOrderbookRequest {
  marketName: string;
}

export interface SerumOrderbookResponse {
  marketName: string;
  bids: SimpleOrder[];
  asks: SimpleOrder[];
}

//
// GET /orders
//
export interface SerumGetOrdersRequest {
  address?: string; // filter by owner
  marketName?: string; // filter by market (can speed up request dramatically)
  exchangeOrderId?: string; // filter by exchangeOrderId
  clientOrderId?: string; // filter by clientOrderId
}

export interface SerumGetOrdersResponse {
  spot: OpenClientOrder[];
  perp: OpenClientOrder[];
}

//
// POST /orders
//
export interface SerumPostOrderRequest {
  mangoAccountAddress: string;
  marketName: string;
  side: 'BUY' | 'SELL';
  amount: string;
  price: string;
  order_type: 'LIMIT' | 'MARKET'; // market == ioc (immediate-or-cancel)
  postOnly: boolean; // place only an order, if no liquidity has been taken
  clientOrderId?: string; // set a client's own orderId for tracking
}

export interface SerumPostOrderResponse {
  status: 'OPEN' | 'FILLED' | 'CANCELED' | 'UNKNOWN' | 'FAILED' | 'DONE';
  exchangeOrderId?: string;
  clientOrderId?: string;
}

//
// DELETE /orders
//
export interface SerumCancelOrderRequest {
  mangoAccountAddress: string; // mango account, which orders belong to
  exchangeOrderId?: string; // is simply 'orderId' in mango.ts
  clientOrderId?: string;
}

export interface SerumCancelOrdersResponse {
  orders: SerumPostOrderResponse;
}

//
// GET /fills
//
export interface SerumFillsRequest {
  marketNames?: string[];
  account?: string;
}

export interface SerumFillsResponse {
  // sorted from newest to oldest
  spot: FilledOrder[];
  perp: FilledOrder[];
}
