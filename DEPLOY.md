# Deploying to a VPS (one server, one URL)

This runs **everything on a single small VPS**: FastAPI serves the API *and* the built
frontend, the option data sits on the server's disk, and Caddy gives you automatic HTTPS.
Visitors just open your URL — no Python/Node/data on their machines.

> **Sizing.** The data is ~8 GB and the backend parses CSVs on demand (cached after the
> first hit). For public traffic use a box with **~4 GB RAM and 40 GB+ disk** (e.g. Hetzner
> CX22 ≈ €4.5/mo, or a DigitalOcean 4 GB droplet). 1 GB RAM will be tight.
> Heavy public load would eventually want the data pre-aggregated (SQLite/DuckDB) — see the
> note at the bottom — but this setup is fine to launch.

---

## 1. Create the VPS
- Spin up an **Ubuntu 24.04** server (Hetzner / DigitalOcean / Vultr…).
- (For HTTPS) point a domain's **DNS A record** at the server's IP. No domain yet? You can
  start HTTP-only on the IP and add the domain later.

## 2. SSH in and install Docker
```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 3. Upload your data (~8 GB) to the server
Put the year folders under `/opt/nifty-data/` so it looks like
`/opt/nifty-data/2023/…`, `/opt/nifty-data/2024/…`, etc.

**From your Mac** (resumable — re-run if the connection drops):
```bash
ssh root@YOUR_SERVER_IP "mkdir -p /opt/nifty-data"
rsync -avP ~/Desktop/data/2023 ~/Desktop/data/2024 ~/Desktop/data/2025 ~/Desktop/data/2026 \
  root@YOUR_SERVER_IP:/opt/nifty-data/
```
**From Windows:** use **WinSCP** (free, drag-and-drop) — drag the `2023`–`2026` folders into
`/opt/nifty-data/`. (`nifty.csv` is not needed — the viewer never reads it.)

## 4. Get the code and configure
```bash
cd /opt
git clone https://github.com/yashovardhanmishra/options.git
cd options
```
- Edit **`Caddyfile`** → replace `example.com` with your domain (or uncomment the `:80`
  block for HTTP-only on the IP).
- If you uploaded data somewhere other than `/opt/nifty-data`, edit the `volumes:` line in
  **`docker-compose.yml`**.

## 5. Build the fast database (one-time), then launch
The app is **much** faster when it serves from a prebuilt **DuckDB** instead of parsing
CSVs per request (every query becomes ~milliseconds — no first-load wait for visitors).
Build it once from your CSVs (writes `/opt/nifty-db/nifty.duckdb`):
```bash
mkdir -p /opt/nifty-db
docker compose run --rm app python ingest.py     # a few minutes, one time
```
Then start everything:
```bash
docker compose up -d --build
```
First build compiles the frontend (a few minutes). Open **https://your-domain**
(or `http://YOUR_SERVER_IP` if you used the HTTP-only block). The app auto-detects the
DuckDB file and uses it — no per-request CSV parsing, so **no waiting for users**.

> The CSVs are only needed to *build* the DB. Once `nifty.duckdb` exists the app reads it
> exclusively; if it's missing, the app falls back to parsing CSVs (slower). **Rebuild the
> DB** whenever you add/change data: re-run the `ingest.py` line, then `docker compose restart app`.

That's it — the app is live for everyone.

---

## Day-to-day

```bash
docker compose logs -f app        # watch backend logs
docker compose ps                 # status
docker compose restart app        # restart just the app
docker compose down               # stop everything
```

**Update to the latest code** (after you push changes to GitHub):
```bash
cd /opt/options && git pull && docker compose up -d --build
```
Your data and HTTPS certs are untouched — only the app rebuilds.

**Add/refresh data:** drop more folders into `/opt/nifty-data/`, **rebuild the DB**
(`docker compose run --rm app python ingest.py`), then `docker compose restart app`.

---

## Notes / tuning
- **Speed:** with the DuckDB file built, every endpoint is an indexed query (~ms) — chain
  ≈ 25 ms, full chart history ≈ 10 ms, expiries/dates/times ≈ 1 ms. No cold-parse, no
  per-user wait. (Without the DB it falls back to CSV parsing, which is the slow path.)
- **CORS** isn't needed here (same origin). Hosting the frontend separately? Set
  `CORS_ORIGINS` on the app to the frontend's URL (or `*`).
- **More concurrency:** on a bigger box run multiple workers — change the app command to
  `uvicorn server:app --host 0.0.0.0 --port 8000 --workers 3`. DuckDB is opened read-only
  and is happy with concurrent readers.
- **Disk:** the `.duckdb` is roughly the same size as the CSVs. You can delete the CSVs
  after building the DB if you're tight on space (keep a copy elsewhere to rebuild later).
