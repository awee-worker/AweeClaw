import { McpToolProvider } from '@intelligence/toolkit/providers/ProtocolToolRegistry'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

const MCP_TOOL_PREFIX = 'mcp_'
const MCP_TOOL_SEPARATOR = '__'

interface FriendlyNameResult {
    label: string
    isMcp: boolean
    serverName?: string
    toolName?: string
}

const MCP_TOOL_ACTION_MAP_ZH: Record<string, string> = {
    navigate: '打开网页',
    click: '点击元素',
    type: '输入文本',
    fill: '填写表单',
    screenshot: '截取屏幕',
    scroll: '滚动页面',
    hover: '悬停元素',
    select: '选择选项',
    upload: '上传文件',
    download: '下载文件',
    evaluate: '执行脚本',
    execute: '执行操作',
    query: '查询数据',
    insert: '插入数据',
    update: '更新数据',
    delete: '删除数据',
    create: '创建资源',
    list: '列出资源',
    get: '获取信息',
    search: '搜索内容',
    read: '读取内容',
    write: '写入内容',
    send: '发送消息',
    receive: '接收消息',
    fetch: '获取数据',
    post: '提交数据',
    put: '更新数据',
    patch: '修补数据',
    remove: '移除资源',
    find: '查找资源',
    count: '统计数据',
    analyze: '分析数据',
    generate: '生成内容',
    convert: '转换格式',
    extract: '提取信息',
    parse: '解析内容',
    compile: '编译代码',
    build: '构建项目',
    deploy: '部署服务',
    test: '运行测试',
    run: '运行程序',
    start: '启动服务',
    stop: '停止服务',
    restart: '重启服务',
    login: '登录',
    logout: '登出',
    auth: '认证授权',
    upload_file: '上传文件',
    download_file: '下载文件',
    create_issue: '创建工单',
    add_comment: '添加评论',
    list_repos: '列出仓库',
    get_repo: '获取仓库',
    list_files: '列出文件',
    read_file: '读取文件',
    write_file: '写入文件',
    web_search: '搜索网页',
    open_url: '打开链接',
    browse: '浏览网页',
    scrape: '抓取内容',
    crawl: '爬取数据',
    send_email: '发送邮件',
    send_message: '发送消息',
    create_calendar: '创建日程',
    list_calendar: '列出日程',
    create_task: '创建任务',
    list_tasks: '列出任务',
    create_document: '创建文档',
    edit_document: '编辑文档',
    sql_query: '执行查询',
    execute_sql: '执行SQL',
    run_sql: '运行SQL',
}

const MCP_TOOL_ACTION_MAP_EN: Record<string, string> = {
    navigate: 'Opening page',
    click: 'Clicking element',
    type: 'Typing text',
    fill: 'Filling form',
    screenshot: 'Taking screenshot',
    scroll: 'Scrolling page',
    hover: 'Hovering element',
    select: 'Selecting option',
    upload: 'Uploading file',
    download: 'Downloading file',
    evaluate: 'Running script',
    execute: 'Executing action',
    query: 'Querying data',
    insert: 'Inserting data',
    update: 'Updating data',
    delete: 'Deleting data',
    create: 'Creating resource',
    list: 'Listing resources',
    get: 'Getting info',
    search: 'Searching',
    read: 'Reading',
    write: 'Writing',
    send: 'Sending message',
    fetch: 'Fetching data',
    post: 'Submitting data',
    run: 'Running',
    start: 'Starting service',
    stop: 'Stopping service',
    browse: 'Browsing page',
    scrape: 'Scraping content',
    sql_query: 'Running query',
    execute_sql: 'Executing SQL',
}

function guessMcpToolAction(toolName: string, language: Language): string | null {
    const actionMap = language === 'zh' ? MCP_TOOL_ACTION_MAP_ZH : MCP_TOOL_ACTION_MAP_EN
    const lowerName = toolName.toLowerCase()

    if (actionMap[lowerName]) {
        return actionMap[lowerName]
    }

    for (const [key, value] of Object.entries(actionMap)) {
        if (lowerName.startsWith(key + '_') || lowerName.includes('_' + key + '_') || lowerName.endsWith('_' + key)) {
            return value
        }
    }

    const parts = lowerName.split(/[_\-.]/)
    for (const part of parts) {
        if (actionMap[part]) {
            return actionMap[part]
        }
    }

    return null
}

function formatToolNameHuman(toolName: string): string {
    return toolName
        .split(/[_\-.]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

export function parseMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
    if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null

    const parsed = McpToolProvider.parseToolName(fullName)
    if (parsed) return parsed

    const withoutPrefix = fullName.slice(MCP_TOOL_PREFIX.length)
    const sepIndex = withoutPrefix.indexOf(MCP_TOOL_SEPARATOR)
    if (sepIndex === -1) return null

    return {
        serverId: withoutPrefix.slice(0, sepIndex),
        toolName: withoutPrefix.slice(sepIndex + MCP_TOOL_SEPARATOR.length),
    }
}

export function isMcpToolName(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX)
}

export function getFriendlyToolName(
    effectiveName: string,
    language: Language,
): FriendlyNameResult {
    if (isMcpToolName(effectiveName)) {
        const parsed = parseMcpToolName(effectiveName)
        if (parsed) {
            const servers = useStore.getState().mcpServers
            const server = servers.find(s => s.id === parsed.serverId)
            const serverDisplayName = server?.config?.name || parsed.serverId

            const action = guessMcpToolAction(parsed.toolName, language)
            const toolDisplay = action || formatToolNameHuman(parsed.toolName)

            return {
                label: toolDisplay,
                isMcp: true,
                serverName: serverDisplayName,
                toolName: parsed.toolName,
            }
        }

        return {
            label: formatToolNameHuman(effectiveName),
            isMcp: true,
        }
    }

    if (effectiveName === 'apply_skill') {
        return {
            label: t('ai.loadingskill', language as Language),
            isMcp: false,
        }
    }

    return {
        label: formatToolNameHuman(effectiveName),
        isMcp: false,
    }
}

export function getMcpToolStatusText(
    effectiveName: string,
    status: string,
    isStreaming: boolean,
    language: Language,
): string | null {
    if (!isMcpToolName(effectiveName)) return null

    const parsed = parseMcpToolName(effectiveName)
    if (!parsed) return null

    const action = guessMcpToolAction(parsed.toolName, language)
    const isRunning = status === 'running' || status === 'pending' || isStreaming
    const isSuccess = status === 'success'
    const isError = status === 'error'

    if (language === 'zh') {
        if (action) {
            if (isRunning) return `正在${action}...`
            if (isSuccess) return `已${action}`
            if (isError) return `${action}失败`
            return `${action}`
        }
        if (isRunning) return `处理中...`
        if (isSuccess) return `已完成`
        if (isError) return `执行失败`
        return `${formatToolNameHuman(parsed.toolName)}`
    }

    if (action) {
        if (isRunning) return `${action}...`
        if (isSuccess) return `Done`
        if (isError) return `Failed`
        return `${action}`
    }
    if (isRunning) return `Processing...`
    if (isSuccess) return `Done`
    if (isError) return `Failed`
    return `${formatToolNameHuman(parsed.toolName)}`
}
