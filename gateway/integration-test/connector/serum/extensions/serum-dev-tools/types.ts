import { Signer, Transaction } from '@solana/web3.js';

export type TransactionWithSigners = {
  transaction: Transaction;
  signers: Signer[];
};

export type OrderType = 'limit' | 'ioc' | 'postOnly';
export type SelfTradeBehaviour =
  | 'decrementTake'
  | 'cancelProvide'
  | 'abortTransaction';

export type MessageType = {
  action: 'start';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
};
