import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

/**
 * A wrapper class around @solana/web3.js `Keypair` that allows persisting key-pairs in your local filesystem.
 */
export class FileKeypair {
  public absoluteFilePath: string;
  public keypair: Keypair;

  private constructor(absoluteFilePath: string, keypair: Keypair) {
    this.absoluteFilePath = absoluteFilePath;
    this.keypair = keypair;
  }

  static load(filePath: string): FileKeypair {
    const absolutePath = path.resolve(filePath);
    const fileBuffer = fs.readFileSync(absolutePath);
    const secretKey: number[] = JSON.parse(fileBuffer.toString());
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    return new FileKeypair(absolutePath, keypair);
  }

  static generate(filePath: string): FileKeypair {
    const absolutePath = path.resolve(filePath);
    const keypair = Keypair.generate();
    const secretKey = Array.from(keypair.secretKey);
    fs.writeFileSync(absolutePath, JSON.stringify(secretKey));
    return new FileKeypair(absolutePath, keypair);
  }

  static loadOrGenerate(filePath: string): FileKeypair {
    let keypair: Keypair;
    let secretKey: number[];
    const absolutePath = path.resolve(filePath);

    try {
      const fileBuffer = fs.readFileSync(absolutePath);
      secretKey = JSON.parse(fileBuffer.toString());
      keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (e) {
      keypair = Keypair.generate();
      secretKey = Array.from(keypair.secretKey);
      fs.writeFileSync(absolutePath, JSON.stringify(secretKey));
    }

    return new FileKeypair(absolutePath, keypair);
  }

  static withKeypair(filePath: string, keypair: Keypair): FileKeypair {
    const absolutePath = path.resolve(filePath);

    const secretKey = Array.from(keypair.secretKey);
    fs.writeFileSync(absolutePath, JSON.stringify(secretKey));

    return new FileKeypair(absolutePath, keypair);
  }
}
