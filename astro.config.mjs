import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Fully static: deploy dist/ to Vercel or GitHub Pages. For a GitHub project page set BASE_PATH=/<repo-name>.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { host: '127.0.0.1', port: 4321 },
  // pre-bundle the lazily imported scan libs, otherwise dev re-optimizes on first scan and the import 404s
  vite: { plugins: [tailwindcss()], optimizeDeps: { include: ['pdfjs-dist', 'tesseract.js'] } },
});
