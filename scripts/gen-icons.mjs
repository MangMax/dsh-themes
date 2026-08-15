#!/usr/bin/env node
/**
 * 从 reicon 仓库的 data/icon-data.json 生成精选图标子集:
 *   client/src/icons.generated.ts
 *
 * 用法:
 *   node scripts/gen-icons.mjs [icon-data.json 路径] [--all]
 *
 * 默认按「菜单/导航场景」关键词精选(名字 + 描述标签命中),体积约 200-350KB;
 * --all 生成完整数据集(约 8MB,仅当需要全部图标时使用)。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../client/src/icons.generated.ts')

const args = process.argv.slice(2)
const allFlag = args.includes('--all')
const src = args.find((a) => !a.startsWith('--')) || resolve(__dirname, '../../reicon/data/icon-data.json')

let raw
try {
  raw = readFileSync(src, 'utf8')
} catch (e) {
  console.error('读取失败:', e.message)
  console.error('请提供 reicon 的 icon-data.json 路径,例如: node scripts/gen-icons.mjs ~/path/to/reicon/data/icon-data.json')
  process.exit(1)
}
const data = JSON.parse(raw)

// ── 菜单/导航场景精选关键词(命中名字或描述标签即入选) ──────────────────
const KEYWORDS = ["settings","gear","cog","slider","toggle","switch","option","preference","user","person","account","profile","avatar","admin","owner","member","people","man","woman","chat","message","comment","mail","envelope","inbox","send","reply","notification","bell","phone","call","file","folder","document","note","book","edit","pen","pencil","write","copy","paste","clipboard","save","download","upload","attachment","archive","arrow","chevron","caret","check","close","plus","minus","menu","more","dot","list","grid","search","filter","sort","eye","lock","unlock","key","home","house","info","question","help","alert","warning","refresh","sync","undo","redo","external","link","share","star","heart","like","bookmark","tag","flag","pin","calendar","clock","time","timer","terminal","code","command","git","branch","commit","pull","push","merge","cpu","chip","monitor","screen","display","laptop","mobile","device","database","server","cloud","wifi","battery","robot","bot","ai","spark","magic","wand","bug","test","package","box","layer","stack","api","plug","puzzle","extension","template","chart","graph","report","target","goal","trophy","award","medal","crown","rocket","fire","bolt","zap","power","status","shield","security","safety","wallet","cart","money","coin","bank","card","gift","shopping","camera","image","photo","picture","video","film","play","pause","stop","music","mic","volume","speaker","headphone","globe","map","world","earth","location","compass","sun","moon","star","cloud","rain","snow","leaf","plant","flower","tree","add","new","create","delete","trash","remove","reset","clear","print","open","close","next","previous","back","forward","up","down","left","right"]

const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const re = new RegExp('^(' + KEYWORDS.map(esc).join('|') + ')')

function pick(name, desc) {
  const tags = (desc || []).map((t) => String(t).toLowerCase())
  if (re.test(name)) return true
  return tags.some((t) => re.test(t))
}

const out = {}
let kept = 0
for (const [cat, catVal] of Object.entries(data.categories)) {
  for (const [name, ic] of Object.entries(catVal.icons || {})) {
    if (!allFlag && !pick(name, ic.description)) continue
    const w = ic.weights || {}
    const entry = {}
    if (w.Outline && typeof w.Outline.code === 'string') entry.O = w.Outline.code
    if (w.Filled && typeof w.Filled.code === 'string') entry.F = w.Filled.code
    if (!entry.O && !entry.F) continue
    const tags = (ic.description || []).map((t) => String(t).toLowerCase()).slice(0, 6)
    if (tags.length > 0) entry.t = tags
    out[name] = entry
    kept++
  }
}

const names = Object.keys(out).sort()
const lines = []
lines.push('// GENERATED FILE — 由 scripts/gen-icons.mjs 生成,请勿手改。')
lines.push('// 来源: reicon (https://github.com/dqev/reicon) data/icon-data.json')
lines.push('// 图标数据仅含 SVG 内部标记(code),viewBox 统一为 0 0 24 24。')
lines.push('export interface ReiconIcon {')
lines.push('  /** Outline 权重 SVG 内部标记 */')
lines.push('  O: string')
lines.push('  /** Filled 权重 SVG 内部标记(可选) */')
lines.push('  F?: string')
lines.push('  /** 搜索标签 */')
lines.push('  t?: string[]')
lines.push('}')
lines.push('export const REICON_ICONS: Record<string, ReiconIcon> = {')
for (const n of names) {
  const e = out[n]
  const parts = []
  parts.push('O:' + JSON.stringify(e.O))
  if (e.F) parts.push('F:' + JSON.stringify(e.F))
  if (e.t) parts.push('t:' + JSON.stringify(e.t))
  lines.push('  ' + JSON.stringify(n) + ':{' + parts.join(',') + '},')
}
lines.push('}')
lines.push('export const REICON_NAMES: string[] = ' + JSON.stringify(names))
writeFileSync(OUT, lines.join('\n') + '\n')

const bytes = Buffer.byteLength(lines.join('\n'))
console.log('已生成 ' + OUT)
console.log('图标数:', kept, ' 体积:', (bytes / 1024).toFixed(0) + ' KB')
