'use client';

import { useState } from 'react';

interface WalletData {
  address: string;
  solBalance: number;
  solUsdValue: number;
  jupBalance: number;
  jupUsdValue: number;
  jupPrice: number;
  totalUsdValue: number;
  tokens: Array<{
    mint: string;
    amount: number;
    decimals: number;
    usdValue: number;
    price: number;
  }>;
  staking: {
    staked: number;
    unclaimedRewards: number;
    hasEscrow: boolean;
    note?: string;
  };
  costBasis: { available: boolean; reason: string };
  perps: { available: boolean; reason: string };
  fetchedAt: string;
}

function formatUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatAmount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

export default function Home() {
  const [address, setAddress] = useState('');
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    const addr = address.trim();
    if (!addr) {
      setError('Paste a Solana wallet address');
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/wallet/${addr}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to fetch wallet');
      }
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }

  return (
    <div className="container">
      <header className="header">
        <div className="logo">
          JUP Tracker <span className="tag">@olldhawk</span>
        </div>
        <div className="badge">v1 · NFA</div>
      </header>

      <section className="hero">
        <h1>
          Track your <span className="accent">Jupiter</span> positions
        </h1>
        <p>
          Paste any Solana wallet. See JUP balance, staking position, and full
          token portfolio. Onchain data only.
        </p>
      </section>

      <div className="search-box">
        <input
          type="text"
          placeholder="Paste Solana wallet address..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button onClick={handleSearch} disabled={loading}>
          {loading ? 'Loading' : 'Track'}
        </button>
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading && <div className="loading">Fetching onchain data</div>}

      {data && (
        <>
          <div className="grid">
            <div className="card">
              <div className="card-label">Total Portfolio</div>
              <div className="card-value accent">
                {formatUsd(data.totalUsdValue)}
              </div>
              <div className="card-sub">All holdings + staked JUP</div>
            </div>
            <div className="card">
              <div className="card-label">JUP (Wallet)</div>
              <div className="card-value">
                {formatAmount(data.jupBalance)}
              </div>
              <div className="card-sub">
                {formatUsd(data.jupUsdValue)} @ $
                {data.jupPrice.toFixed(4)}
              </div>
            </div>
            <div className="card">
              <div className="card-label">JUP (Staked)</div>
              <div className="card-value">
                {formatAmount(data.staking.staked)}
              </div>
              <div className="card-sub">
                {data.staking.hasEscrow
                  ? formatUsd(data.staking.staked * data.jupPrice)
                  : 'No staking escrow found'}
              </div>
            </div>
            <div className="card">
              <div className="card-label">SOL Balance</div>
              <div className="card-value">
                {formatAmount(data.solBalance)}
              </div>
              <div className="card-sub">{formatUsd(data.solUsdValue)}</div>
            </div>
          </div>

          <section className="section">
            <div className="section-title">Token Holdings · Top 20</div>
            {data.tokens.length === 0 ? (
              <div className="locked">
                <div className="locked-text">No SPL tokens found.</div>
              </div>
            ) : (
              <div className="token-table">
                <div className="token-row head">
                  <div>Token</div>
                  <div>Amount</div>
                  <div className="hide-mobile">Price</div>
                  <div>Value</div>
                </div>
                {data.tokens.map((t) => (
                  <div className="token-row" key={t.mint}>
                    <div className="token-mint">{shortMint(t.mint)}</div>
                    <div>{formatAmount(t.amount)}</div>
                    <div className="hide-mobile">
                      {t.price > 0
                        ? `$${t.price < 0.01 ? t.price.toExponential(2) : t.price.toFixed(4)}`
                        : '—'}
                    </div>
                    <div>{t.usdValue > 0 ? formatUsd(t.usdValue) : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-title">Advanced Metrics</div>
            <div className="grid">
              <div className="locked">
                <div className="locked-title">Avg Cost Basis · Break-Even</div>
                <div className="locked-text">
                  {data.costBasis.reason}
                </div>
              </div>
              <div className="locked">
                <div className="locked-title">Jupiter Perps Positions</div>
                <div className="locked-text">
                  {data.perps.reason}
                </div>
              </div>
              <div className="locked">
                <div className="locked-title">ASR Rewards (Unclaimed)</div>
                <div className="locked-text">
                  {data.staking.note || 'Requires Helius API key to fetch'}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <footer className="footer">
        <div className="disclaimer">
          Not financial advice · Data is onchain and may be delayed · Not
          affiliated with Jupiter Exchange
        </div>
        <div>
          Built by <strong>@olldhawk</strong> · Powered by Solana RPC + Jupiter
          Price API
        </div>
      </footer>
    </div>
  );
}
