import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventPayloads } from './domain-events';

/**
 * Thin, type-safe wrapper around EventEmitter2 for cross-domain
 * communication. Domain modules should depend on this instead of injecting
 * EventEmitter2 directly, so every emit/listen is checked against the
 * DomainEventPayloads contract in domain-events.ts.
 */
@Injectable()
export class TypedEventEmitter {
  constructor(private readonly emitter: EventEmitter2) {}

  emit<K extends keyof DomainEventPayloads>(
    event: K,
    payload: DomainEventPayloads[K],
  ): boolean {
    return this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEventPayloads>(
    event: K,
    listener: (payload: DomainEventPayloads[K]) => void | Promise<void>,
  ): void {
    this.emitter.on(event, listener);
  }
}
