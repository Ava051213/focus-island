import { computed, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { fetch } from '@tauri-apps/plugin-http'

/** 仓库里的静态版本文件，GitHub API 对未认证请求限流太严，不用它 */
const LATEST_JSON = 'https://raw.githubusercontent.com/Ava051213/focus-island/clean-main/latest.json'
const RELEASE_PAGE = 'https://github.com/Ava051213/focus-island/releases/latest'

/** 启动后再等一会才查，别跟首屏抢资源 */
const STARTUP_DELAY_MS = 10_000

export interface UpdateInfo {
  version: string
  url: string
}

const currentVersion = ref('')
const latest = ref<UpdateInfo | null>(null)
const checking = ref(false)
const checkedAt = ref<number | null>(null)
const error = ref('')
const hasUpdate = ref(false)

let inflight: Promise<void> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null

/** 只比数字段：1.2.10 比 1.2.9 新，后缀一律忽略 */
export function isNewerVersion(latestVersion: string, baseVersion: string): boolean {
  const parse = (value: string) => value.replace(/^v/i, '').split(/[.-]/)
  const next = parse(latestVersion)
  const base = parse(baseVersion)
  for (let i = 0; i < 3; i++) {
    const a = Number(next[i]) || 0
    const b = Number(base[i]) || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

async function ensureVersion(): Promise<string> {
  if (currentVersion.value) return currentVersion.value
  try {
    currentVersion.value = await getVersion()
  } catch {
    // 非 Tauri 环境（Web 预览、测试）拿不到版本，视为不检查
    currentVersion.value = ''
  }
  return currentVersion.value
}

async function runCheck(silent: boolean) {
  checking.value = true
  if (!silent) error.value = ''
  try {
    const current = await ensureVersion()
    if (!current) throw new Error('no current version')
    const response = await fetch(LATEST_JSON, { headers: { 'User-Agent': 'focus-island' } })
    if (!response.ok) throw new Error(String(response.status))
    const data = await response.json() as { version?: string; url?: string }
    const version = String(data.version ?? '').trim()
    if (!version) throw new Error('no version')
    latest.value = { version, url: String(data.url ?? '') || RELEASE_PAGE }
    hasUpdate.value = isNewerVersion(version, current)
    checkedAt.value = Date.now()
  } catch {
    // 静默检查失败不留痕迹，别为了一次网络抖动打扰用户
    if (!silent) error.value = '检查失败，稍后再试'
  } finally {
    checking.value = false
  }
}

/** 手动和启动共用一次请求，避免重复打同一个文件 */
export function checkForUpdate(options: { silent?: boolean } = {}): Promise<void> {
  if (inflight) return inflight
  const silent = Boolean(options.silent)
  inflight = runCheck(silent).finally(() => {
    inflight = null
  })
  return inflight
}

/** 启动时排一次静默检查；重复调用不会叠加定时器 */
export function scheduleStartupCheck() {
  if (startupTimer) return
  startupTimer = setTimeout(() => {
    startupTimer = null
    void checkForUpdate({ silent: true })
  }, STARTUP_DELAY_MS)
}

export function useUpdateCheck() {
  const hint = computed(() => {
    if (hasUpdate.value) return ''
    if (checkedAt.value === null) return ''
    return '已是最新版本'
  })

  return {
    currentVersion,
    latest,
    checking,
    checkedAt,
    error,
    hasUpdate,
    hint,
    check: checkForUpdate,
    releaseUrl: computed(() => latest.value?.url || RELEASE_PAGE),
  }
}
