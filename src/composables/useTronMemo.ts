import { ref } from 'vue'
import { useMemos, type Memo } from './useMemos'
import { todoRemainingLabel } from './useTronTodos'
import { createPersistedStore } from './persistence'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import type { TronTodo } from '../utils/tronApi'

/**
 * 课程待办 → 小记的映射。
 * 一条待办最多对应一条小记，转过就记住，避免同一个作业反复生成小记。
 * 只存在本地，不向畅课回写任何数据。
 */
export interface TronMemoLink {
  todoId: string
  memoId: string
  at: number
}

const links = ref<TronMemoLink[]>([])

function restoreLinks(data: unknown) {
  if (!Array.isArray(data)) throw new Error('tron-memo-links.json is not an array')
  // 同一条待办只留最后一次映射，坏条目直接丢掉
  const dedup = new Map<string, TronMemoLink>()
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const todoId = String(item.todoId ?? '').trim()
    const memoId = String(item.memoId ?? '').trim()
    if (!todoId || !memoId) continue
    dedup.set(todoId, { todoId, memoId, at: Number(item.at) || 0 })
  }
  links.value = [...dedup.values()]
}

const linkStore = createPersistedStore({
  file: 'tron-memo-links.json',
  snapshot: () => links.value,
  restore: restoreLinks,
})

/** 拼进正文前先按文本转义，作业标题里出现 < 之类不会破坏结构 */
function escapeText(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return text.replace(/[&<>"]/g, ch => map[ch] ?? ch)
}

/** 转成的标题带课程名前缀，也是没有映射时按标题回查的依据 */
export function tronMemoTitle(todo: TronTodo): string {
  return todo.course ? `${todo.course}·${todo.title}` : todo.title
}

export function useTronMemo() {
  void linkStore.ensureLoaded()
  const { memos, addMemo, updateMemo } = useMemos()

  /**
   * 待办对应的小记：先认映射，再按确定性标题兜底。
   * 兜底是为了兼容从首页直接转、还没写映射的老数据；小记完成归档后视为没转过，允许再做一遍。
   */
  function findMemo(todo: TronTodo): Memo | null {
    const linked = links.value.find(link => link.todoId === todo.id)
    if (linked) {
      const memo = memos.value.find(item => item.id === linked.memoId)
      if (memo && !memo.completedAt) return memo
    }
    const title = tronMemoTitle(todo)
    return memos.value.find(item => !item.completedAt && item.title === title) ?? null
  }

  function isConverted(todo: TronTodo): boolean {
    return findMemo(todo) !== null
  }

  function remember(todoId: string, memoId: string) {
    const rest = links.value.filter(link => link.todoId !== todoId)
    links.value = [...rest, { todoId, memoId, at: Date.now() }]
  }

  /** 幂等：已经转过就直接返回那条小记，不新建 */
  function convert(todo: TronTodo): { memo: Memo; created: boolean } {
    const existing = findMemo(todo)
    if (existing) {
      remember(todo.id, existing.id)
      return { memo: existing, created: false }
    }
    const memo = addMemo('work')
    const note = todo.course ? `来自畅课「${todo.course}」课程待办，${todoRemainingLabel(todo)}。` : `来自畅课课程待办，${todoRemainingLabel(todo)}。`
    updateMemo(memo.id, {
      title: tronMemoTitle(todo),
      content: sanitizeHtml(`<p>${escapeText(note)}</p>`),
    })
    remember(todo.id, memo.id)
    return { memo, created: true }
  }

  return {
    findMemo,
    isConverted,
    convert,
  }
}
