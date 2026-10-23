/**
 * What a spell or ability does, read from its ability model (types/ability.ts): which targets it hurts or helps, how much damage it deals, whether it draws,
 * makes tokens or sweeps the board. Card behavior is data, so one reader serves every card; text the engine does not understand (`manual` nodes) is
 * reported as such and the bot does not play it for its effect (a manual effect would only be resolved by hand, design section 10).
 */
import type { AbilityDef, EffectProgram, EffectStep, Modification, ObjectFilter, ObjRef, PlayerRef, Quantity, Ref, StaticEffect, TargetSpec } from '@openmtg/engine';

export type Polarity = 'harm' | 'help';
export type UseKind =
  | 'damage' | 'destroy' | 'exile' | 'bounce' | 'counter' | 'debuff' | 'restrict' | 'steal' | 'tap' | 'discard' | 'loseLife' | 'mill' | 'sacrifice'
  | 'pump' | 'grant' | 'untap' | 'return' | 'reanimate' | 'draw' | 'gainLife' | 'counters' | 'attach' | 'fight' | 'other';

export interface TargetUse {
  spec: TargetSpec;
  polarity: Polarity;
  kind: UseKind;
  /** Damage dealt to the target (`damage`), the toughness change (`pump` / `debuff`), or the cards the target player draws (`draw`). */
  amount: number;
  power: number;
  /** The use is inside "you may" (CR 608.2d, 603.5): the bot can still decline it on resolution. */
  optional?: boolean;
  /** What the target player sacrifices ("target player sacrifices a creature", CR 701.21a). */
  filter?: ObjectFilter;
}

export interface Summary {
  uses: TargetUse[];
  /** Cards the controller draws ("draw two cards"). */
  draws: number;
  /** Cards the controller draws because every player draws ("each player draws a card"): no gain, but it empties the library just the same. */
  eachDraws: number;
  /** Cards the controller draws only if it says yes to a "you may" (CR 608.2d): part of `draws` / `eachDraws`. */
  mayDraws: number;
  tokens: number;
  tokenPower: number;
  lifeGain: number;
  /** Damage or life loss dealt to opponents without targeting ("each opponent"). */
  oppDamage: number;
  /** "Destroy all creatures", "deals N damage to each creature": `sweepDamage` is Infinity for destroy. */
  sweepDamage: number;
  addsMana: boolean;
  /**
   * Some of it is text the engine does not understand: a `manual` step, or a condition or number the controller is asked for (`{cond:'ask'}`,
   * `{q:'ask'}`, CR 608.2c). The bot answers such questions "no" and 0 (answers.ts), so the parts that depend on them are not counted.
   */
  manual: boolean;
  /** Mana the target's controller can pay to stop a counter ("unless its controller pays {3}"). */
  unlessPay?: number;
  /** Steps that do something the bot does not model (still automated). */
  other: number;
}

const empty = (): Summary => ({
  uses: [], draws: 0, eachDraws: 0, mayDraws: 0, tokens: 0, tokenPower: 0, lifeGain: 0, oppDamage: 0, sweepDamage: 0, addsMana: false, manual: false, other: 0,
});

/** A number for a quantity: plain numbers, X (as announced, 0 when unknown), a number asked by hand as 0 (the bot's answer), anything else counts as 1. */
export function qty(q: Quantity | 'hand' | 'all' | 'any' | undefined, x = 0): number {
  if (q === undefined) return 1;
  if (typeof q === 'number') return q;
  if (q === 'any') return 99;
  if (typeof q === 'string') return 7;
  if (q.q === 'X') return x;
  if (q.q === 'ask') return 0;
  if (q.q === 'math' && q.op === '+') return q.args.reduce<number>((n, a) => n + qty(a, x), 0);
  return 1;
}

const targetId = (r: Ref | ObjRef | PlayerRef | null | undefined): string | null => (r && typeof r === 'object' && r.ref === 'target' ? r.id : null);
const isYou = (r: PlayerRef | undefined): boolean => r?.ref === 'you';
const isOpponents = (r: Ref | undefined): boolean => !!r && ((r.ref === 'each' && 'who' in r && (r.who === 'opponent' || r.who === 'otherPlayer')) || r.ref === 'anOpponent');

