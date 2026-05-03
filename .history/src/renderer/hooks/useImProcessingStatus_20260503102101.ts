import { useState, useEffect } from 'react'
import { api } from '@renderer/services/electronAPI'
import type { ImProcessingStatus } from '@shared/types/channel'

type Listener = () => void

export const activeStatuses = new Map<string, ImProcessingStatus>()
const listeners = new Set<Listener>()

export function emitChange() {
  listeners.forEach(l => l())
}

export function getActiveImStatuses(): ImProcessingStatus[] {
  return Array.from(activeStatuses.values())
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  api.channel.onImProcessingStatus((status: ImProcessingStatus) => {
    if (status.phase === 'done' || status.phase === 'error') {
      activeStatuses.delete(status.messageId)
    } else {
      activeStatuses.set(status.messageId, status)
    }
    emitChange()
  })
}

export function useImProcessingStatus(): ImProcessingStatus[] {
  const [statuses, setStatuses] = useState<ImProcessingStatus[]>(() => getActiveImStatuses())

  useEffect(() => {
    setStatuses(getActiveImStatuses())
    return subscribe(() => {
      setStatuses(getActiveImStatuses())
    })
  }, [])

  return statuses
}
