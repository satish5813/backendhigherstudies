import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    // Pinned by path so the working directory never matters (see the main
    // client's postcss.config.js for the failure this avoids).
    tailwindcss: { config: path.join(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
