/**
 * 持久化数据的版本入口（纯逻辑）
 *
 * 文件统一写成 { schemaVersion, data }；旧文件没有版本号时按当前结构读取。
 * 高版本数据不猜测、不覆盖，交给持久化层备份并禁止写入。
 */

export const CORE_SCHEMA_VERSION = 1

export interface VersionedEnvelope<T = unknown> {
  schemaVersion: number
  data: T
}

export class UnknownSchemaVersionError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(foundVersion: number, supportedVersion: number) {
    super(`数据版本 ${foundVersion} 高于当前支持的 ${supportedVersion}，已停止写入以保护原文件`)
    this.name = 'UnknownSchemaVersionError'
    this.foundVersion = foundVersion
    this.supportedVersion = supportedVersion
  }
}

export class MigrationUnavailableError extends Error {
  readonly fromVersion: number
  readonly targetVersion: number

  constructor(fromVersion: number, targetVersion: number) {
    super(`缺少从版本 ${fromVersion} 到 ${targetVersion} 的迁移函数`)
    this.name = 'MigrationUnavailableError'
    this.fromVersion = fromVersion
    this.targetVersion = targetVersion
  }
}

export class InvalidSchemaEnvelopeError extends Error {
  constructor() {
    super('schemaVersion 字段不合法')
    this.name = 'InvalidSchemaEnvelopeError'
  }
}

/** 每个函数负责把数据从 n 升到 n+1；未来加版本时往这里补 */
export type Migration = (data: unknown) => unknown

export interface MigrateOptions<T> {
  currentVersion?: number
  migrations?: Record<number, Migration>
  /** 迁移完成后的校验/归一化；抛错表示数据不可用 */
  validate?: (data: unknown) => T
}

export interface MigrateResult<T> {
  data: T
  version: number
  /** 是否执行过低版本迁移 */
  migrated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function wrapWithVersion<T>(data: T, version: number = CORE_SCHEMA_VERSION): VersionedEnvelope<T> {
  return { schemaVersion: version, data }
}

export function isVersionedEnvelope(value: unknown): value is VersionedEnvelope {
  return isRecord(value)
    && typeof value.schemaVersion === 'number'
    && 'data' in value
}

/**
 * 当前版本原样返回；低版本走迁移链；未知高版本抛 UnknownSchemaVersionError。
 * 没有 schemaVersion 的旧文件按当前结构读取，避免升级时误伤历史数据。
 */
export function migrate<T = unknown>(
  raw: unknown,
  options: MigrateOptions<T> = {},
): MigrateResult<T> {
  const currentVersion = options.currentVersion ?? CORE_SCHEMA_VERSION
  const validate = options.validate ?? ((data: unknown) => data as T)

  if (!isVersionedEnvelope(raw)) {
    if (isRecord(raw) && 'schemaVersion' in raw) throw new InvalidSchemaEnvelopeError()
    return { data: validate(raw), version: currentVersion, migrated: false }
  }

  const version = raw.schemaVersion
  if (!Number.isInteger(version) || version < 0) throw new InvalidSchemaEnvelopeError()
  if (version > currentVersion) throw new UnknownSchemaVersionError(version, currentVersion)
  if (version === currentVersion) {
    return { data: validate(raw.data), version: currentVersion, migrated: false }
  }

  let data = raw.data
  let cursor = version
  while (cursor < currentVersion) {
    const step = options.migrations?.[cursor]
    if (!step) throw new MigrationUnavailableError(cursor, currentVersion)
    data = step(data)
    cursor += 1
  }

  return { data: validate(data), version: currentVersion, migrated: true }
}
