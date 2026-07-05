import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitLab Pages project page: https://<username>.gitlab.io/korean-review-web/
// If you rename the GitLab repo, update this base path to match.
export default defineConfig({
  plugins: [react()],
  base: '/korean-review-web/',
})
