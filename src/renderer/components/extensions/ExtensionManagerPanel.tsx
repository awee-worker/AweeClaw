import React, { useState, useEffect, useCallback } from 'react'
import { extensionManager, type ExtensionMeta, type InstallProgress } from './ExtensionManager'

/**
 * 前端插件市场面板
 *
 * 功能：
 * - 已安装插件列表（名称/版本/作者/删除按钮）
 * - GitHub 安装入口（URL 输入框 + 安装按钮）
 * - 本地 ZIP 上传入口
 * - 安装进度条
 */
const ExtensionManagerPanel: React.FC = () => {
  const [extensions, setExtensions] = useState<ExtensionMeta[]>([])
  const [githubUrl, setGithubUrl] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const loadExtensions = useCallback(async () => {
    try {
      const list = await extensionManager.listExtensions()
      setExtensions(list)
    } catch (err) {
      console.error('Failed to load extensions:', err)
    }
  }, [])

  useEffect(() => {
    loadExtensions()
  }, [loadExtensions])

  const handleGithubInstall = async () => {
    if (!githubUrl.trim()) return
    setError(null)
    setInstalling(githubUrl)
    setProgress({ extId: 'github', status: 'installing', progress: 0, message: '开始安装...' })

    try {
      const result = await extensionManager.installFromGitHub(githubUrl, (p) => setProgress(p))
      setExtensions((prev) => [...prev, result.meta])
      setGithubUrl('')
      setProgress(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress(null)
    } finally {
      setInstalling(null)
    }
  }

  const handleLocalInstall = async (file: File) => {
    setError(null)
    setInstalling(file.name)
    setProgress({ extId: file.name, status: 'installing', progress: 0, message: '正在安装...' })

    try {
      const result = await extensionManager.installFromLocal(file, (p) => setProgress(p))
      setExtensions((prev) => [...prev, result.meta])
      setProgress(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress(null)
    } finally {
      setInstalling(null)
    }
  }

  const handleUninstall = async (extId: string) => {
    await extensionManager.uninstall(extId)
    setExtensions((prev) => prev.filter((e) => e.id !== extId))
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.zip')) {
      handleLocalInstall(file)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* GitHub 安装 */}
      <section className="border rounded-lg p-4 bg-card">
        <h3 className="text-sm font-semibold mb-3">从 GitHub 安装</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 px-3 py-1.5 text-sm border rounded bg-background text-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleGithubInstall()}
          />
          <button
            onClick={handleGithubInstall}
            disabled={installing !== null}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          >
            安装
          </button>
        </div>
        {progress?.status === 'installing' && (
          <div className="mt-2">
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{progress.message}</p>
          </div>
        )}
      </section>

      {/* 本地上传 */}
      <section className="border rounded-lg p-4 bg-card">
        <h3 className="text-sm font-semibold mb-3">本地 ZIP 安装</h3>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
          }`}
        >
          <input
            type="file"
            accept=".zip"
            className="hidden"
            id="local-zip-upload"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleLocalInstall(file)
              e.target.value = ''
            }}
          />
          <label htmlFor="local-zip-upload" className="cursor-pointer">
            <p className="text-sm text-muted-foreground">
              拖拽 ZIP 文件到此处，或点击选择文件
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              支持 .zip 格式的 AweeClaw 前端扩展插件
            </p>
          </label>
        </div>
      </section>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 text-sm text-red-500 bg-red-500/10 rounded">
          {error}
        </div>
      )}

      {/* 已安装列表 */}
      <section>
        <h3 className="text-sm font-semibold mb-3">已安装扩展 ({extensions.length})</h3>
        {extensions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无已安装的扩展插件
          </p>
        ) : (
          <div className="space-y-2">
            {extensions.map((ext) => (
              <div
                key={ext.id}
                className="flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-card hover:bg-card/80 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ext.name || ext.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {ext.version ? `v${ext.version}` : ''}
                    {ext.author ? ` · ${ext.author}` : ''}
                    {ext.description ? ` · ${ext.description}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleUninstall(ext.id)}
                  className="px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded"
                >
                  卸载
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default ExtensionManagerPanel
