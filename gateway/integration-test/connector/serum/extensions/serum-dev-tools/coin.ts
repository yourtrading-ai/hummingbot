import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  RpcResponseAndContext,
  TokenAmount,
} from '@solana/web3.js';

export class Coin {
  private _symbol: string;

  private _decimals: number;

  private _mint: PublicKey;

  private _mintAuthority: Keypair | null;

  private _freezeAuthority: Keypair | null;

  private constructor(
    symbol: string,
    decimals: number,
    mint: PublicKey,
    mintAuthority: Keypair | null,
    freezeAuthority: Keypair | null
  ) {
    this._symbol = symbol;
    this._decimals = decimals;
    this._mint = mint;
    this._mintAuthority = mintAuthority;
    this._freezeAuthority = freezeAuthority;
  }

  public get symbol() {
    return this._symbol;
  }

  public get decimals() {
    return this._decimals;
  }

  public get mint() {
    return this._mint;
  }

  public get mintAuthority() {
    return this._mintAuthority;
  }

  public get freezeAuthority() {
    return this._freezeAuthority;
  }

  /**
   * Load an exisiting mint as a Coin.
   *
   * @param connection The `Connection` object to connect to Solana.
   * @param symbol The symbol to assign to the coin.
   * @param mint The `PublicKey` of the Mint for the coin.
   * @param mintAuthority The minting authority `Keypair` for the coin.
   * @param freezeAuthority The optional freezing authority `Keypair` for the coin.
   * @returns
   */
  static async load(
    connection: Connection,
    symbol: string,
    mint: PublicKey,
    mintAuthority: Keypair | null,
    freezeAuthority: Keypair | null
  ): Promise<Coin> {
    const {
      decimals,
      mintAuthority: tokenMintAuthority,
      freezeAuthority: tokenFreezeAuthority,
    } = await getMint(connection, mint, 'confirmed');
    // tokenMintAuthority has to be truthy since createMint requires a mint authority as well.
    if (
      !!tokenMintAuthority &&
      !!mintAuthority &&
      tokenMintAuthority.toBase58() !== mintAuthority?.publicKey.toBase58()
    ) {
      throw new Error(`Invalid Mint authority provided: ${!!mintAuthority}`);
    }

    if (
      !!tokenFreezeAuthority &&
      !!freezeAuthority &&
      !!tokenFreezeAuthority !== !!freezeAuthority
    ) {
      throw new Error('Invalid Freeze authority provided');
    }

    if (
      tokenFreezeAuthority &&
      freezeAuthority &&
      tokenFreezeAuthority.toBase58() !== freezeAuthority.publicKey.toBase58()
    ) {
      throw new Error('Invalid Freeze authority provided');
    }

    return new Coin(symbol, decimals, mint, mintAuthority, freezeAuthority);
  }

  /**
   * Equality check between two `Coin`s.
   *
   * @param to The `Coin` object to compare to.
   * @returns
   */
  public isEqual(to: Coin) {
    const { mintAuthority, freezeAuthority } = to;

    if (
      mintAuthority &&
      this.mintAuthority &&
      mintAuthority.publicKey.toBase58() !==
        this.mintAuthority.publicKey.toBase58()
    ) {
      return false;
    }

    if (!!freezeAuthority !== !!this.freezeAuthority) {
      return false;
    }

    if (
      freezeAuthority &&
      this.freezeAuthority &&
      freezeAuthority.publicKey.toBase58() !==
        this.freezeAuthority.publicKey.toBase58()
    ) {
      return false;
    }

    return (
      to.symbol === this.symbol &&
      to.decimals === this.decimals &&
      to.mint.toBase58() === this.mint.toBase58()
    );
  }

  /**
   * Get the token balance for the specified owner.
   *
   * @param owner The `Keypair` whose balance to fetch.
   * @param connection The `Connection` object to connect to Solana.
   * @returns
   */
  public async getBalance(
    owner: Keypair,
    connection: Connection
  ): Promise<RpcResponseAndContext<TokenAmount>> {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      this.mint,
      owner.publicKey,
      true,
      'confirmed'
    );

    const tokenAmount = await connection.getTokenAccountBalance(
      ata.address,
      'confirmed'
    );

    return tokenAmount;
  }

  /**
   * Fund the owner key-pair with the specified amount of this coin.
   *
   * @param decimalAmount The amount of tokens to fund account with, in decimal notation.
   * @param owner The `Keypair` to fund.
   * @param connection The `Connection` object to connect to Solana.
   */
  public async fundAccount(
    decimalAmount: number,
    owner: Keypair,
    connection: Connection
  ): Promise<void> {
    if (!this.mintAuthority) {
      throw new Error('Cannot mint tokens without a mint authority');
    }

    const destination = await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      this.mint,
      owner.publicKey,
      true,
      'confirmed'
    );

    const atomicAmount = BigInt(decimalAmount * 10 ** this.decimals);

    const txSig = await mintTo(
      connection,
      owner,
      this.mint,
      destination.address,
      this.mintAuthority,
      atomicAmount
    );

    await connection.confirmTransaction(txSig);
  }
}
