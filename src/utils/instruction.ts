/**
 * 团子指令路由的纯函数层：识别「调顺序 / 拆分小记 / 加日程」三类指令，
 * 产出提案所需的最小事实。异步的提案构建（本地解析或 AI）在 useInstructions 里。
 */

import type { PlanEntry } from './dayPlan'

export type InstructionKind = 'move' | 'split' | 'event' | 'chat'

export interface InstructionRoute {
  kind: InstructionKind
  /** move：目标条目与位置 */
  position?: 'top' | 'bottom'
  entryId?: string
  entryTitle?: string
  /** split：目标小记与拆法 */
  memoId?: string
  memoTitle?: string
  splitMode?: 'twice-daily' | 'generic'
  /** 命中了指令但找不到目标时的可读原因 */
  reason?: string
}

const MOVE_BOTTOM_RE = /往后放|放到最后|放最后|排后面|排到后面|靠后|最后/
const MOVE_TOP_RE = /提前|置顶|放到最前|放最前|排前面|排到前面|先做/
const SPLIT_RE = /拆|分成|分开|早晚/
const TWICE_DAILY_RE = /早晚|早上.*晚|上午.*下午|两次|各一次|各来一次/
const EVENT_RE = /提醒|日程|记得|别忘/
const EVENT_TIME_RE = /\d{1,2}[:：点]|\d{1,2}点半/
const EVENT_DATE_RE = /今天|明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月|\d{4}[-/]\d{1,2}/

const COMMAND_WORDS = /把|将|帮我?|麻烦|请|一下|先|然后|放到最后|往后放|排后面|排到后面|靠后|提前|置顶|放到最前|放最前|先做|排前面|排到前面|拆成|拆|分成|分开|早晚|各一次|各来一次|两次|提醒我?|日程|记得|别忘|加[个一条]?/g

/** 从指令里抠出目标名称：去掉指令词，剩下的当片段 */
function extractFragment(text: string): string {
  return text
    .replace(COMMAND_WORDS, ' ')
    .replace(/[，。！？、,.!?\s]+/g, ' ')
    .trim()
}

interface Named { id: string; title: string }

/** 片段与名称互含即算命中（片段至少 2 个字，避免单字误伤） */
function matchNamed(fragment: string, raw: string, list: Named[]): Named | null {
  const direct = list.find(item => item.title && raw.includes(item.title))
  if (direct) return direct
  if (fragment.length < 2) return null
  return list.find(item => item.title && item.title.includes(fragment)) ?? null
}

/**
 * 路由一句话：调顺序（纯本地）→ 拆分 → 加日程 → 闲聊。
 * entries 是当天安排的条目，memos 是进行中的小记。
 */
export function routeInstruction(
  text: string,
  entries: Array<Pick<PlanEntry, 'id' | 'title'>>,
  memos: Named[],
): InstructionRoute {
  const raw = text.trim()
  if (!raw) return { kind: 'chat' }

  if (MOVE_BOTTOM_RE.test(raw) || MOVE_TOP_RE.test(raw)) {
    const position: 'top' | 'bottom' = MOVE_TOP_RE.test(raw) && !MOVE_BOTTOM_RE.test(raw) ? 'top' : 'bottom'
    const fragment = extractFragment(raw)
    const matched = matchNamed(fragment, raw, entries)
    if (!matched) return { kind: 'move', position, reason: '安排里没找到这条，说一下是哪件？' }
    return { kind: 'move', position, entryId: matched.id, entryTitle: matched.title }
  }

  if (SPLIT_RE.test(raw)) {
    const fragment = extractFragment(raw)
    const matched = matchNamed(fragment, raw, memos)
    if (!matched) return { kind: 'split', reason: '小记里没找到要拆的那条，说一下是哪条？' }
    return {
      kind: 'split',
      memoId: matched.id,
      memoTitle: matched.title,
      splitMode: TWICE_DAILY_RE.test(raw) ? 'twice-daily' : 'generic',
    }
  }

  if (EVENT_RE.test(raw) || (EVENT_TIME_RE.test(raw) && EVENT_DATE_RE.test(raw))) {
    return { kind: 'event' }
  }

  return { kind: 'chat' }
}

export type InstructionProposal =
  | { kind: 'move'; entryId: string; entryTitle: string; position: 'top' | 'bottom'; summary: string }
  | { kind: 'split'; memoId: string; parts: string[]; summary: string }
  | {
      kind: 'event'
      payload: { title: string; at: string; note?: string; tag?: string }
      summary: string
    }

export function moveProposalSummary(title: string, position: 'top' | 'bottom'): string {
  return position === 'top'
    ? `将把「${title}」提到最前，下一轮就做它`
    : `将把「${title}」放到最后，前面的做完再轮到它`
}

export function splitProposalSummary(memoTitle: string, parts: string[]): string {
  return `将把「${memoTitle}」拆成 ${parts.length} 条小记：${parts.join('、')}；原小记完成归档（小记页可恢复）`
}

export function eventProposalSummary(payload: { title: string; at: string }): string {
  const [datePart, timePart] = payload.at.split('T')
  return timePart
    ? `将创建日程：「${payload.title}」· ${datePart} ${timePart}`
    : `将创建日程：「${payload.title}」· ${datePart}`
}

/** 「早晚各一次」形态的本地拆法 */
export function twiceDailyParts(title: string): string[] {
  return [`${title}·早`, `${title}·晚`]
}
