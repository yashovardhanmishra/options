"""
Nifty Options Chain + Chart viewer — FastAPI backend.

Data layout (root = DATA_DIR):
    <year>/<expiry>/<expiry>_<strike><CE|PE>.csv     e.g. 2023/2023-01-05/2023-01-05_15050PE.csv

CSV columns: Date, Time, Open, High, Low, Close, Volume, Open Interest
  - Date  : DD/MM/YYYY
  - Time  : HH:MM:SS
  - Each file holds many historical days leading up to the expiry.

Run:
    DATA_DIR=. uvicorn server:app --reload --port 8000
(DATA_DIR defaults to the directory this file lives in, which already holds the year folders.)
"""

import os
import re
import threading
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles

try:
    import jwt  # PyJWT, for verifying Supabase access tokens
except Exception:
    jwt = None

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
# The year folders (2023, 2024, ...) live directly inside this project dir, so
# default DATA_DIR to this file's directory. Override with the DATA_DIR env var.
DATA_DIR = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent).resolve()

# Static frontend build (served by this same process in production). Override
# with FRONTEND_DIR; defaults to ./frontend/dist next to this file.
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR") or Path(__file__).resolve().parent / "frontend" / "dist")

# Nifty index (spot) 1-min OHLCV CSV for the standalone spot chart. Defaults to
# nifty.csv next to the data; override with SPOT_CSV.
SPOT_CSV = Path(os.environ.get("SPOT_CSV") or (DATA_DIR / "nifty.csv"))

# MCX natural gas 5-min OHLCV CSV. Same shape as the spot file (Datetime,Open,High,Low,
# Close,Volume[,OI]) so it goes through the identical parser/endpoints; override with
# NATGAS_CSV. Session is 09:00-23:30/23:55 IST, NOT the 09:15-15:30 equity window.
NATGAS_CSV = Path(os.environ.get("NATGAS_CSV") or (DATA_DIR / "naturalgas_5min.csv"))

# Every instrument the chart tools can load, keyed by the id the frontends use.
# `csv` is the file; `route` is the public raw-CSV path StratosAI fetches.
INSTRUMENTS = {
    "nifty": {"csv": SPOT_CSV, "label": "NIFTY 50", "route": "/nifty-spot.csv"},
    "naturalgas": {"csv": NATGAS_CSV, "label": "Natural Gas", "route": "/naturalgas-5min.csv"},
}

# How many of the newest expiries to pre-parse on startup (warms the cache so the
# first page load is fast). Set WARM_EXPIRIES=0 to disable.
WARM_EXPIRIES = int(os.environ.get("WARM_EXPIRIES", "2"))

# --- Auth (Supabase) ---
# Require a valid Google sign-in on every /api request when configured. Unset = open.
#   SUPABASE_URL         -> verify asymmetric (ES256/RS256) tokens via the project's JWKS
#   SUPABASE_JWT_SECRET  -> verify legacy HS256 tokens with the shared secret
# Supabase projects may issue either; we pick the method from each token's `alg`.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "").strip()
AUTH_ENABLED = bool((SUPABASE_URL or SUPABASE_JWT_SECRET) and jwt is not None)
# Optional allow-list, e.g. ALLOWED_EMAIL_DOMAINS="gmail.com" (comma-separated).
ALLOWED_EMAIL_DOMAINS = [
    d.strip().lower() for d in os.environ.get("ALLOWED_EMAIL_DOMAINS", "").split(",") if d.strip()
]

_jwks_client = None


def _verify_token(token: str) -> dict:
    """Verify a Supabase access token, picking HS256 vs JWKS by the token's alg."""
    alg = jwt.get_unverified_header(token).get("alg", "")
    if alg == "HS256":
        return jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
    # asymmetric: verify against the project's public JWKS
    global _jwks_client
    if _jwks_client is None:
        from jwt import PyJWKClient

        _jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    key = _jwks_client.get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")

YEAR_RE = re.compile(r"^\d{4}$")
EXPIRY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"_(\d+)(CE|PE)\.csv$", re.IGNORECASE)

