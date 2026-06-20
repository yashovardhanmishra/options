# Option-Chain App — Integration Investigation

**Date:** 2026-06-20 · **Mode:** read-only investigation (nothing modified/built/deployed)
**App path:** `/Users/yasho/Desktop/data`
**Live:** http://65.20.82.79 (Vultr) · **Repo:** https://github.com/yashovardhanmishra/options
**Compared against:** StratosAI (`/Users/yasho/Downloads/Cosmic Backtester (2)`)

> TL;DR — This is a **plain React 18 + Vite 5 SPA** (static `dist/`) **served by a FastAPI
> Python backend**, deployed on Vultr via **Docker Compose (app + Caddy)**. Its options data
> is **historical per-strike 1-minute OHLCV+OI** in a **2.6 GB DuckDB** — i.e. it **can**
> back options backtesting. It **already has Supabase Google auth**. Stratos is a **different
> stack** (React 19 / Vite 7 / TypeScript / TanStack Start SSR / Cloudflare Workers / Bun),
> so the two are best run as **two apps behind one Caddy**, not merged.

---

## 1. STACK & STRUCTURE

### Frontend — `frontend/package.json` (full)
```json
{
  "name": "nifty-options-viewer",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "axios": "^1.7.7",
    "date-fns": "^3.6.0",
    "lightweight-charts": "^4.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "vite": "^5.4.11"
  }
}
```
- **Framework / build tool:** React **18.3** + Vite **5.4** (plain JavaScript/JSX — *no TypeScript*).
- **Styling:** Tailwind **3.4** via PostCSS. **Routing:** none — it's a single component tree;
  the "spot in a new tab" view is a `?view=spot` query-param branch in `App.jsx`, not a router.
- **Charts:** `lightweight-charts` 4.2. **HTTP:** `axios`. **Auth client:** `@supabase/supabase-js`.

### Backend — Python / FastAPI (`server.py`, 557 lines) + `ingest.py`
`requirements.txt`:
```
fastapi
uvicorn[standard]
pandas
python-dotenv
duckdb
pyjwt[crypto]
```
A single FastAPI service that (a) exposes a JSON API over the options data and (b) **serves
the built React SPA itself** (same origin) via `StaticFiles(html=True)` mounted at `/`.

### Stack comparison vs Stratos
| | **Option-chain app** | **StratosAI** |
|---|---|---|
| React | **18.3** | **19.2** |
| Vite | **5.4** | **7.3** |
| Language | **Plain JS/JSX** | **TypeScript** |
| Framework | none (pure SPA) | **TanStack Start** (SSR) + Router + React Query |
| Tailwind | 3.4 (PostCSS) | 4.2 (`@tailwindcss/vite`) |
| UI kit | hand-rolled | Radix UI + shadcn |
| Pkg manager | npm (`package-lock.json`) | **Bun** (`bun.lock`, `bunfig.toml`) |
| Deploy target | static `dist/` behind FastAPI | **Cloudflare Workers** (`wrangler.jsonc`, `@cloudflare/vite-plugin`, `.wrangler/`) |
| Backend | separate **FastAPI/Python** | TanStack server fns (edge) + Supabase |
| Auth | Supabase **Google OAuth** | Supabase + `@lovable.dev/cloud-auth-js`, `_authenticated` routes |

→ **Different stack on essentially every axis.** They share only Supabase + `lightweight-charts`.

### Top-level folder structure
```
/Users/yasho/Desktop/data
├── server.py              FastAPI backend (API + serves the SPA)        21 KB
├── ingest.py             CSV → DuckDB builder
├── requirements.txt
├── Dockerfile            multi-stage: build SPA (node) → run FastAPI (python)
├── docker-compose.yml    services: app + caddy
├── Caddyfile             reverse-proxy (repo copy targets example.com)
├── DEPLOY.md / AUTH.md / README.md / CLAUDE.md
├── frontend/             React + Vite SPA
│   └── src/
│       ├── App.jsx, main.jsx, api.js, supabase.js, index.css
│       ├── components/   ChartPanel, OptionChain, IndicatorMenu, SearchBar,
│       │                 CodeModal, Login
│       └── utils/        indicators.js, patterns.js, pine.js, pinescript.js, resample.js
├── 2023/ 2024/ 2025/ 2026/   per-expiry, per-strike option CSVs (~31,127 files)
├── nifty.csv             Nifty index 1-min OHLCV (spot feed)            21 MB
└── (research artifacts) backtest.py, dhan_*.py, pcr_*_backtest.py, *.ipynb, .venv-dhan,
                         "untitled folder", "untitled folder 2"  ← local-only clutter
```

### Frontend / backend / SPA?
- **Both a frontend and a backend**, in one repo, served from one process in production.
- **Frontend:** a **client-rendered single-page app** (Vite build → static `index.html` +
  `assets/*.js|css`). No SSR.
