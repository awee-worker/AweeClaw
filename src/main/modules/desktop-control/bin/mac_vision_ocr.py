#!/usr/bin/env python3
"""
macOS Vision Framework 屏幕文字识别（pyobjc 版）

使用方式：
  python3 mac_vision_ocr.py <base64图片>          # 从参数读取
  echo "<base64>" | python3 mac_vision_ocr.py     # 从 stdin 读取
  python3 mac_vision_ocr.py --file /path/to/image  # 从文件读取

输出 JSON:
  { "items": [{"text":"代码江湖","x":200,"y":150,"width":80,"height":24,"confidence":0.95}], "elapsed":123, "engine":"vision" }
  { "error": "错误信息", "engine":"vision" }

依赖: pip3 install pyobjc-framework-Vision pyobjc-framework-Quartz
"""

import sys
import os
import json
import base64
import time

# pyobjc 导入 macOS 原生框架
import objc
from Foundation import NSData, NSDictionary, NSArray, NSURL
from Vision import (
    VNRecognizeTextRequest,
    VNImageRequestHandler,
    VNRequestTextRecognitionLevelAccurate,
)
from Quartz import (
    CGImageSourceCreateWithData,
    CGImageSourceCreateImageAtIndex,
    CGImageGetWidth,
    CGImageGetHeight,
    kCGImagePropertyOrientationUp,
)
from CoreFoundation import CFRelease


def recognize(image_bytes: bytes) -> dict:
    """对图片进行 Vision OCR 识别，返回结构化结果"""
    start = time.time()

    # 1. 创建 CGImage
    ns_data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
    if ns_data is None:
        return {"error": "Failed to create NSData", "engine": "vision"}

    cg_source = CGImageSourceCreateWithData(ns_data, None)
    if cg_source is None:
        return {"error": "Failed to create CGImageSource", "engine": "vision"}

    cg_image = CGImageSourceCreateImageAtIndex(cg_source, 0, None)
    if cg_image is None:
        return {"error": "Failed to create CGImage", "engine": "vision"}

    image_width = CGImageGetWidth(cg_image)
    image_height = CGImageGetHeight(cg_image)

    # 2. 创建 Vision 请求
    request = VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(VNRequestTextRecognitionLevelAccurate)

    # 中英文混合识别
    request.setRecognitionLanguages_(["zh-Hans", "zh-Hant", "en-US"])

    # 不使用语言修正（保留原始识别结果，避免修改用户名等专有名词）
    request.setUsesLanguageCorrection_(False)

    # 3. 执行请求
    handler = VNImageRequestHandler.alloc().initWithCGImage_orientation_options_(
        cg_image, kCGImagePropertyOrientationUp, NSDictionary.dictionary()
    )

    success = handler.performRequests_error_([request], None)
    if not success:
        return {"error": "Vision request failed", "engine": "vision"}

    # 4. 解析结果
    results = request.results()
    items = []

    if results:
        for observation in results:
            try:
                candidates = observation.topCandidates_(1)
                if not candidates or len(candidates) == 0:
                    continue

                candidate = candidates[0]
                text = candidate.string().strip()
                if not text:
                    continue

                # Vision boundingBox: 归一化坐标 (0-1)，原点在左下角
                # 转换为像素坐标，原点在左上角
                bbox = observation.boundingBox()
                origin_x = bbox.origin.x
                origin_y = bbox.origin.y
                bbox_width = bbox.size.width
                bbox_height = bbox.size.height

                pixel_x = round(origin_x * image_width)
                pixel_y = round((1 - origin_y - bbox_height) * image_height)
                pixel_w = round(bbox_width * image_width)
                pixel_h = round(bbox_height * image_height)

                if pixel_w <= 0 or pixel_h <= 0:
                    continue

                center_x = pixel_x + round(pixel_w / 2)
                center_y = pixel_y + round(pixel_h / 2)

                items.append({
                    "text": text,
                    "x": center_x,
                    "y": center_y,
                    "width": pixel_w,
                    "height": pixel_h,
                    "confidence": round(float(candidate.confidence()), 4),
                })
            except Exception:
                continue

    # 释放资源
    request.dealloc()

    elapsed = round((time.time() - start) * 1000)
    return {"items": items, "elapsed": elapsed, "engine": "vision"}


def main():
    image_bytes = None

    if "--file" in sys.argv:
        idx = sys.argv.index("--file")
        filepath = sys.argv[idx + 1]
        with open(filepath, "rb") as f:
            image_bytes = f.read()
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        image_bytes = base64.b64decode(sys.argv[1])
    else:
        b64_data = sys.stdin.read().strip()
        if not b64_data:
            print(json.dumps({"error": "No image data provided", "engine": "vision"}))
            sys.exit(1)
        image_bytes = base64.b64decode(b64_data)

    if not image_bytes:
        print(json.dumps({"error": "Failed to decode image", "engine": "vision"}))
        sys.exit(1)

    try:
        result = recognize(image_bytes)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "engine": "vision"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
