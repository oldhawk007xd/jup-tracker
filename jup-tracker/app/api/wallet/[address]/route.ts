import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import {
  getConnection,
  isValidPubkey,
  JUP_MINT,
  JUP_LOCKER_PROGRAM,
} from '@/lib/solana';
import { getPrices } from '@/lib/prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TokenHolding {
  mint: string;
  symbol?: string;
  amount: number;
  decimals: number;
  usdValue: number;
  price: number;
}

interface StakingInfo {
  staked: number;
  unclaimedRewards: number;
  hasEscrow: boolean;
  note?: string;
}

interface WalletResponse {
  address: string;
  solBalance: number;
  solUsdValue: number;
  jupBalance: number;
  jupUsdValue: number;
  jupPrice: number;
  totalUsdValue: number;
  tokens: TokenHolding[];
  staking: StakingInfo;
  costBasis: {
    available: boolean;
    reason: string;
  };
  perps: {
    available: boolean;
    reason: string;
  };
  fetchedAt: string;
}

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

async function getJupStakingPosition(
  owner: PublicKey
): Promise<StakingInfo> {
  try {
    const connection = getConnection();
    const lockerProgram = new PublicKey(JUP_LOCKER_PROGRAM);

    // Jupiter uses an escrow account derived from [locker, owner]
    // We do a broader getProgramAccounts filtered by owner
    // to avoid needing the exact locker pubkey hardcoded.
    const accounts = await connection.getProgramAccounts(lockerProgram, {
      filters: [
        { dataSize: 300 }, // Escrow account size (approx)
        {
          memcmp: {
            offset: 40, // owner field offset in Escrow struct
            bytes: owner.toBase58(),
          },
        },
      ],
      commitment: 'confirmed',
    });

    if (accounts.length === 0) {
      return {
        staked: 0,
        unclaimedRewards: 0,
        hasEscrow: false,
      };
    }

    // Parse amount field from first escrow account
    // Escrow layout (simplified): discriminator(8) + locker(32) + owner(32) + tokens(32) + amount(u64) + ...
    const data = accounts[0].account.data;
    // amount is at offset 104 (8 + 32 + 32 + 32)
    const amountBuf = data.subarray(104, 112);
    const amountRaw = amountBuf.readBigUInt64LE(0);
    const staked = Number(amountRaw) / 1e6; // JUP has 6 decimals

    return {
      staked,
      unclaimedRewards: 0, // Requires ASR program read - phase 2
      hasEscrow: true,
      note: 'Unclaimed ASR rewards require Helius API key',
    };
  } catch (err) {
    console.error('[staking] fetch failed', err);
    return {
      staked: 0,
      unclaimedRewards: 0,
      hasEscrow: false,
      note: 'Unable to fetch staking data — RPC may be rate-limited',
    };
  }
}

async function getTokenHoldings(
  owner: PublicKey
): Promise<{ mint: string; amount: number; decimals: number }[]> {
  const connection = getConnection();
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const holdings: { mint: string; amount: number; decimals: number }[] = [];
  for (const { account } of resp.value) {
    const info: any = account.data.parsed?.info;
    if (!info) continue;
    const amount = Number(info.tokenAmount?.uiAmount || 0);
    if (amount <= 0) continue;
    holdings.push({
      mint: info.mint,
      amount,
      decimals: info.tokenAmount?.decimals ?? 0,
    });
  }
  return holdings;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } }
) {
  const address = params.address;

  if (!address || !isValidPubkey(address)) {
    return NextResponse.json(
      { error: 'Invalid Solana address' },
      { status: 400 }
    );
  }

  try {
    const owner = new PublicKey(address);
    const connection = getConnection();

    // Run independent fetches in parallel
    const [solLamports, holdings, staking] = await Promise.all([
      connection.getBalance(owner).catch(() => 0),
      getTokenHoldings(owner).catch((e) => {
        console.error('[tokens] failed', e);
        return [];
      }),
      getJupStakingPosition(owner),
    ]);

    const solBalance = solLamports / 1e9;

    // Get prices for SOL + JUP + top holdings
    const mintsToPrice = [
      'So11111111111111111111111111111111111111112',
      JUP_MINT,
      ...holdings.map((h) => h.mint),
    ];
    const prices = await getPrices(mintsToPrice);

    const solPrice =
      prices['So11111111111111111111111111111111111111112']?.price || 0;
    const jupPrice = prices[JUP_MINT]?.price || 0;

    // JUP holding (wallet, not staked)
    const jupHolding = holdings.find((h) => h.mint === JUP_MINT);
    const jupBalance = jupHolding?.amount || 0;

    const tokens: TokenHolding[] = holdings
      .map((h) => {
        const price = prices[h.mint]?.price || 0;
        return {
          mint: h.mint,
          amount: h.amount,
          decimals: h.decimals,
          price,
          usdValue: h.amount * price,
        };
      })
      .sort((a, b) => b.usdValue - a.usdValue);

    const solUsdValue = solBalance * solPrice;
    const jupUsdValue = jupBalance * jupPrice;
    const stakedJupUsd = staking.staked * jupPrice;
    const tokensUsdSum = tokens
      .filter((t) => t.mint !== JUP_MINT)
      .reduce((s, t) => s + t.usdValue, 0);

    const totalUsdValue =
      solUsdValue + jupUsdValue + stakedJupUsd + tokensUsdSum;

    const hasHelius = !!process.env.HELIUS_API_KEY;

    const response: WalletResponse = {
      address,
      solBalance,
      solUsdValue,
      jupBalance,
      jupUsdValue,
      jupPrice,
      totalUsdValue,
      tokens: tokens.slice(0, 20),
      staking,
      costBasis: {
        available: false,
        reason: hasHelius
          ? 'Feature coming in Phase 2'
          : 'Requires Helius API key — add HELIUS_API_KEY env var to enable',
      },
      perps: {
        available: false,
        reason: 'Jupiter Perps parsing coming in Phase 2',
      },
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('[wallet-api] fatal', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch wallet data',
        detail: err?.message || 'Unknown error',
        hint: 'Public RPC may be rate-limited. Add SOLANA_RPC_URL env var with your own endpoint.',
      },
      { status: 500 }
    );
  }
}
