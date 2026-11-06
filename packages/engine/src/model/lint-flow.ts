/**
 * Semantic lint, part 2: names and values bound by earlier steps (design 3.1.6, 3.4, 6.7). Owner: WP1.
 *
 * "Bound" means bound on EVERY path that reaches the use (design 1.1.5, IssueCode `unbound-name`): a name bound inside only one branch of an `if`, a
 * `may` or a `pay` is not visible after it, and a name bound inside a loop body or a delayed trigger does not escape. A delayed trigger sees only the
 * names it captures (CR 603.7c). A mode's steps do not see the names of another mode, and the ability's own steps do not see the names of any mode.
 * CLOUD std-ecl / Cloud std-fin (CR 608.2c, 118.12): the one refinement is "if you do": the branch of `{cond:'did', step}` that runs when an optional instruction
 * (`may`) or a payment was performed sees what that instruction's steps bound ("you may blight 1. If you do, create a token that's a copy of the blighted
 * creature"). Both slices wrote it; the one kept is std-fin's (`taken` in `steps`, which also covers a payment).
 * The pass is a recursion over the step lists; the expressions inside one step are checked by the typed walker, pruned at nested steps.
 */
import type { Issue, IssueCode } from './api';
import { ABILITY_DEFS, ancestors, seg, walkAbility, walkValue, type WalkNode } from './walk';

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {});
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);
/** JSON with sorted keys (r4-mech: a process repeat's body compared with the steps before it). */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Rec).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

interface Flow {
  names: ReadonlySet<string>;
  vars: ReadonlySet<string>;
  /** Replacement bodies run later, in a context this pass cannot follow: any name bound anywhere in the ability is accepted (design 3.8). */
  lenient: boolean;
}

const EMPTY: Flow = { names: new Set(), vars: new Set(), lenient: false };
const withName = (f: Flow, n: string): Flow => ({ ...f, names: new Set([...f.names, n]) });
const withVar = (f: Flow, n: string): Flow => ({ ...f, vars: new Set([...f.vars, n]) });
const meet = (a: Flow, b: Flow): Flow => ({
  names: new Set([...a.names].filter((n) => b.names.has(n))),
  vars: new Set([...a.vars].filter((n) => b.vars.has(n))),
  lenient: a.lenient && b.lenient,
});

/** r3-dig: the names a `may` of one player with no `otherwise` binds in any case (effects/handlers/control.ts#declinedNames, which says the same). */
function mayDeclaredNames(step: Rec): string[] {
  if (step['otherwise'] !== undefined || rec(step['who'])['ref'] === 'each') return [];
  const out: string[] = [];
  for (const d of arr(step['do'])) {
    if (d['op'] !== 'forEach' && typeof d['as'] === 'string') out.push(d['as']);
    if (d['op'] === 'revealUntil' && typeof d['revealed'] === 'string') out.push(d['revealed']);
    if (d['op'] === 'attach' && typeof d['hostAs'] === 'string') out.push(d['hostAs']); // edh-top-15: the permanents an unattach let go of
    if (d['op'] === 'exileUntil' && typeof d['exiled'] === 'string') out.push(d['exiled']); // trek-7: every card exiled
  }
  return out;
}

/** Every name an ability binds anywhere (for the lenient flows). */
export function allNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'EffectStep') {
      for (const k of ['as', 'chosen', 'other', 'cantAs', 'hostAs']) if (typeof n.value[k] === 'string') names.add(n.value[k] as string); // C6: `cantAs` (discard, sacrificeChoice)
      if (n.value['op'] === 'revealUntil' && typeof n.value['revealed'] === 'string') names.add(n.value['revealed'] as string); // r3-dig: every card revealed
      if (n.value['op'] === 'exileUntil' && typeof n.value['exiled'] === 'string') names.add(n.value['exiled'] as string); // trek-7: every card exiled
    }
    return undefined;
  });
  return names;
}

/** std-rx3: the names draw steps bind (anywhere in the ability). */
function drawNamesOf(root: unknown, op = 'draw'): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'EffectStep' && n.value['op'] === op && typeof n.value['as'] === 'string') names.add(n.value['as'] as string);
    return undefined;
  });
  return names;
}

/** edh-perms-6: the names token creations and token copies bind (anywhere in the ability). */
/** edh-next-142: the names of the `may` steps whose one instruction is a reveal ("you may reveal that card"). */
function revealOptionNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    const body = n.value['do'];
    if (n.def === 'EffectStep' && n.value['op'] === 'may' && typeof n.value['as'] === 'string' && Array.isArray(body) && body.length === 1 && rec(body[0])['op'] === 'reveal') names.add(n.value['as'] as string);
    return undefined;
  });
  return names;
}

function tokenNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'EffectStep' && (n.value['op'] === 'createToken' || (n.value['op'] === 'copy' && n.value['result'] === 'token')) && typeof n.value['as'] === 'string') names.add(n.value['as'] as string);
    return undefined;
  });
  return names;
}

/** C6: the names `cantAs` binds (discard, sacrificeChoice): each one stands for a group of players (CR 101.3). */
function groupNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.def === 'EffectStep' && typeof n.value['cantAs'] === 'string') names.add(n.value['cantAs'] as string);
    // edh-players-11 (CR 608.2c): the players of a group `may` who did it, under its `as` (effects/handlers/control.ts#bindDoers)
    if (n.def === 'EffectStep' && n.value['op'] === 'may' && typeof n.value['as'] === 'string' && ['each', 'voters'].includes(String(rec(n.value['who'])['ref']))) names.add(n.value['as'] as string);
    return undefined;
  });
  return names;
}

