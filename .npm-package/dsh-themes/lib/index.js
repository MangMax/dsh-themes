// dsh-themes host 入口(ESM wrapper):产物按函数体执行,返回值即插件对象
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('./index.cjs', import.meta.url), 'utf8')
const plugin = new Function(src)()
export const name = 'dsh-themes'
export const apply = plugin.apply
export const inject = plugin.inject
export const Config = plugin.Config
