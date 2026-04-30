/**
 * Ghost Text Widget for Monaco Editor
 * Displays inline code completion suggestions as semi-transparent text
 * Requirements: 1.1, 1.6
 */

import type { editor, IPosition, IRange } from 'monaco-editor'

export interface GhostTextState {
  visible: boolean
  suggestion: string
  position: IPosition | null
}

/**
 * Monaco Content Widget for displaying ghost text suggestions
 */
export class GhostTextWidget implements editor.IContentWidget {
  private static readonly ID = 'ghost-text-widget'
  private domNode: HTMLElement | null = null
  private suggestion: string = ''
  private position: IPosition | null = null
  private editor: editor.IStandaloneCodeEditor
  private isVisible: boolean = false

  constructor(editor: editor.IStandaloneCodeEditor) {
    this.editor = editor
  }

  getId(): string {
    return GhostTextWidget.ID
  }

  getDomNode(): HTMLElement {
    if (!this.domNode) {
      this.domNode = document.createElement('div')
      this.domNode.className = 'ghost-text-widget'
      this.domNode.style.cssText = `
        color: rgba(255, 255, 255, 0.4);
        font-style: italic;
        pointer-events: none;
        white-space: pre;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
      `
    }
    return this.domNode
  }


  getPosition(): editor.IContentWidgetPosition | null {
    if (!this.position || !this.isVisible) {
      return null
    }
    return {
      position: this.position,
      preference: [
        0 // EXACT - render at exact position
      ]
    }
  }

  /**
   * Show the ghost text suggestion at the given position
   */
  show(suggestion: string, position: IPosition): void {
    if (!suggestion || suggestion.trim() === '') {
      this.hide()
      return
    }

    this.suggestion = suggestion
    this.position = position
    this.isVisible = true

    // Update DOM content
    const domNode = this.getDomNode()
    
    // Handle multi-line suggestions - only show first line inline
    const lines = suggestion.split('\n')
    const firstLine = lines[0]
    const hasMoreLines = lines.length > 1
    
    domNode.textContent = firstLine
    
    // Add indicator for multi-line suggestions
    if (hasMoreLines) {
      const indicator = document.createElement('span')
      indicator.style.cssText = `
        margin-left: 8px;
        padding: 1px 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        font-size: 10px;
      `
      indicator.textContent = `+${lines.length - 1} lines`
      domNode.appendChild(indicator)
    }

    // Add widget to editor
    this.editor.addContentWidget(this)
    this.editor.layoutContentWidget(this)
  }

  /**
   * Hide the ghost text suggestion
   */
  hide(): void {
    if (!this.isVisible) return
    
    this.isVisible = false
    this.suggestion = ''
    this.position = null
    
    try {
      this.editor.removeContentWidget(this)
    } catch {
      // Widget might not be added yet
    }
  }


  /**
   * Accept the current suggestion and insert it into the editor
   */
  accept(): boolean {
    if (!this.isVisible || !this.suggestion || !this.position) {
      return false
    }

    const model = this.editor.getModel()
    if (!model) {
      return false
    }

    // Create the range for insertion (at cursor position)
    const range: IRange = {
      startLineNumber: this.position.lineNumber,
      startColumn: this.position.column,
      endLineNumber: this.position.lineNumber,
      endColumn: this.position.column
    }

    // Execute the edit
    this.editor.executeEdits('ghost-text-accept', [{
      range,
      text: this.suggestion,
      forceMoveMarkers: true
    }])

    // Move cursor to end of inserted text
    const insertedLines = this.suggestion.split('\n')
    const lastLineLength = insertedLines[insertedLines.length - 1].length
    const newPosition: IPosition = {
      lineNumber: this.position.lineNumber + insertedLines.length - 1,
      column: insertedLines.length === 1 
        ? this.position.column + lastLineLength
        : lastLineLength + 1
    }
    this.editor.setPosition(newPosition)

    // Hide the widget
    this.hide()
    
    return true
  }

  /**
   * Get the current suggestion text
   */
  getSuggestion(): string {
    return this.suggestion
  }

  /**
   * Check if the widget is currently visible
   */
  isShowing(): boolean {
    return this.isVisible
  }

  /**
   * Dispose of the widget
   */
  dispose(): void {
    this.hide()
    this.domNode = null
  }
}

/**
 * Create and manage ghost text for an editor instance
 */
export function createGhostTextManager(editor: editor.IStandaloneCodeEditor) {
  const widget = new GhostTextWidget(editor)
  
  return {
    show: (suggestion: string, position: IPosition) => widget.show(suggestion, position),
    hide: () => widget.hide(),
    accept: () => widget.accept(),
    isShowing: () => widget.isShowing(),
    getSuggestion: () => widget.getSuggestion(),
    dispose: () => widget.dispose()
  }
}

export type GhostTextManager = ReturnType<typeof createGhostTextManager>
