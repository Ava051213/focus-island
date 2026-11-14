<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDailyStats } from '../composables/useDailyStats'
import { useAchievements } from '../composables/useAchievements'
import { useEvents } from '../composables/useEvents'

type TimeRange = 'today' | 'week' | 'month' | 'all'

const emit = defineEmits<{ back: [] }>()

const {
  todayStat,
  weekStats,
  monthStats,
  allTimeStats,
  summarizeStats,
  getDateString,
  getStatsInRange,
  effectiveDailyStats,
} = useDailyStats()
const { starAchievements, streakAchievements, specialAchievements, state } = useAchievements()
const { upcoming, overdue } = useEvents()

const timeRange = ref<TimeRange>('today')

const timeRangeOptions: { value: TimeRange; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
]

const currentStats = computed(() => {
  switch (timeRange.value) {
    case 'today':
      return todayStat.value
    case 'week':
      return summarizeStats(weekStats.value)
    case 'month':
      return summarizeStats(monthStats.value)
    case 'all':
      return allTimeStats.value
  }
})

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}.${Math.round(mins / 6)}h` : `${hours}h`
}

/** GitHub 风格热力图：最近 26 周，一列一周、一行一个礼拜几，格子只保留色块 */
const HEATMAP_WEEKS = 26

interface HeatDay {
  date: string
  pomodoros: number
  intensity: number
  label: string
}

const heatmapDays = computed<HeatDay[]>(() => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const start = new Date(now)
  start.setDate(start.getDate() - (HEATMAP_WEEKS * 7 - 1))
  // 对齐到周日，保证每列是完整的一周
  start.setDate(start.getDate() - start.getDay())

  const statMap = new Map(effectiveDailyStats.value.map(s => [s.date, s.pomodoros]))
  const days: HeatDay[] = []
  const cursor = new Date(start)
  while (cursor <= now) {
    const pomodoros = statMap.get(getDateString(cursor)) ?? 0
    days.push({
      date: getDateString(cursor),
      pomodoros,
      intensity: pomodoros >= 24 ? 4 : pomodoros >= 12 ? 3 : pomodoros >= 6 ? 2 : pomodoros >= 1 ? 1 : 0,
      label: `${cursor.getMonth() + 1}-${cursor.getDate()}`,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
})

const hoveredDay = ref<HeatDay | null>(null)

const allAchievements = computed(() => [
  ...starAchievements.value,
  ...streakAchievements.value,
  ...specialAchievements.value,
])

const weekDays = ['日', '一', '二', '三', '四', '五', '六']

// 本周（周一起）和上周同期的番茄对比，外加专注天数和日均
const weeklyComparison = computed(() => {
  const now = new Date()
  const dayOffset = (now.getDay() + 6) % 7
  const thisStart = new Date(now)
  thisStart.setDate(thisStart.getDate() - dayOffset)
  thisStart.setHours(0, 0, 0, 0)
  const lastStart = new Date(thisStart)
  lastStart.setDate(lastStart.getDate() - 7)
  const lastEnd = new Date(lastStart)
  lastEnd.setDate(lastEnd.getDate() + dayOffset)
  lastEnd.setHours(23, 59, 59, 999)

  const thisStats = getStatsInRange(thisStart, now)
  const lastStats = getStatsInRange(lastStart, lastEnd)
  const thisPomodoros = thisStats.reduce((sum, stat) => sum + stat.pomodoros, 0)
  const lastPomodoros = lastStats.reduce((sum, stat) => sum + stat.pomodoros, 0)
  const focusDays = thisStats.filter(stat => stat.pomodoros > 0).length
  const diff = thisPomodoros - lastPomodoros

  let comparison = ''
  if (thisPomodoros === 0) comparison = '还没有记录'
  else if (lastPomodoros === 0) comparison = '上周同期还没开始'
  else if (diff > 0) comparison = `比上周同期多 ${diff} 个`
  else if (diff < 0) comparison = `比上周同期少 ${-diff} 个`
  else comparison = '和上周同期一样多'

  return {
    thisPomodoros,
    focusDays,
    average: (thisPomodoros / (dayOffset + 1)).toFixed(1),
    comparison,
  }
})

const pendingEventCount = computed(() => upcoming.value.length + overdue.value.length)

const weekTrend = computed(() => {
  const now = new Date()
  const result: { day: string; pomodoros: number; minutes: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = getDateString(d)
    const stats = weekStats.value.find(s => s.date === dateStr)
    result.push({
      day: weekDays[d.getDay()],
      pomodoros: stats?.pomodoros ?? 0,
      minutes: stats?.focusMinutes ?? 0,
    })
  }
  return result
})

const maxPomodoros = computed(() => Math.max(...weekTrend.value.map(d => d.pomodoros), 1))
</script>

<template>
  <div class="stats-page">
    <!-- Header -->
    <div class="page-header">
      <button class="back-btn" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h2 class="page-title">记录</h2>
      <div class="time-range-tabs">
        <button
          v-for="opt in timeRangeOptions"
          :key="opt.value"
          :class="['tab', { active: timeRange === opt.value }]"
          @click="timeRange = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-value">{{ currentStats.pomodoros }}</div>
        <div class="stat-label">番茄个数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ formatDuration(currentStats.focusMinutes) }}</div>
        <div class="stat-label">专注时长</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ pendingEventCount }}</div>
        <div class="stat-label">还没做的事</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ state.streakDays }}</div>
        <div class="stat-label">连着几天</div>
      </div>
    </div>

    <!-- Week Summary -->
    <div class="week-summary">
      <div class="week-summary-main">本周 {{ weeklyComparison.thisPomodoros }} 个番茄</div>
      <div class="week-summary-sub">
        {{ weeklyComparison.comparison }} · 专注 {{ weeklyComparison.focusDays }} 天，平均每天 {{ weeklyComparison.average }} 个
      </div>
    </div>

    <!-- Heatmap -->
    <div class="section">
      <div class="section-header">
        <span class="stats-label">专注日历</span>
        <span class="heatmap-range">最近半年</span>
      </div>
      <div class="heatmap">
        <div class="heatmap-weekdays">
          <span v-for="d in weekDays" :key="d" class="weekday">{{ d }}</span>
        </div>
        <div class="heatmap-grid">
          <div
            v-for="day in heatmapDays"
            :key="day.date"
            :class="['heat-cell', `intensity-${day.intensity}`]"
            :title="`${day.date} · ${day.pomodoros} 颗番茄`"
            :aria-label="`${day.date}，${day.pomodoros} 颗番茄`"
            :tabindex="day.pomodoros > 0 ? 0 : -1"
            @mouseenter="hoveredDay = day"
            @mouseleave="hoveredDay = null"
            @focus="hoveredDay = day"
            @blur="hoveredDay = null"
            @click="hoveredDay = hoveredDay?.date === day.date ? null : day"
          >
            <div v-if="hoveredDay?.date === day.date" class="cell-tooltip">
              {{ day.date.slice(5).replace('-', '月') }}日 · {{ day.pomodoros }} 颗番茄
            </div>
          </div>
        </div>
      </div>
      <div class="heatmap-legend">
        <span class="legend-item"><span class="legend-box intensity-0"></span>无</span>
        <span class="legend-item"><span class="legend-box intensity-1"></span>1-5</span>
        <span class="legend-item"><span class="legend-box intensity-2"></span>6-11</span>
        <span class="legend-item"><span class="legend-box intensity-3"></span>12-23</span>
        <span class="legend-item"><span class="legend-box intensity-4"></span>24+</span>
      </div>
    </div>

    <!-- Week Trend -->
    <div class="section">
      <div class="stats-label">本周概览</div>
      <div class="trend-chart">
        <div class="trend-bars">
          <div
            v-for="d in weekTrend"
            :key="d.day"
            class="trend-bar-wrapper"
          >
            <div
              class="trend-bar"
              :style="{ height: `${(d.pomodoros / maxPomodoros) * 100}%` }"
            >
              <span v-if="d.pomodoros > 0" class="bar-value">{{ d.pomodoros }}</span>
            </div>
            <span class="bar-label">{{ d.day }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Achievements -->
    <div class="section">
      <div class="stats-label">成就</div>
      <div class="achievement-row">
        <div
          v-for="a in allAchievements"
          :key="a.id"
          :class="['achievement-badge', { unlocked: a.unlockedAt }]"
          :title="`${a.description} · ${a.unlockedAt ? '已达成' : a.progress + '/' + a.target}`"
        >
          <div class="badge-icon">{{ a.icon }}</div>
          <div class="badge-name">{{ a.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.stats-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 4px;
  overflow-y: auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}




.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  flex: 1;
}

.time-range-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--radius-md);
  padding: 2px;
}

.tab {
  padding: 6px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  color: rgba(255, 255, 255, 0.7);
}

.tab.active {
  background: var(--focus-color);
  color: #fff;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg);
  padding: 14px 10px;
  text-align: center;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.week-summary {
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--focus-color) 7%, rgba(255, 255, 255, 0.03));
  border: 1px solid color-mix(in srgb, var(--focus-color) 15%, rgba(255, 255, 255, 0.05));
}

.week-summary-main {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.week-summary-sub {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.45);
}

.section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-lg);
  padding: 14px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.stats-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.heatmap-range {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.heatmap {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 2px;
  flex-shrink: 0;
}

.weekday {
  width: 12px;
  font-size: 9px;
  line-height: 11px;
  color: rgba(255, 255, 255, 0.28);
  text-align: center;
}

.heatmap-grid {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  grid-auto-flow: column;
  grid-auto-columns: 11px;
  gap: 2px;
}

.heat-cell {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  position: relative;
}

.heat-cell:hover {
  outline: 1px solid rgba(255, 255, 255, 0.35);
  z-index: 1;
}

.heat-cell:focus-visible {
  outline: 2px solid var(--focus-color);
  outline-offset: 2px;
  z-index: 1;
}

.heat-cell.intensity-0 {
  background: rgba(255, 255, 255, 0.03);
}

.heat-cell.intensity-1 {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
}

.heat-cell.intensity-2 {
  background: color-mix(in srgb, var(--focus-color) 42%, transparent);
}

.heat-cell.intensity-3 {
  background: color-mix(in srgb, var(--focus-color) 68%, transparent);
}

.heat-cell.intensity-4 {
  background: var(--focus-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--focus-color) 45%, transparent);
}

.cell-tooltip {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 35, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-sm);
  padding: 3px 6px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  justify-content: flex-end;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.legend-box {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-box.intensity-0 {
  background: rgba(255, 255, 255, 0.03);
}

.legend-box.intensity-1 {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
}

.legend-box.intensity-2 {
  background: color-mix(in srgb, var(--focus-color) 42%, transparent);
}

.legend-box.intensity-3 {
  background: color-mix(in srgb, var(--focus-color) 68%, transparent);
}

.legend-box.intensity-4 {
  background: var(--focus-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--focus-color) 45%, transparent);
}

.trend-chart {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.trend-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 68px;
  gap: 6px;
  padding-top: 8px;
}

.trend-bar-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.trend-bar {
  width: 100%;
  max-width: 24px;
  background: var(--focus-color);
  border-radius: var(--radius-sm) 4px 2px 2px;
  margin-top: auto;
  position: relative;
  min-height: 4px;
  transition: height 0.3s ease;
}

.bar-value {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
}

.bar-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 6px;
}

.achievement-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.achievement-row::-webkit-scrollbar {
  height: 4px;
}

.achievement-row::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.achievement-badge {
  flex: 0 0 auto;
  width: 58px;
  padding: 6px 4px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  text-align: center;
  transition: all 0.2s;
}

.achievement-badge.unlocked {
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 30%, transparent);
}

.badge-icon {
  font-size: 14px;
  margin-bottom: 2px;
  filter: grayscale(1) opacity(0.4);
}

.achievement-badge.unlocked .badge-icon {
  filter: none;
  color: var(--focus-color);
}

.badge-name {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.achievement-badge.unlocked .badge-name {
  color: rgba(255, 255, 255, 0.9);
}

/* Custom scrollbar */
.stats-page::-webkit-scrollbar {
  width: 4px;
}
.stats-page::-webkit-scrollbar-track {
  background: transparent;
}
.stats-page::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}
</style>
