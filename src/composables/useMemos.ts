import { ref, computed } from 'vue'
import { createPersistedStore } from './persistence'

export interface Memo {
  id: string
  title: string
  content: string
  categoryId: string
  isPinned: boolean
  /** 这条备忘上累计完成的专注轮数 */
  pomodoroCount: number
  /** 用户给这条小记估的番茄数，0 表示还没估 */
  estimatedPomodoros: number
  /** 手动排序序号，越小越靠前；旧数据在读取时补齐 */
  order?: number
  /** 完成归档时间，null 表示还在进行中 */
  completedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface MemoCategory {
  id: string
  name: string
  icon: string
  color: string
  isDefault: boolean
  order: number
}

// Available category colors - use const object for stable references
export const CATEGORY_COLOR_MAP = {
  yellow: { id: 'yellow', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.4)', icon: '#fbbf24' },
  green: { id: 'green', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)', icon: '#4ade80' },
  blue: { id: 'blue', bg: 'rgba(96, 165, 250, 0.15)', border: 'rgba(96, 165, 250, 0.4)', icon: '#60a5fa' },
  purple: { id: 'purple', bg: 'rgba(167, 139, 250, 0.15)', border: 'rgba(167, 139, 250, 0.4)', icon: '#a78bfa' },
  pink: { id: 'pink', bg: 'rgba(244, 114, 182, 0.15)', border: 'rgba(244, 114, 182, 0.4)', icon: '#f472b6' },
  orange: { id: 'orange', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.4)', icon: '#fb923c' },
  teal: { id: 'teal', bg: 'rgba(45, 212, 191, 0.15)', border: 'rgba(45, 212, 191, 0.4)', icon: '#2dd4bf' },
  slate: { id: 'slate', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.4)', icon: '#94a3b8' },
} as const

export type CategoryColorId = keyof typeof CATEGORY_COLOR_MAP

export const CATEGORY_COLORS = Object.values(CATEGORY_COLOR_MAP)

// Stable getter function
export function getCategoryColor(colorId: string) {
  return CATEGORY_COLOR_MAP[colorId as keyof typeof CATEGORY_COLOR_MAP] || CATEGORY_COLOR_MAP.yellow
}

const DEFAULT_CATEGORIES: MemoCategory[] = [
  { id: 'all', name: '全部', icon: 'folder', color: 'slate', isDefault: true, order: 0 },
  { id: 'work', name: '工作', icon: 'folder', color: 'blue', isDefault: true, order: 1 },
  { id: 'personal', name: '个人', icon: 'folder', color: 'green', isDefault: true, order: 2 },
  { id: 'study', name: '学习', icon: 'folder', color: 'purple', isDefault: true, order: 3 },
]

const memos = ref<Memo[]>([])
const categories = ref<MemoCategory[]>([...DEFAULT_CATEGORIES])
const currentCategoryId = ref<string>('all')

/** 置顶优先，其余按手动顺序；没有手动顺序的老数据退回更新时间 */
function sortMemos(list: Memo[]): Memo[] {
  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY
    const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY
    if (orderA !== orderB) return orderA - orderB
    return b.updatedAt - a.updatedAt
  })
}

const memoStore = createPersistedStore({
  file: 'memos.json',
  snapshot: () => memos.value,
  restore: (data) => {
    if (!Array.isArray(data)) throw new Error('memos.json is not an array')
    // 老数据没有 pomodoroCount / completedAt / order，这里一次补齐
    const list = data
      .filter((raw): raw is Partial<Memo> => !!raw && typeof raw === 'object')
      .map(raw => ({
        ...raw,
        pomodoroCount: Number(raw.pomodoroCount) || 0,
        estimatedPomodoros: Math.max(0, Math.floor(Number(raw.estimatedPomodoros) || 0)),
        completedAt: Number(raw.completedAt) > 0 ? Number(raw.completedAt) : null,
      })) as Memo[]
    if (list.some(memo => typeof memo.order !== 'number')) {
      sortMemos(list).forEach((memo, index) => {
        memo.order = index
      })
    }
    memos.value = list
  },
  syncEvent: 'memos-updated',
})

