import { watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettings } from '../composables/useSettings'
import { BUBBLE_TONE_MS, pickBubbleLine, type BubbleKind } from '../utils/bubbleTexts'

/**
 * 泡泡的决策端（跑在 main 窗口）：类型闸门、文案挑选、密度定时、
 * 闲置喊话节流都在这里把关，把关通过后推给 Rust（push_bubble）。
 * Rust 负责懒创建 overlay 窗口并把泡泡递给渲染端——本模块不碰窗口。
 */

// 闲置喊话的最小间隔：活动-闲置反复横跳时别连环喊
const IDLE_CALL_MIN_GAP_MS = 10 * 60 * 1000

const BUBBLE_KINDS: BubbleKind[] = ['coquetry', 'idle', 'comfort', 'test']

let recentLines: string[] = []
let lastBubbleAt = 0
let coquetryTimer: number | null = null
let unlistenBubble: UnlistenFn | null = null
let installed = false

function clearCoquetryTimer() {
  if (coquetryTimer !== null) {
    window.clearTimeout(coquetryTimer)
    coquetryTimer = null
  }
}

/** 类型开关与总开关把关；闲置喊话另有最小间隔 */
function spawnGate(kind: BubbleKind): boolean {
  const { settings } = useSettings()
  const b = settings.value.bubbles
  if (!b.enabled) return false
  if (kind === 'coquetry' && !b.coquetry) return false
  if (kind === 'idle' && !b.idleCall) return false
  if (kind === 'comfort' && !b.comfort) return false
  if (kind === 'idle' && Date.now() - lastBubbleAt < IDLE_CALL_MIN_GAP_MS) return false
  return true
}

function spawn(kind: BubbleKind, text?: string) {
  if (!spawnGate(kind)) return
  const line = text ?? pickBubbleLine(kind, recentLines)
  recentLines = [line, ...recentLines].slice(0, 6)
  lastBubbleAt = Date.now()
  void invoke('push_bubble', { kind, text: line }).catch(() => {})
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

export function useBubbleSpawner() {
  const { settings } = useSettings()

  if (!installed) {
    installed = true
    // 档位/开关变化重排撒娇节奏
    watch(
      () => [settings.value.bubbles.enabled, settings.value.bubbles.coquetry, settings.value.bubbles.tone] as const,
      () => {
        if (!settings.value.bubbles.enabled || !settings.value.bubbles.coquetry) {
          clearCoquetryTimer()
        } else {
          scheduleCoquetry()
        }
      },
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
  }

  return { start, stop }
}
