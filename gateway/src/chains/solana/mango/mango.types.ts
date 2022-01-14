import {
  MarketConfig,
  PerpMarket,
  PerpOrder,
} from '@blockworks-foundation/mango-client';
import { I80F48 } from '@blockworks-foundation/mango-client/lib/src/fixednum';
import { Market as SpotMarket, OpenOrders } from '@project-serum/serum';
import { Order } from '@project-serum/serum/lib/market';

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
  order: Order | PerpOrder;
};

export type OrderBook = {
  market: Market;
  bids: OrderInfo[];
  asks: OrderInfo[];
};
