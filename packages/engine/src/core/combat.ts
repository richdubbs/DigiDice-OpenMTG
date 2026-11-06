/**
 * Combat turn-based actions: beginning of combat (CR 507), declare attackers (CR 508.1) and declare blockers (CR 509.1).
 * Combat damage is in core/combat-damage.ts. These actions don't use the stack; the decision model asks the player only when there is
 * something to choose, and only legal choices are offered (rules/combat-rules.ts).
 *
 * R1 (M6-7a): requirements (CR 508.1d, 509.1c). The decisions list the requirements that apply, how many a legal declaration obeys and one such declaration
 * (rules/requirements.ts); an answer that obeys every restriction but fewer requirements is rejected and the decision stays open (CR 733). When the engine
 * can't know the maximum (a requirement it can't evaluate, manual text that mentions attacking or blocking, a search over its budget), the decision says so
 * before the choice (`unchecked`, and the prompt), the declaration is accepted, and a manual log line and a reminder chip until the end of combat follow:
 * never a wrong rejection, never a silent pass.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { CombatRequirement } from '../types/decisions';
import { charsOfObject } from '../rules/characteristics';
import { attackCandidates, attackersOf, bandsDenial, blockCandidates, blocksDenial } from '../rules/combat-rules';
import { bandOf, newCombat } from '../rules/combat-state';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { requirementHits } from '../statics/requirements';
import { holdStill } from '../statics/stable-scope';
import { attackPlan, blockPlan, requirementsDenial, uncheckedNotes, type Attack, type Block, type DeclarationPlan } from '../rules/requirements';
import { REQUIREMENT_CHIP } from '../rules/requirements-manual';
import { cantActAlone, declarationLimitDenial, declarationLimits, onlyAttacksAlone } from '../statics/hooks';
import { attackTaxes, blockTaxes } from '../statics/combat-tax';
import { decideTax, payTax, type TaxDecision } from './combat-tax';
import { takeAttackOptions } from './attack-options';
import { IllegalAction, type Game } from './game';

type Note = { sourceName: string; text: string };

/** The requirement fields of a declare decision (absent when no requirement applies); `unchecked` tells the player before the choice (design m6 3.9). */
function requirementFields<A>(plan: DeclarationPlan<A>, notes: Note[]): { requirements?: CombatRequirement[]; mustObey?: number; obeying?: A[]; unchecked?: Note[] } {
  return {
    ...(plan.requirements.length > 0 ? { requirements: plan.requirements } : {}),
    ...(plan.requirements.length > 0 && plan.mustObey !== null ? { mustObey: plan.mustObey } : {}),
    ...(plan.requirements.length > 0 && plan.obeying ? { obeying: plan.obeying } : {}),
    ...(notes.length > 0 ? { unchecked: notes } : {}),
  };
}

const UNCHECKED_PROMPT = ' Some requirements are not checked by the engine this time (see the notes): obey as many as the rules allow.';

/** CR 508.1d, 509.1c: what the engine could not check is the players' to settle: a manual log line and a reminder chip until the end of combat. */
function noteUnchecked(g: Game, player: PlayerId, rule: string, notes: Note[]): void {
  for (const n of notes) {
    g.log(n.text, { rules: [rule], level: 'manual' });
    // REQUIREMENT_CHIP: the next declare step does not read this chip as a manual restriction (rules/requirements-manual.ts)
    g.s.reminders = [...g.s.reminders, { id: `${REQUIREMENT_CHIP}${g.newEffectId()}`, text: n.text, sourceName: n.sourceName, controller: player, until: { d: 'endOfCombat' }, createdTurn: g.s.turn.number }];
  }
}

/**
 * edh-d-89 (CR 508.1a, 509.1a, 723.1; Master Warcraft): "you choose which creatures attack / block this turn": `who` makes the declare attackers or blockers decisions of the rest of the turn (read by
 * declareAttackers and declareBlockers below); the most recent such effect decides. The primitive behind effects/handlers/edh-d-89.ts and edh-combat-7.ts (design 8.5).
 */
