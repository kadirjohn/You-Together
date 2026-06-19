/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        'nunito': ['Nunito', 'sans-serif'],
      },
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
        'cartoon': '0 4px 0 rgba(0, 0, 0, 0.4), 0 6px 12px rgba(0, 0, 0, 0.3)',
        'cartoon-sm': '0 3px 0 rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.25)',
        'cartoon-card': '0 4px 0 rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.2)',
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'pop-in': 'pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'bounce-in': 'bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'wobble': 'wobble 0.5s ease-in-out',
        'float': 'float 3s ease-in-out infinite',
        'eye-appear': 'eye-appear 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
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
