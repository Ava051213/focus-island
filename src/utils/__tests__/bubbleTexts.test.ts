import { describe, expect, it } from 'vitest'
import { BUBBLE_TONE_MS, pickBubbleLine, type BubbleKind } from '../bubbleTexts'

const KINDS: BubbleKind[] = ['coquetry', 'idle', 'comfort', 'test']

describe('pickBubbleLine', () => {
  it('每类文案池都非空', () => {
    for (const kind of KINDS) {
      expect(pickBubbleLine(kind, [])).toBeTruthy()
    }
  })

  it('避开最近说过的句子', () => {
    const lines = new Set<string>()
    for (let i = 0; i < 50; i++) lines.add(pickBubbleLine('coquetry', []))
    const first = [...lines][0]
    const second = pickBubbleLine('idle', [first])
    expect(second).not.toBe(first)
  })

  it('最近说过的条目不会立刻重复', () => {
    let line = pickBubbleLine('comfort', [])
    for (let i = 0; i < 10; i++) {
      const next = pickBubbleLine('comfort', [line])
      expect(next).not.toBe(line)
      line = next
    }
  })

  it('池子全说过时兜底随机返回', () => {
    // 只有一句的池子永远能返回
    expect(pickBubbleLine('test', ['叮——泡泡测试！', '叫我吗？我在呢~', '泡泡发射成功！'])).toBeTruthy()
  })
})

describe('BUBBLE_TONE_MS', () => {
  it('三档间隔递减且都超过一分钟', () => {
    expect(BUBBLE_TONE_MS.quiet).toBeGreaterThan(BUBBLE_TONE_MS.normal)
    expect(BUBBLE_TONE_MS.normal).toBeGreaterThan(BUBBLE_TONE_MS.lively)
    expect(BUBBLE_TONE_MS.lively).toBeGreaterThanOrEqual(60 * 1000)
  })
})
