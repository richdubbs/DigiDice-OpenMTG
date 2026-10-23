/**
 * p2-exile-play-1 (CR 607.2a, 607.1; design 6.4): "the exiled card" in a one-sentence static ability ("Your opponents can't cast spells with the same name as the
 * exiled card.", "Spells you cast that share a card type with the exiled card cost {2} less to cast.") is the card another ability of the object exiled: a static
 * ability makes no instruction of its own that exiles, so the singular anaphor `the exiled card` (head card, participle exiled) can only name the linked card,
 * `{ref:'linked', link:'exiled'}`. The face pass (parse.ts#linkExiled) then finds the ONE exiling instruction of the face's other abilities; with none or several the
 * ability is manual (never a guess). Any other marker, or another anaphor, leaves the value as it is (null).
 */
import { clone, isRec } from './util';
import type { Rec } from './types';

const ABILITY_KINDS: ReadonlySet<string> = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'chapter', 'classLevel', 'levelBracket', 'manual']);

const theExiledCard = (v: Rec): boolean => {
  const a = v['$anaphor'];
  return isRec(a) && a['sort'] === 'object' && a['number'] === 'singular' && a['participle'] === 'exiled' && a['text'] === 'the exiled card';
};

export function resolveStaticExiledCard(value: unknown): unknown | null {
  let found = 0;
  let blocked = false;
  const scan = (v: unknown, top: boolean): void => {
    if (blocked) return;
    if (Array.isArray(v)) { v.forEach((x) => scan(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return; // a nested ability's references are its own
    if (isRec(v['$anaphor'])) { if (theExiledCard(v)) found++; else blocked = true; return; }
    for (const k of Object.keys(v)) if (k.startsWith('$')) { blocked = true; return; }
    for (const x of Object.values(v)) scan(x, false);
  };
  scan(value, true);
  if (blocked || found === 0) return null;
  const replace = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => replace(x, false));
    if (!isRec(v)) return v;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return v;
    if (theExiledCard(v)) return { ref: 'linked', link: 'exiled' };
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) out[k] = replace(x, false);
    return out;
  };
  return clone(replace(value, true));
}
