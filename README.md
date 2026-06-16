# Nifty Options Chain + Chart Viewer

A two-panel viewer over historical Nifty options data: an NSE-style **option chain**
(top) and a TradingView-style **candlestick + open-interest chart** (bottom), backed by a
FastAPI server that reads the per-strike CSV files directly.

```
data root/
  2023/ 2024/ 2025/ 2026/          ← year folders
    2023-01-05/                    ← expiry folders
      2023-01-05_15050PE.csv       ← <expiry>_<strike><CE|PE>.csv
      2023-01-05_15100CE.csv
      ...
```

CSV columns: `Date, Time, Open, High, Low, Close, Volume, Open Interest`
(`Date` is `DD/MM/YYYY`, `Time` is `HH:MM:SS`; each file holds many days of history).

> ### ⚠️ Bring your own data
> **The options data is NOT included in this repo** (it's ~8 GB / ~31k CSVs and is
> `.gitignore`d). After cloning, drop your own year folders (`2023/`, `2024/`, …) next
> to `server.py` in the layout shown above, or point `DATA_DIR` at wherever they live:
> `DATA_DIR=/path/to/data uvicorn server:app --port 8000`.
> Until data is present, the chain shows no strikes — that's expected.

---

## 1. Backend (FastAPI)

```bash
pip install -r requirements.txt        # fastapi, uvicorn, pandas, python-dotenv

# DATA_DIR defaults to the folder server.py lives in (which already holds the
# year folders), so from this project directory you can just run:
uvicorn server:app --port 8000

# …or point it anywhere explicitly:
DATA_DIR=/path/to/data uvicorn server:app --port 8000
```

> **Do NOT add `--reload`.** The data dir holds ~31,000 CSV files; uvicorn's reloader
> tries to watch them all and chokes (periodic reloads drop the cache → the chain
> shows "0 strikes"). Plain `uvicorn server:app --port 8000` is correct.

### Endpoints

| Method & path | Purpose |
| --- | --- |
| `GET /api/expiries` | All expiry folders across every year dir, sorted **descending**. |
| `GET /api/dates?expiry=2023-01-05` | Unique trading dates (ISO `YYYY-MM-DD`) in that expiry, ascending. |
| `GET /api/times?expiry=2023-01-05&date=2023-01-05` | Unique intraday times (`HH:MM`) traded that day across all strikes, ascending — powers the time selector. |
| `GET /api/chain?expiry=2023-01-05&date=2023-01-05&time=11:15` | Per-strike snapshot as of `time` (last row **at or before** that minute per side): `[{ strike, ce:{ltp,oi,volume}, pe:{ltp,oi,volume} }]`, strikes ascending. Missing side ⇒ `null`. Omit `time` for end-of-day (last row). |
| `GET /api/chart?expiry=2023-01-05&strike=15050&type=CE` | **Full** history for one option: `[{ time(unix sec), open, high, low, close, volume, oi }]`. No date filtering — everything is sent; the frontend slices and resamples. |
| `GET /api/search?q=22500CE` | Find an instrument across all expiries → `[{ strike, type, expiry }]`. Accepts `22500CE`, `22500 PE`, or bare `22500`. |

Timestamps are emitted as unix **seconds** with the IST wall-clock encoded as UTC, so
lightweight-charts renders the real market clock and 1D bucketing lands on the IST day.

---

## 2. Frontend (Vite + React)

```bash
cd frontend
npm install            # installs react, lightweight-charts@4, axios, date-fns, tailwind
npm run dev            # http://localhost:5173
```

If the backend runs somewhere other than `http://localhost:8000`, set `VITE_API_BASE`:

```bash
VITE_API_BASE=http://localhost:9000 npm run dev
```

### What you get

**Top — Option Chain**
- Expiry + date + **time** dropdowns (time defaults to end-of-day; scrub it to see the chain as it stood at any minute that day).
- `[OI bar | OI | Vol | LTP]  Strike  [LTP | Vol | OI | OI bar]` — CALLS tinted blue, PUTS orange.
- Mirrored OI bars proportional to the chain's max OI.
- ATM row (strike nearest the mid of all strikes) highlighted amber.
- Click any CALL or PUT cell to load that strike+type below.

**Bottom — Chart**
- Loads the option's full history once, then does everything client-side.
- Timeframes `1m / 3m / 5m / 10m / 15m / 30m / 1h / 1D` resample the raw 1-minute candles
  (open=first, high=max, low=min, close=last, volume=sum, oi=last) — see
  [`src/utils/resample.js`](frontend/src/utils/resample.js).
- From/To date pickers filter the visible window (no reload); **Reset** restores full history.
- Candlestick pane (top ~75%) + OI line pane (bottom ~25%) share one synced time axis.
- Crosshair tooltip: Date, Time, O/H/L/C, Volume, OI.

**Search** (top bar, always visible) — type `22500CE` / `22500 PE`; selecting a result
auto-switches the chain to the matching expiry and opens its chart.

---

## File map

```
server.py                    FastAPI backend (all endpoints + CSV parsing/caching)
frontend/
  src/App.jsx                layout, data loading, panel wiring
  src/api.js                 axios client
  src/components/OptionChain.jsx   the chain table + OI bars
  src/components/ChartPanel.jsx    lightweight-charts candles + OI pane + tooltip
  src/components/SearchBar.jsx     global instrument search
  src/utils/resample.js      timeframe resampling + date-range filtering
```

## Notes
- `chain` volume is the **last row's** volume for that day (per spec — the snapshot is the
  last row). LTP = last Close, OI = last Open Interest. Switch the `volume` line in
  `server.py`'s `chain()` to a day-sum if you'd rather see cumulative traded volume.
- First chain load for an expiry parses ~150–170 CSVs; results are cached by file mtime, so
  changing the date afterwards is fast.
