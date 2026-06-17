// Tiny vectorized evaluator for the Pine-Script subset our pattern snippets use.
// It runs an (editable) Pine indicator over the candle array and returns the
// markers produced by its plotshape() calls, so a user can tweak the code and
// see the chart update. It is NOT a full Pine runtime — it supports OHLCV series,
// `[n]` history, math.*/ta.* helpers, user `f(x)=>...` functions, the boolean/
// arithmetic operators, ternaries, and plotshape(). Anything else throws, and the
// caller shows the error without touching the existing markers.
//
//   evalPine(source, candles) -> { markers, error }

// --------------------------------------------------------------- tokenizer
function tokenize(src) {
  const toks = []
  let i = 0
  const n = src.length
  const idStart = (c) => /[A-Za-z_]/.test(c)
  const idChar = (c) => /[A-Za-z0-9_.]/.test(c)
  while (i < n) {
    const c = src[i]
    if (c === '\n') { toks.push({ t: 'nl' }); i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '"' || c === "'") {
      const q = c; let s = ''; i++
      while (i < n && src[i] !== q) { s += src[i]; i++ }
      i++; toks.push({ t: 'str', v: s }); continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = ''
      while (i < n && /[0-9.eE]/.test(src[i])) { s += src[i]; i++ }
      toks.push({ t: 'num', v: parseFloat(s) }); continue
    }
    if (idStart(c)) {
      let s = ''
      while (i < n && idChar(src[i])) { s += src[i]; i++ }
      if (s === 'and' || s === 'or' || s === 'not') toks.push({ t: 'op', v: s })
      else if (s === 'true') toks.push({ t: 'bool', v: true })
      else if (s === 'false') toks.push({ t: 'bool', v: false })
      else toks.push({ t: 'id', v: s })
      continue
    }
    const two = src.substr(i, 2)
    if (two === '=>') { toks.push({ t: 'arrow' }); i += 2; continue }
    if (['>=', '<=', '==', '!=', ':='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/()[],?:<>='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue }
    throw new Error('Unexpected character "' + c + '"')
  }
  toks.push({ t: 'eof' })
  return toks
}

// --------------------------------------------------------------- parser
function parse(toks) {
  let pos = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const eat = (t, v) => {
    const tk = toks[pos]
    if (tk.t !== t || (v !== undefined && tk.v !== v)) throw new Error('Expected ' + (v || t))
    pos++
    return tk
  }
  const skipNl = () => { while (peek().t === 'nl') pos++ }
  const BIN = { or: 1, and: 2, '==': 3, '!=': 3, '>': 3, '>=': 3, '<': 3, '<=': 3, '+': 4, '-': 4, '*': 5, '/': 5 }

  function ternary() {
    const cond = binary(1)
    if (peek().t === 'op' && peek().v === '?') {
      next()
      const a = ternary()
      eat('op', ':')
      const b = ternary()
      return { k: 'tern', cond, a, b }
    }
    return cond
  }
  function binary(minp) {
    let left = unary()
    for (;;) {
      const tk = peek()
      const p = tk.t === 'op' ? BIN[tk.v] : undefined
      if (!p || p < minp) break
      next()
      left = { k: 'bin', op: tk.v, left, right: binary(p + 1) }
    }
    return left
  }
  function unary() {
    const tk = peek()
    if (tk.t === 'op' && (tk.v === 'not' || tk.v === '-')) { next(); return { k: 'un', op: tk.v, e: unary() } }
    return postfix()
  }
  function postfix() {
    let e = primary()
    for (;;) {
      const tk = peek()
      if (tk.t === 'op' && tk.v === '[') { next(); const idx = ternary(); eat('op', ']'); e = { k: 'index', e, idx } }
      else if (tk.t === 'op' && tk.v === '(') {
        if (e.k !== 'id') throw new Error('Call on non-function')
        next()
        const args = []
        const named = {}
        if (!(peek().t === 'op' && peek().v === ')')) {
          do {
            if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].t === 'op' && toks[pos + 1].v === '=') {
              const nm = next().v; next(); named[nm] = ternary()
            } else args.push(ternary())
          } while (peek().t === 'op' && peek().v === ',' && next())
        }
        eat('op', ')')
        e = { k: 'call', name: e.name, args, named }
      } else break
    }
    return e
  }
  function primary() {
    const tk = next()
    if (tk.t === 'num') return { k: 'num', v: tk.v }
    if (tk.t === 'str') return { k: 'str', v: tk.v }
    if (tk.t === 'bool') return { k: 'bool', v: tk.v }
    if (tk.t === 'id') return { k: 'id', name: tk.v }
    if (tk.t === 'op' && tk.v === '(') { const e = ternary(); eat('op', ')'); return e }
    if (tk.t === 'op' && tk.v === '-') return { k: 'un', op: '-', e: primary() }
    throw new Error('Unexpected token "' + (tk.v ?? tk.t) + '"')
  }

  const stmts = []
  skipNl()
  while (peek().t !== 'eof') {
    if (peek().t === 'id') {
      const id = peek().v
      const nxt = toks[pos + 1]
      if (nxt && nxt.t === 'op' && (nxt.v === '=' || nxt.v === ':=')) {
        next(); next()
        stmts.push({ k: 'assign', name: id, e: ternary() })
        skipNl(); continue
      }
      if (nxt && nxt.t === 'op' && nxt.v === '(') {
        // function definition?  id ( params ) => body
        let depth = 0, j = pos + 1
        while (j < toks.length) {
          const t = toks[j]
          if (t.t === 'op' && t.v === '(') depth++
          else if (t.t === 'op' && t.v === ')') { depth--; if (depth === 0) { j++; break } }
          j++
        }
        if (toks[j] && toks[j].t === 'arrow') {
          next(); eat('op', '(')
          const params = []
          if (!(peek().t === 'op' && peek().v === ')')) {
            do { params.push(eat('id').v) } while (peek().t === 'op' && peek().v === ',' && next())
          }
          eat('op', ')'); eat('arrow')
          stmts.push({ k: 'func', name: id, params, body: ternary() })
          skipNl(); continue
        }
      }
    }
    stmts.push({ k: 'expr', e: ternary() })
    skipNl()
  }
  return stmts
}

