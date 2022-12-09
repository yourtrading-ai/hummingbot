import { ConfigManagerV2 } from '../../services/config-manager-v2';

const configManager = ConfigManagerV2.getInstance();

export const constants = {
  cache: {
    marketsInformation:
      configManager.get('serum.cache.marketsInformation') || 3600, // in seconds
    markets: configManager.get('serum.cache.markets') || 3600, // in seconds
  },
  orders: {
    filled: {
      limit: configManager.get('serum.orders.filled.limit') || 1000,
    },
    create: {
      maxPerTransaction:
        configManager.get('serum.orders.create.maxPerTransaction') || 8,
    },
    cancel: {
      maxPerTransaction:
        configManager.get('serum.orders.cancel.maxPerTransaction') || 25,
    },
  },
  events: {
    limit: {
      consumeEvents: configManager.get('serum.events.limit.consumeEvents'),
      matchOrders: configManager.get('serum.events.limit.matchOrders'),
    },
  },
};

export default constants;
