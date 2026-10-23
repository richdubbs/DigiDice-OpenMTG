/**
 * M14-5: the audit writer's factory (design 8.5), under the name the service core uses and src/index.ts re-exports (`export *`, so only this name
 * leaves this file). The writer and its month keys are in ./writer.ts, the details' shapes in ./details.ts.
 */
import type { CreateAuditWriter } from './api';
import { buildAuditWriter } from './writer';

export const createAuditWriter: CreateAuditWriter = (opts) => buildAuditWriter(opts);
