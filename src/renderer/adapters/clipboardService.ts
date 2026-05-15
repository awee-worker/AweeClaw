export interface ClipboardEntry {
  path: string
  name: string
  isDirectory: boolean
  timestamp: number
}

export type ExplorerClipboardItem = ClipboardEntry

interface ClipboardState { entry: ClipboardEntry | null }
type StateObserver = (state: ClipboardState) => void

class FileClipboardManager {
  private state: ClipboardState = { entry: null }
  private observers = new Set<StateObserver>()

  watch(observer: StateObserver): () => void {
    this.observers.add(observer)
    observer(this.state)
    return () => { this.observers.delete(observer) }
  }

  snapshot(): ClipboardState {
    return this.state
  }

  getState(): ClipboardState {
    return this.state
  }

  copy(entry: ClipboardEntry): void {
    this.state = { entry }
    this.broadcast()
  }

  setItem(entry: ClipboardEntry | null): void {
    this.state = { entry }
    this.broadcast()
  }

  subscribe(observer: StateObserver): () => void {
    return this.watch(observer)
  }

  clear(): void {
    if (!this.state.entry) return
    this.state = { entry: null }
    this.broadcast()
  }

  hasEntry(): boolean {
    return this.state.entry !== null
  }

  private broadcast(): void {
    for (const obs of this.observers) {
      obs(this.state)
    }
  }
}

export const fileClipboardManager = new FileClipboardManager()
export const explorerClipboardService = fileClipboardManager
