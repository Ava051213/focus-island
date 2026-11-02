<script setup lang="ts">
import { useWeeklyGoals, type WeeklyGoal } from '../composables/useWeeklyGoals'

const props = defineProps<{ compact?: boolean }>()

const { goals, doneCount, allDone } = useWeeklyGoals()

function percent(goal: WeeklyGoal): number {
  if (goal.target <= 0) return 100
  return Math.min(100, Math.round((goal.progress / goal.target) * 100))
}

function hint(goal: WeeklyGoal): string {
  if (goal.done) return `${goal.label}这周已经完成啦`
  return `还差 ${goal.target - goal.progress} ${goal.unit}${goal.label}`
}
</script>

<template>
  <!-- 首页紧凑条 -->
  <div v-if="props.compact" class="weekly-strip">
    <div class="weekly-strip-head">
      <span class="weekly-strip-title">本周</span>
      <span class="weekly-strip-count">{{ doneCount }}/{{ goals.length }}</span>
    </div>
    <div class="weekly-strip-goals">
      <div
        v-for="goal in goals"
        :key="goal.id"
        class="weekly-pill"
        :class="{ done: goal.done }"
        :title="hint(goal)"
      >
        <span class="weekly-pill-label">{{ goal.label }}</span>
        <span class="weekly-pill-value">{{ goal.progress }}/{{ goal.target }}</span>
        <span v-if="goal.done" class="weekly-pill-check">✓</span>
      </div>
    </div>
  </div>

  <!-- 记录页详细卡 -->
  <div v-else class="weekly-card">
    <div class="weekly-card-head">
      <span class="weekly-card-title">本周目标</span>
      <span class="weekly-card-note">{{ allDone ? '都完成啦' : `${doneCount}/${goals.length} 完成` }}</span>
    </div>
    <div v-for="goal in goals" :key="goal.id" class="weekly-goal-row">
      <div class="weekly-goal-copy">
        <span class="weekly-goal-label">{{ goal.label }}</span>
        <span class="weekly-goal-value">{{ goal.progress }}/{{ goal.target }}{{ goal.unit }}</span>
      </div>
      <div class="weekly-goal-track">
        <div
          class="weekly-goal-fill"
          :class="{ done: goal.done }"
          :style="{ width: percent(goal) + '%' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

/* 首页紧凑版 */
.weekly-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--focus-color) 6%, rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.weekly-strip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.weekly-strip-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.weekly-strip-count {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  font-variant-numeric: tabular-nums;
}

.weekly-strip-goals {
  display: flex;
  gap: 6px;
}

.weekly-pill {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 5px 7px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
}

.weekly-pill.done {
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 32%, transparent);
}

.weekly-pill-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.weekly-pill.done .weekly-pill-label {
  color: color-mix(in srgb, var(--focus-color) 75%, rgba(255, 255, 255, 0.3));
}

.weekly-pill-value {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weekly-pill.done .weekly-pill-value {
  color: var(--focus-color);
}

.weekly-pill-check {
  font-size: 10px;
  color: var(--focus-color);
  font-weight: 700;
}

/* 记录页详细版 */
.weekly-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.weekly-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.weekly-card-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.weekly-card-note {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.weekly-goal-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.weekly-goal-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.weekly-goal-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
}

.weekly-goal-value {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
}

.weekly-goal-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.weekly-goal-fill {
  height: 100%;
  border-radius: 2px;
  background: color-mix(in srgb, var(--focus-color) 55%, rgba(255, 255, 255, 0.2));
  transition: width 0.3s ease;
}

.weekly-goal-fill.done {
  background: var(--focus-color);
}
</style>
