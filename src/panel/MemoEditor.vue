<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import type { Memo, MemoCategory } from '../composables/useMemos'
import MemoCategoryDropdown from './MemoCategoryDropdown.vue'
import EditorToolbar from './EditorToolbar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import { useAi } from '../composables/useAi'
import { useMemoAutoSave } from '../composables/useMemoAutoSave'
import { useRichTextEditor } from '../composables/useRichTextEditor'
import { sanitizeHtml } from '../utils/sanitizeHtml'

const props = defineProps<{
  memo: Memo
  categories: MemoCategory[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<Pick<Memo, 'title' | 'content' | 'categoryId' | 'isPinned' | 'estimatedPomodoros'>>]
  delete: []
  back: [isEmpty: boolean]
}>()

// Local state
const localTitle = ref(props.memo.title)
const localContent = ref(props.memo.content)
const localCategoryId = ref(props.memo.categoryId)
const localIsPinned = ref(props.memo.isPinned)
const localEstimatedPomodoros = ref(props.memo.estimatedPomodoros ?? 0)
const rewriting = ref(false)
const rewriteError = ref('')
const rewriteErrorExpanded = ref(false)
const editorRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const showDeleteConfirm = ref(false)
const showColorPicker = ref(false)
const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const hasSelection = ref(false)

const { schedule: scheduleSave, saveNow } = useMemoAutoSave({
  collect: () => ({
    title: localTitle.value,
    content: localContent.value,
    categoryId: localCategoryId.value,
    isPinned: localIsPinned.value,
    estimatedPomodoros: localEstimatedPomodoros.value,
  }),
  commit: patch => emit('update', patch),
})

const {
  activeFormats,
  currentColor,
  getRange,
  placeCaretAtEnd,
  saveSelection,
  toggleBold,
  toggleItalic,
  setTextColor: applyTextColor,
  createCheckboxItem,
  normalizeCheckboxText,
  insertCheckbox,
  insertDivider,
  handleCheckboxClick,
  insertHtml,
  selectAll,
  updateActiveFormats,
} = useRichTextEditor({ editor: editorRef, onChange: onContentChange })

// Sync local state when memo changes
watch(() => props.memo, (newMemo) => {
  localTitle.value = newMemo.title
  localContent.value = newMemo.content
  localCategoryId.value = newMemo.categoryId
  localIsPinned.value = newMemo.isPinned
  localEstimatedPomodoros.value = newMemo.estimatedPomodoros ?? 0
}, { deep: true })

// Category change
function onCategoryChange() {
  scheduleSave()
}

/** 预计番茄：0 表示还没估，上下调整后自动保存 */
function adjustEstimate(delta: number) {
  localEstimatedPomodoros.value = Math.min(99, Math.max(0, localEstimatedPomodoros.value + delta))
  scheduleSave()
}

// Pin toggle
function togglePin() {
  localIsPinned.value = !localIsPinned.value
  scheduleSave()
}

function setTextColor(color: string) {
  applyTextColor(color)
  showColorPicker.value = false
}

// 正文里的复选框点击只做转发，具体处理在 useRichTextEditor
function onEditorClick(e: MouseEvent) {
  handleCheckboxClick(e.target as HTMLElement)
}

function triggerImageUpload() {
  fileInputRef.value?.click()
}

function handleImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // Check file type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    alert('仅支持 png, jpg, jpeg, gif, webp 格式的图片')
    input.value = ''
    return
  }

  insertImageFromFile(file)

  // Reset input
  input.value = ''
}

// Content change handler
function onContentChange() {
  if (editorRef.value) {
    localContent.value = editorRef.value.innerHTML
  }
  scheduleSave()
}

// AI 生成：把随手写的碎片改写成规范笔记，替换原文并直接存回列表
const { polishMemo } = useAi()

function textToHtml(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br>')
}

async function rewriteAndSave() {
  if (rewriting.value) return
  const plain = (editorRef.value?.innerText ?? '').trim()
  if (!plain) {
    rewriteError.value = '先写点什么嘛～'
    editorRef.value?.focus()
    return
  }

  rewriting.value = true
  rewriteError.value = ''
  rewriteErrorExpanded.value = false
  try {
    const result = await polishMemo(plain)
    localTitle.value = result.title
    localContent.value = textToHtml(result.content)
    if (editorRef.value) editorRef.value.innerHTML = localContent.value
    saveNow()
    emit('back', false)
  } catch (e) {
    rewriteError.value = e instanceof Error ? e.message : String(e)
  } finally {
    rewriting.value = false
  }
}

// Handle paste - support text, HTML, and images (screenshots)
async function onPaste(e: ClipboardEvent) {
  e.preventDefault()

  const clipboardData = e.clipboardData
  if (!clipboardData) return

  // Check for images first (screenshots)
  const items = clipboardData.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile()
        if (blob) {
          await insertImageFromFile(blob)
          return
        }
      }
    }
  }

  // Fall back to text/HTML paste
  const text = clipboardData.getData('text/plain') || ''
  const html = clipboardData.getData('text/html') || ''

  const safeHtml = html ? sanitizeHtml(html) : ''
  if (safeHtml) {
    insertHtml(safeHtml)
  } else {
    document.execCommand('insertText', false, text)
    onContentChange()
  }
}

