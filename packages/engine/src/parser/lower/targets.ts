/**
 * Pass 2, targets (design 6.5): every target phrase the hole grammars marked (`$target`, parser/holes/core.ts) becomes a `TargetSpec` and the use becomes
 * `{ref:'target', id}`. Owner: WP17. Rules: CR 115.1 (targets are announced as the spell or ability is put on the stack), CR 601.2c (the number of targets
 * is announced first; "up to N" is min 0), CR 115.3 ("another target" must differ from the other targets), CR 115.4 ("any target"), CR 601.2d (a divided
 * effect: the division is announced with the targets), CR 608.2b (one legality check over the targets of every chosen mode, so ids are unique across the
 * WHOLE ability, modal bullets included, design 1.1.6).
 *
 * Order: word order. Inside a sentence the build of a template may list its holes in any order, so each phrase is located in the sentence's tokens and the
 * specs are numbered by position (t0, t1, ...). The same phrase used twice by one build (one hole, two uses) is ONE target. A phrase the pass cannot place
 * unambiguously makes the sentence manual.
 *
 * A target inside a conditional sentence whose condition is known at announcement ("if this spell was kicked", CR 601.2c, 607.2i) gets `onlyIf`.
 */
import type { Condition, Quantity, TargetSpec } from '../../types/ability';
import type { TargetPhrase } from '../holes/core';
import { canonicalJson } from '../holes/core';
import { spanText, type Tok } from '../holes/tok';
import type { Draft, Rec, Unit } from './types';
import { clone, cloneDraft, freshName, isRec, rewrite, sequences, setManual, visit } from './util';

interface Found { path: string; phrase: TargetPhrase; key: string; onlyIf?: Condition; doc: number }