/** C6: quantities that read ONE player's number (effects/eval.ts reads them with `onePlayer`): a group of players has no such number. */
const ONE_PLAYER_QUANTITIES: ReadonlySet<unknown> = new Set(['life', 'zoneSize', 'devotion', 'partySize', 'lifeLostThisTurn']);

class FlowLint {
  readonly all: Set<string>;
  /** C6: names that stand for a group of players (`cantAs`). */
  readonly groups: Set<string>;
  /** std-rx3: the names of draw steps. */
  readonly draws: Set<string>;
  /** std-rx31: the names the `cast` steps bind ("if it wasn't cast this way" may read a cast inside an earlier branch). */
  readonly casts: Set<string>;
  /** edh-perms-6: the names token creations and token copies bind ("if you didn't create a token this way" may read one inside an earlier payment). */
  readonly makes: Set<string>;
  /** edh-c-67: the names the `may` and `pay` steps bind ("If C, you may pay 2 life. If you do, ..." reads an option inside an earlier branch). */
  readonly options: Set<string>;
  /** edh-next-142: the names of the options that are one reveal ("if you don't reveal it" may read such an option inside an earlier `if`). */
  readonly reveals: Set<string>;
  /**
   * r3-dig: how many `forEach` / `repeat` bodies the list being read is inside. A declined option keeps a name an earlier pass of the same loop bound
   * (effects/handlers/control.ts#bindDeclined keeps a name already bound), so inside a loop an option's names are never exported past it (CR 608.2c).
   */
  private loops = 0;
  /** r4-mech: the process repeats whose body was checked against the steps before them. */
  private readonly processes = new WeakSet<Rec>();
  /**
   * Merge wave 6 (r3-refs's "repeat this process X more times" folded into r4-mech's process repeat): the flow at the start of the list a checked process
   * repeat copies. Its body is read from there, not after the steps it copies: each run of the instructions binds their names again, as a `repeat` of them does
   * (CR 608.2c; Another Round's "return them" each time).
   */
  private readonly processStart = new WeakMap<Rec, Flow>();
  /** std-cardcopy-1: inside the body of an `again` process repeat (its copy of the effect), where the empty `again` marker belongs. */
  private againBodies = 0;

  constructor(private readonly issues: Issue[], root: unknown, private readonly outer: ReadonlySet<string> = new Set()) {
    this.all = allNamesOf(root);
    this.groups = groupNamesOf(root);
    this.draws = drawNamesOf(root);
    this.casts = drawNamesOf(root, 'cast');
    this.makes = tokenNamesOf(root);
    this.options = new Set([...drawNamesOf(root, 'may'), ...drawNamesOf(root, 'pay')]);
    this.reveals = revealOptionNamesOf(root);
  }

  private out(code: IssueCode, path: string, message: string): void {
    this.issues.push({ path, code, message, severity: 'error' });
  }

