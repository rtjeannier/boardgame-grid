import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build straight into ../docs so GitHub Pages can serve the site from the
// repo's /docs folder. `base: './'` keeps asset URLs relative, which is what
// Pages needs when the site lives under a project sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../docs',
    emptyOutDir: true,
  },
})
