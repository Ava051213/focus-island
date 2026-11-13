import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useIslandBridge } from './useIslandBridge'
import { useIslandState } from './useIslandState'
import { BUBBLE_TONE_MS, pickBubbleLine, type BubbleKind } from '../utils/bubbleTexts'

/**
 * 岛吐泡泡的 main 侧队列（模块级单例，只在 main 窗口装载）。
 *
 * 同时最多一个泡泡：新的来了就顶掉旧的。触发源有两类——
 * - panel 推过来的 `island-bubble` 事件（哄人这类，panel 才知道的事）
 * - main 本地（闲置喊话、撒娇定时器），直接调 showBubble
 */

export interface IslandBubble {
  id: number
  kind: BubbleKind
  text: string
}

/** 泡泡停留时长与破裂动画时长（毫秒） */
const BUBBLE_SHOW_MS = 2600
const BUBBLE_POP_MS = 260
/** 选句时避开的最近说过条数 */
const RECENT_MAX = 6
/** 闲置喊话的最小间隔：活动-闲置反复横跳时别连环喊 */
const IDLE_CALL_MIN_GAP_MS = 10 * 60 * 1000

const BUBBLE_KINDS: BubbleKind[] = ['coquetry', 'idle', 'comfort', 'test']

const currentBubble = ref<IslandBubble | null>(null)
const bubblePhase = ref<'show' | 'pop'>('show')
let seq = 0
let showTimer: number | null = null
let popTimer: number | null = null
let coquetryTimer: number | null = null
let recentLines: string[] = []
let lastBubbleAt = 0
let unlistenBubble: UnlistenFn | null = null
let installed = false

function clearTimers() {
  if (showTimer !== null) {
    window.clearTimeout(showTimer)
    showTimer = null
  }
  if (popTimer !== null) {
    window.clearTimeout(popTimer)
    popTimer = null
  }
}

function clearCoquetryTimer() {
  if (coquetryTimer !== null) {
    window.clearTimeout(coquetryTimer)
    coquetryTimer = null
  }
}

/** 档位对应的基础间隔，±30% 抖动让它不像机械整点 */
function toneIntervalMs(tone: 'quiet' | 'normal' | 'lively'): number {
  return BUBBLE_TONE_MS[tone] * (0.7 + Math.random() * 0.6)
}

/** 撒娇定时：到点先检查场合（面板开着不打扰），吐完排下一个 */
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
  showBubble('coquetry')
  scheduleCoquetry()
}

/** 吐一个泡泡；横幅在显示时泡泡让位，总开关与类型开关把关 */
export function showBubble(kind: BubbleKind, text?: string) {
  const { settings } = useSettings()
  const { notificationType } = useIslandBridge()
  const bubbles = settings.value.bubbles
  if (!bubbles.enabled) return
  if (kind === 'coquetry' && !bubbles.coquetry) return
  if (kind === 'idle' && !bubbles.idleCall) return
  if (kind === 'comfort' && !bubbles.comfort) return
  if (notificationType.value !== null) return
  clearTimers()
  const line = text ?? pickBubbleLine(kind, recentLines)
  recentLines = [line, ...recentLines].slice(0, RECENT_MAX)
  lastBubbleAt = Date.now()
  currentBubble.value = { id: ++seq, kind, text: line }
  bubblePhase.value = 'show'
  showTimer = window.setTimeout(() => {
    showTimer = null
    bubblePhase.value = 'pop'
    popTimer = window.setTimeout(() => {
      popTimer = null
      currentBubble.value = null
    }, BUBBLE_POP_MS)
  }, BUBBLE_SHOW_MS)
}

/** 闲置喊话：进 alert 时喊一次，受开关与最小间隔约束 */
function maybeIdleCall() {
  const { settings } = useSettings()
  if (!settings.value.bubbles.idleCall) return
  if (Date.now() - lastBubbleAt < IDLE_CALL_MIN_GAP_MS) return
  showBubble('idle')
}

export function useIslandBubbles() {
  const { settings } = useSettings()
  const { state } = useIslandState()
  const bubbleVisible = computed(() => currentBubble.value !== null)

  // 总开关关掉时立刻收掉正在飘的泡泡；进闲置时喊一句；档位/开关变化重排撒娇节奏
  if (!installed) {
    installed = true
    watch(
      () => settings.value.bubbles.enabled,
      (on) => {
        if (!on) {
          clearTimers()
          clearCoquetryTimer()
          currentBubble.value = null
        }
      },
    )
    watch(state, (s, prev) => {
      if (s !== 'alert' || prev === 'alert') return
      maybeIdleCall()
    })
    watch(
      () => [settings.value.bubbles.enabled, settings.value.bubbles.coquetry, settings.value.bubbles.tone] as const,
      () => scheduleCoquetry(),
    )
  }

  async function start() {
    if (unlistenBubble) return
    unlistenBubble = await listen<{ kind?: string; text?: string }>('island-bubble', ({ payload }) => {
      const kind = BUBBLE_KINDS.find(k => k === payload?.kind)
      if (!kind) return
      showBubble(kind, typeof payload.text === 'string' && payload.text ? payload.text : undefined)
    })
    scheduleCoquetry()
  }

  function stop() {
    unlistenBubble?.()
    unlistenBubble = null
    clearTimers()
    clearCoquetryTimer()
    currentBubble.value = null
  }

  return {
    currentBubble,
    bubblePhase,
    bubbleVisible,
    start,
    stop,
  }
}
