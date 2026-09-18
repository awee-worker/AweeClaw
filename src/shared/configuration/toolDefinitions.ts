/**
 * 工具统一配置
 * 
 * 设计参考：Claude Code CLI, Codex CLI, Kiro
 * 
 * 单一数据源：所有工具的定义、schema、元数据、提示词描述都从这里生成
 * 添加新工具只需在 TOOL_CONFIGS 中添加一项
 */

import { z } from 'zod'
import { BRAND } from '@shared/brand'
import type { ToolApprovalType } from '@shared/protocols/modelGateway'
import { normalizeEditFileArgs, resolveEditFileRequest } from '@toolkit/fileEditor'
import { normalizeReadFileArgs, resolveReadFileRequest } from '@toolkit/fileReader'

// ============================================
// 类型定义
// ============================================

export type ToolCategory = 'read' | 'write' | 'terminal' | 'search' | 'lsp' | 'network' | 'interaction' | 'plan' | 'data' | 'media' | 'office'

export interface ToolPropertyDef {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description: string
    required?: boolean
    default?: unknown
    enum?: string[]
    items?: ToolPropertyDef
    properties?: Record<string, ToolPropertyDef>
}

export interface ToolConfig {
    name: string
    displayName: string
    /** 简短描述（用于 LLM 工具定义） */
    description: string
    /** 详细描述（用于系统提示词） */
    detailedDescription?: string
    /** 使用示例 */
    examples?: string[]
    /** 重要提示（CRITICAL/IMPORTANT 级别的规则） */
    criticalRules?: string[]
    /** 常见错误及解决方案 */
    commonErrors?: Array<{ error: string; solution: string }>
    category: ToolCategory
    approvalType: ToolApprovalType
    parallel: boolean
    concurrencyMode?: import('@protocols/modelGateway').ToolConcurrencyMode
    resourceScope?: string[]
    resultSemantics?: import('@protocols/modelGateway').ToolResultSemantics
    retryPolicy?: import('@protocols/modelGateway').ToolRetryPolicy
    validationLevel?: import('@protocols/modelGateway').ToolValidationLevel
    requiresWorkspace: boolean
    enabled: boolean
    parameters: Record<string, ToolPropertyDef>
    /** 自定义 Zod schema（可选，用于复杂验证） */
    customSchema?: z.ZodSchema
    /** 自定义验证函数 */
    validate?: (data: Record<string, unknown>) => { valid: boolean; error?: string }
}

// ============================================
// 工具配置
// ============================================