/** Markers of one value in document order, with the `wasCast` condition of the `if` steps around them. */
function markersOf(value: unknown): Found[] {
  const out: Found[] = [];
  const walk = (v: unknown, path: string, conds: Condition[]): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}/${i}`, conds)); return; }
    if (!isRec(v)) return;
    if (isRec(v['$target'])) {
      const phrase = v['$target'] as unknown as TargetPhrase;
      const known = conds.filter((c) => c.cond === 'wasCast');
      const onlyIf: Condition | undefined = known.length === 0 ? undefined : known.length === 1 ? known[0] : { cond: 'all', of: known };
      out.push({ path, phrase, key: canonicalJson(phrase), doc: out.length, ...(onlyIf ? { onlyIf } : {}) });
      return;
    }
    if (v['op'] === 'if' && isRec(v['cond'])) {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}/${k}`, k === 'then' ? [...conds, v['cond'] as Condition] : conds);
      return;
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${path}/${k}`, conds);
  };
  walk(value, '', []);
  return out;
}

/** Start positions (token index) of `text` in the unit, by the same spelling the hole grammars used (parser/holes/tok.ts#spanText). */
function occurrences(tokens: readonly Tok[], text: string): [number, number][] {
  const out: [number, number][] = [];
  const want = text.toLowerCase();
  for (let a = 0; a < tokens.length; a++) {
    for (let b = a + 1; b <= Math.min(tokens.length, a + 32); b++) { // FAST5 T42: 32 tokens ("target creature card with mana value less than or equal to ~'s power from your graveyard")
      if (spanText(tokens, a, b).toLowerCase() === want) { out.push([a, b]); break; }
    }
  }
  return out;
}

/** "Target creature" at the start of a sentence is still the prompt "target creature" (display data, design 13). */
const promptText = (t: string): string => (t.length > 0 && !t.startsWith('~') ? t[0]!.toLowerCase() + t.slice(1) : t);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * T20 (FAST4): CR 701.41a, "Support N on a permanent means 'Put a +1/+1 counter on each of up to N other target creatures.' Support N on an instant or
 * sorcery spell means '... up to N target creatures.'" "Other" (other than this object, CR 109.2) is written only when this object could be a creature
 * (parser `selfHeads`): on an instant, a sorcery or a permanent that is never a creature it excludes nothing.
 */
function supportStep(n: unknown, heads: readonly string[]): Rec | undefined {
  const isX = isRec(n) && n['q'] === 'X' && Object.keys(n).length === 1;
  if (!(typeof n === 'number' && Number.isInteger(n) && n >= 1) && !isX) return undefined; // left as an intermediate node: the sentence is manual
  const spell = heads.includes('instant') || heads.includes('sorcery');
  const other = !spell && couldBeSource({ types: ['Creature'] }, heads);
  const words = typeof n === 'number' ? (NUMBER_WORDS[n] ?? String(n)) : 'X';
  const phrase: TargetPhrase = {
    kind: 'object', filter: { types: ['Creature'], ...(other ? { other: true } : {}) }, min: 0, max: clone(n) as number | Quantity,
    text: `up to ${words} ${other ? 'other ' : ''}target ${n === 1 ? 'creature' : 'creatures'}`, locate: 'support',
  };
  return { op: 'action', action: 'support', who: { ref: 'you' }, n: clone(n), subject: { ref: 'target', id: '', $target: phrase as unknown as Rec } };
}

/**
 * FAST5 MX6: CR 701.66a, "'Earthbend N' means 'Target land you control becomes a 0/0 land creature with haste ...'": the target is implied by the action, placed
 * at the word "earthbend" (`locate`); each "earthbend" of a sentence is a target of its own (CR 115.3: the same land may be chosen for each).
 */
function earthbendStep(n: unknown): Rec | undefined {
  const isX = isRec(n) && n['q'] === 'X' && Object.keys(n).length === 1;
  if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0) && !isX && !isRec(n)) return undefined; // left as an intermediate node: the sentence is manual
  const phrase: TargetPhrase = { kind: 'object', filter: { types: ['Land'], controller: 'you' }, min: 1, max: 1, text: 'target land you control', locate: 'earthbend' };
  return { op: 'action', action: 'earthbend', who: { ref: 'you' }, n: clone(n), subject: { ref: 'target', id: '', $target: phrase as unknown as Rec } };
}

/** T20 (FAST4): expand the intermediate node `{"lower": "support", "n": N}` of the template "support N" wherever it is (inside "if you do" too). FAST5 MX6: and
 * `{"lower": "earthbend", "n": N}` of "earthbend N". */
function expandSupport(steps: Rec[], heads: readonly string[]): Rec[] {
  return rewrite(steps, (node) => (node['lower'] === 'support' ? supportStep(node['n'], heads) : node['lower'] === 'earthbend' ? earthbendStep(node['n']) : undefined)) as Rec[];
}

function specOf(id: string, ph: TargetPhrase, earlier: TargetSpec[], onlyIf: Condition | undefined): TargetSpec {
  const spec: TargetSpec = { id, kind: ph.kind, min: clone(ph.min), max: clone(ph.max), text: promptText(ph.text) };
  if (ph.filter) spec.filter = clone(ph.filter);
  if (ph.players) spec.players = clone(ph.players);
  if (ph.another) {
    // CR 115.3: "another target" differs from the earlier targets of its own instruction sequence (the main program or ONE modal bullet: the other
    // bullets may not be chosen, CR 700.2); with none it means "other than this object" (CR 109.2)
    if (earlier.length > 0) spec.distinctFrom = earlier.map((s) => s.id);
    else spec.filter = { ...(spec.filter ?? {}), other: true };
  }
  if (ph.sameOwner === true) spec.sameOwner = true; // FAST3 T14: "from a single graveyard" (CR 115.1)
  if (ph.differentNames === true) spec.differentNames = true; // FAST5 T42: "with different names" (CR 201.2, 115.1)
  if (ph.groupLimit !== undefined) spec.groupLimit = clone(ph.groupLimit); // FAST5 T66: "with total mana value 6 or less" (CR 115.1, 601.2c)
  if (ph.perOpponent === true) spec.perOpponent = true; // FAST5 T66: "for each opponent, ... that player controls" (CR 115.1, 601.2c)
  if (ph.perPlayer === true) spec.perPlayer = true; // r5-fxb: "for each player, ... that player controls" (CR 115.1, 601.2c)
  if (ph.sharedCardType === true) spec.sharedCardType = true; // FAST5 T66: "that share a card type" (CR 205.2a, 115.1)
  if (ph.sharedCreatureType === true) spec.sharedCreatureType = true; // CLOUD std-ecl: "that share a creature type" (CR 205.3m, 115.1)
  if (ph.differentControllers === true) spec.differentControllers = true; // CLOUD std-tmt: "controlled by different players" (CR 115.1, 110.2)
  if (ph.sameController === true) spec.sameController = true; // std-rx30: "controlled by the same opponent" (CR 115.1, 110.2)
  if (ph.perCardType === true) spec.perCardType = true; // std-cardcopy-7: "of each card type" (CR 115.1, 205.2a)
  if (ph.random === true) spec.random = true; // p2-damage-2: "chosen at random" (CR 601.2c, 603.3d)
  if (onlyIf) spec.onlyIf = clone(onlyIf);
  return spec;
}

/** Number the target phrases of one unit; returns false when they cannot be placed (the unit becomes manual). `earlier`: the targets of the sequence so far. */
function numberUnit(u: Unit, d: Draft, earlier: TargetSpec[]): boolean {
  u.steps = expandSupport(u.steps, d.selfHeads);
  const steps = markersOf(u.steps);
  const rider = u.rider ? markersOf(u.rider.patch) : [];
  const all = [...steps.map((f) => ({ ...f, where: 'steps' as const })), ...rider.map((f) => ({ ...f, where: 'rider' as const }))];
  if (all.length === 0) return true;
  // positions in word order
  const byText = new Map<string, typeof all>();
  // T20 (FAST4): a target a keyword action implies is placed at the words of the action (`locate`, "support 2", CR 701.41a)
  for (const f of all) { const k = (f.phrase.locate ?? f.phrase.text).toLowerCase(); byText.set(k, [...(byText.get(k) ?? []), f]); }
  const pos = new Map<(typeof all)[number], number>();
  // longer phrases first: "target creature" inside "another target creature" is not an occurrence of its own
  const claimed: [number, number][] = [];
  for (const [text, fs] of [...byText].sort((a, b) => b[0].length - a[0].length)) {
    const occ = occurrences(u.tokens, text).filter(([a, b]) => !claimed.some(([x, y]) => a < y && b > x));
    if (occ.length === 0) return false;
    if (occ.length === fs.length) fs.forEach((f, i) => pos.set(f, occ[i]![0]));
    else if (occ.length === 1) fs.forEach((f) => pos.set(f, occ[0]![0]));
    else return false;
    claimed.push(...occ);
  }
  const ordered = [...all].sort((a, b) => pos.get(a)! - pos.get(b)! || a.doc - b.doc);
  const idAt = new Map<number, { id: string; key: string }>();
  const ids = new Map<(typeof all)[number], string>();
  for (const f of ordered) {
    const p = pos.get(f)!;
    const seen = idAt.get(p);
    if (seen) {
      if (seen.key !== f.key) return false; // two different phrases at one place: not a reading the pass can trust
      ids.set(f, seen.id);
      continue;
    }
    const id = `t${d.targets.length}`;
    const spec = specOf(id, f.phrase, earlier, f.onlyIf);
    d.targets.push(spec);
    earlier.push(spec);
    u.targetIds = [...(u.targetIds ?? []), id];
    u.targetPos = { ...(u.targetPos ?? {}), [id]: p };
    idAt.set(p, { id, key: f.key });
    ids.set(f, id);
  }
  const replace = (value: unknown, where: 'steps' | 'rider'): unknown => rewrite(value, (node, path) => {
    if (!isRec(node['$target'])) return undefined;
    const f = all.find((x) => x.where === where && x.path === path);
    return f ? { ref: 'target', id: ids.get(f)! } : undefined;
  });
  u.steps = replace(u.steps, 'steps') as Rec[];
  if (u.rider) u.rider = { ...u.rider, patch: replace(u.rider.patch, 'rider') as Rec };
  return true;
}

/** CR 601.2d: a step that divides its amount among its targets marks their spec with the total. */
function markDivisions(d: Draft): void {
  for (const seq of sequences(d)) for (const u of seq) {
    rewrite(u.steps, (node) => {
      const to = node['to'];
      if (node['op'] === 'damage' && node['divided'] === 'announced' && isRec(to) && to['ref'] === 'target') {
        const spec = d.targets.find((s) => s.id === to['id']);
        if (spec && !spec.divide) spec.divide = { what: 'damage', total: clone(node['amount']) as Quantity };
      }
      return undefined;
    });
    // FAST4 T28 (CR 601.2d): "distribute two +1/+1 counters among one or two target creatures": a template wraps its putCounters step in the intermediate node
    // `{"lower": "divide", "step": <putCounters>}`; the step takes its place here and the target spec gets the total (effects/handlers/counters.ts#putShares
    // reads the announced shares). On anything but the targets of the step the division has no meaning: the sentence is manual (a node left behind is
    // refused by lower/normalize.ts too, lower/util.ts#leftoverMarker)
    if (u.manual) continue;
    let refused = false;
    u.steps = rewrite(u.steps, (node) => {
      if (node['lower'] !== 'divide') return undefined;
      const step = node['step'];
      const on = isRec(step) ? step['on'] : undefined;
      const spec = isRec(step) && step['op'] === 'putCounters' && isRec(on) && on['ref'] === 'target' ? d.targets.find((s) => s.id === on['id']) : undefined;
      if (!isRec(step) || !spec || spec.divide || spec.kind !== 'object') { refused = true; return undefined; }
      spec.divide = { what: 'counters', total: clone(step['count']) as Quantity };
      return step;
    }) as Rec[];
    if (refused) setManual(u, { code: 'ambiguous', reason: 'counters to distribute need the targets of the same instruction (CR 601.2d)' });
  }
}

/**
 * Could the object this ability is on match `f`? Decided from its printed card types and subtypes (`selfHeads`), and only ever "no" when that is certain:
 * a filter whose types or subtypes it has none of (a Vehicle can become a creature, CR 301.7b), anything but a spell for an instant or sorcery.
 */
export function couldBeSource(f: Rec, heads: readonly string[]): boolean {
  const any = f['anyOf'];
  if (Array.isArray(any) && any.length > 0 && !any.some((x) => isRec(x) && couldBeSource(x, heads))) return false;
  const words = (k: string): string[] => (Array.isArray(f[k]) ? (f[k] as unknown[]).map((x) => String(x).toLowerCase()) : []);
  const types = words('types');
  const can = (t: string): boolean => heads.includes(t) || (t === 'creature' && heads.includes('vehicle'));
  if (types.length > 0 && !types.some(can)) return false;
  const subtypes = words('subtypes');
  if (subtypes.length > 0 && !subtypes.some((t) => heads.includes(t))) return false;
  if ((heads.includes('instant') || heads.includes('sorcery')) && f['zone'] !== 'stack') return false;
  return true;
}

/**
 * CR 109.2, 115.3: "other" / "another" with no earlier target is written `other: true`, "other than this object". When this object can never match the
 * description ("up to one other target creature card from your graveyard" on an enchantment, "each other Goblin you control" on a sorcery), the word means
 * something else (the creature that died, the token just created) and `other: true` would describe a superset: the engine never approximates legality
 * (design 6.6), so the sentence is manual. Returns the reason, or null. WP21 review (INTERFACE CHANGE of this WP17 file).
 */
function otherNotSource(u: Unit, d: Draft, specs: readonly TargetSpec[], prior: readonly Unit[] = []): string | null {
  const filters: Rec[] = specs.flatMap((s) => (isRec(s.filter) ? [s.filter as unknown as Rec] : []));
  const collect = (v: unknown): void => visit(v, (node) => {
    if (typeof node['kind'] === 'string' && typeof node['text'] === 'string' && node['id'] === undefined) return false; // a nested ability (not a TargetSpec) has a source of its own
    // W3 integration (WP22 review, CR 608.2c): "target X and each other X ..." is a union with the target, which is in the set whether "other" excludes it or
    // not; what "other" means there is decided by the anaphora pass (anaphora.ts#anaphoricOther: automated in a spell, manual on a permanent)
    if (node['ref'] === 'union' && Array.isArray(node['of']) && node['of'].some((x) => isRec(x) && x['ref'] === 'target')) return false;
    // r4-static / r4-fxz (wave 7 merge, CR 601.2i, 109.2): the spell of a cast event ("you've cast another <kind> spell this turn", in a condition or a count) is on
    // the stack as it is cast, so its "other" can be other than this spell when this is an instant or sorcery (couldBeSource with zone stack)
    if (node['ev'] === 'cast' && isRec(node['spell']) && node['spell']['other'] === true) {
      filters.push({ ...node['spell'], zone: 'stack' });
      return false;
    }
    if (node['other'] === true && typeof node['op'] !== 'string') filters.push(node);
  });
  collect(u.steps);
  if (u.rider) collect(u.rider.patch);
  // FAST5 T47: a land that animates itself is a creature while it attacks (CR 613.1d, 301.7b): "other creatures" there is "other than this object"
  const heads = d.animates === true ? [...d.selfHeads, 'creature'] : d.selfHeads;
  // Standard round 4, r4-refs (CR 603.10a, 400.7, 109.2): "Whenever a creature you control with an impostor counter on it dies, exile it. Return up to one other target
  // creature card from your graveyard to the battlefield.": on a trigger of ONE event that moves another described object (never this one) into a zone, an "other"
  // target in that same zone that this object can never be is other than the card the event put there (`not: {is: <the event's object>}`), the one other object
  // the words can mean. Only for a target's own description, with no `not` of its own, and only once an earlier sentence of the ability has moved that object
  // out of the zone ("exile it"): without one, "other" stays manual (the pinned m5/templates/review.test.ts case, "Whenever a creature you control dies, return
  // up to one other target creature card from your graveyard to your hand")
  const ev1 = d.trigger?.on.length === 1 ? d.trigger.on[0] : undefined;
  if (ev1?.ev === 'zoneChange' && ev1.subject.self !== true && ev1.to !== undefined && !couldBeSource(ev1.subject as unknown as Rec, heads)) {
    const into = Array.isArray(ev1.to) ? ev1.to : [ev1.to];
    // the object moved is the event's, or "it" (not resolved yet in this pass) while no earlier sentence has a target, so the event's object is the one thing named
    const noTargets = prior.every((p) => (p.targetIds?.length ?? 0) === 0);
    const theEventsObject = (w: Rec): boolean => (w['ref'] === 'event' && w['role'] === 'subject')
      || (noTargets && isRec(w['$anaphor']) && w['$anaphor']['sort'] === 'object' && w['$anaphor']['number'] === 'singular' && w['$anaphor']['text'] === 'it');
    const movedOut = (zone: string): boolean => prior.some((p) => p.manual === undefined && p.steps.some((st) => isRec(st) && st['op'] === 'move' && st['guard'] === undefined
      && isRec(st['what']) && theEventsObject(st['what']) && isRec(st['to']) && st['to']['zone'] !== zone));
    for (const s of specs) {
      const f = isRec(s.filter) ? (s.filter as unknown as Rec) : null;
      if (f === null || f['other'] !== true || f['not'] !== undefined || typeof f['zone'] !== 'string' || !into.includes(f['zone'] as never) || couldBeSource(f, heads)) continue;
      if (!movedOut(f['zone'])) continue;
      delete f['other'];
      f['not'] = { is: { ref: 'event', role: 'subject' } };
    }
  }
  // std-rB (CR 608.2c, 109.2, 115.3): "Put a +1/+1 counter on target creature you control. If this spell was cast from a graveyard, also put a +1/+1 counter on each
  // other creature you control.": in an instant or sorcery, which is never in the group, "other" in a sentence with no target of its own excludes what an earlier
  // sentence named; with exactly one earlier target, of one object, and every earlier sentence understood, that target is the one candidate (unique-candidate
  // rule, design 6.4): `not: {is: <that target>}`. Only a group's own description with no `not` of its own
  const spell = heads.includes('instant') || heads.includes('sorcery');
  const priorIds = prior.flatMap((p) => p.targetIds ?? []);
  const only = priorIds.length === 1 ? d.targets.find((s) => s.id === priorIds[0]) : undefined;
  if (spell && specs.length === 0 && prior.length > 0 && prior.every((p) => p.manual === undefined) && only?.kind === 'object' && only.max === 1 && !u.rider) {
    for (const f of filters) {
      if (f['other'] !== true || f['not'] !== undefined || couldBeSource(f, heads)) continue;
      delete f['other'];
      f['not'] = { is: { ref: 'target', id: only.id } };
    }
  }
  // std-rx32 (CR 109.2, 111.1, 608.2c): "Create a token that's a copy of it, except it's a Nightmare in addition to its other types. Then exile all other Nightmare
  // tokens you control." (Abyssal Harvester): a group of TOKENS that this object can never be, right after a sentence whose last instruction created exactly one
  // token, leaves out that token: the one object the words can mean (unique-candidate rule, design 6.4). The token is bound by that instruction (`as`). Only with
  // every earlier sentence understood and no target in this sentence
  const last = prior.length > 0 ? prior[prior.length - 1] : undefined;
  const lastStep = last !== undefined && last.manual === undefined && !last.rider ? last.steps[last.steps.length - 1] : undefined;
  const oneToken = isRec(lastStep) && ((lastStep['op'] === 'copy' && lastStep['result'] === 'token' && (lastStep['count'] === undefined || lastStep['count'] === 1))
    || (lastStep['op'] === 'createToken' && lastStep['count'] === 1));
  if (oneToken && specs.length === 0 && !u.rider && prior.every((p) => p.manual === undefined)) {
    for (const f of filters) {
      if (f['other'] !== true || f['token'] !== true || f['not'] !== undefined || couldBeSource(f, heads)) continue;
      const step = lastStep as Rec;
      if (typeof step['as'] !== 'string') {
        let name = 'made';
        for (let n = 2; d.names.includes(name) || prior.some((p) => JSON.stringify(p.steps).includes(`"as":"${name}"`)); n++) name = `made${n}`;
        step['as'] = name;
      }
      delete f['other'];
      f['not'] = { is: { ref: 'bound', name: step['as'] } };
    }
  }
  // std-library-2 (CR 608.2c, 109.2, 701.21a, 400.7): "Each player sacrifices a creature or planeswalker of their choice. If you sacrificed a permanent this way, you may
  // return another permanent card from your graveyard to your hand." (Deadly Brew): in an instant or sorcery, which is never in the group, "another" card in a
  // graveyard, in a sentence with no target of its own right after a sentence whose last instruction sacrificed, is other than what that sacrifice put into the
  // graveyard (the one other object the words can mean, unique-candidate rule, design 6.4): the sacrifice binds what it moved (effects/handlers/zones-util.ts#bindMoved,
  // the cards in the graveyard). Only with every earlier sentence understood
  const sacStep = isRec(lastStep) && (lastStep['op'] === 'sacrificeChoice' || lastStep['op'] === 'sacrifice') ? lastStep as Rec : undefined;
  const inGraveyard = (f: Rec): boolean => f['zone'] === 'graveyard'
    || (f['zone'] === undefined && Array.isArray(f['anyOf']) && f['anyOf'].length > 0 && f['anyOf'].every((x) => isRec(x) && x['zone'] === 'graveyard'));
  // audit-fix-1 (CR 701.21a, 608.2h, 400.7; unverified): "another" is other than what YOU sacrificed, not what every player did: after "each player sacrifices ...",
  // only the bound objects you controlled as they were sacrificed (`which`, effects/refs.ts). A sacrifice by "you" binds only yours; any other sacrificer (an
  // opponent, a target player, a `sacrifice` of a described group) is not read here, so the sentence stays manual (fail closed)
  const sacWho = sacStep?.['op'] === 'sacrificeChoice' ? JSON.stringify(sacStep['who']) : undefined;
  const sacWhich = sacWho === '{"ref":"you"}' ? null : sacWho === '{"ref":"each","who":"player"}' ? { controller: 'you' } : undefined;
  if (spell && sacStep !== undefined && sacWhich !== undefined && specs.length === 0 && !u.rider && prior.every((p) => p.manual === undefined)) {
    for (const f of filters) {
      if (f['other'] !== true || f['not'] !== undefined || !inGraveyard(f) || couldBeSource(f, heads)) continue;
      if (typeof sacStep['as'] !== 'string') {
        let name = 'sacrificed';
        for (let n = 2; d.names.includes(name) || prior.some((p) => JSON.stringify(p.steps).includes(`"as":"${name}"`)); n++) name = `sacrificed${n}`;
        sacStep['as'] = name;
      }
      delete f['other'];
      f['not'] = { is: { ref: 'bound', name: sacStep['as'], ...(sacWhich !== null ? { which: sacWhich } : {}) } };
    }
  }
  const bad = filters.find((f) => f['other'] === true && !couldBeSource(f, heads));
  if (bad) return '"other" cannot mean "other than this object" here (this object never matches the description), and nothing else says what it excludes (CR 109.2, 115.3)';
  // Cloud std-woe (CR 115.3, 109.2, 508.1k): "Whenever Amy Rose attacks, attach up to one target Equipment to her. Then up to one other target attacking creature gets
  // +X/+0": in this object's own attack trigger it is surely an attacking creature, so when every earlier target the phrase must differ from can never be this object,
  // "other" may as well mean "other than this object"; neither reading is sure, so the sentence is manual (never a superset of the legal targets)
  const ownAttack = d.trigger?.on.some((p) => p.ev === 'attacks' && isRec(p.attacker) && (p.attacker as Rec)['self'] === true) === true;
  const byId = new Map(d.targets.map((s) => [s.id, s]));
  for (const s of specs) {
    if (!ownAttack || s.kind !== 'object' || s.distinctFrom === undefined || s.distinctFrom.length === 0 || !isRec(s.filter) || (s.filter as unknown as Rec)['attacking'] !== true) continue;
    if (!couldBeSource(s.filter as unknown as Rec, heads)) continue;
    const before = s.distinctFrom.map((id) => byId.get(id));
    if (before.every((e) => e !== undefined && e.kind === 'object' && isRec(e.filter) && !couldBeSource(e.filter as unknown as Rec, heads))) {
      return '"other" may mean "other than this object" (which fits the description) or "other than the earlier target" (which never is this object) (CR 109.2, 115.3)';
    }
  }
  // FAST5 batch 8 integration (CR 603.10a, 400.7, 109.2): a trigger on an event that moves a described object (not this one) to a zone, and "another <card> from
  // <that zone>" in its effect ("Whenever a creature you control with a counter on it dies, you may return another target permanent card ... from your graveyard",
  // Puca's Covenant): "another" names the card the event put there, which `other: true` (other than this object) does not exclude; manual, never a superset
  const ev = d.trigger?.on.length === 1 ? d.trigger.on[0] : undefined;
  // (only where this object can never be the event's object: a creature's "this creature or another creature you control dies" is FAST5 T42's reading, unchanged)
  if (ev?.ev === 'zoneChange' && ev.subject.self !== true && ev.to !== undefined && !couldBeSource(ev.subject as unknown as Rec, heads)) {
    const to = Array.isArray(ev.to) ? ev.to : [ev.to];
    if (filters.some((f) => f['other'] === true && typeof f['zone'] === 'string' && to.includes(f['zone'] as never))) {
      return '"another" may name the card the trigger event moved to that zone, not only this object (CR 603.10a, 400.7, 109.2)';
    }
  }
  return null;
}