- **Backend:** FastAPI reads the options data (DuckDB fast-path, CSV fallback) and returns JSON;
  in production it *also* serves the SPA's static files, so the whole thing is **same-origin**.

---

## 2. BUILD & RUN

- **Build (frontend):** `npm run build` → `vite build` → static **`frontend/dist/`**
  (`index.html` + hashed `assets/`). No server bundle; the Python backend is run as-is.
- **Dev:** `npm run dev` (Vite) → **:5173**; backend `uvicorn server:app --port 8000` → **:8000**.
  In dev the SPA calls `http://localhost:8000`; in the prod build it calls same-origin (`""`).
- **Runtime versions:** Docker uses **Node 20-alpine** (build) and **Python 3.12-slim** (run).
  Docs (`CLAUDE.md`) state minimums **Node 18+ / Python 3.10+**.
- **Environment variables (KEYS only — no values read):**
  - `frontend/.env` (present, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  - `frontend/.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, (optional) `VITE_API_BASE`
  - **Server** `/opt/options/.env` (keys only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
    `SUPABASE_JWT_SECRET`
  - Backend also reads (with defaults): `DATA_DIR`, `DB_PATH`, `WARM_EXPIRIES`, `SUPABASE_URL`,
    `SUPABASE_JWT_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `CORS_ORIGINS`, `SPOT_CSV`, `FRONTEND_DIR`.
  - There is **no root `.env` locally** (it lives only on the server).

---

## 3. DEPLOYMENT ON VULTR

### How it's served
**Single Docker image**, two Compose services. The Dockerfile builds the SPA in a Node stage,
then copies `dist/` into the Python image; FastAPI serves both the API and the static SPA.
Caddy sits in front as the reverse proxy / TLS terminator.

`Dockerfile` (verbatim):
```dockerfile
# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build
# ---- Stage 2: backend + bundled static frontend ----
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py ingest.py ./
COPY --from=web /web/dist ./frontend/dist
ENV DATA_DIR=/data
ENV DB_PATH=/db/nifty.duckdb
ENV WARM_EXPIRIES=2
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

`docker-compose.yml` (services): **`app`** (the image above; mounts `/opt/nifty-data:/data:ro`
for CSVs and `/opt/nifty-db:/db` for the DuckDB; `expose: 8000`, not published) and **`caddy`**
(`caddy:2`, publishes **80 + 443**, mounts `./Caddyfile`). Frontend Supabase keys are baked in
at build time via `args`; backend auth/runtime config via `environment`.

### Reverse proxy + the IP/port (live state, read off the server)
The **repo** `Caddyfile` targets a domain:
```caddyfile
example.com {
    encode gzip zstd
    reverse_proxy app:8000
}
```
…but the **actual file on the server** (`/opt/options/Caddyfile`) is the HTTP-only block:
```caddyfile
:80 {
    encode gzip zstd
    reverse_proxy app:8000
}
```
So **right now it serves plain HTTP on `:80` at the IP** (`http://65.20.82.79`) and proxies to
`app:8000`. Caddy already **publishes 443** too, so flipping to HTTPS is a one-line change the
moment a domain's DNS points at the box (Caddy auto-provisions Let's Encrypt).

### SSL / HTTPS
**Not active yet** (no domain). The machinery is in place (Caddy on 80/443 + auto-cert on a
real hostname); the live Caddyfile is intentionally HTTP-only for the bare IP.

### How updates ship (`/opt/options/deploy.sh`)
```bash
#!/usr/bin/env bash
set -e
cd /opt/options
git pull
docker compose up -d --build
docker compose ps
```
i.e. **git pull → rebuild → restart** (no CI/CD; run manually after `git push`).

### Live server facts (read-only)
- **VPS:** Vultr, **Ubuntu 24.04.4 LTS**, **2 vCPU**, **3.8 GB RAM**, **120 GB disk (90 GB free)**.
- **Containers up:** `options-app-1` (uvicorn, internal 8000) + `options-caddy-1` (80/443).
- **Data on server:** `/opt/nifty-data/` = `2023 2024 2025 2026 nifty.csv`;
  `/opt/nifty-db/nifty.duckdb` = **2.6 GB** (+ `.duckdb_tmp`).

---

## 4. THE OPTIONS DATA  ← key for Phase 2

### Where it lives
Two tiers, same data:
1. **Raw CSVs** — `<year>/<expiry>/<expiry>_<strike><CE|PE>.csv`, **~31,127 files**, 2023→2026.
   No external API at request time; everything is local on disk.
2. **DuckDB** (`nifty.duckdb`, **2.6 GB**) — the prebuilt fast path the live server actually
   queries; CSVs are only the build source / fallback.

