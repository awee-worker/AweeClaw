# 内置 VRM 模型目录

将 `.vrm`（VRM 0.x / 1.0）或 `.glb` 模型文件放在本目录，即可作为「桌面伴侣」的内置模型，
随客户端一起打包分发（electron-builder `extraResources` 会把 `resources/vrm` 投放到
`<安装目录>/resources/vrm`，运行时由 `VrmCompanionStore.getBuiltinModelsDir()` 读取）。

## 说明

- **本目录默认不包含任何模型文件**，请自行放入你有权分发的 VRM 模型。
- 模型授权请遵守原作者许可（VRM 通常附带使用条款，常见于 VRoid Hub / Booth 等平台）。
- 单模型建议控制在 30MB 以内：桌面伴侣窗口常驻渲染，模型过大会显著增加显存与加载耗时。

## 用户导入的模型

用户也可在「设置 → 外观 / 桌面伴侣」中点击「导入模型」，文件会被复制到
`<用户数据目录>/vrm/models/`（不污染安装目录，卸载重装后仍保留）：

- macOS: `~/Library/Application Support/AweeClaw/vrm/models/`
- Windows: `%APPDATA%/AweeClaw/vrm/models/`
- Linux: `~/.config/AweeClaw/vrm/models/`

## 目录优先级

1. 内置：`resources/vrm/models/`（随包分发，只读，不可在 UI 中删除）
2. 用户：`<userData>/vrm/models/`（可导入/删除）