// --------------------------------------------------------------- evaluator
const SHAPE = {
  'shape.triangleup': 'arrowUp', 'shape.arrowup': 'arrowUp', 'shape.labelup': 'arrowUp',
  'shape.triangledown': 'arrowDown', 'shape.arrowdown': 'arrowDown', 'shape.labeldown': 'arrowDown',
  'shape.circle': 'circle', 'shape.square': 'square', 'shape.diamond': 'circle',
  'shape.cross': 'circle', 'shape.xcross': 'circle', 'shape.flag': 'circle',
}
const LOC = {
  'location.belowbar': 'belowBar', 'location.bottom': 'belowBar',
  'location.abovebar': 'aboveBar', 'location.top': 'aboveBar', 'location.absolute': 'aboveBar',
}
const COLOR = {
  'color.green': '#22c55e', 'color.lime': '#22c55e', 'color.teal': '#2dd4bf',
  'color.red': '#ef4444', 'color.maroon': '#ef4444', 'color.fuchsia': '#ec4899',
  'color.gray': '#9ca3af', 'color.grey': '#9ca3af', 'color.silver': '#cbd5e1',
  'color.blue': '#3b82f6', 'color.navy': '#1e3a8a', 'color.aqua': '#38bdf8',
  'color.orange': '#fb923c', 'color.yellow': '#eab308', 'color.purple': '#a78bfa',
  'color.white': '#e5e7eb', 'color.black': '#111827',
}

