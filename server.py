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
from fastapi.responses import JSONResponse
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


@app.middleware("http")
async def _require_auth(request: Request, call_next):
    """Require a valid Supabase (Google) token on data endpoints when AUTH_ENABLED."""
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


def _db_chain(expiry, date, hm):
    rows = _q(
        """
        SELECT strike, type, close, oi, volume FROM (
          SELECT strike, type, close, oi, volume,
                 row_number() OVER (PARTITION BY strike, type ORDER BY unix DESC) AS rn
          FROM bars
          WHERE expiry = ? AND date = ? AND (? IS NULL OR hm <= ?)
        ) WHERE rn = 1
        """,
        [expiry, date, hm, hm],
    )
    strikes: dict[int, dict] = {}
    for strike, typ, close, oi, vol in rows:
        entry = strikes.setdefault(int(strike), {"strike": int(strike), "ce": None, "pe": None})
        entry["ce" if typ == "CE" else "pe"] = {"ltp": float(close), "oi": float(oi), "volume": float(vol)}
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
@lru_cache(maxsize=2048)
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
@app.get("/api/expiries")
def expiries():
    """All expiry folders across every year dir, sorted descending."""
    if USING_DB:
        return _db_expiries()
    found = set()
    for year_dir in _year_dirs():
        for d in year_dir.iterdir():
            if d.is_dir() and EXPIRY_RE.match(d.name):
                found.add(d.name)
    return sorted(found, reverse=True)


@app.get("/api/dates")
def dates(expiry: str = Query(...)):
    """Unique trading dates (ISO YYYY-MM-DD) available in an expiry folder, ascending."""
    if USING_DB:
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
    if USING_DB:
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
):
    """
    Option chain snapshot for `date`. For every strike take the LAST row at or
    before `time` (HH:MM) that day per side — i.e. the chain as it stood at that
    moment. Omit `time` to use the last row of the whole day (end-of-day).
    LTP=Close, OI=Open Interest, Volume=that row's volume. Strikes present on
    only one side get a null on the missing side.
    """
    hm = _norm_hm(time) if time else None
    if USING_DB:
        return _db_chain(expiry, date, hm)
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
            snap = {
                "ltp": float(row["Close"]),
                "oi": float(row["Open Interest"]),
                "volume": float(row["Volume"]),
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

    if USING_DB:
        return _db_chart(expiry, strike, side)

    folder = find_expiry_dir(expiry)
    matches = list(folder.glob(f"*_{strike}{side}.csv"))
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

    if USING_DB:
        return _db_search(needle, want_type, limit)

    out = []
    for strike, typ, exp in _instrument_index():
        if want_type and typ != want_type:
            continue
        s = str(strike)
        if s == needle or s.startswith(needle):
            out.append({"strike": strike, "type": typ, "expiry": exp})

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
        "endpoints": ["/api/expiries", "/api/dates", "/api/times", "/api/chain", "/api/chart", "/api/search"],
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
