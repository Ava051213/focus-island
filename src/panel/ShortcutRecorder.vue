<script setup lang="ts">
import { onMounted, onUnmounted, onActivated, onDeactivated, ref } from 'vue'
import { formatShortcut } from '../utils/shortcuts'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const isRecording = ref(false)
let recordedKey = ''

function startRecording() {
  if (props.disabled) return
  isRecording.value = true
}

function stopRecording() {
  isRecording.value = false
}

function buildCombo(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.metaKey) mods.push('CommandOrControl')
  if (e.shiftKey) mods.push('Shift')

  const code = e.code
  let keyName: string
  if (code.startsWith('Key')) keyName = code.slice(3)
  else if (code.startsWith('Digit')) keyName = code.slice(5)
  else keyName = code

  return mods.join('+') + '+' + keyName
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!isRecording.value) return
  // 只按下修饰键时先不记录，等真正的键
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Shift') return
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return

  e.preventDefault()
  e.stopPropagation()
  recordedKey = buildCombo(e)
}

function onRecordKeyup(e: KeyboardEvent) {
  if (!isRecording.value) return

  // 某些组合（例如 macOS 的 Option+Space）keydown 会被系统吞掉，从 keyup 兜底
  if (!recordedKey && (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)) {
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta' && e.key !== 'Shift') {
      recordedKey = buildCombo(e)
    }
  }

  // 所有修饰键都松开后再落值，避免把半截组合存进去
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (recordedKey) {
      emit('update:modelValue', recordedKey)
      recordedKey = ''
      isRecording.value = false
    } else {
      isRecording.value = false
    }
  }
}

function resetRecording() {
  stopRecording()
  recordedKey = ''
}

let listenersBound = false

function bindListeners() {
  if (listenersBound) return
  document.addEventListener('keydown', onRecordKeydown, true)
  document.addEventListener('keyup', onRecordKeyup, true)
  listenersBound = true
}

function unbindListeners() {
  if (!listenersBound) return
  document.removeEventListener('keydown', onRecordKeydown, true)
  document.removeEventListener('keyup', onRecordKeyup, true)
  listenersBound = false
}

onMounted(bindListeners)
onActivated(bindListeners)
onDeactivated(() => {
  resetRecording()
  unbindListeners()
})
onUnmounted(unbindListeners)
</script>

<template>
  <button
    class="shortcut-recorder"
    :class="{ recording: isRecording }"
    :disabled="disabled"
    tabindex="0"
    @click="startRecording"
  >
    <span v-if="isRecording" class="recording-hint">按一个组合键嘛…</span>
    <span v-else>{{ modelValue ? formatShortcut(modelValue) : (placeholder ?? '未设置') }}</span>
  </button>
</template>

<style scoped>
@reference "../styles.css";

.shortcut-recorder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 120px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.shortcut-recorder:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.25);
}

.shortcut-recorder:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.shortcut-recorder.recording {
  border-color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  box-shadow: 0 0 0 1px var(--focus-color);
  animation: recorder-pulse 1.2s ease-in-out infinite;
}

@keyframes recorder-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--focus-color); }
  50% { box-shadow: 0 0 0 2px var(--focus-color), 0 0 8px color-mix(in srgb, var(--focus-color) 40%, transparent); }
}

.recording-hint {
  color: var(--focus-color);
  font-weight: 500;
}
</style>
