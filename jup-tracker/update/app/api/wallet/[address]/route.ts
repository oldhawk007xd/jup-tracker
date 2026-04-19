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
  name?: string;
  amount: number;
  decimals: number;
  usdValue: number;
  price: number;
  logo?: string;
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
  costBasis: { available: boolean; reason: string };
  perps: { available: boolean; reason: string };
  fetchedAt: string;
  debug?: any;
}

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

// ------------------------------------------------------------------
// Helius DAS: getAssetsByOwner — returns full fungible holdings with
// metadata + USD price pre-resolved. Much more reliable than parsing
// token accounts manually.
// ------------------------------------------------------------------
async function getHeliusAssets(owner: string): Promise<{
  tokens: TokenHolding[];
  solBalance: number;
  solPrice: number;
} | null> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return null;

  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: owner,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
          },
        },
      }),
    });

    if (!res.ok) {
      console.warn('[helius-das] non-ok', res.status);
      return null;
    }

    const json = await res.json();
    const result = json?.result;
    if (!result) return null;

    const items: any[] = result.items || [];
    const tokens: TokenHolding[] = [];

    for (const item of items) {
      if (item.interface !== 'FungibleToken' && item.interface !== 'FungibleAsset') continue;
      const info = item.token_info;
      if (!info) continue;
      const amount = Number(info.balance || 0) / Math.pow(10, info.decimals || 0);
      if (amount <= 0) continue;

      const price = info.price_info?.price_per_token || 0;
      const usdValue = info.price_info?.total_price || amount * price;

      tokens.push({
        mint: item.id,
        symbol: info.symbol || item.content?.metadata?.symbol,
        name: item.content?.metadata?.name,
        amount,
        decimals: info.decimals || 0,
        price,
        usdValue,
        logo: item.content?.links?.image,
      });
    }

    const nativeLamports = result.nativeBalance?.lamports || 0;
    const solBalance = nativeLamports / 1e9;
    const solPrice = result.nativeBalance?.price_per_sol || 0;

    tokens.sort((a, b) => b.usdValue - a.usdValue);

    return { tokens, solBalance, solPrice };
  } catch (err) {
    console.error('[helius-das] failed', err);
    return null;
  }
}

// ------------------------------------------------------------------
// Fallback: raw RPC parsing if Helius is unavailable
// ------------------------------------------------------------------
async function getRpcHoldings(owner: PublicKey): Promise<TokenHolding[]> {
  const connection = getConnection();
  const resp = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const holdings: TokenHolding[] = [];
  for (const { account } of resp.value) {
    const info: any = account.data.parsed?.info;
    if (!info) continue;
    const amount = Number(info.tokenAmount?.uiAmount || 0);
    if (amount <= 0) continue;
    holdings.push({
      mint: info.mint,
      amount,
      decimals: info.tokenAmount?.decimals ?? 0,
      price: 0,
      usdValue: 0,
    });
  }
  return holdings;
}

