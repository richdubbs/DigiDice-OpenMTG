/**
 * edh-next-121 (CR 400.7, 400.7j, 608.2c; Ral, Monsoon Mage: "If you win the flip, you may exile Ral. If you do, return him to the battlefield transformed under his owner's control."):
 * an instruction that moves the object itself (`{ref: 'self'}`) to a public zone (exile, a graveyard) makes it a new object (CR 400.7), which the other parts of the same effect can
 * still find (CR 400.7j). A LATER instruction of the same ability that moves "~" / "him" / "it" again means that new object, not the permanent that left: this pass names the first
 * move (`as`) and points every later `move` of `{ref: 'self'}` at that name, the way the one-sentence template of r3-fx does ("Exile ~, then return ~ to the battlefield transformed
 * under ~'s owner's control", eff.r3fx.exile.self.returnTransformed.selfOwner). Only moves are rewritten (a damage source or a count keeps reading ~ as before); a move made by a
 * cost (`{ref: 'self'}` of a cost is costMovedSelf's) is no instruction here.
 */
import type { Rec, Unit } from './types';
import { isRec } from './util';

const PUBLIC_DEST = new Set(['exile', 'graveyard']);
const isSelf = (v: unknown): boolean => isRec(v) && v['ref'] === 'self' && Object.keys(v).length === 1;

/** The lists of instructions nested in a step (never an ability a step creates or grants: its "~" is another object, a token's or a delayed trigger's own). */
const NESTED = ['do', 'then', 'else', 'onWin', 'onLose', 'onTails', 'afterRoll', 'otherwise'] as const;

/** The steps of a list in the order they are written (a step before the steps nested in it). */
function stepsInOrder(v: unknown, out: Rec[]): void {
  if (!Array.isArray(v)) return;
  for (const s of v) {
    if (!isRec(s) || typeof s['op'] !== 'string') continue;
    out.push(s);
    // a delayed or reflexive triggered ability is an ability of its own (CR 603.7, 603.12), not another part of this effect (CR 400.7j): its "~" is not followed here
    if (s['op'] === 'delay' || s['op'] === 'reflexive') continue;
    for (const k of NESTED) stepsInOrder(s[k], out);
    if (Array.isArray(s['table'])) for (const r of s['table']) if (isRec(r)) stepsInOrder(r['do'], out);
  }
}

export function bindSelfMovedAgain(seq: Unit[]): void {
  const all: Rec[] = [];
  for (const u of seq) if (u.manual === undefined) stepsInOrder(u.steps, all);
  const used = new Set(all.map((s) => s['as']).filter((n): n is string => typeof n === 'string'));
  let fresh = 'selfMoved';
  for (let k = 2; used.has(fresh); k++) fresh = `selfMoved${k}`;
  // review fix: only along ONE path of the instructions. Alternatives (the rows of a table, the results of a flip, the two sides of an `if`) each start from the state before
  // them and never pass a name to each other or to what follows them; an option's own instructions (`may`) do pass it on (a later "If you do" reads what the option bound)
  type State = { name: string | null; first: Rec | null };
  const usedFirst = new Set<Rec>();
  const walk = (list: unknown, st: State): State => {
    if (!Array.isArray(list)) return st;
    let cur = st;
    for (const s of list) {
      if (!isRec(s) || typeof s['op'] !== 'string') continue;
      if (s['op'] === 'move' && isSelf(s['what'])) {
        const to = isRec(s['to']) ? s['to']['zone'] : undefined;
        if (cur.name !== null) { s['what'] = { ref: 'bound', name: cur.name }; if (cur.first !== null) usedFirst.add(cur.first); }
        else if (typeof to === 'string' && PUBLIC_DEST.has(to)) cur = { name: typeof s['as'] === 'string' ? s['as'] : fresh, first: s };
        continue;
      }
      if (s['op'] === 'delay' || s['op'] === 'reflexive') continue;
      if (s['op'] === 'may') { cur = walk(s['do'], cur); continue; }
      for (const k of NESTED) walk(s[k], cur);
      if (Array.isArray(s['table'])) for (const r of s['table']) if (isRec(r)) walk(r['do'], cur);
    }
    return cur;
  };
  walk(seq.filter((u) => u.manual === undefined).flatMap((u) => u.steps), { name: null, first: null });
  for (const x of usedFirst) if (x['as'] === undefined) x['as'] = fresh;
}