It is **NOT** an external/live data provider — the app reads its **own historical files**.
(There are separate *ingestion* scripts — `dhan_download.py`, `dhan_*.py` — that the owner used
to pull historical option data from **Dhan** into these CSVs, but the running app never calls them.)

### Historical vs live → **HISTORICAL**
This is **historical per-strike option price history**, not a current snapshot. Each strike file
is a time series of **1-minute** bars. The on-screen "option chain at a time" is reconstructed by
slicing this history at a chosen timestamp — there is no live feed.

### Schema (DuckDB, from `ingest.py`)
Table **`bars`** (one row per strike-minute):
```
expiry  (YYYY-MM-DD)   strike (INT)   type (CE|PE)
unix    (BIGINT, IST wall-clock encoded as UTC seconds)
date    (YYYY-MM-DD)   hm (HH:MM)
open  high  low  close  volume  oi          -- oi = open interest
```
Plus dimension tables `dim_instruments` (expiry,strike,type), `dim_dates`, `dim_times` for instant
selectors. Written **clustered by `expiry`** (zonemap pruning; no heavy ART indexes).
Raw CSV header: `Date,Time,Open,High,Low,Close,Volume,Open Interest` (Date = `DD/MM/YYYY`).
**Row count ≈ 161 million bars** (per the last ingest run that produced this 2.6 GB file).

### Instruments / underlying
- **NIFTY only** — index options (CE/PE across strikes) + the **NIFTY index spot** itself
  (`nifty.csv`, 1-min OHLCV, **2022→2026**, ~371 k bars, served via `/api/spot`).
- No BANKNIFTY / stock options in this dataset.

### Granularity + history depth
- **1-minute** bars throughout.
- Each per-strike file spans roughly the **~1 month before that expiry** (e.g. a 2025-01-30
  expiry file carries 1-min bars from ~2024-12-30, ~9,000 rows ≈ ~24 trading days). This is
  inherent to options (a strike only exists for one expiry cycle), **not** a multi-year series
  per strike.
- Across 2023→2026 there are **dozens of weekly expiries**, each with its full strike ladder.

### CRITICAL — can it back **backtesting**?  → **YES**
It has exactly what an options backtester needs: **historical, timestamped, per-strike CE/PE
prices (OHLC) + volume + open interest at 1-minute resolution**, across the strike ladder for
every expiry, plus the aligned **underlying** series. You can reconstruct any strike's intraday
path, model entries/exits on real fills, and use OI/volume as signals.

**Caveats to design around:**
- History per instrument = the **pre-expiry window** (intraday / short-dated strategies), not
  years of continuous per-strike data — fine for weekly-expiry options backtests, which is the
  whole point.