  private use(n: WalkNode, flow: Flow): void {
    const v = n.value;
    let name: string | undefined;
    let kind: 'name' | 'var' | undefined;
    if ((n.def === 'ObjRef' || n.def === 'PlayerRef') && v['ref'] === 'bound') [name, kind] = [v['name'] as string, 'name'];
    else if (n.def === 'Condition' && v['cond'] === 'did') [name, kind] = [v['step'] as string, 'name'];
    else if (n.def === 'Quantity' && (v['q'] === 'resultCount' || v['q'] === 'excessDamage' || v['q'] === 'lifeLost' || v['q'] === 'countersRemoved' || v['q'] === 'countersPut' || v['q'] === 'votes' || v['q'] === 'votesFor' || v['q'] === 'damageDealt')) [name, kind] = [v['step'] as string, 'name']; // FAST5X E16: excessDamage
    else if (n.def === 'Quantity' && v['q'] === 'var') [name, kind] = [v['name'] as string, 'var'];
    // C6 (CR 101.3): "Each opponent who can't loses half their life" reads one life total of a group of players: not one number (the instruction is per player)
    const of = n.def === 'Quantity' && ONE_PLAYER_QUANTITIES.has(v['q']) ? rec(v['of']) : {};
    if (of['ref'] === 'bound' && this.groups.has(of['name'] as string)) this.out('executable-gap', n.path, `{q:'${String(v['q'])}'} reads one player, but "${String(of['name'])}" is a group of players (CR 101.3, 608.2e)`);
    if (name === undefined || kind === undefined) return;
    // Cloud std-fin (CR 608.2c, 608.2h): "if you put a card into your hand this way" / "if a creature card was exiled this way" (`did` with `which`, not negated) reads
    // what the named step moved; a step that did not run on this path moved nothing, so the condition is false there, which is what the text means. Such a condition may
    // name a step bound inside an earlier branch (an option, an `if`): any step of the ability (effects/eval.ts#did reads a missing result as nothing moved)
    // ... and so does "if you don't put the card onto the battlefield" (`did` with `to`, negated, no `which`; LOOK3 and Cloud std-fin, one rule): the move did not run on
    // this path, so the card was not put there
    const whichDid = n.def === 'Condition' && v['cond'] === 'did' && ((v['which'] !== undefined && v['not'] !== true) || (v['which'] === undefined && v['not'] === true && v['to'] !== undefined));
    // Cloud C7 (CR 608.2c, 608.2h): ... and so do `did` and `resultCount` with `which` (negated too: "if you didn't put a card onto the battlefield this way"), and a
    // count of what the named step reported it moved ("for each creature card exiled this way")
    const movedReading = v['which'] !== undefined && ((n.def === 'Condition' && v['cond'] === 'did') || (n.def === 'Quantity' && v['q'] === 'resultCount'));
    // std-rx3 (CR 608.2c, 121.1): "if you draw one or more cards this way" (`did`, not negated) about a draw inside an earlier option: a draw that did not run on this
    // path drew nothing, so the condition is false there, which is what the text means (effects/eval.ts#did reads a missing result as not performed)
    const drewDid = n.def === 'Condition' && v['cond'] === 'did' && v['not'] !== true && v['which'] === undefined && v['to'] === undefined && this.draws.has(name);
    // std-rx31 (CR 608.2c, 601.2): "if it wasn't cast this way" (`did`, negated, nothing else) about a cast inside an earlier branch ("If this spell was bargained, you may
    // cast the exiled card ..."): a cast that did not run on this path cast nothing, so the card was not cast this way (effects/eval.ts#did reads a missing result as not performed)
    const notCastDid = n.def === 'Condition' && v['cond'] === 'did' && v['not'] === true && v['which'] === undefined && v['to'] === undefined && this.casts.has(name);
    // edh-perms-6 (CR 608.2c, 111.1): "if you didn't create a token this way" (`did`, negated, nothing else) about a token creation inside an earlier payment: one that did not run on
    // this path created nothing (effects/eval.ts#did reads a missing result as not performed)
    const notMadeDid = n.def === 'Condition' && v['cond'] === 'did' && v['not'] === true && v['which'] === undefined && v['to'] === undefined && this.makes.has(name);
    // edh-c-67 (CR 608.2c, 118.12; Wand of Denial): "If it's a nonland card, you may pay 2 life. If you do, put it into that player's graveyard." (`did`, not negated, nothing else) about an
    // option or payment inside an earlier branch: one that did not run on this path was not done, so the condition is false there (effects/eval.ts#did reads a missing result as not performed)
    // edh-next-142 (CR 608.2c, 701.20a; Omnath, Locus of All): "If you don't reveal it" (`did`, negated, nothing else) about an option to reveal inside an earlier `if`: one that did not run on this
    // path revealed nothing (effects/eval.ts#did reads a missing result as not performed)
    const notRevealedDid = n.def === 'Condition' && v['cond'] === 'did' && v['not'] === true && v['which'] === undefined && v['to'] === undefined && this.reveals.has(name);
    const optionDid = n.def === 'Condition' && v['cond'] === 'did' && v['not'] !== true && v['which'] === undefined && v['to'] === undefined && this.loops === 0 && this.options.has(name);
    if (kind === 'name') {
      // edh-d-91 (CR 607.2a, 613.1f; Timothar, Baron of Bats): an ability a resolved effect grants may name what the granting resolution bound (`outer`): effects/handlers/lasting-fix.ts fixes it then
      if (!flow.names.has(name) && !this.outer.has(name) && !(flow.lenient && this.all.has(name)) && !((whichDid || movedReading || drewDid || notCastDid || notMadeDid || optionDid || notRevealedDid) && this.all.has(name))) {
        this.out('unbound-name', n.path, `"${name}" is not bound by an earlier step on every path that reaches this use (CR 608.2c)`);
      }
    } else if (!flow.vars.has(name) && !flow.lenient) {
      this.out('bad-var', n.path, `{q:'var'} "${name}" has no earlier \`let\` on every path (CR 608.2h)`);
    }
  }

  /** edh-zones-22 (effects/handlers/unrun.ts#bindUnrun): the names of a branch not taken that a later step of the list reads as an object reference and no step binds again. */
  private unrunNames(list: unknown, i: number, branch: unknown, yes: Flow, after: Flow, direct: boolean): Flow {
    if (this.loops > 0) return after;
    const later = JSON.stringify(arr(list).slice(i + 1));
    const exported = (n: string): boolean => later.includes(`{"ref":"bound","name":${JSON.stringify(n)}}`) && !later.includes(`"as":${JSON.stringify(n)}`) && !later.includes(`"revealed":${JSON.stringify(n)}`);
    const names: string[] = [];
    const add = (d: Rec): void => {
      if (d['op'] !== 'forEach' && typeof d['as'] === 'string') names.push(d['as']);
      if (d['op'] === 'revealUntil' && typeof d['revealed'] === 'string') names.push(d['revealed']);
      if (d['op'] === 'exileUntil' && typeof d['exiled'] === 'string') names.push(d['exiled']);
    };
    for (const d of arr(branch)) {
      // (the steps of the branch of an `if` on any condition but "if you did" leave a name unbound when the branch is not taken (FAST5 T78); those of a paid option's `then` or of an `if` on that bind it to nothing)
      if (direct || d['op'] === 'revealUntil' || d['op'] === 'exileUntil') add(d);
      if (d['op'] === 'may' && d['otherwise'] === undefined && rec(d['who'])['ref'] !== 'each') arr(d['do']).forEach(add);
    }
    let out = after;
    for (const n of names) if (yes.names.has(n) && !out.names.has(n) && exported(n)) out = withName(out, n);
    return out;
  }