/**
 * edh-next-121 (CR 608.2c, 601.2, 400.7h; Kefka, Dancing Mad: "You may cast any number of spells from among cards exiled this way without paying their mana costs. Then each player who
 * owns a spell you cast this way loses life equal to its mana value."): "a spell you cast this way" (template eff.edhn121.eachOwnerOfCastSpell.losesLife.manaValue, the mark
 * `@castThisWay`) names the spells the ONE earlier free cast of the ability cast: the choice it cast from, which then holds only the spells actually cast (`dropUncast`, the cast
 * handler rebases each card to the spell it became, CR 400.7h). Fail closed: with no such cast, or several, the mark stays and the lint refuses it.
 */
export function bindCastThisWay(seq: Unit[]): void {
  const all: Rec[] = [];
  for (const u of seq) if (u.manual === undefined) stepsInOrder(u.steps, all);
  // edh-d-97 (CR 400.7a, 400.7h, 611.2c; Strago and Relm: "You may cast that card without paying its mana cost. If you cast a creature spell this way, it gains haste and ..."): a lasting
  // effect on "a creature spell you cast this way" (template eff.edhd97.creatureCastThisWay.gains: `affects` each object of the mark that is a creature spell) names the spell the ONE
  // earlier optional free cast of yours cast (the cast binds it under its `as`, effects/handlers/tokens-cast.ts). Fail closed: with no such cast, or several, the mark stays and the lint refuses it
  for (const s of all) {
    const eff = s['effects'];
    if (s['op'] !== 'effect' || !Array.isArray(eff)) continue;
    for (const e of eff) {
      const affects = isRec(e) ? e['affects'] : undefined;
      const filter = isRec(affects) ? affects['filter'] : undefined;
      const is = isRec(filter) ? filter['is'] : undefined;
      if (!isRec(affects) || affects['ref'] !== 'each' || !isRec(filter) || !isRec(is) || is['ref'] !== 'bound' || is['name'] !== '@castThisWay') continue;
      const before = all.slice(0, all.indexOf(s)).filter((x) => x['op'] === 'cast');
      const cast = before.length === 1 ? before[0]! : undefined;
      if (cast === undefined || cast['free'] !== true || cast['optional'] !== true || cast['copyIn'] !== undefined || !isRec(cast['who']) || cast['who']['ref'] !== 'you') continue;
      if (typeof cast['as'] !== 'string') {
        const taken = new Set(all.map((x) => x['as']).filter((n) => typeof n === 'string'));
        let n = 'castThisWay';
        for (let k = 2; taken.has(n); k++) n = `castThisWay${k}`;
        cast['as'] = n;
      }
      filter['is'] = { ref: 'bound', name: cast['as'] };
    }
  }
  for (const s of all) {
    const over = s['over'];
    if (s['op'] !== 'forEach' || !isRec(over) || over['ref'] !== 'bound' || over['name'] !== '@castThisWay') continue;
    const before = all.slice(0, all.indexOf(s)).filter((x) => x['op'] === 'cast');
    const cast = before.length === 1 ? before[0]! : undefined;
    const what = cast?.['what'];
    if (cast === undefined || cast['free'] !== true || !isRec(what) || what['ref'] !== 'bound' || typeof what['name'] !== 'string') continue;
    if (!all.some((x) => x['op'] === 'chooseObjects' && x['as'] === what['name'])) continue;
    cast['dropUncast'] = true;
    s['over'] = { ref: 'bound', name: what['name'] };
  }
}