function evaluate(stmts, candles) {
  const N = candles.length
  const col = (f) => candles.map((c) => c[f])
  const env = Object.create(null)
  env.open = col('open'); env.high = col('high'); env.low = col('low'); env.close = col('close')
  env.volume = col('volume')
  env.hl2 = candles.map((c) => (c.high + c.low) / 2)
  env.hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3)
  env.ohlc4 = candles.map((c) => (c.open + c.high + c.low + c.close) / 4)
  env.na = NaN
  const funcs = Object.create(null)
  const markers = []

  const isArr = Array.isArray
  const toArr = (x) => (isArr(x) ? x : new Array(N).fill(x))
  const scalar = (x) => (isArr(x) ? x.find((v) => v != null && !Number.isNaN(v)) ?? x[0] : x)
  const truthy = (x) => x === true || (typeof x === 'number' && !Number.isNaN(x) && x !== 0)

  const map1 = (a, f) => (isArr(a) ? a.map(f) : f(a))
  const mapN = (args, f) => {
    if (!args.some(isArr)) return f(...args)
    const out = new Array(N)
    for (let i = 0; i < N; i++) out[i] = f(...args.map((a) => (isArr(a) ? a[i] : a)))
    return out
  }
  const arith = (x, y, f) => (Number.isNaN(x) || Number.isNaN(y) || x == null || y == null ? NaN : f(x, y))
  const cmp = (x, y, f) => (Number.isNaN(x) || Number.isNaN(y) || x == null || y == null ? false : f(x, y))

  function rolling(srcRaw, lenRaw, kind) {
    const a = toArr(srcRaw)
    const len = Math.max(1, Math.round(scalar(lenRaw)))
    const out = new Array(N).fill(NaN)
    if (kind === 'ema' || kind === 'rma') {
      const k = kind === 'ema' ? 2 / (len + 1) : 1 / len
      let prev = null
      for (let i = 0; i < N; i++) {
        const v = a[i]
        if (v == null || Number.isNaN(v)) { out[i] = prev ?? NaN; continue }
        prev = prev == null ? v : v * k + prev * (1 - k)
        out[i] = prev
      }
      return out
    }
    for (let i = 0; i < N; i++) {
      if (i - len + 1 < 0) continue
      let sum = 0, hi = -Infinity, lo = Infinity, wsum = 0, wtot = 0, ok = true
      for (let j = 0; j < len; j++) {
        const v = a[i - j]
        if (v == null || Number.isNaN(v)) { ok = false; break }
        sum += v; hi = Math.max(hi, v); lo = Math.min(lo, v)
        const w = len - j; wsum += v * w; wtot += w
      }
      if (!ok) continue
      out[i] = kind === 'highest' ? hi : kind === 'lowest' ? lo : kind === 'wma' ? wsum / wtot : sum / len
    }
    return out
  }

  function callFn(node, scope) {
    const name = node.name
    const a = node.args.map((x) => ev(x, scope))
    switch (name) {
      case 'math.abs': return map1(a[0], (x) => Math.abs(x))
      case 'math.sign': return map1(a[0], (x) => Math.sign(x))
      case 'math.round': return map1(a[0], (x) => Math.round(x))
      case 'math.floor': return map1(a[0], (x) => Math.floor(x))
      case 'math.ceil': return map1(a[0], (x) => Math.ceil(x))
      case 'math.sqrt': return map1(a[0], (x) => Math.sqrt(x))
      case 'math.max': return mapN(a, (...xs) => Math.max(...xs))
      case 'math.min': return mapN(a, (...xs) => Math.min(...xs))
      case 'math.pow': return mapN(a, (x, y) => Math.pow(x, y))
      case 'math.avg': return mapN(a, (...xs) => xs.reduce((s, v) => s + v, 0) / xs.length)
      case 'na': return map1(a[0], (x) => x == null || Number.isNaN(x))
      case 'nz': return mapN([a[0], a[1] ?? 0], (x, y) => (x == null || Number.isNaN(x) ? y : x))
      case 'ta.sma': return rolling(a[0], a[1], 'sma')
      case 'ta.ema': return rolling(a[0], a[1], 'ema')
      case 'ta.rma':
      case 'ta.wma': return rolling(a[0], a[1], name === 'ta.wma' ? 'wma' : 'rma')
      case 'ta.highest': return rolling(a[0], a[1], 'highest')
      case 'ta.lowest': return rolling(a[0], a[1], 'lowest')
      case 'ta.change': {
        const arr = toArr(a[0]); const k = a[1] ? Math.round(scalar(a[1])) : 1
        return arr.map((_, i) => (i - k >= 0 ? arr[i] - arr[i - k] : NaN))
      }
      case 'ta.cum': { const arr = toArr(a[0]); let s = 0; return arr.map((v) => { if (!Number.isNaN(v)) s += v; return s }) }
      case 'plotshape': plotshape(node, a, scope); return NaN
      case 'plot': case 'hline': case 'bgcolor': case 'plotchar': case 'fill': case 'indicator': case 'alertcondition': return NaN
      case 'input': case 'input.int': case 'input.float': case 'input.bool': case 'input.source': return a[0]
      default:
        if (funcs[name]) {
          const f = funcs[name]
          const child = Object.create(env)
          f.params.forEach((p, i) => { child[p] = a[i] })
          return ev(f.body, child)
        }
        throw new Error('Unsupported function "' + name + '"')
    }
  }

  function plotshape(node, a, scope) {
    const named = {}
    for (const k in node.named) named[k] = ev(node.named[k], scope)
    const style = named.style ?? a[2]
    const loc = named.location ?? a[3]
    const c = named.color ?? a[4]
    const txt = named.text ?? a[6] ?? ''
    const shape = SHAPE[String(style).toLowerCase()] || 'circle'
    const position = LOC[String(loc).toLowerCase()] || 'aboveBar'
    const color = typeof c === 'string' && c.startsWith('#') ? c : COLOR[String(c).toLowerCase()] || '#9ca3af'
    const text = txt == null ? '' : String(txt)
    const series = toArr(a[0])
    for (let i = 0; i < N; i++) if (truthy(series[i])) markers.push({ time: candles[i].time, position, color, shape, text })
  }

  function ev(node, scope) {
    switch (node.k) {
      case 'num': case 'str': case 'bool': return node.v
      case 'id': {
        const nm = node.name
        if (nm in scope) return scope[nm]
        if (nm in env) return env[nm]
        if (nm.includes('.')) return nm // location.* / color.* / shape.* constants
        if (nm === 'na') return NaN
        throw new Error('Unknown name "' + nm + '"')
      }
      case 'un': {
        const v = ev(node.e, scope)
        if (node.op === '-') return map1(v, (x) => (Number.isNaN(x) ? NaN : -x))
        return map1(v, (x) => (Number.isNaN(x) ? NaN : !truthy(x)))
      }
      case 'bin': {
        const x = ev(node.left, scope), y = ev(node.right, scope)
        switch (node.op) {
          case '+': return mapN([x, y], (p, q) => arith(p, q, (m, n) => m + n))
          case '-': return mapN([x, y], (p, q) => arith(p, q, (m, n) => m - n))
          case '*': return mapN([x, y], (p, q) => arith(p, q, (m, n) => m * n))
          case '/': return mapN([x, y], (p, q) => arith(p, q, (m, n) => m / n))
          case '>': return mapN([x, y], (p, q) => cmp(p, q, (m, n) => m > n))
          case '>=': return mapN([x, y], (p, q) => cmp(p, q, (m, n) => m >= n))
          case '<': return mapN([x, y], (p, q) => cmp(p, q, (m, n) => m < n))
          case '<=': return mapN([x, y], (p, q) => cmp(p, q, (m, n) => m <= n))
          case '==': return mapN([x, y], (p, q) => truthy(p) === truthy(q) && p === q)
          case '!=': return mapN([x, y], (p, q) => (typeof p === 'boolean' || typeof q === 'boolean' ? truthy(p) !== truthy(q) : p !== q))
          case 'and': return mapN([x, y], (p, q) => truthy(p) && truthy(q))
          case 'or': return mapN([x, y], (p, q) => truthy(p) || truthy(q))
        }
        throw new Error('Bad operator ' + node.op)
      }
      case 'tern': {
        const c = ev(node.cond, scope), a1 = ev(node.a, scope), b1 = ev(node.b, scope)
        return mapN([c, a1, b1], (cc, aa, bb) => (truthy(cc) ? aa : bb))
      }
      case 'index': {
        const v = toArr(ev(node.e, scope))
        const n = Math.round(scalar(ev(node.idx, scope)))
        const out = new Array(N)
        for (let i = 0; i < N; i++) out[i] = i - n >= 0 && i - n < N ? v[i - n] : NaN
        return out
      }
      case 'call': return callFn(node, scope)
    }
    throw new Error('Bad node')
  }

  for (const st of stmts) {
    if (st.k === 'assign') env[st.name] = ev(st.e, env)
    else if (st.k === 'func') funcs[st.name] = { params: st.params, body: st.body }
    else if (st.k === 'expr') ev(st.e, env)
  }
  markers.sort((p, q) => p.time - q.time)
  return markers
}

export function evalPine(source, candles) {
  try {
    if (!candles || candles.length === 0) return { markers: [], error: null }
    return { markers: evaluate(parse(tokenize(source)), candles), error: null }
  } catch (e) {
    return { markers: [], error: e?.message || String(e) }
  }
}
