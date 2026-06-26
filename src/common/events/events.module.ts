import { Global, Module } from '@nestjs/common';
import { TypedEventEmitter } from './typed-event-emitter.service';

@Global()
@Module({
  providers: [TypedEventEmitter],
  exports: [TypedEventEmitter],
})
export class EventsModule {}
