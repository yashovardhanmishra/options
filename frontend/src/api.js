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

export const getChart = (expiry, strike, type) =>
  api.get('/api/chart', { params: { expiry, strike, type } }).then((r) => r.data)

// Nifty index (spot): columnar {t,o,h,l,c,v} -> candle rows (oi unused for spot).
export const getSpot = () =>
  api.get('/api/spot').then((r) => {
    const d = r.data
    const out = new Array(d.t.length)
    for (let i = 0; i < d.t.length; i++) {
      out[i] = { time: d.t[i], open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i], oi: 0 }
    }
    return out
  })

export const search = (q) =>
  api.get('/api/search', { params: { q } }).then((r) => r.data)
