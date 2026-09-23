import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Fully static: deploy dist/ to Vercel or GitHub Pages. For a GitHub project page set BASE_PATH=/<repo-name>.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { host: '127.0.0.1', port: 4321 },
  vite: { plugins: [tailwindcss()] },
});
