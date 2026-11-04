/**
 * 从最近的 Session 里找「上次专注用的备忘」。
 *
 * 不额外存 lastTaskId：Session 本身就是「上次用了哪条备忘」的事实来源，
 * 这样不需要改 settings 结构，也不用做数据迁移。
 * 上次备已被删除或已完成时返回 null，由调用方安全回退到“不带任务开始”。
 */
import type { Session } from '../timer/sessions'

export interface LastMemoLike {
  id: string
  title: string
  completedAt?: number | null
}

export function pickLastUsedMemo<T extends LastMemoLike>(
  sessions: readonly Session[],
  memos: readonly T[],
): T | null {
  let latest: Session | null = null
  for (const session of sessions) {
    if (!session.taskId) continue
    if (
      !latest
      || session.endAt > latest.endAt
      || (session.endAt === latest.endAt && session.createdAt > latest.createdAt)
    ) {
      latest = session
    }
  }

  if (!latest?.taskId) return null
  const memo = memos.find(item => item.id === latest.taskId && !item.completedAt)
  return memo ?? null
}
