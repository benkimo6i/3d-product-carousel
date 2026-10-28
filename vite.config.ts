import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so one build works wherever it's served: the GitHub Pages project path
  // (/<repo>/) and each PR preview's subfolder alike.
  base: './',
})