export const TOOL_CONFIGS: Record<string, ToolConfig> = {
    // ===== 读取类工具 =====
    read_file: {
        name: 'read_file',
        displayName: 'Read File',
        description: 'Read one or more text/code files. Code/structured files include line numbers; markdown/plain-text documents are returned in readable text form unless start_line/end_line is requested. MUST read before editing. For binary documents (PDF/Word/Excel/PPT) use extract_document instead.',
        detailedDescription: `Read file contents from the filesystem.
- Single file: path="src/main.ts"
- Multiple files: path=["src/a.ts", "src/b.ts"]
- Code files default to line-numbered output for precise edits
- Markdown/plain-text documents default to readable full-text output
- Large files will be truncated, use search_files to locate target first
- ⚠️ CANNOT read binary document formats (pdf/docx/xlsx/ppt etc.) — use extract_document for those`,
        criticalRules: [
            'For PDF/Word/Excel/PowerPoint files, use extract_document instead — this tool cannot parse binary formats',
            'Do NOT use run_command with pdftotext/python to extract document text — always use extract_document',
        ],
        customSchema: z.object({
            path: z.union([
                z.string().min(1, 'path is required'),
                z.array(z.string().min(1, 'path items must be non-empty')).min(1, 'path array must not be empty')
            ]),
            start_line: z.number().optional(),
            end_line: z.number().optional(),
        }).passthrough()
            .transform((data) => normalizeReadFileArgs(data as Record<string, unknown>))
            .refine(
                (data) => resolveReadFileRequest(data as Record<string, unknown>).ok,
                (data) => {
                    const resolution = resolveReadFileRequest(data as Record<string, unknown>)
                    return { message: resolution.ok ? 'Validation failed' : resolution.error }
                }
            ),
        category: 'read',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['filesystem:read'],
        resultSemantics: 'file-read',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'File path string OR JSON array of paths. Single: "src/main.ts". Multiple: ["src/a.ts", "src/b.ts"]. start_line/end_line only apply to single-file reads.',
                required: true
            },
            start_line: { type: 'number', description: 'Starting line (1-indexed, single file only)' },
            end_line: { type: 'number', description: 'Ending line inclusive (single file only)' },
        },
    },

    list_directory: {
        name: 'list_directory',
        displayName: 'List Directory',
        description: 'List directory contents. Use recursive=true for tree view of subdirectories. Use recursive=false (default) for single level.',
        detailedDescription: `List directory contents with file types and sizes.
- Non-recursive: shows immediate children only
- Recursive: shows full tree up to max_depth`,
        category: 'read',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['filesystem:list'],
        resultSemantics: 'file-read',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for workspace root', required: true },
            recursive: { type: 'boolean', description: 'Show subdirectories recursively (default: false)', default: false },
            max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)', default: 3 },
        },
    },

    // ===== 文档提取工具 =====
    extract_document: {
        name: 'extract_document',
        displayName: 'Extract Document',
        description: 'Extract text content from documents (PDF/Word/Excel/PPT/TXT). Returns lightweight Markdown with metadata. MUST be used for all binary document formats instead of run_command/read_file. Supports scanned PDF OCR fallback.',
        detailedDescription: `Extract text from binary document formats.
- PDF (.pdf): text extraction, falls back to server OCR for scanned docs
- Word (.docx/.doc): full text with paragraph structure
- Excel (.xlsx/.xls/.csv): each sheet as a Markdown table section
- PowerPoint (.ppt/.pptx): slide text content
- Plain text (.txt/.md): direct read

Returns lightweight Markdown:
- Tables preserved as Markdown tables
- Excel sheets separated by "## Sheet: <name>"
- Headings preserved as # / ## / ###
- Large docs (>100KB) truncated with marker

Use this instead of read_file for binary document formats.
Client-first: local extraction; falls back to server if local fails.`,
        criticalRules: [
            'This is the ONLY correct way to read PDF/Word/Excel/PowerPoint files',
            'NEVER use run_command with pdftotext, python-docx, antiword, libreoffice to extract document text',
            'NEVER use read_file for .pdf/.docx/.doc/.xlsx/.xls/.ppt/.pptx — it cannot parse binary formats',
            'For scanned PDFs, this tool auto-triggers server OCR fallback — no manual handling needed',
        ],
        category: 'read',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['filesystem:read'],
        resultSemantics: 'file-read',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            file_path: {
                type: 'string',
                description: 'Document file path (relative to workspace root, or absolute path). Supports: pdf, docx, doc, xlsx, xls, csv, ppt, pptx, txt, md.',
                required: true,
            },
        },
    },

    // ===== 搜索工具 =====
    search_files: {
        name: 'search_files',
        displayName: 'Search Files',
        description: 'Search for text or regex patterns in files. Can search a directory or single file. Use | to combine multiple patterns in one call (e.g., "pattern1|pattern2"). For semantic search, use codebase_search instead.',
        detailedDescription: `Fast content search using ripgrep-style matching.
- Supports regex patterns with is_regex=true
- Use | to combine multiple patterns
- Can search single file by providing file path`,
        examples: [
            'search_files path="src" pattern="TODO|FIXME|HACK" is_regex=true',
            'search_files path="src/app.tsx" pattern="useState|useEffect" is_regex=true',
        ],
        criticalRules: [
            'Combine multiple patterns with | - NEVER make separate calls',
            'For single file, use file path directly as path parameter',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['filesystem:search'],
        resultSemantics: 'search',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: {
                type: 'string',
                description: 'Directory OR file path relative to workspace root. Defaults to "." (workspace root).',
                default: '.'
            },
            pattern: { type: 'string', description: 'Pattern. Combine multiple with | (e.g., "pat1|pat2|pat3")', required: true },
            is_regex: { type: 'boolean', description: 'Enable regex (auto-enabled for | patterns)', default: false },
            file_pattern: { type: 'string', description: 'Filter files (e.g., "*.ts")' },
        },
    },

    codebase_search: {
        name: 'codebase_search',
        displayName: 'Semantic Search',
        description: 'AI-powered semantic search for finding code by meaning. Use for conceptual queries like "where is authentication handled". For exact text search, use search_files instead.',
        detailedDescription: `AI-powered semantic search for finding related code by meaning.
- Understands natural language queries
- Ask complete questions for best results`,
        examples: [
            'codebase_search query="user authentication logic"',
        ],
        criticalRules: [
            'Use complete questions for best results',
            'For exact text, use search_files instead',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['filesystem:semantic-search'],
        resultSemantics: 'search',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Natural language query - ask complete question', required: true },
            top_k: { type: 'number', description: 'Number of results (default: 10)', default: 10 },
        },
    },

    // ===== 编辑类工具 =====
    edit_file: {
        name: 'edit_file',
        displayName: 'Edit File',
        description: `Edit part of an existing file after reading it first. MUST use this tool for modifying existing files — NOT write_file.
Choose one mode only: string mode (old_string + new_string), line mode (start_line + end_line + content), or batch mode (edits array).
Never mix modes, never send empty placeholder edits. Use write_file ONLY for creating new files.`,
        detailedDescription: `PROCEDURE FOR MODIFYING AN EXISTING FILE:
1. Call read_file(path="...") to get the current content
2. Identify the exact text or line range to change
3. Use edit_file with the appropriate mode:
   - String mode: {path, old_string, new_string} — for replacing a specific text block
   - Line mode: {path, start_line, end_line, content} — for replacing lines by number
   - Batch mode: {path, edits: [...]} — for multiple independent changes

CHOOSING THE RIGHT MODE:
- String mode: Use when you know the exact text to replace (small, unique snippet)
- Line mode: Use when you know the exact line numbers (after reading the file)
- Batch mode: Use when making 2+ non-overlapping changes to the same file

AVOID:
- Do not mix string/line/batch fields in one call
- Do not include empty placeholder fields
- Keep old_string concise but unique enough to match exactly one location
- Prefer line or batch mode for large files or when you have line numbers`,
        customSchema: z.object({
            path: z.string().min(1, 'path is required'),
            old_string: z.string().optional(),
            new_string: z.string().optional(),
            start_line: z.number().optional(),
            end_line: z.number().optional(),
            content: z.string().optional(),
            replace_all: z.boolean().optional(),
            edits: z.array(
                z.object({
                    action: z.enum(['replace', 'insert', 'delete']),
                    start_line: z.number().optional(),
                    end_line: z.number().optional(),
                    after_line: z.number().optional(),
                    content: z.string().optional(),
                })
            ).optional(),
        }).passthrough()
            .superRefine((data, ctx) => {
                const resolution = resolveEditFileRequest(data as Record<string, unknown>)
                if (resolution.ok) return

                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: resolution.error,
                })
            })
            .transform((data) => normalizeEditFileArgs(data as Record<string, unknown>)),
        category: 'write',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['filesystem:write'],
        resultSemantics: 'file-write',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root', required: true },
            old_string: { type: 'string', description: '[string mode] Exact unique text to replace. Do not use with line or batch fields.' },
            new_string: { type: 'string', description: '[string mode] Replacement text. Do not use with line or batch fields.' },
            start_line: { type: 'number', description: '[line mode] First line to replace, 1-indexed. Do not use with string or batch fields.' },
            end_line: { type: 'number', description: '[line mode] Last line to replace, inclusive. Do not use with string or batch fields.' },
            content: { type: 'string', description: '[line mode] New content for the selected line range. Do not use with string or batch fields.' },
            replace_all: { type: 'boolean', description: '[string mode] Replace all matches instead of the first match', default: false },
            edits: {
                type: 'array',
                description: '[batch mode] Only field besides path. Each edit is replace, insert, or delete.',
                items: {
                    type: 'object',
                    description: '[batch mode] Individual edit operation',
                    properties: {
                        action: { type: 'string', description: '[batch mode] replace, insert, or delete', enum: ['replace', 'insert', 'delete'] },
                        start_line: { type: 'number', description: '[batch mode] Required for replace/delete' },
                        end_line: { type: 'number', description: '[batch mode] Required for replace/delete' },
                        after_line: { type: 'number', description: '[batch mode] Required for insert' },
                        content: { type: 'string', description: '[batch mode] Required for replace/insert' }
                    }
                }
            },
        },
    },

    write_file: {
        name: 'write_file',
        displayName: 'Write File',
        description: `Write complete file content. For CREATING NEW files ONLY or intentional full-file replacement.

⚠️ CRITICAL: If you are MODIFYING an existing file, you MUST NOT use write_file. Instead, use edit_file:
  1. First call read_file to get the current content
  2. Then use edit_file with old_string/new_string (string mode) OR start_line/end_line/content (line mode) OR edits array (batch mode)

Using write_file on an existing file for partial edits will be REJECTED — the system will return an error telling you to switch to edit_file.`,
        criticalRules: [
            'Creating a NEW file: use write_file.',
            'MODIFYING an EXISTING file: you MUST use edit_file, NOT write_file. First read_file, then edit_file.',
            'write_file on an existing file with partial changes WILL BE REJECTED. The error will tell you to use edit_file instead.',
            'If write_file is rejected, do NOT retry write_file — immediately use read_file to get content, then edit_file to make changes.',
            'Prefer over create_file_or_folder when you have file content ready',
            'Do not rewrite the same large file multiple times in one turn unless absolutely necessary',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['filesystem:write'],
        resultSemantics: 'file-write',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/new.ts")', required: true },
            content: { type: 'string', description: 'Complete file content', required: true },
        },
    },

    create_file_or_folder: {
        name: 'create_file_or_folder',
        displayName: 'Create',
        description: 'Create a file or a folder. CRITICAL: Path ending with "/" creates a FOLDER (directory); path without "/" creates a FILE. When the user says "创建文件夹", "新建目录", "create folder/directory", you MUST end the path with "/". When the user says "创建文件", "新建文件", "create file", do NOT end the path with "/".',
        detailedDescription: `Create new files or directories.

CRITICAL RULES for choosing between file and folder:
- Path ending with "/" → creates a FOLDER (directory). Examples: "src/", "website/", "public/assets/"
- Path WITHOUT "/" → creates a FILE. Examples: "src/config.ts", "index.html", "README.md"

When the user asks to:
- "创建文件夹" / "新建文件夹" / "新建目录" / "create folder" / "create directory" → MUST use path ending with "/"
- "创建文件" / "新建文件" / "create file" → MUST use path WITHOUT "/"

Common mistakes to avoid:
- Do NOT create a file when the user wants a folder (e.g., creating "website" instead of "website/")
- Do NOT create a folder when the user wants a file (e.g., creating "config.ts/" instead of "config.ts")
- If you need to create a folder AND files inside it, create the folder FIRST (with "/"), then create files inside it`,
        examples: [
            'create_file_or_folder path="src/"  ← Creates a FOLDER named "utils"',
            'create_file_or_folder path="src/config.ts" content="export default {}"  ← Creates a FILE named "config.ts"',
            'create_file_or_folder path="website/"  ← Creates a FOLDER named "website"',
            'create_file_or_folder path="website/index.html" content="..."  ← Creates a FILE inside the "website" folder',
        ],
        category: 'write',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['filesystem:write'],
        resultSemantics: 'file-write',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root. MUST end with "/" to create a FOLDER (e.g., "src/", "website/"). Without "/" creates a FILE (e.g., "src/config.ts", "index.html").', required: true },
            content: { type: 'string', description: 'Initial content for files (only used when creating files, ignored for folders)' },
        },
    },

    delete_file_or_folder: {
        name: 'delete_file_or_folder',
        displayName: 'Delete',
        description: 'Delete file or folder. Requires approval.',
        detailedDescription: `Delete files or directories.
- Requires user approval
- Use recursive=true for non-empty folders`,
        criticalRules: [
            'DESTRUCTIVE - requires approval',
        ],
        category: 'write',
        approvalType: 'dangerous',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['filesystem:write'],
        resultSemantics: 'file-write',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Path relative to workspace root to delete (e.g., "src/old.ts")', required: true },
            recursive: { type: 'boolean', description: 'REQUIRED for non-empty folders. If false (default) and the folder has contents, deletion will fail. Always set true when deleting a folder.', default: false },
        },
    },

    // ===== 终端工具 =====
    run_command: {
        name: 'run_command',
        displayName: 'Run Command',
        description: 'Execute shell command. Requires user approval. Use cwd parameter to set working directory. Do NOT use for reading files (use read_file), searching (use search_files), or editing (use edit_file).',
        detailedDescription: `Execute shell commands in workspace.
- Requires user approval
- Use cwd parameter instead of cd commands
- Commands are aborted automatically when they exceed their timeout (see below). If a command legitimately needs to run longer, use is_background=true.
Timeout policy:
- Regular commands: 120s
- Broad filesystem scans (e.g. \`find /\`, \`grep -r x /\`, \`du -sh /\`): 60s — avoid them; scope the search to the workspace (e.g. \`find . -name ...\`) or use search_files instead
- Install / build / test commands: 10 minutes
For long-running servers or watch tasks:
- Set is_background=true to run in a UI terminal panel
- The command returns a terminal ID immediately
- Use read_terminal_output to check logs
- Use send_terminal_input to interact (e.g. typing 'y' or sending Ctrl+C)
- Use stop_terminal to kill it later`,
        examples: [
            'run_command command="npm install"',
            'run_command command="npm test" cwd="packages/engine"',
            'run_command command="npm run dev" is_background=true',
        ],
        criticalRules: [
            'NEVER use cat/grep/sed - use dedicated tools',
            'Use cwd parameter instead of cd — NEVER write "cd path && command" or "cd path; command" inside command field',
            'NEVER use && in command — it is not supported on Windows PowerShell 5 (use cwd parameter for directory changes)',
            'Always use is_background=true for servers and dev tasks',
            'NEVER scan the whole filesystem (e.g. `find / -name ...`, `grep -r foo /`) — it times out and wastes the user\'s time; scope to the workspace (`find . -name ...`) or use search_files',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['process:command'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            command: { type: 'string', description: 'Shell command', required: true },
            cwd: { type: 'string', description: 'Working directory relative to workspace root (e.g., "packages/engine", NOT "./packages/engine")', },
            timeout: { type: 'number', description: 'Timeout seconds (0 = no limit).', default: 0 },
            is_background: { type: 'boolean', description: 'Run in background as a visible UI terminal. Required for long-running processes or watchers.', default: false },
        },
    },

    // ===== Git 工具（工作区仓库操作；网络命令自动处理凭证） =====
    git_status: {
        name: 'git_status',
        displayName: 'Git Status',
        description: 'Inspect the git repository state of the workspace: current branch, upstream tracking (ahead/behind), staged / unstaged / untracked files, conflicts, and any in-progress operation (merge/rebase/cherry-pick). Call this BEFORE committing, syncing, or switching branches.',
        detailedDescription: `Read-only git repository inspection.
Returns a structured summary: branch, ahead/behind counts, staged & unstaged changes, untracked files, conflicts, and the ongoing operation (if any).
- Use it to know the workspace baseline before editing or committing
- Safe to call at any time: never modifies the repository`,
        examples: [
            'git_status',
            'git_status include_stash=true',
        ],
        criticalRules: [
            'Prefer git_status over run_command command="git status" — this tool parses the output into structured data and needs no shell escaping',
            'If there are conflicts or an in-progress merge/rebase, resolve that state first instead of starting new work',
        ],
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['repo:read'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            include_stash: { type: 'boolean', description: 'Also list stashed changes', default: false },
        },
    },

    git_diff: {
        name: 'git_diff',
        displayName: 'Git Diff',
        description: 'Read the diff of the workspace repository: uncommitted changes (working tree), staged changes (index), a specific commit, or a single file. Use it to review what changed before writing a commit message or explaining a change to the user.',
        detailedDescription: `Read-only diff inspection.
- target="working" (default): unstaged + untracked changes vs index
- target="staged": what is about to be committed
- target="commit": the changes introduced by \`commit\` (requires commit hash/ref)
- target="branch": diff between current HEAD and \`branch\`
Use \`path\` to narrow the diff to one file. Use \`stat\` for a compact file-level summary when the full diff would be too large.`,
        examples: [
            'git_diff',
            'git_diff target="staged"',
            'git_diff path="src/app.ts"',
            'git_diff target="commit" commit="HEAD~1"',
            'git_diff stat=true',
        ],
        criticalRules: [
            'Prefer { stat: true } first when the diff is likely large, then read the specific file you need',
            'Never paste raw diffs at the user without a short explanation of what changed and why it matters',
        ],
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['repo:read'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            target: { type: 'string', description: 'What to diff: working tree, staged index, a commit, or against another branch', enum: ['working', 'staged', 'commit', 'branch'], default: 'working' },
            path: { type: 'string', description: 'Limit the diff to this file or directory (workspace-relative)', },
            commit: { type: 'string', description: 'Commit hash/ref to diff (required when target="commit", e.g. "HEAD~1")', },
            branch: { type: 'string', description: 'Branch to compare against (required when target="branch")', },
            stat: { type: 'boolean', description: 'Return only a compact +/- statistics summary instead of the full patch', default: false },
        },
    },

    git_log: {
        name: 'git_log',
        displayName: 'Git Log',
        description: 'Read the commit history of the workspace repository (or of a single file). Use it to learn project conventions, find when a change was introduced, or follow the commit-message style already used in the repository.',
        detailedDescription: `Read-only history inspection.
Returns recent commits (hash, short hash, author, date, message). Pass \`path\` to get the history of one file, \`branch\` to inspect another branch, \`grep\` to filter messages by keyword.`,
        examples: [
            'git_log',
            'git_log limit=50',
            'git_log path="src/main.ts"',
            'git_log grep="fix"',
        ],
        criticalRules: [
            'Read git_log before writing a commit message so the message style matches the repository',
            'Prefer { path } over run_command command="git log -- <file>"',
        ],
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['repo:read'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            limit: { type: 'number', description: 'Maximum number of commits to return', default: 20 },
            path: { type: 'string', description: 'Return only the history of this file or directory' },
            branch: { type: 'string', description: 'Branch or ref to read history from (default: current HEAD)' },
            grep: { type: 'string', description: 'Only include commits whose message matches this keyword' },
        },
    },

    git_commit: {
        name: 'git_commit',
        displayName: 'Git Commit',
        description: 'Create a commit in the workspace repository. Stages the requested files (or all tracked changes) and commits them with the given message. Use after finishing a coherent unit of work.',
        detailedDescription: `Commit changes.
- Pass \`files\` to commit only specific paths; omit it to commit all tracked modifications
- \`include_untracked=true\` also stages new (untracked) files, including those matching the current change set
- The message is prefixed automatically for scenarios that require a commit prefix (e.g. legal/medical audit trails)
- In compliance scenarios (legal / medical) an audit tag is sealed automatically right after the commit
Write a concise, imperative commit message describing WHY the change was made (not a file-by-file list).`,
        examples: [
            'git_commit message="fix(auth): handle expired refresh token"',
            'git_commit message="feat: add git credential dialog" files=["src/a.ts","src/b.ts"]',
        ],
        criticalRules: [
            'Only commit work that is complete and verified — never commit broken code to hide it',
            'Inspect changes with git_status / git_diff before committing',
            'Never use run_command command="git commit ..." — this tool also records the checkpoint and applies scenario commit conventions',
            'In legal / medical scenarios the commit is auto-sealed with an audit tag: report the tag name to the user so it can be referenced later',
            'Do NOT add "Co-Authored-By" or tool signatures unless the user asks for them',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['repo:write'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            message: { type: 'string', description: 'Commit message (imperative, concise, explains why)', required: true },
            files: { type: 'array', description: 'Workspace-relative paths to stage and commit (default: all tracked changes)', items: { type: 'string', description: 'File path' } },
            include_untracked: { type: 'boolean', description: 'Also stage untracked files when no explicit file list is given', default: false },
            amend: { type: 'boolean', description: 'Amend the previous commit instead of creating a new one', default: false },
        },
    },

    git_branch: {
        name: 'git_branch',
        displayName: 'Git Branch',
        description: 'List, create, switch, rename, merge or delete branches in the workspace repository. Use a dedicated branch when starting a larger change so the user can review or discard it safely.',
        detailedDescription: `Branch management.
- action="list": show local + remote branches, current branch, upstream tracking
- action="create": create \`name\` (optionally from \`start_point\`); pass switch=true to check it out immediately
- action="switch": check out \`name\`
- action="rename": rename \`name\` to \`new_name\`
- action="merge": merge \`name\` into the current branch
- action="delete": delete \`name\` (force=true uses -D for unmerged branches)`,
        examples: [
            'git_branch action="list"',
            'git_branch action="create" name="feature/git-tools" switch=true',
            'git_branch action="switch" name="main"',
        ],
        criticalRules: [
            'Never delete or force-switch branches without the user explicitly asking for it',
            'Check git_status first — switching branches with uncommitted work can lose or block changes',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['repo:write'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            action: { type: 'string', description: 'Branch operation to perform', required: true, enum: ['list', 'create', 'switch', 'rename', 'merge', 'delete'] },
            name: { type: 'string', description: 'Branch name (required for create/switch/rename/merge/delete)' },
            new_name: { type: 'string', description: 'New branch name (rename only)' },
            start_point: { type: 'string', description: 'Base ref when creating a branch (default: current HEAD)' },
            switch: { type: 'boolean', description: 'Check out the branch right after creating it', default: false },
            force: { type: 'boolean', description: 'Force delete an unmerged branch (delete only) — requires explicit user intent', default: false },
        },
    },

    git_sync: {
        name: 'git_sync',
        displayName: 'Git Sync',
        description: 'Synchronize with the remote repository: pull, push, fetch, or clone. Authentication is handled automatically — if the remote requires credentials that are missing or expired, the user is prompted with a username/password (or token) dialog, then the operation is retried.',
        detailedDescription: `Remote synchronization.
- action="pull": integrate the upstream branch into the current branch
- action="push": publish local commits (set_upstream=true publishes a new branch with -u)
- action="fetch": update remote-tracking refs without touching the working tree
- action="clone": clone \`url\` into \`directory\`
Credentials: reuse of stored credentials is automatic. When the remote asks for authentication, a credential dialog appears for the user; picking "remember" stores it encrypted for later use. Credentials never pass through the model.`,
        examples: [
            'git_sync action="fetch"',
            'git_sync action="pull"',
            'git_sync action="push" set_upstream=true',
            'git_sync action="clone" url="https://github.com/user/repo.git" directory="repo"',
        ],
        criticalRules: [
            'Never run force pushes unless the user explicitly requests it (and warn about rewriting shared history)',
            'Pull BEFORE pushing when the branch is behind, to avoid a rejected push',
            'If the user cancels the credential dialog, report it as cancelled — do not retry in a loop',
            'Do NOT ask the user for their password in chat: the credential dialog collects it securely',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['repo:network'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            action: { type: 'string', description: 'Sync operation to perform', required: true, enum: ['pull', 'push', 'fetch', 'clone'] },
            remote: { type: 'string', description: 'Remote name (default: origin)' },
            branch: { type: 'string', description: 'Branch to sync (default: current tracking branch)' },
            url: { type: 'string', description: 'Repository URL (clone only)' },
            directory: { type: 'string', description: 'Target directory for clone (workspace-relative)' },
            set_upstream: { type: 'boolean', description: 'Publish the branch and set upstream (-u) when pushing', default: false },
            force: { type: 'boolean', description: 'Force push with lease — only when the user explicitly asks', default: false },
        },
    },

    git_worktree: {
        name: 'git_worktree',
        displayName: 'Git Worktree',
        description: 'Manage linked working trees for PARALLEL ISOLATION: give a long-running or exploratory task its own working directory so it never collides with the user\'s current working tree. Use it when several tasks must touch the same repository at once, or when the user asks to work on a branch without disturbing their uncommitted changes.',
        detailedDescription: `Linked worktree management (git worktree).
- action="list" (default): list every working tree with its path, branch and HEAD
- action="add": create a new working directory. \`path\` is resolved relative to the PARENT of the workspace (a sibling directory), so the repository itself stays clean; pass a workspace-relative name like "myrepo-experiment"
- action="remove": delete a linked working tree (refuses when it has uncommitted changes; pass force=true only after confirming with the user)
- action="prune": drop metadata of working trees whose directory was deleted manually

Why it matters: file edits, \`run_command\` and builds inside a linked worktree cannot disturb the files the user has open. A branch can only be checked out in ONE worktree at a time, so use \`create_branch=true\` for a fresh branch instead of reusing the current one.`,
        examples: [
            'git_worktree',
            'git_worktree action="add" path="myrepo-spike" create_branch=true branch="spike/parallel-task"',
            'git_worktree action="add" path="myrepo-review" branch="feature/login"',
            'git_worktree action="remove" path="myrepo-spike"',
            'git_worktree action="prune"',
        ],
        criticalRules: [
            'ALWAYS run the task inside the returned worktree path (use run_command cwd, and pass that path to file tools) — creating a worktree and then editing the main workspace defeats the purpose',
            'A branch cannot be checked out in two worktrees: pass create_branch=true instead of reusing the branch already checked out in the main workspace',
            'Prefer action="list" first when you are unsure what already exists',
            'Never force-remove a worktree that still holds uncommitted work — ask the user first',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['repo:write'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            action: { type: 'string', description: 'Worktree operation', enum: ['list', 'add', 'remove', 'prune'], default: 'list' },
            path: { type: 'string', description: 'Working directory: a sibling name of the workspace (e.g. "myrepo-spike") for add; the path returned by list for remove' },
            branch: { type: 'string', description: 'Branch to check out (add only). With create_branch=true this is the NEW branch name' },
            create_branch: { type: 'boolean', description: 'Create the branch and check it out in the new worktree (-b)', default: false },
            start_point: { type: 'string', description: 'Commit/branch to start the new branch from (add + create_branch only, default HEAD)' },
            force: { type: 'boolean', description: 'Force the operation (--force). Only after the user explicitly confirms', default: false },
        },
    },

    git_audit: {
        name: 'git_audit',
        displayName: 'Git Audit Seal',
        description: 'Seal an immutable audit record of the current repository state: commit any pending changes and create an annotated audit tag pointing at the resulting commit. Use it for compliance-sensitive work (legal / medical / regulated document review) where a traceable, tamper-evident trail is required.',
        detailedDescription: `Audit trail sealing.
- action="seal": commit pending changes (if any), then create an annotated tag \`audit-<timestamp>\` on HEAD. The tag annotation records seal time, commit hash, changed-file count and the reason
- action="list": list existing audit tags, newest first
- action="verify": check that an audit tag is intact — annotated tags are content-addressed, so moving or re-pointing one breaks verification

An annotated tag is the minimum sufficient guarantee: its message participates in the tag object\'s own hash, so the sealed commit cannot be silently rewritten and still pass verification.`,
        examples: [
            'git_audit action="seal" reason="合同条款审阅完成"',
            'git_audit action="seal" tag="audit-contract-v2" reason="第二版定稿"',
            'git_audit',
            'git_audit action="verify" tag="audit-20260917-113425"',
        ],
        criticalRules: [
            'Call seal only when the user asks for an auditable checkpoint, or when the active scenario is compliance-sensitive — it commits pending work',
            'Never rewrite history (amend / rebase / tag move) after sealing: it invalidates the audit trail',
            'Pass require_clean=true when the user wants the seal to cover ONLY already-committed state',
            'After sealing, report the tag name to the user so it can be referenced later',
        ],
        category: 'terminal',
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['repo:write'],
        resultSemantics: 'text',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            action: { type: 'string', description: 'Audit operation', enum: ['seal', 'list', 'verify'], default: 'seal' },
            reason: { type: 'string', description: 'Why this checkpoint is being sealed (written into the tag annotation)' },
            tag: { type: 'string', description: 'Explicit tag name (seal / verify). Defaults to audit-<timestamp>' },
            require_clean: { type: 'boolean', description: 'Refuse to seal when uncommitted changes exist (seal only)', default: false },
        },
    },

    external_agent_delegate: {
        name: 'external_agent_delegate',
        displayName: 'External Agent Delegate',
        description: 'Delegate a coding task to an external autonomous AI coding agent (Claude Code / Codex CLI). The agent runs in a sandboxed workspace directory with its own tool loop, file editing and test execution. Returns the final result and a session id for resuming. Use only when the user explicitly asks to use an external agent, or for large multi-file coding tasks where a dedicated coding agent is preferred.',
        detailedDescription: `Delegate a task to an external coding agent.
- The external agent (Claude Code / Codex CLI) is a full autonomous coding agent: it plans, edits files, runs tests, and reports back
- It runs in the given workdir (must be inside the current workspace) with a permission mode
- The call blocks until the agent finishes (may take minutes); progress is streamed to the UI
- Returns: success, final output, and a session id (pass to resume_session to continue the same task later)
- Prefer the built-in tools (edit_file, run_command, ...) for small changes; use this only for substantial coding work`,
        examples: [
            'external_agent_delegate agent="claude-code" task="Add input validation and unit tests to the login form" workdir="src"',
            'external_agent_delegate agent="codex" task="Fix the failing CI test" permission_mode="acceptEdits"',
        ],
        criticalRules: [
            'Only use when the user explicitly requests an external agent or for large multi-file coding tasks',
            'workdir MUST be a directory inside the current workspace (relative paths are resolved against the workspace root)',
            'Default permission_mode is "acceptEdits"; use "planOnly" for review-only, "bypass" only with explicit user consent',
            'The call may run for minutes; do NOT retry it on apparent slowness',
        ],
        category: 'terminal',
        // 'dangerous'：外部 Agent 拥有文件编辑 + 命令执行权限（等效 run_command 高危），
        // dangerous-only 授权模式下必须经用户确认；不可用 'terminal'（会被 autoApprove.terminal 静默放行）
        approvalType: 'dangerous',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['process:external-agent'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            agent: {
                type: 'string',
                description: 'External agent id: "claude-code" (Claude Code CLI), "codex" (Codex CLI), or "cursor" (Cursor headless CLI).',
                required: true,
                enum: ['claude-code', 'codex', 'cursor'],
            },
            task: {
                type: 'string',
                description: 'Natural-language task description to hand to the external agent (be specific about goals and acceptance criteria).',
                required: true,
            },
            workdir: {
                type: 'string',
                description: 'Working directory for the agent, relative to the workspace root (default: "." for the workspace root). Must stay inside the workspace.',
                default: '.',
            },
            permission_mode: {
                type: 'string',
                description: 'Permission level: "default" (agent may read), "acceptEdits" (agent may edit files), "planOnly" (agent only plans), "bypass" (no approvals, dangerous). Default "acceptEdits".',
                enum: ['default', 'acceptEdits', 'planOnly', 'bypass'],
            },
            resume_session: {
                type: 'string',
                description: 'Optional session id from a previous run to continue that task (resumes context).',
            },
            timeout_ms: {
                type: 'number',
                description: 'Optional max runtime in ms (default 30 minutes).',
            },
        },
    },

    external_agent_status: {
        name: 'external_agent_status',
        displayName: 'External Agent Status',
        description: 'Check the status/result of a delegated external agent run by its request id. Use after external_agent_delegate to poll progress or retrieve the final result without waiting.',
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['process:external-agent'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            request_id: {
                type: 'string',
                description: 'The requestId returned by external_agent_delegate',
                required: true,
            },
        },
    },

    external_agent_abort: {
        name: 'external_agent_abort',
        displayName: 'External Agent Abort',
        description: 'Abort a running external agent run by its request id. Use when the user asks to stop it or when it is clearly stuck.',
        category: 'terminal',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['process:external-agent'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            request_id: {
                type: 'string',
                description: 'The requestId to abort',
                required: true,
            },
        },
    },

    read_terminal_output: {
        name: 'read_terminal_output',
        displayName: 'Read Terminal',
        description: 'Read the output buffer of a background UI terminal.',
        detailedDescription: `Get the recent output lines of a running terminal.
- Use the terminal ID returned from a background run_command
- By default returns the last 100 lines`,
        category: 'terminal',
        approvalType: 'none',
        parallel: true,
        concurrencyMode: 'parallel-safe',
        resourceScope: ['process:terminal-read'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to read from', required: true },
            lines: { type: 'number', description: 'Number of recent lines to read (default 100)', default: 100 },
        },
    },

    send_terminal_input: {
        name: 'send_terminal_input',
        displayName: 'Terminal TextField',
        description: 'Send text input or keystrokes to a background UI terminal.',
        detailedDescription: `Send keystrokes to an interactive terminal.
- Supports raw text or special keys
- Required for answering prompts (e.g., Y/N) in commands
- Set is_ctrl=true to send combinations like Ctrl+C`,
        category: 'terminal',
        // 'terminal'：可向交互式终端注入文本并回车，等效于在已开终端内执行命令，
        // 风险与 run_command 同级，不可用 'none'（会被静默放行，绕过审批门）
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['process:terminal-write'],
        resultSemantics: 'interactive',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'semantic',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to send input to', required: true },
            input: { type: 'string', description: 'Text to send. For regular text/answers: "yes\\n", "Y\\n". For Ctrl combos: MUST be a single letter (e.g. "c" for Ctrl+C, "d" for Ctrl+D, "z" for Ctrl+Z) — only used when is_ctrl=true.', required: true },
            is_ctrl: { type: 'boolean', description: 'If true, sends input as a Ctrl key combo. input MUST be a single character (e.g. is_ctrl=true, input="c" → Ctrl+C). Default: false.', default: false },
        },
    },
    stop_terminal: {
        name: 'stop_terminal',
        displayName: 'Stop Terminal',
        description: 'Stop a background UI terminal process and close its panel.',
        detailedDescription: `Kill a terminal process and cleanup UI.
- Use this when a dev server or watcher is no longer needed`,
        category: 'terminal',
        // 'terminal'：终止进程属于终端副作用操作，与 run_command 同级审批，不可用 'none'
        approvalType: 'terminal',
        parallel: false,
        concurrencyMode: 'serialized',
        resourceScope: ['process:terminal-write'],
        resultSemantics: 'command',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'schema',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            terminal_id: { type: 'string', description: 'The ID of the terminal to stop', required: true },
        },
    },

    // ===== LSP 工具 =====
    get_lint_errors: {
        name: 'get_lint_errors',
        displayName: 'Lint Errors',
        description: 'Get TypeScript/ESLint errors for a file. Use after editing to verify code. If results seem stale, pass refresh=true to force re-check.',
        detailedDescription: `Get diagnostics (errors, warnings) for a file.
- Shows TypeScript/ESLint errors
- Use after editing to verify code
- Use refresh=true if results seem outdated`,
        criticalRules: [
            'Call once after editing, not repeatedly',
            'If errors persist after a fix, use refresh=true to force re-check',
        ],
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root to check (e.g., "src/main.ts")', required: true },
            refresh: { type: 'boolean', description: 'Force re-check instead of using cached diagnostics (default: false)', default: false },
        },
    },

    find_references: {
        name: 'find_references',
        displayName: 'Find References',
        description: 'Find all references to a symbol across the codebase. TIP: Use read_file to see the line/column of the symbol first, or use get_document_symbols to find symbol positions.',
        detailedDescription: `Find all usages of a symbol across codebase.
- Requires exact file position (line, column)
- To find the position: use read_file and note the line number, column is the 1-indexed character offset within the line
- Or use get_document_symbols to list all symbols with their positions
- Useful for refactoring`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    go_to_definition: {
        name: 'go_to_definition',
        displayName: 'Go to Definition',
        description: 'Get the definition location of a symbol. TIP: Use read_file to find the line/column where the symbol is used, or use get_document_symbols to list positions.',
        detailedDescription: `Navigate to where a symbol is defined.
- To find position: read_file and note line number; column is 1-indexed character offset within the line
- Or use get_document_symbols to find symbol positions in a file`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    get_hover_info: {
        name: 'get_hover_info',
        displayName: 'Hover Info',
        description: 'Get type info and documentation for a symbol at a position. TIP: Use read_file to find the line/column, or get_document_symbols for symbol positions.',
        detailedDescription: `Get TypeScript type info, signatures, and JSDoc for a symbol.
- To find position: read_file and note line number; column is 1-indexed character offset within the line
- Useful for understanding unfamiliar types or APIs`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
            line: { type: 'number', description: 'Line number (1-indexed). Use read_file to find it.', required: true },
            column: { type: 'number', description: 'Column (character offset, 1-indexed). Count from start of line to the symbol.', required: true },
        },
    },

    get_document_symbols: {
        name: 'get_document_symbols',
        displayName: 'Document Symbols',
        description: 'List all functions, classes, interfaces, and variables defined in a file. Use to understand file structure.',
        detailedDescription: `List all symbols defined in a file.
- Shows functions, classes, interfaces, variables`,
        category: 'lsp',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'File path relative to workspace root (e.g., "src/main.ts")', required: true },
        },
    },



    // ===== 网络工具 =====
    web_search: {
        name: 'web_search',
        displayName: 'Web Search',
        description: 'General web search for current information. Use this for ALL web query needs: facts, news, products, food, restaurants, travel, reviews, recommendations, encyclopedia, automobiles, real estate, technology, etc.',
        detailedDescription: `Search the web using the configured search engine (SearXNG by default).

WHEN TO USE web_search:
- All web information queries: facts, news, products, food, restaurants, travel, reviews, recommendations
- Encyclopedia questions ("什么是X", "X简介", "X定义")
- Automobile / real estate / technology / news queries ("汽车", "房价", "手机", "AI")
- Any question needing up-to-date information from the web

IMPORTANT GUIDELINES:
- Use ONE well-crafted search query that covers your information need
- DO NOT make multiple separate searches for related topics - combine them into one query
- Use specific keywords and phrases for better results
- For technical topics, include version numbers or specific terms

CONTENT SUMMARIES:
- The top 3 results now include a "content" field with a prefetched page summary (up to 800 chars)
- In MOST cases, the snippet + content summary is sufficient — you do NOT need to call read_url
- Only call read_url if the content summary is missing or you need the full page text

GOOD: "React 18 useEffect cleanup function best practices"
BAD: Multiple searches like "React useEffect", "useEffect cleanup", "React best practices"`,
        category: 'network',
        approvalType: 'none',
        parallel: false,  // 禁止并行，避免多次分散搜索
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: {
                type: 'string',
                description: 'Search query - use ONE comprehensive query with specific keywords. Combine related topics into a single search.',
                required: true,
            },
            max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)', default: 5 },
            timeout: { type: 'number', description: 'Timeout in seconds (0 = no limit).', default: 0 },
        },
    },

    read_url: {
        name: 'read_url',
        displayName: 'Read URL',
        description: 'Fetch and read content from a URL. Use after web_search to get detailed information from specific pages.',
        detailedDescription: `Read the content of a web page using Jina Reader for optimized LLM-friendly output.

WHEN TO USE:
- After web_search returns relevant URLs that need detailed reading
- When you have a specific URL from the user or documentation
- To read API documentation, blog posts, or technical articles

TIPS:
- Jina Reader handles JavaScript-rendered pages (SPAs)
- For API endpoints or raw files, content is fetched directly
- Large pages are automatically truncated to 500KB`,
        category: 'network',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)', required: true },
            timeout: { type: 'number', description: 'Timeout in seconds (0 = no limit).', default: 0 },
        },
    },

    image_search: {
        name: 'image_search',
        displayName: 'Image Search',
        description: 'Search for images on the web. Returns image direct links and thumbnails.',
        detailedDescription: `Search for images using the configured search engine (SearXNG images category).

WHEN TO USE:
- When the user asks to find, search, or look for images/pictures/photos
- When you need image URLs for display, download, or reference
- When the user wants visual content on a specific topic

RESULTS:
- Each result includes: title, page URL, image direct link (imgSrc), thumbnail link, and source engine
- The imgSrc field is the direct URL to the image file (can be used in img tags or downloaded)
- The thumbnailSrc field is a smaller preview image

TIPS:
- Use descriptive queries with visual keywords (e.g., "sunset landscape", "React logo")
- For specific image types, add keywords like "screenshot", "diagram", "icon", "wallpaper"`,
        category: 'network',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: {
                type: 'string',
                description: 'Image search query - use descriptive keywords for visual content.',
                required: true,
            },
            max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)', default: 5 },
            timeout: { type: 'number', description: 'Timeout in seconds (0 = no limit).', default: 0 },
        },
    },

    video_search: {
        name: 'video_search',
        displayName: 'Video Search',
        description: 'Search for videos on the web. Returns video links, thumbnails, duration, and author.',
        detailedDescription: `Search for videos using the configured search engine (SearXNG videos category).

WHEN TO USE:
- When the user asks to find, search, or look for videos
- When you need video URLs for reference or playback
- When the user wants video content on a specific topic

RESULTS:
- Each result includes: title, video URL, thumbnail, duration (length), author, and source engine
- The thumbnail field is a preview image of the video
- The length field shows the video duration (e.g., "10:30")
- The author field shows the channel or uploader name

TIPS:
- Use descriptive queries with video keywords (e.g., "React tutorial", "Python course")
- For specific video types, add keywords like "tutorial", "demo", "review", "talk"`,
        category: 'network',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: {
                type: 'string',
                description: 'Video search query - use descriptive keywords for video content.',
                required: true,
            },
            max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)', default: 5 },
            timeout: { type: 'number', description: 'Timeout in seconds (0 = no limit).', default: 0 },
        },
    },

    ask_user: {
        name: 'ask_user',
        displayName: 'Ask User',
        description: 'Ask user to select from options to gather requirements or preferences.',
        detailedDescription: `Present interactive options to the user and wait for their selection.
- Use to gather requirements, preferences, or confirmations
- Options are displayed as clickable cards
- Supports single or multiple selection
- The tool blocks until user makes a selection`,
        examples: [
            'ask_user question="What type of task?" options=[{id:"feature",label:"New Feature"},{id:"bugfix",label:"Bug Fix"}]',
            'ask_user question="Which files to modify?" options=[...] multi_select=true',
        ],
        criticalRules: [
            'Use to gather requirements, preferences, or confirmations',
            'Keep options concise and clear',
            'Provide descriptions for complex options',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['interaction:user'],
        resultSemantics: 'interactive',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            question: { type: 'string', description: 'Question to ask the user', required: true },
            options: {
                type: 'array',
                description: 'Options for user to select from',
                required: true,
                items: {
                    type: 'object',
                    description: 'Option item. Use "id" or "value" as unique identifier.',
                    properties: {
                        // id 和 value 都可选，执行器会处理
                        id: { type: 'string', description: 'Unique option ID' },
                        value: { type: 'string', description: 'Alternative to id (will be used as id if id is not provided)' },
                        label: { type: 'string', description: 'Display label', required: true },
                        description: { type: 'string', description: 'Optional description' },
                    },
                },
            },
            multi_select: { type: 'boolean', description: 'Allow selecting multiple options (default: false)', default: false },
        },
    },

    ask_form: {
        name: 'ask_form',
        displayName: 'Ask Form',
        description: 'Generate a structured form for the user to fill in specific information. Use this when you need structured data input from the user, such as configuration details, personal information, or task parameters.',
        detailedDescription: `Present a structured form to the user and wait for them to fill it in.
- Use when you need structured data input (not just a choice)
- Supports various field types: text, textarea, select, number, email, date, checkbox, radio, password
- Each field can have validation rules (required, min/max, pattern)
- The tool blocks until user submits the form
- Form data is returned as structured key-value pairs`,
        examples: [
            'ask_form title="User Registration" fields=[{id:"name",type:"text",label:"Full Name",required:true},{id:"email",type:"email",label:"Email",required:true},{id:"role",type:"select",label:"Role",options:[{label:"Developer",value:"dev"},{label:"Designer",value:"design"}]}]',
            'ask_form title="Database Config" description="Please provide database connection details" fields=[{id:"host",type:"text",label:"Host",defaultValue:"localhost"},{id:"port",type:"number",label:"Port",defaultValue:5432,min:1,max:65535},{id:"password",type:"password",label:"Password",required:true}]',
        ],
        criticalRules: [
            'Use ask_form when you need structured data, not just a choice (use ask_user for choices)',
            'Keep forms concise - prefer 3-8 fields per form',
            'Always mark required fields',
            'Provide sensible default values when possible',
            'Use appropriate field types (email for emails, number for numbers, etc.)',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        concurrencyMode: 'approval-gated',
        resourceScope: ['interaction:user'],
        resultSemantics: 'interactive',
        retryPolicy: { maxAttempts: 1 },
        validationLevel: 'strict',
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            title: { type: 'string', description: 'Form title', required: true },
            description: { type: 'string', description: 'Optional description or instructions shown below the title' },
            submit_label: { type: 'string', description: 'Custom label for the submit button (default: "Submit")', default: 'Submit' },
            fields: {
                type: 'array',
                description: 'Form fields definition',
                required: true,
                items: {
                    type: 'object',
                    description: 'A form field',
                    properties: {
                        id: { type: 'string', description: 'Unique field identifier (used as key in returned data)', required: true },
                        type: { type: 'string', description: 'Field type: text, textarea, select, number, email, date, checkbox, radio, password', required: true },
                        label: { type: 'string', description: 'Display label', required: true },
                        placeholder: { type: 'string', description: 'Placeholder text' },
                        required: { type: 'boolean', description: 'Whether the field is required (default: false)', default: false },
                        default_value: { type: 'string', description: 'Default value for the field' },
                        options: {
                            type: 'array',
                            description: 'Options for select/radio fields',
                            items: {
                                type: 'object',
                                description: 'An option item',
                                properties: {
                                    label: { type: 'string', description: 'Display label', required: true },
                                    value: { type: 'string', description: 'Option value', required: true },
                                },
                            },
                        },
                        min: { type: 'number', description: 'Minimum value for number fields' },
                        max: { type: 'number', description: 'Maximum value for number fields' },
                        pattern: { type: 'string', description: 'Regex pattern for validation' },
                        description: { type: 'string', description: 'Help text shown below the field' },
                    },
                },
            },
        },
    },

    create_task_plan: {
        name: 'create_task_plan',
        displayName: 'Create Task Plan',
        description: 'Create a structured task plan with requirements document and task list. Supports graphVersion=2 for advanced plans with conditional edges, retry loops, and runtime graph expansion.',
        detailedDescription: `Generate a task plan file that will be displayed in the ExecutionBoard.
- Creates a plan file in ${BRAND.dirName}/planner/ directory
- Automatically opens the ExecutionBoard tab
- Each task includes suggested provider/model/role
- User can modify assignments before execution

**Graph Runtime (graphVersion=2)** — use when tasks need:
- Conditional routing (different paths based on results)
- Retry with reflection (failed task auto-retries with adjusted strategy)
- Human-in-the-loop approval nodes (pause for user input)
- Runtime graph expansion (add nodes during execution)

Set \`graphVersion=2\` and optionally \`allowDynamicExpansion=true\` + \`edges\` array to define explicit routing.
Nodes with \`nodeType="task"\` (default) use sub-agent loops; \`nodeType="llm/tool/decision/human"\` use lightweight executors.
Loop edges (\`type="loop"\`) point back to a node for retry; set \`maxIterations\` (default 2) and \`reflectionPrompt\` on the source node.`,
        examples: [
            'create_task_plan name="Login Page" requirementsDoc="..." tasks=[{title:"Create form",suggestedProvider:"anthropic",suggestedModel:"claude-sonnet-4",suggestedRole:"coder"}]',
            'create_task_plan name="Refactor with Retry" graphVersion=2 requirementsDoc="..." tasks=[{title:"Implement core",nodeType:"task",maxIterations:3,reflectionPrompt:"If tests fail, fix the root cause"}] edges=[{source:"task-1",target:"task-1",type:"loop"}]',
        ],
        criticalRules: [
            'Always gather requirements with ask_user before creating a plan',
            'Break complex requests into atomic tasks',
            'Suggest appropriate models based on task complexity',
            'Include clear task descriptions',
            'Use graphVersion=2 only when conditional routing or retry loops are needed; default graphVersion=1 for linear tasks',
            'When using edges, every edge source/target must reference an existing task id',
        ],
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            name: { type: 'string', description: 'Human-readable name for the plan', required: true },
            requirementsDoc: { type: 'string', description: 'Markdown formatted requirements document', required: true },
            tasks: {
                type: 'array',
                description: 'List of tasks to execute',
                required: true,
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Detailed task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Recommended provider', required: true, enum: ['anthropic', 'openai', 'gemini', 'ollama'] },
                        suggestedModel: { type: 'string', description: 'Recommended model ID (e.g., "claude-sonnet-4-6", "gpt-4o", "gemini-2.0-flash")', required: true },
                        suggestedRole: { type: 'string', description: 'Recommended role/persona (e.g., "coder", "reviewer", "planner", "tester")', required: true },
                        dependencies: { type: 'array', description: 'IDs of tasks this depends on', items: { type: 'string', description: 'Task ID' } },
                        nodeType: { type: 'string', description: 'Node type for graphVersion=2 (default "task"). "task"=sub-agent loop, "llm"=single LLM call, "tool"=direct tool execution, "decision"=pure routing, "human"=HITL pause', enum: ['task', 'llm', 'tool', 'decision', 'human'] },
                        maxIterations: { type: 'number', description: 'Max retry iterations for loop nodes (default 2, range 1-10)' },
                        reflectionPrompt: { type: 'string', description: 'Reflection guidance for retry nodes — injected as context when retrying to help LLM adjust strategy' },
                        llmPrompt: { type: 'string', description: 'Prompt for llm-type nodes (defaults to description if omitted)' },
                        toolCall: { type: 'object', description: 'Tool call for tool-type nodes', properties: { name: { type: 'string', description: 'Tool name', required: true }, arguments: { type: 'object', description: 'Tool arguments' } } },
                        requireApproval: { type: 'boolean', description: 'Force human approval before this node executes (overrides global auth mode)' },
                    },
                },
            },
            executionMode: { type: 'string', description: 'Default execution mode: sequential or parallel', enum: ['sequential', 'parallel'], default: 'sequential' },
            graphVersion: { type: 'number', description: 'Graph capability version: 1=static DAG (default, existing behavior), 2=dynamic graph (enables conditional edges, retry loops, runtime graph expansion). Use 2 for plans needing retry or conditional routing.', default: 1 },
            allowDynamicExpansion: { type: 'boolean', description: 'Allow runtime dynamic node addition (only effective when graphVersion=2)', default: false },
            edges: {
                type: 'array',
                description: 'Explicit graph edges for graphVersion=2. Defines routing after node completion. When omitted, falls back to dependencies-based topological progression.',
                items: {
                    type: 'object',
                    description: 'Graph edge definition',
                    properties: {
                        source: { type: 'string', description: 'Source node id', required: true },
                        target: { type: 'string', description: 'Target node id', required: true },
                        type: { type: 'string', description: 'Edge type: "simple"=unconditional, "conditional"=evaluated by condition, "loop"=retry target (points back for retry)', enum: ['simple', 'conditional', 'loop'], required: true },
                        conditionKind: { type: 'string', description: 'Condition evaluation kind (only for type="conditional"): "rule"=declarative expression, "llm"=async LLM judgment', enum: ['rule', 'llm'] },
                        conditionExpression: { type: 'string', description: 'Rule expression for conditionKind="rule" (e.g., "node.status === \'failed\'")' },
                        conditionPrompt: { type: 'string', description: 'LLM judgment prompt for conditionKind="llm" (e.g., "Does the upstream output contain errors requiring retry?")' },
                        maxIterations: { type: 'number', description: 'Loop edge max iterations (overrides node maxIterations, default 2, range 1-10)' },
                    },
                },
            },
        },
    },

    update_task_plan: {
        name: 'update_task_plan',
        displayName: 'Update Task Plan',
        description: 'Update an existing task plan based on user feedback. Can modify requirements, add/remove/update tasks.',
        detailedDescription: `Use this tool to modify an existing task plan when user requests changes.
You can:
- Update the requirements document
- Add new tasks
- Remove existing tasks
- Modify task details (title, description, model, role)
- Change execution mode`,
        examples: [
            'update_task_plan planId="login-1234" updateRequirements="增加密码强度验证" addTasks=[{title: "密码验证", ...}]',
            'update_task_plan planId="login-1234" removeTasks=["task-001"]',
        ],
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID to update', required: true },
            updateRequirements: { type: 'string', description: 'Additional requirements to append (markdown)' },
            addTasks: {
                type: 'array',
                description: 'New tasks to add',
                items: {
                    type: 'object',
                    description: 'Task definition',
                    properties: {
                        title: { type: 'string', description: 'Task title', required: true },
                        description: { type: 'string', description: 'Task description', required: true },
                        suggestedProvider: { type: 'string', description: 'Provider' },
                        suggestedModel: { type: 'string', description: 'Model' },
                        suggestedRole: { type: 'string', description: 'Role' },
                        insertAfter: { type: 'string', description: 'Insert after this task ID' },
                        nodeType: { type: 'string', description: 'Node type for graphVersion=2', enum: ['task', 'llm', 'tool', 'decision', 'human'] },
                        maxIterations: { type: 'number', description: 'Max retry iterations for loop nodes (range 1-10)' },
                        reflectionPrompt: { type: 'string', description: 'Reflection guidance for retry nodes' },
                        llmPrompt: { type: 'string', description: 'Prompt for llm-type nodes' },
                        toolCall: { type: 'object', description: 'Tool call for tool-type nodes', properties: { name: { type: 'string', description: 'Tool name', required: true }, arguments: { type: 'object', description: 'Tool arguments' } } },
                        requireApproval: { type: 'boolean', description: 'Force human approval before this node' },
                        dependencies: { type: 'array', description: 'IDs of tasks this depends on', items: { type: 'string', description: 'Task ID' } },
                    },
                },
            },
            removeTasks: {
                type: 'array',
                description: 'Task IDs to remove',
                items: { type: 'string', description: 'Task ID to remove' },
            },
            updateTasks: {
                type: 'array',
                description: 'Tasks to update',
                items: {
                    type: 'object',
                    description: 'Task update',
                    properties: {
                        taskId: { type: 'string', description: 'Task ID', required: true },
                        title: { type: 'string', description: 'New title' },
                        description: { type: 'string', description: 'New description' },
                        provider: { type: 'string', description: 'New provider' },
                        model: { type: 'string', description: 'New model' },
                        role: { type: 'string', description: 'New role' },
                        nodeType: { type: 'string', description: 'Change node type (graphVersion=2)', enum: ['task', 'llm', 'tool', 'decision', 'human'] },
                        maxIterations: { type: 'number', description: 'Change max retry iterations (range 1-10)' },
                        reflectionPrompt: { type: 'string', description: 'Update reflection guidance' },
                        requireApproval: { type: 'boolean', description: 'Toggle human approval requirement' },
                    },
                },
            },
            executionMode: { type: 'string', description: 'New execution mode', enum: ['sequential', 'parallel'] },
            setGraphVersion: { type: 'number', description: 'Upgrade graph capability version. Use 2 to enable graph features (conditional edges, retry loops). Use 1 to downgrade to static DAG.' },
            setAllowDynamicExpansion: { type: 'boolean', description: 'Toggle runtime dynamic node addition (only effective when graphVersion=2)' },
            updateEdges: {
                type: 'array',
                description: 'Replace/append graph edges (graphVersion=2). Clears existing edges on matching source nodes and re-assigns.',
                items: {
                    type: 'object',
                    description: 'Graph edge definition',
                    properties: {
                        source: { type: 'string', description: 'Source node id', required: true },
                        target: { type: 'string', description: 'Target node id', required: true },
                        type: { type: 'string', description: 'Edge type', enum: ['simple', 'conditional', 'loop'], required: true },
                        conditionKind: { type: 'string', description: 'Condition kind for conditional edges', enum: ['rule', 'llm'] },
                        conditionExpression: { type: 'string', description: 'Rule expression' },
                        conditionPrompt: { type: 'string', description: 'LLM judgment prompt' },
                        maxIterations: { type: 'number', description: 'Loop max iterations (range 1-10)' },
                    },
                },
            },
        },
    },

    start_task_execution: {
        name: 'start_task_execution',
        displayName: 'Start Task Execution',
        description: 'Start executing tasks in the active plan. Call this when user confirms they want to proceed.',
        detailedDescription: `Use this tool when user says things like:
- "开始执行"
- "执行" / "run"
- "开始" / "start"
- "Go ahead" / "Proceed"

This will trigger the task executor to run through the plan.`,
        examples: [
            'start_task_execution',
            'start_task_execution planId="login-1234"',
        ],
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            planId: { type: 'string', description: 'Plan ID (optional, uses active plan if not specified)' },
        },
    },

    // ===== Graph Runtime 动态建图工具（阶段三）=====
    // 仅在 graphVersion=2 且 allowDynamicExpansion=true 的图执行期间有效
    // 执行期 LLM 发现需补充子任务时调用，新增节点进入调度队列
    add_node: {
        name: 'add_node',
        displayName: 'Add Graph Node',
        description: 'Dynamically add a new node to the executing graph at runtime. Only works when the active plan uses graphVersion=2 with allowDynamicExpansion=true. Use when execution reveals additional sub-tasks are needed.',
        detailedDescription: `Dynamically extend the executing graph by adding a new node.
- Only available during execution of a dynamic graph (graphVersion=2, allowDynamicExpansion=true)
- New node enters the scheduler queue; once its dependencies are satisfied it executes
- nodeType defaults to 'task' (sub-agent loop); use 'llm' for lightweight decisions, 'tool' for direct tool execution, 'decision' for pure routing, 'human' for HITL pause
- Set dependencies to control when the new node becomes executable
- Optionally set edges to define explicit outgoing routing (conditional/loop)
- Common use: a coder task discovers an unhandled edge case → add_node to supplement`,
        examples: [
            'add_node title="Add input validation" description="Validate email format before submit" provider="anthropic" model="claude-sonnet-4" role="coder" dependencies=["task-3"]',
            'add_node title="Retry with fallback API" nodeType="task" dependencies=["task-5"] maxIterations=3',
        ],
        criticalRules: [
            'Only call when the active plan is a dynamic graph (graphVersion=2)',
            'New node id must be unique within the graph; auto-generated if omitted',
            'Dependencies must reference existing node ids',
        ],
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            title: { type: 'string', description: 'Node title', required: true },
            description: { type: 'string', description: 'Detailed node description / task instructions', required: true },
            nodeType: {
                type: 'string',
                description: "Node type (default 'task'). 'task'=sub-agent loop, 'llm'=single LLM call, 'tool'=direct tool, 'decision'=pure routing, 'human'=HITL pause",
                enum: ['task', 'llm', 'tool', 'decision', 'human'],
            },
            provider: { type: 'string', description: 'Provider for task node (e.g., anthropic, openai, gemini, ollama)' },
            model: { type: 'string', description: 'Model id for task node' },
            role: { type: 'string', description: 'Role/persona for task node (e.g., coder, reviewer, planner, tester)' },
            dependencies: {
                type: 'array',
                description: 'Ids of nodes this new node depends on (must exist in graph)',
                items: { type: 'string', description: 'Existing node id' },
            },
            maxIterations: { type: 'number', description: 'Max loop iterations for this node (default 2, only meaningful with loop edges)' },
            requireApproval: { type: 'boolean', description: 'Force human approval when this node executes (overrides global authorization mode)' },
        },
    },

    add_edge: {
        name: 'add_edge',
        displayName: 'Add Graph Edge',
        description: 'Dynamically add an outgoing edge to a node in the executing graph. Only works when the active plan uses graphVersion=2 with allowDynamicExpansion=true. Use to define explicit routing (conditional/loop) at runtime.',
        detailedDescription: `Dynamically add an edge from an existing node to another node.
- Only available during execution of a dynamic graph (graphVersion=2, allowDynamicExpansion=true)
- Edge types: 'simple' (unconditional), 'conditional' (rule/llm based), 'loop' (retry target)
- For conditional edges, provide condition with kind='rule' (expression) or kind='llm' (prompt)
- For loop edges, set maxIterations to cap retry count (default 2)
- Edges define outgoing routing; node dependencies still control readiness`,
        examples: [
            'add_edge sourceId="task-3" targetId="task-4" type="simple"',
            'add_edge sourceId="task-5" targetId="task-5" type="loop" maxIterations=3',
            'add_edge sourceId="task-2" targetId="task-6" type="conditional" conditionKind="rule" conditionExpression="state.retryCount < 2"',
        ],
        criticalRules: [
            'Both sourceId and targetId must reference existing nodes in the graph',
            'Conditional edges short-circuit: first matching condition wins',
            'Loop edges target already-executed nodes (including self) for retry',
        ],
        category: 'plan',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            sourceId: { type: 'string', description: 'Id of the source node (must exist)', required: true },
            targetId: { type: 'string', description: 'Id of the target node (must exist)', required: true },
            type: {
                type: 'string',
                description: "Edge type: 'simple'=unconditional, 'conditional'=rule/llm based, 'loop'=retry",
                enum: ['simple', 'conditional', 'loop'],
                required: true,
            },
            conditionKind: {
                type: 'string',
                description: "Condition evaluator (only for type='conditional'): 'rule'=declarative expression, 'llm'=async LLM judgment",
                enum: ['rule', 'llm'],
            },
            conditionExpression: {
                type: 'string',
                description: "Rule expression when conditionKind='rule' (e.g., \"state.retryCount < 3 && node.status === 'failed'\")",
            },
            conditionPrompt: {
                type: 'string',
                description: "LLM judgment prompt when conditionKind='llm'",
            },
            maxIterations: {
                type: 'number',
                description: 'Max loop iterations (only for type=loop, default 2)',
            },
        },
    },

    // ===== UI/UX 设计工具 =====
    uiux_search: {
        name: 'uiux_search',
        displayName: 'UI/UX Search',
        description: 'Search UI/UX design database for styles, colors, typography, icons, performance tips, and best practices.',
        detailedDescription: `Search the design knowledge base for:
- UI styles (glassmorphism, minimalism, etc.)
- Color palettes for different industries
- Typography and font pairings
- Chart recommendations
- Landing page patterns
- UX best practices
- Icon sets and recommendations
- React performance optimization
- UI reasoning and decision making
- Web interface components`,
        examples: [
            'uiux_search query="glassmorphism" domain="style"',
            'uiux_search query="saas dashboard" domain="color"',
            'uiux_search query="elegant font" domain="typography"',
            'uiux_search query="lucide heroicons" domain="icons"',
            'uiux_search query="memo optimization" domain="react-performance"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Search keywords', required: true },
            domain: {
                type: 'string',
                description: 'Search domain (auto-detected if not specified)',
                enum: ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt', 'icons', 'react-performance', 'ui-reasoning', 'web-interface'],
            },
            stack: {
                type: 'string',
                description: 'Tech stack for stack-specific guidelines',
                enum: ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter', 'jetpack-compose', 'nuxt-ui', 'nuxtjs', 'shadcn'],
            },
            max_results: { type: 'number', description: 'Maximum results (default: 3)', default: 3 },
        },
    },

    uiux_recommend: {
        name: 'uiux_recommend',
        displayName: 'UI/UX Recommend',
        description: 'Get a complete design system recommendation for a product type, including style, colors, typography, and landing page pattern.',
        detailedDescription: `TextField a product type and get a cohesive design recommendation:
- Recommended UI style with CSS/Tailwind keywords
- Color palette with hex values
- Typography pairing with Google Fonts
- Landing page pattern suggestion
- Key design considerations`,
        examples: [
            'uiux_recommend product_type="saas"',
            'uiux_recommend product_type="e-commerce luxury"',
            'uiux_recommend product_type="healthcare app"',
        ],
        category: 'search',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            product_type: { type: 'string', description: 'Product type (e.g., saas, e-commerce, fintech, healthcare)', required: true },
        },
    },

    remember: {
        name: 'remember',
        displayName: 'Remember',
        description: 'Save a project-level fact or preference so it persists across all future conversations. Use proactively when you discover something important that should not be re-discovered every session.',
        detailedDescription: `Persist important project knowledge across conversations.

PROACTIVELY use remember when you discover:
- Architectural decisions ("Uses Zustand for global state, not Redux")
- Tech stack specifics ("Node version pinned to 18.x in .nvmrc")
- Recurring bugs and their root causes ("navigator.userAgent instead of process.platform in renderer")
- User code style preferences ("Prefer functional components, no class components")
- Project conventions ("All API calls go through src/runtime/, never directly in components")
- Environment quirks ("Windows PowerShell is default shell, use ; not &&")

Don't wait for the user to ask — if you learn something that would save time in future sessions, remember it.`,
        examples: [
            'remember content="Uses pnpm workspaces. Always run install from root, not individual packages."',
            'remember content="User prefers snake_case for all tool/API parameter names."',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            content: { type: 'string', description: 'The fact, preference, or convention to remember. Write as a clear, standalone statement that will make sense without conversation context.', required: true },
        },
    },

    companion_control: {
        name: 'companion_control',
        displayName: 'Companion Control',
        description: 'Control the VRM desktop companion (3D desktop pet on screen): make it play an animation (wave/think/stretch/...), change facial expression, speak a line, look at the camera, or reset its pose. Only takes effect while the desktop companion window is open — the result tells you whether the command was delivered.',
        detailedDescription: `Control the user's VRM desktop companion (桌面伴侣 / desktop pet).

Actions:
- play_action : play a one-shot animation. Pass \`name\` from the available action list
                (e.g. greeting, peace_sign, scratch_head, stretch, akimbo, model_pose, spin, squat).
                Semantic aliases are accepted too ("wave", "挥手", "think", "思考", "比耶").
                Omit \`name\` to play a random animation.
- expression  : set a facial expression. \`name\` ∈ happy / angry / sad / relaxed / surprised / neutral.
                \`weight\` is 0~1 (default 1); the expression auto-fades after ~2.6s unless
                \`duration_ms\` is given.
- speak       : make the companion talk (drives lip sync + on-screen subtitle). Pass \`text\`.
- stop_speak  : stop talking immediately.
- look_at     : change gaze. \`target\` ∈ cursor (follow the mouse) / camera (look at the user) /
                center (stare straight ahead).
- reset       : stop the current animation, clear the expression, and return to a natural idle stance.
- list_actions: list the animations currently installed (use when unsure about valid names).

Notes:
- Every call returns the current available action list, so you can learn valid names from any result.
- Pair \`speak\` with a gesture/expression for a livelier reaction (e.g. greeting + happy).
- Do NOT call this when the user is talking about a desktop companion that is not open: the result
  will report delivered=false, which means no companion window is showing.
- Keep it tasteful: one or two commands per user turn is enough; do not spam animations.`,
        examples: [
            'companion_control action="play_action" name="greeting"',
            'companion_control action="speak" text="收到，我这就去看看！"',
            'companion_control action="expression" name="happy" weight=1',
            'companion_control action="look_at" target="camera"',
            'companion_control action="reset"',
        ],
        criticalRules: [
            'Only meaningful while the desktop companion window is open; check the delivered flag in the result',
            'Prefer action names from the returned available-action list over guessing',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            action: {
                type: 'string',
                description: 'What to do with the companion.',
                required: true,
                enum: ['play_action', 'expression', 'speak', 'stop_speak', 'look_at', 'reset', 'list_actions'],
            },
            name: {
                type: 'string',
                description: 'Animation name (play_action) or expression name (expression). Optional for play_action (random when omitted).',
            },
            text: {
                type: 'string',
                description: 'Line for the companion to speak (action="speak").',
            },
            weight: {
                type: 'number',
                description: 'Expression intensity 0~1 (action="expression", default 1).',
            },
            target: {
                type: 'string',
                description: 'Gaze target (action="look_at").',
                enum: ['cursor', 'camera', 'center'],
            },
            duration_ms: {
                type: 'number',
                description: 'How long the expression stays before auto-fading (ms). Default ~2600.',
            },
        },
    },

    knowledge_search: {
        name: 'knowledge_search',
        displayName: 'Knowledge Search',
        description: 'Search the project knowledge base for relevant information using hybrid keyword + semantic search. Supports multi-step retrieval: start with a broad query, then refine with follow-up queries based on initial results.',
        detailedDescription: `Search the project knowledge base for context-relevant information using hybrid search.

Use knowledge_search when you need:
- Project-specific conventions or decisions
- Known error solutions that might apply
- User preferences and coding style
- Architecture patterns used in the project
- API documentation or reference material stored in the knowledge base
- Imported document content (PDF, Word, Excel, etc.)

Multi-step retrieval strategy (Agentic RAG):
1. Start with a broad query to find relevant knowledge areas
2. If results are partially relevant, refine with more specific queries
3. Use category filter to narrow down to specific knowledge types
4. Use deep_search=true for complex questions requiring thorough analysis

The search combines keyword matching (40%) and semantic vector similarity (60%) for best results.`,
        examples: [
            'knowledge_search query="authentication approach"',
            'knowledge_search query="error handling pattern" category="error-solution"',
            'knowledge_search query="database schema" deep_search=true',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'Search query to find relevant knowledge entries', required: true },
            category: { type: 'string', description: 'Filter by category: concept, decision, faq, reference, glossary, best-practice, error-solution, api, pattern, document', required: false },
            deep_search: { type: 'boolean', description: 'Enable deep search mode: searches with multiple query reformulations and returns more comprehensive results', required: false },
        },
    },

    // ===== Skill 工具 =====
    apply_skill: {
        name: 'apply_skill',
        displayName: 'Apply Skill',
        description: 'Load a project skill by name to apply its domain-specific instructions, guidelines, and templates to the current task.',
        detailedDescription: `Load a project-specific skill's full content (instructions, guidelines, templates) by name.

Available skills are listed in the system prompt under "Available Skills". Each skill has a name and description.

## When to use
You SHOULD proactively call \`apply_skill\` when:
- The user's task falls within a skill's described domain (e.g. building a website, designing UI, writing tests, reviewing code)
- A skill's description suggests it provides instructions, conventions, or templates relevant to the task
- You are starting a non-trivial task and a listed skill plausibly covers its domain

## When NOT to use
- Pure Q&A / explanations that don't produce code or files
- Tasks clearly outside every listed skill's domain

The tool returns the full skill content which you MUST follow as project-specific instructions for the duration of the task.`,
        category: 'interaction',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            skill_name: { type: 'string', description: 'The name of the skill to load (as shown in Available Skills list)', required: true },
        },
    },

    schedule: {
        name: 'schedule',
        displayName: 'Schedule Task',
        description: 'Create, update, delete, or list scheduled tasks (定时任务) that run automatically at specified times. MUST use this tool when the user mentions scheduled tasks, timers, reminders, or time-based automation — including one-shot tasks like "今天下午3点帮我做X" or recurring tasks like "每天早上9点发报告".',
        detailedDescription: `Manage scheduled tasks (定时任务 / cron jobs) that execute automatically at specified times.

## ⚠️ MUST USE THIS TOOL when user mentions:
- **定时任务 / 计划任务 / 定时 / 闹钟 / 提醒 / 自动执行 / 自动化任务** (Chinese)
- **scheduled task / schedule / timer / reminder / automate / cron job / run at / run every** (English)
- **Specific time execution**: "今天下午3点帮我做X", "明天上午9点提醒我", "下午帮我做什么", "每天早上发报告", "每周一汇总"
- **Recurring automation**: "每天/每周/每月/定期 执行X", "every day/week/month run X"

## When to use:
- **One-shot tasks** (执行一次): "今天下午帮我做X", "明天9点提醒我开会" → set \`max_calls=1\`
- **Recurring tasks** (重复执行): "每天9点发日报", "每周一汇总代码" → set \`max_calls=0\` (unlimited)
- **Time-based reminders**: "下午3点提醒我开会" → command 描述提醒内容
- **Periodic automation**: "每天凌晨清理临时文件", "每小时检查一次状态"
- **List/modify/delete**: 查看、修改、删除现有定时任务

## Actions:
- **create**: Create a new scheduled task with a name, cron pattern, and command
- **list**: List all scheduled tasks
- **update**: Update an existing task's name, pattern, command, or enabled status
- **delete**: Delete a scheduled task
- **toggle**: Enable or disable a task

## Cron Pattern Format (5 fields):
\`\`\`
┌ minute (0-59)
│ ┌ hour (0-23)
│ │ ┌ day of month (1-31)
│ │ │ ┌ month (1-12)
│ │ │ │ ┌ day of week (0-6, 0=Sunday)
* * * * *
\`\`\`

## Natural Language → Cron Conversion Guide:
| User says | Cron pattern | max_calls |
|-----------|--------------|-----------|
| "今天下午3点" (3pm today) | \`0 15 * * *\` | 1 (one-shot) |
| "明天上午9点" (9am tomorrow) | \`0 9 * * *\` | 1 (one-shot) |
| "下午5点半" (5:30pm) | \`30 17 * * *\` | 1 (one-shot) |
| "每天早上9点" (daily 9am) | \`0 9 * * *\` | 0 (recurring) |
| "每周一上午9点" (Mon 9am) | \`0 9 * * 1\` | 0 (recurring) |
| "每月1号0点" (1st of month) | \`0 0 1 * *\` | 0 (recurring) |
| "每小时整点" (every hour) | \`0 * * * *\` | 0 (recurring) |
| "每30分钟" (every 30 min) | \`*/30 * * * *\` | 0 (recurring) |
| "工作日9点" (weekdays 9am) | \`0 9 * * 1-5\` | 0 (recurring) |

**关键规则:**
- 一次性任务（"今天X点"、"明天X点"、"X点提醒我"）→ MUST set \`max_calls=1\`, otherwise it will repeat every day
- 重复任务（"每天X点"、"每周X"、"每月X"）→ set \`max_calls=0\` (unlimited)
- "今天下午3点" → cron pattern 用 \`0 15 * * *\` (今天匹配即触发，max_calls=1 确保只执行一次)

## Examples:
- \`0 9 * * *\` — Every day at 9:00
- \`*/30 * * * *\` — Every 30 minutes
- \`0 0 * * 1\` — Every Monday at midnight
- \`0 8,20 * * *\` — Every day at 8:00 and 20:00
- \`0 0 1 * *\` — First day of every month

## Important:
- The \`command\` is a natural language instruction that will be sent to the AI agent when the schedule triggers
- The agent will execute the command using its available tools
- Set \`max_calls\` to limit total executions (0 = unlimited)
- Tasks persist across app restarts
- 用户菜单「定时任务」入口对应的就是此工具创建的任务`,
        criticalRules: [
            '当用户提到"定时任务"、"计划任务"、"定时"、"提醒"、"闹钟"、"schedule"、"cron"、"automate"、"每天X点"、"每周X"、"X点帮我做Y" 时，MUST 调用此工具，不要用 todo_write 或 create_task_plan 替代',
            '一次性任务（"今天X点"、"明天X点"、"X点提醒我"）必须设置 max_calls=1，否则任务会每天重复执行',
            '重复任务（"每天X点"、"每周X"、"每月X"）设置 max_calls=0 (unlimited)',
            '将自然语言时间转换为 cron 表达式：今天下午3点 → "0 15 * * *" + max_calls=1；每天9点 → "0 9 * * *" + max_calls=0',
            'todo_write 是用于跟踪当前任务进度的清单，不是定时执行；create_task_plan 是用于多步骤任务拆分执行，不是定时触发。两者都不能替代定时任务功能',
        ],
        examples: [
            'schedule action="create" name="下午3点提醒" pattern="0 15 * * *" command="提醒用户：下午3点有一个重要会议" max_calls=1',
            'schedule action="create" name="每天日报" pattern="0 9 * * *" command="生成今天的日报并发送" max_calls=0',
            'schedule action="create" name="Daily Summary" pattern="0 9 * * *" command="Summarize today\'s git commits and create a brief report"',
            'schedule action="list"',
            'schedule action="delete" task_id="cron-xxx"',
            'schedule action="toggle" task_id="cron-xxx" enabled=false',
        ],
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            action: {
                type: 'string',
                description: 'Action to perform: create, list, update, delete, toggle',
                required: true,
                enum: ['create', 'list', 'update', 'delete', 'toggle'],
            },
            name: {
                type: 'string',
                description: 'Task name (for create/update). A short display name like "Daily Summary", "下午3点提醒", "每天日报"',
                required: false,
            },
            description: {
                type: 'string',
                description: 'Task description (for create/update)',
                required: false,
            },
            pattern: {
                type: 'string',
                description: 'Cron expression with 5 fields: minute hour day month weekday (for create/update). Convert natural language time to cron: "今天下午3点"→"0 15 * * *", "每天9点"→"0 9 * * *", "每周一9点"→"0 9 * * 1", "每30分钟"→"*/30 * * * *", "工作日9点"→"0 9 * * 1-5"',
                required: false,
            },
            command: {
                type: 'string',
                description: 'Natural language instruction to execute when the schedule triggers (for create/update). This will be sent to the AI agent. Example: "提醒用户：下午3点有会议", "生成今天的日报并发送", "Summarize today\'s news"',
                required: false,
            },
            task_id: {
                type: 'string',
                description: 'Task ID (for update/delete/toggle)',
                required: false,
            },
            enabled: {
                type: 'boolean',
                description: 'Enable or disable the task (for toggle action)',
                required: false,
            },
            max_calls: {
                type: 'number',
                description: 'Maximum number of executions. CRITICAL: 一次性任务（"今天X点"、"明天X点"、"X点提醒我"）必须设为 1；重复任务（"每天X点"、"每周X"）设为 0 (unlimited)',
                required: false,
            },
        },
    },

    todo_write: {
        name: 'todo_write',
        displayName: 'Task List',
        description: 'Create and manage a structured task list for tracking progress on complex tasks.',
        detailedDescription: `Track progress on multi-step tasks. Provides a visible task list in the UI so the user can see what's done, what's in progress, and what's next.

## MUST use when:
- Task touches 3+ files or requires 3+ distinct steps
- User gives multiple requirements in one message
- User explicitly asks to track progress or create a task list
- Multi-phase workflow (implement → test → fix → verify)

## Do NOT use when:
- Single-file fix, one-line change, typo correction
- Pure Q&A, explanation, or code review
- Task completable in 1-2 trivial steps

## Timing:
- Call BEFORE you start coding, not halfway through
- MANDATORY: Call \`todo_write\` the INSTANT you finish a task, BEFORE starting the next one. Never let the list go stale — if task #2 is done and you are about to start task #3, the call marking #2 \`completed\` and #3 \`in_progress\` MUST already have happened. Updating the list only after finishing 2-3 tasks is FORBIDDEN.
- Call with \`[]\` to clear after all tasks are done

## Verification Gate (Loop Engineering):
- BEFORE marking a task \`completed\`, you MUST first mark it \`verifying\` and run an objective verification step (lint / typecheck / build / test / dry-run — whatever validates the work).
- Transition flow: \`in_progress\` → \`verifying\` (run verification) → \`completed\` (passed). If verification fails, fix and re-verify.
- NEVER skip straight to \`completed\` based on self-assessment. The gate requires an objective signal.
- **Choose the cheapest signal that still proves the change.** The gate needs an objective signal, not an expensive one — a full-workspace \`tsc --noEmit\` costs 20-30s and saturates 2-3 cores, and repeating it after every small edit is by far the largest CPU consumer in a session:
  - First choice: the built-in \`get_lint_errors\` tool — language-server diagnostics, milliseconds, no subprocess.
  - Second: the output of a dev server / watch task that is already running.
  - Only when neither can answer the question, run a CLI check — and scope it: the touched package, or \`--incremental\` reusing the existing tsbuildinfo, never the whole monorepo by default.
  - Never re-run the same full check twice in a row without an intervening edit.

## Format:
- Each call replaces the ENTIRE list
- Exactly ONE task \`in_progress\` (or \`verifying\`) at a time
- Mark \`completed\` IMMEDIATELY after verification passes — never batch
- \`content\`: imperative ("Fix the bug"), \`activeForm\`: continuous ("Fixing the bug")
- ONLY mark completed when FULLY done AND verified — not when partial or blocked`,
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            todos: {
                type: 'array',
                description: 'The complete updated todo list.',
                required: true,
                items: {
                    type: 'object',
                    description: 'A single todo item',
                    properties: {
                        content: { type: 'string', description: 'Imperative form of the task (e.g., "Fix the bug")', required: true },
                        status: { type: 'string', description: 'Task status: "pending", "in_progress", "verifying", or "completed". Use "verifying" as the verification gate BEFORE marking "completed" — run lint/test/dry-run first, then transition to "completed" only after verification passes.', required: true, enum: ['pending', 'in_progress', 'verifying', 'completed'] },
                        activeForm: { type: 'string', description: 'Present continuous form (e.g., "Fixing the bug")', required: true },
                    },
                },
            },
        },
    },

    // ===== 数据类工具 =====
    sql_query: {
        name: 'sql_query',
        displayName: 'SQL Query',
        description: 'Execute SQL queries against connected databases. Supports SELECT, INSERT, UPDATE, DELETE with parameterized queries.',
        category: 'data',
        approvalType: 'interaction',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            query: { type: 'string', description: 'SQL query to execute', required: true },
            connection_id: { type: 'string', description: 'Database connection identifier' },
            params: { type: 'array', description: 'Query parameters for parameterized queries', items: { type: 'object', description: 'Query parameter object' } },
            limit: { type: 'number', description: 'Maximum rows to return (default: 100)', default: 100 },
        },
    },

    data_transform: {
        name: 'data_transform',
        displayName: 'Data Transform',
        description: 'Transform and reshape data: filter, sort, aggregate, pivot, merge datasets.',
        category: 'data',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            operation: { type: 'string', description: 'Transform operation: filter, sort, aggregate, pivot, merge, reshape', required: true, enum: ['filter', 'sort', 'aggregate', 'pivot', 'merge', 'reshape'] },
            source: { type: 'string', description: 'Source data reference (file path or dataset ID)', required: true },
            config: { type: 'object', description: 'Operation-specific configuration', required: true },
            output: { type: 'string', description: 'Output file path or dataset ID' },
        },
    },

    csv_analyze: {
        name: 'csv_analyze',
        displayName: 'CSV Analyze',
        description: 'Analyze CSV/Excel files: schema detection, statistics, data quality report, and preview.',
        category: 'data',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'CSV/Excel file path', required: true },
            analysis_type: { type: 'string', description: 'Type of analysis: schema, stats, quality, preview, sample', required: true, enum: ['schema', 'stats', 'quality', 'preview', 'sample'] },
            sample_size: { type: 'number', description: 'Number of rows for preview/sample (default: 20)', default: 20 },
        },
    },

    chart_generate: {
        name: 'chart_generate',
        displayName: 'Chart Generate',
        description: 'Generate charts and visualizations from data: bar, line, pie, scatter, heatmap, etc.',
        category: 'data',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            chart_type: { type: 'string', description: 'Chart type: bar, line, pie, scatter, heatmap, histogram, box, area, radar', required: true, enum: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'histogram', 'box', 'area', 'radar'] },
            data: { type: 'object', description: 'Chart data or data source reference', required: true },
            title: { type: 'string', description: 'Chart title' },
            x_label: { type: 'string', description: 'X-axis label' },
            y_label: { type: 'string', description: 'Y-axis label' },
            output_path: { type: 'string', description: 'Output file path for the chart image' },
            format: { type: 'string', description: 'Output format: png, svg, html', default: 'html', enum: ['png', 'svg', 'html'] },
        },
    },

    statistical_test: {
        name: 'statistical_test',
        displayName: 'Statistical Test',
        description: 'Perform statistical tests: t-test, chi-square, ANOVA, correlation, regression, etc.',
        category: 'data',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            test_type: { type: 'string', description: 'Statistical test: t_test, chi_square, anova, correlation, regression, mann_whitney, wilcoxon, kruskal_wallis', required: true, enum: ['t_test', 'chi_square', 'anova', 'correlation', 'regression', 'mann_whitney', 'wilcoxon', 'kruskal_wallis'] },
            data: { type: 'object', description: 'Test data or data source reference', required: true },
            alpha: { type: 'number', description: 'Significance level (default: 0.05)', default: 0.05 },
            hypothesis: { type: 'string', description: 'Null hypothesis description' },
        },
    },

    // ===== 媒体类工具 =====
    image_generate: {
        name: 'image_generate',
        displayName: 'Image Generate',
        description: 'Generate images from text descriptions using AI models.',
        category: 'media',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            prompt: { type: 'string', description: 'Image generation prompt', required: true },
            model: { type: 'string', description: 'Model to use: dall-e-3, stable-diffusion, flux', enum: ['dall-e-3', 'stable-diffusion', 'flux'] },
            size: { type: 'string', description: 'Image size: 256x256, 512x512, 1024x1024', default: '1024x1024' },
            style: { type: 'string', description: 'Style: natural, vivid, artistic', enum: ['natural', 'vivid', 'artistic'] },
            output_path: { type: 'string', description: 'Output file path' },
            n: { type: 'number', description: 'Number of images to generate (default: 1)', default: 1 },
        },
    },

    image_edit: {
        name: 'image_edit',
        displayName: 'Image Edit',
        description: 'Edit existing images: resize, crop, filter, overlay text, adjust colors.',
        category: 'media',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'TextField image file path', required: true },
            operation: { type: 'string', description: 'Edit operation: resize, crop, filter, text, adjust', required: true, enum: ['resize', 'crop', 'filter', 'text', 'adjust'] },
            config: { type: 'object', description: 'Operation-specific configuration', required: true },
            output_path: { type: 'string', description: 'Output file path' },
        },
    },

    audio_transcribe: {
        name: 'audio_transcribe',
        displayName: 'Audio Transcribe',
        description: 'Transcribe audio files to text using speech recognition.',
        category: 'media',
        approvalType: 'none',
        parallel: true,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Audio file path', required: true },
            language: { type: 'string', description: 'Language code (e.g., en, zh, ja)' },
            model: { type: 'string', description: 'Transcription model: whisper, deepspeech', enum: ['whisper', 'deepspeech'] },
            output_format: { type: 'string', description: 'Output format: text, srt, vtt', default: 'text', enum: ['text', 'srt', 'vtt'] },
        },
    },

    video_analyze: {
        name: 'video_analyze',
        displayName: 'Video Analyze',
        description: 'Analyze video content: extract frames, detect objects, summarize scenes.',
        category: 'media',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: true,
        enabled: true,
        parameters: {
            path: { type: 'string', description: 'Video file path', required: true },
            operation: { type: 'string', description: 'Analysis operation: frames, objects, scenes, transcript', required: true, enum: ['frames', 'objects', 'scenes', 'transcript'] },
            interval: { type: 'number', description: 'Frame extraction interval in seconds (default: 1)', default: 1 },
            output_path: { type: 'string', description: 'Output directory for extracted data' },
        },
    },

    // ===== 办公类工具 =====
    doc_write: {
        name: 'doc_write',
        displayName: 'Document Write',
        description: 'Create and format documents: reports, letters, memos in DOCX, PDF, or HTML format.',
        category: 'office',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            title: { type: 'string', description: 'Document title', required: true },
            content: { type: 'string', description: 'Document content in markdown format', required: true },
            format: { type: 'string', description: 'Output format: docx, pdf, html, md', default: 'docx', enum: ['docx', 'pdf', 'html', 'md'] },
            template: { type: 'string', description: 'Document template: report, letter, memo, resume', enum: ['report', 'letter', 'memo', 'resume'] },
            output_path: { type: 'string', description: 'Output file path' },
        },
    },

    spreadsheet: {
        name: 'spreadsheet',
        displayName: 'Spreadsheet',
        description: 'Create and manipulate spreadsheets: formulas, charts, data tables in XLSX format.',
        category: 'office',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            operation: { type: 'string', description: 'Operation: create, read, update, formula', required: true, enum: ['create', 'read', 'update', 'formula'] },
            path: { type: 'string', description: 'Spreadsheet file path' },
            data: { type: 'object', description: 'Spreadsheet data or update configuration' },
            sheet: { type: 'string', description: 'Sheet name (default: Sheet1)' },
            output_path: { type: 'string', description: 'Output file path' },
        },
    },

    presentation: {
        name: 'presentation',
        displayName: 'Presentation',
        description: 'Create slide presentations with text, images, and layouts in PPTX format.',
        category: 'office',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            title: { type: 'string', description: 'Presentation title', required: true },
            slides: { type: 'array', description: 'Slide definitions', required: true, items: { type: 'object', description: 'Slide definition', properties: { title: { type: 'string', description: 'Slide title' }, content: { type: 'string', description: 'Slide content in markdown' }, layout: { type: 'string', description: 'Slide layout', enum: ['title', 'content', 'image', 'blank'] } } } },
            template: { type: 'string', description: 'Design template', enum: ['minimal', 'corporate', 'creative', 'academic'] },
            output_path: { type: 'string', description: 'Output file path' },
        },
    },

    email_send: {
        name: 'email_send',
        displayName: 'Email Send',
        description: 'Compose and send emails with optional attachments.',
        category: 'office',
        approvalType: 'interaction',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            to: { type: 'string', description: 'Recipient email address(es)', required: true },
            subject: { type: 'string', description: 'Email subject', required: true },
            body: { type: 'string', description: 'Email body (supports markdown)', required: true },
            cc: { type: 'string', description: 'CC recipients' },
            attachments: { type: 'array', description: 'File paths to attach', items: { type: 'string', description: 'File path' } },
        },
    },

    send_file_to_channel: {
        name: 'send_file_to_channel',
        displayName: 'Send File to Channel',
        description: 'Send a file to the current conversation on the messaging channel (Feishu/Lark, WeChat, etc.). Use this when the user asks you to send a file, document, or image through the messaging platform.',
        detailedDescription: `Send a file to the current conversation on the messaging channel.
- Supports sending files (PDF, doc, xls, ppt, etc.), images, audio, and video
- The file must exist at the specified local path
- For Feishu/Lark: file size must not exceed 30MB; images must not exceed 10MB
- The file will be sent to the same conversation where the user sent the message`,
        category: 'interaction',
        approvalType: 'none',
        parallel: false,
        requiresWorkspace: false,
        enabled: true,
        parameters: {
            file_path: { type: 'string', description: 'Absolute path to the local file to send', required: true },
            file_name: { type: 'string', description: 'Display name for the file (defaults to the filename from path)' },
            media_type: { type: 'string', description: 'Type of media to send', enum: ['file', 'image', 'audio', 'video'] },
        },
    },
}



