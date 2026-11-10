<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTimer } from '../composables/useTimer'

const props = defineProps<{ interactive?: boolean }>()
const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'skip'): void
}>()

const { displayTime, phase, activeTaskTitle, running } = useTimer()

// 休息阶段轮换小提示，只换文字，不增加操作
const BREAK_TIPS = [
  '喝口水呀～',
  '伸个懒腰～',
  '闭眼三十秒～',
  '看看远处～',
  '转转眼珠～',
]
const BREAK_TIP_INTERVAL_MS = 15_000

const breakTipIndex = ref(0)
let breakTipTimer: ReturnType<typeof setInterval> | null = null

function stopBreakTips() {
  if (breakTipTimer !== null) {
    clearInterval(breakTipTimer)
    breakTipTimer = null
  }
}

function startBreakTips() {
  stopBreakTips()
  breakTipIndex.value = 0
  breakTipTimer = setInterval(() => {
    breakTipIndex.value = (breakTipIndex.value + 1) % BREAK_TIPS.length
  }, BREAK_TIP_INTERVAL_MS)
}

watch(phase, (next) => {
  if (next === 'break') startBreakTips()
  else stopBreakTips()
})

onMounted(() => {
  if (phase.value === 'break') startBreakTips()
})

onUnmounted(stopBreakTips)

const resolvedTitle = computed(() => {
  if (phase.value === 'break') {
    return BREAK_TIPS[breakTipIndex.value % BREAK_TIPS.length]
  }
  return activeTaskTitle.value ?? null
})

const phaseColor = computed(() =>
  phase.value === 'focus' ? 'var(--focus-color)' : 'var(--break-color)'
)
</script>

<template>
  <div class="capsule-focus flex items-center justify-between w-full h-full px-4 gap-3">
    <!-- Phase indicator dot -->
    <div
      class="shrink-0 w-2 h-2 rounded-full"
      :class="running ? 'animate-pulse' : ''"
      :style="{ backgroundColor: phaseColor, width: `calc(8px * var(--island-scale, 1))`, height: `calc(8px * var(--island-scale, 1))` }"
    />

    <!-- Task name -->
    <div class="flex-1 min-w-0">
      <span
        class="text-white/90 font-medium truncate block"
        :style="{ fontSize: `calc(12px * var(--island-scale, 1))` }"
      >{{ resolvedTitle ?? (phase === 'break' ? '歇一会儿呀' : '专注中呀') }}</span>
    </div>

    <!-- Countdown -->
    <div class="shrink-0 flex items-center gap-1.5">
      <span :style="{ color: phaseColor, fontSize: `calc(14px * var(--island-scale, 1))` }" class="font-mono font-bold tabular-nums">
        {{ displayTime }}
      </span>
      <span
        v-if="!props.interactive"
        class="text-white/20"
        :style="{ fontSize: `calc(10px * var(--island-scale, 1))` }"
      >
        {{ running ? '' : '⏸' }}
      </span>
    </div>

    <!-- 鼠标悬停时浮出的快捷操作：暂停/继续、跳过当前阶段 -->
    <div v-if="props.interactive" class="island-actions">
      <button
        class="island-action-btn"
        type="button"
        :title="running ? '暂停' : '继续'"
        :aria-label="running ? '暂停' : '继续'"
        @pointerdown.stop
        @click.stop="emit('toggle')"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <template v-if="running">
            <rect x="2.5" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
            <rect x="7.1" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
          </template>
          <path v-else d="M3.5 2.2 9.6 6 3.5 9.8Z" fill="currentColor" />
        </svg>
      </button>
      <button
        class="island-action-btn"
        type="button"
        title="跳过当前阶段"
        aria-label="跳过当前阶段"
        @pointerdown.stop
        @click.stop="emit('skip')"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2.5 6.2 6 2 9.5Z" fill="currentColor" />
          <path d="M6 2.5 10.2 6 6 9.5Z" fill="currentColor" />
          <rect x="10.6" y="2.2" width="1.2" height="7.6" rx="0.6" fill="currentColor" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.island-actions {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--island-scale, 1));
  flex-shrink: 0;
}

.island-action-btn {
  display: grid;
  place-items: center;
  width: calc(20px * var(--island-scale, 1));
  height: calc(20px * var(--island-scale, 1));
  border: none;
  border-radius: calc(6px * var(--island-scale, 1));
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.island-action-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.island-action-btn svg {
  width: calc(10px * var(--island-scale, 1));
  height: calc(10px * var(--island-scale, 1));
  display: block;
}
</style>