EPOCH = pd.Timestamp("1970-01-01")
ONE_SEC = pd.Timedelta(seconds=1)

app = FastAPI(title="Nifty Options Chain API")

# CORS: same-origin (frontend served by this process) needs none. For a split
# deploy, set CORS_ORIGINS to a comma-separated list, or "*" to allow all.
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_env == "*":
    _cors_origins = ["*"]
elif _cors_env:
    _cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    _cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress large JSON (the spot history is a few MB) when the client accepts it.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def _require_auth(request: Request, call_next):
    """Require a valid Supabase (Google) token on data endpoints when AUTH_ENABLED."""
    path = request.url.path
    if AUTH_ENABLED and request.method != "OPTIONS" and (path == "/api" or path.startswith("/api/")):
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


# --------------------------------------------------------------------------- #
# Fast path: a prebuilt DuckDB (see ingest.py) answers every query in ~ms. If the
# file isn't present we fall back to parsing CSVs on demand (slower, zero setup).
# --------------------------------------------------------------------------- #
DB_PATH = os.environ.get("DB_PATH") or str(Path(__file__).resolve().parent / "nifty.duckdb")
try:
    import duckdb

    _DB = duckdb.connect(DB_PATH, read_only=True) if Path(DB_PATH).exists() else None
except Exception:
    _DB = None

USING_DB = _DB is not None


# ── DB freshness gate ──────────────────────────────────────────────────────────────────
# The DuckDB is a BUILT ARTIFACT: it only knows the expiries present when it was ingested.
# When fresh CSVs land (a new expiry folder), the DB is silently stale and every DB-backed
# endpoint hides that data — the expiry doesn't even appear in the dropdown. So each request
# asks whether the DB actually covers THAT expiry and falls back to the CSV reader when it
# doesn't. New data is live the moment the files land; re-ingesting only makes it faster.
_DB_EXPIRIES = None


def _db_expiry_set():
    """Expiries present in the DB (cached once per process)."""
    global _DB_EXPIRIES
    if _DB_EXPIRIES is None:
        try:
            rows = _DB.execute("SELECT DISTINCT expiry FROM dim_instruments").fetchall()
            _DB_EXPIRIES = {str(r[0]) for r in rows}
        except Exception:
            _DB_EXPIRIES = set()
    return _DB_EXPIRIES


def _use_db(expiry=None):
    """True when the DB can serve this request (it exists AND covers this expiry)."""
    if not USING_DB:
        return False
    if expiry is None:
        return True
    return str(expiry) in _db_expiry_set()


def _q(sql, params=()):
    # .cursor() = a thread-safe sibling connection (FastAPI runs sync routes in a
    # threadpool, so each request gets its own).
    cur = _DB.cursor()
    try:
        return cur.execute(sql, list(params)).fetchall()
    finally:
        cur.close()


def _db_expiries():
    return [r[0] for r in _q("SELECT DISTINCT expiry FROM dim_instruments ORDER BY expiry DESC")]


def _db_dates(expiry):
    return [r[0] for r in _q("SELECT date FROM dim_dates WHERE expiry = ? ORDER BY date", [expiry])]


def _db_times(expiry, date):
    return [r[0] for r in _q("SELECT hm FROM dim_times WHERE expiry = ? AND date = ? ORDER BY hm", [expiry, date])]


