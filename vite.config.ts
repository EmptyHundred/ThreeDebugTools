import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
  plugins: [glsl()],
  server: {
    port: 4563,
    strictPort: true,
    open: false,
  },
})
