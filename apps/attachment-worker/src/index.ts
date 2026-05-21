import { loadConfig } from '@arivu/config';
import { createLogger } from '@arivu/logger';

const log = createLogger('attachment-worker');
loadConfig();

log.info('Attachment worker placeholder — Phase 2');
