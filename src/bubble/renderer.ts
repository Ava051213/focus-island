import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 泡泡的渲染端（跑在 bubble overlay 窗口）：
 * 接收 spawn 事件 / 启动时 drain 待发队列，管理泡泡生命周期、
 * 悬停命中检测（整面穿透，光标压到泡泡才可点）与用完即毁。
 * 决策（闸门/文案/频率）全在 main 的 spawner，这里只管画。
 */

export interface FloatingBubble {
  id: number
  kind: string
  text: string
  /** 出生点与漂移参数（overlay 内逻辑像素） */
  x: number
  y: number
  /** 1 = 向上飘（岛贴底），-1 = 向下飘（岛贴顶） */
  dir: 1 | -1
  riseTo: number
  driftMs: number
  arcX: number
  arcEase: string
  variant: number
  tintH: number
}

const MAX_CONCURRENT = 3
const DRIFT_MS = 9500
const REMOVE_SLACK_MS = 150
const HIDE_GRACE_MS = 3000
const HOVER_POLL_MS = 180

const bubbles = ref<FloatingBubble[]>([])
let seq = 0
let hideTimer: number | null = null
let hoverTimer: number | null = null
let clickThroughActive: boolean | null = null
let unlistenSpawn: UnlistenFn | null = null

function clearHideTimer() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

function stopHoverPoll() {
  if (hoverTimer !== null) {
    window.clearInterval(hoverTimer)
    hoverTimer = null
  }
  clickThroughActive = null
}

/** 悬停轮询：光标压在某个泡泡上才让 overlay 可点，其余区域保持穿透 */
function startHoverPoll() {
  if (hoverTimer !== null) return
  hoverTimer = window.setInterval(async () => {
    if (bubbles.value.length === 0) return
    try {
      const win = getCurrentWindow()
      const [cx, cy] = await invoke<[number, number]>('get_cursor_position')
      const origin = await win.outerPosition()
      const scale = await win.scaleFactor()
      const lx = (cx - origin.x) / scale
      const ly = (cy - origin.y) / scale
      let hit = false
      for (const el of document.querySelectorAll<HTMLElement>('[data-bubble-id]')) {
        const r = el.getBoundingClientRect()
        if (lx >= r.left && lx <= r.right && ly >= r.top && ly <= r.bottom) {
          hit = true
          break
        }
      }
      if (hit !== clickThroughActive) {
        clickThroughActive = hit
        await invoke('set_click_through', { ignore: !hit })
      }
    } catch {
      // 命令不可用时保持现状
    }
  }, HOVER_POLL_MS)
}

/** 出生点：岛缘留 14px 间距，永远飘向对侧；转成 overlay 内逻辑坐标 */
async function spawnPoint(): Promise<{ x: number; y: number; dir: 1 | -1 } | null> {
  try {
    const metrics = await invoke<{
      island_x: number
      island_y: number
      island_width: number
      island_height: number
    } | null>('get_panel_transition_metrics')
    if (!metrics) return null
    const win = getCurrentWindow()
    const origin = await win.outerPosition()
    const scale = await win.scaleFactor()
    const centerX = (metrics.island_x + metrics.island_width / 2 - origin.x) / scale
    const islandLocalY = metrics.island_y - origin.y
    const fromTop = islandLocalY < 40
    const edgeY = fromTop
      ? (islandLocalY + metrics.island_height) / scale
      : islandLocalY / scale
    const gap = 14
    return {
      x: Math.max(10, centerX + (Math.random() * 240 - 120)),
      y: Math.max(10, fromTop ? edgeY + gap : edgeY - gap),
      dir: fromTop ? -1 : 1,
    }
  } catch {
    return null
  }
}

async function overlayHeight(): Promise<number> {
  const win = getCurrentWindow()
  const size = await win.outerSize()
  const scale = await win.scaleFactor()
  return size.height / scale
}

/** 渲染一个泡泡并安排它的移除；空了就安排隐藏与销毁 */
function spawnLocal(kind: string, text: string) {
  if (bubbles.value.length >= MAX_CONCURRENT) return
  void (async () => {
    clearHideTimer()
    const point = await spawnPoint()
    if (!point) return
    const driftMs = DRIFT_MS + Math.random() * 2500
    const height = await overlayHeight()
    const riseTo = point.dir === 1
      ? Math.max(120, point.y - 40)
      : Math.max(120, height - point.y - 40)
    const bubble: FloatingBubble = {
      id: ++seq,
      kind,
      text,
      x: point.x,
      y: point.y,
      dir: point.dir,
      riseTo,
      driftMs,
      arcX: (Math.random() * 2 - 1) * 170,
      arcEase: ['ease-out', 'ease-in', 'ease-in-out'][Math.floor(Math.random() * 3)],
      variant: Math.floor(Math.random() * 3),
      tintH: [150, 25, 265, 205][Math.floor(Math.random() * 4)],
    }
    bubbles.value.push(bubble)
    startHoverPoll()
    window.setTimeout(() => {
      bubbles.value = bubbles.value.filter(bb => bb.id !== bubble.id)
      if (bubbles.value.length === 0) void scheduleHideAndClose()
    }, driftMs + REMOVE_SLACK_MS)
  })()
}

async function scheduleHideAndClose() {
  if (hideTimer !== null) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    hideTimer = null
    if (bubbles.value.length > 0) return
    stopHoverPoll()
    void (async () => {
      try {
        await invoke('hide_bubble_overlay')
        await invoke('close_bubble_window')
      } catch {
        // 忽略
      }
    })()
  }, HIDE_GRACE_MS)
}

export function useBubbleRenderer() {
  async function start() {
    if (unlistenSpawn) return
    // 启动时取走 Rust 侧的待发泡泡（懒创建场景的第一批）
    try {
      const pending = await invoke<Array<{ kind: string; text: string }>>('drain_bubbles')
      for (const p of pending) spawnLocal(p.kind, p.text)
    } catch {
      // 忽略
    }
    unlistenSpawn = await listen<{ kind?: string; text?: string }>('bubble-spawn', ({ payload }) => {
      if (payload?.kind && payload.text) spawnLocal(payload.kind, payload.text)
    })
  }

  function stop() {
    unlistenSpawn?.()
    unlistenSpawn = null
    clearHideTimer()
    stopHoverPoll()
    bubbles.value = []
  }

  async function onBubbleClick() {
    try {
      await invoke('toggle_panel')
    } catch {
      // 忽略
    }
  }

  return {
    bubbles,
    start,
    stop,
    onBubbleClick,
  }
}
