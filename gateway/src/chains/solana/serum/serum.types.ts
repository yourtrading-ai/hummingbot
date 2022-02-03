import { Market } from '@project-serum/serum';
import { Order as SpotOrder } from '@project-serum/serum/lib/market';

export type OrderInfo = {
  market: Market;
  order: SpotOrder;
};

export type OrderBook = {
  market: Market;
  bids: SimpleOrder[];
  asks: SimpleOrder[];
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