// Insert image from File/Blob
// 正文里存的是 base64，原图直塞会把 memos.json 撑到几 MB，插入前先压到限宽内
const IMAGE_MAX_EDGE = 1280
const IMAGE_QUALITY = 0.8

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// 压不了（GIF 会丢动画、解码失败）或压完反而更大时返回 null，用原图
async function compressImage(file: File): Promise<Blob | null> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', IMAGE_QUALITY),
    )
    return blob && blob.size < file.size ? blob : null
  } catch {
    return null
  }
}

async function insertImageFromFile(file: File) {
  // Check file size (2MB limit)
  if (file.size > 2 * 1024 * 1024) {
    alert('图片大小不能超过 2MB')
    return
  }

  try {
    const compressed = await compressImage(file)
    const base64 = await readAsDataUrl(compressed ?? file)
    const imgHtml = `<img src="${base64}" class="memo-image" style="max-width: 100%; border-radius: 8px; margin: 8px 0;">`

    editorRef.value?.focus()
    insertHtml(imgHtml)
  } catch {
    // 读文件失败就不插入
  }
}

// Delete confirmation
function handleDelete() {
  showDeleteConfirm.value = true
}

function confirmDelete() {
  showDeleteConfirm.value = false
  emit('delete')
}

function cancelDelete() {
  showDeleteConfirm.value = false
}

// Check if current editor content is empty
function isContentEmpty(): boolean {
  const hasTitle = localTitle.value.trim().length > 0
  const hasContent = localContent.value.replace(/<[^>]+>/g, '').trim().length > 0
  return !hasTitle && !hasContent
}

// Back handler
function handleBack() {
  saveNow()
  emit('back', isContentEmpty())
}

// Keyboard shortcuts
function onEditorKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return

  // Shift+回车 = AI 整理并存回列表；普通回车照常换行
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    void rewriteAndSave()
    return
  }

  // Ctrl/Cmd + B for bold
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault()
    toggleBold()
    return
  }
  // Ctrl/Cmd + I for italic
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault()
    toggleItalic()
    return
  }
  // Ctrl/Cmd + S for save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveNow()
    return
  }

  // Handle Enter in checkbox item - create new checkbox below
  if (e.key === 'Enter' && !e.shiftKey) {
    const selection = window.getSelection()
    const range = getRange(selection)
    if (!range || !range.collapsed) return

    const node = range.startContainer
    const checkboxText = (node instanceof Element ? node : node.parentElement)?.closest('.memo-checkbox-text')
    const checkboxItem = checkboxText?.closest('.memo-checkbox-item')
    if (!checkboxText || !checkboxItem) return

    e.preventDefault()

    const hasText = normalizeCheckboxText(checkboxText.textContent || '').length > 0
    if (hasText) {
      const newWrapper = createCheckboxItem()
      const newTextSpan = newWrapper.querySelector('.memo-checkbox-text')
      checkboxItem.after(newWrapper)
      if (newTextSpan) {
        placeCaretAtEnd(newTextSpan)
      }
    } else {
      // Mainstream behavior: Enter on empty checkbox exits checklist.
      const nextLine = document.createElement('div')
      nextLine.innerHTML = '<br>'
      checkboxItem.after(nextLine)
      checkboxItem.remove()
      placeCaretAtEnd(nextLine)
    }

    saveSelection()
    onContentChange()
    return
  }

  // Handle Backspace to easily delete checkbox
  if (e.key === 'Backspace') {
    const selection = window.getSelection()
    const range = getRange(selection)
    if (!selection || !range || !range.collapsed) return

    const node = range.startContainer
    const checkboxText = (node instanceof Element ? node : node.parentElement)?.closest('.memo-checkbox-text')
    const checkboxItem = checkboxText?.closest('.memo-checkbox-item')
    if (!checkboxText || !checkboxItem) return

    const textContent = normalizeCheckboxText(checkboxText.textContent || '')
    const caretAtStart = (() => {
      const startRange = document.createRange()
      startRange.selectNodeContents(checkboxText)
      startRange.collapse(true)
      return range.compareBoundaryPoints(Range.START_TO_START, startRange) === 0
    })()

    // If at start of checkbox text and text is empty, delete the checkbox
    if (caretAtStart && textContent.length === 0) {
      e.preventDefault()

      const newRange = document.createRange()
      newRange.setStartBefore(checkboxItem)
      newRange.collapse(true)

      checkboxItem.remove()

      selection.removeAllRanges()
      selection.addRange(newRange)
      saveSelection()
      onContentChange()
    }
  }
}

function closeContextMenu() {
  showContextMenu.value = false
}

function onContextMenuAction(action: () => void) {
  action()
  closeContextMenu()
}

function execCopy() {
  document.execCommand('copy', false)
}

