import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'
import { BUBBLE_TONE_MS, pickBubbleLine, type BubbleKind } from '../utils/bubbleTexts'

/**
 * 泡泡 overlay 窗口（label: bubble）专用的漂移泡泡管理。
 *
 * overlay 铺满岛所在屏的工作区，默认整面鼠标穿透；泡泡从岛边冒出，
 * 带着左右轻摆向上飘，飘到屏幕顶部淡出。触发源：
 * - panel / main 通过 `island-bubble` 广播事件投递（哄人、闲置喊话、测试）
 * - 本地撒娇定时器（档位节奏，面板开着时不打扰）
 */

export interface FloatingBubble {
  id: number
  kind: BubbleKind
  text: string
  /** 出生点与漂移参数（overlay 内逻辑像素） */
  x: number
  y: number
  /** 向上飘的目标距离（px），飘到顶就淡出 */
  riseTo: number
  driftMs: number
  /** 正弦横摆幅度（px）与相位偏移（ms），让每颗泡的路线都不一样 */
  swayAmp: number
  swayPhase: number
}

/** 同时最多几个泡泡在飘 */
const MAX_CONCURRENT = 3
/** 漂移时长（毫秒）与移除余量 */
const DRIFT_MS = 7800
const REMOVE_SLACK_MS = 150
/** 无泡泡后多久隐藏 overlay */
const HIDE_GRACE_MS = 3000
/** 闲置喊话的最小间隔：活动-闲置反复横跳时别连环喊 */
const IDLE_CALL_MIN_GAP_MS = 10 * 60 * 1000
/** 悬停轮询间隔（毫秒） */
const HOVER_POLL_MS = 180

const BUBBLE_KINDS: BubbleKind[] = ['coquetry', 'idle', 'comfort', 'test']

const bubbles = ref<FloatingBubble[]>([])
let seq = 0
let recentLines: string[] = []
let lastBubbleAt = 0
let coquetryTimer: number | null = null
let hideGraceTimer: number | null = null
let hoverTimer: number | null = null
let clickThroughActive: boolean | null = null
let overlayOrigin: { x: number; y: number } | null = null
let overlayScale = 1
let unlistenBubble: UnlistenFn | null = null
let installed = false

function clearCoquetryTimer() {
  if (coquetryTimer !== null) {
    window.clearTimeout(coquetryTimer)
    coquetryTimer = null
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
    if (bubbles.value.length === 0 || overlayOrigin === null) return
    try {
      const [cx, cy] = await invoke<[number, number]>('get_cursor_position')
      // 光标换算成 overlay 内逻辑坐标
      const lx = (cx - overlayOrigin.x) / overlayScale
      const ly = (cy - overlayOrigin.y) / overlayScale
      let hit = false
      for (const el of document.querySelectorAll<HTMLElement>('[data-bubble-id]')) {
        const r = el.getBoundingClientRect()
        if (lx >= r.left && lx <= r.right && ly >= r.top && ly <= r.bottom) {
          hit = true
          break
        }
      }
      const next = hit
      if (next !== clickThroughActive) {
        clickThroughActive = next
        await invoke('set_click_through', { ignore: !next })
      }
    } catch {
      // 命令不可用时保持现状
    }
  }, HOVER_POLL_MS)
}

async function showOverlay() {
  const win = getCurrentWindow()
  // 每次吐泡泡都按岛当前所在屏的工作区重新铺 overlay
  const area = await invoke<[number, number, number, number] | null>('get_island_work_area')
  if (!area) return
  const [l, t, w, h] = area
  overlayOrigin = { x: l, y: t }
  await win.setPosition(new PhysicalPosition(l, t))
  await win.setSize(new PhysicalSize(w, h))
  overlayScale = await win.scaleFactor()
  clickThroughActive = true
  await invoke('set_click_through', { ignore: true })
  await win.show()
  startHoverPoll()
}

async function scheduleHide() {
  if (hideGraceTimer !== null) window.clearTimeout(hideGraceTimer)
  hideGraceTimer = window.setTimeout(async () => {
    hideGraceTimer = null
    if (bubbles.value.length > 0) return
    stopHoverPoll()
    try {
      await getCurrentWindow().hide()
    } catch {
      // 忽略
    }
  }, HIDE_GRACE_MS)
}

