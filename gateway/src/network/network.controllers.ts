import { StatusRequest, StatusResponse } from './network.requests';
import { Avalanche } from '../chains/avalanche/avalanche';
import { Ethereum } from '../chains/ethereum/ethereum';
import {
  HttpException,
  UNKNOWN_CHAIN_ERROR_CODE,
  UNKNOWN_KNOWN_CHAIN_ERROR_MESSAGE,
} from '../services/error-handler';

export async function getStatus(req: StatusRequest): Promise<StatusResponse> {
  let chain: string;
  let chainId: number;
  let rpcUrl: string;
  let currentBlockNumber: number;
  if (req.chain === 'avalanche') {
    const avalanche = Avalanche.getInstance(req.chain);
    chain = avalanche.chain;
    chainId = avalanche.chainId;
    rpcUrl = avalanche.rpcUrl;
    currentBlockNumber = await avalanche.getCurrentBlockNumber();
  } else if (req.chain === 'ethereum') {
    const ethereum = Ethereum.getInstance(req.chain);
    chain = ethereum.chain;
    chainId = ethereum.chainId;
    rpcUrl = ethereum.rpcUrl;
    currentBlockNumber = await ethereum.getCurrentBlockNumber();
  } else {
    throw new HttpException(
      500,
      UNKNOWN_KNOWN_CHAIN_ERROR_MESSAGE(req.chain),
      UNKNOWN_CHAIN_ERROR_CODE
    );
  }

  return { chain, chainId, rpcUrl, currentBlockNumber };
}