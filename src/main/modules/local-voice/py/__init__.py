"""本地语音 Python sidecar 脚本包。

显式声明为常规包（而非命名空间包），避免 venv 中同名第三方库
（如 pytest 依赖的 `py`）抢占 `py.moss.*` 的解析。
"""
