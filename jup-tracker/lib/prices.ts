// Jupiter Price API v2 - free, no key required
// Docs: https://station.jup.ag/docs/apis/price-api

export interface PriceData {
  [mint: string]: {
    price: number;
  };
}

export async function getPrices(mints: string[]): Promise<PriceData> {
  if (mints.length === 0) return {};

  try {
    const unique = Array.from(new Set(mints)).slice(0, 100);
    const url = `https://api.jup.ag/price/v2?ids=${unique.join(',')}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      console.warn('[prices] non-ok status', res.status);
      return {};
    }

    const json = await res.json();
    const out: PriceData = {};

    if (json?.data && typeof json.data === 'object') {
      for (const [mint, val] of Object.entries<any>(json.data)) {
        if (val && typeof val.price !== 'undefined') {
          const n = Number(val.price);
          if (!Number.isNaN(n)) out[mint] = { price: n };
        }
      }
    }

    return out;
  } catch (err) {
    console.error('[prices] fetch failed', err);
    return {};
  }
}