  /** The expressions of one step, not its nested steps. */
  private ownUses(step: Rec, path: string, flow: Flow): void {
    walkValue(step, 'EffectStep', (n) => {
      if (n.path !== path && (n.def === 'EffectStep' || ABILITY_DEFS.has(n.def))) return false;
      this.use(n, flow);
      return undefined;
    }, { path });
  }

  /** Expressions outside any program (costs, trigger events, conditions, static effects): nothing is bound there. */
  scanOutside(root: unknown, base: string): void {
    walkAbility(root, (n) => {
      if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
      if (n.def === 'EffectProgram' || n.def === 'EffectStep') return false;
      if (n.slot === 'if' && n.parent?.def === 'ReplacementBody' && n.parent.value['b'] === 'insteadThen') return false; // p2-replace-events-1: read after `do` (bodyLists)
      this.use(n, EMPTY);
      return undefined;
    }, { path: base });
  }

  /** The target specs and mode counts of a program: they are chosen before anything resolves (CR 601.2b-c, 700.2a), so no name is bound there. */
  private announced(prog: Rec, path: string): void {
    walkValue(prog, 'EffectProgram', (n) => {
      if (n.path !== path && (n.def === 'EffectStep' || n.def === 'EffectProgram' || ABILITY_DEFS.has(n.def))) return false;
      this.use(n, EMPTY);
      return undefined;
    }, { path });
  }

  program(prog: Rec, path: string): void {
    this.announced(prog, path);
    const modes = rec(prog['modes']);
    arr(modes['options']).forEach((o, i) => this.program(rec(o['program']), `${path}/modes/options/${i}/program`));
    this.steps(prog['steps'], `${path}/steps`, EMPTY);
  }

  /** Replacement bodies hold step lists too (`instead.do`, `prevent.then`). */
  bodies(root: unknown, base: string): void {
    walkAbility(root, (n) => {
      if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
      if (n.def === 'EffectProgram') return false; // reached through the step that holds the effect
      this.bodyLists(n);
      return undefined;
    }, { path: base });
  }

  private bodyLists(n: WalkNode): void {
    if (n.def !== 'ReplacementBody') return;
    const lenient: Flow = { names: new Set(), vars: new Set(), lenient: true };
    const after = n.value['b'] === 'instead' || n.value['b'] === 'insteadThen' ? this.steps(n.value['do'], `${n.path}/do`, lenient) : lenient; // merge wave 8: insteadThen (audit D4)
    // p2-replace-events-1 (CR 608.2c, 614.1a): the condition of an "insteadThen" ("If you do, put this land onto the battlefield") is read after its steps, so it sees
    // what they bound (effects/instead.ts#applyInsteadThen)
    if (n.value['b'] === 'insteadThen' && n.value['if'] !== undefined) {
      walkValue(n.value['if'], 'Condition', (c) => { this.use(c, after); return undefined; }, { path: `${n.path}/if` });
    }
    // std-library-2 (CR 603.12, 615.5): the prevention's own name (`as`) is bound while its additional steps run (effects/bodies/m5.ts#thenSteps)
    if (n.value['b'] === 'prevent') this.steps(n.value['then'], `${n.path}/then`, typeof n.value['as'] === 'string' ? withName(lenient, n.value['as']) : lenient);
  }

