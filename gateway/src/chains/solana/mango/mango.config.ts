import { ConfigManagerV2 } from '../../../services/config-manager-v2';

export namespace MangoConfig {
  export interface NetworkConfig {
    groupName: string;
    allowedSlippage: string;
    defaultMangoAccount: string;
    ttl: number;
  }

  export const config: NetworkConfig = {
    groupName: ConfigManagerV2.getInstance().get('mango.groupName'),
    allowedSlippage: ConfigManagerV2.getInstance().get('mango.allowedSlippage'),
    defaultMangoAccount: ConfigManagerV2.getInstance().get(
      'mango.defaultMangoAccount'
    ),
    ttl: ConfigManagerV2.getInstance().get('mango.ttl'),
  };
}
