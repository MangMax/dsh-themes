// ESM 解析钩子:让 node 能直接 import 本仓库的 .ts 源码。
//
// 背景:scripts/e2e-import.mjs 要测客户端半区的**纯逻辑**(vs-import.ts 的映射),
// 但源码里的相对导入写的是 ESM 风格的 `./color-utils.js`,磁盘上实际是
// `./color-utils.ts`(打包器会做这个映射,node 不会)。此前靠现场调用
// `node_modules/.bin/rolldown` 打包一次 —— 而 rolldown 只是 tsdown 的**传递依赖**,
// pnpm 不保证在每个平台上都生成它的 .bin 入口:CI(ubuntu)上就报
// `spawnSync .../node_modules/.bin/rolldown ENOENT`,本地(macOS)却存在。
//
// 现在改用 node 自己的类型擦除(Node 22.18+/24 默认开启)+ 这个解析钩子:
// 找不到 `x.js` 就退回 `x.ts`。零依赖、跨平台,不再依赖任何打包器。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    // 只在「相对/绝对路径 + .js 结尾」时回退到同名 .ts,不去猜包名
    if (typeof specifier === 'string' && specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'))) {
      try {
        return await nextResolve(specifier.slice(0, -3) + '.ts', context)
      } catch {
        throw error
      }
    }
    throw error
  }
}