// ============================================
// 工具选择决策指南
// ============================================

/**
 * 文件编辑工具选择决策树
 * 根据场景选择最合适的工具
 */
export const FILE_EDIT_DECISION_GUIDE = `
## File Editing Decision Guide

**1. Pick the tool (MANDATORY)**
- Creating a NEW file: use \`write_file\`.
- Editing an EXISTING file: you MUST use \`edit_file\` — first read the file with \`read_file\` to get the current content, then apply changes with \`edit_file\` (string/line/batch mode).
- \`write_file\` on an existing file is ONLY allowed for intentional full-file replacement (the whole file is regenerated on purpose).
- **NEVER** use \`write_file\` to partially modify an existing file. For ANY targeted change on an existing file, always use \`edit_file\`.

**2. Pick exactly one edit_file mode**
- String mode: \`old_string\` + \`new_string\`.
- Line mode: \`start_line\` + \`end_line\` + \`content\`.
- Batch mode: \`edits\` array only.

**3. Avoid invalid payloads**
- Never mix string, line, and batch fields in one call.
- Never send empty placeholder edits.
- Prefer line or batch mode for large files.

**4. If you used \`write_file\` on an existing file and the response asks you to switch to \`edit_file\`:**
- STOP using write_file for this file.
- Read the current file content with \`read_file\`.
- Use \`edit_file\` with the appropriate mode (string/line/batch) to make the change.
- After a failed edit, read the file again before retrying — the file may have changed.
`