/**
 * Cloud std-eoe: the instructions a player does with an amount of their own (perPlayerAmounts). Wave 3 merge review: only instructions with no choice in them. A
 * discard by several players is simultaneous: each chooses in APNAP order, the chosen cards may stay face down until all have chosen, then all are discarded at
 * once (CR 101.4, 101.4a); one player at a time would show the earlier players' discards before a later player chooses, so "each discard" stays refused.
 */
const PER_PLAYER_OPS: ReadonlySet<string> = new Set(['mill', 'draw', 'loseLife', 'gainLife']);

/**
 * Cloud std-eoe (CR 115.1, 608.2c, 608.2e): "Then any number of target players each mill half their library, rounded down": an instruction done by several player
 * targets at once whose amount reads the same target ("their library", "their hand", "their life total") is one amount per player. The top-level instruction (mill,
 * draw, lose or gain life; no guard, no name) becomes a `forEach` over those targets, one player at a time, with the target read as that player
 * (render/steps-flow.ts says it as before, "... each mill ..."). Each player's amount reads only that player's own zone or life, which no other player's instruction
 * changes, so one at a time is the same as all at once. Anything else is left to lower/targets.ts#severalPlayersAmount, which refuses it.
 */
export function perPlayerAmounts(u: Unit, specs: readonly TargetSpec[], d: Draft): void {
  const many = new Set(specs.filter((s) => s.kind === 'player' && s.max !== 1).map((s) => s.id));
  if (many.size === 0) return;
  u.steps = u.steps.map((step) => {
    const who = step['who'];
    if (typeof step['op'] !== 'string' || !PER_PLAYER_OPS.has(step['op']) || step['guard'] !== undefined || step['as'] !== undefined || !isRec(who) || who['ref'] !== 'target' || !many.has(String(who['id']))) return step;
    const id = String(who['id']);
    const rest = JSON.stringify(Object.fromEntries(Object.entries(step).filter(([k]) => k !== 'who')));
    if (!rest.includes(JSON.stringify({ ref: 'target', id }))) return step;
    const name = freshName(d, 'player');
    const each = rewrite(step, (node) => (node['ref'] === 'target' && node['id'] === id && Object.keys(node).length === 2 ? { ref: 'bound', name } : undefined)) as Rec;
    return { op: 'forEach', over: { ref: 'target', id }, as: name, do: [each] } as Rec;
  });
}

