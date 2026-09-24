/**
 * MediaBridge 行为与安全边界测试
 *
 * 两组用例：
 * - 校验组：参数与路径边界，参数校验排在文件/子进程操作之前，因此不依赖素材
 * - 集成组：用内置 ffmpeg 现造素材跑通主链路（探测 / 裁剪 / 拼接 / 字幕 / 抽帧 …）
 *
 * 素材与产物统一落在系统临时目录下 aweeclaw- 前缀的沙箱里：既是用例需要，
 * 也顺带覆盖了「临时目录放行」这条路径规则。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { mediaBridge, setMediaWorkspaceResolver, type MediaOutput } from './MediaBridge'
import {
  assertPermission,
  registerPermissions,
  unregisterPermissions,
  validatePermissions,
} from './PluginPermissionGuard'

const FFMPEG = ffmpegStatic
const ffmpegReady = Boolean(FFMPEG) && existsSync(FFMPEG as string)
const describeIntegration = ffmpegReady ? describe : describe.skip

/** 沙箱与素材路径（beforeAll 里填充） */
let sandbox = ''
/** 10s / 含音轨 / 640x360 */
let srcVideo = ''
/** 5s / 含音轨 */
let srcShort = ''
/** 3s / 无音轨 */
let srcSilent = ''
/** 1s / H.265 */
let srcHevc = ''
/** 占位输入：只需要「文件存在且在沙箱内」，不参与真实解码 */
let dummyInput = ''
/** 中文字幕 */
let srcSubtitle = ''
let hevcReady = false

/** 直接调内置二进制造素材（媒体桥不提供「合成测试素材」这类能力） */
function makeSource(args: string[], output: string): boolean {
  const result = spawnSync(FFMPEG as string, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...args,
    output,
  ])
  return result.status === 0 && existsSync(output) && statSync(output).size > 0
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aweeclaw-media-test-'))
  setMediaWorkspaceResolver(() => sandbox)
  // 不依赖 ffmpeg 的用例也需要一个「存在的输入文件」，先备一个
  dummyInput = join(sandbox, 'dummy.mp4')
  writeFileSync(dummyInput, 'placeholder')
  if (!ffmpegReady) return

  const withAudio = [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
  ]
  srcVideo = join(sandbox, 'src-10s.mp4')
  srcShort = join(sandbox, 'src-5s.mp4')
  srcSilent = join(sandbox, 'src-silent.mp4')
  srcHevc = join(sandbox, 'src-hevc.mp4')

  const encode = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
  makeSource([...withAudio, '-t', '10', ...encode, '-c:a', 'aac', '-shortest'], srcVideo)
  makeSource([...withAudio, '-t', '5', ...encode, '-c:a', 'aac', '-shortest'], srcShort)
  makeSource(
    ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-an', ...encode],
    srcSilent,
  )
  hevcReady = makeSource(
    [
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
      '-t', '1', '-an',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    ],
    srcHevc,
  )

  srcSubtitle = join(sandbox, 'subtitle.srt')
  writeFileSync(srcSubtitle, '1\n00:00:00,500 --> 00:00:02,500\n中文字幕测试\n', 'utf-8')
}, 180000)

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true })
})

// ─── 参数与路径边界 ────────────────────────────────────────

describe('MediaBridge 参数与路径边界', () => {
  it('拒绝工作区外的输入路径', async () => {
    await expect(mediaBridge.probe('/etc/passwd')).rejects.toThrow(/越界/)
  })

  it('拒绝经软链接指向区外的输入', async () => {
    const link = join(sandbox, 'escape.mp4')
    if (!existsSync(link)) symlinkSync('/etc/hosts', link)
    await expect(mediaBridge.probe(link)).rejects.toThrow(/越界/)
  })

  it('拒绝相对路径', async () => {
    await expect(mediaBridge.probe('src.mp4')).rejects.toThrow(/绝对路径/)
  })

  it('拒绝越界参数', async () => {
    await expect(mediaBridge.thumbnail('x.mp4', { frames: 1000 })).rejects.toThrow(/frames/)
    await expect(mediaBridge.thumbnail('x.mp4', { width: -1 })).rejects.toThrow(/width/)
    await expect(mediaBridge.transcode('x.mp4', { crf: 999 })).rejects.toThrow(/crf/)
    await expect(mediaBridge.trim('x.mp4', { startMs: 1000 })).rejects.toThrow(/durationMs 或 endMs/)
  })

  it('frames 与 atMs 互斥', async () => {
    await expect(mediaBridge.thumbnail('x.mp4', { frames: 5, atMs: 1000 })).rejects.toThrow(/互斥/)
  })

  it('产物已存在且未声明覆盖时拒绝', async () => {
    const target = join(sandbox, 'existing.mp4')
    if (!existsSync(target)) writeFileSync(target, 'placeholder')
    await expect(
      mediaBridge.trim(dummyInput, { startMs: 0, durationMs: 1000, outputPath: target }),
    ).rejects.toThrow(/已存在/)
  })

  it('mixAudio 拒绝空音轨、超量音轨与缺 path 的音轨', async () => {
    await expect(mediaBridge.mixAudio(dummyInput, { tracks: [] })).rejects.toThrow(/至少需要 1 条/)
    await expect(
      mediaBridge.mixAudio(dummyInput, {
        tracks: Array.from({ length: 5 }, () => ({ path: dummyInput })),
      }),
    ).rejects.toThrow(/上限/)
    await expect(
      mediaBridge.mixAudio(dummyInput, { tracks: [{ path: '' }] }),
    ).rejects.toThrow(/缺少 path/)
    await expect(
      mediaBridge.mixAudio(dummyInput, { tracks: [{ path: dummyInput, volume: 9 }] }),
    ).rejects.toThrow(/volume/)
  })
})