/**
 * 搜索工具选择决策指南
 */
export const SEARCH_DECISION_GUIDE = `
## Search Tool Selection

**Decision Tree:**
1. Looking for a CONCEPT or MEANING (e.g., "authentication logic")?
   → Use \`codebase_search\` (semantic/AI search)

2. Looking for EXACT TEXT or PATTERN?
   → Use \`search_files\` (text/regex search)
   → For multiple patterns, combine with | (e.g., "pattern1|pattern2|pattern3")

3. Searching within a SINGLE FILE?
   → Use \`search_files\` with file path as path parameter
   → Example: search_files path="src/styles.css" pattern="button|card"

4. Looking for FILES BY NAME/PATTERN?
   → Use \`list_directory\` with recursive=true

**NEVER use bash grep/find - use these tools instead.**

**ANTI-FRAGMENTATION:**
- Combine multiple patterns with | instead of making multiple calls
- Use read_file with a paths array instead of multiple read_file calls
`

export const NETWORK_SEARCH_DECISION_GUIDE = `
## Web Search Tool Selection

**Choose the right search tool:**

1. General web search (use \`web_search\`) — for ALL web information queries:
   - Facts, news, products, food, restaurants, travel, reviews, recommendations
   - Encyclopedia questions ("什么是X", "X简介", "X定义")
   - Automobile / real estate / technology / news queries ("汽车", "销量", "房价", "手机", "AI", "最新")
   - Any question needing up-to-date information from the web

2. Specific media search:
   - Images only: use \`image_search\`
   - Videos only: use \`video_search\`

**RULE: For all web information queries, use \`web_search\`. Only use \`image_search\` / \`video_search\` when you specifically need images or videos.**
`

