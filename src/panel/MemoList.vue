<script setup lang="ts">
import { ref } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import { useTimerBridge } from '../composables/useTimerBridge'
import MemoCategoryTag from './MemoCategoryTag.vue'

const props = defineProps<{
  memos: Memo[]
  searchQuery?: string
}>()

const emit = defineEmits<{
  edit: [memo: Memo]
  newMemo: []
}>()

const {
  completedMemos,
  togglePin,
  deleteMemo,
  completeMemo,
  restoreMemo,
  moveMemo,
  getDisplayTitle,
} = useMemos()
const { start } = useTimerBridge()

/** 从列表里直接开一轮专注，和首页的播放键是同一套逻辑 */
function handleStartFocus(memo: Memo, event: Event) {
  event.stopPropagation()
  start(memo.id, getDisplayTitle(memo))
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (dateStart.getTime() === today.getTime()) {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `今天 ${hours}:${minutes}`
  }

  if (dateStart.getTime() === yesterday.getTime()) {
    return '昨天'
  }

  const weekAgo = today.getTime() - 7 * 24 * 60 * 60 * 1000
  if (dateStart.getTime() > weekAgo) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return `星期${weekdays[date.getDay()]}`
  }

  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}-${day}`
}

function formatCompletedAt(memo: Memo): string {
  return memo.completedAt ? formatTime(memo.completedAt) : ''
}

function getContentPreview(content: string, maxLength: number = 40): string {
  const plainText = content.replace(/<[^>]+>/g, '').trim()
  if (plainText.length === 0) return '还没写什么呢～'
  if (plainText.length <= maxLength) return plainText
  return plainText.slice(0, maxLength) + '...'
}

// Toggle pin
function handleTogglePin(memo: Memo, event: Event) {
  event.stopPropagation()
  togglePin(memo.id)
}

// Delete confirmation
const showDeleteConfirm = ref(false)
const pendingDeleteMemoId = ref<string | null>(null)

function handleDeleteMemo(memo: Memo, event: Event) {
  event.stopPropagation()
  pendingDeleteMemoId.value = memo.id
  showDeleteConfirm.value = true
}

function confirmDeleteMemo() {
  if (pendingDeleteMemoId.value) {
    deleteMemo(pendingDeleteMemoId.value)
  }
  showDeleteConfirm.value = false
  pendingDeleteMemoId.value = null
}

function cancelDeleteMemo() {
  showDeleteConfirm.value = false
  pendingDeleteMemoId.value = null
}

// 完成：先播淡出动画，再从进行中列表移除，并给几秒撤销机会
const completingId = ref<string | null>(null)
const undoState = ref<{ id: string; title: string } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | null = null

function handleCompleteMemo(memo: Memo, event: Event) {
  event.stopPropagation()
  if (completingId.value) return
  const title = getDisplayTitle(memo)
  completingId.value = memo.id
  setTimeout(() => {
    completeMemo(memo.id)
    completingId.value = null
    undoState.value = { id: memo.id, title }
    if (undoTimer) clearTimeout(undoTimer)
    undoTimer = setTimeout(() => {
      undoState.value = null
    }, 5000)
  }, 200)
}

function handleUndoComplete() {
  if (!undoState.value) return
  restoreMemo(undoState.value.id)
  undoState.value = null
  if (undoTimer) clearTimeout(undoTimer)
}

// 已完成归档
const showArchive = ref(false)

function handleRestoreMemo(memo: Memo) {
  restoreMemo(memo.id)
}

// 拖动排序：Tauri 的 WebView2 会拦截 HTML5 拖放，这里改用指针事件自己算
const memoListRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dropTarget = ref<{ id: string; after: boolean } | null>(null)
let suppressClickUntil = 0

function updateDropTarget(clientY: number, moving: Memo) {
  const container = memoListRef.value
  if (!container) return
  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-memo-id]'))
    .map(el => ({ id: el.dataset.memoId ?? '', rect: el.getBoundingClientRect() }))
    .filter(item => {
      if (item.id === moving.id) return false
      const memo = props.memos.find(m => m.id === item.id)
      // 置顶和普通是两组，跨组拖动直接忽略
      return !!memo && memo.isPinned === moving.isPinned
    })

  let next: { id: string; after: boolean } | null = null
  for (const item of items) {
    if (clientY < item.rect.top + item.rect.height / 2) {
      next = { id: item.id, after: false }
      break
    }
    next = { id: item.id, after: true }
  }
  if (next?.id === dropTarget.value?.id && next?.after === dropTarget.value?.after) return
  dropTarget.value = next
}

function handleItemPointerDown(memo: Memo, event: PointerEvent) {
  if (event.button !== 0) return
  if ((event.target as HTMLElement)?.closest('button')) return

  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId
  let active = false

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.documentElement.classList.remove('memo-dragging')
    draggingId.value = null
    dropTarget.value = null
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (!active) {
      const dy = e.clientY - startY
      const dx = e.clientX - startX
      // 竖直移动超过 8px 才算拖动，避免和点击编辑抢
      if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(dx)) return
      active = true
      draggingId.value = memo.id
      document.documentElement.classList.add('memo-dragging')
    }
    e.preventDefault()
    updateDropTarget(e.clientY, memo)
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const movingId = draggingId.value
    const target = dropTarget.value
    if (active && movingId && target && moveMemo(movingId, target.id, target.after)) {
      suppressClickUntil = Date.now() + 220
    }
    cleanup()
  }

  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function handleItemClick(memo: Memo) {
  if (Date.now() < suppressClickUntil) return
  emit('edit', memo)
}
</script>

<template>
  <div ref="memoListRef" class="memo-list">
    <div v-if="completedMemos.length > 0 || memos.length > 0" class="memo-list-head">
      <button v-if="completedMemos.length > 0" class="archive-entry" @click="showArchive = true">
        已完成 {{ completedMemos.length }} 条
      </button>
      <span v-else class="memo-list-head-spacer"></span>
      <span v-if="memos.length > 0" class="memo-drag-hint">按住条目可拖动排序</span>
    </div>

    <div
      v-for="memo in memos"
      :key="memo.id"
      class="memo-item"
      :class="{
        'is-pinned': memo.isPinned,
        'is-completing': completingId === memo.id,
        'is-dragging': draggingId === memo.id,
        'drop-before': dropTarget?.id === memo.id && !dropTarget.after,
        'drop-after': dropTarget?.id === memo.id && dropTarget.after,
      }"
      :data-memo-id="memo.id"
      @pointerdown="handleItemPointerDown(memo, $event)"
      @click="handleItemClick(memo)"
    >
      <div class="memo-item-header">
        <button
          class="memo-check-btn"
          @click="(e) => handleCompleteMemo(memo, e)"
          title="做完了，收起来"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
            <polyline points="4 12 9 17 20 6"/>
          </svg>
        </button>
        <span class="memo-item-title">{{ getDisplayTitle(memo) }}</span>
        <button
          class="memo-play-btn"
          @click="(e) => handleStartFocus(memo, e)"
          title="陪我专注一会儿呀"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
        </button>
        <div class="memo-item-actions">
          <button
            class="action-btn pin-btn"
            :class="{ 'is-pinned': memo.isPinned }"
            @click="(e) => handleTogglePin(memo, e)"
            :title="memo.isPinned ? '不用钉着了' : '钉在最上面'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </button>
          <button
            class="action-btn delete-btn"
            @click="(e) => handleDeleteMemo(memo, e)"
            title="不要这条了"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="memo-item-meta">
        <MemoCategoryTag :category-id="memo.categoryId" />
        <span class="memo-item-time">{{ formatTime(memo.updatedAt) }}</span>
      </div>
      <div class="memo-item-preview">{{ getContentPreview(memo.content) }}</div>
    </div>

    <!-- Empty State -->
    <div v-if="memos.length === 0" class="memo-empty-state">
      <svg v-if="searchQuery" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <div v-else class="empty-icon">📝</div>
      <div class="empty-text">{{ searchQuery ? '翻不到呀，换个词试试？' : '还没有小记呢' }}</div>
      <button v-if="!searchQuery" class="empty-action-btn" @click="emit('newMemo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        写一条嘛
      </button>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="delete-dialog-overlay" @click="cancelDeleteMemo">
      <div class="delete-dialog" @click.stop>
        <div class="delete-dialog-title">🗑️ 真的要丢掉这条小记吗</div>
        <div class="delete-dialog-content">丢掉就捡不回来啦，再想想好不好～</div>
        <div class="delete-dialog-actions">
          <button class="dialog-btn cancel-btn" @click="cancelDeleteMemo">再想想</button>
          <button class="dialog-btn confirm-btn" @click="confirmDeleteMemo">丢掉吧</button>
        </div>
      </div>
    </div>

    <!-- 完成后的撤销条 -->
    <div v-if="undoState" class="undo-toast">
      <span class="undo-text">做完「{{ undoState.title }}」啦</span>
      <button class="undo-btn" @click="handleUndoComplete">撤销</button>
    </div>

    <!-- 已完成归档 -->
    <div v-if="showArchive" class="delete-dialog-overlay" @click="showArchive = false">
      <div class="archive-dialog" @click.stop>
        <div class="archive-head">
          <span class="archive-title">已完成的小记</span>
          <span class="archive-count">{{ completedMemos.length }} 条</span>
        </div>
        <div v-if="completedMemos.length > 0" class="archive-list">
          <div v-for="memo in completedMemos" :key="memo.id" class="archive-item">
            <div class="archive-copy">
              <span class="archive-item-title">{{ getDisplayTitle(memo) }}</span>
              <span class="archive-item-time">{{ formatCompletedAt(memo) }} 完成</span>
            </div>
            <button class="archive-restore-btn" @click="handleRestoreMemo(memo)">放回来</button>
          </div>
        </div>
        <div v-else class="archive-empty">还没有完成的小记呀</div>
        <button class="archive-close-btn" @click="showArchive = false">关上</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.memo-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.memo-list::-webkit-scrollbar {
  width: 6px;
}

.memo-list::-webkit-scrollbar-track {
  background: transparent;
}

.memo-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

.memo-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 7px;
  min-height: 18px;
}

.archive-entry {
  padding: 0;
  background: none;
  border: none;
  color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.archive-entry:hover {
  color: var(--focus-color);
  text-decoration: underline;
}

.memo-drag-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.22);
}

.memo-item {
  position: relative;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 0.2s;
}

.memo-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.memo-item.is-pinned {
  background: color-mix(in srgb, var(--focus-color) 8%, rgba(255, 255, 255, 0.04));
  border-color: color-mix(in srgb, var(--focus-color) 25%, rgba(255, 255, 255, 0.1));
}

.memo-item.is-pinned:hover {
  background: color-mix(in srgb, var(--focus-color) 12%, rgba(255, 255, 255, 0.08));
  border-color: color-mix(in srgb, var(--focus-color) 35%, rgba(255, 255, 255, 0.15));
}

.memo-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.memo-item-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.memo-check-btn {
  flex-shrink: 0;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  background: transparent;
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.memo-check-btn:hover {
  border-color: color-mix(in srgb, var(--focus-color) 60%, transparent);
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
  color: color-mix(in srgb, var(--focus-color) 80%, transparent);
}

.memo-item.is-completing {
  opacity: 0;
  transform: translateX(10px) scale(0.98);
  transition: all 0.2s ease;
}

.memo-item.is-dragging {
  opacity: 0.4;
}

:global(html.memo-dragging) {
  user-select: none;
  cursor: grabbing;
}

.memo-item.drop-before::before,
.memo-item.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--focus-color);
}

.memo-item.drop-before::before {
  top: -5px;
}

.memo-item.drop-after::after {
  bottom: -5px;
}

.memo-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

/* 播放键常驻可见：列表里最常用的动作不该藏在悬停后面 */
.memo-play-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 38%, transparent);
  color: var(--focus-color);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.memo-play-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 32%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 55%, transparent);
}

.memo-item:hover .memo-item-actions,
.memo-item.is-pinned .memo-item-actions {
  opacity: 1;
}

.action-btn {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
}

.pin-btn.is-pinned {
  color: var(--focus-color);
}

.pin-btn.is-pinned:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.25);
  color: #f87171;
}

.delete-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.25);
  color: #f87171;
}

.memo-item-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.memo-item-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.memo-item-preview {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.memo-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 16px;
}

.empty-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.empty-action-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
  transform: scale(1.02);
}

.undo-toast {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 9px;
  background: rgba(30, 30, 34, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  z-index: 1100;
  white-space: nowrap;
}

.undo-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

.undo-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--focus-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.undo-btn:hover {
  text-decoration: underline;
}

/* 已完成归档 */
.archive-dialog {
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 18px 20px;
  width: 320px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.archive-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}

.archive-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.archive-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.archive-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  margin-bottom: 14px;
}

.archive-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.archive-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.archive-item-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-item-time {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.32);
}

.archive-restore-btn {
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--focus-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 32%, transparent);
  color: var(--focus-color);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.archive-restore-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 24%, transparent);
}

.archive-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

.archive-close-btn {
  align-self: flex-end;
  padding: 6px 14px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.archive-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* Delete Confirmation Dialog */
.delete-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.delete-dialog {
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 20px 24px;
  min-width: 280px;
  max-width: 320px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.delete-dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 12px;
}

.delete-dialog-content {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
  margin-bottom: 20px;
}

.delete-dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.cancel-btn {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.confirm-btn {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.confirm-btn:hover {
  background: rgba(248, 113, 113, 0.25);
  border-color: rgba(248, 113, 113, 0.5);
}
</style>
