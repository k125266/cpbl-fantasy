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
    // API=http://localhost:8082 npm run dev 可接到另一個後端（例：本機同時跑真實資料與 demo）
    proxy: { '/api': process.env.API ?? 'http://localhost:8080' },
  },
})
