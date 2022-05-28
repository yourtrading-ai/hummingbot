import { ConfigManagerV2 } from '../../services/config-manager-v2';

export namespace SerumConfig {
  export interface Config {
    network: NetworkConfig;
    markets: MarketsConfig;
    tickers: TickersConfig;
  }

  export interface NetworkConfig {
    rpcURL: string;
  }

  export interface MarketsConfig {
    url: string;
    blacklist: string[];
    whiteList: string[];
  }

  export interface TickersConfig {
    source: string;
    url: string;
  }
}

export function getSerumConfig(network: string): SerumConfig.Config {
  const configManager = ConfigManagerV2.getInstance();

  const prefix = 'serum';

  const targetNetwork = network || configManager.get(`${prefix}.network`);

  return {
    network: {
      rpcURL: configManager.get(`${prefix}.networks.${targetNetwork}.rpcURL`),
    },
    markets: {
      url: configManager.get(`${prefix}.markets.url`),
      blacklist: configManager.get(`${prefix}.markets.blacklist`),
      whiteList: configManager.get(`${prefix}.markets.whitelist`),
    },
    tickers: {
      source: configManager.get(`${prefix}.tickers.source`),
      url: configManager.get(`${prefix}.tickers.url`),
    },
  };
}