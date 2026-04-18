import { Connection, PublicKey } from '@solana/web3.js';

// JUP token mint
export const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Jupiter staking program (locker)
// Source: https://station.jup.ag/docs/token/stake
export const JUP_LOCKER_PROGRAM = 'voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj';

export function getRpcUrl(): string {
  const custom = process.env.SOLANA_RPC_URL;
  if (custom && custom.length > 0) return custom;
  // Public fallback (rate-limited, ok for low traffic)
  return 'https://api.mainnet-beta.solana.com';
}

export function getConnection(): Connection {
  return new Connection(getRpcUrl(), 'confirmed');
}

export function isValidPubkey(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}
