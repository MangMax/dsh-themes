import { defineConfig } from 'vite'

// DSH 插件要求 code 为纯函数体:var 声明 + IIFE 赋值 + return
// pack 块(banner/footer)负责包装,产物即插件函数体
export default defineConfig({
  pack: [
    {
      entry: ['client/src/index.ts'],
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      minify: false,
      outDir: 'dist/client',
      clean: false,
      treeshake: false,
      banner: 'var module = { exports: {} };\nvar exports = module.exports;',
      footer: 'return module.exports.default;',
    },
    {
      entry: ['host/src/index.ts'],
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      minify: false,
      outDir: 'dist/host',
      clean: false,
      treeshake: false,
      banner: 'var module = { exports: {} };\nvar exports = module.exports;',
      footer: 'return module.exports.default;',
    },
  ],
})
