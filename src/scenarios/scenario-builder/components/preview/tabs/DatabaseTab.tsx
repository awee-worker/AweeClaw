/**
 * 数据库快照 Tab（DatabaseTab）
 *
 * 通过 PreviewService.getDatabaseSnapshot() 拉取场景专属 SQLite 的表结构、索引与样本数据。
 *
 * 数据来源：
 *   - PreviewService.getDatabaseSnapshot(tableName?, sampleLimit?)
 *   - 主进程通过 node:sqlite 查询 {userDataPath}/scenario-data/{scenarioId}/{scenarioId}.db
 *
 * 交互能力：
 *   - 手动刷新
 *   - 表切换（select 下拉，限定单表快照时聚焦查看）
 *
 * 设计要点：
 *   - 字体 ≥ 12px
 *   - 表名、列名使用等宽字体
 *   - 主键列加 PK 标签，可空列加 NULL 标签
 *   - 样本数据用表格展示，超宽时横向滚动
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../../services'
import type { DatabaseSnapshot } from '../../../services'
import {
  RefreshCw,
  Database,
  Table as TableIcon,
  Key,
  Hash,
  ListTree,
} from 'lucide-react'

interface DatabaseTabProps {
  /** 当前预览的 scenarioId */
  scenarioId: string | null
  /** 预览是否运行中 */
  running: boolean
}