/**
 * STD-OTJ (CR 115.1, 601.2c, 608.2c): "Any number of target players each mill cards equal to the number of cards in their graveyard": an instruction done by several
 * player targets at once whose amount reads the same target ("their graveyard", "their life total") has one amount per player, which the step (one `who` set, one
 * amount) cannot say, so the engine could not run it. Returns the reason, or null.
 */
export function severalPlayersAmount(u: Unit, specs: readonly TargetSpec[]): string | null {
  const many = new Set(specs.filter((s) => s.kind === 'player' && s.max !== 1).map((s) => s.id));
  if (many.size === 0) return null;
  const reads = (v: unknown, id: string): boolean => (Array.isArray(v) ? v.some((x) => reads(x, id)) : isRec(v) && ((v['ref'] === 'target' && v['id'] === id) || Object.values(v).some((x) => reads(x, id))));
  let bad = false;
  const scan = (v: unknown): void => visit(v, (node) => {
    const who = node['who'];
    if (typeof node['op'] === 'string' && isRec(who) && who['ref'] === 'target' && typeof who['id'] === 'string' && many.has(who['id'])) {
      if (Object.entries(node).some(([k, x]) => k !== 'who' && reads(x, who['id'] as string))) bad = true;
    }
  });
  scan(u.steps);
  if (u.rider) scan(u.rider.patch);
  return bad ? 'an amount that reads each of several player targets ("their graveyard") is one amount per player, which one step cannot say (CR 601.2c, 608.2c)' : null;
}

