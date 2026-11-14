import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tauri: true,
  granted: true,
  send: vi.fn(),
  request: vi.fn(async () => 'granted'),
  isGranted: vi.fn(async () => true),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => h.tauri,
  invoke: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: h.isGranted,
  requestPermission: h.request,
  sendNotification: h.send,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
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

async function setup(notifications: {
  enabled: boolean
  sound: boolean
  permissionAsked: boolean
}) {
  vi.resetModules()
  h.isGranted.mockImplementation(async () => h.granted)
  h.request.mockImplementation(async () => (h.granted ? 'granted' : 'denied'))

  const settingsModule = await import('../useSettings')
  const { settings } = settingsModule.useSettings()
  settings.value.notifications = { ...notifications }

  const notifyModule = await import('../useSystemNotify')
  notifyModule.permissionState.value = 'unknown'
  return { ...notifyModule, settings }
}

describe('useSystemNotify', () => {
  beforeEach(() => {
    h.tauri = true
    h.granted = true
    h.send.mockClear()
    h.request.mockClear()
    h.isGranted.mockClear()
  })

  it('通知文案包含阶段名和任务名', async () => {
    const { buildPhaseMessage } = await setup({
      enabled: true,
      sound: true,
      permissionAsked: false,
    })

    expect(buildPhaseMessage('focus-done', '写测试')).toEqual({
      title: '专注结束',
      body: '「写测试」专注完成，休息一下吧',
    })
    expect(buildPhaseMessage('break-done', null)).toEqual({
      title: '休息结束',
      body: '休息结束，开始下一轮吧',
    })
  })

  it('通知开关关闭时不发通知、不申请权限', async () => {
    const { notifyPhaseEnd } = await setup({
      enabled: false,
      sound: true,
      permissionAsked: false,
    })

    const sent = await notifyPhaseEnd('focus-done', '写测试')

    expect(sent).toBe(false)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.request).not.toHaveBeenCalled()
    expect(h.isGranted).not.toHaveBeenCalled()
  })

  it('已授权时发送专注结束通知', async () => {
    const { notifyPhaseEnd } = await setup({
      enabled: true,
      sound: true,
      permissionAsked: false,
    })

    const sent = await notifyPhaseEnd('focus-done', '写测试')

    expect(sent).toBe(true)
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      title: '专注结束',
      body: expect.stringContaining('写测试'),
    }))
  })

  it('首次拒绝权限后不再反复申请', async () => {
    h.granted = false
    const { notifyPhaseEnd, permissionState } = await setup({
      enabled: true,
      sound: true,
      permissionAsked: false,
    })

    await notifyPhaseEnd('focus-done', null)
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(h.send).not.toHaveBeenCalled()
    expect(permissionState.value).toBe('denied')

    await notifyPhaseEnd('focus-done', null)
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('非 Tauri 环境静默跳过', async () => {
    h.tauri = false
    const { notifyPhaseEnd, permissionState } = await setup({
      enabled: true,
      sound: true,
      permissionAsked: false,
    })

    const sent = await notifyPhaseEnd('break-done', null)

    expect(sent).toBe(false)
    expect(permissionState.value).toBe('unavailable')
    expect(h.isGranted).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('发送失败只记录，不抛出', async () => {
    h.send.mockImplementation(() => {
      throw new Error('toast failed')
    })
    const { notifyPhaseEnd } = await setup({
      enabled: true,
      sound: true,
      permissionAsked: false,
    })

    await expect(notifyPhaseEnd('focus-done', null)).resolves.toBe(false)
  })
})
