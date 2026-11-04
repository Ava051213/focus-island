/**
 * 快速记一条的跨组件信号。
 *
 * Rust 侧只发 `shortcut-command: show-window`，PanelApp 用它切回首页，
 * HomePage 用它把焦点放到快速输入框；两边共享同一个计数器即可，
 * 不需要新增事件或快捷键注册。
 */
import { ref } from 'vue'

export const quickAddRequest = ref(0)

export function requestQuickAddFocus() {
  quickAddRequest.value += 1
}
