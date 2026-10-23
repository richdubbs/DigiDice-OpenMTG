# Contributing to OpenMTG

Thanks for helping. Please read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first and follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Build and test

```bash
npm install
npm test            # the fast default suite, offline: every rules test, no slow suites (about 1.5 min with --maxWorkers=3)
npm run test:all    # everything, the slow suites too: run this before a merge (merge-time verification)
npm run typecheck   # TypeScript, no emit
npm run notices     # regenerate THIRD_PARTY_NOTICES.md after changing dependencies
```

While working, run only the test files you touch (`npx vitest run <paths>`); Vitest options pass through both scripts
(`npm test -- --maxWorkers=3`, `npm run test:all -- --maxWorkers=2`).

**A player's bug report** (the client's "Report a bug" saves an `.openmtg-bug-report` file): `npm run bug -- replay <file>` checks it, prints
it, replays its game on your checkout to the reported moment and says where your build plays it differently; `--save <out.json>` writes the
game up to that moment as `GameSession.fromJSON` reads it, the start of a regression test.

**The slow suites** (soak games, game marathons, whole-index corpus tests over the local Scryfall cache, the release-gate
CLI run, real-game timing checks) are skipped by `npm test` and run by `npm run test:all`, which sets `OPENMTG_SLOW=1`.
A skipped one carries the reason in its title. Mark a new slow suite with `describeSlow` / `itSlow` (or
`describe.skipIf(!SLOW)(slowTitle(...))`) from `packages/engine/test/slow.ts`, and read big data (the card index) only
when `SLOW` is set: Vitest runs the body of a skipped `describe` to list its tests. Gate a test for its volume (many
games, every card), never a rules test: a rule gets a fast test in the default suite.

**Module isolation.** In `npm test` the node test files of a worker share one module cache (each worker loads the
engine once), so a test that changes an engine table (`OP_HANDLERS`, `RENDERERS`, an evaluator, a hook action, a
capability) must put back exactly what was there; `packages/engine/test/shared-state-guard.ts` fails a file that does
not, naming the entries. Files that call `vi.mock`, `vi.doMock`, `vi.stubGlobal`, `vi.stubEnv`, fake timers, `vi.spyOn` or
`vi.resetModules` are found automatically (`packages/engine/test/suite-isolation.ts`) and run isolated, like the client
tests. `npm run test:all` and `OPENMTG_ISOLATE=1 npm test` run every file in a fresh process.

## Rules

- The Comprehensive Rules are the source of truth. A local copy lives in `rules/cr/` (git-ignored;
  start at `rules/cr/INDEX.md`). Cite rule numbers in code comments and in log messages.
- Keep the engine pure and deterministic: no I/O, no `Math.random`, no `Date`.
- Every rules change needs a test named after the rule it checks.

## Adding card support

Cards are never implemented one function per card: every card is ability-model JSON produced from its Oracle text
(docs/ARCHITECTURE.md, "Abilities are data").
To make a card work:

1. Find out why it is not `full`: `npm run cards -- try "<card name>"` prints the parse trace and every manual unit with its reason
   (`no template`, `unknown word`, `needs-engine: <capability>`, `gate-mismatch`, `contagion`, ...).
2. If it uses a keyword the engine lacks, implement the keyword once in the keyword library (`packages/engine/src/keywords/`, CR 701/702).
3. If the engine lacks a capability (`needs-engine`), add it where its table lives (an op handler, an evaluator, a body of the proposal pipeline); the
   capability appears in `ENGINE_CAPABILITIES` by itself, because that set is built from the tables.
4. If its wording is not recognised, add or extend a template (below) so the whole family of cards with that wording benefits.
5. Add the card's name to the test card list, regenerate the fixture, and add a scenario test (see below).
6. Re-run the coverage report and check the numbers moved the right way (`coverage --diff`).

### Adding a template

Templates are data: JSON files under `packages/engine/src/parser/templates/` (`trigger.json`, `cost.json`, `static.json`, ..., and `effect/*.json` by op family).
Every file there is in the game's compiler (`parser/template-set.ts` imports them statically; add a new file to its list). Design: section 6 of
`docs/design/m5-ability-model.md`.

1. **Pick the work.** `npm run cards -- unmatched --top 40` lists the most frequent unparsed sentence shapes, ordered by the cards a template would unlock
   (`coverage --mine` clusters the residue and shows where the chart stopped). The backlog of the last release gate is committed as
   `docs/coverage/backlog-R1.txt`. To work on what people actually play first, use `npm run cards -- unmatched --weight played --top 40`: each card
   weighs **3** if it is Standard-legal, else **2** if it is in the EDHREC top 2,500 (`edhrec_rank` of the cached bulk file), else **1** (the first
   rule that applies; weights never add up). A line reads `played P (unlocks U)  seen S (cards C)  <shape>`: `P` is the summed weight of the `U`
   cards whose ONLY manual shape this is (a template for it makes them fully parsed), `S` the summed weight of all `C` cards the shape appears on;
   lines are ranked by `P`, then `S`, and the examples are the heaviest cards. Like `unmatched`, it looks at the tuning half only (design 6.12).
   Without the bulk file only the Standard rule applies (the command says so).