/**
 * FAST5 T50 (CR 603.7, 603.3d): the targets of a delayed triggered ability are chosen when IT is put on the stack, after it triggers; the `delay` step holds no
 * target specs, and a phrase inside its instructions would be announced with the spell or ability that creates it, a different moment and a different
 * choice. A `delay` that waits for an event and has such a phrase makes the sentence manual (the step-timed delays of the older templates keep their reading).
 */
function targetsInEventDelay(value: unknown): boolean {
  let found = false;
  // std-tdm (CR 603.7, 603.3d): a delay that is a step of the sentence itself (not inside another instruction) takes its targets with it (`delay.targets`,
  // parser/lower/conditions.ts#lowerDelayTargets), chosen when it is put on the stack; only a delay inside another instruction is refused here
  const top = new Set<unknown>(Array.isArray(value) ? value : []);
  visit(value, (node) => {
    if (node['op'] === 'delay' && isRec(node['when']) && node['when']['at'] === 'event' && markersOf(node['do']).length > 0 && !top.has(node)) found = true;
  });
  return found;
}

/**
 * Standard round 3, r3-fx (CR 603.7, 603.3d): "At the beginning of the next end step, destroy target creature." The delayed triggered ability chooses its targets
 * when IT is put on the stack, not when the spell that creates it is cast, and the step-timed `delay` carries no target specs. The lead templates of a step-timed
 * delay (dl.nextEnd.lead, dl.yourNextEnd.lead, stable since r3-fx) whose instructions announce a target therefore make the sentence manual: its target is never
 * announced with the creating ability (the tail form "... at the beginning of the next end step" keeps its older reading, guard G10).
 */
