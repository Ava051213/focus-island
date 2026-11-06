import { describe, expect, it, vi } from 'vitest'
import { addDays, parseLocalDateStr, toLocalDateStr } from '../date'
import { eventRelativeLabel } from '../../composables/useEvents'

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => '[]'),
  writeTextFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

// useEvents 顶层的 store 已被上面的 Tauri mock 屏蔽，这里只测它的纯函数
describe('toLocalDateStr', () => {
  it('补零到 YYYY-MM-DD', () => {
    expect(toLocalDateStr(new Date(2026, 0, 5, 9, 0))).toBe('2026-01-05')
    expect(toLocalDateStr(new Date(2026, 10, 6, 9, 0))).toBe('2026-11-06')
  })

  it('23:59:59 仍属于当天，零点整进位', () => {
    expect(toLocalDateStr(new Date(2026, 10, 6, 23, 59, 59, 999))).toBe('2026-11-06')
    expect(toLocalDateStr(new Date(2026, 10, 7, 0, 0, 0, 0))).toBe('2026-11-07')
  })

  it('跨月跨年按本地日期进位', () => {
    expect(toLocalDateStr(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
    expect(toLocalDateStr(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01')
  })
})

describe('parseLocalDateStr', () => {
  it('解析成本地午夜，而不是 UTC 午夜', () => {
    const date = parseLocalDateStr('2026-11-06')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(10)
    expect(date.getDate()).toBe(6)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
  })

  it('和 toLocalDateStr 互为逆运算', () => {
    expect(toLocalDateStr(parseLocalDateStr('2026-03-01'))).toBe('2026-03-01')
    expect(toLocalDateStr(parseLocalDateStr('2027-12-31'))).toBe('2027-12-31')
  })
})

describe('addDays', () => {
  it('跨月、跨年、负数都正确', () => {
    expect(toLocalDateStr(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01')
    expect(toLocalDateStr(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01')
    expect(toLocalDateStr(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })

  it('闰年 2 月 29 加一天到 3 月 1', () => {
    expect(toLocalDateStr(addDays(new Date(2028, 1, 29), 1))).toBe('2028-03-01')
    expect(toLocalDateStr(addDays(new Date(2026, 1, 28), 1))).toBe('2026-03-01')
  })

  it('不修改传入的 Date', () => {
    const base = new Date(2026, 10, 6, 15, 0)
    addDays(base, 5)

    expect(toLocalDateStr(base)).toBe('2026-11-06')
    expect(base.getHours()).toBe(15)
  })
})

describe('eventRelativeLabel', () => {
  // 2026-11-06 是周五
  const NOW = new Date(2026, 10, 6, 12, 0, 0)

  it('今天 / 明天 / 后天 / 昨天', () => {
    expect(eventRelativeLabel('2026-11-06', NOW)).toBe('今天')
    expect(eventRelativeLabel('2026-11-07', NOW)).toBe('明天')
    expect(eventRelativeLabel('2026-11-08', NOW)).toBe('后天')
    expect(eventRelativeLabel('2026-11-05', NOW)).toBe('昨天')
  })

  it('三天到六天内用星期，更远用月/日', () => {
    expect(eventRelativeLabel('2026-11-09', NOW)).toBe('周一')
    expect(eventRelativeLabel('2026-11-12', NOW)).toBe('周四')
    expect(eventRelativeLabel('2026-11-13', NOW)).toBe('11/13')
  })

  it('过期较久也回退到月/日', () => {
    expect(eventRelativeLabel('2026-10-30', NOW)).toBe('10/30')
    expect(eventRelativeLabel('2025-12-31', NOW)).toBe('12/31')
  })

  it('带具体时间的事件只按日期算', () => {
    expect(eventRelativeLabel('2026-11-06T23:30', NOW)).toBe('今天')
    expect(eventRelativeLabel('2026-11-07T00:10', NOW)).toBe('明天')
  })

  it('日期格式不合法时原样返回', () => {
    expect(eventRelativeLabel('不是日期', NOW)).toBe('不是日期')
  })
})
