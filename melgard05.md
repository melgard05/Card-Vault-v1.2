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

One-time setup. Cloudflare's dashboard layout changes a few times a year — if the specific menu labels below don't match exactly, look for "Workers" somewhere in the left sidebar.

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (free account is fine)
2. In the left sidebar, find **Compute** or **Compute & AI** → click **Workers & Pages**
3. Click **Create** (or **Create application**) → **Start with Hello World!** → **Get started**
4. Name it `card-vault-proxy` → click **Deploy**. Cloudflare creates a basic worker and shows you its `.workers.dev` URL.
5. Click **Continue to project** (or **Edit code** from the worker overview)
6. In the code editor, select all existing code in `worker.js` (or `index.js`), delete it, and paste the contents of [`worker.js`](./worker.js) from this repo. Click **Deploy** (top right of editor).
7. Go back to the worker overview → **Settings** tab → scroll to **Variables and Secrets** → click **Add**:
   - Type: **Secret**
   - Variable name: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys
   - Click **Deploy**
8. Click **Add** again to add a second secret (recommended for security):
   - Type: **Secret**
   - Variable name: `ALLOWED_ORIGIN`
   - Value: `https://YOUR-USERNAME.github.io` (root URL only, no trailing slash, no path)
   - Click **Deploy**
9. Copy the worker URL from the overview page (ends in `.workers.dev`)
10. Open the live app → **Settings** tab → **AI Proxy** → paste URL → **Save** → **Test Connection**. Green "✓ Proxy reachable" means you're live.

**Troubleshooting:**
- "Add" missing under Variables and Secrets? You're on the Workers & Pages landing page, not inside your worker. Click into `card-vault-proxy` first.
- Test Connection fails with CORS error? Check `ALLOWED_ORIGIN` matches your GitHub Pages URL exactly (no typos, no trailing slash).
- "ANTHROPIC_API_KEY secret not set" error? The secret name must be exactly `ANTHROPIC_API_KEY` (case-sensitive).

To update the worker code later: edit `worker.js` here, then copy-paste into the Cloudflare dashboard editor and redeploy. (This repo is the source of truth; Cloudflare is the runtime.)

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
