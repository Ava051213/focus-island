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
  /** 本地时间，例如 2026-10-31 17:10 周五 */
  now: string
  /** 清晨 / 上午 / 中午 / 下午 / 傍晚 / 晚上 / 深夜 */
  timeOfDay: string
  /** 离最近一条日程还有多少分钟；超过一天或没有日程则为 null */
  minutesToNextEvent: number | null
  nextEventTitle: string | null
  /** 一个番茄多少分钟 */
  focusMinutes: number
  memos: Array<{
    id: string
    title: string
    content: string
    pomodoros: number
    daysSinceUpdate: number
    pinned: boolean
  }>
  events: Array<{ title: string; at: string; inMinutes: number | null }>
  overdueCount: number
  todayPomodoros: number
  focusMinutesToday: number
  /** 今天完成归档的小记标题 */
  completedToday: string[]
  /** 最近三条旧建议，用来提醒模型换角度 */
  recentCoaches: string[]
  /** 用户当前的先后偏好 */
  preference: 'hard-first' | 'easy-first' | ''
  /** 用户最近跟团子说过的话，按时间从旧到新 */
  userNotes: string[]
  /** 用户刚刚换掉、不想再看到的小记标题 */
  dismissed: string[]
}

export interface CoachPlan {
  title: string
  /** 建议的时间窗，例如「现在起」「约 21:00」「今天收尾」 */
  when: string
  /** 对应 memos 数组的序号，从 1 开始；没有对应小记为 null */
  memoIndex: number | null
  /** 数据层匹配后回填的小记 id */
  memoId: string | null
  pomodoros: number
  reason: string
}

export interface CoachMessage {
  greeting: string
  plans: CoachPlan[]
  care: string
  closing: string
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
    if (providers.length === 0) throw new Error('我还没拿到钥匙呢～去「设置 → 团子」填一下 Key 呀')

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

  async function polishMemo(content: string): Promise<{ title: string; content: string }> {
    const plain = content.trim()
    if (!plain) throw new Error('这条小记还空空的呀')
    const system = `你是中文笔记编辑，只做一件事：把用户随手写的碎片改写成规范的书面笔记。
只输出 JSON：{"title":"不超过 12 字的短标题","content":"改写后的条目，每条一行，以「• 」开头"}
标题必须根据用户这一次写的内容概括，示例只是格式演示，不要照抄示例文字。
规则：
1. 只改写用户写的内容，不新增事实、数量、日期。
2. 把「写写」「整理整理」这类重复口语改成简洁的书面说法。
3. 不要解释，不要输出 JSON 之外的内容。
示例输入：买牛奶 记得交房租
示例输出：{"title":"生活待办","content":"• 购买牛奶\\n• 缴纳房租"}`
    const text = await chat(system, plain.slice(0, 2000), 0.2)
    const raw = stripCodeFence(text)
    try {
      const data = JSON.parse(raw)
      const title = String(data?.title ?? '').trim().slice(0, 20)
      const body = String(data?.content ?? '').trim()
      if (body) return { title, content: body }
    } catch {
      // 解析失败时按纯文本兜底
    }
    return { title: '', content: raw }
  }

  async function coachToday(ctx: CoachContext): Promise<CoachMessage> {
    const text = await chat(
      `你叫团子，住在用户屏幕顶部的专注岛里，是他的小伙伴，不是客服。说话软一点、短一点，可以偶尔调皮，但不要腻，也不要每句都撒娇。

你要先接住用户，再给今天排个先后。只输出 JSON：
{"greeting":"先回应 userNotes 的最后一句，再带一个今天的具体数字，25-40 字","plans":[{"when":"现在起","memo":小记序号,"title":"小记标题","pomodoros":1,"reason":"为什么现在做，15-25 字"}],"care":"生活提醒，15-30 字","closing":"收尾一句，10-20 字"}

规则：
1. plans 给 1-3 条，顺序就是先做什么、再做什么、最后做什么。when 写建议时间窗：第一条用「现在起」或具体时刻，后面可以写「约 21:10」「今天收尾」。when 不能早于 now 里的当前时刻。
2. 每条 reason 必须引用数据里的事实：放了几天没动、跑过几个番茄、离下一条日程还有多久、今天已专注多久。几条安排的理由要引用不同的事实，别每条都写“今天已专注多久”。禁止“提高效率”“加油”“合理安排时间”这类空话。
3. userNotes 是用户跟你要说的话。非空时，greeting 必须先自然回应最后一句，比如他说累就先让他松口气，不要装没听见。
4. preference 为 hard-first 时先排费脑或重要的小记，easy-first 时先排轻松、能快速完成的。
5. dismissed 里的小记不要再推荐。没有合适的小记时，plans 可以只给 1 条，或推荐处理最近的日程。
6. care 按当前时段说人话，不要编造天气、位置、心情或数据里没有的事。
7. recentCoaches 只是告诉你最近推荐过哪些小记，用来换角度；里面不含时间，也不要照抄任何旧的时刻。现在几点只看 now。
8. closing 要贴合当前时段，晚上还早的时候不要随口说晚安。
9. 一个番茄是 ${ctx.focusMinutes} 分钟。不要 Markdown、不要编号前缀，不要复述原始数据。`,
      JSON.stringify(ctx),
      0.8,
    )
    const raw = stripCodeFence(text)
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      const greeting = String(data?.greeting ?? '').trim()
      const care = String(data?.care ?? '').trim()
      const closing = String(data?.closing ?? '').trim()
      const rawPlans = Array.isArray(data?.plans) ? data.plans : []
      const plans: CoachPlan[] = rawPlans
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((plan) => {
          const memoIndexRaw = Number(plan.memo)
          return {
            title: String(plan.title ?? '').trim().slice(0, 30),
            when: String(plan.when ?? '').trim().slice(0, 12),
            memoIndex: Number.isFinite(memoIndexRaw) && memoIndexRaw > 0 ? memoIndexRaw : null,
            memoId: null,
            pomodoros: Math.min(3, Math.max(1, Number(plan.pomodoros) || 1)),
            reason: String(plan.reason ?? '').trim().slice(0, 80),
          }
        })
        .filter(plan => plan.title.length > 0)
        .slice(0, 3)
      if (greeting || plans.length > 0) {
        return { greeting, plans, care, closing }
      }
    } catch {
      // JSON 解析失败时整段兜底
    }
    return { greeting: raw.slice(0, 240), plans: [], care: '', closing: '' }
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
原文没写日期就用今天，没写时间就只给日期。原文里有多个时间时，取调整后的新时间（例如「原时间…现调整至…」取后者）。节次（如 11-12 节）不是时钟时间，不要换算成 HH:mm，写进 note。标题要提炼成能一眼看懂的一件事，不要把整段话塞进去。不要编造原文没有的事实，不要输出 JSON 之外的任何内容。`
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
