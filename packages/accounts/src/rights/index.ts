/**
 * M14-7: the data-rights part (design section 10): the export, deletion with its grace, claim and cancel, erasure through the required holders,
 * tombstones and name holds, inactive accounts, retention, and the operator's export files. src/compose.ts passes `createRightsPart` to
 * createAccountService, and src/index.ts re-exports this file, so the name stays. `adminExportPath` and ADMIN_EXPORTS_DIR tell the command line
 * where the operator's export was written (9.6).
 */
import type { CreateRightsPart } from '../service/api';
import { buildRightsPart } from './part';

export const createRightsPart: CreateRightsPart | undefined = buildRightsPart;
export { ADMIN_EXPORTS_DIR, adminExportPath } from './files';
