# ONLYOFFICE Docs 服务器部署（含桥接网关）

把本目录（`onlyoffice-server-deploy/`）上传到你的 Linux 服务器后执行。
部署内容：**ONLYOFFICE Docs 9.x**（文档服务器）+ **桥接网关**（文件上传 / 下载 / 保存回写，随 compose 运行，零外部依赖）。

```
浏览器 ──编辑页面(demo.html)──┐
   ▲                          │ 加载 api.js
   │                          ▼
 编辑内容              ONLYOFFICE Docs :80 (:5732)
   │                          │ ① 拉取原文件 /oo-gw/files/x
   │  保存回调                │ ② 保存后回调 /oo-gw/callback
   ▼                          ▼
  桥接网关 node (:8090) ──保存结果──▶ 写回 /data/x（宿主机 volume）
```

## 一、服务器要求
| 项 | 要求 |
|---|---|
| 系统 | Linux（x86_64），Docker Engine + compose v2 |
| 内存 | ≥ 4GB（首次启动 + 编辑大型文件更稳） |
| 磁盘 | ≥ 20GB（社区版内置数据库/字体缓存写入 /var/lib/onlyoffice） |
| 网络 | 域名已解析到本机，443 反代可用（宝塔/Caddy/Nginx 均可） |

## 二、部署步骤
```bash
# 1. 上传本目录到服务器后
cd onlyoffice-server-deploy

# 2. 生成 .env 并填写
cp .env.example .env
vim .env
#    必填项：
#      JWT_SECRET     ← openssl rand -hex 32 生成后粘贴（与网关共用，勿外泄）
#      PUBLIC_DS_URL  ← 你的公网域名，如 https://onlyoffice.aweeclaw.com
#   可选项：国内拉不动镜像时 ONLYOFFICE_IMAGE 换成加速源

# 3. 部署（首次 5~15 分钟，含字体缓存生成；会同时启动 DS + 网关）
./deploy.sh

# 4. 本机验证（绕过外层反代，直连服务）
curl http://127.0.0.1:${DS_PORT:-8080}/healthcheck   # DS 返回 200
curl http://127.0.0.1:8090/health                    # 网关返回 ok
```

> ⚠️ 若之前已部署过旧版 DS（未含网关）：更新 `.env` 后执行 `./deploy.sh` 即可增量拉起网关；
> JWT_SECRET 变更会重启 DS，属于正常操作。

## 三、外层反代（宝塔 Nginx）——必配的网关转发

DS 的站点已反代到 `127.0.0.1:${DS_PORT}`（即容器 80）。网关需**额外**加一段转发，
把 `{GW_BASE_PATH}` 前缀（默认 `/oo-gw`）指到 `127.0.0.1:8090`。

在宝塔「网站 → onlyoffice 站点 → 配置文件」的 `location /` **之前**插入（务必用 `^~`，否则会被静态正则规则截胡）：

```nginx
# ONLYOFFICE 桥接网关（放在 location / 之前）
location ^~ /oo-gw/ {
    proxy_pass http://127.0.0.1:8090/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;      # 上传文件上限，与网关 MAX_UPLOAD_BYTES 一致
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

`location /` 转 `127.0.0.1:${DS_PORT}`（DS 容器）的**原配置保持不动**。
同时确认站点配置中**已删除**这两段（本地静态缓存会截胡 DS 的 .js/.css 导致白屏）：
```nginx
location ~ .*\.(js|css)?$   { expires 12h; ... }   # ← 删除
location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$ { expires 30d; ... }  # ← 删除
```

重载：`nginx -t && nginx -s reload`

## 四、浏览器全链路验证
```bash
# 1. 上传一个样例文件到网关（本机 xlsx/docx/pptx 均可）
curl -X POST --data-binary @./sample.xlsx \
     "https://onlyoffice.aweeclaw.com/oo-gw/upload?name=sample.xlsx"

# 2. 网关自检
curl https://onlyoffice.aweeclaw.com/oo-gw/health

# 3. 浏览器打开（会加载 DS 编辑器，可编辑、自动保存）
#    https://onlyoffice.aweeclaw.com/oo-gw/demo.html?file=sample.xlsx
#    也可先访问列表页挑文件： https://onlyoffice.aweeclaw.com/oo-gw/

