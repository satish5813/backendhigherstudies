/** @type {import('tailwindcss').Config} */

/**
 * KL Placement Readiness — design tokens.
 *
 * The palette is taken from the university mark: the crimson of the KL wordmark
 * and the near-black of the gear seal. `brand` is that crimson as a full scale,
 * so every component that previously used the default indigo picks up the
 * institutional colour without being touched.
 *
 * Crimson is a strong colour and a whole interface painted in it is exhausting
 * to work in. It is used for identity, primary action and emphasis; the body of
 * the product stays on the `ink` neutrals, which are warmed very slightly so
 * they sit with the red rather than fighting it.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // The resume itself renders in a stack every ATS can parse.
        resume: ['Calibri', 'Carlito', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        // KL crimson. 600 is the wordmark red; 700 the deeper seal lettering.
        brand: {
          50: '#fdf3f4', 100: '#fbe4e6', 200: '#f6cdd1', 300: '#eda6ad',
          400: '#e17681', 500: '#d04a58', 600: '#b01c25', 700: '#961920',
          800: '#7d181e', 900: '#6a181d', 950: '#3a0a0d',
        },
        // Warm-leaning slate so the neutrals sit with crimson.
        ink: {
          50: '#f9f9fa', 100: '#f2f2f4', 200: '#e5e5e9', 300: '#cbcbd3',
          400: '#94949f', 500: '#6a6a76', 600: '#4d4d58', 700: '#3a3a43',
          800: '#26262d', 900: '#16161a', 950: '#0b0b0d',
        },
        // Pulled from the seal, for surfaces that want the logo's black.
        seal: '#141414',
      },
      boxShadow: {
        card: '0 1px 2px rgba(22,22,26,.04), 0 8px 24px -12px rgba(22,22,26,.16)',
        lift: '0 18px 50px -24px rgba(22,22,26,.42)',
        glow: '0 0 0 1px rgba(176,28,37,.16), 0 18px 60px -20px rgba(176,28,37,.45)',
        // For the one or two elements that should feel physically raised.
        crisp: '0 1px 0 rgba(255,255,255,.6) inset, 0 1px 2px rgba(22,22,26,.08), 0 12px 32px -16px rgba(22,22,26,.28)',
      },
      backgroundImage: {
        'grid-slate':
          "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 .5H40M.5 0V40' stroke='%23e5e5e9' stroke-width='1'/%3E%3C/svg%3E\")",
        // Crimson mesh for the landing hero, kept low-opacity so text stays legible.
        mesh:
          'radial-gradient(at 10% 10%, rgba(176,28,37,.34) 0px, transparent 55%), radial-gradient(at 88% 6%, rgba(150,25,32,.26) 0px, transparent 50%), radial-gradient(at 72% 88%, rgba(58,10,13,.40) 0px, transparent 55%)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        // The seal turning slowly, like the gear it is drawn as.
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-up': 'fade-up .55s cubic-bezier(.22,1,.36,1) both',
        'fade-in': 'fade-in .4s ease both',
        shimmer: 'shimmer 1.8s infinite',
        float: 'float 6s ease-in-out infinite',
        'spin-slow': 'spin-slow 44s linear infinite',
      },
    },
  },
  plugins: [],
};