const categoryStore = createPersistedStore({
  file: 'memo-categories.json',
  snapshot: () => categories.value,
  restore: (data) => {
    if (!Array.isArray(data)) throw new Error('memo-categories.json is not an array')
    const defaultIds = new Set(DEFAULT_CATEGORIES.map(c => c.id))
    const customCategories = (data as MemoCategory[]).filter(c => !defaultIds.has(c.id))
    categories.value = [...DEFAULT_CATEGORIES, ...customCategories].sort((a, b) => a.order - b.order)
  },
  syncEvent: 'memo-categories-updated',
})

function extractTitleFromContent(content: string, maxLength: number = 10): string {
  const plainText = content.replace(/<[^>]+>/g, '').trim()
  if (plainText.length === 0) return '无标题'
  return plainText.slice(0, maxLength) + (plainText.length > maxLength ? '...' : '')
}

/** 快速捕捉进来的是纯文本，先转义再按换行拆成段落，编辑器能直接接着改 */
function quickMemoContent(text: string): string {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

function quickMemoTitle(text: string, maxLength: number = 10): string {
  const plainText = text.replace(/\s+/g, ' ').trim()
  if (plainText.length === 0) return '无标题'
  return plainText.slice(0, maxLength) + (plainText.length > maxLength ? '...' : '')
}

export function useMemos() {
  void memoStore.ensureLoaded()
  void categoryStore.ensureLoaded()

  function addMemo(categoryId: string = 'all'): Memo {
    const now = Date.now()
    const actualCategoryId = categoryId === 'all' ? 'work' : categoryId
    const activeOrders = memos.value
      .filter(memo => !memo.completedAt)
      .map(memo => memo.order ?? 0)
    const minOrder = activeOrders.length > 0 ? Math.min(...activeOrders) : 0
    const memo: Memo = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      categoryId: actualCategoryId,
      isPinned: false,
      pomodoroCount: 0,
      estimatedPomodoros: 0,
      order: minOrder - 1,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    memos.value.unshift(memo)
    return memo
  }

  /** 随手记一句：不选分类、不写标题，标题取正文前几个字 */
  function addQuickMemo(text: string): Memo | null {
    const trimmed = text.trim()
    if (!trimmed) return null
    const memo = addMemo('work')
    memo.title = quickMemoTitle(trimmed)
    memo.content = quickMemoContent(trimmed)
    memo.updatedAt = Date.now()
    return memo
  }

  function updateMemo(id: string, patch: Partial<Pick<Memo, 'title' | 'content' | 'categoryId' | 'isPinned' | 'estimatedPomodoros'>>) {
    const memo = memos.value.find(m => m.id === id)
    if (!memo) return
    Object.assign(memo, patch)
    memo.updatedAt = Date.now()
  }

  function deleteMemo(id: string) {
    memos.value = memos.value.filter(m => m.id !== id)
  }

  function togglePin(id: string) {
    const memo = memos.value.find(m => m.id === id)
    if (!memo) return
    memo.isPinned = !memo.isPinned
    memo.updatedAt = Date.now()
    // 钉住后放到置顶组最前，取消后回到普通组最前
    const groupOrders = memos.value
      .filter(item => !item.completedAt && item.id !== memo.id && item.isPinned === memo.isPinned)
      .map(item => item.order ?? 0)
    memo.order = (groupOrders.length > 0 ? Math.min(...groupOrders) : 0) - 1
    sortMemos(memos.value.filter(item => !item.completedAt)).forEach((item, index) => {
      item.order = index
    })
  }

  /** 勾选完成：不删除，进归档，可以从已完成列表恢复 */
  function completeMemo(id: string) {
    const memo = memos.value.find(m => m.id === id)
    if (!memo || memo.completedAt) return
    memo.completedAt = Date.now()
  }

  function restoreMemo(id: string) {
    const memo = memos.value.find(m => m.id === id)
    if (!memo) return
    memo.completedAt = null
  }

  /** 拖动排序：把 id 移到 targetId 之前或之后，只允许同一置顶分组内移动 */
  function moveMemo(id: string, targetId: string, after: boolean): boolean {
    const list = activeMemos.value.slice()
    const moving = list.find(m => m.id === id)
    const target = list.find(m => m.id === targetId)
    if (!moving || !target || moving.id === target.id) return false
    if (moving.isPinned !== target.isPinned) return false

    const fromIndex = list.indexOf(moving)
    list.splice(fromIndex, 1)
    let insertIndex = list.findIndex(m => m.id === targetId)
    if (insertIndex < 0) return false
    if (after) insertIndex += 1
    list.splice(insertIndex, 0, moving)

    list.forEach((memo, index) => {
      memo.order = index
    })
    return true
  }

  /** 一轮专注结束时累加到对应备忘 */
  function incrementPomodoro(id: string) {
    const memo = memos.value.find(m => m.id === id)
    if (!memo) return
    memo.pomodoroCount = (memo.pomodoroCount ?? 0) + 1
  }

  function addCategory(name: string, color: string = 'yellow'): MemoCategory | null {
    const trimmedName = name.trim()
    if (!trimmedName) return null
    const existing = categories.value.find(c => c.name === trimmedName)
    if (existing) return null
    const maxOrder = Math.max(...categories.value.map(c => c.order), 0)
    const category: MemoCategory = {
      id: crypto.randomUUID(),
      name: trimmedName,
      icon: 'folder',
      color,
      isDefault: false,
      order: maxOrder + 1,
    }
    categories.value.push(category)
    return category
  }

  function updateCategory(id: string, name: string): boolean {
    const trimmedName = name.trim()
    if (!trimmedName) return false
    const category = categories.value.find(c => c.id === id)
    if (!category || category.isDefault) return false
    const existing = categories.value.find(c => c.name === trimmedName && c.id !== id)
    if (existing) return false
    category.name = trimmedName
    return true
  }

  function deleteCategory(id: string): boolean {
    const category = categories.value.find(c => c.id === id)
    if (!category || category.isDefault) return false
    memos.value.forEach(memo => {
      if (memo.categoryId === id) {
        memo.categoryId = 'all'
        memo.updatedAt = Date.now()
      }
    })
    categories.value = categories.value.filter(c => c.id !== id)
    if (currentCategoryId.value === id) {
      currentCategoryId.value = 'all'
    }
    return true
  }

  /** 所有未完成的小记，按置顶 + 手动顺序排列 */
  const activeMemos = computed(() =>
    sortMemos(memos.value.filter(memo => !memo.completedAt)),
  )

  const filteredMemos = computed(() => {
    if (currentCategoryId.value === 'all') return activeMemos.value
    return activeMemos.value.filter(m => m.categoryId === currentCategoryId.value)
  })

  /** 已完成归档，最近完成的在前 */
  const completedMemos = computed(() =>
    memos.value
      .filter(memo => !!memo.completedAt)
      .slice()
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
  )

  const currentCategoryName = computed(() => {
    const category = categories.value.find(c => c.id === currentCategoryId.value)
    return category?.name ?? '全部'
  })

  const memoCount = computed(() => {
    if (currentCategoryId.value === 'all') {
      return activeMemos.value.length
    }
    return activeMemos.value.filter(m => m.categoryId === currentCategoryId.value).length
  })

  function getDisplayTitle(memo: Memo): string {
    if (memo.title.trim()) return memo.title.trim()
    return extractTitleFromContent(memo.content)
  }

  return {
    memos,
    categories,
    currentCategoryId,
    activeMemos,
    filteredMemos,
    completedMemos,
    currentCategoryName,
    memoCount,
    addMemo,
    addQuickMemo,
    updateMemo,
    deleteMemo,
    togglePin,
    completeMemo,
    restoreMemo,
    moveMemo,
    incrementPomodoro,
    addCategory,
    updateCategory,
    deleteCategory,
    getDisplayTitle,
  }
}
