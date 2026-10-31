import { computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { useSettings } from './useSettings'
import { toLocalDateStr } from '../utils/date'

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

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

  const configured = computed(() => settings.value.aiApiKey.trim().length > 0)

  async function chat(
    system: string,
    user: string,
    temperature = 0.3,
    options: { thinking?: boolean; maxTokens?: number } = {},
  ): Promise<string> {
    const key = settings.value.aiApiKey.trim()
    if (!key) throw new Error('请先在「设置 → AI 助手」中填写 API Key')
    const model = settings.value.aiModel.trim() || 'glm-4.7-flash'

    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // 短任务默认关闭深度思考以减少等待；复杂规划单独开启
          thinking: { type: options.thinking ? 'enabled' : 'disabled' },
          max_tokens: options.maxTokens ?? 1024,
          temperature,
          stream: false,
        }),
        connectTimeout: 20000,
      })
    } catch {
      throw new Error('无法连接 AI 服务，请检查网络或代理设置')
    }

    if (!response.ok) {
      let detail = ''
      try {
        const body = await response.json()
        detail = body?.error?.message ?? ''
      } catch {
        // 忽略解析失败
      }
      throw new Error(`AI 请求失败（${response.status}）${detail ? '：' + detail : ''}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('AI 返回内容为空')
    }
    return content.trim()
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

  async function summarizeMemo(content: string, style: 'summary' | 'checklist'): Promise<string> {
    const plain = content.trim()
    if (!plain) throw new Error('备忘录内容为空')
    const system = style === 'summary'
      ? '你是笔记整理助手。用中文把内容压缩成不超过 150 字的摘要，保留关键结论和数字，不要编造，不要输出标题。'
      : '你是笔记整理助手。把内容整理成要点清单，每行一条并以「• 」开头，保留原有事实和数字，不要编造，不要输出标题。'
    return chat(system, plain.slice(0, 2000), 0.2)
  }

  async function coachToday(ctx: CoachContext): Promise<string> {
    return chat(
      '你是专注小管家。根据用户今天随手记的计划、待办任务和已完成的番茄，给出接下来最值得做的事。要求：最多 3 条，总字数不超过 100 字，直接给动作，不要重复原文，不要输出标题或前言。',
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
      { thinking: true, maxTokens: 2048 },
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
   * 把一大段粘贴文字提炼成一条日程。
   * 模型不知道今天是几号，日期和星期必须写进 system 里。
   */
  async function extractEvent(raw: string, now: Date = new Date()): Promise<ExtractedEvent> {
    const today = toLocalDateStr(now)
    const system = `你是日程整理助手。把用户粘贴的文字提炼成一条日程，只输出 JSON：
{"title":"事件名，不超过 20 字","at":"YYYY-MM-DD 或 YYYY-MM-DDTHH:mm","note":"原文里的关键信息，不超过 100 字","tag":"work|life|study|other"}
今天是 ${today} ${WEEKDAY_NAMES[now.getDay()]}。原文没写日期就用今天，没写时间就只给日期。不要编造原文没有的事实，不要输出 JSON 之外的任何内容。`
    const text = await chat(system, raw.slice(0, 2000), 0.2)
    const json = stripCodeFence(text)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(json) as Record<string, unknown>
    } catch {
      throw new Error('AI 返回的内容无法解析，请重试')
    }
    const title = String(data.title ?? '').trim()
    if (!title) throw new Error('AI 没有提炼出事件名，请重试')
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
    breakdownGoal,
    suggestToday,
    summarizeMemo,
    coachToday,
    evaluatePlan,
    suggestTaskNames,
    generatePlan,
    extractEvent,
  }
}
