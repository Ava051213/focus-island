<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import type { Memo, MemoCategory } from '../composables/useMemos'
import MemoCategoryDropdown from './MemoCategoryDropdown.vue'
import EditorToolbar from './EditorToolbar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import { useAi } from '../composables/useAi'
import { sanitizeHtml } from '../utils/sanitizeHtml'

const props = defineProps<{
  memo: Memo
  categories: MemoCategory[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<Pick<Memo, 'title' | 'content' | 'categoryId' | 'isPinned'>>]
  delete: []
  back: [isEmpty: boolean]
}>()

// Local state
const localTitle = ref(props.memo.title)
const localContent = ref(props.memo.content)
const localCategoryId = ref(props.memo.categoryId)
const localIsPinned = ref(props.memo.isPinned)
const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
const rewriting = ref(false)
const rewriteError = ref('')
const rewriteErrorExpanded = ref(false)
const editorRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const saveTimeout = ref<number | null>(null)
const showDeleteConfirm = ref(false)
const showColorPicker = ref(false)
const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const hasSelection = ref(false)

// Track active formatting states
const activeFormats = ref<{ bold: boolean; italic: boolean }>({ bold: false, italic: false })

// Track current font color
const currentColor = ref('#ffffff')

// Store last selection to restore after toolbar button clicks
let lastSelectionRange: Range | null = null
const ZERO_WIDTH_SPACE = '\u200B'

function isNodeInEditor(node: Node | null): boolean {
  if (!node || !editorRef.value) return false
  return editorRef.value === node || editorRef.value.contains(node)
}

function getEditorSelectionRange(selection: Selection | null = window.getSelection()): Range | null {
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!isNodeInEditor(range.commonAncestorContainer)) return null
  return range
}

function placeCaretAtEnd(node: Node) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function ensureEditorSelection(): Selection | null {
  const selection = window.getSelection()
  if (getEditorSelectionRange(selection)) return selection

  if (!restoreSelection()) {
    editorRef.value?.focus()
    if (editorRef.value) {
      placeCaretAtEnd(editorRef.value)
    }
  }
  return window.getSelection()
}

function normalizeCheckboxText(text: string): string {
  return text.replaceAll(ZERO_WIDTH_SPACE, '').trim()
}

function createCheckboxItem(): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'memo-checkbox-item'

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'memo-checkbox'
  checkbox.setAttribute('data-memo-checkbox', 'true')

  const textSpan = document.createElement('span')
  textSpan.className = 'memo-checkbox-text'
  textSpan.textContent = ZERO_WIDTH_SPACE

  wrapper.appendChild(checkbox)
  wrapper.appendChild(textSpan)
  return wrapper
}

// Sync local state when memo changes
watch(() => props.memo, (newMemo) => {
  localTitle.value = newMemo.title
  localContent.value = newMemo.content
  localCategoryId.value = newMemo.categoryId
  localIsPinned.value = newMemo.isPinned
}, { deep: true })

// Auto-save on changes - 10s debounce to reduce flickering
const SAVE_DEBOUNCE_MS = 10000

function scheduleSave() {
  // Don't show 'unsaved' immediately - only show after a delay if user stops typing
  if (saveTimeout.value) {
    clearTimeout(saveTimeout.value)
  }
  // Show 'unsaved' after 2 seconds of inactivity, then save after 10 seconds total
  if (saveStatus.value === 'saved') {
    saveTimeout.value = window.setTimeout(() => {
      saveStatus.value = 'unsaved'
      // Schedule actual save after additional delay
      saveTimeout.value = window.setTimeout(() => {
        doSave()
      }, SAVE_DEBOUNCE_MS - 2000)
    }, 2000)
  } else {
    // Already unsaved, just schedule the save
    saveTimeout.value = window.setTimeout(() => {
      doSave()
    }, SAVE_DEBOUNCE_MS)
  }
}

function doSave() {
  saveStatus.value = 'saving'
  emit('update', {
    title: localTitle.value,
    content: localContent.value,
    categoryId: localCategoryId.value,
    isPinned: localIsPinned.value,
  })
  // Simulate brief saving state then show saved
  setTimeout(() => {
    saveStatus.value = 'saved'
  }, 200)
}

// Category change
function onCategoryChange() {
  scheduleSave()
}

// Pin toggle
function togglePin() {
  localIsPinned.value = !localIsPinned.value
  scheduleSave()
}

