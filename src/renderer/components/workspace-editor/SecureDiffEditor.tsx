import { useRef, useCallback, useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '@store'
import { defineMonacoTheme } from './utils/editorTheme'
import type { ThemeName } from '@store/slices/themeSlice'

interface DiffViewerProps {
  original: string | undefined
  modified: string | undefined
  language: string
  options?: editor.IDiffEditorConstructionOptions
  onMount?: (ed: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api')) => void
}

export function SafeDiffEditor({ original, modified, language, options, onMount }: DiffViewerProps) {
  const instanceRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const aliveRef = useRef(true)
  const [uid] = useState(() => `diff-${Date.now()}`)
  const [active, setActive] = useState(true)

  useEffect(() => {
    aliveRef.current = true
    setActive(true)
    return () => {
      aliveRef.current = false
      if (instanceRef.current) {
        try { instanceRef.current.setModel(null) } catch { /* noop */ }
        instanceRef.current = null
      }
      setActive(false)
    }
  }, [])

  const onEditorMount = useCallback(
    (ed: editor.IStandaloneDiffEditor, monacoApi: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api')) => {
      if (!aliveRef.current) return
      instanceRef.current = ed
      const { currentTheme } = useStore.getState() as { currentTheme: ThemeName }
      defineMonacoTheme(monacoApi, currentTheme)
      monacoApi.editor.setTheme('aweeclaw-dynamic')
      onMount?.(ed, monacoApi)
    },
    [onMount],
  )

  if (!active) return null

  return (
    <DiffEditor
      key={uid}
      height="100%"
      language={language}
      original={original ?? ''}
      modified={modified ?? ''}
      theme="aweeclaw-dynamic"
      options={options}
      onMount={onEditorMount}
      loading={<div className="flex items-center justify-center h-full text-text-muted">Loading diff view…</div>}
    />
  )
}
