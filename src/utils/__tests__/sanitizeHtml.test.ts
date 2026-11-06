// @vitest-environment jsdom
// DOMPurify 依赖完整 DOM，happy-dom 下清理逻辑不生效，这个文件单独用 jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../sanitizeHtml'

describe('sanitizeHtml 挡住已知绕过手法', () => {
  it('清掉 script 及其内容', () => {
    const out = sanitizeHtml('<p>正常</p><script>alert(1)</script>')

    expect(out).toContain('<p>正常</p>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
  })

  it('清掉 iframe / object / embed / frame', () => {
    const out = sanitizeHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><frameset></frameset>',
    )

    expect(out).toBe('')
  })

  it('svg 整体移除，onload 跟着消失', () => {
    const out = sanitizeHtml('<svg onload="alert(1)"><circle r="10" /></svg>')

    expect(out).toBe('')
  })

  it('清掉表单类元素', () => {
    const out = sanitizeHtml('<form action="https://evil.test"><button>go</button><textarea>t</textarea><select><option>a</option></select></form>')

    expect(out).not.toContain('form')
    expect(out).not.toContain('button')
    expect(out).not.toContain('textarea')
    expect(out).not.toContain('select')
  })

  it('只允许 checkbox，其余 input 整个移除', () => {
    expect(sanitizeHtml('<input type="checkbox">')).toContain('type="checkbox"')
    expect(sanitizeHtml('<input type="text" value="x">')).not.toContain('input')
    expect(sanitizeHtml('<input value="x">')).not.toContain('input')
  })

  it('清掉 style / link / meta / base', () => {
    const out = sanitizeHtml(
      '<style>body{display:none}</style><link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0"><base href="https://evil.test">',
    )

    expect(out).toBe('')
  })

  it('清掉行内事件属性', () => {
    const out = sanitizeHtml('<p onclick="alert(1)" onmouseover="alert(2)">文字</p>')

    expect(out).toBe('<p>文字</p>')
  })

  it('清掉 javascript: 与 data: 链接', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">a</a><a href="data:text/html,<script>alert(1)</script>">b</a>')

    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:text/html')
  })
})

describe('sanitizeHtml 保留正常富文本', () => {
  it('段落、列表、加粗、链接、图片原样保留', () => {
    const html = '<p><strong>加粗</strong>和<em>斜体</em></p><ul><li>一</li><li>二</li></ul><p><a href="https://example.com">链接</a><img src="https://example.com/a.png"></p>'

    expect(sanitizeHtml(html)).toBe(html)
  })

  it('checkbox 的 checked 属性和 data-* 保留', () => {
    const out = sanitizeHtml('<p><input type="checkbox" checked data-id="3"></p>')

    expect(out).toContain('type="checkbox"')
    expect(out).toContain('data-id="3"')
  })

  it('空串照常返回空串', () => {
    expect(sanitizeHtml('')).toBe('')
  })
})
