export interface FeeInfo {
  maker: string;
  taker: string;
}

export interface Market {
  name: string;
  minimumOrderSize: string; // smallest allowed order size
  tickSize: string; // smallest possible price increment
}

export interface SpotMarket extends Market {
  depositRate: string; //
  borrowRate: string;
}

export interface PerpMarket extends Market {
  //fundingRate: number; // hourly APR, positive if long pays short, negative if otherwise
  baseLotSize: string; // smallest increment for the base (asset) amount
  quoteLotSize: string; // smallest possible change in quote (USD) amount
  openInterest: string; // the dollar volume of open positions
}

export type OrderBook = {
  market: Market;
  bids: SimpleOrder[];
  asks: SimpleOrder[];
  timestamp: string;
};

/**
 * Very simple representation of an order.
 */
export interface SimpleOrder {
  price: number;
  amount: number;
}

/**
 * Represents a client's order with IDs and their side.
 */
export interface OpenClientOrder extends SimpleOrder {
  exchangeOrderId: string;
  clientOrderId?: string;
  side: 'BUY' | 'SELL';
}

/**
 * Represents a filled order.
 */
export interface FilledOrder extends OpenClientOrder {
  id: string; // should be seqNum from FillEvent
  timestamp: string; // the time at which the fill happened
  fee: string; // can be positive, when paying, or negative, when rebated
}
