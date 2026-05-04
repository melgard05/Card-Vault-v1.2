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
      const fields = body.fields || {};
      const model = body.model || 'claude-sonnet-4-6';
      if (!cardDesc) {
        return new Response(JSON.stringify({ error: 'cardDescription required' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Build a structured constraints block — card number gets PRIMARY emphasis
      // because it uniquely identifies a card within a set
      const constraints = [];
      if (fields.cardNumber) constraints.push(`CARD NUMBER: #${fields.cardNumber} — this is the printed number on the card and is the PRIMARY identifier within the set. Comps must match this exact number. Build search queries that include "#${fields.cardNumber}" so you can verify each comp.`);
      if (fields.year) constraints.push(`YEAR: ${fields.year}`);
      if (fields.brand) constraints.push(`BRAND: ${fields.brand}`);
      if (fields.setName) constraints.push(`SET: ${fields.setName}`);
      if (fields.player) constraints.push(`PLAYER: ${fields.player}`);
      if (fields.team) constraints.push(`TEAM: ${fields.team}`);
      if (fields.parallel) constraints.push(`PARALLEL/VARIANT: ${fields.parallel} — must match exactly; do NOT use base card comps. Refractors, color parallels, and inserts trade at very different prices than base.`);
      if (fields.serial) constraints.push(`SERIAL: ${fields.serial}`);
      if (fields.isRookie) constraints.push(`ATTRIBUTE: rookie card`);
      if (fields.isAuto) constraints.push(`ATTRIBUTE: autograph (must be auto'd, not base)`);
      if (fields.isRelic) constraints.push(`ATTRIBUTE: relic/patch (must contain memorabilia)`);
      if (fields.isGraded && fields.grade) constraints.push(`GRADE: ${fields.gradingCompany || ''} ${fields.grade} — use only graded sales of this exact grade`);
      else constraints.push(`GRADE: raw/ungraded — exclude any PSA, BGS, SGC, CGC slabbed sales`);

      const constraintsBlock = constraints.length
        ? `\n\nMatch criteria for comps (ALL must match):\n${constraints.map(c => '- ' + c).join('\n')}`
        : '';

      const apiBody = {
        model,
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        system: `You are a sports card pricing analyst. Search the web for RECENT SOLD comps (not asking prices, not graded comps for raw cards) and estimate the price. Also collect the actual individual sales found so the user can verify them.

SEARCH STRATEGY:
- First search for the EXACT card including parallel: e.g. "2022 Panini Prizm Pink Ice Luka Doncic #150 sold ebay"
- Then do a broader search for the same player+year+set without the parallel filter, to gather sales of OTHER parallels of the same card. This helps the user see context.
- Combine both result sets in your final response.

CRITICAL RULES — follow these strictly to avoid overestimating:

1. CARD NUMBER IS THE PRIMARY DISAMBIGUATOR. Within a set, two cards of the same player can have very different prices. When the user provides a printed card number, your search queries MUST include it. Verify the card number matches each comp before counting it for the price estimate.

2. RAW means UNGRADED. If the user did NOT specify a grade, only count raw/ungraded sold comps in the price estimate. (You can still INCLUDE graded sales in the sales list with grade flagged, but don't compute median from them when raw was requested.)

3. SOLD prices only — never asking prices. Prefer eBay "Sold listings" filter (ebay.com/sch/?LH_Sold=1&LH_Complete=1), 130point.com, or PSA Auction Prices Realized.

4. EXCLUDE OUTLIERS from the estimate. Drop the highest and lowest sale before computing the median. If a single sale is more than 3x the next-highest sale, ignore it for the median (but still include it in the sales list with a note).

5. PARALLEL MATCHING. For each sale, set the parallel field to whatever parallel/variant the listing actually was (e.g. "Pink Ice", "Silver Prizm", "Base"). Set isExactParallel to true ONLY if the sale matches the user's specified parallel exactly (or matches "base/no parallel" when no parallel was specified). When the parallel field includes any color/refractor/insert designation, isExactParallel should be false unless that exact string was specified.

6. CONDITION BIAS. Most raw eBay sales are NM/EX, not Mint. Use the median, not the average.

7. CONFIDENCE RATING:
   - "high": 5+ exact-parallel sold comps in last 60 days with verified card number
   - "medium": 3-4 exact-parallel comps, or wider range
   - "low": <3 exact-parallel comps, missing card number, or estimate from non-exact matches

Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "rawPriceLow": number,
  "rawPriceMedian": number,
  "rawPriceHigh": number,
  "salesFound": number,
  "confidence": "low" | "medium" | "high",
  "summary": string,
  "sources": [string],
  "sales": [
    {
      "title": string,           // listing title or short description
      "price": number,           // sale price in USD
      "date": string,            // sale date if known, e.g. "2026-04-15" or "Apr 2026" — empty string if unknown
      "url": string,             // direct URL to the sold listing if available
      "parallel": string,        // what parallel/variant the sale actually was (e.g. "Pink Ice", "Silver Prizm", "Base", "PSA 10")
      "grade": string,           // grading company + grade if graded, e.g. "PSA 10" — empty string if raw
      "isExactParallel": boolean // true only if this sale matches the user's specified parallel exactly
    }
  ]
}

The sales array should include up to 15 individual sales — both exact-parallel matches AND other parallels of the same card so the user has context. The price estimate (rawPriceLow/Median/High) should be computed ONLY from the exact-parallel sales. If you cannot find enough exact-match sold comps, return rawPriceMedian as 0 and explain in summary, but still include any sales you DID find in the sales array.`,
        messages: [{ role: 'user', content: `Find recent SOLD comps for this sports card. Return both the price estimate AND a list of the individual sales found. Match the specified parallel first, then include other parallels of the same card for context.\n\nCard: ${cardDesc}${constraintsBlock}` }]
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