// ------------------------------------------------------------------
// Jupiter JUP staking via Helius getProgramAccounts
// Escrow layout (Tribeca-based voting escrow):
//   offset 0:   discriminator (8 bytes)
//   offset 8:   locker pubkey (32)
//   offset 40:  owner pubkey (32)     <-- filter target
//   offset 72:  tokens (32)           vault token account
//   offset 104: amount (u64, 8)       <-- what we want
//   offset 112: escrow_started_at (i64)
//   offset 120: escrow_ends_at (i64)
//   offset 128: vote_delegate (32)
// ------------------------------------------------------------------
async function getJupStaking(owner: PublicKey): Promise<StakingInfo> {
  try {
    const connection = getConnection();
    const lockerProgram = new PublicKey(JUP_LOCKER_PROGRAM);

    const accounts = await connection.getProgramAccounts(lockerProgram, {
      commitment: 'confirmed',
      filters: [
        {
          memcmp: {
            offset: 40,
            bytes: owner.toBase58(),
          },
        },
      ],
    });

    if (!accounts || accounts.length === 0) {
      return {
        staked: 0,
        unclaimedRewards: 0,
        hasEscrow: false,
      };
    }

    // Find the escrow account (usually 184 bytes for Tribeca escrow)
    // Pick the one with the largest amount if multiple exist
    let maxAmount = 0n;
    for (const { account } of accounts) {
      const data = account.data;
      if (data.length < 112) continue;
      try {
        const amount = data.readBigUInt64LE(104);
        if (amount > maxAmount) maxAmount = amount;
      } catch {
        continue;
      }
    }

    const staked = Number(maxAmount) / 1e6; // JUP has 6 decimals

    return {
      staked,
      unclaimedRewards: 0,
      hasEscrow: staked > 0,
      note:
        staked > 0
          ? 'ASR unclaimed rewards require DAO program read (Phase 2)'
          : 'Escrow account found but amount could not be parsed',
    };
  } catch (err: any) {
    console.error('[staking] failed', err?.message || err);
    return {
      staked: 0,
      unclaimedRewards: 0,
      hasEscrow: false,
      note: `Staking fetch failed: ${err?.message || 'unknown'}`,
    };
  }
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

  const hasHelius = !!process.env.HELIUS_API_KEY;
  const debug: any = { hasHelius, path: [] };

  try {
    const owner = new PublicKey(address);

    // Try Helius DAS first (best quality)
    const heliusData = await getHeliusAssets(address);

    let tokens: TokenHolding[] = [];
    let solBalance = 0;
    let solPrice = 0;
    let solSource = 'helius';

    if (heliusData) {
      debug.path.push('helius-das');
      tokens = heliusData.tokens;
      solBalance = heliusData.solBalance;
      solPrice = heliusData.solPrice;
    } else {
      debug.path.push('rpc-fallback');
      const connection = getConnection();
      const [lamports, rpcTokens] = await Promise.all([
        connection.getBalance(owner).catch(() => 0),
        getRpcHoldings(owner).catch(() => []),
      ]);
      solBalance = lamports / 1e9;

      // Price enrichment via Jupiter Lite
      const mints = [
        'So11111111111111111111111111111111111111112',
        ...rpcTokens.map((t) => t.mint),
      ];
      const prices = await getPrices(mints);
      solPrice =
        prices['So11111111111111111111111111111111111111112']?.price || 0;
      tokens = rpcTokens
        .map((t) => {
          const p = prices[t.mint]?.price || 0;
          return { ...t, price: p, usdValue: t.amount * p };
        })
        .sort((a, b) => b.usdValue - a.usdValue);
    }

    // Always try to fix missing prices via Jupiter Lite as enrichment layer
    const mintsMissingPrice = tokens
      .filter((t) => !t.price || t.price === 0)
      .map((t) => t.mint);

    if (mintsMissingPrice.length > 0) {
      debug.path.push(`lite-price-fill:${mintsMissingPrice.length}`);
      const extraPrices = await getPrices(mintsMissingPrice);
      tokens = tokens.map((t) => {
        if (t.price && t.price > 0) return t;
        const p = extraPrices[t.mint]?.price || 0;
        return { ...t, price: p, usdValue: t.amount * p };
      });
    }

    // Ensure SOL price is set
    if (!solPrice) {
      const p = await getPrices([
        'So11111111111111111111111111111111111111112',
      ]);
      solPrice =
        p['So11111111111111111111111111111111111111112']?.price || 0;
    }

    // JUP wallet balance
    const jupHolding = tokens.find((t) => t.mint === JUP_MINT);
    const jupBalance = jupHolding?.amount || 0;
    const jupPrice =
      jupHolding?.price ||
      (await getPrices([JUP_MINT]))[JUP_MINT]?.price ||
      0;

    // Staking
    const staking = await getJupStaking(owner);

    // Totals
    const solUsdValue = solBalance * solPrice;
    const jupUsdValue = jupBalance * jupPrice;
    const stakedJupUsd = staking.staked * jupPrice;
    const otherTokensUsd = tokens
      .filter((t) => t.mint !== JUP_MINT)
      .reduce((s, t) => s + (t.usdValue || 0), 0);

    const totalUsdValue =
      solUsdValue + jupUsdValue + stakedJupUsd + otherTokensUsd;

    // Re-sort + limit
    const displayTokens = tokens
      .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
      .slice(0, 25);

    const response: WalletResponse = {
      address,
      solBalance,
      solUsdValue,
      jupBalance,
      jupUsdValue,
      jupPrice,
      totalUsdValue,
      tokens: displayTokens,
      staking,
      costBasis: {
        available: false,
        reason: hasHelius
          ? 'Cost basis requires full transaction history scan — coming Phase 2'
          : 'Requires Helius API key',
      },
      perps: {
        available: false,
        reason: 'Jupiter Perps position parsing — coming Phase 2',
      },
      fetchedAt: new Date().toISOString(),
      debug,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('[wallet-api] fatal', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch wallet data',
        detail: err?.message || 'Unknown error',
        hasHelius,
      },
      { status: 500 }
    );
  }
}
