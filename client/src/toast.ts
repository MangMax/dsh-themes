// Toast 宿主:DSH 原生 Toast 的队列化封装。
//
// 背景:重构前成功/失败提示渲染为设置页底部的内联 `.dsth-msg`。设置页很长,
// 提示出现在最下方几乎不可见(用户明确反馈「错误和成功提示也使用 toast,
// 否则显示在下面完全注意不到」)。改为 DSH 原生 Toast:它经 createPortal 挂到
// document.body、position:fixed、top:40px、z-index:1100(DSH 最高层),
// 因此无论设置页滚到哪里都在视线内。
//
// `@deepseek-ai/dsh-client-ui-primitives` 是 __ModuleLoader__ 的 seed word,恒可解析;
// vite.config.ts 已用 deps.neverBundle 让产物保留 require(...) 调用而非内联打包。
// Toast 自带滑入(160ms)/淡出(1000ms)动画与 role="alert",这里只负责排队、
// 卸载与图标座位,不改样式、不重做动画。
import { Toast, IconCloseCircleFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** 队列上限:超出时丢弃最旧的一条,防止异常路径(连续失败)下无限堆积。 */
const TOAST_QUEUE_MAX = 6

/**
 * Toast 队列:一次只渲染一条,淡出结束(onDone)后出队。
 *
 * push 经 useCallback 固定引用,异步导入流程(下载/解压/搜索)可在任意时刻
 * 安全调用,不会因重渲染丢失。返回的 current 为当前应渲染的条目,无则 null。
 *
 * @returns {{ current: object|null, push: Function, drop: Function }}
 *   push(text, tone):tone 为 'ok' | 'error';drop(id):带序号出队
 */
export function useToasts() {
  const [queue, setQueue] = React.useState([])
  const seq = React.useRef(0)
  const push = React.useCallback((text, tone) => {
    const value = typeof text === 'string' ? text : String(text == null ? '' : text)
    if (value.length === 0) return
    const item = { id: ++seq.current, text: value, tone: tone === 'error' ? 'error' : 'ok' }
    setQueue((prev) => {
      const next = prev.concat([item])
      // 超限丢最旧:被丢的那条若正在渲染,其计时器会随卸载一并清理,不会污染新队首
      return next.length > TOAST_QUEUE_MAX ? next.slice(next.length - TOAST_QUEUE_MAX) : next
    })
  }, [])
  // 带 id 出队:迟到的 onDone(极端竞态)只允许移除它自己那条,不会误删新的队首
  const drop = React.useCallback((id) => {
    setQueue((prev) => {
      if (prev.length === 0) return prev
      if (id !== undefined && prev[0].id !== id) return prev
      return prev.slice(1)
    })
  }, [])
  return { current: queue.length > 0 ? queue[0] : null, push, drop }
}

/**
 * 渲染当前 Toast(无条目时渲染 null)。
 *
 * key 用自增序号:相同文案再次出现时必须强制重挂载,否则 Toast 内部只按
 * holdMs 建一次计时器,第二条会永远等不到 onDone 而卡住整个队列。
 * 成功走 tone="success"(自带绿色对勾);错误在 icon 座位放红色叉号
 * (前缀 `dsth-toast-icon-error` 把图标染成 error 主色),并给更长的 holdMs
 * 让较长的失败原因有时间读完。
 *
 * @param props.current useToasts() 的 current
 * @param props.onDone  淡出完成后由宿主卸载;这里回传条目序号
 */
export function ToastHost({ current, onDone }) {
  if (!current) return null
  const error = current.tone === 'error'
  return React.createElement(Toast, {
    key: current.id,
    text: current.text,
    tone: error ? undefined : 'success',
    icon: error ? React.createElement(IconCloseCircleFillRegular, { size: 16, className: 'dsth-toast-icon-error' }) : undefined,
    holdMs: error ? 4500 : 3000,
    onDone: () => onDone(current.id),
  })
}
