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
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
# The year folders (2023, 2024, ...) live directly inside this project dir, so
# default DATA_DIR to this file's directory. Override with the DATA_DIR env var.
DATA_DIR = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent).resolve()

YEAR_RE = re.compile(r"^\d{4}$")
EXPIRY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILE_RE = re.compile(r"_(\d+)(CE|PE)\.csv$", re.IGNORECASE)

EPOCH = pd.Timestamp("1970-01-01")
ONE_SEC = pd.Timedelta(seconds=1)

app = FastAPI(title="Nifty Options Chain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    found = set()
    for year_dir in _year_dirs():
        for d in year_dir.iterdir():
            if d.is_dir() and EXPIRY_RE.match(d.name):
                found.add(d.name)
    return sorted(found, reverse=True)


@app.get("/api/dates")
def dates(expiry: str = Query(...)):
    """Unique trading dates (ISO YYYY-MM-DD) available in an expiry folder, ascending."""
    folder = find_expiry_dir(expiry)
    found = set()
    for f in folder.glob("*.csv"):
        if FILE_RE.search(f.name):
            found.update(read_csv(f)["__date"].unique().tolist())
    return sorted(found)


@app.get("/api/times")
def times(expiry: str = Query(...), date: str = Query(...)):
    """Unique intraday times (HH:MM) traded on `date`, across all strikes, ascending."""
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
    folder = find_expiry_dir(expiry)
    hm = _norm_hm(time) if time else None
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


@app.get("/")
def root():
    return {
        "service": "Nifty Options Chain API",
        "data_dir": str(DATA_DIR),
        "endpoints": ["/api/expiries", "/api/dates", "/api/chain", "/api/chart", "/api/search"],
    }