// ============================================
// 生成器函数
// ============================================

import type { ToolDefinition, ToolPropertySchema } from '@shared/protocols/modelGateway'

/** 将 ToolPropertyDef 转换为 ToolPropertySchema */
function convertToPropertySchema(prop: ToolPropertyDef): ToolPropertySchema {
    const schema: ToolPropertySchema = {
        type: prop.type,
        description: prop.description,
    }
    if (prop.enum) schema.enum = prop.enum
    if (prop.items) schema.items = convertToPropertySchema(prop.items)
    if (prop.properties) {
        schema.properties = Object.fromEntries(
            Object.entries(prop.properties).map(([k, v]) => [k, convertToPropertySchema(v)])
        )
    }
    return schema
}

/** 生成 LLM 工具定义 */
export function generateToolDefinition(config: ToolConfig): ToolDefinition {
    const properties: Record<string, ToolPropertySchema> = {}
    const required: string[] = []

    for (const [key, prop] of Object.entries(config.parameters)) {
        properties[key] = convertToPropertySchema(prop)
        if (prop.required) {
            required.push(key)
        }
    }

    return {
        name: config.name,
        // function-calling 模式下模型主要看 description 字段，
        // 将 criticalRules 合并进来，保证"编辑已有文件必须用 edit_file"等硬规则对云端模型可见。
        description: config.criticalRules && config.criticalRules.length > 0
            ? `${config.description}\n\nRules:\n${config.criticalRules.map((r) => `- ${r}`).join('\n')}`
            : config.description,
        ...(config.approvalType !== 'none' && { approvalType: config.approvalType }),
        parameters: {
            type: 'object',
            properties,
            required,  // Anthropic 要求 required 必须是数组，即使为空
        },
    }
}