/** Summarize an effect program (its targets, modes are summarized separately by `modePrograms`). */
export function summarize(program: EffectProgram | undefined, x = 0): Summary {
  const out = empty();
  if (!program) return out;
  const specs = new Map(program.targets.map((t) => [t.id, t]));
  const use = (id: string | null, polarity: Polarity, kind: UseKind, amount = 0, power = 0): TargetUse | null => {
    const spec = id ? specs.get(id) : undefined;
    if (!spec) return null;
    const prior = out.uses.find((u) => u.spec.id === spec.id);
    if (prior) {
      if (prior.kind === kind) { prior.amount += amount; prior.power += power; }
      return prior;
    }
    const u: TargetUse = { spec, polarity, kind, amount, power };
    out.uses.push(u);
    return u;
  };
  walk(program.steps, out, use, x);
  // A target the steps use in a way the reader does not model: its filter says whose it is ("target creature you control" helps, anything else hurts).
  for (const spec of program.targets) {
    if (out.uses.some((u) => u.spec.id === spec.id)) continue;
    const mine = spec.filter?.controller === 'you' || spec.players?.who === 'you';
    out.uses.push({ spec, polarity: mine ? 'help' : 'harm', kind: 'other', amount: 0, power: 0 });
  }
  return out;
}

type Use = (id: string | null, polarity: Polarity, kind: UseKind, amount?: number, power?: number) => TargetUse | null;

function walk(steps: readonly EffectStep[], out: Summary, use: Use, x: number): void {
  for (const st of steps) step(st, out, use, x);
}

/** The keys of a step that hold nested steps: a question inside them belongs to the nested step. */
const NESTED = new Set(['then', 'else', 'do', 'otherwise']);

