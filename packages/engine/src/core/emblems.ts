/**
 * Emblems (CR 114): the definition of an emblem. Owner: WP15 (called by the `createEmblem` handler); the object itself is created by
 * core/zones.ts#createEmblemObject, the module that creates objects (design 8.5).
 *
 * An emblem is an object in the command zone, owned and controlled by the player who gets it (CR 114.2); it has no characteristics other than its abilities: no
 * types, no mana cost, no color, usually no name (CR 114.3); its abilities function in the command zone (CR 114.4), so every static, triggered and activated
 * ability of the definition is given `zone: ['command']`. The definition is shared by equal emblems: its id is a hash of its abilities.
 *
 * DEVIATION from design 4.1 / 8.3 (declared in the WP15 review): the design lists `AbilityRef.source: 'emblem'` with the ability carried in `StackInfo.inline`.
 * Here the emblem's abilities are the PRINTED abilities of a synthetic definition (layout `emblem`) instead, so the existing machinery reads them unchanged:
 * the layer system for static abilities, WP8's collection for triggered ones (triggers/collect.ts already looks at emblems in the command zone) and the stack's
 * `printed` references for activated and triggered ones. Nothing is lost: an emblem never changes zones and has no other source of abilities (CR 114.4).
 *
 * The definition's `automation` is computed from its abilities (design 10, decision 17: "classification is computed, never asserted"): `full` only when no
 * ability has a manual node (a manual ability, step, condition, quantity or cost part); `manual` when every ability is manual; `partial` otherwise. The
 * abilities were classified (and degraded) against the engine's capabilities with the card that makes the emblem, so a missing capability is a manual node here.
 * (core may not import model/classify.ts, design 5.4, hence the small walker below, which finds the same nodes as `manualNodes`.)
 */
import type { AbilityDef } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { LinkValue } from '../types/state';
import type { Game } from './game';
import { createEmblemObject } from './zones';

/** FNV-1a over the canonical JSON of the abilities: a stable, short definition id (design 4.3: equal definitions share an id). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** CR 114.4: the abilities of an emblem function in the command zone. */
function inCommandZone(a: AbilityDef): AbilityDef {
  switch (a.kind) {
    case 'static': case 'triggered': case 'activated': case 'manual':
      return a.zone ? a : { ...a, zone: ['command'] };
    default:
      return a;
  }
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The texts of the manual nodes in `x`, in document order: a manual ability or cost part (`kind:'manual'`), a manual step, a manual condition or quantity. */
function manualTexts(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) {
    for (const y of x) manualTexts(y, out);
    return out;
  }
  if (!isRec(x)) return out;
  if (x['kind'] === 'manual' || x['op'] === 'manual' || x['cond'] === 'ask' || x['q'] === 'ask') {
    out.push(typeof x['text'] === 'string' ? x['text'] : 'manual');
    return out; // what is inside a manual node is not run
  }
  for (const v of Object.values(x)) manualTexts(v, out);
  return out;
}

/** The definition of an emblem with these abilities (CR 114.3). `label` is only for the log and the UI: an emblem has no name. */
export function emblemDef(abilities: AbilityDef[], label: string): CardDef {
  const own = abilities.map(inCommandZone);
  const manual = manualTexts(own);
  const level = manual.length === 0 ? 'full' : own.every((a) => a.kind === 'manual') ? 'manual' : 'partial';
  return {
    id: `emblem:${hash(JSON.stringify(own))}`,
    name: label,
    layout: 'emblem',
    isToken: false,
    faces: [{
      name: label, manaCost: null, typeLine: '', supertypes: [], types: [], subtypes: [], colors: [], keywords: [],
      oracleText: own.map((a) => a.text).join('\n'), abilities: own,
    }],
    automation: { level, unsupported: manual, source: 'templates' }, // the abilities come from the compiled text of the card that made it
  };
}

/**
 * CR 114.2: put an emblem with these abilities into the command zone; the player owns and controls it. Returns its id. std-rx9 (CR 607.2d, 608.2c): `links` are
 * the choices of the resolution that creates it which its abilities read ("Choose a creature type. You get an emblem with \"Creatures you control of the
 * chosen type ...\""): they are the emblem's own links (core/zones.ts#createEmblemObject), the source its abilities read links from (statics/match.ts#hasChosen).
 */
export function createEmblem(g: Game, player: PlayerId, abilities: AbilityDef[], sourceName: string, links: Readonly<Record<string, LinkValue>> = {}): ObjectId {
  const id = createEmblemObject(g, emblemDef(abilities, `Emblem (${sourceName})`), player, links);
  g.log(`${g.player(player).name} gets an emblem with ${abilities.map((a) => `"${a.text}"`).join(' and ')}.`, { rules: ['CR 114.2'], level: 'action' });
  return id;
}
