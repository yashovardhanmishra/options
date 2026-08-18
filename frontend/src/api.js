import axios from 'axios'
import { authEnabled, getAccessToken } from './supabase'

// Backend base URL.
//  - dev (`npm run dev`)        -> http://localhost:8000 (separate Vite + uvicorn)
//  - production build           -> "" (same-origin: FastAPI serves these files + the API)
//  - split deploy               -> set VITE_API_BASE to the backend's URL to override
const baseURL =
  import.meta.env.VITE_API_BASE !== undefined
    ? import.meta.env.VITE_API_BASE
    : import.meta.env.PROD
      ? ''
      : 'http://localhost:8000'

const api = axios.create({ baseURL, timeout: 60000 })

// Attach the Supabase access token so the backend can verify each request.
if (authEnabled) {
  api.interceptors.request.use(async (config) => {
    const token = await getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })
}

export const getExpiries = () =>
  api.get('/api/expiries').then((r) => r.data)

export const getDates = (expiry) =>
  api.get('/api/dates', { params: { expiry } }).then((r) => r.data)

export const getTimes = (expiry, date) =>
  api.get('/api/times', { params: { expiry, date } }).then((r) => r.data)

export const getChain = (expiry, date, time, oiBase) =>
  api
    .get('/api/chain', { params: { expiry, date, time: time || undefined, oi_base: oiBase || undefined } })
    .then((r) => r.data)

// Per-instrument chart history is STATIC (historical bars never change), yet it was re-fetched +
// re-parsed on every open. Cache the parsed result in-memory (capped) so re-opening the same strike
// is instant. Concurrent opens of the same key share one in-flight request.
const _chartCache = new Map()
const _chartInflight = new Map()
export const getChart = (expiry, strike, type) => {
  const key = `${expiry}|${strike}|${type}`
  if (_chartCache.has(key)) return Promise.resolve(_chartCache.get(key))
  if (_chartInflight.has(key)) return _chartInflight.get(key)
  const p = api
    .get('/api/chart', { params: { expiry, strike, type } })
    .then((r) => {
      _chartCache.set(key, r.data)
      if (_chartCache.size > 24) _chartCache.delete(_chartCache.keys().next().value) // cap memory
      _chartInflight.delete(key)
      return r.data
    })
    .catch((e) => {
      _chartInflight.delete(key)
      throw e
    })
  _chartInflight.set(key, p)
  return p
}

// Underlying index spot at (date[,time]) + that day's open — for the chain header.
export const getUnderlying = (date, time) =>
  api.get('/api/underlying', { params: { date, time: time || undefined } }).then((r) => r.data)

// Underlying instrument bars (Nifty index spot, MCX natural gas, …): columnar
// {t,o,h,l,c,v} -> candle rows (oi unused for these). Nifty is ~370k static bars (~21 MB)
// and was re-downloaded AND re-parsed on every spot-chart open; each instrument is now
// fetched + built ONCE per session and reused (re-opens are instant). Concurrent callers
// of the SAME instrument share one in-flight request.
const _barsCache = new Map()
const _barsInflight = new Map()
export const getBars = (instrument = 'nifty') => {
  const hit = _barsCache.get(instrument)
  if (hit) return Promise.resolve(hit)
  const pending = _barsInflight.get(instrument)
  if (pending) return pending
  const p = api
    .get('/api/bars', { params: { instrument } })
    .then((r) => {
      const d = r.data
      const out = new Array(d.t.length)
      for (let i = 0; i < d.t.length; i++) {
        out[i] = { time: d.t[i], open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i], oi: 0 }
      }
      _barsCache.set(instrument, out)
      _barsInflight.delete(instrument)
      return out
    })
    .catch((e) => {
      _barsInflight.delete(instrument)
      throw e
    })
  _barsInflight.set(instrument, p)
  return p
}

/** Nifty spot — the historical alias, unchanged for existing callers. */
export const getSpot = () => getBars('nifty')

/** Instruments the market dropdown can offer ({id,label,route,available}). */
export const getInstruments = () =>
  api.get('/api/instruments').then((r) => r.data)

export const search = (q) =>
  api.get('/api/search', { params: { q } }).then((r) => r.data)
