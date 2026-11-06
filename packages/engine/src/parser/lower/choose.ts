/**
 * Pass 3b, choose (Cloud std-eoe): "Choose up to one target creature. That creature can't be blocked this turn ..." (CR 115.1, 601.2c). A sentence that only
 * announces targets (template eff.stdeoe.choose.targets builds the intermediate node `{"lower": "chooseTargets", "what": <targets>}`) does nothing as the
 * ability resolves: its targets are chosen with the others as the spell or ability is put on the stack (lower/targets.ts made their specs), and the sentence
 * right after it names them ("that creature", "it": lower/anaphora.ts#chosenFocus). This pass removes the node, so the sentence keeps its targets and no
 * step. An understood sentence after it (r3-choose: the next one, or a later one, "the chosen card") must name every one of those targets, or the "choose"
 * sentence is manual: a target that no instruction acts on is no reading the model can check (a leftover node is refused by lower/normalize.ts as well).
 */
import type { Draft, Rec, Unit } from './types';
import { cloneDraft, isRec, sequences, setManual, visit } from './util';
import { isCastChoice } from '../../render/self-replacement';

/** The node a "choose ... target ..." sentence is made of, or null. */
export function chooseNode(u: Unit): Rec | null {
  const only = u.steps.length === 1 || thenRoll(u) ? u.steps[0] : undefined;
  return isRec(only) && only['lower'] === 'chooseTargets' ? only : null;
}

/**
 * p2-c-dieroll-2 (CR 115.1, 601.2c, 706.3a; unverified cites): "When ~ enters, choose target creature an opponent controls, then roll a d20." over result rows:
 * the sentence announces the targets and rolls; the rows name the targets (they are later sentences until lower/die-roll.ts folds them into the roll). Only
 * this shape: the announcement and ONE roll with no table yet; the roll stays as the sentence's step.
 */
function thenRoll(u: Unit): boolean {
  const [first, second] = u.steps;
  // edh-top-8 (CR 115.1, 601.2c, 705.1; Invert Polarity): "Choose target spell, then flip a coin. If you win the flip, gain control of that spell ..." announces the target and flips one coin with no result
  // steps yet (the sentences after it are the riders of the flip, templates eff.r3mech.ifFlip.win and .lose)
  const flips = isRec(second) && second['op'] === 'flipCoin' && second['onWin'] === undefined && second['onLose'] === undefined && second['untilLose'] === undefined && second['called'] === undefined;
  return u.steps.length === 2 && isRec(first) && first['lower'] === 'chooseTargets' && isRec(second) && ((second['op'] === 'rollDie' && second['table'] === undefined) || flips);
}

/** The target ids a value refers to. */
function targetIdsIn(v: unknown): Set<string> {
  const out = new Set<string>();
  visit(v, (n) => {
    if (n['ref'] === 'target' && typeof n['id'] === 'string') out.add(n['id']);
  });
  return out;
}

/**
 * std-rx10 (CR 701.14a, 701.14b, 608.2c): "Then those creatures fight each other." (template eff.stdrx10.fight.eachOther builds `{"lower": "fightEachOther", "what": <them>}`):
 * the group the anaphora pass bound must be exactly the two single targets one "choose" sentence announced (mentions.ts#announcedGroup); it becomes the fight of the
 * first with the second. Anything else is manual.
 */
function lowerFightEachOther(u: Unit): void {
  if (u.manual !== undefined) return;
  let bad = false;
  u.steps = u.steps.map((s) => {
    if (!isRec(s) || s['lower'] !== 'fightEachOther') return s;
    const what = s['what'];
    const of = isRec(what) && what['ref'] === 'union' && Array.isArray(what['of']) ? what['of'] : [];
    if (of.length !== 2 || !of.every((r) => isRec(r) && r['ref'] === 'target' && typeof r['id'] === 'string')) { bad = true; return s; }
    const fight = { op: 'fight', a: of[0], b: of[1], ...(s['by'] === 'toughness' ? { by: 'toughness' } : {}), ...(typeof s['as'] === 'string' ? { as: s['as'] } : {}) }; // edh-c-111: Grim Contest's damage by toughness (not a fight)
    // trek-22 (CR 701.14a, 608.2d; T'Pring, Never Parted): "You may have the chosen creatures fight each other." the controller decides whether the fight happens
    return s['may'] === true ? { op: 'may', who: { ref: 'you' }, do: [fight] } : fight;
  });
  if (bad) setManual(u, { code: 'unbound-reference', reason: '"fight each other" names no pair of targets announced together (CR 701.14a, 608.2c)' });
}

