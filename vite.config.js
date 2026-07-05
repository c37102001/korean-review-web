import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project page: https://<username>.github.io/korean-review-web/
// If you rename the GitHub repo, update this base path to match.
export default defineConfig({
  plugins: [react()],
  base: '/korean-review-web/',
})
