/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-main': '#070707',
        'bg-panel': '#111111',
        'bg-card': '#171717',
        'red-main': '#ff0033',
        'red-soft': '#ff335f',
        'red-dark': '#8a001d',
        'text-main': '#f5f5f5',
        'text-muted': '#a3a3a3',
      },
      boxShadow: {
        'glow-red': '0 0 12px rgba(255, 0, 51, 0.45), 0 0 32px rgba(255, 0, 51, 0.2)',
        'glow-red-sm': '0 0 8px rgba(255, 0, 51, 0.35), 0 0 16px rgba(255, 0, 51, 0.15)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(255, 0, 51, 0.45), 0 0 32px rgba(255, 0, 51, 0.2)' },
          '50%': { boxShadow: '0 0 24px rgba(255, 0, 51, 0.65), 0 0 48px rgba(255, 0, 51, 0.35)' },
        },
      },
    },
  },
  plugins: [],
};
