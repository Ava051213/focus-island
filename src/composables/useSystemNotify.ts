/**
 * 系统通知（专注结束 / 休息结束 / 首次隐藏到托盘提示）。
 *
 * 只在现有 `pendingNotification` 时机被调用，不新增计时触发点。
 * 通知开关关闭时不申请权限、不发送；发送失败只记录，不影响计时。
 */
import { ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { useSettings } from './useSettings'
import type { NotificationType } from './useTimer'

export type NotificationPermissionState = 'granted' | 'denied' | 'unknown' | 'unavailable'

/** 当前系统通知权限，设置页直接展示 */
export const permissionState = ref<NotificationPermissionState>('unknown')

export interface NotificationMessage {
  title: string
  body: string
}

/** 通知正文纯函数，方便单测 */
export function buildPhaseMessage(
  type: NonNullable<NotificationType>,
  taskTitle: string | null,
): NotificationMessage {
  const task = taskTitle?.trim()
  if (type === 'focus-done') {
    return {
      title: '专注结束',
      body: task
        ? `「${task}」专注完成，休息一下吧`
        : '专注完成，休息一下吧',
    }
  }
  return {
    title: '休息结束',
    body: task ? `休息结束，继续「${task}」吧` : '休息结束，开始下一轮吧',
  }
}

/**
 * 平台支持的系统提示音名称。
 * Windows 的 toast 不接受这个名字，直接省略并使用系统默认表现；
 * 传错名字也不会报错，只是静默。
 */
function soundName(enabled: boolean): string | undefined {
  if (!enabled || typeof navigator === 'undefined') return undefined
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'Glass'
  if (ua.includes('linux')) return 'message-new-instant'
  return undefined
}

export async function refreshNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isTauri()) {
    permissionState.value = 'unavailable'
    return permissionState.value
  }
  try {
    permissionState.value = (await isPermissionGranted()) ? 'granted' : 'denied'
  } catch (error) {
    console.error('[notification] permission check failed', error)
    permissionState.value = 'unknown'
  }
  return permissionState.value
}

/** 首次需要时申请一次；拒绝后不再反复弹 */
async function ensurePermission(): Promise<boolean> {
  if (!isTauri()) {
    permissionState.value = 'unavailable'
    return false
  }
  const { settings } = useSettings()
  try {
    if (await isPermissionGranted()) {
      permissionState.value = 'granted'
      return true
    }
    if (settings.value.notifications.permissionAsked) {
      permissionState.value = 'denied'
      return false
    }
    settings.value.notifications.permissionAsked = true
    const result = await requestPermission()
    permissionState.value = result === 'granted' ? 'granted' : 'denied'
    return result === 'granted'
  } catch (error) {
    console.error('[notification] permission request failed', error)
    permissionState.value = 'unknown'
    return false
  }
}

/** 专注/休息结束的系统通知；返回是否真的发出 */
export async function notifyPhaseEnd(
  type: NonNullable<NotificationType>,
  taskTitle: string | null,
): Promise<boolean> {
  const { settings } = useSettings()
  if (!settings.value.notifications.enabled) return false
  if (!(await ensurePermission())) return false

  const message = buildPhaseMessage(type, taskTitle)
  try {
    sendNotification({
      title: message.title,
      body: message.body,
      sound: soundName(settings.value.notifications.sound),
    })
    return true
  } catch (error) {
    console.error('[notification] send failed', error)
    return false
  }
}

/** 第一次隐藏到托盘时提醒用户还能恢复 */
export async function notifyTrayHidden(): Promise<boolean> {
  const { settings } = useSettings()
  if (!settings.value.notifications.enabled) return false
  if (!(await ensurePermission())) return false

  try {
    sendNotification({
      title: '专注岛已藏到托盘',
      body: '点击托盘图标恢复显示',
      sound: soundName(settings.value.notifications.sound),
    })
    return true
  } catch (error) {
    console.error('[notification] tray hint failed', error)
    return false
  }
}
