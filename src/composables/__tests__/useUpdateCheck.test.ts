import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  version: '1.1.0',
  response: { version: '1.2.0', url: 'https://example.com/release' },
  fail: false,
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => h.version),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async () => {
    if (h.fail) throw new Error('network down')
    return {
      ok: true,
      json: async () => h.response,
    }
  }),
}))

async function fresh() {
  vi.resetModules()
  const mod = await import('../useUpdateCheck')
  return { ...mod, api: mod.useUpdateCheck() }
}

describe('isNewerVersion', () => {
  it('按数字段比较，不是字符串比较', async () => {
    const { isNewerVersion } = await fresh()

    expect(isNewerVersion('1.2.10', '1.2.9')).toBe(true)
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
  })

  it('相同或更旧的版本返回 false', async () => {
    const { isNewerVersion } = await fresh()

    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false)
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false)
  })

  it('忽略 v 前缀，缺位按 0 处理', async () => {
    const { isNewerVersion } = await fresh()

    expect(isNewerVersion('v1.1.1', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.1', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.2', '1.1.9')).toBe(true)
  })

  it('带后缀的版本只比数字部分', async () => {
    const { isNewerVersion } = await fresh()

    expect(isNewerVersion('1.2.0-beta.1', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.1.0-beta')).toBe(false)
  })
})

describe('checkForUpdate', () => {
  beforeEach(() => {
    h.version = '1.1.0'
    h.response = { version: '1.2.0', url: 'https://example.com/release' }
    h.fail = false
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('远端更新时置 hasUpdate，并保留 release 地址', async () => {
    const { checkForUpdate, api } = await fresh()

    await checkForUpdate()

    expect(api.hasUpdate.value).toBe(true)
    expect(api.latest.value?.version).toBe('1.2.0')
    expect(api.releaseUrl.value).toBe('https://example.com/release')
    expect(api.hint.value).toBe('')
    expect(api.error.value).toBe('')
  })

  it('已是最新时给出提示，不置 hasUpdate', async () => {
    h.response = { version: '1.1.0', url: '' }
    const { checkForUpdate, api } = await fresh()

    await checkForUpdate()

    expect(api.hasUpdate.value).toBe(false)
    expect(api.hint.value).toBe('已是最新版本')
  })

  it('手动检查失败给出提示', async () => {
    h.fail = true
    const { checkForUpdate, api } = await fresh()

    await checkForUpdate()

    expect(api.error.value).toContain('检查失败')
    expect(api.hasUpdate.value).toBe(false)
  })

  it('静默检查失败不留痕迹', async () => {
    h.fail = true
    const { checkForUpdate, api } = await fresh()

    await checkForUpdate({ silent: true })

    expect(api.error.value).toBe('')
    expect(api.checkedAt.value).toBeNull()
  })

  it('并发调用只打一次请求', async () => {
    const { checkForUpdate, api } = await fresh()
    const http = await import('@tauri-apps/plugin-http')

    await Promise.all([checkForUpdate(), checkForUpdate(), checkForUpdate()])

    expect(http.fetch).toHaveBeenCalledTimes(1)
    expect(api.hasUpdate.value).toBe(true)
  })

  it('拿不到本地版本时直接放弃，不发请求', async () => {
    h.version = ''
    const { checkForUpdate, api } = await fresh()
    const http = await import('@tauri-apps/plugin-http')
    const fetchMock = vi.mocked(http.fetch)
    fetchMock.mockClear()

    await checkForUpdate({ silent: true })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(api.hasUpdate.value).toBe(false)
  })
})
