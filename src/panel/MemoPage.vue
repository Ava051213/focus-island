<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import MemoEditor from './MemoEditor.vue'
import MemoList from './MemoList.vue'
import MemoCategoryDialog from './MemoCategoryDialog.vue'
import MemoCategoryDropdown from './MemoCategoryDropdown.vue'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{
  back: []
}>()

const {
  categories,
  currentCategoryId,
  filteredMemos,
  memoCount,
  addMemo,
  updateMemo,
  deleteMemo,
} = useMemos()

// View state
const view = ref<'list' | 'edit'>('list')
const editingMemo = ref<Memo | null>(null)
const showCategoryDialog = ref(false)

// Cache plain-text content for search (avoid repeated regex on every keystroke).
// Keep the source content alongside: editing a memo keeps its id, so compare by
// content identity to invalidate the entry instead of searching stale text.
const plainTextCache = new Map<string, { source: string; text: string }>()
function getPlainContent(memo: Memo): string {
  const cached = plainTextCache.get(memo.id)
  if (cached && cached.source === memo.content) return cached.text
  const text = memo.content.replace(/<[^>]+>/g, '').trim().toLowerCase()
  plainTextCache.set(memo.id, { source: memo.content, text })
  return text
}

// Purge entries for memos no longer in the list (memory hygiene only)
const filteredMemosIds = computed(() => new Set(filteredMemos.value.map(m => m.id)))
watch(filteredMemosIds, (ids) => {
  for (const key of plainTextCache.keys()) {
    if (!ids.has(key)) plainTextCache.delete(key)
  }
})

// Search matching
function memoMatchesQuery(memo: Memo, query: string): boolean {
  if (!query) return true
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (memo.title.toLowerCase().includes(q)) return true
  if (getPlainContent(memo).includes(q)) return true
  return false
}

const displayMemos = computed<Memo[]>(() => {
  const q = props.searchQuery ?? ''
  if (!q.trim()) return filteredMemos.value
  return filteredMemos.value.filter(m => memoMatchesQuery(m, q))
})

// Create new memo
function handleNewMemo() {
  const memo = addMemo(currentCategoryId.value)
  editingMemo.value = memo
  view.value = 'edit'
}

// Edit existing memo
function handleEditMemo(memo: Memo) {
  editingMemo.value = memo
  view.value = 'edit'
}

// Handle memo update from editor
function handleMemoUpdate(patch: Partial<Pick<Memo, 'title' | 'content' | 'categoryId' | 'isPinned'>>) {
  if (editingMemo.value) {
    updateMemo(editingMemo.value.id, patch)
  }
}

// Handle memo delete from editor
function handleMemoDelete() {
  if (editingMemo.value) {
    deleteMemo(editingMemo.value.id)
    view.value = 'list'
    editingMemo.value = null
  }
}

// Back to list from editor
function handleBackToList(isEmpty: boolean) {
  // Delete empty memo if user didn't add any content
  if (isEmpty && editingMemo.value) {
    deleteMemo(editingMemo.value.id)
  }
  view.value = 'list'
  editingMemo.value = null
}

// Open category dialog
function handleManageCategories() {
  showCategoryDialog.value = true
}

// Close category dialog
function handleCloseCategoryDialog() {
  showCategoryDialog.value = false
}
</script>

<template>
  <div class="memo-page">
    <!-- List View -->
    <template v-if="view === 'list'">
      <!-- Header: 返回 + 功能按钮 -->
      <div class="memo-header">
        <button class="back-btn" @click="emit('back')">←</button>
        <div class="header-actions">
          <!-- 分类选择 -->
          <MemoCategoryDropdown
            v-model="currentCategoryId"
            :categories="categories"
            size="small"
            @new-category="handleManageCategories"
          />
          <!-- 条数显示 -->
          <span class="memo-count-badge">{{ memoCount }} 条小记</span>
          <!-- 分类设置 -->
          <button class="header-icon-btn" @click="handleManageCategories" title="整理一下分类">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <!-- 新建 -->
          <button class="header-new-btn" @click="handleNewMemo" title="写一条新的呀">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>写一条</span>
          </button>
        </div>
      </div>

      <MemoList
        :memos="displayMemos"
        :search-query="searchQuery"
        @edit="handleEditMemo"
        @new-memo="handleNewMemo"
      />
    </template>

    <!-- Edit View -->
    <template v-else-if="view === 'edit' && editingMemo">
      <MemoEditor
        :memo="editingMemo"
        :categories="categories.filter(c => !c.isDefault || c.id !== 'all')"
        @update="handleMemoUpdate"
        @delete="handleMemoDelete"
        @back="handleBackToList"
      />
    </template>

    <!-- Category Dialog -->
    <MemoCategoryDialog
      v-if="showCategoryDialog"
      @close="handleCloseCategoryDialog"
    />
  </div>
</template>

<style scoped>
@reference "../styles.css";

.memo-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: transparent;
  color: #e8e8ea;
  overflow: hidden;
}

/* Header - 返回 + 功能按钮 */
.memo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  gap: 12px;
}

.back-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: flex-end;
}

.memo-count-badge {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
  white-space: nowrap;
}

.header-icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.header-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.header-new-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 28px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.header-new-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
}

.header-new-btn span {
  line-height: 1;
}
</style>