// ─── 权限映射 ──────────────────────────────────────────────

describe('media.process 权限', () => {
  it('是合法权限值（安装校验不告警、不被丢弃）', () => {
    const declared = validatePermissions('test-plugin', ['media.process'])
    expect(declared.has('media.process')).toBe(true)
  })

  it('未声明权限时访问 host.media 抛 PermissionDeniedError', () => {
    registerPermissions('plugin-without-media', validatePermissions('plugin-without-media', ['network']))
    expect(() => assertPermission('plugin-without-media', 'media.process')).toThrow(
      /lacks required permission/,
    )
    unregisterPermissions('plugin-without-media')
  })

  it('声明权限后校验通过', () => {
    registerPermissions('plugin-with-media', validatePermissions('plugin-with-media', ['media.process']))
    expect(() => assertPermission('plugin-with-media', 'media.process')).not.toThrow()
    unregisterPermissions('plugin-with-media')
  })
})

// ─── 主链路（真实 ffmpeg） ─────────────────────────────────

describeIntegration('MediaBridge 主链路', () => {
  it('getStatus 报告 ffmpeg 可用与版本号', async () => {
    const status = await mediaBridge.getStatus()
    expect(status.available).toBe(true)
    expect(status.version).toBeTruthy()
  })

  it('probe 返回时长、分辨率与编码', async () => {
    const info = await mediaBridge.probe(srcVideo)
    expect(info.format).toBe('mp4')
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.width).toBe(640)
    expect(info.height).toBe(360)
    expect(info.videoCodec).toBe('h264')
    expect(info.durationMs).toBeGreaterThan(9000)
    expect(info.durationMs).toBeLessThan(11000)
    expect(info.sizeBytes).toBeGreaterThan(0)
  })

  it('trim 取 2s~5s 得到约 3 秒产物', async () => {
    const out = await mediaBridge.trim(srcVideo, { startMs: 2000, endMs: 5000 })
    expect(out.durationMs).toBeGreaterThan(2800)
    expect(out.durationMs).toBeLessThan(3200)
    expect(out.sizeBytes).toBeGreaterThan(0)
  })

  it('concat 三段 5s 拼成约 15 秒（reencode 与 copy 均可用）', async () => {
    const inputs = [srcShort, srcShort, srcShort]
    const reencoded = await mediaBridge.concat(inputs, {
      mode: 'reencode',
      size: { width: 640, height: 360 },
    })
    expect(reencoded.durationMs).toBeGreaterThan(14500)
    expect(reencoded.durationMs).toBeLessThan(15600)

    const copied = await mediaBridge.concat(inputs, { mode: 'copy' })
    expect(copied.durationMs).toBeGreaterThan(14500)
    expect(copied.durationMs).toBeLessThan(15600)
  }, 120000)

  it('extractAudio 输出 mp3 与 24kHz 单声道 PCM', async () => {
    const mp3 = await mediaBridge.extractAudio(srcShort, { format: 'mp3' })
    expect(existsSync(mp3.outputPath)).toBe(true)

    const pcm = await mediaBridge.extractAudio(srcShort, { format: 'pcm' })
    expect(pcm.outputPath.endsWith('.pcm')).toBe(true)
    // 5s × 24000Hz × 2 字节，容许编码器补帧带来的一点误差
    expect(pcm.sizeBytes).toBeGreaterThan(5 * 24000 * 2 * 0.9)
    expect(pcm.durationMs).toBeGreaterThan(4500)
    expect(pcm.durationMs).toBeLessThan(6000)
  })

  it('muxAudio 给无声视频补上音轨', async () => {
    const audio = await mediaBridge.extractAudio(srcShort, { format: 'mp3' })
    const muxed = await mediaBridge.muxAudio(srcSilent, audio.outputPath, { audioVolume: 0.8 })
    const info = await mediaBridge.probe(muxed.outputPath)
    expect(info.hasAudio).toBe(true)
    expect(muxed.sizeBytes).toBeGreaterThan(0)
  })

  it('mixAudio 把循环 BGM 与配音叠到同一条音轨且与画面等长', async () => {
    const voice = await mediaBridge.extractAudio(srcShort, {
      format: 'mp3',
      outputPath: join(sandbox, 'mix-voice.mp3'),
    })
    // 1s 的短 BGM：验证循环铺底确实把音轨拉满到成片长度
    const bgmPath = join(sandbox, 'mix-bgm-1s.mp3')
    const bgmReady = makeSource(
      ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '1', '-c:a', 'libmp3lame'],
      bgmPath,
    )
    expect(bgmReady).toBe(true)

    const mixed = await mediaBridge.mixAudio(srcShort, {
      tracks: [
        { path: voice.outputPath, volume: 1 },
        { path: bgmPath, volume: 0.3, loop: true },
      ],
      outputPath: join(sandbox, 'mix-out.mp4'),
    })

    const info = await mediaBridge.probe(mixed.outputPath)
    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.durationMs).toBeGreaterThan(4800)
    expect(info.durationMs).toBeLessThan(5300)
    expect(mixed.sizeBytes).toBeGreaterThan(0)
  }, 120000)

  it('thumbnail 单帧返回一个产物、frames: 5 返回五个产物', async () => {
    const single: MediaOutput[] = await mediaBridge.thumbnail(srcVideo, { atMs: 800, width: 320 })
    expect(single).toHaveLength(1)
    expect(single[0].sizeBytes).toBeGreaterThan(0)

    const multi = await mediaBridge.thumbnail(srcVideo, { frames: 5, width: 320 })
    expect(multi).toHaveLength(5)
    for (const item of multi) expect(existsSync(item.outputPath)).toBe(true)
  }, 60000)

  it('overlay 把水印叠加到右下角', async () => {
    const [cover] = await mediaBridge.thumbnail(srcShort, { atMs: 500, width: 160 })
    const out = await mediaBridge.overlay(srcShort, {
      overlayPath: cover.outputPath,
      position: 'bottom-right',
      scaleWidthRatio: 0.2,
      opacity: 0.8,
    })
    const info = await mediaBridge.probe(out.outputPath)
    expect(info.width).toBe(640)
    expect(info.hasAudio).toBe(true)
  }, 60000)

  it('burnSubtitle 烧录中文字幕', async () => {
    const out = await mediaBridge.burnSubtitle(srcShort, {
      subtitlePath: srcSubtitle,
      fontSizePercent: 5,
    })
    const info = await mediaBridge.probe(out.outputPath)
    expect(info.hasVideo).toBe(true)
    expect(out.durationMs).toBeGreaterThan(4000)
  }, 60000)

  it('toGif 生成 480 宽的 GIF', async () => {
    const out = await mediaBridge.toGif(srcShort, { startMs: 0, durationMs: 1500, width: 480, fps: 10 })
    const info = await mediaBridge.probe(out.outputPath)
    expect(info.width).toBe(480)
    expect(out.sizeBytes).toBeGreaterThan(0)
  }, 60000)

  it('transcode 把 H.265 转成 H.264', async () => {
    if (!hevcReady) return
    const out = await mediaBridge.transcode(srcHevc, { videoCodec: 'h264' })
    const info = await mediaBridge.probe(out.outputPath)
    expect(info.videoCodec).toBe('h264')
  }, 120000)

  it('onProgress 被多次回调且进度单调不减', async () => {
    const samples: number[] = []
    await mediaBridge.trim(srcVideo, {
      startMs: 0,
      durationMs: 8000,
      onProgress: (p) => samples.push(p.progress),
    })
    expect(samples.length).toBeGreaterThan(0)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
    }
    expect(samples[samples.length - 1]).toBeLessThanOrEqual(1)
  }, 120000)

  it('超时后报超时错误且不留下残留产物', async () => {
    const target = join(sandbox, 'timeout-out.mp4')
    await expect(
      mediaBridge.transcode(srcVideo, {
        videoCodec: 'hevc',
        size: { width: 1280, height: 720 },
        timeoutMs: 1000,
        outputPath: target,
      }),
    ).rejects.toThrow(/超时/)
    expect(existsSync(target)).toBe(false)
  }, 60000)

  it('产物已存在时传 overwrite 可覆盖', async () => {
    const target = join(sandbox, 'overwrite.mp4')
    const first = await mediaBridge.trim(srcShort, {
      startMs: 0,
      durationMs: 1000,
      outputPath: target,
    })
    const second = await mediaBridge.trim(srcShort, {
      startMs: 0,
      durationMs: 2000,
      outputPath: target,
      overwrite: true,
    })
    expect(second.sizeBytes).toBeGreaterThan(0)
    expect(second.durationMs).toBeGreaterThan(first.durationMs)
  }, 60000)
})
