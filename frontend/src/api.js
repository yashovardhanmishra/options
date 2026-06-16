import axios from 'axios'

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

export const getExpiries = () =>
  api.get('/api/expiries').then((r) => r.data)

export const getDates = (expiry) =>
  api.get('/api/dates', { params: { expiry } }).then((r) => r.data)

export const getTimes = (expiry, date) =>
  api.get('/api/times', { params: { expiry, date } }).then((r) => r.data)

export const getChain = (expiry, date, time) =>
  api.get('/api/chain', { params: { expiry, date, time: time || undefined } }).then((r) => r.data)

export const getChart = (expiry, strike, type) =>
  api.get('/api/chart', { params: { expiry, strike, type } }).then((r) => r.data)

export const search = (q) =>
  api.get('/api/search', { params: { q } }).then((r) => r.data)
