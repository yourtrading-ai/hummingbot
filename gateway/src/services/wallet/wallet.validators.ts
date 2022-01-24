import {
  mkValidator,
  mkRequestValidator,
  RequestValidator,
  Validator,
  isBase58,
  mkBranchingValidator,
} from '../validators';
import bs58 from 'bs58';

export const invalidEthPrivateKeyError: string =
  'The privateKey param is not a valid Ethereum private key (64 hexadecimal characters).';

export const invalidSolPrivateKeyError: string =
  'The privateKey param is not a valid Solana private key (64 bytes, base 58 encoded).';

// test if a string matches the shape of an Ethereum private key
export const isEthPrivateKey = (str: string): boolean => {
  return /^(0x)?[a-fA-F0-9]{64}$/.test(str);
};

// test if a string matches the shape of an Solana private key
export const isSolPrivateKey = (str: string): boolean => {
  return isBase58(str) && bs58.decode(str).length == 64;
};

// given a request, look for a key called privateKey that is an Ethereum private key
export const validatePrivateKey: Validator = mkBranchingValidator(
  'chainName',
  (req, key) => req[key] === 'solana',
  mkValidator(
    'privateKey',
    invalidSolPrivateKeyError,
    (val) => typeof val === 'string' && isSolPrivateKey(val)
  ),
  mkValidator(
    'privateKey',
    invalidEthPrivateKeyError,
    (val) => typeof val === 'string' && isEthPrivateKey(val)
  )
);

export const invalidChainNameError: string =
  'chainName must be "ethereum", "avalanche" or "solana';

export const invalidAddressError: string = 'address must be a string';

export const validateChainName: Validator = mkValidator(
  'chainName',
  invalidChainNameError,
  (val) =>
    typeof val === 'string' &&
    (val === 'ethereum' || val === 'avalanche' || val === 'solana')
);

export const validateAddress: Validator = mkValidator(
  'address',
  invalidAddressError,
  (val) => typeof val === 'string'
);

export const validateAddWalletRequest: RequestValidator = mkRequestValidator([
  validateChainName,
  validatePrivateKey,
]);

export const validateRemoveWalletRequest: RequestValidator = mkRequestValidator(
  [validateChainName, validateAddress]
);