# 4. 验证保存已回写：编辑后重新下载该文件应包含修改
curl https://onlyoffice.aweeclaw.com/oo-gw/files/sample.xlsx -o /tmp/check.xlsx
```

链路正常后，DS 保存回调 → 网关写回 → 文件更新，均可在
`docker logs oo-gateway` 中看到对应日志（`回调 file=… status=2` / `保存回写: …`）。

## 五、JWT 说明（已自动生效，无需额外操作）
`.env` 的 `JWT_SECRET` 同时注入 DS 与网关容器：
- 宿主页 config：网关服务端用 secret 对 config **整体签名**为 `config.token` 再下发页面（浏览器拿不到 secret，无法伪造文档参数）；
- 保存回调：DS 回推时带 `Authorization: Bearer <token>`，网关**验签通过才写回**，防第三方伪造覆盖文件。
- 若 `JWT_SECRET` 留空，则 DS 与网关均退化为不鉴权——**仅限内网调试**，公网必须设置。

## 六、安全与运维
- 网关端口仅绑定 `127.0.0.1`，公网只能经 `{GW_BASE_PATH}` 反代访问；若想收紧，可在网关上再做一层路径鉴权（Nginx Basic Auth 或业务网关）。
- 上传白名单仅 office 文档扩展名；上传大小默认 50MB（环境变量 `MAX_UPLOAD_BYTES`）。
- 保存回写采用「临时文件 + 原子改名」，不会写坏正在编辑的文件。
- 常用命令：
```bash
./deploy.sh            # 部署/更新（--no-pull 仅用本地镜像）
./deploy.sh logs       # DS 日志
./deploy.sh stop|rm    # 停止 / 移除（rm 会清数据！）
docker compose logs -f oo-gateway   # 网关日志（上传/保存回写）
docker exec -it oo-gateway ls /data # 查看网关上已上传文件
```

## 七、客户端（aweeclaw-client）对接要点
DS 公网化 + 服务器端网关就位后，客户端接入模式为 **先上传后编辑**，闭环含「强制保存」与「会话清理」：

```
① 客户端上传        POST {GW}/upload?name=<uuid>.xlsx&title=<原名>.xlsx
                     → 存为 /data/<uuid>.xlsx（uuid 隔离会话，title 仅用于编辑器显示原名）
② 打开编辑器        GET  {GW}/demo.html?file=<uuid>.xlsx&title=<原名>.xlsx
                     → 服务端签 config，加载 DS 编辑器（document.url=/oo-gw/files/<uuid>.xlsx）
③ 编辑过程          DS autosave + forcesave，每次保存回调 /oo-gw/callback → 网关写回
④ 客户端"保存并关闭" POST {GW}/save?file=<uuid>.xlsx      （触发 DS 强制保存并等待落盘，返回最新 size/mtime）
⑤ 拉回本地          GET  {GW}/files/<uuid>.xlsx            （取最终内容覆盖本地文件）
⑥ 会话清理          DELETE {GW}/files/<uuid>.xlsx          （删除服务器副本）
```

网关接口一览：

| 方法 | 路径 | 说明 | 管理密钥 |
|---|---|---|---|
| POST | `/upload?name=&title=` | 上传文档（title 可选，仅作显示名） | 无 |
| GET | `/files/{name}` | 下载原文件 / DS 拉取 / 客户端回写拉取 | 无 |
| GET | `/demo.html?file=&title=` | 编辑器宿主页（服务端注入签名 config） | 无 |
| GET | `/meta/{name}` | 元信息（mtime/size/key） | 无 |
| GET | `/list.html` | 网关文件列表（调试用） | 无 |
| GET | `/health` | 健康检查 | 无 |
| POST | `/callback?file=` | DS 保存/状态回调（验签） | 无 |
| POST | `/save?file=` | 触发 DS 强制保存并等待回写落盘（客户端关窗前调用） | `x-gw-key` |
| DELETE | `/files/{name}` | 删除服务端副本（会话清理） | `x-gw-key` |

> 若 `.env` 设置了 `GW_ADMIN_KEY`，标记 `x-gw-key` 的接口须带同值请求头 `x-gw-key: <值>`，否则返回 403。
> 上传文档超过 `TTL_HOURS`（默认 24h）未被修改会自动清理，客户端异常退出也不会堆积孤儿文件。

客户端侧建议：上传名用 `{uuid}.{ext}` 隔离会话与同名文件；关窗前先 `POST /save` 再下载回写本地，
成功后 `DELETE` 服务端文件。参考 `gateway/demo.html` 的 config 结构（含 token）。
商业闭源嵌入请向 ONLYOFFICE 购买授权。