- Time is **IST wall-clock encoded as UTC seconds** — any consumer must use UTC getters / treat
  it as the IST clock (the frontend's existing convention).
- The current API serves **one strike's full history per call** (`/api/chart?expiry&strike&type`);
  a backtester scanning many strikes would want a **batch / date-range** endpoint added (Phase 2).

---

## 5. AUTH / ACCESS

**Yes — it already has full auth: Supabase Google (Gmail) OAuth, on by default in production.**

- **Frontend:** `supabase.js` (`signInWithGoogle`, session) + `Login.jsx` ("Continue with
  Google"). `App.jsx` gates the whole app behind a session when keys are present; otherwise runs
  with no login (local dev). `api.js` attaches `Authorization: Bearer <access_token>` to every call.
- **Backend (`server.py`) — middleware gates every `/api/` route:**
```python
@app.middleware("http")
async def _require_auth(request, call_next):
    path = request.url.path
    if AUTH_ENABLED and request.method != "OPTIONS" and path.startswith("/api/"):
        header = request.headers.get("authorization", "")
        token = header[7:] if header[:7].lower() == "bearer " else ""
        try:
            payload = _verify_token(token)
        except Exception:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        if ALLOWED_EMAIL_DOMAINS:
            email = (payload.get("email") or "").lower()
            if not any(email.endswith("@" + d) for d in ALLOWED_EMAIL_DOMAINS):
                return JSONResponse({"detail": "Account not allowed"}, status_code=403)
    return await call_next(request)
```
- **Token verification:** picks the algorithm by token type — modern Supabase **ES256/RS256**
  verified against the project **JWKS** (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached
  `PyJWKClient`); legacy **HS256** via the shared `SUPABASE_JWT_SECRET`. `AUTH_ENABLED` is true
  whenever either Supabase key is set (it is, on the server).
- **Allow-list:** optional `ALLOWED_EMAIL_DOMAINS` (e.g. `gmail.com`) — currently **unset** on the
  server, so any Google account can log in.
- **Note:** auth gates `/api/*` only; the static SPA shell is public, but it shows the login
  screen and can't fetch any data without a valid token.

This is **reusable** to gate Stratos — but note it's **Google-account login**, not a shared
**password**. The user explicitly wants a **password gate**, which is a different (simpler) thing.

---

## 6. GIT STATE

- **Git repo:** yes. **Remote:** `origin → https://github.com/yashovardhanmishra/options.git`
  (fetch + push). **Pushed:** yes.
- **Branch:** `main`.
- **Status:** essentially clean — only `M .gitignore` is uncommitted. The data folders, `.env`,
  `node_modules`, research scripts, and the stray "untitled folder"s are gitignored (the repo holds
  **code only**, not the ~8 GB of CSVs).
- **Last commit:** `e542a1d Resample: anchor intraday bars to the 09:15 NSE session open`.

---

## SUMMARY

- **Same stack as Stratos: NO.** This app = React **18** / Vite **5** / **plain JS** / Tailwind 3 /
  **static SPA + FastAPI(Python)**, deployed as Docker behind Caddy. Stratos = React **19** /
  Vite **7** / **TypeScript** / **TanStack Start (SSR)** / Tailwind 4 / **Bun** / built for
  **Cloudflare Workers**. They share only Supabase + lightweight-charts. → **No code merge;
  run them side-by-side behind one proxy.**

- **Options data supports backtesting: YES.** It's **historical, per-strike, 1-minute CE/PE
  OHLC + volume + open interest** (DuckDB, ~161 M bars, 2.6 GB; NIFTY only) plus the aligned
  1-min **spot** series — real fills to backtest against. *Partial caveat:* per-strike history is
  the **pre-expiry window** (weekly-expiry / intraday strategies), not years-per-strike, and the
  API currently serves **one strike per request** (a batch/range endpoint is the Phase-2 add).

- **Existing auth to reuse: YES — but it's Google OAuth, not a password.** Supabase Google login
  on the frontend + a backend JWT middleware gating `/api/*`. Reusable, but for a **shared
  password gate** the cleaner tool is **Caddy `basicauth`** in front of Stratos (no Stratos code
  changes), or a single shared-password screen.

- **Deployment method: Docker Compose on Vultr — FastAPI serves the static SPA + API, with Caddy
  as reverse proxy (HTTP :80 now, HTTPS :443 ready).** Updates via `git pull && docker compose up
  -d --build` (`deploy.sh`). VPS: Ubuntu 24.04, 2 vCPU / 3.8 GB RAM / 120 GB disk.

### Recommended integration pattern + realistic Jun 30 scope

**Pattern — two apps, one Caddy, password-gated.** Don't try to fold Stratos into this codebase
(incompatible stacks). Instead host Stratos as a **second service** on the same box and let the
existing **Caddy** route to it, with a **password gate** at the proxy:

1. **Run Stratos on the VPS.** Because it targets Cloudflare Workers (edge SSR), self-hosting needs
   either (a) a **Node-server build** of TanStack Start (Nitro `node-server` preset) run as a
   third Compose service, or (b) a **static/SPA build** if it has no hard server-function deps.
   *Verify which is feasible* — that's the single biggest unknown and the gating task for Jun 30.
   (Fallback if time is short: keep Stratos on **Cloudflare** and only do the password gate there.)
2. **Caddy routing + gate.** Add a block — subdomain (`stratos.<domain>`) or path (`/stratos/*`) —
   `reverse_proxy` to the Stratos service, wrapped in Caddy **`basicauth`** (bcrypt hash in the
   Caddyfile) = the password gate, zero app changes. (Needs the domain/HTTPS for a clean subdomain;
   path-based works on the bare IP today.)
3. **Options-data wiring (the real "add options to Stratos") = Phase 2, not Jun 30.** Point
   Stratos's backtester at this app's historical API. Add a **batch/date-range options endpoint**
   to `server.py` (e.g. fetch a whole expiry's strike ladder over a window in one call) so Stratos
   can pull per-strike series efficiently. The data is ready; only an access pattern is missing.

**Realistic Jun 30 target:** Stratos **hosted on the Vultr box (or Cloudflare) behind a working
password gate**, reachable alongside the option-chain app. Treat **"options into Stratos's
backtests"** as the follow-on phase — it's straightforward *because the historical per-strike data
already exists*, but it needs a new batch API + Stratos-side data adapter, which is more than a
10-day side-task on top of the hosting work.

> Open verification items before committing the plan: (1) can Stratos build to a **Node server or
> static SPA** (vs. Cloudflare-only)? (2) is a **domain** coming (needed for clean HTTPS +
> subdomain), or do we stay path-based on the IP? (3) does Stratos's backtest engine expect a
> specific data shape we'd map our DuckDB to?
