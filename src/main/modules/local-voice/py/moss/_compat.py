"""MOSS TTS 运行时的版本兼容层。

移植自 super-ai-browser 的运行时实现使用了部分 Python 3.10+ 的运行时特性，
而 AweeClaw 的 Python 环境可能是 3.9（如 macOS 自带的系统 Python）。
本模块提供等价回退，避免运行时抛错。
"""

import sys


def zip_strict(*iterables):
    """``zip(*iterables, strict=True)`` 的兼容实现。

    Python 3.9 的 builtin zip 不接受 ``strict`` 关键字参数，
    直接调用会抛 ``TypeError: zip() takes no keyword arguments``。
    """
    if sys.version_info >= (3, 10):
        return zip(*iterables, strict=True)

    sentinel = object()

    def _generate():
        iters = [iter(it) for it in iterables]
        if not iters:
            return
        while True:
            row = [next(it, sentinel) for it in iters]
            if all(value is sentinel for value in row):
                return
            if any(value is sentinel for value in row):
                raise ValueError("zip() arguments have different lengths")
            yield tuple(row)

    return _generate()