export function chooseDeclarationsThisTurn(g: Game, what: 'attack' | 'block', who: PlayerId): void {
  if (what === 'attack') g.s.turn.attacksBy = who;
  else g.s.turn.blocksBy = who;
}

/** CR 507: the beginning of combat step starts the combat phase. (In a two-player game the non-active player is the defending player, CR 506.2.) */
export function beginCombat(g: Game): void {
  g.s.combat = newCombat(g.s);
}

/** The player, or the controller / protector of the planeswalker / battle, that an attack is aimed at (CR 508.5). */
function defendingPlayerFor(g: Game, defender: PlayerId | ObjectId): PlayerId {
  if (g.s.players.some((p) => p.id === defender)) return defender;
  const o = g.obj(defender);
  return o.protector !== undefined && charsOfObject(g.s, o).types.includes('Battle') ? o.protector : o.controller;
}

const defenderName = (g: Game, defender: PlayerId | ObjectId): string => (g.s.players.some((p) => p.id === defender) ? g.player(defender).name : g.nameOf(defender));

/** CR 508.1: the active player declares attackers. */
export function declareAttackers(g: Game): void {
  const ap = g.s.turn.activePlayer;
  const combat = (g.s.combat ??= newCombat(g.s)); // the beginning of combat step may have been skipped
  const offered = attackCandidates(g.s, ap);
  if (offered.length === 0) return; // nothing can attack: no decision, no attackers (CR 508.8)
  const plan = attackPlan(g.s, offered); // CR 508.1d
  const must = new Set(plan.requirements.filter((r) => r.group === undefined).map((r) => r.creature)); // edh-d-75: a group requirement ("attack with at least one creature") binds no one creature
  // FAST5 T37 (CR 506.5): "can't attack alone" is judged on the whole declaration below; the candidates say which creatures it concerns
  // r5-static (CR 508.1h): `taxed` when attacking any of its defenders has a cost; M12 gaps (CR 802.2, 508.1h): `taxedDefenders`, which of them (with several
  // opponents a tax protects its controller and their planeswalkers: an attack on another opponent is free)
  const taxedAt = (c: { id: ObjectId; defenders: (PlayerId | ObjectId)[] }): (PlayerId | ObjectId)[] => c.defenders.filter((d) => attackTaxes(g.s, [{ attacker: c.id, defender: d }]).length > 0);
  const candidates = offered.map((c) => {
    const taxed = taxedAt(c);
    return { ...c, ...(must.has(c.id) ? { mustAttack: true } : {}), ...(cantActAlone(g.s, 'attack', c.id) ? { onlyWithOthers: true } : {}), ...(onlyAttacksAlone(g.s, c.id) ? { onlyAlone: true as const } : {}), ...(taxed.length > 0 ? { taxed: true as const, taxedDefenders: taxed } : {}) };
  });
  const notes = uncheckedNotes('attack', plan);
  // r5-static (CR 508.1c): the declaration limits, as the pairs each counts (a client's hint; the bot keeps within them)
  const limits = declarationLimits(g.s, 'attack').map((l) => ({ max: l.max, pairs: candidates.flatMap((c) => c.defenders.filter((d) => l.counts(c.id, d) === true).map((d) => ({ attacker: c.id, defender: d }))) }));

  // edh-d-89 (CR 508.1a-b, 723.1; Master Warcraft): "you choose which creatures attack this turn": another player chooses the group of attackers (a player who left the game chooses nothing, CR 800.4a)
  const by = g.s.turn.attacksBy !== undefined && g.s.turn.attacksBy !== ap && !g.player(g.s.turn.attacksBy).hasLost ? g.s.turn.attacksBy : undefined;
  const rules = plan.requirements.length || notes.length ? ['CR 508.1', 'CR 508.1a', 'CR 508.1b', 'CR 508.1d'] : ['CR 508.1', 'CR 508.1a', 'CR 508.1b'];
  /** The whole declaration is checked against the restrictions and requirements (an illegal one is rejected and the decision stays open, CR 733). */
  const check = (ans: { attacks: Attack[]; bands?: ObjectId[][] }): void => {
    // edhv31 (CR 702.22c-d): the attacking bands of the declaration
    if (ans.bands !== undefined && ans.bands.length > 0) {
      const bad = bandsDenial(g.s, ans.attacks, ans.bands);
      if (bad) throw new IllegalAction(bad.message, bad.rules);
    }
    // CR 508.1d: as many requirements as possible are obeyed; an illegal declaration is rejected and the decision stays open (CR 733).
    const unmet = requirementsDenial('attack', plan, { attacks: ans.attacks as Attack[] });
    if (unmet) throw new IllegalAction(unmet.message, unmet.rules);
    // FAST5 T37 (CR 506.5, 508.1c): a creature that can't attack alone is not the only attacker. (A creature an attack requirement applies to is let through:
    // the requirement search does not know this restriction, and refusing both the lone attack and no attack would leave no legal declaration.)
    // (edh-d-75: nor one that belongs to a group requirement, "attack with at least one creature": the same search gap)
    const inGroup = plan.requirements.some((r) => r.allIfAny !== true && r.group?.includes(ans.attacks[0]?.attacker as string) === true); // edh-d-88 review: not War's Toll's conditional group (the empty declaration obeys it, so there is no search gap)
    if (ans.attacks.length === 1 && !must.has(ans.attacks[0]!.attacker) && !inGroup) {
      const alone = cantActAlone(g.s, 'attack', ans.attacks[0]!.attacker);
      if (alone) throw new IllegalAction(alone.message, alone.rules);
    }
    // edh-combat-6 (CR 506.5, 508.1c; Master of Cruelties): a creature that "can only attack alone" is not declared with another attacker (the requirement search does not know this restriction: requirements.
    // manual marks it unchecked, so a required creature is not forced into a declaration it breaks)
    if (ans.attacks.length > 1) {
      for (const a of ans.attacks) {
        const only = onlyAttacksAlone(g.s, a.attacker);
        if (only) throw new IllegalAction(only.message, only.rules);
      }
    }
    // r5-static (CR 508.1c): "No more than one creature can attack each combat" limits the whole declaration
    const limited = declarationLimitDenial(g.s, 'attack', ans.attacks.map((a) => ({ creature: a.attacker, defender: a.defender })));
    if (limited) throw new IllegalAction(limited.message, limited.rules);
  };

  // r5-static (CR 508.1h-j): a declaration with a cost the player doesn't pay is declared again (core/combat-tax.ts)
  let ans: { attacks: Attack[]; bands?: ObjectId[][] };
  let tax: TaxDecision;
  let tapping: ObjectId[] = [];
  for (;;) {
    ans = g.choose({
      kind: 'declareAttackers',
      player: ap,
      ...(by !== undefined ? { decidedBy: by } : {}), // edh-d-89: answered from that player's seat only (core/player-control.ts)
      prompt: by !== undefined
        ? `Declare attackers for ${g.player(ap).name}: choose which of their creatures attack (${g.player(ap).name} then chooses what each attacks when it can attack more than one).${notes.length ? UNCHECKED_PROMPT : ''}`
        : `Declare attackers: choose which creatures attack and what each attacks.${notes.length ? UNCHECKED_PROMPT : ''}`,
      candidates,
      ...(limits.length > 0 ? { limits } : {}),
      ...requirementFields(plan, notes),
      rules: by !== undefined ? [...rules, 'CR 723.1'] : rules,
    });
    check(ans);
    // edh-d-89 (CR 508.1b; Master Warcraft ruling 2008-04-01): the other player chose the complete group of attackers; the active player then chooses what each of them attacks (only asked when
    // one of them can attack more than one player, planeswalker or battle). The group stays the one chosen; the new declaration is checked again as a whole.
    if (by !== undefined) {
      const chosen = new Set(ans.attacks.map((a) => a.attacker));
      const group = candidates.filter((c) => chosen.has(c.id));
      if (group.some((c) => c.defenders.length > 1)) {
        const aim: { attacks: Attack[]; bands?: ObjectId[][] } = g.choose({
          kind: 'declareAttackers',
          player: ap,
          prompt: `${g.player(by).name} chose which of your creatures attack: choose which player, planeswalker or battle each of them attacks.${notes.length ? UNCHECKED_PROMPT : ''}`,
          candidates: group.map((c) => ({ ...c, mustAttack: true })),
          allAttack: true,
          ...(limits.length > 0 ? { limits } : {}),
          ...requirementFields(plan, notes),
          obeying: ans.attacks.map((a) => ({ attacker: a.attacker, defender: a.defender })), // a legal choice: the one the other player declared
          rules: ['CR 508.1b', 'CR 723.1'],
        });
        // review (CR 702.22d): the bands the caster announced stand only if they are still legal with what each creature now attacks: the combined declaration is checked as a whole
        const combined = { attacks: aim.attacks, ...(aim.bands !== undefined ? { bands: aim.bands } : ans.bands !== undefined ? { bands: ans.bands } : {}) };
        check(combined);
        ans = combined;
      }
    }
    // CR 508.1f, 508.1h: the creatures this declaration taps, then the total cost it has
    tapping = ans.attacks.map((a) => a.attacker).filter((id) => !g.obj(id).tapped && hookpoints.attackTaps(gameOf(g.s), id, ap, charsOfObject(g.s, g.obj(id))));
    tax = decideTax(g, ap, 'attack', attackTaxes(g.s, ans.attacks), tapping);
    if (tax.kind !== 'again') break;
  }
  noteUnchecked(g, ap, 'CR 508.1d', notes);
  if (ans.attacks.length === 0) {
    g.log(`${g.player(ap).name} declares no attackers.`, { rules: ['CR 508.8'], level: 'action' });
    g.emit({ type: 'attackersDeclared', attackers: [] });
    return;
  }
  // edh-d-75 (CR 508.1d, 506.4, 603.4; Firkraag, Cunning Instigator, ruling 2022-06-10): the attackers an attack requirement applied to as they were declared "had to attack this combat"; a requirement on the
  // player's whole group (Trove of Temptation) is no requirement of any one creature
  {
    const objectDefenders = [...new Set(offered.flatMap((c) => c.defenders).filter((d) => !g.s.players.some((p) => p.id === d)))];
    const hits = holdStill(g.s, () => requirementHits(g.s, 'attack', ans.attacks.map((a) => a.attacker), objectDefenders));
    const forced = [...new Set(hits.filter((h) => h.group === undefined || h.allIfAny === true).map((h) => h.subject))]; // edh-d-88: War's Toll's applies once one of the group attacks (it did)
    if (forced.length > 0) combat.forced = forced;
  }
  const declared: { attacker: ObjectId; defender: PlayerId | ObjectId }[] = [];
  const parts: string[] = [];
  for (const { attacker, defender } of ans.attacks) {
    const o = g.obj(attacker);
    const c = charsOfObject(g.s, o);
    // CR 508.1f: attackers become tapped (not a cost); vigilance prevents it (CR 702.20b, through rules/hookpoints.ts).
    if (tapping.includes(attacker) && !o.tapped) { // decided once above (CR 508.1f; the hook is asked once per attacker)
      o.tapped = true;
      g.emit({ type: 'tapped', objectId: attacker, asAttacker: true }); // edh-players-20 (CR 508.1f): Verity Circle
    }
    const band = (ans.bands ?? []).findIndex((b) => b.includes(attacker)); // edhv31 (CR 702.22c): the band this attacker was declared in
    const atPw = g.s.objects[defender] !== undefined && charsOfObject(g.s, g.s.objects[defender]!).types.includes('Planeswalker'); // edh-d-90 (CR 702.19e)
    combat.attackers.push({ id: attacker, defender, defendingPlayer: defendingPlayerFor(g, defender), blockedBy: [], blocked: false, ...(band >= 0 ? { band: band + 1 } : {}), ...(atPw ? { atPlaneswalker: true as const } : {}) });
    declared.push({ attacker, defender });
    parts.push(`${c.name || g.nameOf(attacker)} (${defenderName(g, defender)})`);
  }
  payTax(g, ap, 'attack', tax); // r5-static: CR 508.1i-j, after the attackers are tapped (CR 508.1f)
  combat.attacked = true; // CR 508.1k, 508.8
  g.log(`${g.player(ap).name} attacks with ${parts.join(', ')}.`, { rules: ['CR 508.1', 'CR 508.1k'], level: 'action' });
  takeAttackOptions(g, ap, declared.map((d) => d.attacker)); // std-ry8 (CR 508.1, 701.43a, 702.154a): exert and enlist, as the creatures attack
  g.emit({ type: 'attackersDeclared', attackers: declared });
}

