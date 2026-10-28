import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// 开发时把接口与订阅地址代理到本地服务（默认 127.0.0.1:8080）
const target = process.env.SUBFORGE_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(['/api', '/sub', '/p', '/r', '/healthz'].map((p) => [p, { target, changeOrigin: false }])),
  },
  build: { outDir: 'dist', sourcemap: true },
});