// ============================================
// Zod 预处理辅助函数 (增强容错性)
// ============================================

const preprocessNumber = (val: unknown) => {
    if (typeof val === 'string' && val.trim() !== '') {
        const parsed = Number(val)
        return isNaN(parsed) ? val : parsed
    }
    return val
}

const preprocessBoolean = (val: unknown) => {
    if (typeof val === 'string') {
        const lower = val.toLowerCase()
        if (lower === 'true') return true
        if (lower === 'false') return false
    }
    return val
}

const preprocessArray = (val: unknown) => {
    if (typeof val === 'string') {
        try {
            return JSON.parse(val)
        } catch {
            return val
        }
    }
    return val
}

/** 递归生成 Zod Schema (支持嵌套和自动类型转换) */
function createZodType(prop: ToolPropertyDef): z.ZodTypeAny {
    switch (prop.type) {
        case 'string':
            if (prop.enum) {
                return z.enum(prop.enum as [string, ...string[]])
            }
            return z.string()
        case 'number':
            return z.preprocess(preprocessNumber, z.number().int())
        case 'boolean':
            return z.preprocess(preprocessBoolean, z.boolean())
        case 'array':
            let itemSchema: z.ZodTypeAny = z.any()
            if (prop.items) {
                itemSchema = createZodType(prop.items)
            }
            return z.preprocess(preprocessArray, z.array(itemSchema))
        case 'object':
            if (prop.properties) {
                const shape: Record<string, z.ZodTypeAny> = {}
                for (const [k, v] of Object.entries(prop.properties)) {
                    let s = createZodType(v)
                    if (!v.required) s = s.optional()
                    shape[k] = s
                }
                return z.object(shape).passthrough()
            }
            return z.object({}).passthrough()
        default:
            return z.any()
    }
}