def _db_chain(expiry, date, hm, oi_base="prev_close"):
    # snapshot at/before the time, plus each strike's BASELINE OI for the change-in-OI
    # column (chgOi = oi - base_oi). The baseline is user-selectable:
    #   prev_close (default) — the strike's last OI on any EARLIER day (previous close)
    #   day_open             — the strike's FIRST OI on `date` (today's 09:15 open)
    if oi_base == "day_open":
        base_where, base_order = "expiry = ? AND date = ?", "ASC"
    else:
        base_where, base_order = "expiry = ? AND date < ?", "DESC"
    rows = _q(
        f"""
        SELECT s.strike, s.type, s.close, s.oi, s.volume, p.prev_oi FROM (
          SELECT strike, type, close, oi, volume FROM (
            SELECT strike, type, close, oi, volume,
                   row_number() OVER (PARTITION BY strike, type ORDER BY unix DESC) AS rn
            FROM bars
            WHERE expiry = ? AND date = ? AND (? IS NULL OR hm <= ?)
          ) WHERE rn = 1
        ) s
        LEFT JOIN (
          SELECT strike, type, oi AS prev_oi FROM (
            SELECT strike, type, oi,
                   row_number() OVER (PARTITION BY strike, type ORDER BY unix {base_order}) AS rn
            FROM bars WHERE {base_where}
          ) WHERE rn = 1
        ) p ON s.strike = p.strike AND s.type = p.type
        """,
        [expiry, date, hm, hm, expiry, date],
    )
    strikes: dict[int, dict] = {}
    for strike, typ, close, oi, vol, prev_oi in rows:
        chg = float(oi) - float(prev_oi) if prev_oi is not None else None
        entry = strikes.setdefault(int(strike), {"strike": int(strike), "ce": None, "pe": None})
        entry["ce" if typ == "CE" else "pe"] = {
            "ltp": float(close), "oi": float(oi), "volume": float(vol), "chgOi": chg,
        }
    return [strikes[s] for s in sorted(strikes)]


def _db_chart(expiry, strike, side):
    rows = _q(
        "SELECT unix, open, high, low, close, volume, oi FROM bars "
        "WHERE expiry = ? AND strike = ? AND type = ? ORDER BY unix",
        [expiry, strike, side],
    )
    return [
        {"time": int(r[0]), "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
         "close": float(r[4]), "volume": float(r[5]), "oi": float(r[6])}
        for r in rows
    ]


def _db_chain_day(expiry, date):
    rows = _q(
        "SELECT strike, type, unix, open, high, low, close, volume, oi FROM bars "
        "WHERE expiry = ? AND date = ? ORDER BY strike, type, unix",
        [expiry, date],
    )
    insts: dict[tuple, list] = {}
    order = []
    for strike, typ, u, o, h, lo, c, v, oi in rows:
        key = (int(strike), typ)
        bucket = insts.get(key)
        if bucket is None:
            bucket = []
            insts[key] = bucket
            order.append(key)
        bucket.append([int(u), float(o), float(h), float(lo), float(c), float(v), float(oi)])
    return {
        "expiry": expiry, "date": date,
        "instruments": [{"strike": k[0], "type": k[1], "bars": insts[k]} for k in order],
    }


def _csv_chain_day(expiry, date):
    folder = find_expiry_dir(expiry)
    insts = []
    for f in sorted(folder.glob("*.csv")):
        m = FILE_RE.search(f.name)
        if not m:
            continue
        df = read_csv(f)
        d = df[df["__date"] == date]
        if d.empty:
            continue
        bars = [
            [int(u), float(o), float(h), float(lo), float(c), float(v), float(oi)]
            for u, o, h, lo, c, v, oi in zip(
                d["__unix"], d["Open"], d["High"], d["Low"], d["Close"], d["Volume"], d["Open Interest"]
            )
        ]
        insts.append({"strike": int(m.group(1)), "type": m.group(2).upper(), "bars": bars})
    return {"expiry": expiry, "date": date, "instruments": insts}


def _db_search(needle, want_type, limit):
    if want_type:
        rows = _q(
            "SELECT strike, type, expiry FROM dim_instruments WHERE type = ? AND CAST(strike AS VARCHAR) LIKE ?",
            [want_type, needle + "%"],
        )
    else:
        rows = _q(
            "SELECT strike, type, expiry FROM dim_instruments WHERE CAST(strike AS VARCHAR) LIKE ?",
            [needle + "%"],
        )
    out = [{"strike": int(s), "type": t, "expiry": e} for s, t, e in rows]
    out.sort(key=lambda r: r["expiry"], reverse=True)
    out.sort(key=lambda r: (str(r["strike"]) != needle, abs(r["strike"] - int(needle))))
    return out[:limit]