/**
 * std-costs-2 (CR 601.2b, 601.2c): the rider right after a "choose ... target ..." sentence that announces other targets instead when a condition decided at announcement
 * holds ("If this spell was kicked, instead choose any number of target creatures you own.", template rid.fast5x.instead.front: `{"@replace": true, op: "if", cond,
 * then: [<chooseTargets node>], else: ["@previous"]}`): its condition and the targets it announces, which lower/targets.ts made only-if that condition. Null otherwise.
 */
function insteadChoose(d: Draft, u: Unit, next: Unit | undefined): { cond: unknown; ids: string[] } | null {
  const patch = next?.manual === undefined ? next?.rider?.patch : undefined;
  if (d.spell !== true || !isRec(patch) || patch['@replace'] !== true || patch['op'] !== 'if' || !isCastChoice(patch['cond'])) return null;
  const then = patch['then'];
  const els = patch['else'];
  if (!Array.isArray(then) || then.length !== 1 || !isRec(then[0]) || then[0]['lower'] !== 'chooseTargets' || !Array.isArray(els) || els.length !== 1 || els[0] !== '@previous') return null;
  const ids = [...targetIdsIn(then[0])];
  const cond = JSON.stringify(patch['cond']);
  if (ids.length === 0 || (u.targetIds ?? []).length === 0 || !ids.every((id) => JSON.stringify(d.targets.find((t) => t.id === id)?.onlyIf) === cond)) return null;
  return { cond: patch['cond'], ids };
}

/**
 * edh-zones-26 (CR 701.21a, 701.20, 115.1, 608.2b, 608.2c; Goblin Welder): "Choose target artifact a player controls and target artifact card in that player's graveyard. If both
 * targets are still legal as this ability resolves, that player simultaneously sacrifices the artifact and returns the artifact card to the battlefield." (template
 * eff.edhz26.thatPlayer.sacrificeAndReturnTogether builds `{"lower": "sacrificeReturnPair", a, b}`, `a`/`b` the two nouns of the sentence): the two targets the "choose"
 * sentence right before it announced (the second is a card in a graveyard of the controller of the first, lower/targets.ts#specOf), and the nouns must be those targets'
 * own card types; it becomes the `exchange` step of kind `sacrificeReturn` (effects/handlers/zones-status.ts). Anything else is manual.
 */
