import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../../services/config-manager-types';

export namespace SerumConfig {
  export interface Config {
    availableNetworks: Array<AvailableNetworks>;
    tradingTypes: Array<string>;
    markets: MarketsConfig;
    tickers: TickersConfig;
    transactions: TransactionsConfig;
  }

  export interface MarketsConfig {
    url: string;
    blacklist: string[];
    whiteList: string[];
  }

  export interface TickersConfig {
    sources: Map<string, SourcesConfig>;
  }

  export interface SourcesConfig {
    url: string;
  }

  export interface TransactionsConfig {
    merge: {
      createOrders: boolean;
      cancelOrders: boolean;
      settleFunds: boolean;
    };
  }

  export const config: Config = {
    tradingTypes: ['SOL_CLOB'],
    markets: {
      url: ConfigManagerV2.getInstance().get(`serum.markets.url`),
      blacklist: ConfigManagerV2.getInstance().get(`serum.markets.blacklist`),
      whiteList: ConfigManagerV2.getInstance().get(`serum.markets.whitelist`),
    },
    tickers: {
      sources: new Map(
        Object.entries(
          ConfigManagerV2.getInstance().get(`serum.tickers.sources`)
        )
      ),
    },
    transactions: {
      merge: {
        createOrders: ConfigManagerV2.getInstance().get(
          `serum.transactions.merge.createOrders`
        ),
        cancelOrders: ConfigManagerV2.getInstance().get(
          `serum.transactions.merge.cancelOrders`
        ),
        settleFunds: ConfigManagerV2.getInstance().get(
          `serum.transactions.merge.settleFunds`
        ),
      },
    },
    availableNetworks: [
      {
        chain: 'solana',
        networks: ['mainnet-beta'],
        // // testnet and devnet where disabled because they weren't working properly.
        // networks: Object.keys(
        //   ConfigManagerV2.getInstance().get(`solana.networks`)
        // ),
      },
    ],
  };
}
