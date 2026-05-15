import { useEffect, useSyncExternalStore } from 'react'

type Observer = () => void

let overlayCount = 0
const observers = new Set<Observer>()

function broadcast(): void {
  for (const obs of observers) obs()
}

export function claimOverlayLayer(): () => void {
  overlayCount += 1
  broadcast()
  let revoked = false
  return () => {
    if (revoked) return
    revoked = true
    overlayCount = Math.max(0, overlayCount - 1)
    broadcast()
  }
}

function attach(observer: Observer): () => void {
  observers.add(observer)
  return () => { observers.delete(observer) }
}

function readOverlayActive(): boolean {
  return overlayCount > 0
}

export function useHasOverlayLayer(): boolean {
  return useSyncExternalStore(attach, readOverlayActive, readOverlayActive)
}

export function useOverlayLayer(active = true): void {
  useEffect(() => {
    if (!active) return
    return claimOverlayLayer()
  }, [active])
}

export const acquireElevatedToastLayer = claimOverlayLayer
export const useHasElevatedToastLayer = useHasOverlayLayer
export const useElevatedToastLayer = useOverlayLayer
