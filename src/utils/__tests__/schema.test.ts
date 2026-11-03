import { describe, expect, it } from 'vitest'
import {
  CORE_SCHEMA_VERSION,
  InvalidSchemaEnvelopeError,
  MigrationUnavailableError,
  UnknownSchemaVersionError,
  isVersionedEnvelope,
  migrate,
  wrapWithVersion,
} from '../schema'

describe('schema version', () => {
  it('没有版本号的旧文件按当前结构读取', () => {
    const legacy = [{ id: 'a' }, { id: 'b' }]
    const result = migrate(legacy)

    expect(result.version).toBe(CORE_SCHEMA_VERSION)
    expect(result.migrated).toBe(false)
    expect(result.data).toEqual(legacy)
  })

  it('当前版本原样返回 data', () => {
    const data = { items: [{ id: 'a' }] }
    const raw = wrapWithVersion(data)

    expect(isVersionedEnvelope(raw)).toBe(true)
    const result = migrate(raw)
    expect(result.version).toBe(CORE_SCHEMA_VERSION)
    expect(result.migrated).toBe(false)
    expect(result.data).toEqual(data)
  })

  it('未知高版本直接抛错，调用方可以备份并停止写入', () => {
    const raw = { schemaVersion: CORE_SCHEMA_VERSION + 3, data: { anything: true } }

    expect(() => migrate(raw)).toThrow(UnknownSchemaVersionError)
    try {
      migrate(raw)
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownSchemaVersionError)
      expect((error as UnknownSchemaVersionError).foundVersion).toBe(CORE_SCHEMA_VERSION + 3)
      expect((error as UnknownSchemaVersionError).supportedVersion).toBe(CORE_SCHEMA_VERSION)
    }
  })

  it('低版本按迁移链升级', () => {
    const result = migrate<{ value: string }>(
      { schemaVersion: 0, data: { value: 'old' } },
      {
        currentVersion: 2,
        migrations: {
          0: (data) => ({ ...(data as object), step1: true }),
          1: (data) => ({ ...(data as object), value: `${(data as { value: string }).value}-new` }),
        },
        validate: (data) => data as { value: string },
      },
    )

    expect(result.version).toBe(2)
    expect(result.migrated).toBe(true)
    expect(result.data).toEqual({ value: 'old-new', step1: true })
  })

  it('缺少迁移函数时抛 MigrationUnavailableError', () => {
    expect(() => migrate({ schemaVersion: 0, data: {} }, { currentVersion: 1 }))
      .toThrow(MigrationUnavailableError)
  })

  it('schemaVersion 字段不合法时抛 InvalidSchemaEnvelopeError', () => {
    expect(() => migrate({ schemaVersion: '1', data: {} }))
      .toThrow(InvalidSchemaEnvelopeError)
    expect(() => migrate({ schemaVersion: -1, data: {} }))
      .toThrow(InvalidSchemaEnvelopeError)
  })

  it('校验函数抛错会向上传递，由持久化层决定备份', () => {
    expect(() => migrate([], {
      validate: () => {
        throw new Error('bad data')
      },
    })).toThrow('bad data')
  })
})
