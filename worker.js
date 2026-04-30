// Card Vault — Anthropic API Proxy (with price lookup)
// Deploy this to a Cloudflare Worker. Set ANTHROPIC_API_KEY as a secret.
// Optionally set ALLOWED_ORIGIN to your GitHub Pages URL to restrict access.
//
// Endpoints:
//   GET  /                 → health check
//   POST /                 → forward as-is to /v1/messages (used by AI scan)
//   POST /price            → run a card-pricing query with Claude + web_search

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsOrigin = (allowed === '*' || origin === allowed) ? (origin || '*') : allowed;

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Origin guard
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin && origin !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden origin', { status: 403, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, service: 'card-vault-proxy', endpoints: ['/', '/price'] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // /price → enrich the request with the web_search tool and a price-focused system prompt
    if (path === '/price') {
      const cardDesc = body.cardDescription || '';
      const model = body.model || 'claude-sonnet-4-6';
      if (!cardDesc) {
        return new Response(JSON.stringify({ error: 'cardDescription required' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      const apiBody = {
        model,
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        system: `You are a sports card pricing analyst. Search the web for RECENT SOLD comps (not asking prices, not graded comps for raw cards) and estimate the price.

CRITICAL RULES — follow these strictly to avoid overestimating:

1. RAW means UNGRADED. If the user did NOT specify a grade, you MUST use only raw/ungraded sold comps. Filter out any PSA, BGS, SGC, CGC slabbed sales — graded cards trade at large premiums and will skew the estimate high.

2. SOLD prices only — never asking prices. Prefer eBay "Sold listings" filter (ebay.com/sch/?LH_Sold=1&LH_Complete=1), 130point.com, or PSA Auction Prices Realized. Asking-price aggregators (TCDB, COMC asking, CardLadder asking) must be excluded.

3. EXCLUDE OUTLIERS. Drop the highest and lowest sale before computing the median. If a single sale is more than 3x the next-highest sale, ignore it (likely a different parallel/auto/graded copy).

4. EXACT MATCH on card identity. Verify each comp matches: same player, year, brand, set, parallel, AND attributes (auto/relic/serial #). If you can't verify the parallel, search again with the parallel as a quoted phrase. Don't mix base cards with parallels — refractors, color parallels, autos, and rookies all sell at very different price points than base.

5. CONDITION BIAS. Most raw eBay sales are NM/EX, not Mint. Use the median, not the average — a couple of pristine copies can pull the average way up.

6. CONFIDENCE RATING:
   - "high": 5+ matching sold comps in last 60 days, tight price range
   - "medium": 3-4 matching comps, or older/wider range
   - "low": <3 comps, or significant variance, or you had to estimate from a similar but not exact match

7. If user specified a grade (e.g. "PSA 10"), search for that exact graded sales only.

Return ONLY a JSON object (no markdown, no commentary) with this shape:
{
  "rawPriceLow": number,
  "rawPriceMedian": number,
  "rawPriceHigh": number,
  "salesFound": number,
  "confidence": "low" | "medium" | "high",
  "summary": string,
  "sources": [string]
}

If you cannot find enough exact-match sold comps, return all numeric fields as 0 and explain in summary — do NOT guess.`,
        messages: [{ role: 'user', content: `Find recent SOLD comps and estimate the price for this sports card. Be conservative — bias toward the median of clean sold comps, not the high end:\n\n${cardDesc}` }]
      };

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(apiBody)
      });
      const data = await apiRes.text();
      return new Response(data, {
        status: apiRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Default: forward whatever body the client sent to /v1/messages
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await apiRes.text();
    return new Response(data, {
      status: apiRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
};
