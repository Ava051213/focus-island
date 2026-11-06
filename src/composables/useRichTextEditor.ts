import { ref, type Ref } from 'vue'

const ZERO_WIDTH_SPACE = '\u200B'

/**
 * 富文本编辑器里所有和选区、光标、行内命令相关的操作。
 * 状态（选区快照、格式高亮、当前颜色）都收在这里，组件只负责渲染和挂事件。
 */
export function useRichTextEditor(options: {
  editor: Ref<HTMLDivElement | null>
  /** 任何会改动正文的操作做完后回调，用来同步内容和触发保存 */
  onChange: () => void
}) {
  const { editor, onChange } = options

  const activeFormats = ref<{ bold: boolean; italic: boolean }>({ bold: false, italic: false })
  const currentColor = ref('#ffffff')
  /** 点工具栏时焦点会离开正文，先记住选区，执行命令前再恢复 */
  let lastSelectionRange: Range | null = null

  function isNodeInEditor(node: Node | null): boolean {
    if (!node || !editor.value) return false
    return editor.value === node || editor.value.contains(node)
  }

  function getRange(selection: Selection | null = window.getSelection()): Range | null {
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

  function saveSelection() {
    const range = getRange(window.getSelection())
    if (range) lastSelectionRange = range.cloneRange()
  }

  function restoreSelection(): boolean {
    if (!lastSelectionRange || !editor.value) return false
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

  /** 保证选区落在正文里：优先用快照，其次把光标挪到末尾 */
  function ensureSelection(): Selection | null {
    const selection = window.getSelection()
    if (getRange(selection)) return selection

    if (!restoreSelection()) {
      editor.value?.focus()
      if (editor.value) placeCaretAtEnd(editor.value)
    }
    return window.getSelection()
  }

  function updateActiveFormats() {
    activeFormats.value = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
    }

    const colorValue = document.queryCommandValue('foreColor')
    if (colorValue) currentColor.value = rgbToHex(colorValue)
  }

  function rgbToHex(rgb: string): string {
    if (rgb.startsWith('#')) return rgb

    const toHex = (r: string, g: string, b: string) =>
      '#' + [r, g, b].map(value => parseInt(value, 10).toString(16).padStart(2, '0')).join('')

    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) return toHex(match[1], match[2], match[3])

    const rgbaMatch = rgb.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/)
    if (rgbaMatch) return toHex(rgbaMatch[1], rgbaMatch[2], rgbaMatch[3])

    return '#ffffff'
  }

  function execCommand(command: string, value: string | undefined = undefined) {
    ensureSelection()
    document.execCommand(command, false, value)
    updateActiveFormats()
    onChange()
  }

  function toggleBold() {
    execCommand('bold')
  }

  function toggleItalic() {
    execCommand('italic')
  }

  function setTextColor(color: string) {
    execCommand('foreColor', color)
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

  function normalizeCheckboxText(text: string): string {
    return text.replaceAll(ZERO_WIDTH_SPACE, '').trim()
  }

  function insertCheckbox() {
    const selection = ensureSelection()
    const range = getRange(selection)
    if (!selection || !range) return

    const wrapper = createCheckboxItem()
    const textSpan = wrapper.querySelector('.memo-checkbox-text')
    if (!textSpan) return

    range.deleteContents()
    range.insertNode(wrapper)
    placeCaretAtEnd(textSpan)
    saveSelection()
    onChange()
  }

  function insertDivider() {
    const selection = ensureSelection()
    const range = getRange(selection)
    if (!selection || !range) return

    const hr = document.createElement('hr')
    hr.className = 'memo-divider'

    const br = document.createElement('div')
    br.innerHTML = '<br>'

    range.deleteContents()
    range.insertNode(hr)
    hr.after(br)
    placeCaretAtEnd(br)
    saveSelection()
    onChange()
  }

  /** 复选框点击后保持焦点在正文里，否则接着敲字没反应 */
  function handleCheckboxClick(target: HTMLElement): boolean {
    if (!target.classList.contains('memo-checkbox')) return false

    const checkbox = target as HTMLInputElement
    if (checkbox.checked) {
      checkbox.setAttribute('checked', '')
    } else {
      checkbox.removeAttribute('checked')
    }

    const textSpan = checkbox.closest('.memo-checkbox-item')?.querySelector('.memo-checkbox-text')
    if (textSpan) {
      editor.value?.focus()
      placeCaretAtEnd(textSpan)
      saveSelection()
    }
    onChange()
    return true
  }

  /** 直接往光标处塞 HTML（粘贴、插图都走它），不动已有选区 */
  function insertHtml(html: string) {
    document.execCommand('insertHTML', false, html)
    onChange()
  }

  function selectAll() {
    if (!editor.value) return
    const range = document.createRange()
    range.selectNodeContents(editor.value)
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }

  return {
    activeFormats,
    currentColor,
    isNodeInEditor,
    getRange,
    placeCaretAtEnd,
    saveSelection,
    restoreSelection,
    ensureSelection,
    updateActiveFormats,
    rgbToHex,
    execCommand,
    toggleBold,
    toggleItalic,
    setTextColor,
    createCheckboxItem,
    normalizeCheckboxText,
    insertCheckbox,
    insertDivider,
    handleCheckboxClick,
    insertHtml,
    selectAll,
  }
}
