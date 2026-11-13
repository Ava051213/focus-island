/**
 * 泡泡文案池与选句逻辑（纯函数）。
 *
 * 未晚的随口一句话：娇气、陪伴、年下伙伴口吻。全部本地模板，
 * 不调模型——没 Key 也照常吐泡泡。
 */

export type BubbleKind = 'coquetry' | 'idle' | 'comfort' | 'test'

const POOLS: Record<BubbleKind, string[]> = {
  // 撒娇：平时随机冒一句，求关注
  coquetry: [
    '好久没人理我啦…',
    '喂——看一下我嘛',
    '今天也要摸摸头再开工哦',
    '哼，光顾着干活，都不理人家',
    '我在这呢，累了就看我一眼',
    '摸摸我，充个电',
    '偷偷看着你呢，加油呀',
    '待在我旁边，会更稳哦',
    '你是不是忘了我呀？',
    '盯——你被小岛盯着呢',
    '今天的你，也要记得喝水呀',
    '别绷太紧，我也会心疼的',
    '陪我待一会儿嘛',
    '嗯哼？在想什么呢',
    '你专注的样子，最好看了',
    '嗒哒——小岛营业中',
  ],
  // 闲置喊话：人跑了，喊回来
  idle: [
    '人呢——？',
    '跑哪里去啦，回来嘛',
    '喂！屏幕前的那位',
    '别把我一个人丢在这呀',
    '回来回来，还有事没做完呢',
    '我等你很久了哦',
    '去哪野了？快回来',
    '再不回来我要收摊了哦',
  ],
  // 哄人：跳过/放弃一轮时的安慰
  comfort: [
    '没关系的，歇会儿也不亏',
    '这轮不算数，下轮稳的',
    '你已经很努力了啦',
    '停下也是一种进度哦',
    '别懊恼啦，我陪你重新来',
    '累就累了，不丢人',
    '一次而已，天没塌',
    '休息好，才追得上呀',
  ],
  // 设置页「吐一个试试」
  test: [
    '叮——泡泡测试！',
    '叫我吗？我在呢~',
    '泡泡发射成功！',
  ],
}

/** 选一句：避开最近说过的，池子里全说过就随便来 */
export function pickBubbleLine(kind: BubbleKind, recent: readonly string[], rand: () => number = Math.random): string {
  const pool = POOLS[kind]
  const fresh = pool.filter(line => !recent.includes(line))
  const source = fresh.length > 0 ? fresh : pool
  return source[Math.floor(rand() * source.length)]
}

/** 密度档位 → 撒娇泡泡的基础间隔（毫秒）；调用方在此基础上加随机抖动 */
export const BUBBLE_TONE_MS: Record<'quiet' | 'normal' | 'lively', number> = {
  quiet: 30 * 60 * 1000,
  normal: 12 * 60 * 1000,
  lively: 5 * 60 * 1000,
}
