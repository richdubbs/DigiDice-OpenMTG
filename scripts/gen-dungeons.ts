/**
 * Generates packages/engine/src/core/dungeons.json (MX4): the dungeon cards (CR 309) the venture into the dungeon keyword action brings into the game
 * (CR 701.49), with their rooms, the arrows between them, and each room ability compiled from its Oracle text by the game's own compiler.
 *
 *   npx tsx scripts/gen-dungeons.ts           write the file
 *   npx tsx scripts/gen-dungeons.ts --check   exit 1 when the checked-in file differs from what its inputs produce
 *
 * Input: the token file of the local Scryfall cache (<cache>/tokens.jsonl, OPENMTG_CACHE_DIR; dungeons are not in the Oracle card index). The room text is
 * Oracle text; the arrows are the reminder "(Leads to: ...)" of each room (CR 309.4: rooms connected with arrows). Each room's effect is compiled as the
 * effect of a spell by `compileCard` and stored as the room's triggered ability (CR 309.4c: "When you move your venture marker into this room, [effect]");
 * text the compiler leaves manual stays a manual ability (design 10: never approximately). packages/engine/test/mx4/dungeon-data.test.ts recompiles every
 * stored room text and fails when the stored ability differs, so the file follows the template set.
 *
 * Baldur's Gate Wilderness (an Alchemy dungeon, digital only, with "one of your commanders") is left out: no paper card ventures into it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCard, type AbilityDef, type AutomationLevel, type OracleCard } from '../packages/engine/src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
export const DUNGEONS_PATH = join(REPO, 'packages/engine/src/core/dungeons.json');
const SKIP = new Set(["Baldur's Gate Wilderness"]);

export interface RoomData { name: string; text: string; next: number[]; level: AutomationLevel; ability: AbilityDef }
export interface DungeonData { name: string; subtypes: string[]; note?: string; rooms: RoomData[] }

/** A room's effect, compiled as a spell's effect and turned into the room's triggered ability (CR 309.4c). */
export function roomAbility(text: string): { level: AutomationLevel; ability: AbilityDef } {
  const card = { name: 'Dungeon room', layout: 'normal', type_line: 'Sorcery', oracle_text: text, mana_cost: '', cmc: 0, colors: [] } as unknown as OracleCard;
  const def = compileCard(card);
  const abilities = def.faces[0]!.abilities;
  const a = abilities.length === 1 ? abilities[0]! : undefined;
  // the level of the compiled text (an experimental template caps it at partial, design 6.9), kept for the dungeon's own classification
  if (a?.kind === 'spell') return { level: def.automation.level, ability: { kind: 'triggered', text, trigger: { on: [] }, effect: a.effect, ...(a.prov ? { prov: a.prov } : {}) } as AbilityDef };
  const reason = a?.kind === 'manual' ? a.reason : 'the room text did not compile to one effect';
  return { level: 'manual', ability: { kind: 'manual', text, reason, shape: 'triggered' } as AbilityDef };
}

function cacheDir(): string {
  const env = process.env['OPENMTG_CACHE_DIR']?.trim();
  const cands = [env, join(REPO, '.cache', 'scryfall'), resolve(REPO, '..', 'OpenMTG', '.cache', 'scryfall')].filter((x): x is string => !!x);
  const d = cands.find((c) => existsSync(join(c, 'tokens.jsonl')));
  if (!d) throw new Error('No tokens.jsonl found: set OPENMTG_CACHE_DIR');
  return d;
}

export function buildDungeons(): { _comment: string; dungeons: DungeonData[] } {
  const seen = new Map<string, DungeonData>();
  for (const line of readFileSync(join(cacheDir(), 'tokens.jsonl'), 'utf8').split('\n')) {
    if (!line) continue;
    const c = JSON.parse(line) as { name: string; card_faces?: { name: string; type_line?: string; oracle_text?: string }[]; type_line?: string; oracle_text?: string };
    const f = (c.card_faces ?? [c])[0]!;
    if (!(f.type_line ?? '').startsWith('Dungeon') || SKIP.has(f.name) || seen.has(f.name)) continue;
    const subtypes = (f.type_line ?? '').split('—')[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
    const raw: { name: string; text: string; leads: string[] }[] = [];
    let note: string | undefined;
    for (const l of (f.oracle_text ?? '').split('\n')) {
      const m = /^(.+?) — (.+?)(?: \(Leads to: (.+)\))?$/.exec(l);
      if (!m) { note = l; continue; }
      raw.push({ name: m[1]!, text: m[2]!, leads: m[3] ? m[3].split(/, /) : [] });
    }
    const rooms = raw.map((r) => ({
      name: r.name, text: r.text,
      next: r.leads.map((n) => { const i = raw.findIndex((x) => x.name === n); if (i < 0) throw new Error(`${f.name}: room ${n} not found`); return i; }),
      ...roomAbility(r.text),
    }));
    seen.set(f.name, { name: f.name, subtypes, ...(note ? { note } : {}), rooms });
  }
  const dungeons = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    _comment: 'Dungeon cards (CR 309), generated by scripts/gen-dungeons.ts from the Oracle text of the local Scryfall token file. Room 0 is the topmost room (CR 309.4a); `next` are the arrows (CR 309.5a); a room with no `next` is the bottommost room. `ability` is the room ability (CR 309.4c) compiled by the game compiler; checked by packages/engine/test/mx4/dungeon-data.test.ts.',
    dungeons,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = `${JSON.stringify(buildDungeons(), null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const cur = existsSync(DUNGEONS_PATH) ? readFileSync(DUNGEONS_PATH, 'utf8') : '';
    if (cur !== text) { console.error(`${DUNGEONS_PATH} is stale: run npx tsx scripts/gen-dungeons.ts`); process.exit(1); }
    console.log('dungeons.json is current');
  } else {
    writeFileSync(DUNGEONS_PATH, text);
    console.log(`wrote ${DUNGEONS_PATH}`);
  }
}
