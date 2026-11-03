import { ref, watch, type Ref } from 'vue'
import {
  BaseDirectory,
  copyFile,
  exists,
  mkdir,
  readTextFile,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { migrate, UnknownSchemaVersionError, wrapWithVersion } from '../utils/schema'

const DATA_DIR = 'focus-island'
const baseDir = BaseDirectory.AppData
const WRITE_DEBOUNCE_MS = 300

/** 有文件写不进去时给界面用的提示；恢复写入后自动清空 */
export const saveError = ref<string | null>(null)
const failingFiles = new Set<string>()

function refreshSaveError() {
  saveError.value = failingFiles.size > 0
    ? `数据没存上（${Array.from(failingFiles).join('、')}），检查一下磁盘空间或权限`
    : null
}

/** 数据版本高于当前应用时给界面的提示；本次会话不会再写这个文件 */
export const restoreWarning = ref<string | null>(null)

let dataDirReady: Promise<void> | null = null

function ensureDataDir(): Promise<void> {
  if (!dataDirReady) {
    dataDirReady = mkdir(DATA_DIR, { baseDir, recursive: true }).catch((e) => {
      dataDirReady = null
      throw e
    })
  }
  return dataDirReady
}

type ReadResult =
  | { status: 'ok'; data: unknown }
  | { status: 'missing' }
  | { status: 'unreadable' }

interface JsonFile {
  read(): Promise<ReadResult>
  /** Back up an unreadable file before it can be overwritten. */
  quarantine(): Promise<void>
  /** Stop writing for this session (used when the file format is too new to understand). */
  blockWrites(): void
  /** Debounced; writes for the same file are applied strictly in order. */
  write(json: string): void
}

function createJsonFile(name: string, debounceMs: number = WRITE_DEBOUNCE_MS): JsonFile {
  const path = `${DATA_DIR}/${name}`
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let queue: Promise<void> = Promise.resolve()
  // Set when an unreadable file could not be backed up: overwriting it would destroy the only copy.
  let writeBlocked = false

  async function read(): Promise<ReadResult> {
    try {
      if (!(await exists(path, { baseDir }))) return { status: 'missing' }
      const raw = await readTextFile(path, { baseDir })
      return { status: 'ok', data: JSON.parse(raw) }
    } catch (e) {
      console.error(`[persistence] failed to read ${name}`, e)
      return { status: 'unreadable' }
    }
  }

  async function quarantine() {
    try {
      await copyFile(path, `${path}.corrupt-${Date.now()}`, {
        fromPathBaseDir: baseDir,
        toPathBaseDir: baseDir,
      })
    } catch (e) {
      writeBlocked = true
      failingFiles.add(name)
      refreshSaveError()
      console.error(`[persistence] failed to back up ${name}; saving disabled to protect it`, e)
    }
  }

  function flush() {
    timer = null
    if (pending === null) return
    const json = pending
    pending = null
    queue = queue
      .then(async () => {
        if (writeBlocked) return
        await ensureDataDir()
        // Both windows may save the same file; separate temp files keep their renames from colliding.
        const tmpPath = `${path}.${getCurrentWebviewWindow().label}.tmp`
        // Write-then-rename keeps the previous file intact if the app dies mid-write.
        await writeTextFile(tmpPath, json, { baseDir })
        await rename(tmpPath, path, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
        if (failingFiles.delete(name)) refreshSaveError()
      })
      .catch((e) => {
        failingFiles.add(name)
        refreshSaveError()
        console.error(`[persistence] failed to save ${name}`, e)
      })
  }

  function write(json: string) {
    pending = json
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  function blockWrites() {
    writeBlocked = true
  }

  return { read, quarantine, blockWrites, write }
}

function emitToOtherWindow(event: string, payload: string) {
  const self = getCurrentWebviewWindow().label
  const target = self === 'main' ? 'panel' : 'main'
  emitTo(target, event, payload).catch(() => {})
}

export interface PersistedStoreOptions {
  /** File name inside the app data directory. */
  file: string
  /** Reactive getter for the data to persist. */
  snapshot: () => unknown
  /** Apply parsed file (or cross-window) data to the reactive state. Throw if the data is invalid. */
  restore: (data: unknown) => void
  /** Event used to mirror changes into the other window. */
  syncEvent?: string
  /** 写入文件时套上 { schemaVersion, data }；不传保持旧的裸格式 */
  schemaVersion?: number
  /** 写入防抖，默认 300ms；进行中快照传 0 立刻落盘 */
  debounceMs?: number
}

export interface PersistedStore {
  loaded: Ref<boolean>
  ensureLoaded(): Promise<void>
}

export function createPersistedStore(opts: PersistedStoreOptions): PersistedStore {
  const file = createJsonFile(opts.file, opts.debounceMs)
  const loaded = ref(false)
  let loadPromise: Promise<void> | null = null
  // JSON of the state as last loaded, received or saved; unchanged state is never written back.
  let lastJson: string | null = null

  function serialize(data: unknown): string {
    return JSON.stringify(
      opts.schemaVersion === undefined ? data : wrapWithVersion(data, opts.schemaVersion),
    )
  }

  async function load() {
    const result = await file.read()
    // Data from the other window arrived first and is newer than the (possibly debounced) file.
    if (loaded.value) return

    let restored = false
    let fileData: unknown = undefined
    let migrated = false
    if (result.status === 'ok') {
      fileData = result.data
      try {
        if (opts.schemaVersion !== undefined) {
          const migratedResult = migrate(result.data, { currentVersion: opts.schemaVersion })
          fileData = migratedResult.data
          migrated = migratedResult.migrated
        }
        opts.restore(fileData)
        restored = true
      } catch (e) {
        if (e instanceof UnknownSchemaVersionError) {
          // 不认识的高版本：先备份，再禁止写入，避免把用户数据覆盖成旧结构
          await file.quarantine()
          file.blockWrites()
          restoreWarning.value = `${opts.file} 的数据版本高于当前应用支持的版本，已备份原文件并停止写入`
          console.error(`[persistence] ${opts.file} has an unsupported schema version`, e)
        } else {
          console.error(`[persistence] invalid data in ${opts.file}`, e)
          await file.quarantine()
        }
      }
    } else if (result.status === 'unreadable') {
      await file.quarantine()
    }

    const current = opts.snapshot()
    lastJson = JSON.stringify(current)
    loaded.value = true
    // Persist migrations/normalization applied by restore().
    if (restored && result.status === 'ok' && (migrated || lastJson !== JSON.stringify(fileData))) {
      file.write(serialize(current))
    }
  }

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) loadPromise = load()
    return loadPromise
  }

  watch(
    opts.snapshot,
    () => {
      if (!loaded.value) return
      const data = opts.snapshot()
      const json = JSON.stringify(data)
      if (json === lastJson) return
      lastJson = json
      file.write(serialize(data))
      if (opts.syncEvent) emitToOtherWindow(opts.syncEvent, json)
    },
    { deep: true },
  )

  if (opts.syncEvent) {
    const event = opts.syncEvent
    listen<string>(event, ({ payload }) => {
      try {
        opts.restore(JSON.parse(payload))
        lastJson = JSON.stringify(opts.snapshot())
        loaded.value = true
      } catch (e) {
        console.error(`[persistence] invalid ${event} payload`, e)
      }
    }).catch(() => {})
  }

  return { loaded, ensureLoaded }
}
