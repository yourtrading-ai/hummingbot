import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../../services/error-handler';
import { verifySolanaIsAvailable } from '../solana-middlewares';
import { verifyMangoIsAvailable } from './mango-middlewares';
import { SolanaConfig } from '../solana.config';
import { Solana } from '../solana';
import Mango from './mango';
import { validatePublicKey } from '../solana.validators';
import {
  MangoAccountsResponse,
  MangoFillsResponse,
  MangoMarketsRequest,
  MangoMarketsResponse,
  MangoOrderbookRequest,
  MangoOrderbookResponse,
  MangoGetOrdersResponse,
  MangoPostOrderRequest,
  MangoPostOrderResponse,
  MangoCancelOrderRequest,
  MangoCancelOrderResponse,
} from './mango.requests';
import {
  accounts,
  deleteOrders,
  fills,
  getOrders,
  markets,
  orderbook,
  postOrder,
} from './mango.controllers';

export namespace MangoRoutes {
  export const router = Router();
  export const solana = Solana.getInstance();
  export const mango = Mango.getInstance();

  router.use(
    asyncHandler(verifySolanaIsAvailable),
    asyncHandler(verifyMangoIsAvailable)
  );

  router.get('/', async (_req: Request, res: Response) => {
    res.status(200).json({
      network: SolanaConfig.config.network.slug,
      mangoGroup: mango.mangoGroupConfig.name,
      connection: mango.ready(),
      timestamp: Date.now(),
    });
  });

  router.get(
    '/accounts',
    asyncHandler(
      async (
        req: Request<unknown, unknown, { address: string }>,
        res: Response<MangoAccountsResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await accounts(req.body));
      }
    )
  );

  router.get(
    '/markets',
    asyncHandler(
      async (
        req: Request<unknown, unknown, MangoMarketsRequest>,
        res: Response<MangoMarketsResponse, any>
      ) => {
        res.status(200).json(await markets(req.body));
      }
    )
  );

  /**
   * Returns the last traded prices.
   */
  router.get(
    '/ticker',
    asyncHandler(
      async (
        req: Request<unknown, unknown, MangoMarketsRequest>,
        res: Response<MangoMarketsResponse, any>
      ) => {
        res.status(200).json(await markets(req.body));
      }
    )
  );

  router.get(
    '/orderbook',
    asyncHandler(
      async (
        req: Request<unknown, unknown, MangoOrderbookRequest>,
        res: Response<MangoOrderbookResponse, any>
      ) => {
        // TODO: 404 if requested market does not exist
        res.status(200).json(await orderbook(req.body));
      }
    )
  );

  router.get(
    '/orders',
    asyncHandler(
      async (
        req: Request<unknown, unknown, { address: string }>,
        res: Response<MangoGetOrdersResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await getOrders(req.body));
      }
    )
  );

  router.post(
    '/orders',
    asyncHandler(
      async (
        req: Request<unknown, unknown, MangoPostOrderRequest>,
        res: Response<MangoPostOrderResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await postOrder(req.body));
      }
    )
  );

  router.delete(
    '/orders',
    asyncHandler(
      async (
        req: Request<unknown, unknown, MangoCancelOrderRequest>,
        res: Response<MangoCancelOrderResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await deleteOrders(req.body));
      }
    )
  );

  router.get(
    '/fills',
    asyncHandler(
      async (
        req: Request<unknown, unknown, { address: string }>,
        res: Response<MangoFillsResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await fills(req.body));
      }
    )
  );
}
