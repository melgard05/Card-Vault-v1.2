# Card Vault

A sports card scanner and cataloger — scan cards with your phone camera, let Claude identify them, and track your collection's value over time.

**Live app:** https://YOUR-USERNAME.github.io/card-vault/

## Features

- Camera scanning (front + back) with file upload fallback
- AI card identification via Anthropic's Claude (auto-fills player, year, brand, set, parallel, serial, rookie/auto/relic flags)
- Configurable scan identifiers — toggle fields on/off, add custom fields
- Card inventory with sortable/filterable grid view
- Raw market price + optional static price override per card
- Collection stats (by sport/brand/year/attribute, value distribution, top players, P/L)
- CSV export (Google Sheets compatible) + JSON backup with images
- Persistent browser storage (localStorage, ~5 MB)

## Architecture

- **Frontend:** single-file `index.html` hosted on GitHub Pages
- **AI proxy:** Cloudflare Worker (`worker.js`) that holds the Anthropic API key server-side and forwards scan requests

The worker exists because browsers block direct calls to `api.anthropic.com` (CORS), and hardcoding an API key in the HTML would expose it to anyone viewing source.

## Deployment

### 1. GitHub Pages (frontend)

Repo is already set up. Any push to `main` redeploys the site within a minute or two. To update the app, edit `index.html` and commit.

### 2. Cloudflare Worker (AI proxy)

One-time setup:

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Workers & Pages → Create → Create Worker → name it `card-vault-proxy` → Deploy
3. Edit code → paste contents of [`worker.js`](./worker.js) → Deploy
4. Settings → Variables and Secrets → add two secrets:
   - `ANTHROPIC_API_KEY` — get from [console.anthropic.com](https://console.anthropic.com) → API Keys
   - `ALLOWED_ORIGIN` — set to `https://YOUR-USERNAME.github.io` to restrict the proxy to only this app
5. Copy the worker URL (ends in `.workers.dev`)
6. Open the live app → Settings → AI Proxy → paste URL → Save → Test Connection

To update the worker later: edit `worker.js` here, then copy-paste into the Cloudflare dashboard editor and redeploy. (This repo is the source of truth; Cloudflare is the runtime.)

## Files

| File | Purpose |
|---|---|
| `index.html` | The Card Vault web app (self-contained — HTML/CSS/JS in one file) |
| `worker.js` | Cloudflare Worker proxy source |
| `README.md` | This file |

## Backups

Card data lives in browser localStorage on whatever device you use. It does NOT sync between devices. To back up or move collections:

- **Settings → Data → Export JSON** (includes images, full restore)
- **Settings → Data → Export CSV** (metadata only, opens in Google Sheets)

Export periodically. Clearing browser data wipes the collection.

## Cost notes

- GitHub Pages: free
- Cloudflare Workers: free tier = 100,000 requests/day (far more than needed)
- Anthropic API: roughly $0.01–0.03 per card scan with Claude Sonnet 4, depending on image size

## License

Personal project. No license granted.