const STEP_DELAY_LEADS: ReadonlySet<string> = new Set(['dl.nextEnd.lead', 'dl.yourNextEnd.lead']);
/**
 * std-library-1 (CR 603.7, 603.3d): the leads whose delay takes the targets its own instructions announce (`delay.targets`, parser/lower/conditions.ts#lowerDelayTargets;
 * std-tdm's engine support is not tied to the kind of delay): "At the beginning of the next combat phase this turn, target creature you control deals damage equal to its
 * power to up to one target creature you don't control." (Feral Encounter). Only a delay that is a step of the sentence itself; the end step leads above stay refused
 * (train-1 bounce: Swooping Pteranodon's earlier "that creature" then saw the delayed sentence's target as a second antecedent).
 */
export const STEP_DELAY_TARGET_LEADS: ReadonlySet<string> = new Set(['dl.stdlib1.nextCombat.thisTurn.lead']);
function targetsInStepDelayLead(u: Unit): boolean {
  const own = u.templates.some((t) => STEP_DELAY_TARGET_LEADS.has(t));
  if (!own && !u.templates.some((t) => STEP_DELAY_LEADS.has(t))) return false;
  let found = false;
  const top = new Set<unknown>(u.steps);
  visit(u.steps, (node) => {
    if (node['op'] === 'delay' && isRec(node['when']) && node['when']['at'] === 'step' && markersOf(node['do']).length > 0 && !(own && top.has(node) && node['when']['step'] === 'beginCombat')) found = true;
  });
  return found;
}

