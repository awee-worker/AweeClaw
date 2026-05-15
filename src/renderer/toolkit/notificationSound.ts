type SoundType = 'error' | 'approval' | 'attention' | 'interaction'

const SOUND_PRESETS: Record<SoundType, { type: OscillatorType; freq: [number, number]; gain: number; duration: number }> = {
  error: { type: 'square', freq: [330, 262], gain: 0.12, duration: 0.35 },
  approval: { type: 'sine', freq: [880, 660], gain: 0.15, duration: 0.3 },
  attention: { type: 'sine', freq: [784, 988], gain: 0.13, duration: 0.4 },
  interaction: { type: 'sine', freq: [660, 880], gain: 0.12, duration: 0.25 },
}

export function playNotificationSound(type: SoundType): void {
  try {
    const preset = SOUND_PRESETS[type]
    const ctx = new AudioContext()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.type = preset.type
    osc.frequency.setValueAtTime(preset.freq[0], now)
    osc.frequency.setValueAtTime(preset.freq[1], now + preset.duration * 0.4)
    gainNode.gain.setValueAtTime(preset.gain, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + preset.duration)
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + preset.duration)
    setTimeout(() => ctx.close(), 1000)
  } catch {}
}