/** CR 509.1: each defending player declares blockers. */
export function declareBlockers(g: Game): void {
  const combat = g.s.combat;
  if (!combat) return;
  // M12-2 (m12 design E16): CR 802.4, each defending player declares blockers in APNAP order (CR 101.4); a player who left the game declares none (CR 800.4a:
  // their creatures left with them). With one defending player (every two-player game) this is that player, as before.
  const order = g.apnap();
  const defenders = [...new Set(combat.attackers.map((a) => a.defendingPlayer))].filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // edh-d-89 (CR 509.1a, 723.1; Master Warcraft): "you choose which creatures block this turn": the turn-long chooser, unless an effect of this combat named one (Odric's trigger always comes later)
  const blocksBy = combat.blocksBy ?? g.s.turn.blocksBy;
  for (const dp of defenders) {
    const { candidates: offered, needsMultiple, maxBlockers, minBlockers } = blockCandidates(g.s, dp);
    if (offered.length === 0) {
      // std-rx35 (CR 509.1h): a defending player with no creature that can block declares none; its attackers are unblocked creatures all the same
      const unblocked = combat.attackers.filter((a) => a.defendingPlayer === dp && !a.blocked).map((a) => a.id);
      if (unblocked.length > 0) g.emit({ type: 'blockersDeclared', blocks: [], unblocked });
      continue;
    }
    const plan = blockPlan(g.s, attackersOf(g.s, dp), offered); // CR 509.1c
    // FAST5 T37 (CR 506.5, 509.1b): "can't block alone" is judged on the declaration below (one defending player: with several, the other declarations are not known yet)
    const aloneCheck = defenders.length === 1;
    const alone = aloneCheck ? offered.map((c) => (cantActAlone(g.s, 'block', c.id) ? { ...c, onlyWithOthers: true } : c)) : offered;
    // r5-static (CR 509.1d): `taxed` when blocking with it has a cost
    const candidates = alone.map((c) => (blockTaxes(g.s, c.attackers.map((a) => ({ blocker: c.id, attacker: a }))).length > 0 ? { ...c, taxed: true as const } : c));
    const notes = uncheckedNotes('block', plan);
    // r5-static (CR 509.1b): how many more blockers each declaration limit allows (the blockers already declared by other defending players count)
    // edh-combat-6 (CR 509.1b): a per-player limit counts the player's own blockers only
    const limits = declarationLimits(g.s, 'block').map((l) => ({
      max: Math.max(0, l.max - combat.blockers.filter((b) => l.counts(b.id, null) === true && (!l.perPlayer || g.s.objects[b.id]?.controller === dp)).length), blockers: candidates.filter((c) => l.counts(c.id, null) === true).map((c) => c.id),
    }));
    // r5-static (CR 509.1d-f): a declaration with a cost the player doesn't pay is declared again (core/combat-tax.ts)
    let ans: { blocks: Block[] };
    let tax: TaxDecision;
    for (;;) {
      ans = g.choose({
        kind: 'declareBlockers',
        player: dp,
        ...(blocksBy !== undefined && blocksBy !== dp && !g.player(blocksBy).hasLost ? { decidedBy: blocksBy } : {}), // edh-combat-7 (CR 509.1, 723.1; Odric, Master Tactician): another player chooses the blocks
        prompt: `Declare blockers: choose which creatures block and which attacker each blocks.${notes.length ? UNCHECKED_PROMPT : ''}`,
        candidates,
        needsMultiple,
        ...(maxBlockers.length > 0 ? { maxBlockers } : {}),
        ...(minBlockers.length > 0 ? { minBlockers } : {}), // FAST5 T57
        ...(limits.length > 0 ? { limits } : {}), // r5-static
        ...requirementFields(plan, notes),
        rules: plan.requirements.length || notes.length ? ['CR 509.1', 'CR 509.1a', 'CR 509.1b', 'CR 509.1c'] : ['CR 509.1', 'CR 509.1a', 'CR 509.1b'],
      });
      // The whole declaration is checked (menace needs two blockers, CR 702.111b); an illegal one is rejected and the decision stays open (CR 733).
      const denial = blocksDenial(g.s, dp, ans.blocks) ?? requirementsDenial('block', plan, { blocks: ans.blocks as Block[] }); // then CR 509.1c
      if (denial) throw new IllegalAction(denial.message, denial.rules);
      // FAST5 T37 (CR 506.5, 509.1b): a creature that can't block alone is not the only blocker (a blocker a block requirement applies to is let through, as above)
      const blockers = [...new Set(ans.blocks.map((b) => b.blocker))];
      if (aloneCheck && blockers.length === 1 && !plan.requirements.some((r) => r.creature === blockers[0])) {
        const alone = cantActAlone(g.s, 'block', blockers[0]!);
        if (alone) throw new IllegalAction(alone.message, alone.rules);
      }
      // r5-static (CR 509.1b): "No more than one creature can block each combat" (all defending players' blockers together)
      const limited = declarationLimitDenial(g.s, 'block', [...combat.blockers.map((b) => b.id), ...ans.blocks.map((b) => b.blocker)].map((creature) => ({ creature, defender: null })));
      if (limited) throw new IllegalAction(limited.message, limited.rules);
      tax = decideTax(g, dp, 'block', blockTaxes(g.s, ans.blocks), []); // CR 509.1d: blocking taps nothing
      if (tax.kind !== 'again') break;
    }
    noteUnchecked(g, dp, 'CR 509.1c', notes);
    payTax(g, dp, 'block', tax); // CR 509.1e-f
    const parts: string[] = [];
    for (const { blocker, attacker } of ans.blocks) {
      const att = combat.attackers.find((a) => a.id === attacker)!;
      att.blockedBy.push(blocker);
      let b = combat.blockers.find((x) => x.id === blocker);
      if (!b) combat.blockers.push((b = { id: blocker, blocking: [], defendingPlayer: dp }));
      b.blocking.push(attacker);
      parts.push(`${g.nameOf(blocker)} blocks ${g.nameOf(attacker)}`);
    }
    // edhv31 (CR 702.22h): if an attacking creature becomes blocked by a creature, each other creature in its band becomes blocked by that same creature
    const banded: Block[] = [];
    for (const { blocker, attacker } of ans.blocks) {
      for (const m of bandOf(g.s, attacker)) {
        if (m.id === attacker || m.blockedBy.includes(blocker) || m.defendingPlayer !== dp) continue;
        m.blockedBy.push(blocker);
        combat.blockers.find((x) => x.id === blocker)!.blocking.push(m.id);
        banded.push({ blocker, attacker: m.id });
        parts.push(`${g.nameOf(blocker)} blocks ${g.nameOf(m.id)} (banded)`);
      }
    }
    // CR 509.1h: an attacker with blockers declared for it becomes blocked; this stays even if the blockers are removed from combat.
    for (const att of combat.attackers) if (att.defendingPlayer === dp && att.blockedBy.length > 0) att.blocked = true;
    g.log(ans.blocks.length ? `${g.player(dp).name} blocks: ${parts.join('; ')}.` : `${g.player(dp).name} declares no blockers.`, { rules: ['CR 509.1', 'CR 509.1g', 'CR 509.1h'], level: 'action' });
    // std-rx35 (CR 509.1h): the attackers of this defending player that became unblocked creatures ("whenever ~ attacks and isn't blocked")
    const unblocked = combat.attackers.filter((a) => a.defendingPlayer === dp && !a.blocked).map((a) => a.id);
    g.emit({ type: 'blockersDeclared', blocks: [...ans.blocks, ...banded], ...(unblocked.length > 0 ? { unblocked } : {}) });
  }
}
