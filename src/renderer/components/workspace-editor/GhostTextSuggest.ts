import type { editor, IPosition, IRange } from 'monaco-editor'

export interface InlineSuggestionState {
  active: boolean
  text: string
  anchor: IPosition | null
}

const WIDGET_UID = 'inline-ghost-suggest'
const GHOST_STYLE = `
  color: rgba(180, 200, 255, 0.35);
  font-style: italic;
  pointer-events: none;
  white-space: pre;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
`

class InlineSuggestOverlay implements editor.IContentWidget {
  private el: HTMLElement | null = null
  private text = ''
  private anchor: IPosition | null = null
  private active = false
  private host: editor.IStandaloneCodeEditor

  constructor(host: editor.IStandaloneCodeEditor) {
    this.host = host
  }

  getId(): string { return WIDGET_UID }

  getDomNode(): HTMLElement {
    if (!this.el) {
      this.el = document.createElement('span')
      this.el.className = 'inline-ghost-suggest'
      this.el.style.cssText = GHOST_STYLE
    }
    return this.el
  }

  getPosition(): editor.IContentWidgetPosition | null {
    if (!this.anchor || !this.active) return null
    return { position: this.anchor, preference: [0] }
  }

  present(suggestion: string, position: IPosition): void {
    if (!suggestion?.trim()) { this.dismiss(); return }
    this.text = suggestion
    this.anchor = position
    this.active = true

    const node = this.getDomNode()
    const lines = suggestion.split('\n')
    node.textContent = lines[0]

    if (lines.length > 1) {
      const badge = document.createElement('span')
      badge.style.cssText = 'margin-left:6px;padding:0 4px;background:rgba(120,160,255,0.12);border-radius:3px;font-size:10px;'
      badge.textContent = `+${lines.length - 1}`
      node.appendChild(badge)
    }

    this.host.addContentWidget(this)
    this.host.layoutContentWidget(this)
  }

  dismiss(): void {
    if (!this.active) return
    this.active = false
    this.text = ''
    this.anchor = null
    try { this.host.removeContentWidget(this) } catch { /* noop */ }
  }

  commit(): boolean {
    if (!this.active || !this.text || !this.anchor) return false
    const model = this.host.getModel()
    if (!model) return false

    const insertRange: IRange = {
      startLineNumber: this.anchor.lineNumber,
      startColumn: this.anchor.column,
      endLineNumber: this.anchor.lineNumber,
      endColumn: this.anchor.column,
    }

    this.host.executeEdits('ghost-commit', [{
      range: insertRange,
      text: this.text,
      forceMoveMarkers: true,
    }])

    const insertedLines = this.text.split('\n')
    const tailLen = insertedLines[insertedLines.length - 1].length
    this.host.setPosition({
      lineNumber: this.anchor.lineNumber + insertedLines.length - 1,
      column: insertedLines.length === 1 ? this.anchor.column + tailLen : tailLen + 1,
    })

    this.dismiss()
    return true
  }

  isActive(): boolean { return this.active }
  currentText(): string { return this.text }

  destroy(): void {
    this.dismiss()
    this.el = null
  }
}

export function createGhostTextManager(editor: editor.IStandaloneCodeEditor) {
  const overlay = new InlineSuggestOverlay(editor)
  return {
    show: (suggestion: string, position: IPosition) => overlay.present(suggestion, position),
    hide: () => overlay.dismiss(),
    accept: () => overlay.commit(),
    isShowing: () => overlay.isActive(),
    getSuggestion: () => overlay.currentText(),
    dispose: () => overlay.destroy(),
  }
}

export type GhostTextManager = ReturnType<typeof createGhostTextManager>
export const GhostTextWidget = InlineSuggestOverlay
export type GhostTextState = InlineSuggestionState
