import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = (glob) => path.join(here, glob).split(path.sep).join('/');

/**
 * The main portal's tokens, so the two apps read as one product. Kept to what
 * this app uses; the source of truth is client/tailwind.config.js.
 */
export default {
  content: [from('index.html'), from('src/**/*.{js,jsx}')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
      },
      letterSpacing: { display: '-0.028em', eyebrow: '0.17em' },
      colors: {
        brand: {
          50: '#fef2f3', 100: '#fde3e5', 200: '#fbcbcf', 300: '#f7a5ab',
          400: '#ef7480', 500: '#dc4450', 600: '#a41c24', 700: '#8a1820',
          800: '#74171d', 900: '#62171c', 950: '#36080b',
        },
        ink: {
          50: '#f9f9fa', 100: '#f2f2f4', 200: '#e5e5e9', 300: '#cbcbd3',
          400: '#94949f', 500: '#6a6a76', 600: '#4d4d58', 700: '#3a3a43',
          800: '#26262d', 900: '#16161a', 950: '#0b0b0d',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(22,22,26,.04), 0 8px 24px -12px rgba(22,22,26,.16)',
        lift: '0 18px 50px -24px rgba(22,22,26,.42)',
      },
    },
  },
  plugins: [],
};