# --------------------------------------------------------------------------- #
# Filesystem helpers
# --------------------------------------------------------------------------- #
def _year_dirs():
    if not DATA_DIR.is_dir():
        return []
    return [d for d in DATA_DIR.iterdir() if d.is_dir() and YEAR_RE.match(d.name)]


def find_expiry_dir(expiry: str) -> Path:
    """Locate the folder for an expiry like '2023-01-05'."""
    if not EXPIRY_RE.match(expiry):
        raise HTTPException(400, f"Bad expiry format: {expiry!r}")
    # Fast path: <DATA_DIR>/<year>/<expiry>
    candidate = DATA_DIR / expiry[:4] / expiry
    if candidate.is_dir():
        return candidate
    # Fallback: scan every year dir (handles odd placements).
    for year_dir in _year_dirs():
        c = year_dir / expiry
        if c.is_dir():
            return c
    raise HTTPException(404, f"Expiry {expiry!r} not found")


# --------------------------------------------------------------------------- #
# CSV parsing (cached by path + mtime so re-reads are cheap)
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=64)
def _parse_csv(path_str: str, _mtime: float) -> pd.DataFrame:
    df = pd.read_csv(path_str)
    df.columns = [c.strip() for c in df.columns]

    required = {"Date", "Time", "Open", "High", "Low", "Close", "Volume", "Open Interest"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(500, f"{Path(path_str).name} missing columns: {sorted(missing)}")

    dt = pd.to_datetime(
        df["Date"].astype(str).str.strip() + " " + df["Time"].astype(str).str.strip(),
        format="%d/%m/%Y %H:%M:%S",
        errors="coerce",
    )
    df = df.assign(__dt=dt)

    # Drop unparseable rows and rows without a usable price.
    df = df.dropna(subset=["__dt", "Open", "High", "Low", "Close"])
    df["Volume"] = df["Volume"].fillna(0)
    df["Open Interest"] = df["Open Interest"].fillna(0)

    # Order ascending and drop duplicate minutes (keep last) — lightweight-charts
    # needs a strictly-ascending, unique time series.
    df = df.sort_values("__dt").drop_duplicates(subset="__dt", keep="last")

    # Wall-clock-as-UTC unix seconds. The data is IST market time; encoding the
    # naive wall clock as UTC makes lightweight-charts display the IST clock
    # directly (it renders timestamps in UTC) and makes 1D midnight-flooring
    # group by the IST trading day.
    df["__unix"] = ((df["__dt"] - EPOCH) // ONE_SEC).astype("int64")
    df["__date"] = df["__dt"].dt.strftime("%Y-%m-%d")
    df["__hm"] = df["__dt"].dt.strftime("%H:%M")  # intraday time-of-day, for the time selector
    return df


def _norm_hm(t: str):
    """Normalize 'H:MM' / 'HH:MM' / 'HH:MM:SS' -> 'HH:MM', else None."""
    m = re.match(r"\s*(\d{1,2}):(\d{2})", t or "")
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def read_csv(path: Path) -> pd.DataFrame:
    return _parse_csv(str(path), path.stat().st_mtime)


# One cache slot per instrument (nifty spot + natural gas); keyed by path+mtime, so a
# rebuilt file re-parses on its own.
@lru_cache(maxsize=4)
def _read_spot(path_str: str, _mtime: float):
    """Parse an OHLCV bar CSV into columnar arrays (cached per file).
    Accepts `datetime,open,high,low,close[,volume]` (ISO) or
    `Date,Time,Open,High,Low,Close[,Volume]` (DD/MM/YYYY). Used for the Nifty index
    1-min spot file AND the MCX natural-gas 5-min file — identical layout."""
    df = pd.read_csv(path_str)
    df.columns = [c.strip().lower() for c in df.columns]
    if "datetime" in df.columns:
        dt = pd.to_datetime(df["datetime"].astype(str).str.strip(), errors="coerce")
    else:
        # Date+Time come in BOTH conventions across our sources: DD/MM/YYYY (the per-strike
        # option CSVs) and YYYY-MM-DD (the 2021-2026 spot export). Try the explicit
        # day-first format, then fall back to ISO for whatever it couldn't parse, so a
        # single pinned format can never silently drop the entire file to NaT.
        stamp = df["date"].astype(str).str.strip() + " " + df["time"].astype(str).str.strip()
        dt = pd.to_datetime(stamp, format="%d/%m/%Y %H:%M:%S", errors="coerce")
        if dt.isna().any():
            iso = pd.to_datetime(stamp[dt.isna()], format="%Y-%m-%d %H:%M:%S", errors="coerce")
            dt = dt.fillna(iso)
        if dt.isna().any():  # last resort: let pandas infer the stragglers
            dt = dt.fillna(pd.to_datetime(stamp[dt.isna()], errors="coerce"))
    df = df.assign(__dt=dt).dropna(subset=["__dt", "open", "high", "low", "close"])
    df = df.sort_values("__dt").drop_duplicates(subset="__dt", keep="last")
    unix = ((df["__dt"] - EPOCH) // ONE_SEC).astype("int64")
    vol = (df["volume"] if "volume" in df.columns else pd.Series(0, index=df.index)).fillna(0)
    return {
        "t": unix.tolist(),
        "o": df["open"].astype(float).tolist(),
        "h": df["high"].astype(float).tolist(),
        "l": df["low"].astype(float).tolist(),
        "c": df["close"].astype(float).tolist(),
        "v": vol.astype(float).tolist(),
    }


def read_bars(csv_path: Path, label: str):
    """Columnar {t,o,h,l,c,v} for any instrument CSV, cached by path+mtime."""
    if not csv_path.is_file():
        raise HTTPException(404, f"{label} data file not found at {csv_path}")
    return _read_spot(str(csv_path), csv_path.stat().st_mtime)


def read_spot():
    return read_bars(SPOT_CSV, "Spot")


@lru_cache(maxsize=1)
def _instrument_index():
    """(strike, type, expiry) for every option file — built from filenames only."""
    idx = []
    for year_dir in _year_dirs():
        for exp_dir in year_dir.iterdir():
            if not (exp_dir.is_dir() and EXPIRY_RE.match(exp_dir.name)):
                continue
            for f in exp_dir.iterdir():
                m = FILE_RE.search(f.name)
                if m:
                    idx.append((int(m.group(1)), m.group(2).upper(), exp_dir.name))
    return idx


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
def _raw_csv_response(request: Request, csv_path: Path, label: str):
    """Serve a raw instrument CSV to the StratosAI chart/backtester, same-origin from our own
    data (replaces the retired Supabase storage URL). ETag-revalidated so an unchanged file
    returns 304 (no ~21 MB re-download per load)."""
    if not csv_path.is_file():
        raise HTTPException(404, f"{label} data file not found at {csv_path}")
    st = csv_path.stat()
    etag = f'"{int(st.st_mtime)}-{int(st.st_size)}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"}
    # If-None-Match may be a comma-separated list and each entry may carry a W/ weak prefix
    # (proxies weaken ETags when they re-encode) — an exact-string compare never 304s there,
    # silently re-sending ~21 MB per load.
    inm = request.headers.get("if-none-match") or ""
    client_tags = {v.strip().removeprefix("W/") for v in inm.split(",") if v.strip()}
    if etag in client_tags or "*" in client_tags:
        return Response(status_code=304, headers=headers)
    # PRE-COMPRESSED FAST PATH. Caddy's `encode gzip` was re-compressing this ~28 MB file on
    # EVERY request: measured 0.09s uncompressed vs 7.33s gzipped through the proxy on this
    # 2-core box, and browsers always send Accept-Encoding: gzip — so every chart load paid
    # ~7s of server CPU. Serving a .gz built once by the daily updater turns that into a
    # plain file send. Caddy leaves responses that already carry Content-Encoding alone.
    # Guard: only use the .gz when it is NEWER than the CSV, so a stale sidecar (e.g. the
    # updater died midway) can never serve yesterday's data — it just falls back.
    gz = csv_path.with_suffix(csv_path.suffix + ".gz")
    accepts_gzip = "gzip" in (request.headers.get("accept-encoding") or "").lower()
    if accepts_gzip and gz.is_file() and gz.stat().st_mtime >= st.st_mtime:
        return FileResponse(
            str(gz),
            media_type="text/csv",
            headers={**headers, "Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return FileResponse(str(csv_path), media_type="text/csv", headers=headers)


@app.get("/nifty-spot.csv")
def nifty_spot_csv(request: Request):
    """Public 1-min NIFTY spot CSV (datetime,open,high,low,close,volume)."""
    return _raw_csv_response(request, SPOT_CSV, "Spot")


@app.get("/naturalgas-5min.csv")
def naturalgas_csv(request: Request):
    """Public 5-min MCX natural-gas CSV (datetime,open,high,low,close,volume,oi)."""
    return _raw_csv_response(request, NATGAS_CSV, "Natural gas")


@app.get("/api/expiries")
def expiries():
    """All expiry folders across every year dir, sorted descending."""
    found = set(_db_expiries()) if USING_DB else set()
    for year_dir in _year_dirs():
        for d in year_dir.iterdir():
            if d.is_dir() and EXPIRY_RE.match(d.name):
                found.add(d.name)
    return sorted(found, reverse=True)


@app.get("/api/dates")
def dates(expiry: str = Query(...)):
    """Unique trading dates (ISO YYYY-MM-DD) available in an expiry folder, ascending."""
    if _use_db(expiry):
        return _db_dates(expiry)
    folder = find_expiry_dir(expiry)
    found = set()
    for f in folder.glob("*.csv"):
        if FILE_RE.search(f.name):
            found.update(read_csv(f)["__date"].unique().tolist())
    return sorted(found)


@app.get("/api/times")
def times(expiry: str = Query(...), date: str = Query(...)):
    """Unique intraday times (HH:MM) traded on `date`, across all strikes, ascending."""
    if _use_db(expiry):
        return _db_times(expiry, date)
    folder = find_expiry_dir(expiry)
    found = set()
    for f in folder.glob("*.csv"):
        if FILE_RE.search(f.name):
            df = read_csv(f)
            found.update(df.loc[df["__date"] == date, "__hm"].unique().tolist())
    return sorted(found)


@app.get("/api/chain")
def chain(
    expiry: str = Query(...),
    date: str = Query(...),
    time: str | None = Query(None),
    oi_base: str = Query("prev_close"),
):
    """
    Option chain snapshot for `date`. For every strike take the LAST row at or
    before `time` (HH:MM) that day per side — i.e. the chain as it stood at that
    moment. Omit `time` to use the last row of the whole day (end-of-day).
    LTP=Close, OI=Open Interest, Volume=that row's volume. Strikes present on
    only one side get a null on the missing side.

    `oi_base` selects the baseline for the change-in-OI column:
      prev_close (default) — vs the strike's previous market close (last earlier day)
      day_open             — vs the strike's current-day open (first bar of `date`)
    """
    hm = _norm_hm(time) if time else None
    if time and hm is None:
        raise HTTPException(400, f"Invalid time {time!r}; expected HH:MM")
    if oi_base not in ("prev_close", "day_open"):
        oi_base = "prev_close"
    if _use_db(expiry):
        return _db_chain(expiry, date, hm, oi_base)
    folder = find_expiry_dir(expiry)
    strikes: dict[int, dict] = {}

    for f in folder.glob("*.csv"):
        m = FILE_RE.search(f.name)
        if not m:
            continue
        strike = int(m.group(1))
        side = "ce" if m.group(2).upper() == "CE" else "pe"

        df = read_csv(f)
        day = df[df["__date"] == date]
        if hm is not None:
            day = day[day["__hm"] <= hm]  # state as of the chosen minute
        snap = None
        if not day.empty:
            row = day.iloc[-1]
            oi = float(row["Open Interest"])
            # baseline OI for chgOi: previous market close (this strike's last OI on an
            # earlier day) or today's open (its first OI on `date`), per oi_base.
            if oi_base == "day_open":
                today = df[df["__date"] == date]
                base_oi = float(today.iloc[0]["Open Interest"]) if not today.empty else None
            else:
                prev = df[df["__date"] < date]
                base_oi = float(prev.iloc[-1]["Open Interest"]) if not prev.empty else None
            snap = {
                "ltp": float(row["Close"]),
                "oi": oi,
                "volume": float(row["Volume"]),
                "chgOi": (oi - base_oi) if base_oi is not None else None,
            }

        entry = strikes.setdefault(strike, {"strike": strike, "ce": None, "pe": None})
        entry[side] = snap

    return [strikes[s] for s in sorted(strikes)]


@app.get("/api/chart")
def chart(expiry: str = Query(...), strike: int = Query(...), type: str = Query(...)):
    """Full history for one option: every row as {time(unix sec), o,h,l,c, volume, oi}."""
    side = type.strip().upper()
    if side not in ("CE", "PE"):
        raise HTTPException(400, "type must be CE or PE")

    if _use_db(expiry):
        return _db_chart(expiry, strike, side)

    folder = find_expiry_dir(expiry)
    # Filenames may use lowercase ce/pe (FILE_RE is IGNORECASE), so match both cases.
    matches = [
        f for f in folder.glob("*.csv")
        if (m := FILE_RE.search(f.name)) and int(m.group(1)) == strike and m.group(2).upper() == side
    ]
    if not matches:
        raise HTTPException(404, f"No data for {strike}{side} in {expiry}")

    df = read_csv(matches[0])
    return [
        {
            "time": int(t),
            "open": float(o),
            "high": float(h),
            "low": float(low),
            "close": float(c),
            "volume": float(v),
            "oi": float(oi),
        }
        for t, o, h, low, c, v, oi in zip(
            df["__unix"], df["Open"], df["High"], df["Low"],
            df["Close"], df["Volume"], df["Open Interest"],
        )
    ]


@app.get("/api/chain_day")
def chain_day(expiry: str = Query(...), date: str = Query(...)):
    """Bulk replay feed: every strike's 1-min bars for one (expiry, date).
    {expiry, date, instruments:[{strike, type, bars:[[unix,o,h,l,c,v,oi], ...]}]}."""
    if _use_db(expiry):
        return _db_chain_day(expiry, date)
    return _csv_chain_day(expiry, date)


@app.get("/api/spot")
def spot():
    """Full 1-min Nifty index (spot) history as columnar arrays {t,o,h,l,c,v}.
    Columnar keeps the payload small; the frontend zips it into candles."""
    return read_spot()


@app.get("/api/instruments")
def instruments():
    """Instruments the chart's market dropdown can offer. `available` is false when the
    CSV isn't on this box, so the frontend can grey the entry out instead of erroring."""
    return [
        {
            "id": key,
            "label": inst["label"],
            "route": inst["route"],
            "available": inst["csv"].is_file(),
        }
        for key, inst in INSTRUMENTS.items()
    ]


@app.get("/api/bars")
def bars(instrument: str = Query("nifty")):
    """Full history for any registered instrument as columnar arrays {t,o,h,l,c,v} —
    the market-agnostic sibling of /api/spot (which stays for existing callers)."""
    inst = INSTRUMENTS.get(instrument)
    if not inst:
        raise HTTPException(404, f"Unknown instrument '{instrument}'")
    return read_bars(inst["csv"], inst["label"])


@app.get("/api/underlying")
def underlying(date: str = Query(...), time: str | None = None):
    """Nifty index spot at (date[,time]) + that day's OPEN — feeds the chain header.
    `date`=YYYY-MM-DD, `time`=HH:MM (omit = end-of-day). Unix ts are IST-as-UTC, so a
    plain wall-clock -> unix and a same-day window need no timezone math."""
    import bisect
    try:
        s = read_spot()
    except HTTPException:
        return {"spot": None, "dayOpen": None}
    t = s["t"]
    day_start = int((pd.Timestamp(date) - EPOCH) / ONE_SEC)
    lo = bisect.bisect_left(t, day_start)
    hi = bisect.bisect_left(t, day_start + 86400)
    if lo >= hi:
        return {"spot": None, "dayOpen": None, "prevClose": None}
    # "Day Open" = the 09:15 session open, not the day's first CSV row — the file carries
    # pre-market rows on some days (07:06/09:00/09:11 flat prints at ~prev close), which made
    # dayOpen ≈ prevClose and the day's change read ~0. Fall back to the first row only when
    # no bar exists at/after 09:15 that day.
    session_open = bisect.bisect_left(t, day_start + 9 * 3600 + 15 * 60)
    open_idx = session_open if session_open < hi else lo
    day_open = s["o"][open_idx]
    prev_close = s["c"][lo - 1] if lo > 0 else None    # last print of the prior day
    if time:
        target = int((pd.Timestamp(f"{date} {time}") - EPOCH) / ONE_SEC)
        j = min(max(bisect.bisect_right(t, target) - 1, lo), hi - 1)
    else:
        j = hi - 1
    return {"spot": s["c"][j], "dayOpen": day_open, "prevClose": prev_close}


@app.get("/api/search")
def search(q: str = Query(...), limit: int = 40):
    """
    Find an instrument across all expiries. Query like '22500CE', '22500 PE', '22500'.
    Returns [{strike, type, expiry}] — exact-strike first, then newest expiry first.
    """
    m = re.match(r"\s*(\d+)\s*(CE|PE)?\s*$", q, re.IGNORECASE)
    if not m:
        return []
    needle = m.group(1)
    want_type = m.group(2).upper() if m.group(2) else None

    # The DB only indexes the expiries it was ingested with, so a DB-only search silently
    # hides instruments from any newer expiry folder. Ask the DB for what it knows, then scan
    # the filesystem for JUST the expiries it doesn't (cheap — filenames only), and merge.
    known = _db_expiry_set() if USING_DB else set()
    # over-fetch from the DB so the merged re-sort below isn't biased by its own truncation
    out = list(_db_search(needle, want_type, max(limit * 3, limit))) if USING_DB else []
    for strike, typ, exp in _instrument_index():
        if exp in known:
            continue
        if want_type and typ != want_type:
            continue
        sk = str(strike)
        if sk == needle or sk.startswith(needle):
            out.append({"strike": strike, "type": typ, "expiry": exp})

    # de-dupe defensively (a rebuilt DB could overlap the filesystem scan)
    seen = set()
    deduped = []
    for r in out:
        key = (r.get("strike"), r.get("type"), r.get("expiry"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    out = deduped

    out.sort(key=lambda r: (r["strike"] != int(needle), r["strike"], r["expiry"]), reverse=False)
    # Stable-sort expiry newest-first within the same strike while keeping exact-first.
    out.sort(key=lambda r: r["expiry"], reverse=True)
    out.sort(key=lambda r: (str(r["strike"]) != needle, abs(r["strike"] - int(needle))))
    return out[:limit]


@app.get("/api")
def api_info():
    return {
        "service": "Nifty Options Chain API",
        "data_dir": str(DATA_DIR),
        "endpoints": ["/api/expiries", "/api/dates", "/api/times", "/api/chain", "/api/chain_day", "/api/chart", "/api/spot", "/api/search"],
    }


# --------------------------------------------------------------------------- #
# Warm the cache for the newest expiries in the background (non-blocking), so the
# first page load doesn't pay the cold ~150-CSV parse. Tune with WARM_EXPIRIES.
# --------------------------------------------------------------------------- #
def _warm_cache():
    if USING_DB or WARM_EXPIRIES <= 0:
        return  # DuckDB mode is already instant; nothing to warm
    try:
        for exp in expiries()[:WARM_EXPIRIES]:
            try:
                folder = find_expiry_dir(exp)
            except Exception:
                continue
            for f in folder.glob("*.csv"):
                if FILE_RE.search(f.name):
                    try:
                        read_csv(f)
                    except Exception:
                        pass
    except Exception:
        pass


threading.Thread(target=_warm_cache, daemon=True).start()


# --------------------------------------------------------------------------- #
# Serve the built frontend from this same process (single-URL deploy). Mounted
# LAST so the /api/* routes above take precedence. Skipped in dev (no dist yet).
# --------------------------------------------------------------------------- #
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
