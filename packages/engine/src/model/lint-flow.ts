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
    if (d['op'] === 'exileUntil' && typeof d['exiled'] === 'string') out.push(d['exiled']); // trek-7: every card exiled
  }
  return out;
}

/** Every name an ability binds anywhere (for the lenient flows). */
function allNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'EffectStep') {
      for (const k of ['as', 'chosen', 'other', 'cantAs']) if (typeof n.value[k] === 'string') names.add(n.value[k] as string); // C6: `cantAs` (discard, sacrificeChoice)
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

/** C6: the names `cantAs` binds (discard, sacrificeChoice): each one stands for a group of players (CR 101.3). */
function groupNamesOf(root: unknown): Set<string> {
  const names = new Set<string>();
  walkAbility(root, (n) => {
    if (n.def === 'EffectStep' && typeof n.value['cantAs'] === 'string') names.add(n.value['cantAs'] as string);
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

  constructor(private readonly issues: Issue[], root: unknown) {
    this.all = allNamesOf(root);
    this.groups = groupNamesOf(root);
    this.draws = drawNamesOf(root);
    this.casts = drawNamesOf(root, 'cast');
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
    else if (n.def === 'Quantity' && (v['q'] === 'resultCount' || v['q'] === 'excessDamage' || v['q'] === 'lifeLost' || v['q'] === 'countersRemoved' || v['q'] === 'countersPut' || v['q'] === 'votes' || v['q'] === 'damageDealt')) [name, kind] = [v['step'] as string, 'name']; // FAST5X E16: excessDamage
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
    if (kind === 'name') {
      if (!flow.names.has(name) && !(flow.lenient && this.all.has(name)) && !((whichDid || movedReading || drewDid || notCastDid) && this.all.has(name))) {
        this.out('unbound-name', n.path, `"${name}" is not bound by an earlier step on every path that reaches this use (CR 608.2c)`);
      }
    } else if (!flow.vars.has(name) && !flow.lenient) {
      this.out('bad-var', n.path, `{q:'var'} "${name}" has no earlier \`let\` on every path (CR 608.2h)`);
    }
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

  steps(list: unknown, path: string, flow0: Flow): Flow {
    let flow = flow0;
    // Cloud std-fin (CR 608.2c, 118.12): what an option or a payment of this list bound on the path where it was taken (by its `as`): "you may attach an Equipment you
    // control to that creature. If you do, unattach it at the beginning of the next end step" reads, under "if you do", the Equipment the option chose
    const taken = new Map<string, Flow>();
    const declined = new Map<string, string[]>(); // r3-dig: the names a `may` exported (bound to nothing when it was declined), by the `may`'s own name
    arr(list).forEach((step, i) => {
      const p = `${path}/${i}`;
      // Merge wave 8 (audit D2, CR 603.12, 603.3d): a reflexive trigger's own targets are chosen as it is put on the stack, after the option it waits for was taken: they
      // see what that option bound, as its instructions do (below): "you may discard any number of cards. When you do, up to that many target creatures ..."
      const waited = step['op'] === 'reflexive' ? rec(step['when'])['did'] : undefined;
      const ranFirst = typeof waited === 'string' ? taken.get(waited) : undefined;
      this.ownUses(step, p, ranFirst === undefined ? flow : { ...flow, names: new Set([...flow.names, ...ranFirst.names]) });
      // C6 (CR 608.2c): "for each player, choose a creature that player controls": a choice for each player whose objects never name that player chooses among every
      // player's objects in the text but among that player's own in the engine (effects/handlers/choose.ts); refused
      if (step['op'] === 'chooseObjects' && step['perPlayer'] !== undefined && !JSON.stringify(step['from'] ?? null).includes('"ref":"iterating"')) {
        this.out('executable-gap', `${p}/perPlayer`, 'a choice for each player whose objects do not name that player (CR 608.2c)');
      }
      // r4-mech (CR 608.2c): "repeat this process": a step of this list, or the only step of an `if` of it, whose body is a copy of the steps before it in this list
      const proc = step['op'] === 'repeat' ? step : step['op'] === 'if' && step['else'] === undefined && arr(step['then']).length === 1 ? arr(step['then'])[0]! : undefined;
      // std-cardcopy-1 (CR 608.2c): "If C, draw a card and repeat this process.": the last step of the `then` of the list's last step, an `if`; its body is a copy of
      // the whole list with that step emptied (parser/lower/repeat-process.ts), and the empty marker is read only inside that body
      const thenList = step['op'] === 'if' && step['else'] === undefined ? arr(step['then']) : [];
      const againProc = thenList.length > 0 && rec(thenList[thenList.length - 1])['again'] === true ? rec(thenList[thenList.length - 1]) : undefined;
      if (againProc?.['op'] === 'repeat' && againProc['process'] === true && arr(againProc['do']).length > 0 && !this.processes.has(againProc)) {
        const expected = JSON.parse(JSON.stringify(arr(list).slice(0, i + 1))) as Rec[];
        const lastThen = arr(expected[i]!['then']);
        rec(lastThen[lastThen.length - 1])['do'] = [];
        if (i === arr(list).length - 1 && i > 0 && canonical(againProc['do']) === canonical(expected)) { this.processes.add(againProc); this.processStart.set(againProc, flow0); }
        else this.out('executable-gap', `${p}`, '"repeat this process" whose body is not the whole effect (CR 608.2c)');
      }
      if (proc?.['op'] === 'repeat' && proc['process'] === true && proc['again'] !== true && !this.processes.has(proc)) {
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
          const exported = (n: string): boolean => later.includes(`{"ref":"bound","name":${JSON.stringify(n)}}`) && !later.includes(`"as":${JSON.stringify(n)}`) && !later.includes(`"revealed":${JSON.stringify(n)}`);
          const out = this.loops > 0 ? [] : mayDeclaredNames(step).filter((n) => yes.names.has(n) && !after.names.has(n) && exported(n));
          for (const n of out) after = withName(after, n);
          if (typeof step['as'] === 'string' && out.length > 0) declined.set(step['as'], out);
          if (typeof step['as'] === 'string') taken.set(step['as'], yes);
          break;
        }
        case 'pay': {
          const yes = step['then'] === undefined ? flow : this.steps(step['then'], `${p}/then`, flow);
          after = meet(yes, step['else'] === undefined ? flow : this.steps(step['else'], `${p}/else`, flow));
          if (typeof step['as'] === 'string') taken.set(step['as'], yes);
          break;
        }
        case 'flipCoin': {
          // std-copy-1 (CR 603.12, 705.2): the flip is done before the branch of its result runs, so a reflexive trigger there may wait for it by its name
          // (effects/handlers/game.ts#flipCoin records it first); nothing else of the branch reads that name before the flip's result is complete
          const own = typeof step['as'] === 'string' ? withName(flow, step['as']) : flow;
          after = this.alternatives(own, [[step['onWin'], `${p}/onWin`], [step['onLose'], `${p}/onLose`]]);
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
          if (step['process'] === true && !this.processes.has(step) && !emptyAgain) this.out('executable-gap', `${p}`, '"repeat this process" outside the effect it repeats (CR 608.2c)');
          if (step['again'] === true && !emptyAgain) this.againBodies++;
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
      const names: [string, string][] = [];
      if (step['op'] !== 'forEach' && typeof step['as'] === 'string') names.push([step['as'], 'as']);
      if (step['op'] === 'forEach' && typeof step['gather'] === 'string') names.push([step['gather'], 'gather']); // std-rx32: what every iteration bound (CR 608.2f)
      // C6 (CR 101.3): the players of a group who can't do what a discard or a sacrifice tells them
      if ((step['op'] === 'discard' || step['op'] === 'sacrificeChoice') && typeof step['cantAs'] === 'string') names.push([step['cantAs'], 'cantAs']);
      // r3-dig (CR 701.20a): every card "reveal ... until you reveal ..." revealed (the group whose rest a later instruction moves)
      if (step['op'] === 'revealUntil' && typeof step['revealed'] === 'string') names.push([step['revealed'], 'revealed']);
      if (step['op'] === 'exileUntil' && typeof step['exiled'] === 'string') names.push([step['exiled'], 'exiled']); // trek-7 (CR 406.1): every card exiled (the group whose rest a later instruction moves)
      if (step['op'] === 'piles') {
        if (typeof step['chosen'] === 'string') names.push([step['chosen'], 'chosen']);
        if (typeof step['other'] === 'string') names.push([step['other'], 'other']);
      }
      for (const [name, key] of names) {
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
export function lintFlow(root: unknown, base: string, issues: Issue[]): void {
  const lint = new FlowLint(issues, root);
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