// Update active format states based on current selection
function updateActiveFormats() {
  activeFormats.value = {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
  }

  // Get current font color
  const colorValue = document.queryCommandValue('foreColor')
  if (colorValue) {
    // Convert rgb() to hex if needed
    currentColor.value = rgbToHex(colorValue)
  }
}

// Convert rgb() color to hex
function rgbToHex(rgb: string): string {
  // If already hex, return as-is
  if (rgb.startsWith('#')) return rgb

  // Parse rgb(r, g, b) format
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (match) {
    const r = parseInt(match[1], 10)
    const g = parseInt(match[2], 10)
    const b = parseInt(match[3], 10)
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
  }

  // Try rgba format
  const rgbaMatch = rgb.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10)
    const g = parseInt(rgbaMatch[2], 10)
    const b = parseInt(rgbaMatch[3], 10)
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
  }

  return '#ffffff'
}

// Save current selection for restoring after toolbar clicks
function saveSelection() {
  const selection = window.getSelection()
  const range = getEditorSelectionRange(selection)
  if (range) {
    lastSelectionRange = range.cloneRange()
  }
}

// Restore saved selection
function restoreSelection(): boolean {
  if (!lastSelectionRange || !editorRef.value) return false
  const commonNode = lastSelectionRange.commonAncestorContainer
  if (!document.contains(commonNode) || !isNodeInEditor(commonNode)) {
    lastSelectionRange = null
    return false
  }

  const selection = window.getSelection()
  if (!selection) return false

  try {
    selection.removeAllRanges()
    selection.addRange(lastSelectionRange)
    return true
  } catch {
    lastSelectionRange = null
    return false
  }
}

// Rich text editing commands
function execCommand(command: string, value: string | undefined = undefined) {
  ensureEditorSelection()

  // Execute command
  document.execCommand(command, false, value)

  // Update active states
  updateActiveFormats()

  onContentChange()
}

function toggleBold() {
  execCommand('bold')
}

function toggleItalic() {
  execCommand('italic')
}

function setTextColor(color: string) {
  execCommand('foreColor', color)
  showColorPicker.value = false
}

function insertCheckbox() {
  const selection = ensureEditorSelection()
  const range = getEditorSelectionRange(selection)
  if (!selection || !range) return

  const wrapper = createCheckboxItem()
  const textSpan = wrapper.querySelector('.memo-checkbox-text')
  if (!textSpan) return

  // Insert at cursor position
  range.deleteContents()
  range.insertNode(wrapper)

  // Move cursor inside textSpan
  placeCaretAtEnd(textSpan)
  saveSelection()

  onContentChange()
}

// Handle checkbox clicks via event delegation
function onEditorClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('memo-checkbox')) {
    // Toggle the checked attribute for styling
    const checkbox = target as HTMLInputElement
    if (checkbox.checked) {
      checkbox.setAttribute('checked', '')
    } else {
      checkbox.removeAttribute('checked')
    }

    // Keep focus inside editor to avoid "Enter no response" after clicking checkbox
    const textSpan = checkbox.closest('.memo-checkbox-item')?.querySelector('.memo-checkbox-text')
    if (textSpan) {
      editorRef.value?.focus()
      placeCaretAtEnd(textSpan)
      saveSelection()
    }
    onContentChange()
  }
}

function insertDivider() {
  const selection = ensureEditorSelection()
  const range = getEditorSelectionRange(selection)
  if (!selection || !range) return

  // Create hr element
  const hr = document.createElement('hr')
  hr.className = 'memo-divider'

  // Create line break after
  const br = document.createElement('div')
  br.innerHTML = '<br>'

  // Insert at cursor position
  range.deleteContents()
  range.insertNode(hr)
  hr.after(br)

  // Move cursor to the new empty line
  placeCaretAtEnd(br)
  saveSelection()

  onContentChange()
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
    doSave()
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
    document.execCommand('insertHTML', false, safeHtml)
  } else {
    document.execCommand('insertText', false, text)
  }
  onContentChange()
}

