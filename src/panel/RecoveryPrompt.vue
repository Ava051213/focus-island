<script setup lang="ts">
import { computed } from 'vue'
import type { RecoveryPlanActive, RecoveryPlanExpired } from '../timer/snapshot'

const props = defineProps<{ plan: RecoveryPlanActive | RecoveryPlanExpired }>()
const emit = defineEmits<{ resolve: [decision: 'continue' | 'discard'] }>()

const message = computed(() => {
  if (props.plan.kind === 'active') {
    return props.plan.phase === 'focus'
      ? '有一轮专注还在进行中，要继续吗？'
      : '休息还没结束，要继续吗？'
  }
  return props.plan.phase === 'focus'
    ? '上一轮专注已经到时间，要怎么处理？'
    : '上一轮休息已经结束。'
})

const continueLabel = computed(() => {
  if (props.plan.kind === 'expired') {
    return props.plan.phase === 'focus' ? '记为完成' : '结束休息'
  }
  return '继续'
})

const discardLabel = computed(() => props.plan.phase === 'focus' ? '放弃并记为中断' : '放弃')
</script>

<template>
  <div class="recovery-prompt">
    <span class="recovery-text">{{ message }}</span>
    <div class="recovery-actions">
      <button class="recovery-btn recovery-primary" @click="emit('resolve', 'continue')">
        {{ continueLabel }}
      </button>
      <button class="recovery-btn" @click="emit('resolve', 'discard')">
        {{ discardLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.recovery-prompt {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(232, 93, 58, 0.1);
  border-bottom: 1px solid rgba(232, 93, 58, 0.24);
}

.recovery-text {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.82);
}

.recovery-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.recovery-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.recovery-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

.recovery-primary {
  border-color: rgba(232, 93, 58, 0.45);
  color: var(--focus-color);
}

.recovery-primary:hover {
  background: color-mix(in srgb, var(--focus-color) 14%, transparent);
}
</style>