/** 出生点：岛边缘附近，转成 overlay 内逻辑坐标 */
async function spawnPoint(): Promise<{ x: number; y: number } | null> {
  try {
    const metrics = await invoke<{
      island_x: number
      island_y: number
      island_width: number
      island_height: number
    } | null>('get_panel_transition_metrics')
    if (!metrics || overlayOrigin === null) return null
    const scale = overlayScale || 1
    const centerX = (metrics.island_x + metrics.island_width / 2 - overlayOrigin.x) / scale
    const edgeY =
      metrics.island_y - overlayOrigin.y < 40
        ? // 岛贴顶：从岛下缘冒
          (metrics.island_y + metrics.island_height - overlayOrigin.y) / scale
        : // 岛贴底：从岛上缘冒
          (metrics.island_y - overlayOrigin.y) / scale
    return {
      x: Math.max(10, centerX + (Math.random() * 240 - 120)),
      y: Math.max(10, edgeY),
    }
  } catch {
    return null
  }
}

/** 吐一个泡泡；类型开关与横幅让位由 spawn 闸门统一把关 */
function spawn(kind: BubbleKind, text?: string) {
  const { settings } = useSettings()
  const b = settings.value.bubbles
  if (!b.enabled) return
  if (kind === 'coquetry' && !b.coquetry) return
  if (kind === 'idle' && !b.idleCall) return
  if (kind === 'comfort' && !b.comfort) return
  if (kind === 'idle' && Date.now() - lastBubbleAt < IDLE_CALL_MIN_GAP_MS) return
  if (bubbles.value.length >= MAX_CONCURRENT) return

  void (async () => {
    if (bubbles.value.length === 0) await showOverlay()
    else await scheduleHideCheck()
    const point = await spawnPoint()
    if (!point) return
    const line = text ?? pickBubbleLine(kind, recentLines)
    recentLines = [line, ...recentLines].slice(0, 6)
    lastBubbleAt = Date.now()
    const driftMs = DRIFT_MS + Math.random() * 1200
    const bubble: FloatingBubble = {
      id: ++seq,
      kind,
      text: line,
      x: point.x,
      y: point.y,
      // 飘到屏幕顶再淡出
      riseTo: point.y + 80,
      driftMs,
      swayAmp: 34 + Math.random() * 50,
      swayPhase: Math.random() * 0.4 * driftMs,
    }
    bubbles.value.push(bubble)
    window.setTimeout(() => {
      bubbles.value = bubbles.value.filter(bb => bb.id !== bubble.id)
      if (bubbles.value.length === 0) void scheduleHide()
    }, driftMs + REMOVE_SLACK_MS)
  })()
}

async function scheduleHideCheck() {
  // 已有泡泡在飘时取消隐藏计划即可
  if (hideGraceTimer !== null) {
    window.clearTimeout(hideGraceTimer)
    hideGraceTimer = null
  }
}

/** 档位对应的基础间隔，±30% 抖动让它不像机械整点 */
function toneIntervalMs(tone: 'quiet' | 'normal' | 'lively'): number {
  return BUBBLE_TONE_MS[tone] * (0.7 + Math.random() * 0.6)
}

/** 撒娇定时：到点先看场合（面板开着不打扰），排下一个 */
function scheduleCoquetry() {
  clearCoquetryTimer()
  const { settings } = useSettings()
  if (!settings.value.bubbles.enabled || !settings.value.bubbles.coquetry) return
  coquetryTimer = window.setTimeout(() => {
    coquetryTimer = null
    void tryCoquetry()
  }, toneIntervalMs(settings.value.bubbles.tone))
}

async function tryCoquetry() {
  const { settings } = useSettings()
  if (!settings.value.bubbles.enabled || !settings.value.bubbles.coquetry) return
  try {
    const panelOpen = await invoke<boolean>('is_panel_visible')
    if (panelOpen) {
      scheduleCoquetry()
      return
    }
  } catch {
    // 查不到就当面板没开
  }
  spawn('coquetry')
  scheduleCoquetry()
}

export function useIslandBubbles() {
  const { settings } = useSettings()

  if (!installed) {
    installed = true
    watch(
      () => settings.value.bubbles,
      () => {
        if (!settings.value.bubbles.enabled) {
          clearCoquetryTimer()
          bubbles.value = []
          void scheduleHide()
        }
        scheduleCoquetry()
      },
      { deep: true },
    )
  }

  async function start() {
    if (unlistenBubble) return
    unlistenBubble = await listen<{ kind?: string; text?: string }>('island-bubble', ({ payload }) => {
      const kind = BUBBLE_KINDS.find(k => k === payload?.kind)
      if (!kind) return
      spawn(kind, typeof payload.text === 'string' && payload.text ? payload.text : undefined)
    })
    scheduleCoquetry()
  }

  function stop() {
    unlistenBubble?.()
    unlistenBubble = null
    clearCoquetryTimer()
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
