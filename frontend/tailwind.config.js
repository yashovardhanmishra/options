/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // The terminal palette is now CSS-variable driven so the whole app can be
      // re-skinned by switching `data-theme` on <html>. Defaults (the original
      // dark hex) live in src/index.css; per-template overrides sit alongside.
      colors: {
        ink: 'var(--opt-ink)',
        panel: 'var(--opt-panel)',
        panel2: 'var(--opt-panel2)',
        edge: 'var(--opt-edge)',
        ce: 'var(--opt-ce)',
        pe: 'var(--opt-pe)',
      },
      fontFamily: {
        mono: ['var(--opt-font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['var(--opt-font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
