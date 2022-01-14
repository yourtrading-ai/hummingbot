//
// GET /accounts
//
interface BalanceRecord {
  marketName: string;
  deposits: string;
  borrows: string;
}

interface PerpPosition {
  marketName: string;
  side: 'long' | 'short';
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
  balances: BalanceRecord[];
  perpPositions: PerpPosition[];
}

export interface MangoAccountsResponse {
  accounts: MangoSpotAccount[];
}

//
// GET /markets
//
export interface MangoMarketsRequest {
  marketNames: string[];
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
  latestTradedPrice: string;
  indexPrice: string; // oracle price of the underlying base asset (also used for liquidations)
  minimumOrderSize: string; // smallest allowed order size
  tickSize: string; // smallest possible price increment
}

interface SpotMarket extends Market {
  depositRate: string;
  borrowRate: string;
}

interface PerpMarket extends Market {
  fundingRate: number; // hourly APR, positive if long pays short, negative if otherwise
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
// GET /orderbook
//
export interface MangoOrderbookRequest {
  marketName: string;
}

interface Order {
  price: string;
  size: string;
}

export interface MangoOrderbookResponse {
  bids: Order[];
  asks: Order[];
}

//
// GET /orders
//
interface OpenOrder extends Order {
  marketName: string;
  orderId: string;
  filled: string; // how much of this order has been filled
}

export interface MangoGetOrdersResponse {
  spot: OpenOrder[];
  perp: OpenOrder[];
}

//
// POST /orders
//
export interface MangoPostOrderRequest {
  address: string;
  marketName: string;
  side: 'buy' | 'sell';
  amount: string;
  price: string;
  order_type: 'limit' | 'market'; // market == ioc
  postOnly: boolean; // place only an order, if no liquidity has been taken
}

export interface MangoPostOrderResponse {
  status: 'open' | 'filled' | 'cancelled';
  orderId?: string;
}

//
// DELETE /orders
//
export interface MangoCancelOrderRequest {
  address: string;
  orderId?: string;
}

export interface MangoCancelOrderResponse {
  orderIds: string[]; // IDs of the successfully cancelled orders
}

//
// GET /fills
//
interface Fill extends OpenOrder {
  //filled: string - represents now how much has been filled at given timestamp
  timestamp: string; // the time at which the fill happened
  fee: string; // can be positive, when paying, or negative, when rebated
}

export interface MangoFillsResponse {
  // sorted from newest to oldest
  spot: Fill[];
  perp: Fill[];
}