  /** edh-next-69: names bound by a move out of the battlefield anywhere so far (names are unique on a path), so a nested list sees what an outer one moved. */
  private movedAwayAll = new Set<string>();
  steps(list: unknown, path: string, flow0: Flow): Flow {
    let flow = flow0;
    // Cloud std-fin (CR 608.2c, 118.12): what an option or a payment of this list bound on the path where it was taken (by its `as`): "you may attach an Equipment you
    // control to that creature. If you do, unattach it at the beginning of the next end step" reads, under "if you do", the Equipment the option chose
    const taken = new Map<string, Flow>();
    const declined = new Map<string, string[]>(); // r3-dig: the names a `may` exported (bound to nothing when it was declined), by the `may`'s own name
    // edh-next-69 (CR 603.7c, 400.7a; Obzedat, Ghost Council: "return it to the battlefield ... at the beginning of your next upkeep. It gains haste."): the names a delayed trigger of this list moves
    // later. An instruction after it that reads such a name acts on the object NOW (in the zone it was moved to), not on the new object the delayed move makes, so it can't be what the text says
    const movedLater = new Set<string>();
    const movedAway = this.movedAwayAll; // names bound by a move out of the battlefield earlier in this list (the object has left; a later return is a new object)
    arr(list).forEach((step, i) => {
      const p = `${path}/${i}`;
      const noteAway = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(noteAway); return; }
        if (v === null || typeof v !== 'object') return;
        const r = v as Rec;
        const to = r['to'];
        if (r['op'] === 'move' && typeof r['as'] === 'string' && to !== null && typeof to === 'object' && (to as Rec)['zone'] !== 'battlefield') movedAway.add(r['as']);
        Object.values(r).forEach(noteAway);
      };
      if (step['op'] !== 'delay') noteAway(step);
      if (movedLater.size > 0) {
        const text = JSON.stringify(step);
        for (const n of movedLater) {
          if (text.includes(`"ref":"bound","name":${JSON.stringify(n)}`) || text.includes(`"name":${JSON.stringify(n)},"ref":"bound"`)) {
            this.out('executable-gap', p, `an instruction after a delayed trigger reads "${n}", which the delayed trigger moves (CR 603.7c, 400.7a): it would act on the object before the move`);
          }
        }
      }
      // Merge wave 8 (audit D2, CR 603.12, 603.3d): a reflexive trigger's own targets are chosen as it is put on the stack, after the option it waits for was taken: they
      // see what that option bound, as its instructions do (below): "you may discard any number of cards. When you do, up to that many target creatures ..."
      const waited = step['op'] === 'reflexive' ? rec(step['when'])['did'] : undefined;
      const ranFirst = typeof waited === 'string' ? taken.get(waited) : undefined;
      // edh-zones-10 (CR 608.2c): the condition of "repeat this process until C" is read after a run, so it sees what the run bound (checked with the `repeat` case below)
      const own = step['op'] === 'repeat' && step['until'] !== undefined ? Object.fromEntries(Object.entries(step).filter(([k]) => k !== 'until')) : step;
      this.ownUses(own, p, ranFirst === undefined ? flow : { ...flow, names: new Set([...flow.names, ...ranFirst.names]) });
      // C6 (CR 608.2c): "for each player, choose a creature that player controls": a choice for each player whose objects never name that player chooses among every
      // player's objects in the text but among that player's own in the engine (effects/handlers/choose.ts); refused
      if (step['op'] === 'chooseObjects' && step['perPlayer'] !== undefined && !JSON.stringify(step['from'] ?? null).includes('"ref":"iterating"')) {
        this.out('executable-gap', `${p}/perPlayer`, 'a choice for each player whose objects do not name that player (CR 608.2c)');
      }
      // edh-d-92 review (CR 608.2d, 101.4; King Narfi's Betrayal: "Then you may exile a creature or planeswalker card from each graveyard."): an optional instruction whose first step is a choice
      // for each player is a choice for each graveyard in the text (the ruling: "for each graveyard, you may exile ...") but one yes/no in the engine, whose check reads the choice outside
      // its per-player loop (effects/handlers/control.ts#cannotStart) and so never starts; refused
      if (step['op'] === 'may' && rec(arr(step['do'])[0])['op'] === 'chooseObjects' && rec(arr(step['do'])[0])['perPlayer'] !== undefined) {
        this.out('executable-gap', `${p}/do/0/perPlayer`, 'an optional instruction whose first step is a choice for each player (CR 608.2d, 101.4)');
      }
      // r4-mech (CR 608.2c): "repeat this process": a step of this list, or the only step of an `if` of it, whose body is a copy of the steps before it in this list
      const proc = step['op'] === 'repeat' ? step : step['op'] === 'if' && step['else'] === undefined && arr(step['then']).length === 1 ? arr(step['then'])[0]! : undefined;
      // std-cardcopy-1 (CR 608.2c): "If C, draw a card and repeat this process.": the last step of the `then` of the list's last step, an `if`; its body is a copy of
      // the whole list with that step emptied (parser/lower/repeat-process.ts), and the empty marker is read only inside that body
      // edh-next-87 (CR 608.2c; Primal Surge): or the last step of the `then` of an `if` ("If you do") that is the last step of that `then` (up to three `if`s deep, none with an `else`)
      let againProc: Rec | undefined;
      let againParent: Rec = step;
      for (let depth = 0; depth < 3 && againProc === undefined; depth++) {
        const tl = againParent['op'] === 'if' && againParent['else'] === undefined ? arr(againParent['then']) : [];
        if (tl.length === 0) break;
        const lastStep = rec(tl[tl.length - 1]);
        if (lastStep['again'] === true) againProc = lastStep;
        else if (lastStep['op'] === 'if') againParent = lastStep;
        else break;
      }
      if (againProc?.['op'] === 'repeat' && againProc['process'] === true && arr(againProc['do']).length > 0 && !this.processes.has(againProc)) {
        const expected = JSON.parse(JSON.stringify(arr(list).slice(0, i + 1))) as Rec[];
        // the same route in the copy: the marker is emptied there
        let node: Rec = expected[i]!;
        for (let depth = 0; depth < 3; depth++) {
          const lastThen = arr(node['then']);
          const target = rec(lastThen[lastThen.length - 1]);
          if (target['again'] === true) { target['do'] = []; break; }
          node = target;
        }
        // edh-d-101 (CR 608.2c; Demonlord Belzenlok): steps after it in the list are no part of the process (they run once, after the last run): the body is the list up to it
        if (i > 0 && canonical(againProc['do']) === canonical(expected)) { this.processes.add(againProc); this.processStart.set(againProc, flow0); }
        else this.out('executable-gap', `${p}`, '"repeat this process" whose body is not the effect up to it (CR 608.2c)');
      }
      // edh-d-1 (CR 701.30, 608.2c; Hoarder's Greed): "..., then clash with an opponent. If you win, repeat this process.": the same marker as above as the only step of the `onWin` of the
      // list's last step, a clash; its body is a copy of the whole list with that marker emptied (parser/lower/repeat-process.ts#clashAgainMarkerOf)
      const winList = step['op'] === 'clash' ? arr(step['onWin']) : [];
      const clashAgain = winList.length === 1 && rec(winList[0])['again'] === true ? rec(winList[0]) : undefined;
      if (clashAgain?.['op'] === 'repeat' && clashAgain['process'] === true && arr(clashAgain['do']).length > 0 && !this.processes.has(clashAgain)) {
        const expected = JSON.parse(JSON.stringify(arr(list).slice(0, i + 1))) as Rec[];
        rec(arr(expected[i]!['onWin'])[0])['do'] = [];
        if (i === arr(list).length - 1 && i > 0 && canonical(clashAgain['do']) === canonical(expected)) { this.processes.add(clashAgain); this.processStart.set(clashAgain, flow0); }
        else this.out('executable-gap', `${p}`, '"repeat this process" whose body is not the whole effect (CR 608.2c)');
      }
      if (proc?.['op'] === 'repeat' && proc['process'] === true && proc['again'] !== true && proc['until'] === undefined && !this.processes.has(proc)) {
        if (i > 0 && canonical(proc['do']) === canonical(arr(list).slice(0, i))) { this.processes.add(proc); this.processStart.set(proc, flow0); }
        else this.out('executable-gap', `${p}`, '"repeat this process" whose body is not the instructions before it (CR 608.2c)');
      }
      let after = flow;
      switch (step['op']) {
        case 'if': {
          // the branch of "if you do" about an option or a payment of this list sees what that option bound: it ran there (a declined one has no result, effects/eval.ts#did)
          const c = rec(step['cond']);
          const ran = c['cond'] === 'did' && c['not'] !== true && c['which'] === undefined && c['to'] === undefined && typeof c['step'] === 'string' ? taken.get(c['step']) : undefined;
          // r3-dig: "If you don't, ..." never sees what the option it answers would have named (an option not taken named nothing, so a reference to it there is not understood);
          // nor does the "Otherwise, ..." of "If you do, ...", the same branch ("You may exile the top card of your library. If you do, draw a card. Otherwise, you may play
          // that card this turn." stays manual; CR 608.2c)
          const notTaken = c['cond'] === 'did' && typeof c['step'] === 'string' ? declined.get(c['step']) ?? [] : [];
          const without = notTaken.length === 0 ? flow : { ...flow, names: new Set([...flow.names].filter((n) => !notTaken.includes(n))) };
          const before = c['not'] === true ? without : flow;
          const yes = this.steps(step['then'], `${p}/then`, ran === undefined ? before : { ...before, names: new Set([...before.names, ...ran.names]) });
          after = meet(yes, step['else'] === undefined ? flow : this.steps(step['else'], `${p}/else`, c['not'] === true ? flow : without));
          // edh-zones-22 (CR 608.2c; Birthing Ritual, effects/handlers/unrun.ts#bindUnrun): the names a branch with no `else` would bind are bound to nothing when it is not taken, so a later
          // instruction may read them (only as an object reference, as the `may` case below)
          // edh-next-138: "if you do", and "if you don't" for the token(s) its branch creates (Baral and Kari Zev; effects/handlers/control.ts#ifHandler binds the names of either branch to nothing).
          // Combined copy: only those tokens for "if you don't", as 138's focus rule (model/focus.ts#keptFocus): any other name of an "if you don't" branch stays unbound after it, so a bare
          // "If you don't" that names an instruction nobody declines (edh-zones-7's near miss: "Look at the top four cards ... If you don't, put a card from among them ...") keeps its refusal
          if (step['else'] === undefined) after = this.unrunNames(list, i, step['then'], yes, after, rec(step['cond'])['cond'] === 'did' && (rec(step['cond'])['not'] !== true || arr(step['then']).some((x) => rec(x)['op'] === 'createToken')));
          break;
        }
        case 'may': {
          const yes = this.steps(step['do'], `${p}/do`, flow);
          after = meet(yes, step['otherwise'] === undefined ? flow : this.steps(step['otherwise'], `${p}/otherwise`, flow));
          // r3-dig (CR 608.2c): what the option's own instructions name is bound to nothing when it is not taken (effects/handlers/control.ts#declinedNames), so the
          // steps after it may read it ("You may exile the top card of your library. You may play that card this turn.")
          // (only a name a later step of this list reads and none binds again: two options of one ability may bind the same template name, each for itself)
          const later = JSON.stringify(arr(list).slice(i + 1));
          // (and only as an object reference, {ref:'bound'}: a count of what the option did keeps FAST5 T78's rule, test/fast5/t78)
          // edh-next-91 (CR 608.2c; Nantuko Cultivator: "You may discard any number of land cards. Put that many +1/+1 counters ..."): and the number of what the option did (`resultCount`, no
          // `which`): an option not taken did nothing, so it counts 0 (effects/eval.ts#resultCount reads a step that did not run as nothing) and the text means exactly that
          const counted = (n: string): boolean => new RegExp(`"q":"resultCount","step":${JSON.stringify(n)}[,}]`).test(later);
          const exported = (n: string): boolean => (later.includes(`{"ref":"bound","name":${JSON.stringify(n)}}`) || counted(n)) && !later.includes(`"as":${JSON.stringify(n)}`) && !later.includes(`"revealed":${JSON.stringify(n)}`);
          const out = this.loops > 0 ? [] : mayDeclaredNames(step).filter((n) => yes.names.has(n) && !after.names.has(n) && exported(n));
          for (const n of out) after = withName(after, n);
          if (typeof step['as'] === 'string' && out.length > 0) declined.set(step['as'], out);
          if (typeof step['as'] === 'string') taken.set(step['as'], yes);
          break;
        }
        case 'pay': {
          // edh-players-16 (CR 608.2c, 118.12; Necrodominance): a payment of a chosen number of times (`anyAmount`, `upTo`) has its count before its `then` runs ("If you do, draw that many
          // cards"; effects/handlers/pay.ts#payHandler records the result first), so the step's own name is bound there
          const own = typeof step['as'] === 'string' && (step['anyAmount'] === true || step['upTo'] !== undefined) ? withName(flow, step['as']) : flow;
          const yes = step['then'] === undefined ? flow : this.steps(step['then'], `${p}/then`, own);
          after = meet(yes, step['else'] === undefined ? flow : this.steps(step['else'], `${p}/else`, flow));
          if (step['else'] === undefined && step['then'] !== undefined) after = this.unrunNames(list, i, step['then'], yes, after, true); // edh-zones-22 (as the `if` above)
          if (typeof step['as'] === 'string') taken.set(step['as'], yes);
          break;
        }
        case 'flipCoin': {
          // std-copy-1 (CR 603.12, 705.2): the flip is done before the branch of its result runs, so a reflexive trigger there may wait for it by its name
          // (effects/handlers/game.ts#flipCoin records it first); nothing else of the branch reads that name before the flip's result is complete
          const own = typeof step['as'] === 'string' ? withName(flow, step['as']) : flow;
          after = this.alternatives(own, [[step['onWin'], `${p}/onWin`], [step['onLose'], `${p}/onLose`], [step['onTails'], `${p}/onTails`]]);
          if (own !== flow) after = { ...after, names: new Set([...after.names].filter((n) => n !== step['as'])) };
          break;
        }
        case 'clash': {
          // p2-player-rules-2 (CR 701.30): either branch runs after the clash, as a coin flip's
          after = this.alternatives(flow, [[step['onWin'], `${p}/onWin`], [step['onLose'], `${p}/onLose`]]);
          break;
        }
        case 'forEach': {
          const name = step['as'] as string;
          if (flow.names.has(name)) this.out('duplicate-name', `${p}/as`, `"${name}" is already bound`);
          this.loops++;
          this.steps(step['do'], `${p}/do`, withName(flow, name));
          this.loops--;
          break;
        }
        case 'repeat':
          this.loops++;
          const emptyAgain = step['again'] === true && arr(step['do']).length === 0 && this.againBodies > 0; // std-cardcopy-1: the marker inside the copy
          if (step['process'] === true && !this.processes.has(step) && !emptyAgain && step['until'] === undefined) this.out('executable-gap', `${p}`, '"repeat this process" outside the effect it repeats (CR 608.2c)');
          if (step['again'] === true && !emptyAgain) this.againBodies++;
          if (step['until'] !== undefined) {
            // edh-zones-10: the process is the body, done at least once; the group of cards gathered over the runs (`gather.as`) is bound inside it and in the condition
            const group = rec(step['gather'])['as'];
            const inner = this.steps(step['do'], `${p}/do`, typeof group === 'string' ? withName(flow, group) : flow);
            this.ownUses({ op: 'if', cond: step['until'], then: [] }, `${p}/until`, inner);
            this.loops--;
            break;
          }
          this.steps(step['do'], `${p}/do`, this.processStart.get(step) ?? flow);
          if (step['again'] === true && !emptyAgain) this.againBodies--;
          this.loops--;
          break;
        case 'delay': {
          const captured = new Set<string>();
          ((step['capture'] as string[] | undefined) ?? []).forEach((c, j) => {
            if (flow.names.has(c) || (flow.lenient && this.all.has(c))) captured.add(c);
            else this.out('bad-capture', `${p}/capture/${j}`, `delay captures "${c}", which no earlier step binds (CR 603.7c)`);
          });
          this.steps(step['do'], `${p}/do`, { names: captured, vars: flow.vars, lenient: flow.lenient });
          const movesBound = (v: unknown): void => {
            if (Array.isArray(v)) { v.forEach(movesBound); return; }
            if (v === null || typeof v !== 'object') return;
            const r = v as Rec;
            const what = r['what'];
            if (r['op'] === 'move' && what !== null && typeof what === 'object' && (what as Rec)['ref'] === 'bound' && captured.has(String((what as Rec)['name'])) && movedAway.has(String((what as Rec)['name']))) movedLater.add(String((what as Rec)['name']));
            Object.values(r).forEach(movesBound);
          };
          movesBound(step['do']);
          break;
        }
        case 'reflexive': {
          const did = rec(step['when'])['did'];
          if (typeof did === 'string' && !flow.names.has(did) && !(flow.lenient && this.all.has(did))) {
            this.out('unbound-name', `${p}/when/did`, `the reflexive trigger waits for "${did}", which no earlier step binds (CR 603.12)`);
          }
          // Cloud r3-moved (CR 603.12, 118.12): a trigger that waits for an option or a payment of this list to be taken sees what it bound, as "if you do" does above
          // ("Then you may discard two cards. When you do, ... among cards discarded this way")
          const ran = typeof did === 'string' ? taken.get(did) : undefined;
          this.steps(step['do'], `${p}/do`, ran === undefined ? flow : { ...flow, names: new Set([...flow.names, ...ran.names]) });
          break;
        }
        case 'rollDie':
          this.steps(step['afterRoll'], `${p}/afterRoll`, flow); // edh-mana-keywords-10
          arr(step['table']).forEach((row, j) => this.steps(row['do'], `${p}/table/${j}/do`, flow));
          break;
        case 'effect':
          walkValue(step, 'EffectStep', (n) => {
            if (n.path !== p && (n.def === 'EffectStep' || ABILITY_DEFS.has(n.def))) return false;
            this.bodyLists(n);
            return undefined;
          }, { path: p });
          break;
        default:
      }
      // what this step binds for the steps after it
      if (step['op'] === 'let') after = withVar(after, step['name'] as string);
      if (step['op'] === 'rollDie') for (const v of tableLets(step)) after = withVar(after, v); // edh-next-121: rows that each fix X (Wand of Wonder)
      const names: [string, string][] = [];
      if (step['op'] !== 'forEach' && typeof step['as'] === 'string') names.push([step['as'], 'as']);
      if (step['op'] === 'forEach' && typeof step['gather'] === 'string') names.push([step['gather'], 'gather']); // std-rx32: what every iteration bound (CR 608.2f)
      if (step['op'] === 'may' && typeof step['gather'] === 'string') names.push([step['gather'], 'gather']); // edh-top-5: what every player's run bound (CR 608.2c)
      if (step['op'] === 'rollDie' && typeof rec(step['highest'])['as'] === 'string') names.push([rec(step['highest'])['as'] as string, 'highest']); // edh-top-16: the opponents with the highest roll (CR 706.2)
      if (step['op'] === 'repeat' && step['optional'] === true && typeof rec(step['gather'])['as'] === 'string') names.push([rec(step['gather'])['as'] as string, 'gather']); // edh-zones-26: the cards the runs of "as many times as you choose" gathered (CR 608.2c)
      // C6 (CR 101.3): the players of a group who can't do what a discard or a sacrifice tells them
      if ((step['op'] === 'discard' || step['op'] === 'sacrificeChoice') && typeof step['cantAs'] === 'string') names.push([step['cantAs'], 'cantAs']);
      if (step['op'] === 'attach' && typeof step['hostAs'] === 'string') names.push([step['hostAs'], 'hostAs']); // edh-top-15 (CR 701.3d, 608.2c): the permanents an unattach let go of
      // r3-dig (CR 701.20a): every card "reveal ... until you reveal ..." revealed (the group whose rest a later instruction moves)
      if (step['op'] === 'revealUntil' && typeof step['revealed'] === 'string') names.push([step['revealed'], 'revealed']);
      if (step['op'] === 'exileUntil' && typeof step['exiled'] === 'string') names.push([step['exiled'], 'exiled']); // trek-7 (CR 406.1): every card exiled (the group whose rest a later instruction moves)
      if (step['op'] === 'piles') {
        if (typeof step['chosen'] === 'string') names.push([step['chosen'], 'chosen']);
        if (typeof step['other'] === 'string') names.push([step['other'], 'other']);
      }
      for (const [name, key] of names) {
        // edh-next-126 (CR 608.2c; Lim-Dûl's Vault): a look with `rebind` names the group an earlier look bound again (it must be bound: nothing else may be rebound)
        if (step['op'] === 'look' && step['rebind'] === true && key === 'as') {
          if (!after.names.has(name)) this.out('unbound-name', `${p}/as`, `"${name}" is rebound but no earlier step on this path binds it`);
          continue;
        }
        if (after.names.has(name)) this.out('duplicate-name', `${p}/${seg(key)}`, `"${name}" is already bound by an earlier step on this path`);
        else after = withName(after, name);
      }
      flow = after;
    });
    return flow;
  }

  /** Branches of which exactly one runs: what is bound afterwards is what every branch binds (a missing branch binds nothing). */
  private alternatives(flow: Flow, branches: [unknown, string][]): Flow {
    let result: Flow | null = null;
    for (const [list, path] of branches) {
      const f = list === undefined ? flow : this.steps(list, path, flow);
      result = result === null ? f : meet(result, f);
    }
    return result ?? flow;
  }
}

