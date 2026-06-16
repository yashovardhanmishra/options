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
    open, high, low, close, volume, oi
  FROM (
    SELECT
      filename,
      strptime("Date" || ' ' || "Time", '%d/%m/%Y %H:%M:%S') AS ts,
      "Open" AS open, "High" AS high, "Low" AS low, "Close" AS close,
      "Volume" AS volume, "Open Interest" AS oi
    FROM read_csv('__GLOB__', filename = true, header = true, ignore_errors = true,
         columns = {
           'Date': 'VARCHAR', 'Time': 'VARCHAR', 'Open': 'DOUBLE', 'High': 'DOUBLE',
           'Low': 'DOUBLE', 'Close': 'DOUBLE', 'Volume': 'DOUBLE', 'Open Interest': 'DOUBLE'
         })
    WHERE ts IS NOT NULL AND "Close" IS NOT NULL
  )
)
-- drop any file whose name isn't <expiry>_<strike><CE|PE>.csv
WHERE strike IS NOT NULL AND type IN ('CE', 'PE') AND expiry <> ''
"""


def main():
    print(f"DATA_DIR = {DATA_DIR}")
    print(f"DB_PATH  = {DB_PATH}")
    print(f"glob     = {GLOB}\nReading CSVs (this is the slow, one-time step)…")
    t0 = time.time()

    con = duckdb.connect(DB_PATH)
    con.execute(BUILD_SQL.replace("__GLOB__", GLOB.replace("'", "''")))

    # Tiny dimension tables make expiries/dates/times/search instant (no bars scan).
    con.execute("CREATE OR REPLACE TABLE dim_instruments AS SELECT DISTINCT expiry, strike, type FROM bars")
    con.execute("CREATE OR REPLACE TABLE dim_dates AS SELECT DISTINCT expiry, date FROM bars")
    con.execute("CREATE OR REPLACE TABLE dim_times AS SELECT DISTINCT expiry, date, hm FROM bars")

    con.execute("CREATE INDEX IF NOT EXISTS idx_main  ON bars(expiry, strike, type, unix)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_chain ON bars(expiry, date)")

    rows = con.execute("SELECT count(*) FROM bars").fetchone()[0]
    exps = con.execute("SELECT count(*) FROM (SELECT DISTINCT expiry FROM dim_instruments)").fetchone()[0]
    insts = con.execute("SELECT count(*) FROM dim_instruments").fetchone()[0]
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
