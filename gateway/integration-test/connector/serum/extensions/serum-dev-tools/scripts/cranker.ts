import { MessageType } from '../types';
import { Market as SerumMarket } from '@project-serum/serum';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { delay, logIfVerbose } from '../utils';
import { FileKeypair } from '../fileKeypair';

const MAX_OPEN_ORDERS = 10;

process.on('message', async (message: MessageType) => {
  if (message.action === 'start') {
    await basicCranker(message.args);
  }
});

const crank = async (
  market: SerumMarket,
  owner: Keypair,
  connection: Connection,
  isVerbose: boolean
) => {
  const eventQueue = await market.loadEventQueue(connection);
  logIfVerbose(`EventQueue length: ${eventQueue.length}`, isVerbose);

  if (eventQueue.length > 0) {
    const orderedAccounts: PublicKey[] = eventQueue
      .slice(0, MAX_OPEN_ORDERS)
      .map((e) => e.openOrders)
      .sort((a, b) => a.toBuffer().swap64().compare(b.toBuffer().swap64()));

    const tx = new Transaction();
    tx.add(market.makeConsumeEventsInstruction(orderedAccounts, 65535));

    try {
      const sig = await connection.sendTransaction(tx, [owner]);
      await connection.confirmTransaction(sig, 'confirmed');
      logIfVerbose(`------ ConsumeEvents Confirmed ------`, isVerbose);
    } catch (err) {
      logIfVerbose(`Error: ${err}`, isVerbose);
      logIfVerbose(`------ ConsumeEvents Failed ------`, isVerbose);
    }
  }
};

const basicCranker = async (args: any) => {
  setTimeout(() => {
    console.log(`Exiting Cranker @ ${process.pid}`);
    process.exit(0);
  }, Number.parseInt(args.duration));

  const isVerbose = args.verbose === 'true';

  const owner = FileKeypair.load(args.ownerFilePath);
  const connection = new Connection(args.rpcEndpoint, 'confirmed');

  const serumMarket = await SerumMarket.load(
    connection,
    new PublicKey(args.marketAddress),
    { commitment: 'confirmed' },
    new PublicKey(args.programID)
  );

  do {
    await crank(serumMarket, owner.keypair, connection, isVerbose);
    await delay(2000);
    // eslint-disable-next-line no-constant-condition
  } while (true);
};
