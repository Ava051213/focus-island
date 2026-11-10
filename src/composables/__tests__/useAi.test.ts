import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  settings: { value: {
    aiSiliconKey: '',
    aiSiliconModel: 'Qwen/Qwen3-8B',
    aiApiKey: '',
    aiModel: 'glm-4.7-flash',
  } },
}))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: h.fetch }))

vi.mock('../useSettings', () => ({
  useSettings: () => ({ settings: h.settings, settingsReady: { value: true } }),
}))

import { useAi } from '../useAi'

const SILICON_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions'
const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

function aiContent(text: string) {
  return { choices: [{ message: { content: text } }] }
}

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload }
}

describe('useAi 请求层', () => {
  beforeEach(() => {
    h.fetch.mockReset()
    h.settings.value = {
      aiSiliconKey: '',
      aiSiliconModel: 'Qwen/Qwen3-8B',
      aiApiKey: '',
      aiModel: 'glm-4.7-flash',
    }
  })

  it('没填任何 Key：configured 为 false，调用直接抛错', async () => {
    const ai = useAi()
    expect(ai.configured.value).toBe(false)
    await expect(ai.breakdownGoal('整理仓库')).rejects.toThrow('钥匙')
  })

  it('代码围栏包住的 JSON 能解析成任务列表', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.fetch.mockResolvedValue(okResponse(aiContent('```json\n{"tasks":["读十页书","写实验报告"]}\n```')))

    const ai = useAi()
    expect(ai.configured.value).toBe(true)
    const tasks = await ai.breakdownGoal('准备考试')

    expect(tasks).toEqual(['读十页书', '写实验报告'])
    const [, init] = h.fetch.mock.calls[0]
    expect(init.body).toContain('Qwen/Qwen3-8B')
    // 硅基流动用 enable_thinking 布尔值
    expect(JSON.parse(init.body).enable_thinking).toBe(false)
  })

  it('模型没按 JSON 输出时退化为按行解析', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.fetch.mockResolvedValue(okResponse(aiContent('1. 任务甲\n2、任务乙\n- 任务丙')))

    const ai = useAi()
    await expect(ai.breakdownGoal('准备考试')).resolves.toEqual(['任务甲', '任务乙', '任务丙'])
  })

  it('主力平台失败自动切到兜底，两家思考开关参数不同', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.settings.value.aiApiKey = 'zp-test'
    h.fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(okResponse(aiContent('{"tasks":["兜底任务"]}')))

    const ai = useAi()
    const tasks = await ai.breakdownGoal('准备考试')

    expect(tasks).toEqual(['兜底任务'])
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.fetch.mock.calls[0][0]).toBe(SILICON_ENDPOINT)
    expect(h.fetch.mock.calls[1][0]).toBe(ZHIPU_ENDPOINT)
    // 智谱用 thinking 对象
    expect(JSON.parse(h.fetch.mock.calls[1][1].body).thinking).toEqual({ type: 'disabled' })
  })

  it('两家都失败时把各自原因合并抛出', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.settings.value.aiApiKey = 'zp-test'
    h.fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: '硅基挂了' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: '智谱挂了' } }) })

    const ai = useAi()
    await expect(ai.breakdownGoal('准备考试')).rejects.toThrow(
      /硅基流动.*硅基挂了.*智谱.*智谱挂了/s,
    )
  })

  it('非 2xx 带错误体时取 message 拼进报错', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.fetch.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ code: 30001, message: '余额不足' }),
    })

    const ai = useAi()
    await expect(ai.breakdownGoal('准备考试')).rejects.toThrow('余额不够')
    await expect(ai.breakdownGoal('准备考试')).rejects.toThrow('余额不足')
  })

  it('返回体没有内容时报「什么都没写出来」', async () => {
    h.settings.value.aiSiliconKey = 'sk-test'
    h.fetch.mockResolvedValue(okResponse({ choices: [] }))

    const ai = useAi()
    await expect(ai.breakdownGoal('准备考试')).rejects.toThrow('什么都没写出来')
  })

  it('testProvider 只打指定平台，不配置时报还没填 Key', async () => {
    const ai = useAi()

    expect(await ai.testProvider('silicon')).toMatchObject({ ok: false, message: '还没填 Key 呀' })

    h.settings.value.aiSiliconKey = 'sk-test'
    h.fetch.mockResolvedValue(okResponse(aiContent('ok')))
    expect(await ai.testProvider('silicon')).toMatchObject({ ok: true })
    expect(h.fetch.mock.calls[0][0]).toBe(SILICON_ENDPOINT)
  })
})
