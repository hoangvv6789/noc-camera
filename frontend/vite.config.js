import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // FIX: cần cấu hình đầy đủ để proxy cả HTTP và WebSocket
      '/api': {
        target: 'http://localhost:8687',
        changeOrigin: true,
        // ws: true bật proxy WebSocket qua Vite dev server
        // → giải quyết lỗi "WebSocket closed before connection established"
        ws: true,
      }
    }
  }
})