/** Part-2 lint of one ability. `programs` are found by the walk; nested abilities are linted by the caller as their own scope. */
export function lintFlow(root: unknown, base: string, issues: Issue[], outer?: ReadonlySet<string>): void {
  const lint = new FlowLint(issues, root, outer);
  lint.scanOutside(root, base);
  lint.bodies(root, base);
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'EffectProgram') {
      let top = true;
      for (const a of ancestors(n)) if (a.def === 'EffectProgram') top = false;
      if (top) lint.program(n.value, n.path);
      return false;
    }
    return undefined;
  }, { path: base });
}

/**
 * edh-next-121 (CR 706.3a, 706.2, 608.2h; Wand of Wonder): the values every row of a die-roll table fixes with a `let` of its own top-level steps, when the rows cover every result of
 * the one die exactly once (1 to its sides, in order, no modifier that could take the result outside them): one of the rows always happens, so the value is fixed on every path after the
 * roll. None otherwise.
 */
function tableLets(step: Rec): string[] {
  const sides = step['sides'];
  const rows = arr(step['table']);
  if (typeof sides !== 'number' || rows.length === 0 || step['modifier'] !== undefined || step['chooseOne'] !== undefined || step['highest'] !== undefined) return [];
  if (step['count'] !== undefined && step['count'] !== 1) return [];
  const who = rec(step['who']);
  if (who['ref'] !== 'you' || Object.keys(who).length !== 1) return [];
  let next = 1;
  for (const r of rows) {
    if (r['min'] !== next || typeof r['max'] !== 'number' || (r['max'] as number) < next) return [];
    next = (r['max'] as number) + 1;
  }
  if (next !== sides + 1) return [];
  const letsOf = (r: Rec): Set<string> => new Set(arr(r['do']).filter((x) => x['op'] === 'let' && x['guard'] === undefined && typeof x['name'] === 'string').map((x) => x['name'] as string));
  const [first, ...others] = rows.map(letsOf);
  return [...first!].filter((v) => others.every((o) => o.has(v)));
}
