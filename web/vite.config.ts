import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 建置輸出到後端的 static 目錄，由 Spring Boot 一併提供
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/src/main/resources/static',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
})
