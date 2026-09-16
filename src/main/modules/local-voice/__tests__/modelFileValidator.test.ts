/**
 * 模型文件内容校验单元测试
 *
 * 重点回归：「以 "<" 开头的合法词表文件」不能被误判为 HTML 错误页。
 * 该误判曾导致 SenseVoice ASR 模型的 tokens.txt 反复下载失败。
 */

import { describe, it, expect } from 'vitest'
import { isErrorPageContent } from '../modelFileValidator'

/** 还原 SenseVoice 真实 tokens.txt 的首部（首行即 `<unk> 0`） */
const senseVoiceTokensHead = '<unk> 0\n<s> 1\n</s> 2\n<blank> 3\n'

describe('isErrorPageContent', () => {
  describe('合法文件不应被误判', () => {
    it('SenseVoice tokens.txt（以 "<unk>" 开头）应视为合法文件', () => {
      const buffer = Buffer.from(senseVoiceTokensHead, 'utf8')
      expect(isErrorPageContent(buffer, 'text/plain; charset=utf-8')).toBe(false)
    })

    it('真实的 315894 字节词表（用户报错的那个体积）应视为合法文件', () => {
      const padding = 'x 12345\n'.repeat(39000)
      const buffer = Buffer.from(senseVoiceTokensHead + padding, 'utf8')
      expect(buffer.length).toBeGreaterThan(300000)
      expect(isErrorPageContent(buffer, 'application/octet-stream')).toBe(false)
    })

    it('以 "<blank>" 开头的词表应视为合法文件', () => {
      const buffer = Buffer.from('<blank> 0\n<unk> 1\n', 'utf8')
      expect(isErrorPageContent(buffer, 'text/plain')).toBe(false)
    })

    it('只有 content-type 是 html 但正文无 HTML 标签时不拦截', () => {
      const buffer = Buffer.from('plain text body', 'utf8')
      expect(isErrorPageContent(buffer, 'text/html; charset=utf-8')).toBe(false)
    })

    it('合法的大 JSON（如 manifest.json）不拦截', () => {
      const payload = JSON.stringify({
        model_config: { sample_rate: 24000, audio_codebook_sizes: [1024] },
        files: Array.from({ length: 500 }, (_, i) => `moss_tts_shared_${i}.data`),
      })
      const buffer = Buffer.from(payload, 'utf8')
      expect(isErrorPageContent(buffer, 'application/octet-stream')).toBe(false)
    })

    it('二进制 ONNX 文件头不拦截', () => {
      const buffer = Buffer.alloc(2048, 0)
      buffer.writeUInt8(0x08, 0)
      buffer.write('onnx', 1)
      expect(isErrorPageContent(buffer, 'application/octet-stream')).toBe(false)
    })

    it('小体积的合法 JSON（无 code/message 结构）不拦截', () => {
      const buffer = Buffer.from('{"version": 1, "name": "model"}', 'utf8')
      expect(isErrorPageContent(buffer, 'application/json')).toBe(false)
    })
  })

  describe('平台错误页应被拦截', () => {
    it('空响应体拦截', () => {
      expect(isErrorPageContent(Buffer.alloc(0), 'application/octet-stream')).toBe(true)
    })

    it('HTML 错误页（DOCTYPE）拦截', () => {
      const html = '<!DOCTYPE html>\n<html><head><title>404</title></head><body>Not Found</body></html>'
      expect(isErrorPageContent(Buffer.from(html, 'utf8'), 'text/html')).toBe(true)
    })

    it('HTML 错误页（html 标签开头）拦截', () => {
      const html = '<html><body>Access denied</body></html>'
      expect(isErrorPageContent(Buffer.from(html, 'utf8'), 'text/html; charset=utf-8')).toBe(true)
    })

    it('ModelScope 错误 JSON 拦截', () => {
      const json = JSON.stringify({
        Code: 10990101007,
        Message: 'The model file does not exist',
        RequestId: 'abc',
      })
      expect(isErrorPageContent(Buffer.from(json, 'utf8'), 'application/json')).toBe(true)
    })

    it('HuggingFace 镜像的 "Entry not found" 拦截', () => {
      expect(isErrorPageContent(Buffer.from('Entry not found', 'utf8'), 'text/plain')).toBe(true)
    })

    it('"404: Not Found" 拦截', () => {
      expect(isErrorPageContent(Buffer.from('404: Not Found', 'utf8'), 'text/plain')).toBe(true)
    })
  })
})