async function execPaste() {
  if (!editorRef.value) return

  try {
    const text = await readText()
    if (text) {
      editorRef.value.focus()
      document.execCommand('insertText', false, text)
      onContentChange()
    }
  } catch {
    // 静默失败，不弹窗
  }
}

// Close color picker when clicking outside
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.color-picker')) {
    showColorPicker.value = false
  }
  if (showContextMenu.value && !target.closest('.context-menu')) {
    closeContextMenu()
  }
}

// Handle selection change to update active formats
function onSelectionChange() {
  // Only update if editor is focused
  if (document.activeElement === editorRef.value) {
    updateActiveFormats()
  }
}

// Initialize editor content
onMounted(() => {
  if (editorRef.value) {
    editorRef.value.innerHTML = sanitizeHtml(localContent.value) || '<div><br></div>'
    editorRef.value.focus()
    placeCaretAtEnd(editorRef.value)
  }
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('selectionchange', onSelectionChange)
})

// Cleanup
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('selectionchange', onSelectionChange)
  // 最后一次保存由 useMemoAutoSave 自己的卸载钩子负责
})

// Format update time display
function formatUpdateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}
</script>

<template>
  <div class="memo-editor">
    <!-- Top Bar -->
    <div class="editor-top-bar">
      <button class="top-bar-btn back-btn" @click="handleBack" title="回去啦">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>

      <div class="top-bar-spacer"></div>

      <span class="save-time">{{ formatUpdateTime(props.memo.updatedAt) }}</span>

      <div class="top-bar-actions">
        <button
          class="top-bar-btn pin-btn"
          :class="{ 'is-pinned': localIsPinned }"
          @click="togglePin"
          :title="localIsPinned ? '不用钉着了' : '钉在最上面'"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v8M5 10h14M9 21h6M12 10v11"/>
          </svg>
        </button>

        <button class="top-bar-btn delete-btn" @click="handleDelete" title="不要了">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Category -->
    <div class="editor-title-area">
      <MemoCategoryDropdown
        v-model="localCategoryId"
        :categories="categories"
        size="medium"
        :showNewButton="false"
        @change="onCategoryChange"
      />
      <div class="estimate-stepper" title="预计这条要用几个番茄，未晚会参考它安排今天">
        <button class="estimate-btn" @click="adjustEstimate(-1)">−</button>
        <span class="estimate-value">{{ localEstimatedPomodoros }}</span>
        <button class="estimate-btn" @click="adjustEstimate(1)">+</button>
        <span class="estimate-label">番茄</span>
      </div>
    </div>

    <!-- Rich Text Toolbar -->
    <EditorToolbar
      :active-formats="activeFormats"
      :current-color="currentColor"
      :color-picker-open="showColorPicker"
      @toggle-bold="toggleBold"
      @toggle-italic="toggleItalic"
      @toggle-color-picker="showColorPicker = !showColorPicker"
      @select-color="setTextColor"
      @insert-checkbox="insertCheckbox"
      @insert-divider="insertDivider"
      @upload-image="triggerImageUpload"
    />

    <!-- Editor Content -->
    <div class="editor-content-wrapper">
      <div
        ref="editorRef"
        class="editor-content"
        contenteditable="true"
        @input="onContentChange"
        @paste="onPaste"
        @keydown="onEditorKeydown"
        @click="onEditorClick"
        @blur="saveSelection"
        spellcheck="false"
      ></div>
    </div>

    <!-- 底部确定：回车换行，Shift+回车生成并存回列表 -->
    <div class="editor-bottom">
      <span
        v-if="rewriteError"
        class="rewrite-error"
        :class="{ expanded: rewriteErrorExpanded }"
        @click="rewriteErrorExpanded = !rewriteErrorExpanded"
      >{{ rewriteError }}</span>
      <span v-else class="rewrite-hint">Shift+回车 整理并存回小记</span>
      <button class="rewrite-btn" :disabled="rewriting" @click="rewriteAndSave">
        {{ rewriting ? '写着呢…' : '确定' }}
      </button>
    </div>

    <!-- Hidden File Input for Image Upload -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
      style="display: none"
      @change="handleImageSelected"
    />

    <!-- Delete Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="delete-dialog-overlay" @click="cancelDelete">
      <div class="delete-dialog" @click.stop>
        <div class="delete-dialog-title">🗑️ 真的要丢掉这条小记吗</div>
        <div class="delete-dialog-content">丢掉就捡不回来啦，再想想好不好～</div>
        <div class="delete-dialog-actions">
          <button class="dialog-btn cancel-btn" @click="cancelDelete">再想想</button>
          <button class="dialog-btn confirm-btn" @click="confirmDelete">丢掉吧</button>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <EditorContextMenu
      v-if="showContextMenu"
      :position="contextMenuPosition"
      :has-selection="hasSelection"
      @copy="onContextMenuAction(execCopy)"
      @paste="onContextMenuAction(execPaste)"
      @paste-plain-text="onContextMenuAction(execPaste)"
      @select-all="onContextMenuAction(selectAll)"
    />
  </div>
</template>

<style scoped src="./memo-editor.css"></style>