/**
 * p2-replace-events-2 (CR 614.1a, 115.1, 603.3d by analogy): "{1}: The next time you would draw a card this turn, this enchantment deals 2 damage to any target
 * instead." (Words of War): the instructions a replacement effect performs instead of the event are performed when it applies, so a target they name would be
 * chosen then, not when the ability that creates the effect is activated; the engine announces targets with the creating ability only. Such a sentence is refused
 * (manual), as a target inside a delayed triggered ability's instructions is above.
 */
function targetsInReplacementSteps(value: unknown): boolean {
  let found = false;
  visit(value, (node) => {
    const b = node['s'] === 'replace' && isRec(node['body']) ? node['body'] : undefined;
    if (b !== undefined && (b['b'] === 'instead' || b['b'] === 'insteadThen') && markersOf(b['do']).length > 0) found = true;
  });
  return found;
}

/** Pass 2. */
export function lowerTargets(input: Draft): Draft {
  const d = cloneDraft(input);
  for (const seq of sequences(d)) {
    const earlier: TargetSpec[] = [];
    for (const [ui, u] of seq.entries()) {
      if (u.manual) continue;
      if (targetsInEventDelay(u.steps) || targetsInStepDelayLead(u)) { setManual(u, { code: 'ambiguous', reason: 'a target of a delayed triggered ability is chosen when it triggers, not when it is created (CR 603.7, 603.3d)' }); continue; }
      if (targetsInReplacementSteps(u.steps)) { setManual(u, { code: 'ambiguous', reason: 'a target of a replacement effect\'s instructions is chosen when it applies, not when the effect is created (CR 614.1a)' }); continue; }
      const before = d.targets.length;
      const mark = earlier.length;
      const saved = { steps: u.steps, rider: u.rider, ids: u.targetIds, pos: u.targetPos };
      const placed = numberUnit(u, d, earlier);
      if (placed) perPlayerAmounts(u, d.targets.slice(before), d); // Cloud std-eoe: one player at a time, where it can be said so
      const other = placed ? otherNotSource(u, d, d.targets.slice(before), seq.slice(0, ui)) ?? severalPlayersAmount(u, d.targets.slice(before)) : null;
      if (!placed || other !== null) {
        // a target that cannot be described is not announced either (design 6.6)
        d.targets.length = before;
        earlier.length = mark;
        u.steps = saved.steps;
        if (saved.rider) u.rider = saved.rider;
        if (saved.ids) u.targetIds = saved.ids; else delete u.targetIds;
        if (saved.pos) u.targetPos = saved.pos; else delete u.targetPos;
        setManual(u, other !== null ? { code: 'ambiguous', reason: other } : { code: 'ambiguous', reason: 'a target phrase could not be placed in the sentence (CR 601.2c)' });
      }
    }
  }
  markDivisions(d);
  return d;
}
