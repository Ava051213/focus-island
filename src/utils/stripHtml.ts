/**
 * 把备忘富文本剥成纯文本：去掉 style 块与标签，解常见实体，空白折叠。
 * 之前标题提炼、列表预览、搜索缓存、AI 上下文各写了一份正则，收在这里统一维护。
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
