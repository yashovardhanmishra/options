// CosmicSky — live day/night backdrop for the `cosmic` theme (options app).
// Mirror of stratosai/src/components/cosmic/CosmicSky.tsx: one fixed full-viewport
// <canvas> painted every frame — NIGHT (moon + parallax stars + nebula + shooting
// stars) in dark mode, DAY (sun + drifting clouds) in light mode, with a dawn/dusk
// crossfade when the mode toggles. Reads data-theme / data-mode off <html> and only
// paints when the cosmic theme is active; every other template keeps its own bg.
// z-index:-1, pointer-events:none, honours prefers-reduced-motion.
import { useEffect, useRef } from 'react'

export default function CosmicSky() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let W = 0, H = 0, dpr = 1
    let raf = 0, running = false, last = 0

    const root = document.documentElement
    let active = root.dataset.theme === 'cosmic'
    let mix = root.dataset.mode === 'light' ? 0 : 1 // 1 = night, 0 = day
    let target = mix

    let stars = [], clouds = [], nebulae = []
    let shoot = null, nextShoot = 3.5

    const rnd = (a, b) => a + Math.random() * (b - a)
    const hx = (h) => { const s = h.replace('#', ''); return [parseInt(s.substr(0, 2), 16), parseInt(s.substr(2, 2), 16), parseInt(s.substr(4, 2), 16)] }
    const lerp = (a, b, t) => a + (b - a) * t
    const mixc = (c1, c2, t) => { const a = hx(c1), b = hx(c2); return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})` }

    function build() {
      stars = []
      const n = Math.round((W * H) / 7200)
      for (let i = 0; i < n; i++) {
        const layer = Math.random()
        stars.push({ x: Math.random() * W, y: Math.random() * H * 0.94, r: rnd(0.4, 1.6) * (0.6 + layer), a: rnd(0.35, 1), ph: rnd(0, 6.28), sp: rnd(0.6, 2.2), drift: 0.4 + layer * 1.5, hue: Math.random() < 0.76 ? '#ffffff' : (Math.random() < 0.5 ? '#c7d2fe' : '#a5b4fc') })
      }
      nebulae = [
        { x: W * 0.22, y: H * 0.3, r: Math.max(W, H) * 0.42, c: '#4338ca', a: 0.1 },
        { x: W * 0.8, y: H * 0.5, r: Math.max(W, H) * 0.36, c: '#6d28d9', a: 0.08 },
        { x: W * 0.55, y: H * 0.78, r: Math.max(W, H) * 0.4, c: '#0e7490', a: 0.05 },
      ]
      clouds = []
      const cl = Math.round(W / 260) + 3
      for (let j = 0; j < cl; j++) {
        const layer2 = Math.random()
        const puffs = []
        const pc = 4 + Math.round(Math.random() * 3)
        const base = rnd(26, 52) * (0.7 + layer2 * 0.7)
        for (let k = 0; k < pc; k++) puffs.push({ dx: (k - pc / 2) * base * 0.62 + rnd(-8, 8), dy: rnd(-base * 0.28, base * 0.18), r: base * rnd(0.62, 1.05) })
        clouds.push({ x: Math.random() * W, y: rnd(H * 0.08, H * 0.5), s: 0.7 + layer2 * 0.7, a: 0.5 + layer2 * 0.4, v: 0.08 + layer2 * 0.32, puffs })
      }
    }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth; H = window.innerHeight
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      build()
    }

    function skyGrad(t) {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, mixc('#7fb4f2', '#0a1224', t))
      g.addColorStop(0.45, mixc('#a9d2f6', '#0a1020', t))
      g.addColorStop(1, mixc('#e8f4fc', '#050912', t))
      return g
    }

    function drawStars(t, time) {
      if (t <= 0.02) return
      for (const s of stars) {
        let x = (s.x + (reduce ? 0 : time * s.drift * 3)) % W; if (x < 0) x += W
        const tw = reduce ? s.a : s.a * (0.45 + 0.55 * Math.sin(time * s.sp + s.ph))
        ctx.globalAlpha = Math.max(0, tw) * t; ctx.fillStyle = s.hue
        ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.2832); ctx.fill()
        if (s.r > 1.2) {
          ctx.globalAlpha = Math.max(0, tw) * t * 0.45
          const gg = ctx.createRadialGradient(x, s.y, 0, x, s.y, s.r * 2.4)
          gg.addColorStop(0, s.hue); gg.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, s.y, s.r * 2.4, 0, 6.2832); ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
    function drawNebula(t, time) {
      if (t <= 0.02) return
      ctx.globalCompositeOperation = 'lighter'
      nebulae.forEach((nb, i) => {
        const x = nb.x + (reduce ? 0 : Math.sin(time * 0.05 + i) * 40)
        const g = ctx.createRadialGradient(x, nb.y, 0, x, nb.y, nb.r)
        g.addColorStop(0, nb.c); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = nb.a * t; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, nb.y, nb.r, 0, 6.2832); ctx.fill()
      })
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
    }
    function drawMoon(t, time) {
      if (t <= 0.02) return
      const mx = W * 0.82, my = H * 0.24 + (reduce ? 0 : Math.sin(time * 0.3) * 5)
      const R = Math.max(32, Math.min(W, H) * 0.07)
      const h = ctx.createRadialGradient(mx, my, R * 0.6, mx, my, R * 3.4)
      h.addColorStop(0, `rgba(199,210,254,${0.5 * t})`); h.addColorStop(0.4, `rgba(129,140,248,${0.13 * t})`); h.addColorStop(1, 'rgba(129,140,248,0)')
      ctx.fillStyle = h; ctx.beginPath(); ctx.arc(mx, my, R * 3.4, 0, 6.2832); ctx.fill()
      ctx.globalAlpha = t
      const d = ctx.createRadialGradient(mx - R * 0.35, my - R * 0.35, R * 0.2, mx, my, R)
      d.addColorStop(0, '#fbfdff'); d.addColorStop(0.7, '#e6ecfb'); d.addColorStop(1, '#c3cde8')
      ctx.fillStyle = d; ctx.beginPath(); ctx.arc(mx, my, R, 0, 6.2832); ctx.fill()
      ctx.fillStyle = `rgba(148,163,184,${0.3 * t})`
      const cr = [[0.2, -0.25, 0.16], [-0.28, 0.12, 0.2], [0.32, 0.28, 0.13], [0.05, 0.4, 0.1], [-0.1, -0.42, 0.08]]
      for (const k of cr) { ctx.beginPath(); ctx.arc(mx + k[0] * R, my + k[1] * R, k[2] * R, 0, 6.2832); ctx.fill() }
      ctx.globalAlpha = 1
    }
    function drawSun(t, time) {
      if (t <= 0.02) return
      const sx = W * 0.8, sy = H * 0.23; const R = Math.max(28, Math.min(W, H) * 0.06)
      const pulse = reduce ? 1 : 1 + 0.04 * Math.sin(time * 1.3)
      const w = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.7)
      w.addColorStop(0, `rgba(255,236,170,${0.5 * t})`); w.addColorStop(0.3, `rgba(255,224,150,${0.14 * t})`); w.addColorStop(1, 'rgba(255,224,150,0)')
      ctx.fillStyle = w; ctx.fillRect(0, 0, W, H)
      if (!reduce) {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(time * 0.06); ctx.globalAlpha = 0.1 * t; ctx.strokeStyle = '#fde68a'
        for (let i = 0; i < 20; i++) { ctx.rotate(6.2832 / 20); ctx.beginPath(); ctx.moveTo(R * 1.4, 0); ctx.lineTo(R * 3.2, 0); ctx.lineWidth = 6; ctx.stroke() }
        ctx.restore()
      }
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 2.6 * pulse)
      g.addColorStop(0, `rgba(255,247,214,${t})`); g.addColorStop(0.35, `rgba(251,191,36,${0.8 * t})`); g.addColorStop(1, 'rgba(251,191,36,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R * 2.6 * pulse, 0, 6.2832); ctx.fill()
      ctx.globalAlpha = t
      const d = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.2, sx, sy, R)
      d.addColorStop(0, '#fffdf5'); d.addColorStop(1, '#fbbf24')
      ctx.fillStyle = d; ctx.beginPath(); ctx.arc(sx, sy, R * pulse, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1
    }
    function drawClouds(t, time) {
      if (t <= 0.02) return
      for (const cl of clouds) {
        if (!reduce) cl.x += cl.v
        let span = 0; for (const p of cl.puffs) span = Math.max(span, Math.abs(p.dx) + p.r)
        if (cl.x - span > W) cl.x = -span
        for (const p of cl.puffs) {
          const px = cl.x + p.dx * cl.s, py = cl.y + p.dy * cl.s, pr = p.r * cl.s
          const g = ctx.createRadialGradient(px, py - pr * 0.25, pr * 0.2, px, py, pr)
          g.addColorStop(0, `rgba(255,255,255,${0.95 * cl.a * t})`); g.addColorStop(0.7, `rgba(244,249,255,${0.75 * cl.a * t})`); g.addColorStop(1, 'rgba(214,230,246,0)')
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.2832); ctx.fill()
        }
      }
    }
    function drawShoot(dt) {
      if (mix < 0.5 || reduce) { shoot = null; return }
      nextShoot -= dt
      if (!shoot && nextShoot <= 0) { shoot = { x: rnd(W * 0.1, W * 0.6), y: rnd(H * 0.05, H * 0.3), len: rnd(120, 220), life: 0, dur: 0.7, ang: rnd(0.35, 0.6) }; nextShoot = rnd(6, 12) }
      if (shoot) {
        shoot.life += dt; const pr = shoot.life / shoot.dur; if (pr >= 1) { shoot = null; return }
        const dx = Math.cos(shoot.ang), dy = Math.sin(shoot.ang)
        const hx2 = shoot.x + dx * shoot.len * pr * 2.4, hy2 = shoot.y + dy * shoot.len * pr * 2.4
        const tx = hx2 - dx * shoot.len, ty = hy2 - dy * shoot.len; const fade = Math.sin(pr * 3.14159)
        const g = ctx.createLinearGradient(tx, ty, hx2, hy2)
        g.addColorStop(0, 'rgba(199,210,254,0)'); g.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`)
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx2, hy2); ctx.stroke()
        ctx.fillStyle = `rgba(255,255,255,${fade})`; ctx.beginPath(); ctx.arc(hx2, hy2, 2.2, 0, 6.2832); ctx.fill()
      }
    }

    function frame(ts) {
      const time = ts / 1000; const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts
      if (!active) { ctx.clearRect(0, 0, W, H); running = false; return }
      if (Math.abs(mix - target) > 0.001) mix += (target - mix) * Math.min(1, dt * 2.2); else mix = target
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = skyGrad(mix); ctx.fillRect(0, 0, W, H)
      drawSun(1 - mix, time); drawClouds(1 - mix, time)
      drawNebula(mix, time); drawStars(mix, time); drawMoon(mix, time); drawShoot(dt)
      const vg = ctx.createRadialGradient(W / 2, H * 0.1, H * 0.4, W / 2, H * 0.5, Math.max(W, H) * 0.85)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, mix > 0.5 ? 'rgba(2,4,10,0.5)' : 'rgba(90,120,160,0.14)')
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
      if (reduce && mix === target) { running = false; return }
      raf = requestAnimationFrame(frame)
    }
    function kick() { if (!running && active) { running = true; last = 0; raf = requestAnimationFrame(frame) } }

    const obs = new MutationObserver(() => {
      const nowActive = root.dataset.theme === 'cosmic'
      target = root.dataset.mode === 'light' ? 0 : 1
      if (nowActive && !active) { active = true; kick() }
      else if (!nowActive && active) { active = false; ctx.clearRect(0, 0, W, H) }
      else if (active) kick()
    })
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] })

    const onResize = () => { resize(); kick() }
    window.addEventListener('resize', onResize)

    resize()
    if (active) kick(); else ctx.clearRect(0, 0, W, H)

    return () => { cancelAnimationFrame(raf); obs.disconnect(); window.removeEventListener('resize', onResize) }
  }, [])

  return <canvas ref={ref} className="cosmic-sky" aria-hidden="true" />
}
