/**
 * Vitest global setup: says once per run whether the slow suites run (package QT, packages/engine/test/slow.ts). `npm test` skips them;
 * `npm run test:all` (OPENMTG_SLOW=1) runs everything.
 */
export default function setup(): void {
  // global setup runs once per Vitest project (node, client), in the main process: print once
  if (process.env['OPENMTG_SLOW_NOTICE'] === '1') return;
  process.env['OPENMTG_SLOW_NOTICE'] = '1';
  if (process.env['OPENMTG_SLOW'] === '1') console.log('OpenMTG: OPENMTG_SLOW=1, the slow suites run (soak games, game marathons, whole-index corpus tests).');
  else console.log('OpenMTG: the slow suites are skipped (soak games, game marathons, whole-index corpus tests); run npm run test:all (OPENMTG_SLOW=1) before a merge.');
}
