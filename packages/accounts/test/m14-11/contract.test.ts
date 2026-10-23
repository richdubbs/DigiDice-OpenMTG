/**
 * M14-11: M14-4's contract suite (test/m14-4/contract.ts) on PostgresAccountStore, on PGlite in process and, when OPENMTG_TEST_PG_URL names a
 * disposable database, on that server too (design 13.2). The store runs as the service's role (test/m14-11/harness.ts). The erase test's byte search
 * reads every row of every table of the schema; the one purge test that needs the database's clock moved runs on PGlite only.
 */
import { afterAll, describe } from 'vitest';
import { accountStoreContract } from '../m14-4/contract';
import { contractHarness, kits } from './harness';

for (const kit of kits()) {
  // PGlite starts and migrates on first use; the contract's 45-odd tests each empty the tables and open the store again
  describe(`M14-11 ${kit.name}`, { timeout: 60_000 }, () => {
    afterAll(() => kit.end());
    accountStoreContract(contractHarness(kit));
  });
}
