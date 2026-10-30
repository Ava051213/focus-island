import { computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import { useSettings } from './useSettings'

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

export interface PlanTaskInput {
  title: string
  dueDate: string | null
  priority: number
  pomodoros: number
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

export function useAi() {
  const { settings } = useSettings()

  const configured = computed(() => settings.value.aiApiKey.trim().length > 0)

  async function chat(system: string, user: string, temperature = 0.3): Promise<string> {
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

  return { configured, breakdownGoal, suggestToday, summarizeMemo }
}
