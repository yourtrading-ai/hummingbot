import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

export async function getVaultOwnerAndNonce(
  marketAddress: PublicKey,
  dexAddress: PublicKey
): Promise<[vaultOwner: PublicKey, nonce: BN]> {
  const nonce = new BN(0);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const vaultOwner = await PublicKey.createProgramAddress(
        [marketAddress.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
        dexAddress
      );
      return [vaultOwner, nonce];
    } catch (e) {
      nonce.iaddn(1);
    }
  }
}

export function getDecimalCount(value: any): number {
  if (
    !isNaN(value) &&
    Math.floor(value) !== value &&
    value.toString().includes('.')
  )
    return value.toString().split('.')[1].length || 0;
  if (
    !isNaN(value) &&
    Math.floor(value) !== value &&
    value.toString().includes('e')
  )
    return parseInt(value.toString().split('e-')[1] || '0');
  return 0;
}

export async function withAssociatedTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: Keypair,
  transaction: Transaction
): Promise<PublicKey> {
  const ataAddress = await getAssociatedTokenAddress(
    mint,
    owner.publicKey,
    true
  );
  try {
    await getAccount(connection, ataAddress, 'confirmed');
  } catch (e) {
    transaction.add(
      await createAssociatedTokenAccountInstruction(
        owner.publicKey,
        ataAddress,
        owner.publicKey,
        mint
      )
    );
  }
  return ataAddress;
}

export function getUnixTs() {
  return new Date().getTime() / 1000;
}

export function roundToDecimal(
  value: number,
  decimals: number | undefined | null
) {
  return decimals ? Math.round(value * 10 ** decimals) / 10 ** decimals : value;
}

export function logIfVerbose(message: string, isVerbose: boolean) {
  if (isVerbose) {
    console.log(message);
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
