import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: './',
  define: {
    // dev 直接透過 /@fs 讀 ../site/data 的真實報告；build 後用相對路徑
    __DATA_BASE__: JSON.stringify(
      command === 'serve' ? '/@fs' + resolve(here, '../site/data') : './data'
    ),
  },
  build: {
    outDir: '../site',
    // site/data/ 放每日報告 JSON（pipeline 產出），build 不可清掉
    emptyOutDir: false,
  },
  server: {
    fs: { allow: ['..'] },
  },
}))
