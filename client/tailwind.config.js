/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#07080f',
          900: '#0d0f1a',
          800: '#141727',
          700: '#1c2136',
        },
        brand: {
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
        'blink': 'blink 1s step-end infinite',
        'slide-in-right': 'slideInRight 0.35s cubic-bezier(0.16,1,0.3,1)',
        'slide-in-left': 'slideInLeft 0.35s cubic-bezier(0.16,1,0.3,1)',
        'float': 'float 4s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
      },
      keyframes: {
        slideIn: { from: { transform: 'translateY(8px)', opacity: 0 }, to: { transform: 'translateY(0)', opacity: 1 } },
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        blink: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0 } },
        slideInRight: { from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
        slideInLeft: { from: { transform: 'translateX(-24px)', opacity: 0 }, to: { transform: 'translateX(0)', opacity: 1 } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        glowPulse: { '0%, 100%': { opacity: 0.5, transform: 'scale(1)' }, '50%': { opacity: 0.9, transform: 'scale(1.08)' } },
      },
    },
  },
  plugins: [],
};
