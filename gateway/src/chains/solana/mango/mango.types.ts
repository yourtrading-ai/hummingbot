import {
  MarketConfig,
  PerpMarket,
  PerpOrder,
} from '@blockworks-foundation/mango-client';
import { I80F48 } from '@blockworks-foundation/mango-client/lib/src/fixednum';
import { Market as SpotMarket, OpenOrders } from '@project-serum/serum';
import { Order as SpotOrder } from '@project-serum/serum/lib/market';

interface BalancesBase {
  key: string;
  symbol: string;
  wallet?: number | null | undefined;
  orders?: number | null | undefined;
  openOrders?: OpenOrders | null | undefined;
  unsettled?: number | null | undefined;
}

export interface Market {
  account: SpotMarket | PerpMarket;
  config: MarketConfig;
}

export interface Balances extends BalancesBase {
  deposits?: I80F48 | null | undefined;
  borrows?: I80F48 | null | undefined;
  net?: I80F48 | null | undefined;
  value?: I80F48 | null | undefined;
  depositRate?: I80F48 | null | undefined;
  borrowRate?: I80F48 | null | undefined;
}

export type OrderInfo = {
  market: Market;
  order: SpotOrder | PerpOrder;
};

export type OrderBook = {
  market: Market;
  bids: SimpleOrder[];
  asks: SimpleOrder[];
};

export interface SimpleOrder {
  price: number;
  size: number;
}

export interface OpenOrder extends SimpleOrder {
  marketName: string;
  orderId: string;
  filled: string; // how much of this order has been filled
}

export interface Fill extends OpenOrder {
  //filled: string - represents now how much has been filled at given timestamp
  timestamp: string; // the time at which the fill happened
  fee: string; // can be positive, when paying, or negative, when rebated
}
