# 内置可执行文件目录

打包时 `resources/bin` 会整体拷贝到应用包的 `Contents/Resources/bin/`，
运行时通过 `process.resourcesPath` 定位。

## cliclick

macOS 端鼠标与键盘注入的首选通道。桌面控制适配器按以下顺序探测：

1. `<resourcesPath>/bin/cliclick`（本目录）
2. `/opt/homebrew/bin/cliclick`（Apple Silicon Homebrew）
3. `/usr/local/bin/cliclick`（Intel Homebrew）
4. `/opt/local/bin/cliclick`（MacPorts）

探测只认带执行位的文件。四条都未命中时自动降级到 CoreGraphics 与
AppleScript 通道，功能不受影响，只是每次注入会多一次进程开销。

### 放置方式

发布打包前把 cliclick 可执行文件放到本目录，命名必须为 `cliclick`：

```
resources/bin/cliclick
```

并确认带执行位：

```bash
chmod +x resources/bin/cliclick
```

未放置时打包不会失败，应用会走降级路径。需要二进制时从 cliclick 官方
发布页取得对应架构版本，不要在此提交体积过大的调试版本。
