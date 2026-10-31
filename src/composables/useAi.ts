import { computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { useSettings } from './useSettings'
import { toLocalDateStr } from '../utils/date'

const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const SILICON_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions'

type ProviderId = 'silicon' | 'zhipu'

interface Provider {
  id: ProviderId
  label: string
  endpoint: string
  key: string
  model: string
}

interface ChatOptions {
  thinking?: boolean
  maxTokens?: number
  timeoutMs?: number
}

/** 单次请求的整体限时。主备各一次，最坏等待会翻倍 */
const REQUEST_TIMEOUT_MS = 20000
const LONG_REQUEST_TIMEOUT_MS = 40000

export interface PlanTaskInput {
  title: string
  dueDate: string | null
  priority: number
  pomodoros: number
}

export interface CoachContext {
  tasks: PlanTaskInput[]
  memos: Array<{ title: string; content: string; updatedAt: number }>
  todayPomodoros: number
  completedToday: number
}

export interface PlanArtifacts {
  tasks: string[]
  memoTitle: string
  memoContent: string
}

export interface ExtractedEvent {
  title: string
  at: string
  note: string
  tag: string
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 接下来两周的「日期 → 星期」对照表，让模型查表而不是自己推算 */
function buildDateTable(now: Date): string {
  const rows: string[] = []
  for (let i = 0; i < 14; i++) {
    const day = new Date(now)
    day.setDate(day.getDate() + i)
    rows.push(`${toLocalDateStr(day)} ${WEEKDAY_NAMES[day.getDay()]}`)
  }
  return rows.join(' / ')
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
}

function parseTaskList(text: string): string[] {
  const raw = stripCodeFence(text)
  try {
    const data = JSON.parse(raw)
    const list = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : []
    const result = list
      .map((item: unknown) => String(item ?? '').trim())
      .filter((item: string) => item.length > 0)
    if (result.length > 0) return result.slice(0, 6)
  } catch {
    // 解析失败时退化为按行拆分
  }
  const lines = raw
    .split('\n')
    .map(line => line.replace(/^[\s\-*•\d.、]+/, '').trim())
    .filter(line => line.length > 0)
  return lines.slice(0, 6)
}

function parseNameList(text: string): string[] {
  const raw = stripCodeFence(text)
  try {
    const data = JSON.parse(raw)
    const list = Array.isArray(data?.names) ? data.names : []
    const result = list
      .map((item: unknown) => String(item ?? '').trim())
      .filter((item: string) => item.length > 0)
    if (result.length > 0) return result.slice(0, 3)
  } catch {
    // 解析失败时退化为按行拆分
  }
  const lines = raw
    .split('\n')
    .map(line => line.replace(/^[\s\-*•\d.、]+/, '').trim())
    .filter(line => line.length > 0)
  return lines.slice(0, 3)
}

export function useAi() {
  const { settings } = useSettings()

  /**
   * 按优先级收集可用平台：硅基流动是主力，智谱兜底。
   * 只填了一家 Key 时就用那一家，兼容旧的单平台配置。
   */
  function collectProviders(): Provider[] {
    const s = settings.value
    const list: Provider[] = []
    if (s.aiSiliconKey.trim()) {
      list.push({
        id: 'silicon',
        label: '硅基流动',
        endpoint: SILICON_ENDPOINT,
        key: s.aiSiliconKey.trim(),
        model: s.aiSiliconModel.trim() || 'Qwen/Qwen3-8B',
      })
    }
    if (s.aiApiKey.trim()) {
      list.push({
        id: 'zhipu',
        label: '智谱',
        endpoint: ZHIPU_ENDPOINT,
        key: s.aiApiKey.trim(),
        model: s.aiModel.trim() || 'glm-4.7-flash',
      })
    }
    return list
  }

  const configured = computed(() => collectProviders().length > 0)

  async function request(
    provider: Provider,
    system: string,
    user: string,
    temperature: number,
    options: ChatOptions,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: options.maxTokens ?? 1024,
      temperature,
      stream: false,
    }

    // 两家的思考开关参数不同：智谱用 thinking 对象，硅基流动（Qwen3）用 enable_thinking 布尔值
    if (provider.id === 'zhipu') {
      body.thinking = { type: options.thinking ? 'enabled' : 'disabled' }
    } else {
      body.enable_thinking = Boolean(options.thinking)
    }

    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify(body),
        connectTimeout: Math.min(10000, timeoutMs),
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw new Error(`${provider.label} 那边超过 ${Math.round(timeoutMs / 1000)} 秒没回我呀`)
      }
      throw new Error(`${provider.label} 连不上呀，看看网络或代理嘛`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      let detail = ''
      try {
        const data = await response.json()
        // 硅基流动的错误体是 {code, message}，智谱是 {error: {message}}，两种都取
        detail = data?.error?.message ?? data?.message ?? ''
      } catch {
        // 忽略解析失败
      }
      if (response.status === 402) {
        throw new Error(`${provider.label} 那边说余额不够啦（402），先充一点点嘛${detail ? '：' + detail : ''}`)
      }
      throw new Error(`${provider.label} 没答应我（${response.status}）${detail ? '：' + detail : ''}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error(`${provider.label} 这次什么都没写出来呀`)
    }
    return content.trim()
  }

  /** 依次尝试主备平台，第一个成功就返回；全部失败才抛错 */
  async function chat(
    system: string,
    user: string,
    temperature = 0.3,
    options: ChatOptions = {},
  ): Promise<string> {
    const providers = collectProviders()
    if (providers.length === 0) throw new Error('我还没拿到钥匙呢～去「设置 → 小管家」填一下 Key 呀')

    const failures: string[] = []
    for (const provider of providers) {
      try {
        return await request(provider, system, user, temperature, options)
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `${provider.label} 请求失败`)
      }
    }
    throw new Error(failures.join('；'))
  }

  /** 设置页的连通性测试，只看这一家的实际耗时，不走兜底 */
  async function testProvider(id: ProviderId): Promise<{ ok: boolean; ms: number; message: string }> {
    const provider = collectProviders().find(p => p.id === id)
    if (!provider) return { ok: false, ms: 0, message: '还没填 Key 呀' }

    const started = Date.now()
    try {
      await request(provider, '你是连通性测试助手，只回复 ok。', 'ping', 0, {
        maxTokens: 16,
        timeoutMs: 15000,
      })
      return { ok: true, ms: Date.now() - started, message: '连上啦' }
    } catch (err) {
      return {
        ok: false,
        ms: Date.now() - started,
        message: err instanceof Error ? err.message : '请求失败',
      }
    }
  }

  async function breakdownGoal(goal: string, existingTitles: string[] = []): Promise<string[]> {
    const text = await chat(
      '你是任务拆解助手。把用户的目标拆成 3-6 条具体、能在一次专注内开始动手的任务。每条以动词开头，不超过 18 个字，不要编号。只输出 JSON，格式：{"tasks":["任务1","任务2"]}',
      `目标：${goal.trim()}\n已有任务：${existingTitles.slice(0, 20).join('；') || '无'}`,
    )
    return parseTaskList(text)
  }

  async function suggestToday(tasks: PlanTaskInput[], todayPomodoros: number): Promise<string> {
    const payload = {
      todayPomodoros,
      tasks: tasks.slice(0, 20),
    }
    return chat(
      '你是专注计划助手。根据任务清单和今日已完成的番茄数，给出今天最值得先做的 3 件事，并为每件事建议番茄数。使用「1. 任务名：建议 n 个番茄，理由一句话」的格式，总字数不超过 200，不要输出其它内容。',
      JSON.stringify(payload),
      0.5,
    )
  }

  async function polishMemo(content: string): Promise<string> {
    const plain = content.trim()
    if (!plain) throw new Error('这条小记还空空的呀')
    const system = `你是中文笔记编辑，只做一件事：把用户随手写的碎片改写成规范的书面笔记。
规则：
1. 只改写用户写的内容，一条一行，以「• 」开头。
2. 把「写写」「整理整理」这类重复口语改成简洁的书面说法。
3. 不新增用户没写的事实、数量、日期。
4. 只输出改写后的条目，不要解释，不要复述规则。
示例：
输入：写写算法题 整理整理笔记
输出：
• 练习算法题
• 整理笔记`
    return chat(system, plain.slice(0, 2000), 0.2)
  }

  async function coachToday(ctx: CoachContext): Promise<string> {
    return chat(
      '你是专注小管家。根据用户今天随手记的计划、待办任务和已完成的番茄，给出接下来最值得做的事。要求：最多 3 条，总字数不超过 100 字，直接给动作，不要重复原文，不要输出标题或前言。语气轻轻软软的，可以带一点点撒娇，但别浮夸。',
      JSON.stringify(ctx),
      0.4,
    )
  }

  async function evaluatePlan(plan: string, extra: string, tasks: PlanTaskInput[]): Promise<string> {
    return chat(
      '你是计划评估助手。先指出计划里最明显的风险或遗漏（2-3 条），再给出一份按天或按时段的粗略安排。输出分两段：「评估」和「安排」，总字数不超过 400，不要输出多余内容。',
      JSON.stringify({ plan: plan.slice(0, 2000), extra: extra.slice(0, 500), tasks }),
      0.5,
    )
  }

  async function suggestTaskNames(idea: string): Promise<string[]> {
    const text = await chat(
      '你是任务命名助手。把用户粗糙的想法改写成规范的待办标题：动词开头、不超过 16 个字、不加语气词和编号。给出 3 个候选。只输出 JSON：{"names":["候选1","候选2","候选3"]}',
      idea.slice(0, 200),
      0.4,
    )
    return parseNameList(text)
  }

  async function generatePlan(prompt: string, extra: string, tasks: PlanTaskInput[]): Promise<PlanArtifacts> {
    const text = await chat(
      '你是计划助手。把用户的想法整理成可执行的待办任务和一份简短备忘。只输出 JSON：{"tasks":["任务1","任务2"],"memo":{"title":"标题","content":"正文"}}。任务 3~8 条，动词开头，每条不超过 18 个字；备忘标题不超过 12 个字，正文用短行列出关键安排。不要编造用户没提过的事实。',
      JSON.stringify({ idea: prompt.slice(0, 1500), extra: extra.slice(0, 300), existingTasks: tasks }),
      0.5,
      { thinking: true, maxTokens: 2048, timeoutMs: LONG_REQUEST_TIMEOUT_MS },
    )
    const raw = stripCodeFence(text)
    try {
      const data = JSON.parse(raw)
      const taskList = Array.isArray(data?.tasks)
        ? data.tasks.map((t: unknown) => String(t ?? '').trim()).filter(Boolean).slice(0, 8)
        : []
      const memo = data?.memo ?? {}
      const memoTitle = String(memo.title ?? '').trim() || '计划草稿'
      const memoContent = String(memo.content ?? '').trim()
      if (taskList.length > 0 || memoContent.length > 0) {
        return { tasks: taskList, memoTitle, memoContent }
      }
    } catch {
      // 解析失败时按纯文本兜底
    }
    return { tasks: parseTaskList(text), memoTitle: '计划草稿', memoContent: raw }
  }

  /**
   * 把一段口语化的文字提炼成一条日程。
   * 模型自己推算相对日期会错，所以把未来两周的对照表塞进 system，让它查表。
   */
  async function extractEvent(raw: string, now: Date = new Date()): Promise<ExtractedEvent> {
    const today = toLocalDateStr(now)
    const system = `你是日程整理助手。把用户这段口语化的文字整理成一条规范日程，只输出 JSON：
{"title":"事件名，不超过 20 字","at":"YYYY-MM-DD 或 YYYY-MM-DDTHH:mm","note":"关键信息，不超过 100 字","tag":"work|life|study|other"}
今天是 ${today} ${WEEKDAY_NAMES[now.getDay()]}。
接下来两周的日期对照：${buildDateTable(now)}
「明天」「周五」「下周三」这类说法必须按下表换算成具体日期，不要自己推算。
原文没写日期就用今天，没写时间就只给日期。标题要提炼成能一眼看懂的一件事，不要把整段话塞进去。不要编造原文没有的事实，不要输出 JSON 之外的任何内容。`
    const text = await chat(system, raw.slice(0, 2000), 0.2)
    const json = stripCodeFence(text)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(json) as Record<string, unknown>
    } catch {
      throw new Error('它写乱啦，再试一次好不好～')
    }
    const title = String(data.title ?? '').trim()
    if (!title) throw new Error('这次没整理出名字，再试一次嘛')
    const rawAt = String(data.at ?? '').trim()
    const at = /^\d{4}-\d{2}-\d{2}/.test(rawAt) ? rawAt.slice(0, 16) : today
    const tag = String(data.tag ?? 'other')
    return {
      title: title.slice(0, 40),
      at,
      note: String(data.note ?? '').trim().slice(0, 200),
      tag: ['work', 'life', 'study', 'other'].includes(tag) ? tag : 'other',
    }
  }

  return {
    configured,
    testProvider,
    breakdownGoal,
    suggestToday,
    polishMemo,
    coachToday,
    evaluatePlan,
    suggestTaskNames,
    generatePlan,
    extractEvent,
  }
}
