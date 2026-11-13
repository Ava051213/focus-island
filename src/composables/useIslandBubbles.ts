import { computed, ref, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useIslandBridge } from './useIslandBridge'
import { pickBubbleLine, type BubbleKind } from '../utils/bubbleTexts'

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

const BUBBLE_KINDS: BubbleKind[] = ['coquetry', 'idle', 'comfort', 'test']

const currentBubble = ref<IslandBubble | null>(null)
const bubblePhase = ref<'show' | 'pop'>('show')
let seq = 0
let showTimer: number | null = null
let popTimer: number | null = null
let recentLines: string[] = []
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

/** 吐一个泡泡；横幅在显示时泡泡让位，总开关关着不吐 */
export function showBubble(kind: BubbleKind, text?: string) {
  const { settings } = useSettings()
  const { notificationType } = useIslandBridge()
  if (!settings.value.bubbles.enabled) return
  if (notificationType.value !== null) return
  clearTimers()
  const line = text ?? pickBubbleLine(kind, recentLines)
  recentLines = [line, ...recentLines].slice(0, RECENT_MAX)
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

export function useIslandBubbles() {
  const { settings } = useSettings()
  const bubbleVisible = computed(() => currentBubble.value !== null)

  // 总开关关掉时立刻收掉正在飘的泡泡
  if (!installed) {
    installed = true
    watch(
      () => settings.value.bubbles.enabled,
      (on) => {
        if (!on) {
          clearTimers()
          currentBubble.value = null
        }
      },
    )
  }

  async function start() {
    if (unlistenBubble) return
    unlistenBubble = await listen<{ kind?: string; text?: string }>('island-bubble', ({ payload }) => {
      const kind = BUBBLE_KINDS.find(k => k === payload?.kind)
      if (!kind) return
      showBubble(kind, typeof payload.text === 'string' && payload.text ? payload.text : undefined)
    })
  }

  function stop() {
    unlistenBubble?.()
    unlistenBubble = null
    clearTimers()
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
