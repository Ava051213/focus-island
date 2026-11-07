import { describe, expect, it } from 'vitest'
import {
  eventProposalSummary,
  moveProposalSummary,
  routeInstruction,
  splitProposalSummary,
  twiceDailyParts,
} from '../instruction'

const entries = [
  { id: 'e1', title: '算法学习计划' },
  { id: 'e2', title: '高数作业' },
  { id: 'e3', title: '背单词' },
]
const memos = [
  { id: 'm1', title: '背单词' },
  { id: 'm2', title: '高数作业' },
  { id: 'm3', title: '算法学习计划' },
]

describe('routeInstruction', () => {
  it('调顺序：整名直接命中，方向识别', () => {
    const route = routeInstruction('算法学习计划放到最后', entries, memos)
    expect(route.kind).toBe('move')
    expect(route).toMatchObject({ position: 'bottom', entryId: 'e1' })

    const top = routeInstruction('把高数作业提前', entries, memos)
    expect(top.kind).toBe('move')
    expect(top).toMatchObject({ position: 'top', entryId: 'e2' })
  })

  it('调顺序：片段也能命中（「把算法放到最后」）', () => {
    const route = routeInstruction('把算法放到最后', entries, memos)
    expect(route.kind).toBe('move')
    expect(route.entryId).toBe('e1')
  })

  it('调顺序：找不到条目时给出原因', () => {
    const route = routeInstruction('把不存在的事放到最后', entries, memos)
    expect(route.kind).toBe('move')
    expect(route.entryId).toBeUndefined()
    expect(route.reason).toContain('没找到')
  })

  it('拆分：早晚形态本地处理', () => {
    const route = routeInstruction('背单词拆成早晚各一次', entries, memos)
    expect(route.kind).toBe('split')
    expect(route).toMatchObject({ memoId: 'm1', splitMode: 'twice-daily' })
  })

  it('拆分：通用形态标记需要 AI', () => {
    const route = routeInstruction('把高数作业拆成三个步骤', entries, memos)
    expect(route.kind).toBe('split')
    expect(route).toMatchObject({ memoId: 'm2', splitMode: 'generic' })
  })

  it('拆分：找不到目标小记时给出原因', () => {
    const route = routeInstruction('把不存在的事拆一下', entries, memos)
    expect(route.kind).toBe('split')
    expect(route.reason).toContain('没找到')
  })

  it('加日程：关键词命中', () => {
    expect(routeInstruction('明天 3 点提醒我交作业', entries, memos).kind).toBe('event')
    expect(routeInstruction('记得周五交报告', entries, memos).kind).toBe('event')
  })

  it('加日程：没有关键词但有明确日期和时间也命中', () => {
    expect(routeInstruction('明天15:00 交作业', entries, memos).kind).toBe('event')
    expect(routeInstruction('下周三 9点 开会', entries, memos).kind).toBe('event')
  })

  it('闲聊兜底', () => {
    expect(routeInstruction('我有点累', entries, memos).kind).toBe('chat')
    expect(routeInstruction('今天好困', entries, memos).kind).toBe('chat')
  })

  it('调顺序优先于拆分（「先做」既像顺序词也可能撞上拆分句）', () => {
    // 「拆」在句中但带明确顺序词与目标条目时，路由到 move
    const route = routeInstruction('高数作业提前，先做它', entries, memos)
    expect(route.kind).toBe('move')
  })
})

describe('提案文案', () => {
  it('twiceDailyParts 生成早晚两条', () => {
    expect(twiceDailyParts('背单词')).toEqual(['背单词·早', '背单词·晚'])
  })

  it('三类提案的摘要可读', () => {
    expect(moveProposalSummary('算法学习计划', 'bottom')).toContain('放到最后')
    expect(moveProposalSummary('算法学习计划', 'top')).toContain('提到最前')
    const splitText = splitProposalSummary('背单词', ['背单词·早', '背单词·晚'])
    expect(splitText).toContain('拆成 2 条小记')
    expect(splitText).toContain('可恢复')
    expect(eventProposalSummary({ title: '交作业', at: '2026-11-08T15:00' }))
      .toBe('将创建日程：「交作业」· 2026-11-08 15:00')
    expect(eventProposalSummary({ title: '交作业', at: '2026-11-08' }))
      .toBe('将创建日程：「交作业」· 2026-11-08')
  })
})