/** 生成 Zod Schema */
export function generateZodSchema(config: ToolConfig): z.ZodSchema {
    let objectSchema: z.ZodTypeAny

    if (config.customSchema) {
        objectSchema = config.customSchema
    } else {
        const shape: Record<string, z.ZodTypeAny> = {}

        for (const [key, prop] of Object.entries(config.parameters)) {
            let schema = createZodType(prop)

            // 重新应用顶层的 required 验证消息
            if (prop.type === 'string' && prop.required && !prop.enum) {
                schema = z.string().min(1, `${key} is required`)
            }

            if (!prop.required) {
                schema = schema.optional()
                if (prop.default !== undefined) {
                    schema = schema.default(prop.default)
                }
            }

            shape[key] = schema
        }

        // 使用 passthrough() 允许额外的字段（如 _meta）
        objectSchema = z.object(shape).passthrough()
    }

    // 添加自定义验证
    if (config.validate) {
        return objectSchema.refine(
            (data) => config.validate!(data as Record<string, unknown>).valid,
            (data) => ({ message: config.validate!(data as Record<string, unknown>).error || 'Validation failed' })
        )
    }

    return objectSchema
}

// ============================================
// 生成系统提示词中的工具描述
// ============================================

/**
 * 生成单个工具的详细提示词描述
 * 
 * 使用 description 作为主要描述（包含反碎片化规则）
 */