// Insert image from File/Blob
async function insertImageFromFile(file: File) {
  // Check file size (2MB limit)
  if (file.size > 2 * 1024 * 1024) {
    alert('图片大小不能超过 2MB')
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target?.result as string
    const imgHtml = `<img src="${base64}" class="memo-image" style="max-width: 100%; border-radius: 8px; margin: 8px 0;">`

    editorRef.value?.focus()
    document.execCommand('insertHTML', false, imgHtml)
    onContentChange()
  }
  reader.readAsDataURL(file)
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
  doSave()
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
    doSave()
    return
  }

  // Handle Enter in checkbox item - create new checkbox below
  if (e.key === 'Enter' && !e.shiftKey) {
    const selection = window.getSelection()
    const range = getEditorSelectionRange(selection)
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
    const range = getEditorSelectionRange(selection)
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

async function execPasteAsPlainText() {
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

function execSelectAll() {
  if (editorRef.value) {
    const range = document.createRange()
    range.selectNodeContents(editorRef.value)
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
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
  if (saveTimeout.value) {
    clearTimeout(saveTimeout.value)
  }
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('selectionchange', onSelectionChange)
  // Final save before leaving
  doSave()
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
      @paste-plain-text="onContextMenuAction(execPasteAsPlainText)"
      @select-all="onContextMenuAction(execSelectAll)"
    />
  </div>
</template>

<style scoped>
@reference "../styles.css";

.memo-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: transparent;
  color: #e8e8ea;
  overflow: hidden;
}

/* Top Bar */
.editor-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  gap: 8px;
}

.top-bar-spacer {
  flex: 1;
}

.save-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-right: 8px;
  font-variant-numeric: tabular-nums;
}

.top-bar-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.top-bar-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.top-bar-actions {
  display: flex;
  gap: 8px;
}

.pin-btn.is-pinned {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: var(--focus-color);
}

.delete-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.3);
  color: #f87171;
}

/* Title Area */
.editor-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 4px;
  flex-shrink: 0;
}

/* 底部操作条 */
.editor-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.rewrite-hint {
  flex: 1;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

.rewrite-error {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: #f87171;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rewrite-error.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.rewrite-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 35%, transparent);
  cursor: pointer;
}

.rewrite-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Editor Content */
.editor-content-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.editor-content-wrapper::-webkit-scrollbar {
  width: 6px;
}

.editor-content-wrapper::-webkit-scrollbar-track {
  background: transparent;
}

.editor-content-wrapper::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

.editor-content {
  min-height: 100%;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.9);
  outline: none;
  caret-color: #fff;
}

.editor-content :deep(p) {
  margin: 0 0 12px;
}

.editor-content :deep(br) {
  display: block;
  content: "";
  margin-bottom: 12px;
}

.editor-content :deep(div) {
  margin-bottom: 4px;
}

.editor-content :deep(b),
.editor-content :deep(strong) {
  font-weight: 600;
  color: #fff;
}

.editor-content :deep(i),
.editor-content :deep(em) {
  font-style: italic;
}

.editor-content :deep(u) {
  text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.4);
}

.editor-content :deep(hr.memo-divider) {
  border: none;
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
  margin: 16px 0;
}

.editor-content :deep(.memo-checkbox-item) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  min-height: 24px;
}

.editor-content :deep(.memo-checkbox) {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  cursor: pointer;
  appearance: none;
  position: relative;
  flex-shrink: 0;
}

.editor-content :deep(.memo-checkbox:checked) {
  background: var(--focus-color);
  border-color: var(--focus-color);
}

.editor-content :deep(.memo-checkbox:checked::after) {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.editor-content :deep(.memo-checkbox-text) {
  color: rgba(255, 255, 255, 0.9);
  flex: 1;
  min-width: 1px;
  outline: none;
}

.editor-content :deep(.memo-checkbox-text:empty::before) {
  content: '\200B';
}

.editor-content :deep(.memo-checkbox:checked + .memo-checkbox-text) {
  text-decoration: line-through;
  color: rgba(255, 255, 255, 0.4);
}

.editor-content :deep(img.memo-image) {
  max-width: 100%;
  border-radius: 8px;
  margin: 8px 0;
  display: block;
}

.editor-content :deep(ul),
.editor-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.editor-content :deep(li) {
  margin: 4px 0;
}

.editor-content :deep(blockquote) {
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  margin: 12px 0;
  padding-left: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.editor-content :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  overflow-x: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.editor-content :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.editor-content :deep(a) {
  color: #60a5fa;
  text-decoration: none;
}

.editor-content :deep(a:hover) {
  text-decoration: underline;
}

/* Delete Confirmation Dialog */
.delete-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.delete-dialog {
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 20px 24px;
  min-width: 280px;
  max-width: 320px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.delete-dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 12px;
}

.delete-dialog-content {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
  margin-bottom: 20px;
}

.delete-dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.cancel-btn {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.confirm-btn {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.confirm-btn:hover {
  background: rgba(248, 113, 113, 0.25);
  border-color: rgba(248, 113, 113, 0.5);
}


</style>
