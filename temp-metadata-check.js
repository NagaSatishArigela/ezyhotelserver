require('reflect-metadata');
const { SessionCleanupService } = require('./src/modules/auth/services/session-cleanup.service');
const target = SessionCleanupService.prototype;
console.log('keys on prototype:', Reflect.getMetadataKeys(target, 'revokeExpiredSessions'));
console.log('cron options on prototype:', Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', target, 'revokeExpiredSessions'));
console.log('keys on constructor:', Reflect.getMetadataKeys(SessionCleanupService));
console.log('cron options on constructor:', Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', SessionCleanupService));
