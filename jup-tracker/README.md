# JUP Tracker Stats

By **@olldhawk** · Paste any Solana wallet, see JUP + staking + portfolio.

## What works

- JUP balance (wallet)
- JUP staked position (via Jupiter locker program)
- SOL balance
- Full SPL token holdings with USD values (Jupiter Price API)
- Total portfolio value

## What's locked behind Helius API

- Avg Cost Basis / Break-Even Price
- ASR unclaimed rewards
- Jupiter Perps positions

These require historical transaction parsing which public Solana RPC cannot
do reliably. Add a Helius API key to enable (10M free req/month at helius.dev).

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel (3 minutes)

1. Push this folder to a new GitHub repo
2. Go to https://vercel.com/new
3. Import the GitHub repo
4. Click **Deploy** (no config needed)
5. Done — you get a live URL like `jup-tracker.vercel.app`

## Optional environment variables

In Vercel → Settings → Environment Variables:

- `SOLANA_RPC_URL` — your own RPC endpoint (recommended, public RPC is rate-limited)
- `HELIUS_API_KEY` — enables cost basis, ASR, perps features

## Tech stack

- Next.js 14 (App Router)
- @solana/web3.js for onchain reads
- Jupiter Price API v2 for USD values
- Zero client-side wallet connection — paste only, fully read-only
