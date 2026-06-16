/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0e14',
        panel: '#0f1620',
        panel2: '#131c28',
        edge: '#1e2a3a',
        ce: '#1b3a5c',
        pe: '#5c2b1b',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
