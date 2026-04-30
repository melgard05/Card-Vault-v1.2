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
        system: `You are a sports card pricing analyst. Given a card description, search the web for recent sold comps (eBay sold listings, 130point.com, PSA Auction Prices, etc.) for that card in raw/ungraded near-mint condition unless a grade is specified. Return ONLY a JSON object (no markdown, no commentary) with this shape:

{
  "rawPriceLow": number,         // low end of recent sales in USD, raw NM
  "rawPriceMedian": number,      // median recent sale in USD
  "rawPriceHigh": number,        // high end (excluding outliers)
  "salesFound": number,          // approximate count of sales used
  "confidence": "low" | "medium" | "high",
  "summary": string,             // one short sentence explaining the estimate
  "sources": [string]            // 1-3 source URLs used
}

If you cannot find enough comps to estimate, return all numeric fields as 0 and explain in summary. Always prefer the most recent 30-90 days of sales. Use raw/ungraded prices unless the user specifies a grade. Do not guess prices without web evidence.`,
        messages: [{ role: 'user', content: `Find recent sold comps and estimate the raw market price for this sports card:\n\n${cardDesc}` }]
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
