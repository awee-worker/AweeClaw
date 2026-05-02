import { EventBus } from '../../core/EventBus'
import type { IEventBus } from '../kernel/Token'

export class EventBusAdapter implements IEventBus {
  private eventBus: typeof EventBus

  constructor() {
    this.eventBus = EventBus
  }

  emit(event: unknown): void {
    this.eventBus.emit(event as Parameters<typeof EventBus.emit>[0])
  }

  on(type: string, handler: (event: unknown) => void): () => void {
    return this.eventBus.on(type as Parameters<typeof EventBus.on>[0], handler as Parameters<typeof EventBus.on>[1])
  }
}
