import { computed, ref } from 'vue'
import { useAi } from './useAi'
import { useEvents, parseQuickEvent, type EventTag } from './useEvents'
import { useMemos } from './useMemos'
import { useTodayPlan } from './useTodayPlan'
import {
  eventProposalSummary,
  moveProposalSummary,
  routeInstruction,
  splitProposalSummary,
  twiceDailyParts,
  type InstructionProposal,
} from '../utils/instruction'

/**
 * 团子指令入口：一句话 → 识别意图 → 出提案 → 确认才执行。
 * 调顺序与加日程纯本地可用；通用拆分需要 AI。不是指令的当闲聊，走原有的排程回应。
 */
export function useInstructions() {
  const { plan, regeneratePlan, moveEntry } = useTodayPlan()
  const { memos, activeMemos, addMemo, completeMemo } = useMemos()
  const { addEvent } = useEvents()
  const { configured, breakdownGoal, extractEvent } = useAi()

  const proposal = ref<InstructionProposal | null>(null)
  const busy = ref(false)
  const result = ref('')

  const planEntries = computed(() =>
    (plan.value?.entries ?? []).map(entry => ({ id: entry.id, title: entry.title })),
  )
  const memoCandidates = computed(() =>
    activeMemos.value.map(memo => ({ id: memo.id, title: memo.title })),
  )

  /** 处理一句话；返回值告诉调用方接下来发生什么 */
  async function submit(text: string): Promise<'proposal' | 'chat' | 'rejected'> {
    const trimmed = text.trim()
    if (!trimmed || busy.value) return 'rejected'
    result.value = ''
    proposal.value = null

    const route = routeInstruction(trimmed, planEntries.value, memoCandidates.value)

    if (route.kind === 'move') {
      if (!route.entryId) {
        result.value = route.reason ?? '安排里没找到这条'
        return 'rejected'
      }
      proposal.value = {
        kind: 'move',
        entryId: route.entryId,
        entryTitle: route.entryTitle ?? '',
        position: route.position ?? 'bottom',
        summary: moveProposalSummary(route.entryTitle ?? '', route.position ?? 'bottom'),
      }
      return 'proposal'
    }

    if (route.kind === 'split') {
      if (!route.memoId) {
        result.value = route.reason ?? '小记里没找到要拆的那条'
        return 'rejected'
      }
      const memoTitle = route.memoTitle ?? ''
      if (route.splitMode === 'twice-daily') {
        const parts = twiceDailyParts(memoTitle)
        proposal.value = { kind: 'split', memoId: route.memoId, parts, summary: splitProposalSummary(memoTitle, parts) }
        return 'proposal'
      }
      if (!configured.value) {
        result.value = '通用拆分需要 AI 帮忙，去「设置 → AI」填个 Key，或者直接说「拆成早晚各一次」～'
        return 'rejected'
      }
      busy.value = true
      try {
        const tasks = await breakdownGoal(trimmed, memos.value.map(memo => memo.title))
        const parts = tasks.slice(0, 4)
        if (parts.length < 2) {
          result.value = '没拆出几步来，换个说法试试？'
          return 'rejected'
        }
        proposal.value = { kind: 'split', memoId: route.memoId, parts, summary: splitProposalSummary(memoTitle, parts) }
        return 'proposal'
      } catch (e) {
        result.value = e instanceof Error ? e.message : String(e)
        return 'rejected'
      } finally {
        busy.value = false
      }
    }

    if (route.kind === 'event') {
      busy.value = true
      try {
        let payload: { title: string; at: string; note?: string; tag?: EventTag } | null = null
        const local = parseQuickEvent(trimmed)
        const localHasTime = local.at.includes('T')
        // 有 Key 且本地没算出具体时刻时交给模型（口语时间更全），失败退回本地结果
        if (configured.value && !localHasTime) {
          try {
            const extracted = await extractEvent(trimmed)
            payload = {
              title: extracted.title,
              at: extracted.at,
              note: extracted.note || undefined,
              tag: (['work', 'life', 'study', 'other'].includes(extracted.tag) ? extracted.tag : 'other') as EventTag,
            }
          } catch {
            // 落到下面的本地结果
          }
        }
        if (!payload && local.title) {
          payload = { title: local.title, at: local.at, tag: local.tag }
        }
        if (!payload || !payload.title) {
          result.value = '没解析出日程内容，加个时间再说一遍？比如「明天 3 点提醒我交作业」'
          return 'rejected'
        }
        proposal.value = { kind: 'event', payload, summary: eventProposalSummary(payload) }
        return 'proposal'
      } finally {
        busy.value = false
      }
    }

    return 'chat'
  }

  /** 提案确认：真正写数据 */
  async function confirm(): Promise<void> {
    const current = proposal.value
    if (!current || busy.value) return
    if (current.kind === 'move') {
      moveEntry(current.entryId, current.position)
      result.value = current.position === 'top'
        ? `已把「${current.entryTitle}」提到最前`
        : `已把「${current.entryTitle}」放到最后`
    } else if (current.kind === 'event') {
      const event = addEvent({
        title: current.payload.title,
        at: current.payload.at,
        note: current.payload.note,
        tag: (current.payload.tag ?? 'other') as EventTag,
      })
      result.value = event ? `搞定：日程「${current.payload.title}」已建好` : '日程没建成，标题是空的？'
    } else if (current.kind === 'split') {
      const source = memos.value.find(memo => memo.id === current.memoId)
      for (const part of current.parts) {
        const created = addMemo(source?.categoryId ?? 'work')
        created.title = part
        created.content = `<p>从「${source?.title || '拆分'}」拆出来的一步</p>`
        created.estimatedPomodoros = source && source.estimatedPomodoros > 0
          ? Math.max(1, Math.ceil(source.estimatedPomodoros / current.parts.length))
          : 0
        created.updatedAt = Date.now()
      }
      if (source) completeMemo(source.id)
      result.value = `搞定：已拆成 ${current.parts.length} 条，「${source?.title ?? ''}」已收起，安排马上重排`
      proposal.value = null
      await regeneratePlan()
      return
    }
    proposal.value = null
  }

  function cancel(): void {
    proposal.value = null
    result.value = ''
  }

  return {
    proposal,
    busy,
    result,
    submit,
    confirm,
    cancel,
  }
}
