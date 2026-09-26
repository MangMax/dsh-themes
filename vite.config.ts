import { defineConfig } from 'vite'

// DSH 插件要求 code 为纯函数体:var 声明 + IIFE 赋值 + return
// pack 块(banner/footer)负责包装,产物即插件函数体
//
// 注意 package.json 里的 `vite` 是别名:
//   "vite": "npm:@voidzero-dev/vite-plus-core@<与 vite-plus 同版本>"
// vite-plus 0.3 起会校验这个别名(否则报
// `Expected @voidzero-dev/vite-plus-core@x, but found vite@y`),
// `vp migrate` 做的就是这件事。因此上面的 `defineConfig` 与下面的 `pack`
// 都由 vite-plus-core 提供 —— 升级 vite-plus 时这个别名必须同版本一起改。
export default defineConfig({
  pack: [
    {
      entry: ['client/src/index.ts'],
      deps: { neverBundle: ['@deepseek-ai/dsh-client-ui-primitives'] },
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      minify: true,
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
      minify: true,
      outDir: 'dist/host',
      clean: false,
      treeshake: false,
      banner: 'var module = { exports: {} };\nvar exports = module.exports;',
      footer: 'return module.exports.default;',
    },
  ],
})