/** Whether a node of the ability model contains a question the controller answers by hand (`{cond:'ask'}`, `{q:'ask'}`, CR 608.2c). */
export function asksByHand(node: unknown, skip: ReadonlySet<string> = NESTED): boolean {
  if (Array.isArray(node)) return node.some((n) => asksByHand(n, skip));
  if (!node || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  if (o['cond'] === 'ask' || o['q'] === 'ask') return true;
  return Object.entries(o).some(([k, v]) => !skip.has(k) && asksByHand(v, skip));
}

function step(st: EffectStep, out: Summary, use: Use, x: number): void {
  // A condition or number asked by hand (CR 608.2c): the bot answers "no" and 0, so only what happens then is counted.
  if (st.op === 'if' && asksByHand(st.cond)) { out.manual = true; walk(st.else ?? [], out, use, x); return; }
  if (asksByHand(st)) out.manual = true;
  switch (st.op) {
    case 'if': walk(st.then, out, use, x); return; // the usual branch; "instead" alternatives are not counted twice
    case 'may': {
      const before = { uses: out.uses.length, draws: out.draws + out.eachDraws };
      walk(st.do, out, use, x);
      for (const u of out.uses.slice(before.uses)) u.optional = true;
      out.mayDraws += out.draws + out.eachDraws - before.draws;
      return;
    }
    case 'pay': {
      // "Counter target spell unless its controller pays {3}" (CR 118.12a): remember the price, the target's controller may just pay it.
      if ((st.else ?? []).some((e) => e.op === 'counter')) out.unlessPay = (st.cost.mana ?? []).reduce((n, m) => n + (m.kind === 'generic' ? m.amount : 1), 0);
      walk([...(st.then ?? []), ...(st.else ?? [])], out, use, x);
      return;
    }
    case 'forEach': case 'repeat': case 'delay': case 'reflexive': walk(st.do, out, use, x); return;
    case 'manual': out.manual = true; return;
    case 'damage': {
      const n = qty(st.amount, x);
      if (use(targetId(st.to), 'harm', 'damage', n)) return;
      if (isOpponents(st.to)) { out.oppDamage += n; return; }
      if (st.to.ref === 'each' && 'filter' in st.to) { out.sweepDamage = Math.max(out.sweepDamage, n); return; }
      out.other++;
      return;
    }
    case 'destroy': case 'sacrifice': {
      if (use(targetId(st.what), 'harm', st.op === 'destroy' ? 'destroy' : 'sacrifice')) return;
      if (st.what.ref === 'each') { out.sweepDamage = Infinity; return; }
      out.other++;
      return;
    }
    case 'move': {
      const id = targetId(st.what);
      const zone = st.to.zone;
      if (id) {
        if (zone === 'battlefield') use(id, 'help', 'reanimate');
        else if (zone === 'hand') use(id, 'harm', 'bounce'); // corrected below for graveyard targets
        else use(id, 'harm', zone === 'exile' ? 'exile' : 'destroy');
        fixGraveyardTarget(out, id, zone);
        return;
      }
      if (st.what.ref === 'each') { out.sweepDamage = Infinity; return; }
      out.other++;
      return;
    }
    case 'counter': if (!use(targetId(st.what), 'harm', 'counter')) out.other++; return;
    case 'tap': if (!use(targetId(st.what), 'harm', 'tap')) out.other++; return;
    case 'untap': if (!use(targetId(st.what), 'help', 'untap')) out.other++; return;
    case 'effect': for (const e of st.effects) staticUse(e, out, use, x); return;
    case 'putCounters': {
      const harmful = st.kind === '-1/-1';
      if (!use(targetId(st.on), harmful ? 'harm' : 'help', 'counters', qty(st.count, x))) out.other++;
      return;
    }
    case 'gainLife': if (!use(targetId(st.who), 'help', 'gainLife')) { if (isYou(st.who)) out.lifeGain += qty(st.amount, x); else out.other++; } return;
    case 'loseLife': if (!use(targetId(st.who), 'harm', 'loseLife', qty(st.amount, x))) { if (isOpponents(st.who)) out.oppDamage += qty(st.amount, x); else out.other++; } return;
    case 'draw': {
      const n = qty(st.count, x);
      if (use(targetId(st.who), 'help', 'draw', n)) return;
      if (isYou(st.who)) out.draws += n;
      else {
        if (st.who.ref === 'each' && st.who.who === 'player') out.eachDraws += n;
        out.other++;
      }
      return;
    }
    case 'discard': if (!use(targetId(st.who), 'harm', 'discard')) out.other++; return;
    case 'mill': if (!use(targetId(st.who), 'harm', 'mill')) out.other++; return;
    case 'createToken': {
      const n = qty(st.count, x);
      if (isYou(st.who)) { out.tokens += n; out.tokenPower += n * qty(st.token.power ?? 0, x); } else out.other++;
      return;
    }
    case 'attach': if (!use(targetId(st.to), 'help', 'attach')) out.other++; return;
    case 'fight': use(targetId(st.a), 'help', 'fight'); use(targetId(st.b), 'harm', 'fight'); return;
    case 'addMana': out.addsMana = true; return;
    case 'sacrificeChoice': {
      const u = use(targetId(st.who), 'harm', 'sacrifice');
      if (u) u.filter = st.filter;
      else out.other++;
      return;
    }
    case 'let': case 'shuffle': case 'reveal': case 'look': return;
    default: out.other++;
  }
}

/** "Return target creature card from your graveyard to your hand": a target in a graveyard is a card the bot wants back. */
function fixGraveyardTarget(out: Summary, id: string, zone: string): void {
  const u = out.uses.find((x) => x.spec.id === id);
  if (!u) return;
  const z = u.spec.filter?.zone;
  const fromGraveyard = z === 'graveyard' || (Array.isArray(z) && z.includes('graveyard'));
  if (fromGraveyard && (zone === 'hand' || zone === 'battlefield')) { u.polarity = 'help'; u.kind = zone === 'hand' ? 'return' : 'reanimate'; }
}

function staticUse(e: StaticEffect, out: Summary, use: Use, x: number): void {
  if (e.s === 'continuous') {
    const { power, toughness, grants, steals } = modsOf(e.mods, x);
    const id = targetId(e.affects as Ref);
    if (id) {
      if (steals) use(id, 'harm', 'steal');
      else if (power + toughness < 0) use(id, 'harm', 'debuff', toughness, power);
      else if (power + toughness > 0) use(id, 'help', 'pump', toughness, power);
      else if (grants) use(id, 'help', 'grant');
      else out.other++;
      return;
    }
    if ((e.affects as ObjRef).ref === 'each') {
      if (toughness < 0) out.sweepDamage = Math.max(out.sweepDamage, -toughness);
      else out.other++;
      return;
    }
    out.other++;
    return;
  }
  if (e.s === 'restrict') {
    if (!use(targetId(e.subject), restrictPolarity(e.mode, e.action), 'restrict')) out.other++;
    return;
  }
  out.other++;
}

/** "Can't attack or block" hurts (CR 508.1c, 509.1b); "can't be blocked" (CR 509.1b), "can't be the target of ..." (the `be...` actions) protect. */
function restrictPolarity(mode: string, action: string): Polarity {
  if (mode === 'cant' && action.startsWith('be')) return 'help';
  return 'harm';
}

export function modsOf(mods: readonly Modification[], x = 0): { power: number; toughness: number; grants: boolean; steals: boolean } {
  let power = 0, toughness = 0, grants = false, steals = false;
  for (const m of mods) {
    if (m.layer === '7c' || m.layer === '7b') { power += qty(m.power ?? 0, x); toughness += qty(m.toughness ?? 0, x); }
    if (m.layer === 6 && m.add?.length) grants = true;
    if (m.layer === 2) steals = true;
  }
  return { power, toughness, grants, steals };
}

/** An Aura's effect on the permanent it enchants (CR 303.4): help (+N/+N, keywords) or harm (can't attack or block, -N/-N, control change). */
export function auraPolarity(abilities: readonly AbilityDef[]): { polarity: Polarity; power: number; toughness: number } | null {
  let power = 0, toughness = 0, harm = 0, help = 0;
  for (const a of abilities) {
    if (a.kind !== 'static') continue;
    for (const e of a.effects) {
      if (e.s === 'continuous' && (e.affects as ObjRef).ref === 'attachedTo') {
        const m = modsOf(e.mods);
        power += m.power; toughness += m.toughness;
        if (m.steals) harm += 10;
        if (m.grants) help += 1;
      } else if (e.s === 'restrict' && e.subject.ref === 'attachedTo') {
        if (restrictPolarity(e.mode, e.action) === 'harm') harm += 5; else help += 1;
      }
    }
  }
  const score = help + power + toughness - harm;
  if (score === 0 && harm === 0 && help === 0) return null;
  return { polarity: score >= 0 ? 'help' : 'harm', power, toughness };
}

/** The programs a spell or ability can run: its main program and each of its modes (CR 700.2). */
export function modePrograms(p: EffectProgram | undefined): EffectProgram[] {
  return p?.modes ? p.modes.options.map((o) => o.program) : [];
}

/** The effect program of an ability definition, if it has one. */
export function programOf(a: AbilityDef | undefined): EffectProgram | undefined {
  if (!a) return undefined;
  if (a.kind === 'spell' || a.kind === 'activated' || a.kind === 'triggered' || a.kind === 'chapter') return a.effect;
  if (a.kind === 'manual') return a.effect;
  return undefined;
}

/** Whether a summary is worth paying for: something the reader understood and that is not only manual text. */
export function usefulSummary(s: Summary): boolean {
  return s.uses.length > 0 || s.draws > 0 || s.tokens > 0 || s.lifeGain > 0 || s.oppDamage > 0 || s.sweepDamage > 0 || s.other > 0 || s.addsMana;
}

/** Cards the controller itself draws (CR 121.1): its own draws and its share of "each player draws". */
export const ownDraws = (s: Summary): number => s.draws + s.eachDraws;

/** Every card the effect can make the bot draw, counting a targeted draw ("target player draws X cards") as aimed at the bot. */
export const possibleDraws = (s: Summary): number => ownDraws(s) + s.uses.reduce((n, u) => n + (u.kind === 'draw' ? u.amount : 0), 0);
