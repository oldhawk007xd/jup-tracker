// Jupiter Lite Price API v2 (free, no key required)
// Docs: https://dev.jup.ag/docs

export interface PriceData {
  [mint: string]: { price: number };
}

const JUP_LITE_PRICE = 'https://lite-api.jup.ag/price/v2';

export async function getPrices(mints: string[]): Promise<PriceData> {
  if (mints.length === 0) return {};

  const unique = Array.from(new Set(mints.filter(Boolean))).slice(0, 100);
  if (unique.length === 0) return {};

  const out: PriceData = {};

  try {
    const url = `${JUP_LITE_PRICE}?ids=${unique.join(',')}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      console.warn('[prices] jup lite non-ok', res.status);
      return out;
    }

    const json = await res.json();

    if (json?.data && typeof json.data === 'object') {
      for (const [mint, val] of Object.entries<any>(json.data)) {
        if (val && val.price != null) {
          const n = Number(val.price);
          if (!Number.isNaN(n) && n > 0) {
            out[mint] = { price: n };
          }
        }
      }
    }

    return out;
  } catch (err) {
    console.error('[prices] fetch failed', err);
    return out;
  }
}
