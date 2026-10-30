/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      animation: {
        'pulse-red': 'pulseRed 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-green': 'pulseGreen 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        pulseRed: {
          '0%, 100%': { opacity: 1, backgroundColor: '#ef4444' },
          '50%': { opacity: .5, backgroundColor: '#f87171' },
        },
        pulseGreen: {
          '0%, 100%': { opacity: 1, backgroundColor: '#22c55e' },
          '50%': { opacity: .5, backgroundColor: '#4ade80' },
        }
      }
    },
  },
  plugins: [],
}
