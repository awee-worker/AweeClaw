/**
 * Loop Detection utility
 */
export interface LoopDetectionResult {
  isLoop: boolean
  pattern?: string
  repeatCount: number
  confidence: number
}

export class LoopDetector {
  private history: string[] = []
  private maxHistory: number
  private maxExactRepeats: number

  constructor(maxHistory = 50, maxExactRepeats = 3) {
    this.maxHistory = maxHistory
    this.maxExactRepeats = maxExactRepeats
  }

  addEntry(entry: string): LoopDetectionResult {
    this.history.push(entry)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
    return this.detect()
  }

  detect(): LoopDetectionResult {
    if (this.history.length < this.maxExactRepeats) {
      return { isLoop: false, repeatCount: 0, confidence: 0 }
    }

    const last = this.history[this.history.length - 1]
    let repeatCount = 0
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] === last) repeatCount++
      else break
    }

    if (repeatCount >= this.maxExactRepeats) {
      return { isLoop: true, pattern: last, repeatCount, confidence: 0.9 }
    }

    return { isLoop: false, repeatCount, confidence: 0 }
  }

  reset(): void {
    this.history = []
  }
}
