"""
One-time ingest: parse every option CSV under DATA_DIR into a single DuckDB file
(`nifty.duckdb`) so the API serves millisecond queries instead of parsing ~150
CSVs per request. Re-run it whenever the data changes.

    DATA_DIR=/path/to/data python ingest.py        # builds ./nifty.duckdb
    DB_PATH=/path/to/nifty.duckdb DATA_DIR=... python ingest.py

The resulting .duckdb file is what you deploy — far smaller than the raw CSVs and
instant to query. The server auto-uses it when present (falls back to CSVs if not).
"""

import os
import time
from pathlib import Path

import duckdb

DATA_DIR = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent).resolve()
DB_PATH = os.environ.get("DB_PATH") or str(Path(__file__).resolve().parent / "nifty.duckdb")

# year/expiry/<expiry>_<strike><CE|PE>.csv  (top-level year folders only)
GLOB = str(DATA_DIR / "20[0-9][0-9]" / "*" / "*.csv")

# `ts` is the naive IST wall clock; epoch(ts) encodes it as UTC seconds — the same
# convention the frontend uses (lightweight-charts renders the real market clock,
# and 1D bucketing floors on the IST day). date=YYYY-MM-DD, hm=HH:MM for selectors.
BUILD_SQL = """
CREATE OR REPLACE TABLE bars AS
SELECT * FROM (
  SELECT
    regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})_[0-9]+(?:CE|PE)\\.csv$', 1) AS expiry,
    TRY_CAST(regexp_extract(filename, '_([0-9]+)(?:CE|PE)\\.csv$', 1) AS INTEGER)        AS strike,
    upper(regexp_extract(filename, '_[0-9]+(CE|PE)\\.csv$', 1))                          AS type,
    CAST(epoch(ts) AS BIGINT)  AS unix,
    strftime(ts, '%Y-%m-%d')   AS date,
    strftime(ts, '%H:%M')      AS hm,
    open, high, low, close, volume, oi,
    filename
  FROM (
    SELECT
      filename,
      -- try_strptime: a malformed Date/Time yields a NULL ts (dropped below), never an abort
      try_strptime("Date" || ' ' || "Time", '%d/%m/%Y %H:%M:%S') AS ts,
      TRY_CAST("Open" AS DOUBLE)  AS open,  TRY_CAST("High" AS DOUBLE) AS high,
      TRY_CAST("Low" AS DOUBLE)   AS low,   TRY_CAST("Close" AS DOUBLE) AS close,
      -- volume/OI: NULL means "not reported" for index-style data — store 0, the same
      -- convention as the server's CSV fallback (fillna(0)); the API float()s these.
      COALESCE(TRY_CAST("Volume" AS DOUBLE), 0)        AS volume,
      COALESCE(TRY_CAST("Open Interest" AS DOUBLE), 0) AS oi
    -- union_by_name binds columns by their HEADER NAMES, not position — the old
    -- `columns = {...}` override made DuckDB skip the header and bind positionally,
    -- silently swapping fields (volume<->OI etc.) for any file with a different
    -- column order. all_varchar + explicit TRY_CASTs keep the typing deterministic.
    FROM read_csv('__GLOB__', filename = true, header = true, ignore_errors = true,
         store_rejects = true, union_by_name = true, all_varchar = true)
  )
  -- OHLC must be complete (the API float()s them — a NULL crashed /api/chart in DB mode);
  -- rows the CSV fallback would dropna are dropped here too, so both modes agree.
  WHERE ts IS NOT NULL AND open IS NOT NULL AND high IS NOT NULL
    AND low IS NOT NULL AND close IS NOT NULL
)
-- drop any file whose name isn't <expiry>_<strike><CE|PE>.csv
WHERE strike IS NOT NULL AND type IN ('CE', 'PE') AND expiry <> ''
-- keep exactly ONE row per instrument-minute (lightweight-charts needs strictly-ascending
-- unique times; the CSV fallback drop_duplicates(keep="last") for the same reason)
QUALIFY row_number() OVER (PARTITION BY expiry, strike, type, unix ORDER BY filename DESC) = 1
ORDER BY expiry
"""


def main():
    print(f"DATA_DIR = {DATA_DIR}")
    print(f"DB_PATH  = {DB_PATH}")
    print(f"glob     = {GLOB}\nReading CSVs (this is the slow, one-time step)…")
    t0 = time.time()

    con = duckdb.connect(DB_PATH)
    # Memory-safe build on small boxes: let big operations spill to disk, and cap
    # the working set (tunable via DUCKDB_MEMORY_LIMIT, e.g. "6GB").
    tmp = Path(DB_PATH).resolve().parent / ".duckdb_tmp"
    tmp.mkdir(exist_ok=True)
    con.execute(f"SET temp_directory = '{tmp}'")
    con.execute(f"SET memory_limit = '{os.environ.get('DUCKDB_MEMORY_LIMIT', '6GB')}'")

    # bars is written clustered by expiry (see ORDER BY in BUILD_SQL), so queries
    # that filter by expiry prune via DuckDB's min/max zonemaps — fast, and with no
    # heavy in-memory ART indexes to build (those blow up RAM on ~175M rows).
    con.execute(BUILD_SQL.replace("__GLOB__", GLOB.replace("'", "''")))

    # Tiny dimension tables make expiries/dates/times/search instant (no bars scan).
    con.execute("CREATE OR REPLACE TABLE dim_instruments AS SELECT DISTINCT expiry, strike, type FROM bars")
    con.execute("CREATE OR REPLACE TABLE dim_dates AS SELECT DISTINCT expiry, date FROM bars")
    con.execute("CREATE OR REPLACE TABLE dim_times AS SELECT DISTINCT expiry, date, hm FROM bars")

    rows = con.execute("SELECT count(*) FROM bars").fetchone()[0]
    exps = con.execute("SELECT count(*) FROM (SELECT DISTINCT expiry FROM dim_instruments)").fetchone()[0]
    insts = con.execute("SELECT count(*) FROM dim_instruments").fetchone()[0]
    # store_rejects=true collects rows read_csv could not parse — surface the count so a bad
    # vendor batch is visible in the ingest log instead of silently shrinking `bars rows`.
    try:
        rejects = con.execute("SELECT count(*) FROM reject_errors").fetchone()[0]
    except Exception:
        rejects = None
    if rejects:
        top = con.execute(
            "SELECT error_message, count(*) AS n FROM reject_errors GROUP BY 1 ORDER BY n DESC LIMIT 3"
        ).fetchall()
        print(f"  REJECTED rows: {rejects:,} (malformed — not ingested); top causes: {top}")
    con.execute("CHECKPOINT")
    con.close()

    size_mb = os.path.getsize(DB_PATH) / 1e6
    print(
        f"\nDone in {time.time() - t0:.1f}s\n"
        f"  bars rows   : {rows:,}\n"
        f"  expiries    : {exps}\n"
        f"  instruments : {insts:,}\n"
        f"  db size     : {size_mb:.0f} MB  ->  {DB_PATH}"
    )


if __name__ == "__main__":
    main()