const DatabaseTab: React.FC<DatabaseTabProps> = ({ scenarioId, running }) => {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [selectedTable, setSelectedTable] = useState<string>('')

  const fetchSnapshot = useCallback(async () => {
    if (!scenarioId || !running) {
      setSnapshot(null)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await previewService.getDatabaseSnapshot(undefined, 20)
      if (!result.success || !result.snapshot) {
        setError(result.error || t('builder.preview.db.loadFailed'))
        setSnapshot(null)
        return
      }
      setSnapshot(result.snapshot)
      // 默认选第一张表
      if (result.snapshot.tables.length > 0) {
        setSelectedTable((prev) => prev || result.snapshot!.tables[0].name)
      } else {
        setSelectedTable('')
      }
    } catch (err) {
      setError((err as Error).message || t('builder.preview.db.loadFailed'))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [scenarioId, running, t])

  useEffect(() => {
    void fetchSnapshot()
  }, [fetchSnapshot])

  const handleRefresh = useCallback(() => {
    void fetchSnapshot()
  }, [fetchSnapshot])

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  // 当前选中的表
  const currentTable = snapshot?.tables.find((tbl) => tbl.name === selectedTable) ?? null

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            disabled={loading || !running}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            title={t('builder.preview.db.refresh')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('builder.preview.db.refresh')}
          </button>
          {snapshot && (
            <span className="ml-auto text-[12px] text-muted-foreground">
              {snapshot.tables.length} {t('builder.preview.db.tables')}
            </span>
          )}
        </div>
        {error && (
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-destructive">
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>

      {/* 主内容 */}
      <div className="flex-1 overflow-y-auto">
        {!running || !scenarioId ? (
          <p className="px-3 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.db.notRunning')}
          </p>
        ) : !snapshot ? (
          <p className="px-3 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.db.empty')}
          </p>
        ) : snapshot.tables.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-muted-foreground/60">
            {t('builder.preview.db.empty')}
          </p>
        ) : (
          <div className="space-y-3 p-3">
            {/* 数据库基本信息 */}
            <div className="rounded border border-border bg-muted/30 p-2 text-[12px]">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <Database className="h-3.5 w-3.5 text-accent" />
                {t('builder.preview.db.title')}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('builder.preview.db.path')}</span>
                  <span className="truncate font-mono text-foreground/80" title={snapshot.databasePath}>
                    {snapshot.databasePath}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('builder.preview.db.size')}</span>
                  <span className="font-mono text-foreground/80">
                    {formatBytes(snapshot.sizeBytes)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t('builder.preview.db.queryTime')}</span>
                  <span className="font-mono text-foreground/80">
                    {snapshot.queryDurationMs} ms
                  </span>
                </div>
              </div>
            </div>

            {/* 表切换 */}
            <div className="flex items-center gap-1.5">
              <TableIcon className="h-3.5 w-3.5 text-accent" />
              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {snapshot.tables.map((tbl) => (
                  <option key={tbl.name} value={tbl.name}>
                    {tbl.name} ({tbl.rowCount})
                  </option>
                ))}
              </select>
            </div>

            {/* 当前表详情 */}
            {currentTable && (
              <div className="space-y-2.5">
                {/* 列定义 */}
                <div className="rounded border border-border bg-background">
                  <div className="border-b border-border/60 px-2 py-1 text-[12px] font-medium">
                    {t('builder.preview.db.table.columns')}
                  </div>
                  {currentTable.columns.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-muted-foreground/60">
                      {t('builder.preview.db.table.noColumns')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {currentTable.columns.map((col, idx) => (
                        <li
                          key={`${col.name}-${idx}`}
                          className="flex items-center gap-2 px-2 py-1 text-[12px]"
                        >
                          <span className="font-mono text-foreground">{col.name}</span>
                          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {col.type}
                          </span>
                          {col.primaryKey && (
                            <span className="flex items-center gap-0.5 rounded bg-accent/10 px-1 py-0.5 text-[11px] text-accent">
                              <Key className="h-2.5 w-2.5" /> PK
                            </span>
                          )}
                          {col.nullable && (
                            <span className="rounded bg-muted/60 px-1 py-0.5 text-[11px] text-muted-foreground">
                              NULL
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 索引 */}
                <div className="rounded border border-border bg-background">
                  <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1 text-[12px] font-medium">
                    <ListTree className="h-3 w-3 text-accent" />
                    {t('builder.preview.db.table.indexes')}
                  </div>
                  {currentTable.indexes.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-muted-foreground/60">
                      {t('builder.preview.db.table.noIndexes')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {currentTable.indexes.map((idx, i) => (
                        <li
                          key={`${idx.name}-${i}`}
                          className="px-2 py-1 text-[12px]"
                        >
                          <span className="font-mono text-foreground">{idx.name}</span>
                          <span className="ml-2 font-mono text-muted-foreground">
                            ({idx.columns.join(', ')})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 样本数据 */}
                <div className="rounded border border-border bg-background">
                  <div className="flex items-center justify-between border-b border-border/60 px-2 py-1 text-[12px] font-medium">
                    <span className="flex items-center gap-1.5">
                      <Hash className="h-3 w-3 text-accent" />
                      {t('builder.preview.db.table.sampleData')}
                    </span>
                    <span className="text-muted-foreground">
                      {currentTable.rowCount} {t('builder.preview.db.table.rowCount')}
                    </span>
                  </div>
                  {currentTable.sampleRows.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-muted-foreground/60">
                      {currentTable.rowCount === 0
                        ? t('builder.preview.db.table.empty')
                        : t('builder.preview.db.table.noSample')}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-[12px]">
                        <thead className="border-b border-border/60 bg-muted/30">
                          <tr>
                            {currentTable.columns.map((col) => (
                              <th
                                key={col.name}
                                className="whitespace-nowrap px-2 py-1 text-left font-mono text-muted-foreground"
                              >
                                {col.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentTable.sampleRows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="border-b border-border/30 last:border-b-0"
                            >
                              {currentTable.columns.map((col) => {
                                const val = row[col.name]
                                const display =
                                  val === null || val === undefined
                                    ? 'NULL'
                                    : typeof val === 'object'
                                      ? JSON.stringify(val)
                                      : String(val)
                                return (
                                  <td
                                    key={col.name}
                                    className={`whitespace-nowrap px-2 py-1 font-mono ${
                                      val === null || val === undefined
                                        ? 'text-muted-foreground/60'
                                        : 'text-foreground/80'
                                    }`}
                                  >
                                    {display}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default DatabaseTab
