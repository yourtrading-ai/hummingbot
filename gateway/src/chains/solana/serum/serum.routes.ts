import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../../services/error-handler';
import { verifySolanaIsAvailable } from '../solana-middlewares';
import { verifySerumIsAvailable } from './serum-middlewares';
import { SolanaConfig } from '../solana.config';
import { Solana } from '../solana';
import { validatePublicKey } from '../solana.validators';
import {
  deleteOrders,
  fills,
  getOrders,
  markets,
  orderbook,
  postOrder,
} from './serum.controllers';
import {
  SerumMarketsRequest,
  SerumMarketsResponse,
  SerumOrderbookRequest,
  SerumOrderbookResponse,
  SerumGetOrdersRequest,
  SerumGetOrdersResponse,
  SerumPostOrderRequest,
  SerumPostOrderResponse,
  SerumTickerResponse,
  SerumCancelOrderRequest,
  SerumCancelOrdersResponse,
  SerumFillsRequest,
  SerumFillsResponse,
} from './serum.requests';
import { Serum } from './serum';

export namespace MangoRoutes {
  export const router = Router();
  export const solana = Solana.getInstance();
  export const serum = Serum.getInstance();

  router.use(
    asyncHandler(verifySolanaIsAvailable),
    asyncHandler(verifySerumIsAvailable)
  );

  router.get('/', async (_req: Request, res: Response) => {
    res.status(200).json({
      network: SolanaConfig.config.network.slug,
      connection: serum.ready(),
      timestamp: Date.now(),
    });
  });

  router.get(
    '/markets',
    asyncHandler(
      async (
        req: Request<unknown, unknown, SerumMarketsRequest>,
        res: Response<SerumMarketsResponse, any>
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
        req: Request<unknown, unknown, SerumMarketsRequest>,
        res: Response<SerumTickerResponse, any>
      ) => {
        res.status(200).json(await markets(req.body));
      }
    )
  );

  router.get(
    '/orderbook',
    asyncHandler(
      async (
        req: Request<unknown, unknown, SerumOrderbookRequest>,
        res: Response<SerumOrderbookResponse, any>
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
        req: Request<unknown, unknown, SerumGetOrdersRequest>,
        res: Response<SerumGetOrdersResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await getOrders(req.body));
      }
    )
  );

  router.post(
    '/create',
    asyncHandler(
      async (
        req: Request<unknown, unknown, SerumPostOrderRequest>,
        res: Response<SerumPostOrderResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await postOrder(req.body));
      }
    )
  );

  router.post(
    '/cancel',
    asyncHandler(
      async (
        req: Request<unknown, unknown, SerumCancelOrderRequest>,
        res: Response<SerumCancelOrdersResponse, any>
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
        req: Request<unknown, unknown, SerumFillsRequest>,
        res: Response<SerumFillsResponse, any>
      ) => {
        validatePublicKey(req.body);
        res.status(200).json(await fills(req.body));
      }
    )
  );
}
