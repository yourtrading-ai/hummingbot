import 'jest-extended';
import {
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  closeAccount,
  // createAssociatedTokenAccount,
} from '@solana/spl-token';
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { default as config } from '../../../test/chains/solana/serum/fixtures/config';

import bs58 from 'bs58';
jest.setTimeout(30 * 60 * 1000);

// Wrap or Unwrap amount
const amount: number = 0.01;

const wrap = async () => {
  // Add your endpoint here
  const connection = new Connection('https://api.testnet.solana.com');

  const publicKey =
    process.env['TEST_SOLANA_WALLET_PUBLIC_KEY'] ||
    config.solana.wallet.owner.publicKey;

  const privateKey =
    process.env['TEST_SOLANA_WALLET_PRIVATE_KEY'] ||
    config.solana.wallet.owner.publicKey;

  // Create an emitter's keypair array with public and private key.
  const emitter = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log(`Emitter public key: ${emitter.publicKey}`);

  // Receiver can be another wallet too, if you need
  const receiver = new PublicKey(publicKey);

  // Find receiver's Wrapped SOL associated token account
  const associatedTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    receiver
  );

  // Create "CreateAssociatedTokenAccount" instruction. Necessary for correct getting balance.
  const associatedTokenAccountInstruction =
    createAssociatedTokenAccountInstruction(
      emitter.publicKey,
      associatedTokenAccount,
      receiver,
      NATIVE_MINT
    );
  console.log(
    `Receiver WSOL Associated Token Account: ${associatedTokenAccount.toBase58()}`
  );

  // Create a transaction, add "CreateAssociatedTokenAccount" instruction and add body info to transfer.
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: emitter.publicKey,
      toPubkey: associatedTokenAccount,
      lamports: amount * LAMPORTS_PER_SOL,
    }),
    associatedTokenAccountInstruction
  );

  // Define who will be the fee payer. Can be another wallet, if necessary.
  transaction.feePayer = emitter.publicKey;

  // Send the transaction.
  const transfer_hash = await connection.sendTransaction(transaction, [
    emitter,
    emitter,
  ]);
  console.log(`Transfer Hash: ${transfer_hash}`);
};

const Unwrap = async () => {
  // Add your endpoint here
  const connection = new Connection('https://api.testnet.solana.com');

  const privateKey =
    process.env['TEST_SOLANA_WALLET_PRIVATE_KEY'] ||
    config.solana.wallet.owner.publicKey;

  // Create a keypair array with public and private key.
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log(`Wallet public key: ${wallet.publicKey}`);

  // Find the Wrapped SOL associated token account
  const associatedTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    wallet.publicKey
  );
  console.log(
    `Wrapped SOL Associated Token Account: ${associatedTokenAccount.toBase58()}`
  );

  // Getting the current balance
  const walletBalance = await connection.getBalance(wallet.publicKey);
  console.log(`SOL Balance before unwrapping: ${walletBalance}`);

  // Make Unwrap and close the Associated Token Account. For new wrapping, can not be open.
  await closeAccount(
    connection,
    wallet,
    associatedTokenAccount,
    wallet.publicKey,
    wallet
  );
  console.log(
    `Closed Associated Token Account: ${associatedTokenAccount.toBase58()}`
  );

  // Getting the balance after process.
  const walletBalancePostClose = await connection.getBalance(wallet.publicKey);
  console.log(`SOL Balance after unwrapping: ${walletBalancePostClose}`);
};

it('Wrap', async () => {
  await wrap();
});

it('Unwrap', async () => {
  await Unwrap();
});