function lowerSacrificeReturnPair(d: Draft, seq: Unit[], u: Unit, i: number): void {
  if (u.manual !== undefined) return;
  const prev = seq[i - 1];
  const ids = prev !== undefined && prev.manual === undefined && chooseNode(prev) !== null ? (prev.targetIds ?? []) : [];
  const [sa, sb] = ids.map((id) => d.targets.find((t) => t.id === id));
  const node = u.steps.length === 1 && isRec(u.steps[0]) && u.steps[0]['lower'] === 'sacrificeReturnPair' ? u.steps[0] : undefined;
  const typesOf = (f: unknown): string => (isRec(f) && Array.isArray(f['types']) ? JSON.stringify([...f['types']].map(String).sort()) : '');
  const first = sa?.filter as unknown as Rec | undefined;
  const second = sb?.filter as unknown as Rec | undefined;
  const owner = second?.['owner'];
  const linked = isRec(owner) && owner['ref'] === 'controllerOf' && isRec(owner['object']) && owner['object']['ref'] === 'target' && owner['object']['id'] === sa?.id;
  const ok = node !== undefined && ids.length === 2 && sa !== undefined && sb !== undefined && sa.kind === 'object' && sb.kind === 'object' && sa.min === 1 && sa.max === 1 && sb.min === 1 && sb.max === 1
    && first !== undefined && second !== undefined && Object.keys(first).join() === 'types' && Object.keys(second).sort().join() === 'isCard,owner,types,zone' && second['zone'] === 'graveyard' && linked && typesOf(first) !== '' && typesOf(first) === typesOf(node['a']) && typesOf(second) === typesOf(node['b']);
  if (!ok || sa === undefined || sb === undefined) {
    setManual(u, { code: 'unbound-reference', reason: '"that player sacrifices the X and returns the X card" names no pair of targets announced just before it (CR 115.1, 608.2c)' });
    return;
  }
  // the prompts name the card type the nouns of the sentence say (the template can only place the phrases by their last words, "controls" and "graveyard")
  const type = String((first['types'] as unknown[])[0]).toLowerCase();
  sa.text = `target ${type} a player controls`;
  sb.text = `target ${type} card in that player's graveyard`;
  u.steps = [{ op: 'exchange', what: 'sacrificeReturn', a: { ref: 'target', id: sa.id }, b: { ref: 'target', id: sb.id } }];
}

export function lowerChoose(draft: Draft): Draft {
  const hasFight = (u: Unit): boolean => u.steps.some((s) => isRec(s) && s['lower'] === 'fightEachOther');
  const hasPair = (u: Unit): boolean => u.steps.some((s) => isRec(s) && s['lower'] === 'sacrificeReturnPair');
  if (!sequences(draft).some((seq) => seq.some((u) => chooseNode(u) !== null || hasFight(u) || hasPair(u)))) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) for (const u of seq) if (hasFight(u)) lowerFightEachOther(u);
  for (const seq of sequences(d)) seq.forEach((u, i) => { if (hasPair(u)) lowerSacrificeReturnPair(d, seq, u, i); });
  for (const seq of sequences(d)) {
    seq.forEach((u, i) => {
      if (u.manual !== undefined || chooseNode(u) === null) return;
      // std-costs-2 (CR 601.2c, 601.2b): "Choose target creature you own. If this spell was kicked, instead choose any number of target creatures you own.": the rider
      // only announces other targets in place of these when a cost decided at announcement was paid; both sentences are announcements (insteadChoose)
      const instead = insteadChoose(d, u, seq[i + 1]);
      const ids = [...(u.targetIds ?? []), ...(instead?.ids ?? [])];
      // r3-choose (CR 115.1, 608.2c): ... or a later understood sentence of the same instructions ("Choose target artifact card in your graveyard. You may sacrifice an
      // artifact. If you do, return the chosen card to the battlefield."): every target is still what an instruction of the ability acts on
      const later = seq.slice(instead !== null ? i + 2 : i + 1).filter((x) => x.manual === undefined);
      const named = targetIdsIn(later.map((x) => [x.steps, x.rider?.patch]));
      if (ids.length === 0 || !ids.every((id) => named.has(id))) {
        setManual(u, { code: 'unbound-reference', reason: '"choose ... target ..." with no understood sentence after it that names those targets (CR 115.1, 601.2c)' });
        return;
      }
      u.steps = thenRoll(u) ? [u.steps[1]!] : [];
      if (instead !== null) {
        // the targets of this sentence are chosen only when the cost was not paid (as lower/riders.ts#onlyIfOfReplaced does for an instruction replaced "instead")
        const not = { cond: 'not', of: JSON.parse(JSON.stringify(instead.cond)) } as unknown as NonNullable<Draft['targets'][number]['onlyIf']>;
        for (const id of u.targetIds ?? []) {
          const spec = d.targets.find((t) => t.id === id);
          if (spec !== undefined) spec.onlyIf = spec.onlyIf === undefined ? not : { cond: 'all', of: [spec.onlyIf, not] };
        }
        const r = seq[i + 1]!;
        delete r.rider;
        r.steps = [];
      }
    });
  }
  return d;
}
