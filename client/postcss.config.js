import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    // Pin the Tailwind config by path rather than letting it be discovered.
    //
    // Tailwind searches for tailwind.config.js starting at the current working
    // directory, not next to this file. Run Vite from the repository root
    // instead of from client/ and the search finds nothing, Tailwind quietly
    // falls back to its stock config, and every custom colour vanishes -- which
    // surfaces as "the `text-ink-900` class does not exist" on the first
    // utility that uses one, pointing at index.css rather than at the real
    // cause. Naming the file removes the guesswork.
    tailwindcss: { config: path.join(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