export function generateToolPromptDescription(config: ToolConfig): string {
    const lines: string[] = []

    // 工具名
    lines.push(`### ${config.displayName} (\`${config.name}\`)`)

    // 主描述（包含反碎片化规则）
    lines.push(config.description)
    lines.push('')

    // 详细描述（补充使用细节）
    if (config.detailedDescription) {
        lines.push(config.detailedDescription)
        lines.push('')
    }

    // 关键规则
    if (config.criticalRules && config.criticalRules.length > 0) {
        lines.push('**Rules:**')
        for (const rule of config.criticalRules) {
            lines.push(`- ${rule}`)
        }
        lines.push('')
    }

    // 参数
    const params = Object.entries(config.parameters)
    if (params.length > 0) {
        lines.push('**Parameters:**')
        for (const [key, prop] of params) {
            const required = prop.required ? '(required)' : '(optional)'
            const defaultVal = prop.default !== undefined ? ` [default: ${prop.default}]` : ''
            lines.push(`- \`${key}\` ${required}: ${prop.description}${defaultVal}`)
        }
        lines.push('')
    }

    // 常见错误
    if (config.commonErrors && config.commonErrors.length > 0) {
        lines.push('**Common Errors:**')
        for (const err of config.commonErrors) {
            lines.push(`- "${err.error}" → ${err.solution}`)
        }
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 生成工具提示词描述（可排除指定类别和指定工具）
 * 
 * @param excludeCategories 要排除的工具类别
 * @param allowedTools 允许的工具列表（如果提供，只包含这些工具）
 */
export function generateToolsPromptDescriptionFiltered(
    excludeCategories: ToolCategory[] = [],
    allowedTools?: string[]
): string {
    const categories: Record<ToolCategory, ToolConfig[]> = {
        read: [],
        search: [],
        write: [],
        terminal: [],
        lsp: [],
        network: [],
        interaction: [],
        plan: [],
        data: [],
        media: [],
        office: [],
    }

    // 按类别分组
    for (const config of Object.values(TOOL_CONFIGS)) {
        // 检查是否启用、类别是否被排除、是否在允许列表中
        const isEnabled = config.enabled
        const categoryAllowed = !excludeCategories.includes(config.category)
        const toolAllowed = !allowedTools || allowedTools.includes(config.name)

        if (isEnabled && categoryAllowed && toolAllowed) {
            categories[config.category].push(config)
        }
    }

    const sections: string[] = []

    if (categories.read.length > 0) {
        sections.push('## File Reading Tools')
        for (const config of categories.read) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.search.length > 0) {
        sections.push('## Search Tools')
        sections.push(SEARCH_DECISION_GUIDE)
        for (const config of categories.search) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.write.length > 0) {
        sections.push('## File Editing Tools')
        sections.push(FILE_EDIT_DECISION_GUIDE)
        for (const config of categories.write) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.terminal.length > 0) {
        sections.push('## Terminal Tools')
        for (const config of categories.terminal) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.lsp.length > 0) {
        sections.push('## Code Intelligence Tools')
        for (const config of categories.lsp) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.network.length > 0) {
        sections.push('## Network Tools')
        sections.push(NETWORK_SEARCH_DECISION_GUIDE)
        for (const config of categories.network) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.interaction.length > 0) {
        sections.push('## Interaction Tools')
        for (const config of categories.interaction) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.data.length > 0) {
        sections.push('## Data Tools')
        for (const config of categories.data) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.media.length > 0) {
        sections.push('## Media Tools')
        for (const config of categories.media) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    if (categories.office.length > 0) {
        sections.push('## Office Tools')
        for (const config of categories.office) {
            sections.push(generateToolPromptDescription(config))
        }
    }

    return sections.join('\n\n')
}

// ============================================
// 导出生成的数据
// ============================================

/** 所有工具定义（发送给 LLM） */
export const TOOL_DEFINITIONS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateToolDefinition(config)])
)

/** 所有 Zod Schemas */
export const TOOL_SCHEMAS = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, generateZodSchema(config)])
)

/** 工具显示名称映射 */
export const TOOL_DISPLAY_NAMES = Object.fromEntries(
    Object.entries(TOOL_CONFIGS).map(([name, config]) => [name, config.displayName])
)

// ============================================
// 辅助函数
// ============================================

/**
 * 场景工具审批类型注册表
 *
 * 场景工具不通过 TOOL_CONFIGS 注册，无法被 getToolApprovalType 识别。
 * 此映射表由 registerScenarioToolApprovalType 维护，
 * 供 getToolApprovalType / requiresApprovalGate 查询场景工具的审批类型。
 */
const scenarioToolApprovalMap = new Map<string, ToolApprovalType>()

/**
 * 注册场景工具的审批类型
 *
 * 由 ToolRegistry.registerScenarioTool 在注册场景工具时调用，
 * 确保引擎层（toolOrchestrator / AgentSubLoop）能通过 getToolApprovalType
 * 识别场景工具的审批类型，从而触发审批门禁。
 *
 * @param toolName 工具名
 * @param approvalType 审批类型
 */
export function registerScenarioToolApprovalType(toolName: string, approvalType: ToolApprovalType): void {
    scenarioToolApprovalMap.set(toolName, approvalType)
}

/**
 * 注销场景工具的审批类型
 *
 * 由 ToolRegistry.unregisterScenarioTool 在注销场景工具时调用，
 * 避免已卸载场景的工具仍被识别为需要审批。
 *
 * @param toolName 工具名
 */
export function unregisterScenarioToolApprovalType(toolName: string): void {
    scenarioToolApprovalMap.delete(toolName)
}

/** 获取工具审批类型 */
export function getToolApprovalType(toolName: string): ToolApprovalType {
    // 1. 优先从内置工具配置（TOOL_CONFIGS）读取
    const builtinConfig = TOOL_CONFIGS[toolName]
    if (builtinConfig?.approvalType) {
        return builtinConfig.approvalType
    }
    // 2. 回退到场景工具审批类型注册表
    const scenarioApprovalType = scenarioToolApprovalMap.get(toolName)
    if (scenarioApprovalType) {
        return scenarioApprovalType
    }
    // 3. 默认不审批
    return 'none'
}

/** 获取工具显示名称 */
export function getToolDisplayName(toolName: string): string {
    return TOOL_CONFIGS[toolName]?.displayName || toolName
}

/** 获取只读工具列表 */
export function getReadOnlyTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel && config.category !== 'write')
        .map(([name]) => name)
}

/** 获取写入工具列表 */
export function getWriteTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.category === 'write')
        .map(([name]) => name)
}

/** 获取需要审批的工具 */
export function getApprovalRequiredTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.approvalType !== 'none')
        .map(([name]) => name)
}

/** 检查工具是否可并行执行 */
export function isParallelTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.parallel ?? false
}

/** 获取可并行执行的工具列表 */
export function getParallelTools(): string[] {
    return Object.entries(TOOL_CONFIGS)
        .filter(([_, config]) => config.parallel)
        .map(([name]) => name)
}

/** 检查工具是否为写入类工具 */
export function isWriteTool(toolName: string): boolean {
    return TOOL_CONFIGS[toolName]?.category === 'write'
}

/** 检查工具是否为文件编辑工具（会产生文件内容变更，不包括删除） */
export function isFileEditTool(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder'].includes(toolName)
}

/** 检查工具是否需要保存文件快照（用于撤销功能） */
export function needsFileSnapshot(toolName: string): boolean {
    return ['edit_file', 'write_file', 'create_file_or_folder', 'delete_file_or_folder'].includes(toolName)
}

/** 检查工具是否需要 Diff 预览（使用 FileChangeCard） */
export function needsDiffPreview(toolName: string): boolean {
    // 内置文件编辑工具 + 场景开发助手的文件写入工具
    // 场景工具需走 FileChangeCard 才能渲染接受/拒绝按钮与 diff 预览
    return [
        'edit_file',
        'write_file',
        'write_scenario_file',
    ].includes(toolName)
}

/** 获取工具元数据 */
export function getToolMetadata(toolName: string): ToolConfig | undefined {
    return TOOL_CONFIGS[toolName]
}
