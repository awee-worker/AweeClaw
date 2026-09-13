# ONLYOFFICE Docs PoC —— 本地文件编辑回写验证

## 目标
验证路线 A 可行性：客户端打开**本地** .xlsx/.docx/.pptx → ONLYOFFICE Docs 9.4 编辑器
→ 保存后**回写原文件路径**。验证通过后再接入 aweeclaw-client 主进程。

## 架构
```
浏览器 / Electron BrowserWindow
   │  http://127.0.0.1:3001/demo.html
   ▼
本地网关 server.js (3001)          ONLYOFFICE Docs 容器 (8080)
  GET  /download  ──原文件字节─────────►  编辑器拉取
  POST /callback ◄────保存回调(url)────
   │      │  GET 保存文件url → 字节
   │      ▼
   └─ 写回本地原文件（临时文件 + 原子替换）
```

## 快速运行
```bash
./run.sh                                # 默认验证 sample.xlsx
POC_FILE=~/docs/real.xlsx ./run.sh      # 验证任意本地文件
```
然后浏览器打开 http://127.0.0.1:3001/demo.html

## 产物说明
| 文件 | 作用 |
|---|---|
| `server.js` | 零依赖 Node 网关：宿主页 + /download + /callback（保存回写） |
| `demo.html` | OnlyOffice 编辑器宿主页（模板占位符由 server.js 注入） |
| `make-sample.js` | 用 exceljs 生成带样式样例（列宽/合并/特殊符号） |
| `sample.xlsx` | 样例文件（验证渲染保真度：列宽错位/列表符等） |
| `run.sh` | 一键：容器 + 健康等待 + 网关 |
| `ds-data/` | Document Server 数据卷 |

## 关键环境变量
| 变量 | 说明 | 默认 |
|---|---|---|
| `POC_FILE` | 要编辑的本地文件绝对路径 | `./sample.xlsx` |
| `ONLYOFFICE_IMAGE` | 容器镜像 | 国内加速源 9.4.0.1 |
| `PORT_DS` | Document Server 映射端口 | 8080 |
| `GATEWAY_PORT` | 本地网关端口 | 3001 |

## 待办 / 已知限制（PoC 后产品化要点）
- [ ] 网关需支持任意文件路径访问控制（现仅服务单个 POC_FILE，防目录穿越）
- [ ] 容器默认关 JWT，产品化需开 JWT + 每次会话签名 config
- [ ] 多实例会话管理（key 与文件映射、防并发保存覆盖）
- [ ] Electron 侧集成方式选型：BrowserWindow iframe 内嵌 vs 独立窗口
- [ ] macOS 分发不含 Docker —— 需评估把容器打成轻量后台服务或文档服务独立部署
- [ ] 验证保存回写原子性、原文件备份策略（接入现有 filePermissionGuard 备份机制）
