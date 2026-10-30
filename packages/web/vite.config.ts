import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 开发时把接口与订阅地址代理到本地服务（默认 127.0.0.1:8080）
const target = process.env.SUBFORGE_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    // 按完整路径段匹配：/p 与 /r 不能吞掉前端路由 /profiles、/rulesets
    proxy: { '^/(api|sub|p|r)/.*': { target, changeOrigin: false }, '/healthz': { target, changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