2. **Write the template.** Fields (contract `parser/types.ts#Template`):
   - `id` (`eff.<op>...`, `trg.`, `sta.`, `cost.`, ...), `kind`, `cr` (at least one rule, e.g. `["CR 701.8a"]`);
   - `pattern`: words and holes (`{o:Obj}`, `{n:Qty}`, `{pt:PT}`, `{d:Dur}`, ...; the hole grammars are in `parser/holes/`); one derivation must consume the whole
     sentence (guard G1);
   - `build`: the JSON it produces, with `"$hole"` substitutions only (no code, no expressions);
   - `consumes`: the critical words it interprets itself (`each`, `may`, `instead`, ...; G3), and `needs`: the capabilities its output requires;
   - `examples`: **at least two**, each a sentence that must lower to the stated JSON (`expect`) and pass the exact render gate (G6). Use invented
     wordings and numbers ("target creature gets +2/+3"), never copied card text (design 6.10);
   - `counterExamples`: **at least two** sentences that look similar but must not parse, or must parse to different JSON ("... unless ...",
     `each` instead of `target`, a dropped duration);
   - `status`: start as `experimental` (cards that use it are capped at `partial`). Promotion to `stable` is a hand edit of the template's `status`, made
     with the evidence (20 reviewed corpus matches or three verified golden cards, design 6.9) and followed by the G9/G10 checks (`coverage --fixtures
     --diff`). `coverage --promote <reviewed.json>` is a different tool: it proposes NEW experimental templates from reviewed ability JSON
     (`[{card, ability}]`) and checks G9/G10 for them; it writes nothing into the template files and never promotes a template;
   - `since`: the template-set version it was added in.
3. **Try it.** `npm run cards -- try "<sentence>" [--type "Creature — Elf"]` shows tokens, chart, chosen template, JSON, render-gate result and level.
4. **The render gate.** If the gate rejects a correct parse (`gate-mismatch`), teach the renderer (`packages/engine/src/render/`) or the equivalence table
   (`render/equivalence.ts`) the wording; never loosen the gate for one template (design 6.8, G6). A rejected parse is manual, never wrong.
5. **Tests.** `npm test` runs every template's examples, counter-examples and near-miss mutations (G9), the golden corpus (`packages/engine/test/m5/golden`)
   and the nonsense-word mutations (G2). Add golden cards for representative cards the template unlocks.
6. **The G10 snapshot.** Adding a template may change only units that were manual before. Check with
   `npm run cards -- coverage --fixtures --gate R1 --diff` (the CI job over the fixture set; its snapshot is
   `packages/cards/test/coverage/fixtures.snapshot.json`) and, with the local index, `npm run cards -- coverage --diff` (after a
   `npm run cards -- snapshot` of the base). A formerly automated unit that changes fails the check: fix the template or keep it from applying there.
   After an intended change, regenerate the fixture snapshot with `npm run cards -- snapshot --fixtures` and commit it with the template.
7. **Coverage.** `npm run cards -- coverage` reports the levels over the whole local index; `smoke` runs every automated ability on a generated board
   (no `EngineBug` allowed) and `mutate` runs the mutation harness on a sample; `coverage --gate R1` runs all release-gate checks (design 15.4).
   `npm run cards -- coverage --by-format` prints, instead of the full report, one row per slice with its card count and the full / partial /
   manual count and share of that row: the whole corpus; Standard, Pioneer, Modern, Pauper, Legacy and Commander (a card counts when the index's
   Scryfall legalities say `legal` or `restricted`; banned and not legal are out); and the EDHREC top 100, 500, 1,000, 2,500, 5,000 and 10,000
   (the first N oracle ids by `edhrec_rank` in `.cache/scryfall/oracle-cards.jsonl.gz`, read at report time, then the corpus cards among them,
   so a row may count fewer than N). `--bulk FILE` reads another bulk file, `--json FILE` writes the rows as JSON. The fixture cards carry no
   legalities, so with `--fixtures` the format rows are empty; the index is never rebuilt for this report.

The corpus commands read the local Scryfall cache (`npm run cards -- refresh`; from a git worktree set `OPENMTG_CACHE_DIR` to the main checkout's
`.cache/scryfall`). The compile option `forceManual` (a set of Oracle names, `cards/pipeline.ts`) makes the pipeline treat a card as manual whatever a
template says: the escape hatch while a wrong template is fixed.

### Adding a test card and regenerating the fixture

Engine tests run offline from `packages/engine/test/fixtures/cards.json`, which holds only the
Oracle rules fields (no images, prices, flavor text, artist or set info) of the cards listed in
`packages/engine/test/fixtures/test-cards.txt`.

1. Download the card data once: `npm run cards -- refresh` (needs network, about 24 MB; later runs are cached).
2. Add the exact Scryfall card name on its own line in `test-cards.txt`, in the group for the rule or
   feature it exercises (`#` starts a comment; multi-faced cards use the full name, e.g. `Fire // Ice`).
   Any other `*.txt` list in that folder is read as well.
3. Run `npm run cards -- fixtures`. It fails loudly, writes nothing, and suggests close names if a
   name is unknown or not spelled exactly as Scryfall spells it. On success it rewrites `cards.json`
   (sorted by name, 2-space JSON, so diffs are small) and includes the tokens the cards create.
4. Commit `test-cards.txt` and `cards.json` together. Load cards in tests with
   `getCard('Fire // Ice')` or `compiledDef(name)` from `packages/engine/test/fixtures`.

Never commit anything from `.cache/`.

## What not to contribute

No card images, scans, Scryfall bulk data, or Comprehensive Rules text in the repository. Test
fixtures hold only the minimal Oracle fields for named test cards. Dependencies must use
MIT-compatible licenses (MIT, BSD, Apache-2.0, ISC, ...); `node scripts/third-party-notices.mjs --check`
enforces this.
