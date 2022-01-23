import { ConfigManagerV2 } from '../../../services/config-manager-v2';

export namespace MangoConfig {
  export interface Config {
    groupName: string;
    allowedSlippage: string;
    defaultMangoAccount: string;
    ttl: number;
  }

  export const config: Config = {
    groupName: ConfigManagerV2.getInstance().get(
      `mango.groupNames.${ConfigManagerV2.getInstance().get('solana.network')}`
    ),
    allowedSlippage: ConfigManagerV2.getInstance().get('mango.allowedSlippage'),
    defaultMangoAccount: ConfigManagerV2.getInstance().get(
      'mango.defaultMangoAccount'
    ),
    ttl: ConfigManagerV2.getInstance().get('mango.ttl'),
  };
}
