/**
 * Lasting effects, delayed and reflexive triggers, and the game itself (WP2): effect, delay, reflexive, extraTurn, extraPhase, endTurn, winGame,
 * loseGame, createEmblem, rollDie, flipCoin, clash, designate, action (CR 611, 603.7, 603.12, 500.7, 104, 114, 705, 706, 701).
 */
import { creatureCastThisWayGains } from './fold-edhd97'; // edh-d-97
import { preventCombatExceptEnchanted } from './fold-edhv80'; // edh-c-80
import { ofThoseTokens, rowLabel, rowSep } from './edhn55';
import type { EffectStep, EventPattern, KeywordActionName, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, RestrictionDef, StaticEffect } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { doubledBy, doubledText } from './double';
import { K } from './kernel';
import { countParts } from './qty'; // edh-d-56
import { identityOf, isPlayerRef, markTriggerRoles, spellOrPermanentOf, withSubjects } from './refs';
import { bind, byPlayer, halfThatManyCounters, infoOfRef, isComputed, movedCondFocus, timesWords, whereX, type StepOf } from './steps-util';
import { gainControlWhileAttached, playerCantAttackYou } from './fold-stdcombat1';
import { playerCantAttackYouOnly } from './fold-edhd33'; // edh-d-33
import { didPlayersCantAttackYou } from './fold-edhp11'; // edh-players-11
import { eachNonlandTypePermit, nextDrawExileTopPlay } from './fold-edhzones27'; // edh-zones-27
import { continuousHave, ptPredicate } from './mods';
import { quotedAbility, quotedListItem } from './quote';
import { attackOrBlockIfAble, castThenActivateNonMana, damageUnpreventable, lasting, damageUnpreventableText, graveyardPermitsSentence, lastingCants, lastingCombatToAndBy, sharedEffectSubject, topPermitsSentence } from './stat';
import { absorb, cloneState, nestedState, objKey, playerKey, withVariants, type RenderState } from './state';
import { playerCantAttack, playerCantAttackText } from './fold-trek8';
import { possessiveStep } from './turn';
import { controlledGroup, lockedGroup, swappedGroups } from '../model/focus';
import { alt, firstAlt, hoistFinalPeriod, joinList, NoRenderer, numWord, pluralize } from './text';
import { keywordList } from './kw';
import { nextTimeCombatToPlayers, preventWhenPreventedEachDeals, redirectAllYouAnd } from './edhn60'; // edh-next-60

/**
 * edh-next-128 (CR 608.2c, 706.2; Revivify): a row "Return those cards from your graveyard to the battlefield." of a roll that adds the number of cards of your graveyard of a description: the
 * row's one move of each such card (parser/lower/die-roll.ts reads the sentence so) is also said with "those cards".
 */
function thoseCountedCards(s: Extract<EffectStep, { op: 'rollDie' }>, k: number): string | null {
  const row = s.table![k]!;
  const m = s.modifier as { q?: string; of?: { ref?: string; filter?: unknown } } | undefined;
  const only = row.do.length === 1 ? row.do[0]! : undefined;
  if (m?.q !== 'count' || m.of?.ref !== 'each' || only?.op !== 'move' || only.what.ref !== 'each' || JSON.stringify(only.what.filter) !== JSON.stringify(m.of.filter)) return null;
  const f = m.of.filter as { zone?: unknown; owner?: unknown };
  if (f.zone !== 'graveyard' || f.owner !== 'you' || Object.keys(only).some((x) => !['op', 'what', 'to'].includes(x))) return null;
  const to = JSON.stringify(only.to);
  return to === '{"zone":"battlefield","controller":{"ref":"you"}}' ? 'return those cards from your graveyard to the battlefield' : to === '{"zone":"hand"}' ? 'return those cards from your graveyard to your hand' : null;
}
import { lookCastPermanentsAnyColor } from './fold-edhn123'; // edh-next-123

const hasBreak = (text: string): boolean => /\. /.test(firstAlt(text));

/**
 * r4-repl (CR 614.1a, 608.2n, 611.2c): "Whenever you cast a multicolored instant or sorcery spell from your hand, exile that spell instead of putting it into your
 * graveyard as it resolves." (Lilah, Undefeated Slickshot; the template eff.r4repl.castSpell.exileAsItResolves): a replacement of the move of the spell the cast
 * trigger names from the stack to a graveyard as it resolves (`cause: 'resolve'`), sending it to exile. null for anything else.
 */
function spellExiledAsItResolves(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 1 || s.duration.d !== 'permanent' || s.as !== undefined) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || e.condition !== undefined || e.shield !== undefined || e.selfReplacement === true) return null;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || ev.from !== 'stack' || ev.to !== 'graveyard' || ev.cause !== 'resolve' || ev.byOpponent !== undefined) return null;
  // edh-next-105 (Feather, the Redeemed; ruling 2021-03-19): a spell you own only (`owner: 'you'`), the one subject beside the plain one
  const ownSpell = JSON.stringify(ev.subject) === JSON.stringify({ is: { ref: 'event', role: 'spell' }, owner: 'you' });
  if (!ownSpell && JSON.stringify(ev.subject) !== JSON.stringify({ is: { ref: 'event', role: 'spell' } })) return null;
  const { then, link, ...body } = e.body as Extract<typeof e.body, { b: 'modify' }>;
  if (JSON.stringify(body) !== JSON.stringify({ b: 'modify', destination: { zone: 'exile' } })) return null;
  // edh-next-127 (CR 607.2a; River Song's Diary): the card exiled this way recorded as "exiled with ~" (the link parser/parse.ts writes when no other instruction of the face exiles); said by
  // the ability that reads the link, never here; only with no follow-up
  if (link !== undefined && (link !== 'exiled' || then !== undefined)) return null;
  if ((st.trigger ?? []).length === 0 || !(st.trigger ?? []).every((p) => p.ev === 'cast')) return null;
  // edh-next-127 (CR 614.1a, 608.2n, 400.3; River Song's Diary, family spell-exiled-as-it-resolves-a-graveyard): a spell any player may have cast goes to its OWNER's graveyard, so Oracle
  // says "a graveyard" there, and names the spell "it" as well as "that spell"; only when the caster is not "you"
  // edh-d-101 (CR 614.1a, 608.2n, 616.1, 607.2a; Forger's Foundry, template rid.edhd101.mana.youSpend.mayExileSpellAsItResolves): "you may exile that spell instead of putting it into its owner's
  // graveyard as it resolves" (`optional`: the spell's controller, you, chooses as the replacement would apply), what it exiles recorded as exiled with the source (`link`, CR 607.2a). Only that
  // plain form; otherwise the optional replacement is no reading here (combined copy: a link WITHOUT `optional` is edh-next-127's River Song's Diary, read below)
  if (e.optional === true) {
    if (then !== undefined || ownSpell || (link !== undefined && link !== 'exiled')) return null;
    return `you may exile that spell instead of putting it into ${alt("its owner's", 'your')} graveyard as it resolves`;
  }
  const anyCaster = (st.trigger ?? []).every((p) => p.ev === 'cast' && p.player !== 'you');
  const head = anyCaster && !ownSpell
    ? alt('exile that spell instead of putting it into your graveyard as it resolves', 'exile it instead of putting it into a graveyard as it resolves', 'exile that spell instead of putting it into a graveyard as it resolves')
    : 'exile that spell instead of putting it into your graveyard as it resolves';
  if (then === undefined) return ownSpell ? null : head;
  // std-exile-play-2-2 (CR 614.1a, 122.1, 400.7): "exile that card with a dream counter on it instead of putting it into your graveyard as it resolves" (Goliath
  // Daydreamer): one counter put on the card it became in exile, once it was exiled this way (effects/bodies/m5.ts#thenAfterMove)
  const put = then.do.length === 1 ? then.do[0]! : undefined;
  if (!ownSpell && put?.op === 'putCounters' && put.count === 1 && typeof put.kind === 'string' && JSON.stringify(put.on) === JSON.stringify({ ref: 'bound', name: then.as })
    && Object.keys(put).every((k) => ['op', 'on', 'kind', 'count'].includes(k))) {
    return `exile that card with ${/^[aeiou]/.test(put.kind) ? 'an' : 'a'} ${put.kind} counter on it instead of putting it into your graveyard as it resolves`;
  }
  // edh-next-105 (CR 614.1a, 603.7, 400.7; Feather, the Redeemed; the template eff.edhn105.castSpell.exileAsItResolves.thenReturnNextEnd): "exile that card instead of putting it into your
  // graveyard as it resolves. If you do, return it to your hand at the beginning of the next end step." (the card it became in exile, back to its owner's hand: the spell was cast by you)
  if (ownSpell && JSON.stringify(then) === JSON.stringify({ as: then.as, do: [{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [{ op: 'move', what: { ref: 'bound', name: then.as }, to: { zone: 'hand', owner: { ref: 'you' } } }], capture: [then.as] }] })) {
    return 'exile that card instead of putting it into your graveyard as it resolves. if you do, return it to your hand at the beginning of the next end step';
  }
  // std-rB (CR 614.1a, 608.2c, 400.7; parser/lower/conditions.ts#absorbIntoReplacement): "... as it resolves. If you do, it becomes plotted." (Lilah, Undefeated
  // Slickshot): what happens once the spell was exiled this way, to the card it became in exile ("it")
  if (ownSpell) return null;
  bind(st, then.as, { nouns: ['card'], plural: false });
  return `${head}. if you do, ${K.steps(then.do, st)}`;
}

/**
 * r4-repl (CR 614.1c, 614.12, 611.2c): an `effect` step whose one effect replaces the entering of the spell a cast trigger names (`subject: {is: {ref: 'event',
 * role: 'spell'}}`, fixed as the effect is created) with an entering body of one kind of counters: "that creature enters with an additional +1/+1 counter on it",
 * "... for each Dog and/or Wolf you control", "that creature enters with X additional +1/+1 counters on it, where X is ...". Only a creature spell's cast
 * ("that creature"); null for anything else.
 */
function spellEntersWith(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 1 || s.duration.d !== 'permanent' || s.as !== undefined) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || [ev.to].flat().join() !== 'battlefield' || ev.from !== undefined || JSON.stringify(ev.subject) !== JSON.stringify({ is: { ref: 'event', role: 'spell' } })) return null;
  const b = e.body;
  if (b.b !== 'enters' || Object.keys(b).some((k) => k !== 'b' && k !== 'counters') || b.counters?.length !== 1) return null;
  // edh-d-31 (Chocobo Camp, Yuna Grand Summoner): a creature spell of a subtype too ("a Bird creature spell"); edh-next-70: and its mana value (Runadi, "a creature spell with mana value 5 or greater"); nothing else of the spell's description
  const casts = (st.trigger ?? []).every((p) => p.ev === 'cast' && (p.spell?.types ?? []).length === 1 && p.spell!.types![0] === 'Creature' && Object.keys(p.spell!).every((k) => k === 'types' || k === 'subtypes' || k === 'manaValue'));
  if ((st.trigger ?? []).length === 0 || !casts) return null;
  const { kind, count } = b.counters[0]!;
  // edh-d-31 (family next-cast-enters): the spell of the cast is "that creature" or "it", and the counters "an additional" one or a fixed number of them
  const spell = alt('that creature', 'it');
  if (count === 1) return `${spell} enters with an additional ${kind} counter on it`;
  if (typeof count === 'number' && count >= 2 && count <= 10 && Number.isInteger(count)) return `${spell} enters with ${count} additional ${kind} counters on it`;
  if (typeof count === 'object' && count.q === 'count' && count.of.ref === 'each' && 'filter' in count.of) {
    return `that creature enters with an additional ${kind} counter on it for each ${K.np(count.of.filter, st, { det: 'none', forEach: true })}`;
  }
  if (typeof count === 'object') return `that creature enters with X additional ${kind} counters on it, where X is ${K.qty(count, st)}`;
  return null;
}

/**
 * edh-players-23 (CR 614.1c, 614.12, 611.2a; Nahiri's Lithoforming; the template eff.edhp23.filter.enterTapped.thisTurn): "Lands you control enter tapped this turn.": one lasting replacement of the
 * entering of permanents of a description, each entering tapped, for the turn. null for anything else.
 */
function entersTappedThisTurn(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 1 || s.duration.d !== 'endOfTurn' || s.as !== undefined) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || [ev.to].flat().join() !== 'battlefield' || ev.from !== undefined || Object.keys(ev).some((k) => !['ev', 'subject', 'to'].includes(k))) return null;
  if (JSON.stringify(e.body) !== JSON.stringify({ b: 'enters', tapped: true })) return null;
  return `${K.np(ev.subject, st, { det: 'none', plural: true })} enter tapped this turn`;
}

/**
 * trek-16 (CR 603.2d, 611.2a, 613.1f): "For as long as ~ remains tapped, if a triggered ability of that creature triggers, that ability triggers an additional time." (Lwaxana
 * Troi, Charming Guest; the template eff.trek16.lasting.triggersAdditionalTime): one continuous effect on one object that gives it the static ability `triggerMod` of its own
 * triggered abilities, once more, for the duration said first. null for anything else.
 */
function triggersAdditionalTime(s: StepOf<'effect'>, st: RenderState): string | null {
  const e = s.effects.length === 1 ? s.effects[0]! : undefined;
  if (e?.s !== 'continuous' || e.cda === true || e.mods.length !== 1 || s.duration.d === 'permanent' || e.affects.ref === 'each' || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) return null;
  const m = e.mods[0]!;
  if (m.layer !== 6 || m.add?.length !== 1 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add')) return null;
  const a = m.add[0]!;
  if (a.kind !== 'static' || a.effects.length !== 1 || a.condition !== undefined || a.zone !== undefined) return null;
  const x = a.effects[0]!;
  if (x.s !== 'triggerMod' || JSON.stringify(x.abilitiesOf) !== '{"self":true}' || x.additional !== 1 || Object.keys(x).some((k) => !['s', 'abilitiesOf', 'additional'].includes(k))) return null;
  const subj = K.obj(e.affects as ObjRef, st, 'object');
  if (subj.plural) return null;
  return `${K.dur(s.duration, st)}, if a triggered ability of ${subj.text} triggers, that ability triggers an additional time`;
}

/**
 * FAST5 T45: the delayed trigger "when you next cast a spell this turn" (no restriction on the spell) that copies the spell once: nothing else on the event, the
 * copy, or the duration (triggers/delayed.ts, `once`). Anything more stays in the "when you next cast ..." wording.
 */
function isNextSpellCopy(s: StepOf<'delay'>, c: StepOf<'copy'>): boolean {
  if (s.when.at !== 'event' || s.duration?.d !== 'endOfTurn') return false;
  const ev = s.when.event as unknown as Record<string, unknown>;
  const keys = Object.keys(ev).sort().join(',');
  const copyKeys = Object.keys(c).filter((k) => k !== 'newTargets' && k !== 'span' && k !== 'as').sort().join(',');
  const what = c.what as unknown as Record<string, unknown>;
  // edh-next-65 (CR 603.7b, 707.10; Sea Gate Stormcaller): and with a description of the spell, "copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it"
  // (the copy's count is `count` 1 or 2 only where the caller reads it: `copyKeys` allows it, the callers check it)
  return (keys === 'ev,player' || keys === 'ev,player,spell') && ev['ev'] === 'cast' && ev['player'] === 'you' && /^op,(count,)?result,what,who$/.test(copyKeys) && c.result === 'spell' && c.who.ref === 'you' && what['ref'] === 'event' && what['role'] === 'spell';
}

/**
 * r5-refs: a delayed trigger that waits for an event every time until its controller's next turn ("Until your next turn, whenever a creature attacks you, ..."); std-rt
 * (CR 603.7b, 611.2a): or until the end of that turn ("Until the end of your next turn, whenever you cast a spell, ...", Season of the Bold). The leading words, or null.
 */
function untilYourNextTurn(s: StepOf<'delay'>): string | null {
  const d = s.duration;
  if (s.when.at !== 'event' || s.once === true || d === undefined) return null;
  if (d.d === 'untilNextTurn' && d.whose.ref === 'you') return 'until your next turn';
  if (d.d === 'endOfNextTurn' && d.whose.ref === 'you') return 'until the end of your next turn';
  return null;
}

/** edh-d-90 (Nuka-Nuke Launcher): the counters of "that player gets N <kind> counters whenever they cast a spell" until the end of the defending player's next turn, or null. */
function defendersNextTurnCounters(s: StepOf<'delay'>): string | null {
  const d = s.duration;
  const only = s.do.length === 1 ? s.do[0]! : undefined;
  if (s.when.at !== 'event' || s.when.or !== undefined || s.once === true || s.batch === true || s.capture !== undefined || s.targets !== undefined || d?.d !== 'endOfNextTurn' || d.whose.ref !== 'defending') return null;
  if (JSON.stringify(s.when.event) !== '{"ev":"cast","player":{"ref":"defending"}}' || only?.op !== 'putCounters' || JSON.stringify(only.on) !== '{"ref":"event","role":"player"}') return null;
  const n = only.count;
  if (typeof n !== 'number' || n < 1 || only.kind === 'any' || Object.keys(only).some((k) => !['op', 'on', 'kind', 'count', 'span'].includes(k))) return null;
  return n === 1 ? `a ${only.kind} counter` : `${n} ${only.kind} counters`;
}

/** "at the beginning of the next end step" / "at end of combat" / "when ~ leaves the battlefield this turn". */
/** r4-fxb: the steps an `extraStep` may add, as Oracle names them before "step". */
const EXTRA_STEP_WORDS: Partial<Record<string, string>> = { untap: 'untap' /* edh-misc-5 */, upkeep: 'upkeep', draw: 'draw', end: 'end', beginCombat: 'beginning of combat' };

function delayedLead(s: StepOf<'delay'>, st: RenderState): string {
  const w = s.when;
  const limited = s.duration !== undefined && s.duration.d !== 'permanent';
  // r5-refs (CR 603.7b, 611.2a): "Until your next turn, whenever ..." waits for every such event until the controller's next turn begins (core/durations.ts#expireAtTurnStart);
  // it is only ever written in front of its effect (the delay renderer below)
  const nextTurn = untilYourNextTurn(s);
  if (nextTurn !== null) return `${nextTurn}, whenever ${K.events([(w as { event: EventPattern }).event], st, 'present', { batch: s.batch === true, ...(s.wholeBatch === true ? { wholeBatch: true } : {}) })}`;
  // CR 603.7b: a stated duration ("this turn") is the only way for a delayed trigger to trigger more than once, so it is part of the event's words
  // edh-combat-6 (CR 603.7b, 511.3; Stensian Sanguinist): "Whenever that creature deals combat damage to a player this combat, ...": the same delayed trigger of an event, until end of combat
  if (limited && ((w.at !== 'event' && w.at !== 'step') || (s.duration!.d !== 'endOfTurn' && !(s.duration!.d === 'endOfCombat' && w.at === 'event')))) throw new NoRenderer(`duration ${s.duration!.d} on a delayed trigger`);
  // r4-fxb (CR 603.7b, 506.1): "At the beginning of each combat this turn, ...": a step trigger that lasts the turn fires at each beginning of combat step of it,
  // the added combat phases' too (triggers/delayed.ts#collectDelayed); only that step, for no particular player
  if (limited && w.at === 'step') {
    // std-library-1 (CR 603.7b, 506.1, 507.1): "At the beginning of the next combat phase this turn, ..." (Feral Encounter): the first beginning of combat step after the
    // trigger was created, this turn only, once (parser template dl.stdlib1.nextCombat.thisTurn.lead)
    // edh-combat-5 (CR 500.8, 603.7a): "At the beginning of that combat" (Moraug, Fury of Akoum), the combat phase an earlier step of the same ability added
    if (w.step === 'beginCombat' && w.phase === 'added' && w.whose === undefined && w.next === undefined && w.turn === undefined && s.once === true) return 'at the beginning of that combat';
    if (w.phase !== undefined) throw new NoRenderer('a delayed trigger of an added phase other than "at the beginning of that combat"');
    // edh-next-83 (CR 603.7a-b, 505.1; Vivien's Stampede, template dl.edhn83.nextMain.thisTurn.lead): the first main phase (either) after the trigger was created, this turn only, once
    if (w.anyMain === true && w.step === 'main1' && w.whose === undefined && w.next === true && w.turn === undefined && s.once === true) return 'at the beginning of the next main phase this turn';
    // edh-d-61 (CR 603.7a-b, 505.1; Conduit of Storms, template dl.edhd61.yourNextMain.thisTurn.tail): "add {R} at the beginning of your next main phase this turn": the first main phase (either) of your turn after the trigger was created, once
    if (w.anyMain === true && w.step === 'main1' && w.whose === 'you' && w.next === true && w.turn === undefined && s.once === true) return 'at the beginning of your next main phase this turn';
    if (w.step === 'beginCombat' && w.whose === undefined && w.next === true && w.turn === undefined && s.once === true) return alt('at the beginning of the next combat phase this turn', 'at the beginning of the next combat this turn'); // trek-8: Oracle also prints it without "phase" (The Wrath of Khan)
    if (w.step !== 'beginCombat' || w.whose !== undefined || w.next === true || w.turn !== undefined || s.once === true) throw new NoRenderer('a step trigger with a duration other than "each combat this turn"');
    return 'at the beginning of each combat this turn';
  }
  switch (w.at) {
    case 'step':
      if (w.step === 'endCombat') return alt('at end of combat', 'at the end of combat');
      // FAST5 T36 (CR 500.7, 603.7a): the end step of the turn right after this one, "that turn" once an extra turn was taken
      if (w.turn === 'next') {
        // w8-followups (CR 500.9, 500.10, 603.7a): T3's "at the beginning of the next turn's upkeep" is the upkeep of the turn after this one, not an additional upkeep
        // step added to this turn after the trigger was created
        if (w.step === 'upkeep' && w.next === true && w.whose === undefined) return "at the beginning of the next turn's upkeep";
        if (w.step !== 'end' || w.whose !== undefined) throw new NoRenderer('a delayed trigger of the next turn other than its end step or upkeep');
        return "at the beginning of that turn's end step";
      }
      // r4-fxz (CR 603.7a, 513.1): the end step of your next turn (a later turn, never this one)
      if (w.turn === 'later') {
        // edh-d-55 (CR 603.7a, 508.1; Meandering Towershell): and the declare attackers step on your next turn
        if ((w.step !== 'end' && w.step !== 'declareAttackers') || w.whose !== 'you' || w.next !== undefined) throw new NoRenderer('a delayed trigger of a later turn other than the end step or declare attackers step on your next turn');
        return `at the beginning of the ${w.step === 'end' ? 'end' : 'declare attackers'} step on your next turn`;
      }
      // T3 (push wave): a delayed upkeep trigger fires at the first upkeep after the step it was created in (triggers/delayed.ts#fires), "the next upkeep" (CR 603.7a,
      // 503.1). w8-followups: not "the next turn's upkeep", which T3 now builds with `turn: 'next'`: the two differ when an additional upkeep step is added to this
      // turn after the trigger was created (CR 500.9, 500.10)
      if (w.step === 'upkeep' && w.next === true && (w.whose === undefined || w.whose === 'any')) return 'at the beginning of the next upkeep';
      // r5-fxb (CR 505.1, 603.7a): "at the beginning of your next main phase": either main phase
      if (w.anyMain === true) {
        if (w.step !== 'main1' || w.next !== true || w.whose !== 'you' || w.turn !== undefined) throw new NoRenderer('a delayed main phase trigger other than "your next main phase"');
        return 'at the beginning of your next main phase';
      }
      return `at the beginning of ${possessiveStep(w.step, w.whose, st, w.next === true)}`;
    case 'endOfCombat': return alt('at end of combat', 'at the end of combat');
    case 'event': {
      // edh-d-100 (CR 603.7c, 400.7; Havengul Lich): "When you cast it this turn": the cast of the card the ability's target names, once (rules/filter.ts, `sameCardAs`)
      const sameCard = w.event.ev === 'cast' ? (w.event.spell as { sameCardAs?: { ref?: string } } | undefined)?.sameCardAs : undefined;
      if (s.once === true && limited && w.or === undefined && sameCard?.ref === 'target' && JSON.stringify(w.event) === JSON.stringify({ ev: 'cast', player: 'you', spell: { sameCardAs: sameCard } })) return 'when you cast it this turn';
      let ev = K.events([w.event, ...(w.or ?? [])], st, 'present', { batch: s.batch === true, ...(s.wholeBatch === true ? { wholeBatch: true } : {}) });
      // FAST5 T45 (CR 603.7b): a delayed trigger that waits for the NEXT event of the turn and then ends: "when you next cast an instant or sorcery spell this turn"
      if (s.once === true) {
        // r5-mech (CR 603.7b, 702.177a): also "when you next activate an exhaust ability that isn't a mana ability this turn" (Pit Automaton)
        // std-r9 (CR 603.7b, 508.1, 603.2c): "when you next attack this turn" (All-Out Assault), the next declaration of attackers by you, one occurrence
        if (limited && s.batch === true && JSON.stringify(w.event) === JSON.stringify({ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 } })) ev = 'you next attack';
        // std-rx32 (CR 603.7c): "When you lose control of that Equipment this turn" (Stolen Uniform): a "when" of one object's change of control, once
        else if (limited && w.event.ev === 'controlChange' && ev.startsWith('you lose control of ')) return `when ${ev} this turn`;
        // edh-d-89 (CR 603.7c, 510.2; Optimus Prime, Autobot Leader): "When that creature deals combat damage to a player this turn, ...": one object's next combat damage to a player this turn, once
        else if (limited && s.duration!.d === 'endOfTurn' && w.or === undefined && w.event.ev === 'damage' && w.event.combat === true && (w.event.source as { is?: unknown } | undefined)?.is !== undefined
          && Object.keys(w.event.source ?? {}).length === 1 && JSON.stringify(w.event.recipient) === '{"player":"any"}' && Object.keys(w.event).every((k) => ['ev', 'source', 'combat', 'recipient'].includes(k))) return `when ${ev} this turn`;
        else {
          // edh-d-50 (CR 603.7b, 602.2b; Dynaheir, Invoker Adept): "when you next activate an ability that isn't a mana ability this turn by spending four or more mana to activate it": the turn words stand before the cost
          const spent = / by spending .* to activate it$/.exec(ev);
          if (limited && w.or === undefined && w.event.ev === 'activate' && spent !== null && ev.startsWith('you activate ')) return `when ${ev.slice(0, spent.index).replace(/^you activate /, 'you next activate ')} this turn${spent[0]}`;
          const verb = ev.startsWith('you cast ') ? 'cast' : ev.startsWith('you activate an exhaust ability') ? 'activate' : null;
          // edh-next-74 (CR 603.7b; Repeated Reverberation): several events of you, every wording of the list opens with its first verb: "when you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn"
          if (limited && w.or !== undefined && verb === null && /^you /.test(ev) && w.or.length >= 1 && [w.event, ...w.or].every((p) => p.ev === 'cast' || p.ev === 'activate') && [w.event, ...w.or].every((p) => (p as { player?: unknown }).player === 'you')) ev = ev.replace(/^you /, 'you next ');
          else if (!limited || verb === null) throw new NoRenderer('a once-only delayed trigger other than "when you next cast / activate / attack ... this turn"');
          const rest = verb === null ? '' : ev.slice(`you ${verb} `.length);
          // edh-cast-10 (CR 603.7b; Twinferno): "when you cast your next instant or sorcery spell this turn" (family cast-your-next) is "when you next cast an instant or sorcery spell this turn"
          if (verb !== null) ev = verb === 'cast' && /^an? /.test(rest) && w.or === undefined ? alt(`you next cast ${rest}`, `you cast your next ${rest.replace(/^an? /, '')}`) : `you next ${verb} ${rest}`;
        }
      }
      const tail = limited ? (s.duration!.d === 'endOfCombat' ? ' this combat' : ' this turn') : '';
      return `${alt('when', 'whenever')} ${ev}${tail}`;
    }
  }
}

const ACTION_ACTOR: Partial<Record<KeywordActionName, (n: string | null, arg: string | null) => string>> = {
  investigate: () => 'investigate',
  proliferate: () => 'proliferate',
  populate: () => 'populate',
  learn: () => 'learn',
  recruit: () => 'recruit', // FAST5X E18 (reminder text)
  discover: (n) => `discover ${n ?? 'X'}`,
  // CR 701.47a: `arg` is the subtype the Army gets, singular (keywords/actions/tokens.ts#AMASS); Oracle writes it plural ("amass Orcs 2", CR 701.47d)
  amass: (n, arg) => `amass ${arg ? `${pluralize(arg)} ` : ''}${n ?? 'X'}`,
  manifestDread: () => 'manifest dread',
  venture: () => 'venture into the dungeon',
  timeTravel: () => 'time travel',
  planeswalk: () => 'planeswalk',
  chaosEnsues: () => 'chaos ensues', // edhd19 (CR 701.31a, 311.7)
  rollPlanarDie: () => 'roll the planar die', // edh-next-127 (CR 901.3, 706.7)
  setInMotion: () => 'set a scheme in motion',
  abandon: () => 'abandon this scheme',
  assemble: () => 'assemble a Contraption',
  harness: () => 'harness ~',
  openAttraction: () => 'open an Attraction',
  rollToVisit: () => 'roll to visit your Attractions',
  clash: () => 'clash with an opponent',
  vote: () => 'vote',
  cascade: () => 'cascade',
  forage: () => 'forage',
  collectEvidence: (n) => `collect evidence ${n ?? 'X'}`,
  blight: (n) => `blight ${n ?? 'X'}`,
  endure: (n) => `endure ${n ?? 'X'}`,
  // FAST5X E11 (CR 701.4a): "behold an Elf" (`arg` the subtype, keywords/actions/native.ts#BEHOLD)
  behold: (_n, arg) => (arg === undefined || arg === null ? 'behold a card' : `behold ${/^[aeiou]/i.test(arg) ? 'an' : 'a'} ${arg}`),
  waterbend: (n) => `waterbend {${n ?? 'X'}}`,
  airbend: (n) => `airbend ${n ?? 'X'}`,
  earthbend: (n) => `earthbend ${n ?? 'X'}`,
  // FAST5 MX6: "empower Jace 2" (`arg` the planeswalker type, keywords/actions/bending.ts#EMPOWER)
  empower: (n, arg) => `empower ${arg ?? 'Jace'} ${n ?? 'X'}`,
  adapt: (n) => `adapt ${n ?? 'X'}`,
  monstrosity: (n) => `monstrosity ${n ?? 'X'}`,
  bolster: (n) => `bolster ${n ?? 'X'}`,
  support: (n) => `support ${n ?? 'X'}`,
  fabricate: (n) => `fabricate ${n ?? 'X'}`,
  incubate: (n) => `incubate ${n ?? 'X'}`,
  manifest: () => 'manifest the top card of your library',
  cloak: () => 'cloak the top card of your library',
};

/** The actions whose template prints `n` itself ("amass 2", "adapt 3"); every other action says "twice" or "N times" after it (CR 701). */
const PRINTS_N = new Set<KeywordActionName>(['discover', 'amass', 'collectEvidence', 'blight', 'endure', 'waterbend', 'airbend', 'earthbend', 'adapt', 'monstrosity', 'bolster', 'support', 'fabricate', 'incubate', 'empower']);

/** The actions whose computed N Oracle writes "X, where X is ..." (CR 107.3). */
// FAST5X E16: "amass Goblins X, where X is that excess damage" (CR 701.47a, 107.3)
const WHERE_X_ACTIONS = new Set<KeywordActionName>(['discover', 'earthbend', 'endure', 'empower', 'amass', 'connive', 'incubate' /* p2-misc-3: CR 701.53a */, 'monstrosity' /* edh-misc-3: CR 701.37a, 107.3; Maester Seymour */, 'bolster' /* edh-c-18: CR 701.39a, 107.3; Dragonscale General */]); // cloud r3-mech: connive X, where X is ... (CR 701.50a)

/** The vote nouns: what "each <noun> with the most votes or tied for most votes" may name after a vote for objects (CR 701.38a). */
const VOTE_NOUNS = ['permanent', 'creature', 'card', 'artifact', 'enchantment', 'land', 'planeswalker'];

/**
 * M12-3 (CR 701.38a-b): a vote. "Starting with <who>, each player votes for <choices>": words ("carnage or homage", "blue, black, red, or green"), an
 * object of a set ("a nonland permanent you don't control"), or a player ("a player", "an opponent"). Its `as` names the objects or players with the most
 * votes or tied for most votes: "each permanent with the most votes or tied for most votes" (an anaphor's whole phrase, RefInfo.alts).
 */
function voteText(s: StepOf<'action'>, st: RenderState): string {
  if (s.n !== undefined || s.arg !== undefined) throw new NoRenderer('vote with a number or an argument');
  const who = s.who.ref === 'you' ? 'you' : K.player(s.who, st, 'object').text;
  let what: string;
  if (s.choices !== undefined) {
    if (s.subject !== undefined || s.choices.length < 2) throw new NoRenderer('vote for words with a subject, or fewer than two words');
    const c = s.choices;
    what = c.length === 2 ? `${c[0]} or ${c[1]}` : `${c.slice(0, -1).join(', ')}, or ${c[c.length - 1]}`;
  } else {
    const r = s.subject as { ref?: string; who?: string; filter?: ObjectFilter } | undefined;
    // edhd27 (CR 701.38a-b): "another player" (nobody votes for themselves), "up to one creature" (a vote may be left out)
    if (s.notSelf === true && !(r?.ref === 'each' && r.who === 'player')) throw new NoRenderer('a vote that excludes the voter, for something other than a player');
    if (r?.ref === 'each' && r.who === 'player') what = s.notSelf === true ? 'another player' : 'a player';
    else if (r?.ref === 'each' && r.who === 'opponent') what = 'an opponent';
    else if (r?.ref === 'each' && r.filter !== undefined && r.who === undefined) what = s.upTo === true ? `up to one ${K.np(r.filter, st, { det: 'none' })}` : K.np(r.filter, st, { det: 'a' });
    else throw new NoRenderer('vote for something other than words, a set of objects, a player or an opponent');
    const players = r.who !== undefined;
    const nouns = players ? ['player'] : VOTE_NOUNS;
    bind(st, s.as, { nouns, plural: true, ...(players ? { player: true } : {}), alts: nouns.map((n) => `each ${n} with the most votes or tied for most votes`) });
  }
  if (s.upTo === true && !(s.subject !== undefined && 'filter' in s.subject)) throw new NoRenderer('"up to one" in a vote for something other than objects');
  // edhd19 (CR 701.38a): "each player secretly votes for truth or consequences, then those votes are revealed" (the controller is not named: the votes are cast at once)
  if (s.secret === true) { if (s.who.ref !== 'you') throw new NoRenderer('a secret vote started by someone else'); return `each player secretly votes for ${what}, then those votes are revealed`; }
  return `starting with ${who}, each player votes for ${what}`;
}

/** Actions an object performs: "X explores", "X connives". */
const ACTION_SUBJECT: Partial<Record<KeywordActionName, [string, string]>> = {
  explore: ['explores', 'explore'],
  connive: ['connives', 'connive'],
  // FAST5 MX6: "it endures 2" (CR 701.63a: a permanent is instructed to endure)
  endure: ['endures', 'endure'],
};

/** Actions written as an instruction about an object: "goad X", "suspect X", "double the power and toughness of X". */
const ACTION_OBJECT: Partial<Record<KeywordActionName, (obj: string, n: string | null, arg: string | null) => string>> = {
  goad: (o) => `goad ${o}`,
  detain: (o) => `detain ${o}`,
  suspect: (o) => `suspect ${o}`,
  cycle: (o) => `cycle ${o}`,
  transmute: (o) => `transmute ${o}`,
  meld: (o, _n, arg) => `meld ${o}${arg ? ` with ${arg}` : ''}`,
  doublePT: (o) => `double the power and toughness of ${o}`,
  // FAST5 T65 (CR 701.10e): a set named before ("among one, two, or three target creatures") is also "each of those creatures"
  doubleCounters: (o, _n, arg) => {
    const one = `double the number of ${arg ?? '+1/+1'} counters on ${o.includes('those creatures') ? alt(o, 'each of those creatures') : o}`;
    // edh-next-6 (CR 115.1, 122.1; family double-counters-choose-targets; Solidarity of Heroes): targets chosen by their own sentence, then "Double the number of +1/+1 counters on each of them"
    return /^any number of target /.test(o) ? alt(one, `choose ${o}. double the number of ${arg ?? '+1/+1'} counters on each of them`) : one;
  },
  // cloud std-spm (CR 701.10e): every kind of counter the object has
  doubleEachKind: (o) => (o === 'you' ? 'double the number of each kind of counter you have' : `double the number of each kind of counter on ${o}`), // edh-top-9 (CR 122.1; Aetheric Amplifier): the player's own counters
  // r5-refs (CR 122.6): one more counter of each kind; the holder is named again by its demonstrative ("target permanent or player" ... "that permanent or player")
  anotherOfEachKind: (o) => `for each kind of counter on ${o}, give ${o.includes('target ') ? o.replaceAll('target ', 'that ') : o} another counter of that kind`,
  manifest: (o) => `manifest ${o}`,
  cloak: (o) => `cloak ${o}`,
  // FAST5X E10: "airbend target nonland permanent" (CR 701.65a: the objects are named after the word)
  airbend: (o) => `airbend ${o}`,
  // FAST5X E28 (CR 701.43a): "exert target creature you control": the player exerts the permanent (Oracle never writes "it exerts")
  exert: (o) => `exert ${o}`,
  // trek-1 (Star Trek reminder text; CR 701, number unverified): "assimilate target creature card from an opponent's graveyard"
  assimilate: (o) => `assimilate ${o}`,
};

/**
 * FAST5 T41 (CR 611.2a, 611.2c): "Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1": two P/T
 * changes of two targets with one duration said once, in front (also each with its own, as the effects print apart). Null for anything else.
 */
function pumpPair(s: StepOf<'effect'>, st: RenderState): string | null {
  if ((s.effects.length !== 2 && s.effects.length !== 3) || s.duration.d === 'permanent') return null;
  type Pump = Extract<StepOf<'effect'>['effects'][number], { s: 'continuous' }>;
  const lone = (e: StepOf<'effect'>['effects'][number]): e is Pump => e.s === 'continuous' && e.cda !== true && e.affects.ref === 'target' && e.mods.length === 1 && e.mods[0]!.layer === '7c'
    && Object.keys(e.mods[0]!).every((k) => k === 'layer' || k === 'power' || k === 'toughness');
  const [e1, e2, e3] = s.effects;
  if (e1 === undefined || e2 === undefined || !lone(e1) || !lone(e2)) return null;
  // edh-c-109 (CR 611.2a, 611.2c; Arm the Cathars): three numeric changes of three targets, the duration said once in front: "Until end of turn, target creature gets +3/+3, up to one other target creature gets +2/+2, and up to one other target creature gets +1/+1"
  if (e3 !== undefined) {
    if (!lone(e3) || [e1, e2, e3].some((e) => [(e.mods[0] as { power?: Quantity }).power ?? 0, (e.mods[0] as { toughness?: Quantity }).toughness ?? 0].some((v) => typeof v !== 'number'))) return null;
    const [a, b, c] = s.effects.map((e) => K.staticEffect(e, st, { duration: { d: 'permanent' } }));
    return `${K.dur(s.duration, st)}, ${a}, ${b}, and ${c}`;
  }
  const values = [e1, e2].flatMap((e) => {
    const m = e.mods[0] as { power?: Quantity; toughness?: Quantity };
    return [m.power ?? 0, m.toughness ?? 0];
  });
  if (values.every((v) => typeof v === 'number')) {
    const [a, b] = s.effects.map((e) => K.staticEffect(e, st, { duration: { d: 'permanent' } }));
    const dur = K.dur(s.duration, st);
    return alt(`${dur}, ${a} and ${b}`, `${a} ${dur} and ${b} ${dur}`);
  }
  // FAST5 T69 (CR 107.3c, 608.2h): "Target creature you control gets +X/+0 until end of turn and up to one target creature an opponent controls gets -0/-X until
  // end of turn, where X is ...": one "where X is" clause defines the X of both changes, said once at the end. Every changed value is a number, the one calculated
  // quantity Q or its negation; each change is worded with the plain X (no clause of its own) and the clause is added once.
  const negated = (q: Quantity): Quantity | null => (typeof q === 'object' && q.q === 'math' && q.op === '*' && q.args.length === 2 && q.args[0] === -1 ? q.args[1]! : null);
  const calc = values.filter((v) => typeof v !== 'number');
  const base = (v: Quantity): Quantity => negated(v) ?? v;
  const key = JSON.stringify(base(calc[0]!));
  if (calc.some((v) => JSON.stringify(base(v)) !== key) || key.includes('"q":"X"') || key.includes('"q":"var"')) return null;
  const plain = (v: Quantity): Quantity => (typeof v === 'number' ? v : negated(v) !== null ? { q: 'math', op: '*', args: [-1, { q: 'X' }] } : { q: 'X' });
  const withX = (e: Pump): Pump => {
    const m = e.mods[0] as { layer: '7c'; power?: Quantity; toughness?: Quantity };
    return { ...e, mods: [{ layer: '7c', ...(m.power !== undefined ? { power: plain(m.power) } : {}), ...(m.toughness !== undefined ? { toughness: plain(m.toughness) } : {}) }] };
  };
  const v = cloneState(st);
  const [a, b] = [withX(e1), withX(e2)].map((e) => K.staticEffect(e, v, { duration: { d: 'permanent' } }));
  const dur = K.dur(s.duration, v);
  const q = K.qty(base(calc[0]!), v);
  // Cloud std-eoe: the duration said once, in front ("When ~ enters, until end of turn, target creature you control gets +X/+0 and target creature an opponent
  // controls gets -0/-X, where X is ..."), as the numeric pair above offers it (equivalence family 'duration')
  const text = alt(`${a} ${dur} and ${b} ${dur}, where X is ${q}`, `${dur}, ${a} and ${b}, where X is ${q}`);
  absorb(st, v);
  return text;
}

/**
 * std-hob (CR 611.2a, 611.2c, 613.1f, 613.4c): "Until end of turn, ~ gets +1/+0 and creatures you control gain trample" (Wargling), "Moku gets +2/+1 and creatures you
 * control gain haste until end of turn": a P/T change of one object and the abilities a group gains, with one duration said once, in front or at the end
 * (templates eff.stdhob.lead.pump.andGroupGains, eff.stdhob.pump.andGroupGains.trail). Null for anything else.
 */
function pumpAndGroupGains(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent') return null;
  const [e1, e2] = s.effects;
  if (e1?.s !== 'continuous' || e2?.s !== 'continuous') return null;
  const plainKeys = (e: object): boolean => Object.keys(e).every((k) => k === 's' || k === 'affects' || k === 'mods');
  if (!plainKeys(e1) || !plainKeys(e2) || e1.mods.length !== 1 || e2.mods.length !== 1) return null;
  const [m1, m2] = [e1.mods[0]!, e2.mods[0]!];
  if (m1.layer !== '7c' || !Object.keys(m1).every((k) => k === 'layer' || k === 'power' || k === 'toughness')) return null;
  // edh-c-53 (Sigil Blessing; family pump-and-group-gains-duration): the group's change may be a second pump, "target creature you control gets +3/+3 and other creatures you control get +1/+1"
  if (m2.layer === '7c' ? !Object.keys(m2).every((k) => k === 'layer' || k === 'power' || k === 'toughness') : m2.layer !== 6 || !Object.keys(m2).every((k) => k === 'layer' || k === 'add')) return null;
  if (e1.affects.ref === 'each' || e2.affects.ref !== 'each' || isPlayerRef(e1.affects as ObjRef | PlayerRef, st)) return null;
  const [a, b] = [e1, e2].map((e) => K.staticEffect(e, st, { duration: { d: 'permanent' } }));
  const dur = K.dur(s.duration, st);
  return alt(`${dur}, ${a} and ${b}`, `${a} and ${b} ${dur}`);
}

/**
 * edh-next-19 (CR 611.2a, 613.1b, 702.10a; Besmirch, Grab the Reins; eff.edhn19.dur.control.andHaste, eff.edhn19.dur.youControl.andHaste): one effect with a lasting duration whose
 * two effects are the control of one object (layer 2, you) and the keyword haste (layer 6) for the same object: "Until end of turn, you gain control of target creature and it gains
 * haste." (Besmirch says it without "you"). Two separate steps ("Gain control of it until end of turn. It gains haste until end of turn.") are not this shape. Null for anything else.
 */
function controlAndHaste(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent' || s.as !== undefined) return null;
  const [c, h] = s.effects;
  if (c?.s !== 'continuous' || h?.s !== 'continuous' || JSON.stringify(c.affects) !== JSON.stringify(h.affects) || c.affects.ref === 'each' || c.mods.length !== 1 || h.mods.length !== 1) return null;
  if (Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k)) || Object.keys(h).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  if (JSON.stringify(c.mods[0]) !== JSON.stringify({ layer: 2, controller: { ref: 'you' } }) || JSON.stringify(h.mods[0]) !== JSON.stringify({ layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'haste' }] })) return null;
  const obj = K.obj(c.affects as ObjRef, st, 'object').text;
  const dur = K.dur(s.duration, st);
  return alt(`${dur}, you gain control of ${obj} and it gains haste`, `${dur}, gain control of ${obj} and it gains haste`);
}

/**
 * r3-choose (CR 701.10a-c, 608.2h, 611.2a, 613.1f): "Until end of turn, double its power and toughness and it gains trample" (World War Hulk): one object's power and
 * toughness doubled and abilities that object gains, with one duration said once, in front or at the end (templates eff.r3choose.dur.double*.pt.gains). Null for anything else.
 */
function doubleAndGains(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 2 || s.duration.d === 'permanent') return null;
  const [e1, e2] = s.effects;
  // p2-pt-1 (CR 701.10c, 613.4c): also one object's power alone, "Until end of turn, double target creature's power and it gains first strike" (eff.p2pt1.*)
  const kind = e1?.s === 'continuous' ? doubledBy(e1) : null;
  if (e1?.s !== 'continuous' || e2?.s !== 'continuous' || (kind !== 'pt' && kind !== 'power')) return null;
  if (!Object.keys(e2).every((k) => k === 's' || k === 'affects' || k === 'mods') || e2.mods.length !== 1) return null;
  const m2 = e2.mods[0]!;
  // edh-c-53 (Sigil Blessing; family pump-and-group-gains-duration): the group's change may be a second pump, "target creature you control gets +3/+3 and other creatures you control get +1/+1"
  if (m2.layer === '7c' ? !Object.keys(m2).every((k) => k === 'layer' || k === 'power' || k === 'toughness') : m2.layer !== 6 || !Object.keys(m2).every((k) => k === 'layer' || k === 'add')) return null;
  if (e1.affects.ref === 'each' || e1.affects.ref === 'union' || JSON.stringify(e1.affects) !== JSON.stringify(e2.affects) || isPlayerRef(e1.affects as ObjRef | PlayerRef, st)) return null;
  const doubled = doubledText(kind, e1.affects as ObjRef, undefined, st);
  const gains = K.staticEffect(e2, st, { duration: { d: 'permanent' } });
  const dur = K.dur(s.duration, st);
  return alt(`${dur}, ${doubled} and ${gains}`, `${doubled} and ${gains} ${dur}`);
}

/**
 * edh-replace-4 (CR 608.2c, 120.3, 119.7, 611.2a; template eff.edhr4.ifPlayerDealtDamageThisWay.cantGainLife; Screaming Nemesis): "If a player is dealt damage this way, they
 * can't gain life for the rest of the game.": the players among what the damage step right before dealt damage to (render/steps-life.ts names them "dealt damage this
 * way") can't gain life for the duration; nothing happens when no player was dealt damage. Exactly that one restriction, for the rest of the game (the one duration the template reads).
 */
function dealtPlayersCantGainLife(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.as !== undefined || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'restrict' || e.mode !== 'cant' || e.action !== 'gainLife' || Object.keys(e).length !== 4) return null;
  const sub = e.subject;
  if (!('ref' in sub) || sub.ref !== 'bound' || st.info.get(`b:${sub.name}`)?.thisWay !== 'dealt damage this way') return null;
  return s.duration.d === 'permanent' ? "if a player is dealt damage this way, they can't gain life for the rest of the game" : null;
}

/**
 * edh-players-2 (CR 702.16b, 702.16e, 615.12): exactly the three effects that are "protection from everything" for the player "you": not enchanted, not targeted
 * (restrictions) and all damage to you prevented (a prevention, so that damage that can't be prevented still happens).
 */
function playerProtectedFromEverything(effects: readonly StaticEffect[]): boolean {
  const cants = effects.filter((e) => e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && Object.keys(e).length === 4).map((e) => (e as RestrictionDef).action).sort();
  const prevents = effects.filter((e) => e.s === 'replace' && JSON.stringify(e.replaces) === '{"ev":"damage","recipient":{"player":"you"}}' && JSON.stringify(e.body) === '{"b":"prevent","amount":"all"}' && Object.keys(e).length === 3);
  return effects.length === 3 && JSON.stringify(cants) === JSON.stringify(['beEnchanted', 'beTargeted']) && prevents.length === 1;
}

/**
 * edh-d-71 (CR 702.16a-b, 702.16e, 115.1, 303.4, 615.12; Eon Frolicker, eff.edhd71.youAndWalkers.protectionFromPlayer): exactly the six effects that are "you and planeswalkers you control gain
 * protection from <player>": neither the player nor the planeswalkers can be targeted by a spell or ability that player controls, enchanted by an Aura that player controls, or dealt
 * damage by a source that player controls (a prevention). Returns the player the protection is from, or null.
 */
function walkersAndYouProtectedFromPlayer(effects: readonly StaticEffect[]): PlayerPred | null {
  const first = effects[0];
  if (effects.length !== 6 || first?.s !== 'restrict' || first.other === undefined) return null;
  const from = (first.other as { controller?: PlayerPred }).controller;
  if (from === undefined || from === 'you' || from === 'opponent') return null;
  const you = { ref: 'you' };
  const walkers = { ref: 'each', filter: { types: ['Planeswalker'], controller: 'you' } };
  const restrict = (subject: unknown, action: string): unknown => ({ s: 'restrict', subject, mode: 'cant', action, other: { controller: from } });
  const prevent = (recipient: unknown): unknown => ({ s: 'replace', replaces: { ev: 'damage', recipient, source: { controller: from } }, body: { b: 'prevent', amount: 'all' } });
  const want = [restrict(you, 'beTargeted'), restrict(you, 'beEnchanted'), prevent({ player: 'you' }), restrict(walkers, 'beTargeted'), restrict(walkers, 'beEnchanted'), prevent({ object: { types: ['Planeswalker'], controller: 'you' } })];
  return JSON.stringify(effects) === JSON.stringify(want) ? from : null;
}

/** edh-players-2: "<duration>, your life total can't change, and <objects> gain <abilities>", or null when the three effects are not exactly that. */
function lifeFixedAndGains(s: StepOf<'effect'>, st: RenderState): string | null {
  if (s.effects.length !== 3 || s.as !== undefined) return null;
  const [a, b, c] = s.effects;
  const fixed = (e: StaticEffect | undefined, action: string): boolean => e?.s === 'restrict' && e.mode === 'cant' && e.action === action && JSON.stringify(e.subject) === '{"ref":"you"}' && Object.keys(e).length === 4;
  if (!fixed(a, 'gainLife') || !fixed(b, 'loseLife') || c?.s !== 'continuous') return null;
  const gains = K.staticEffect(c, st, { duration: { d: 'permanent' } });
  return lasting(`your life total can't change, and ${gains}`, s.duration, st);
}

/** FAST5X E1: "you and <objects> gain hexproof <duration>", or null when the two effects are not exactly that. */
function youAndObjsHexproof(s: StepOf<'effect'>, st: RenderState): string | null {
  const [r, c] = s.effects;
  if (r?.s !== 'restrict' || c?.s !== 'continuous') return null;
  if (JSON.stringify(r.subject) !== '{"ref":"you"}' || r.mode !== 'cant' || r.action !== 'beTargeted') return null;
  if (Object.keys(r).some((k) => !['s', 'subject', 'mode', 'action', 'other'].includes(k))) return null;
  if (c.affects.ref !== 'each' || !('filter' in c.affects) || c.mods.length !== 1 || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const m = c.mods[0]!;
  const add = (m as { add?: unknown }).add;
  if (m.layer !== 6 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add') || !Array.isArray(add) || add.length < 1) return null;
  const objs = K.np(c.affects.filter, st, { det: 'none', plural: true });
  const dur = K.dur(s.duration, st);
  // edh-players-2 (CR 702.11c-d; Veil of Summer): "You and permanents you control gain hexproof from blue and from black": the player can't be targeted by sources of
  // those colors your opponents control (`other` names the colors), the permanents have one "hexproof from <color>" per color, in the same order
  const colors = (r.other as { colors?: unknown } | undefined)?.colors;
  if (JSON.stringify(r.other) !== '{"controller":"opponent"}') {
    if (!Array.isArray(colors) || JSON.stringify(r.other) !== JSON.stringify({ controller: 'opponent', colors }) || add.length !== colors.length) return null;
    const from = add.every((x, i) => {
      const k = x as { kind?: string; keyword?: string; quality?: string } & Record<string, unknown>;
      return k.kind === 'keyword' && k.keyword === 'hexproof' && k.quality === `color:${String(colors[i])}` && Object.keys(k).every((y) => ['kind', 'keyword', 'quality', 'text'].includes(y));
    });
    if (!from) return null;
    return `you and ${objs} gain ${keywordList(add as never, st)}${dur ? ` ${dur}` : ''}`;
  }
  if (add.length !== 1) return null;
  const k = add[0] as { kind?: string; keyword?: string } & Record<string, unknown>;
  if (k.kind !== 'keyword' || k.keyword !== 'hexproof' || Object.keys(k).some((x) => !['kind', 'keyword', 'text'].includes(x))) return null;
  return `you and ${objs} gain hexproof${dur ? ` ${dur}` : ''}`;
}

/**
 * r5-static (CR 508.1d, 611.2a, 102.3): "Until your next turn, each creature attacks each combat if able and attacks a player other than you if able" (Maximum
 * Carnage): two requirements of one group with one duration, the second naming the players other than you, who in a game without teams are your opponents (CR
 * 102.3; fixed as the effect begins, effects/handlers/lasting-fix.ts). The subject is said once.
 */
function attacksOtherThanYou(s: StepOf<'effect'>, st: RenderState): string | null {
  const [a, b] = s.effects;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return null;
  const only = (r: RestrictionDef, extra: readonly string[]): boolean => Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', ...extra].includes(k));
  if (a.mode !== 'mustIfAble' || a.action !== 'attack' || !only(a, [])) return null;
  if (b.mode !== 'mustIfAble' || b.action !== 'attack' || !only(b, ['otherPlayer']) || JSON.stringify(b.otherPlayer) !== '{"ref":"each","who":"opponent"}') return null;
  if (JSON.stringify(a.subject) !== JSON.stringify(b.subject) || isPlayerRef(a.subject, st)) return null;
  const dur = K.dur(s.duration, st);
  const body = withSubjects(a.subject, st, (sj, pl) => `${sj} ${pl ? 'attack' : 'attacks'} each combat if able and ${pl ? 'attack' : 'attacks'} a player other than you if able`);
  return dur ? `${dur}, ${body}` : body;
}

/**
 * FAST5 T69 (CR 107.3c, 601.2c): "Up to X target creatures you control get +X/+X until end of turn, where X is the number of colors among permanents you
 * control": the one lasting effect whose targets' upper bound is a calculated quantity, that the pump also uses (so one "where X is" clause defines both,
 * the same quantity the lowering put in for both X). The JSON of that quantity, or null for any other effect.
 */
function xCountOf(s: StepOf<'effect'>, st: RenderState): string | null {
  const e = s.effects[0];
  if (s.effects.length !== 1 || e === undefined || e.s !== 'continuous' || e.affects.ref !== 'target') return null;
  const spec = st.specs.get(e.affects.id);
  if (spec === undefined || spec.min !== 0 || typeof spec.max !== 'object' || !isComputed(spec.max)) return null;
  const key = JSON.stringify(spec.max);
  const pump = e.mods.find((m) => m.layer === '7c');
  if (pump === undefined) return null;
  const uses = (q: unknown): boolean => JSON.stringify(q) === key || (typeof q === 'object' && q !== null && (q as { q?: string }).q === 'live' && JSON.stringify((q as { value?: unknown }).value) === key);
  return uses((pump as { power?: unknown }).power) || uses((pump as { toughness?: unknown }).toughness) ? key : null;
}

/** cmd1's "once for each <object>" of a count of objects (steps-util.ts#timesWords), or '' when that count has no such words (the "X times, where X is" wording
 * then stands alone). */
function eachTimesWords(n: Quantity, st: RenderState): string {
  try {
    return timesWords(n, st);
  } catch (e) {
    if (e instanceof NoRenderer) return '';
    throw e;
  }
}

/** r4-fxz: the player who gains control in a step that is one control change of one object (a target or the object itself), or null. */
function oneControlChange(s: StepOf<'effect'>): PlayerRef | null {
  const [e] = s.effects;
  if (s.effects.length !== 1 || e?.s !== 'continuous' || (e.affects.ref !== 'target' && e.affects.ref !== 'self') || e.mods.length !== 1) return null;
  const m = e.mods[0]!;
  return m.layer === 2 && 'controller' in m && m.controller !== undefined && typeof m.controller === 'object' ? (m.controller as PlayerRef) : null;
}

/**
 * p2-misc-2 (CR 702.16b, 702.16e, 119.7; unverified 702.16j-k): "Until your next turn, your life total can't change and you gain protection from everything"
 * (Teferi's Protection): exactly the five restrictions of the player "you" the template builds (no life gained or lost; not enchanted, targeted or dealt damage
 * by anything: no `other`), until that player's next turn.
 */
function lifeFixedProtectedUntilNextTurn(s: StepOf<'effect'>): boolean {
  if (JSON.stringify(s.duration) !== '{"d":"untilNextTurn","whose":{"ref":"you"}}' || s.effects.length !== 5) return false;
  const got = s.effects.map((e) => (e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && Object.keys(e).length === 4 ? e.action : '')).sort();
  return JSON.stringify(got) === JSON.stringify(['beEnchanted', 'beTargeted', 'gainLife', 'loseLife', 'receiveDamage']);
}

/**
 * edh-d-39 (CR 702.16b, 702.16e, 119.7; the parser's eff.edhd39.player.protectionEverythingLifeFixed.dur; Teferi's Reproach): the five restrictions of p2-misc-2's template for ONE
 * player other than "you" (the same reference in all five): the player, else null.
 */
function lifeFixedProtectedOther(s: StepOf<'effect'>): PlayerRef | null {
  if (s.effects.length !== 5) return null;
  const subjects = new Set<string>();
  const got: string[] = [];
  let who: PlayerRef | null = null;
  for (const e of s.effects) {
    if (e.s === 'restrict' && e.mode === 'cant' && Object.keys(e).length === 4 && typeof e.subject === 'object' && 'ref' in e.subject && e.subject.ref !== 'you') {
      subjects.add(JSON.stringify(e.subject));
      got.push(e.action);
      who = e.subject as PlayerRef;
    } else if (e.s === 'replace' && Object.keys(e).length === 3 && JSON.stringify(e.body) === '{"b":"prevent","amount":"all"}' && e.replaces.ev === 'damage' && Object.keys(e.replaces).length === 2 && e.replaces.recipient?.player !== undefined && typeof e.replaces.recipient.player === 'object') {
      subjects.add(JSON.stringify(e.replaces.recipient.player));
      got.push('preventDamage');
      who = e.replaces.recipient.player as PlayerRef;
    } else return null;
  }
  return subjects.size === 1 && who !== null && JSON.stringify(got.sort()) === JSON.stringify(['beEnchanted', 'beTargeted', 'gainLife', 'loseLife', 'preventDamage']) ? who : null;
}

/**
 * edh-players-3 (CR 104.3, 104.2, 101.2, 611.2a; Angel's Grace): "You can't lose the game this turn and your opponents can't win the game this turn.": exactly the two
 * restrictions the template builds, you can't lose and each opponent can't win, until end of turn.
 */
function cantLoseOppsCantWinThisTurn(s: StepOf<'effect'>): boolean {
  if (JSON.stringify(s.duration) !== '{"d":"endOfTurn"}' || s.effects.length !== 2) return false;
  const [a, b] = s.effects;
  return a?.s === 'restrict' && a.mode === 'cant' && a.action === 'lose' && JSON.stringify(a.subject) === '{"ref":"you"}' && Object.keys(a).length === 4
    && b?.s === 'restrict' && b.mode === 'cant' && b.action === 'win' && JSON.stringify(b.subject) === '{"ref":"each","who":"opponent"}' && Object.keys(b).length === 4;
}

/**
 * edh-next-96 (CR 119.8, 104.3b, 104.3a, 101.2, 611.2a; Courageous Resolve; the parser's eff.edhn96.youCantLoseLife.youCantLoseGame.oppsCantWin.thisTurn): "You can't lose life this
 * turn, you can't lose the game this turn, and your opponents can't win the game this turn.": exactly the three restrictions the template builds, until end of turn.
 */
function youCantLoseLifeOrGameOppsCantWin(s: StepOf<'effect'>): boolean {
  if (JSON.stringify(s.duration) !== '{"d":"endOfTurn"}' || s.effects.length !== 3) return false;
  const [a, b, c] = s.effects;
  return a?.s === 'restrict' && a.mode === 'cant' && a.action === 'loseLife' && JSON.stringify(a.subject) === '{"ref":"you"}' && Object.keys(a).length === 4
    && b?.s === 'restrict' && b.mode === 'cant' && b.action === 'lose' && JSON.stringify(b.subject) === '{"ref":"you"}' && Object.keys(b).length === 4
    && c?.s === 'restrict' && c.mode === 'cant' && c.action === 'win' && JSON.stringify(c.subject) === '{"ref":"each","who":"opponent"}' && Object.keys(c).length === 4;
}

/**
 * edh-players-5 (CR 702.11b, 702.11c, 611.2a; Everybody Lives!; the parser's eff.edhp5.players.gain.hexproof): "Players gain hexproof until end of turn.": the one
 * restriction the template builds, each player can't be the target of spells or abilities their own opponents control (`relativeToSubject`).
 */
function playersHexproof(s: StepOf<'effect'>): boolean {
  const [a] = s.effects;
  return s.effects.length === 1 && a?.s === 'restrict' && a.mode === 'cant' && a.action === 'beTargeted' && JSON.stringify(a.subject) === '{"ref":"each","who":"player"}'
    && JSON.stringify(a.other) === '{"controller":"opponent"}' && a.relativeToSubject === true && Object.keys(a).length === 6;
}

/**
 * trek-18 (CR 702.11c, 702.11b, 611.2a; The Needs of the Many; the parser's eff.trek18.youGain.hexproof.dur): "You gain hexproof until end of turn.": the one restriction
 * the template builds, "you" can't be the target of spells or abilities their opponents control (family player-hexproof-gain).
 */
function youGainHexproof(s: StepOf<'effect'>): boolean {
  const [a] = s.effects;
  return s.effects.length === 1 && a?.s === 'restrict' && a.mode === 'cant' && a.action === 'beTargeted' && JSON.stringify(a.subject) === '{"ref":"you"}'
    && JSON.stringify(a.other) === '{"controller":"opponent"}' && Object.keys(a).length === 5;
}

/**
 * edh-c-8 (CR 702.18a, 702.18b, 611.2a; Gilded Light; the parser's eff.edhv8.youGain.shroud.dur): "You gain shroud until end of turn.": the one restriction the template builds, "you" can't be the
 * target of spells or abilities (no limit to opponents' ones, unlike hexproof; family player-shroud-gain).
 */
function youGainShroud(s: StepOf<'effect'>): boolean {
  const [a] = s.effects;
  return s.effects.length === 1 && a?.s === 'restrict' && a.mode === 'cant' && a.action === 'beTargeted' && JSON.stringify(a.subject) === '{"ref":"you"}' && a.other === undefined && Object.keys(a).length === 4;
}

/**
 * edh-players-5 (CR 119.8, 104.3, 104.2, 101.2, 611.2a; Everybody Lives!; the parser's eff.edhp5.players.cantLoseLife.cantLoseOrWinGame.thisTurn): "Players can't lose life this
 * turn and players can't lose the game or win the game this turn.": exactly the three restrictions the template builds, until end of turn.
 */
function playersCantLoseLifeOrGame(s: StepOf<'effect'>): boolean {
  if (JSON.stringify(s.duration) !== '{"d":"endOfTurn"}' || s.effects.length !== 3) return false;
  return ['loseLife', 'lose', 'win'].every((action, i) => {
    const e = s.effects[i];
    return e?.s === 'restrict' && e.mode === 'cant' && e.action === action && JSON.stringify(e.subject) === '{"ref":"each","who":"player"}' && Object.keys(e).length === 4;
  });
}

/**
 * edh-next-143 (CR 611.2a, 401.5, 601.3, 305.1, 609.4b; Xanathar, Guild Kingpin): "Until end of turn, that player can't cast spells, you may look at the top card of their library any
 * time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way.": for the rest of the turn one player is banned from
 * casting spells and you may look at and play the top card of that player's library (PermissionDef.ofLibrary), with mana spent as though of any color. Exactly that list; null otherwise.
 */
function theirTopUntilEndOfTurn(s: StepOf<'effect'>, st: RenderState): Clause | null {
  if (s.guard !== undefined || s.duration.d !== 'endOfTurn' || s.effects.length !== 3 || s.as !== undefined) return null;
  const [ban, look, play] = s.effects as unknown as Record<string, unknown>[];
  const p = ban?.['subject'] as PlayerRef | undefined;
  if (p === undefined || JSON.stringify(ban) !== JSON.stringify({ s: 'restrict', subject: p, mode: 'cant', action: 'cast', other: { stackKind: 'spell', zone: 'stack' } })) return null;
  if (JSON.stringify(look) !== JSON.stringify({ s: 'permit', who: { ref: 'you' }, action: 'lookAt', ofLibrary: p })) return null;
  if (JSON.stringify(play) !== JSON.stringify({ s: 'permit', who: { ref: 'you' }, action: 'play', fromTop: true, ofLibrary: p, anyManaColor: true })) return null;
  if (!('ref' in p) || (p.ref !== 'target' && p.ref !== 'bound')) return null;
  const who = K.player(p, st, 'subject').text;
  return plain(`until end of turn, ${who} can't cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way`, { standalone: true });
}

/**
 * edh-next-143 (CR 611.2a, 101.2, 402.3, 601.3, 305.1; Sen Triplets): two lasting effects for the rest of the turn on one player: "This turn, that player can't cast spells or activate
 * abilities and plays with their hand revealed." (both bans, mana abilities included, and the hand revealed) and "You may play lands and cast spells from that player's hand this turn."
 * (PermissionDef.fromHandOf). Exactly those lists; null otherwise.
 */
function senTripletsSentences(s: StepOf<'effect'>, st: RenderState): Clause | null {
  if (s.guard !== undefined || s.duration.d !== 'endOfTurn' || s.as !== undefined) return null;
  const es = s.effects as unknown as Record<string, unknown>[];
  if (es.length === 1) {
    const p = es[0]!['fromHandOf'] as PlayerRef | undefined;
    if (p === undefined || JSON.stringify(es[0]) !== JSON.stringify({ s: 'permit', who: { ref: 'you' }, action: 'play', fromHandOf: p }) || !('ref' in p) || (p.ref !== 'target' && p.ref !== 'bound')) return null;
    return plain(`you may play lands and cast spells from ${K.player(p, st, 'possessive').text} hand this turn`, { standalone: true });
  }
  if (es.length !== 3) return null;
  const p = es[0]!['subject'] as PlayerRef | undefined;
  if (p === undefined || !('ref' in p) || (p.ref !== 'target' && p.ref !== 'bound')) return null;
  if (JSON.stringify(es) !== JSON.stringify([{ s: 'restrict', subject: p, mode: 'cant', action: 'cast', other: { stackKind: 'spell', zone: 'stack' } }, { s: 'restrict', subject: p, mode: 'cant', action: 'activate' }, { s: 'permit', who: p, action: 'revealHand' }])) return null;
  return plain(`this turn, ${K.player(p, st, 'subject').text} can't cast spells or activate abilities and plays with their hand revealed`, { standalone: true });
}

export const CLAUSES_LASTING = {
  effect: (s: StepOf<'effect'>, st: RenderState): Clause => {
    // edh-next-143 (CR 611.2a, 401.5, 601.3, 609.4b; Xanathar, Guild Kingpin): see theirTopUntilEndOfTurn
    const theirTop = theirTopUntilEndOfTurn(s, st);
    if (theirTop !== null) return theirTop;
    const handOf = senTripletsSentences(s, st); // edh-next-143 (Sen Triplets)
    if (handOf !== null) return handOf;
    // edh-next-125 (family each-gain-control-of-the-others; CR 611.2c, 613.1b; Reins of Power): two control changes that swap two groups of one kind between you and a player, until end
    // of turn: "you and that opponent each gain control of all creatures the other controls until end of turn"
    if (s.guard === undefined && s.duration.d === 'endOfTurn' && swappedGroups({ ...s, as: undefined }) !== null) {
      const e0 = s.effects[0] as Extract<typeof s.effects[number], { s: 'continuous' }>;
      const f = (e0.affects as { filter: ObjectFilter }).filter;
      const other = (e0.affects as { filter: { controller: PlayerRef } }).filter.controller;
      const said = K.player(other, st, 'subject').text;
      // a target opponent named again is "that opponent" as Oracle prints it, or "that player"
      const them = firstAlt(said) === 'that player' && other.ref === 'target' && st.specs.get(other.id)?.players?.who === 'opponent' ? alt(said, 'that opponent') : said;
      const kinds = K.np({ types: f.types }, st, { det: 'none', plural: true });
      if (s.as !== undefined) bind(st, s.as, { nouns: K.nounsOf({ types: f.types }), plural: true }); // "Those creatures gain haste until end of turn."
      return plain(`you and ${them} each gain control of all ${kinds} the other controls until end of turn`, { standalone: true });
    }
    // edh-c-62 (CR 508.1c, 611.2a, 608.2c; family comma-and-cant-attack; Oriss, Samite Guardian): a ban on attacking for the rest of the turn, after another instruction, is also joined with ", and":
    // "Target player can't cast spells this turn, and creatures that player controls can't attack this turn."
    const ban = s.effects.length === 1 ? s.effects[0]! : null;
    if (st.commaAndDone !== true && ban !== null && ban.s === 'restrict' && ban.mode === 'cant' && ban.action === 'attack' && s.duration.d === 'endOfTurn' && ban.subject !== undefined && 'ref' in ban.subject && ban.subject.ref === 'each') {
      st.commaAndDone = true;
      try {
        return { ...CLAUSES_LASTING.effect(s, st), commaAnd: true };
      } finally {
        delete st.commaAndDone;
      }
    }
    const eachType = eachNonlandTypePermit(s, st); // edh-zones-27
    if (eachType !== null) return plain(lasting(eachType, s.duration, st), { standalone: true });
    const nextDraw = nextDrawExileTopPlay(s); // edh-zones-27
    if (nextDraw !== null) return plain(nextDraw, { standalone: true });
    // edh-combat-6 (CR 509.1b; parser template eff.edhcb6.eachOpponent.cantBlockMoreThan; Mirri, Weatherlight Duelist): "Each opponent can't block with more than one creature this combat."
    const perPlayer = s.effects.length === 1 ? s.effects[0]! : null;
    if (perPlayer !== null && perPlayer.s === 'restrict' && perPlayer.perPlayer === true) {
      if (perPlayer.mode !== 'cant' || perPlayer.action !== 'block' || typeof perPlayer.max !== 'number' || perPlayer.max < 1 || !Number.isInteger(perPlayer.max) || perPlayer.other !== undefined || perPlayer.otherPlayer !== undefined
        || perPlayer.when !== undefined || perPlayer.min !== undefined || perPlayer.alone !== undefined || JSON.stringify(perPlayer.subject) !== '{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}}') {
        throw new NoRenderer('a per-player restriction other than "Each opponent can\'t block with more than N creatures"');
      }
      return plain(lasting(`each opponent can't block with more than ${K.qty(perPlayer.max, st)} ${perPlayer.max === 1 ? 'creature' : 'creatures'}`, s.duration, st), { standalone: true });
    }
    if (playersCantLoseLifeOrGame(s)) return plain("players can't lose life this turn and players can't lose the game or win the game this turn", { standalone: true });
    // edh-next-116 (CR 611.2a, 601.3, 602.5, 606.1; Revel in Silence): "Your opponents can't cast spells or activate planeswalkers' loyalty abilities this turn.": the ban on casting spells and the ban on loyalty abilities, both of each opponent
    if (s.effects.length === 2 && JSON.stringify(s.effects[0]) === '{"s":"restrict","subject":{"ref":"each","who":"opponent"},"mode":"cant","action":"cast"}'
      && JSON.stringify(s.effects[1]) === '{"s":"restrict","subject":{"ref":"each","who":"opponent"},"mode":"cant","action":"activate","abilityKeyword":"loyalty"}') {
      return plain(lasting("your opponents can't cast spells or activate planeswalkers' loyalty abilities", s.duration, st), { standalone: true });
    }
    if (playersHexproof(s)) return plain(lasting('players gain hexproof', s.duration, st), { standalone: true });
    if (youGainHexproof(s)) return plain(alt(lasting('you gain hexproof', s.duration, st), lasting("you can't be the target of spells or abilities your opponents control", s.duration, st)), { standalone: true }); // trek-18
    if (youGainShroud(s)) return plain(alt(lasting('you gain shroud', s.duration, st), lasting("you can't be the target of spells or abilities", s.duration, st)), { standalone: true }); // edh-c-8
    if (youCantLoseLifeOrGameOppsCantWin(s)) return plain("you can't lose life this turn, you can't lose the game this turn, and your opponents can't win the game this turn"); // edh-next-96
    const castGains = creatureCastThisWayGains(s, st); // edh-d-97 (Strago and Relm)
    if (castGains !== null) return plain(castGains, { standalone: true });
    if (cantLoseOppsCantWinThisTurn(s)) return plain("you can't lose the game this turn and your opponents can't win the game this turn");
    const dealtCant = dealtPlayersCantGainLife(s, st);
    if (dealtCant !== null) return plain(dealtCant, { standalone: true });
    if (lifeFixedProtectedUntilNextTurn(s)) return plain("until your next turn, your life total can't change and you gain protection from everything", { commaAnd: true });
    // edh-d-39 (CR 702.16b, 702.16e, 119.7; Teferi's Reproach): the same five restrictions of a player the sentence before named, "Until that player's next turn, they gain protection from everything and their life total can't change"
    const other = lifeFixedProtectedOther(s);
    if (other !== null) {
      const lead = K.dur(s.duration, st);
      const c = byPlayer(other, st, 'gain', () => `protection from everything and ${K.player(other, st, 'possessive').text} life total can't change`);
      return plain(`${lead}, ${c.sub}`, { standalone: true });
    }
    // r4-static (the parser's rule, parser/lower/anaphora.ts#continuousAffects, Mention.stackObject; CR 611.2c): a continuous effect or restriction of a resolving
    // spell or ability modifies only objects on the battlefield, so the spell itself on the stack is no antecedent of its pronoun ("~ deals 1 damage to target
    // creature. It can't block this turn.")
    if (st.permanentOnly !== true) {
      st.permanentOnly = true;
      try {
        return CLAUSES_LASTING.effect(s, st);
      } finally {
        delete st.permanentOnly;
      }
    }
    // CLOUD std-tmt (CR 611.2c, 608.2c): a group's control change names the objects it took for the instructions after it ("Untap them.")
    if (s.as !== undefined) {
      const taken = controlledGroup(s) ?? lockedGroup(s); // edh-replace-6: or a grant to a group whose description can change (the locked set, CR 611.2c)
      // r4-fxz (CR 608.2c, 613.1b): "Target opponent gains control of another target permanent you control. If they do, you draw a card.": one object's control
      // change, named so that "If they do" reads whether it happened; the player who gains control is the one who "does"
      const gainer = taken === null ? oneControlChange(s) : null;
      if (taken === null && gainer === null) throw new NoRenderer('a continuous effect that names its objects, other than a control change of a group or of one object');
      const { as, ...rest } = s;
      const c = CLAUSES_LASTING.effect(rest as StepOf<'effect'>, st);
      if (taken !== null) bind(st, as, { nouns: K.nounsOf(taken['filter'] as ObjectFilter), plural: true });
      else bind(st, as, { nouns: [], plural: false, actor: playerKey(gainer!) });
      return c;
    }
    const xq = xCountOf(s, st);
    if (xq !== null && st.xCount !== xq) {
      const saved = st.xCount;
      st.xCount = xq;
      try {
        return CLAUSES_LASTING.effect(s, st);
      } finally {
        if (saved === undefined) delete st.xCount;
        else st.xCount = saved;
      }
    }
    // std-combat-1 (CR 613.1b, 611.2b): "gain control of that permanent for as long as that Aura is attached to it"
    const whileAttached = gainControlWhileAttached(s.effects, s.duration, st);
    if (whileAttached !== null) return plain(whileAttached);
    const [only] = s.effects;
    // FAST2 T9: the "have ... get" form inside "you may" ("you may have target creature get +2/+0 until end of turn", CR 608.2d)
    if (s.effects.length === 1 && only!.s === 'continuous') {
      const extraTrigger = triggersAdditionalTime(s, st); // trek-16
      if (extraTrigger !== null) return plain(extraTrigger, { standalone: true });
      // the have form is rendered on a copy of the state: the clause's own text leaves the state exactly as before this addition
      let have: string | null = null;
      try {
        have = continuousHave(only, cloneState(st), s.duration);
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw e;
      }
      // FAST4 T22 (CR 701.10b, family double-pt): "+X/+0 until end of turn, where X is its power" is also "double its power until end of turn"; rendered
      // first, on a copy of the state, so the object is named the same way in both readings. A value of each modified object ("its own power", `subject`)
      // has no "gets" wording: then the doubling is the only reading
      const kind = doubledBy(only!);
      const doubled = kind === null ? null : doubledText(kind, only!.affects as ObjRef, s.duration, cloneState(st));
      let own: string;
      try {
        own = K.staticEffect(only!, st, { duration: s.duration });
      } catch (e) {
        if (!(e instanceof NoRenderer) || kind === null) throw e;
        own = doubledText(kind, only!.affects as ObjRef, s.duration, st);
      }
      // std-rx31 (CR 205.1a, 611.2a; family its-an-artifact): with no duration, "It's an artifact." / "~ is an artifact." says what "it becomes an artifact" says: from now
      // on its only card type is artifact (the parser's eff.stdrx31.itsAnArtifact.noDuration; "(They're no longer a creature.)", Tom, Bert, and William)
      const onlyArtifact = s.duration.d === 'permanent' && JSON.stringify(only!.mods) === JSON.stringify([{ layer: 4, types: { set: ['Artifact'] } }]) && Object.keys(only!).length === 3;
      if (onlyArtifact) own = alt(own, `${K.obj(only!.affects as ObjRef, cloneState(st), 'subject').text} is an artifact`, "it's an artifact");
      const text = doubled === null ? own : alt(own, doubled);
      // FAST5 T47: the have form of a change of identity may carry the "It's still a land." rider after it (a sentence of the same instruction, CR 608.2c)
      const identityHave = only!.mods.some((m) => m.layer === 4) && only!.mods.every((m) => m.layer === 4 || m.layer === 5 || m.layer === '7b');
      return plain(text, { standalone: hasBreak(text), ...(have !== null && (identityHave || !hasBreak(have)) ? { have } : {}) });
    }
    // FAST4 T33: the "have ... block" form inside "you may" ("you may have target creature block it this turn if able", CR 509.1c, 608.2d): a requirement
    // that one object blocks another this turn, said with the controller choosing whether it applies
    const r = only;
    if (s.effects.length === 1 && r!.s === 'restrict' && r.mode === 'mustIfAble' && r.action === 'block' && r.other !== undefined && Object.keys(r.other).length === 1
      && r.other.is !== undefined && r.when === undefined && r.max === undefined && r.otherPlayer === undefined && s.duration.d === 'endOfTurn' && !isPlayerRef(r.subject, st)) {
      const blocked = r.other.is;
      let have: string | null = null;
      try {
        const v = cloneState(st);
        const blocker = K.obj(r.subject as ObjRef, v, 'object').text;
        // a creature never blocks itself (CR 509.1a): the blocker is no antecedent of the creature it blocks ("block it"; parser/lower/anaphora.ts#blockSubject)
        const key = objKey(r.subject as ObjRef);
        if (key !== null) v.notAntecedent = identityOf(v, key);
        have = `${blocker} block ${K.obj(blocked, v, 'object').text} this turn if able`;
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw e;
      }
      const own = K.staticEffect(r, st, { duration: s.duration });
      return plain(own, { standalone: hasBreak(own), ...(have !== null && !hasBreak(have) ? { have } : {}) });
    }
    // edh-players-2 (CR 702.16b, 702.16e, 611.2a; The One Ring): "You gain protection from everything until your next turn": the player is not enchanted, targeted or
    // dealt damage by anything (the three restrictions of the player "you", no `other`), for one duration
    const redirectAll = redirectAllYouAnd(s, st); // edh-next-60 (before the generic reading of each replacement)
    if (redirectAll !== null) return plain(redirectAll, { standalone: true });
    const nextCombat = nextTimeCombatToPlayers(s, st); // edh-next-60
    if (nextCombat !== null) return plain(nextCombat, { standalone: true });
    const eachDeals = preventWhenPreventedEachDeals(s, st); // edh-next-60
    if (eachDeals !== null) return plain(eachDeals, { standalone: true });
    if (s.effects.length === 3 && playerProtectedFromEverything(s.effects)) return plain(lasting(`you gain protection from everything`, s.duration, st), { standalone: true });
    // edh-d-71 (CR 702.16e; Eon Frolicker): "Until your next turn, you and planeswalkers you control gain protection from that player."
    const fromPlayer = s.as === undefined ? walkersAndYouProtectedFromPlayer(s.effects) : null;
    if (fromPlayer !== null) return plain(lasting(`you and planeswalkers you control gain protection from ${K.player(fromPlayer, st, 'object').text}`, s.duration, st), { standalone: true });
    // edh-players-2 (CR 119.7, 119.8, 611.2a; Flare of Fortitude): "Until end of turn, your life total can't change, and permanents you control gain hexproof and
    // indestructible": the life total of "you" fixed (no life gained or lost) and a group's gained abilities, one duration
    const fixedAndGains = lifeFixedAndGains(s, st);
    if (fixedAndGains !== null) return plain(fixedAndGains, { standalone: true });
    // edh-c-109 (Arm the Cathars)
    if (s.effects.length === 3) {
      const triple = pumpPair(s, st);
      if (triple !== null) return plain(triple, { standalone: true });
    }
    // edh-d-5 (CR 601.3, 602.5, 605.1a; Abeyance, eff.edhd5.lead.player.cantCast.andCantActivate): "Until end of turn, target player can't cast instant or sorcery spells, and that player can't
    // activate abilities that aren't mana abilities": the two restrictions of one targeted player, one duration
    if (s.effects.length === 2 && castThenActivateNonMana(s.effects[0]!, s.effects[1]!)) {
      return plain(`${K.staticEffect(s.effects[0]!, st, { duration: s.duration })}, and that player can't activate abilities that aren't mana abilities`, { standalone: true });
    }
    if (s.effects.length === 2) {
      // FAST5X E1 (CR 702.11c, 702.11b): "You and permanents you control gain hexproof until end of turn": the player's hexproof ("can't be the target of
      // spells or abilities your opponents control") and the permanents' keyword, with one duration (template eff.fast5x.youAndObjs.gain.hexproof)
      const both = youAndObjsHexproof(s, st);
      if (both !== null) return plain(both, { standalone: true });
      const carnage = attacksOtherThanYou(s, st); // r5-static
      const doersCant = didPlayersCantAttackYou(s.effects, K.dur(s.duration, st), st); // edh-players-11 (before the shape it would otherwise read as)
      if (doersCant !== null) return plain(doersCant, { standalone: true });
      const theyCant = playerCantAttackYou(s.effects, K.dur(s.duration, st), st); // std-combat-1
      if (theyCant !== null) return plain(theyCant, { standalone: true });
      const noDefender = pumpGainsNoDefender(s, st); // std-rx32
      if (noDefender !== null) return plain(noDefender, { standalone: true });
      if (carnage !== null) return plain(carnage, { standalone: true });
      // FAST2 T9: one object that gets a P/T change and can't be blocked, or can attack as though it didn't have defender, says its subject once ("~ gets +1/+0
      // until end of turn and can't be blocked this turn", CR 611.2c, 509.1b, 609.4)
      const shared = sharedEffectSubject(s.effects[0]!, s.effects[1]!, s.duration, st);
      if (shared !== null) return plain(shared, { standalone: true });
      const pair = pumpPair(s, st);
      if (pair !== null) return plain(pair, { standalone: true });
      const pumpGains = pumpAndGroupGains(s, st);
      if (pumpGains !== null) return plain(pumpGains, { standalone: true });
      const controlHaste = controlAndHaste(s, st); // edh-next-19
      if (controlHaste !== null) return plain(controlHaste, { standalone: true });
      const doubleGains = doubleAndGains(s, st); // r3-choose
      if (doubleGains !== null) return plain(doubleGains, { standalone: true });
      // std-ry10 (CR 615.1a, 510.1): "prevent all combat damage that would be dealt to and dealt by target creature this turn" (FAST5 T40's pair, resolved)
      const toAndBy = lastingCombatToAndBy(s.effects, s.duration, st);
      if (toAndBy !== null) return plain(toAndBy, { standalone: true });
    }
    // r4-repl (CR 614.1c, 614.12, 611.2c): "Whenever you cast a creature spell, that creature enters with an additional +1/+1 counter on it" (the templates
    // eff.r4repl.castSpell.entersWith.*): a replacement of the entering of the spell the cast trigger names
    const castEnters = spellEntersWith(s, st) ?? spellExiledAsItResolves(s, st) ?? entersTappedThisTurn(s, st);
    if (castEnters !== null) return plain(castEnters, { standalone: true });
    // FAST5X E14 (CR 401.5, 601.3, 611.2a): "until end of turn, you may look at the top card of your library any time and you may play cards from the top of
    // your library"
    // edh-next-123 (CR 406.3, 609.4b; Arvinox, the Mind Flail): "for as long as those cards remain exiled, you may look at them, you may cast permanent spells from among them, and ..."
    const lookCast = lookCastPermanentsAnyColor(s, st);
    if (lookCast !== null) return plain(lookCast, { standalone: true });
    const top = topPermitsSentence(s.effects, 0, st, s.duration) ?? graveyardPermitsSentence(s.effects, 0, st, s.duration); // C10: from your graveyard
    if (top !== null && top.n === s.effects.length) return plain(top.text, { standalone: true });
    // FAST5 T57: "Damage can't be prevented this turn" (CR 615.12)
    if (damageUnpreventable(s.effects)) return plain(damageUnpreventableText(s.duration, st), { standalone: true });
    if (damageUnpreventable(s.effects, 'preventCombatDamage')) return plain(damageUnpreventableText(s.duration, st, true), { standalone: true }); // r5-repl (CR 510.2)
    // FAST3 T16: "Target creature can't attack or block this turn" (CR 611.2a, 508.1c, 509.1b)
    const cants = lastingCants(s.effects, s.duration, st);
    if (cants !== null) return plain(cants, { standalone: true });
    // std-mkm (CR 508.1d, 509.1c): "Target creature attacks or blocks this turn if able"
    const musts = attackOrBlockIfAble(s.effects, s.duration, st);
    if (musts !== null) return plain(musts, { standalone: true });
    // trek-8 (CR 508.1, 611.2a): "Target player can't attack this turn" is also the restriction on every creature the player controls (render/fold-trek8.ts)
    const pca = playerCantAttack(s);
    if (pca !== null) {
      const [group, player] = withVariants(st, [(v) => K.staticEffect(s.effects[0]!, v, { duration: s.duration }), (v) => playerCantAttackText(pca.who, pca.duration, v)]);
      return plain(alt(group!, player!));
    }
    // edh-d-33 (CR 508.1b, 611.2a; Champions of Minas Tirith; family player-cant-attack-you): "that opponent can't attack you this combat" is also the restriction on the creatures the player controls
    if (s.effects.length === 1 && s.effects[0]!.s === 'restrict' && s.effects[0]!.action === 'attackPlayer' && playerCantAttackYouOnly(s.effects, '', cloneState(st)) !== null) {
      const [group, player] = withVariants<string | null>(st, [(v) => K.staticEffect(s.effects[0]!, v, { duration: s.duration }), (v) => playerCantAttackYouOnly(s.effects, K.dur(s.duration, v), v)]);
      if (player !== null) return plain(alt(group!, player!), { standalone: false });
    }
    const exceptEnchanted = preventCombatExceptEnchanted(s, st); // edh-c-80 (Inspire Awe)
    if (exceptEnchanted !== null) return exceptEnchanted;
    // edh-d-44 (CR 601.3b, 614.1c, 611.2a; Arlinn, the Pack's Hope): "Until your next turn, you may cast creature spells as though they had flash, and each creature you control enters with an
    // additional +1/+1 counter on it": a flash permission and a replacement of entering, said as one clause under one duration
    if (s.effects.length === 2 && s.effects[0]!.s === 'permit' && s.effects[0]!.action === 'haveFlash' && s.effects[1]!.s === 'replace') {
      return plain(lasting(`${K.staticEffect(s.effects[0]!, st)}, and ${K.staticEffect(s.effects[1]!, st)}`, s.duration, st), { standalone: true });
    }
    const parts = s.effects.map((e) => K.staticEffect(e, st, { duration: s.duration }));
    if (parts.length === 1) return plain(parts[0]!, { standalone: hasBreak(parts[0]!) });
    // r4-repl (CR 611.2a, 614.1a): "you may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it
    // instead" (Walk-In Closet // Forgotten Cellar; the template eff.r4repl.gy.cast.andExileInstead.thisTurn): a permission and a replacement of one effect, one sentence
    if (parts.length === 2 && s.effects[0]!.s === 'permit' && s.effects[1]!.s === 'replace' && /^if /.test(firstAlt(parts[1]!))) return plain(alt(parts.join('. '), `${parts[0]!}, and ${parts[1]!}`), { standalone: true });
    return plain(parts.join('. '), { standalone: true });
  },

  delay: (s: StepOf<'delay'>, st: RenderState): Clause => {
    // edh-d-90 (CR 603.7b, 611.2a, 122.1; Nuka-Nuke Launcher; template eff.edhd90.untilEndOfDefendersNextTurn.getsCounters.wheneverTheyCast): "until the end of defending player's next
    // turn, that player gets two rad counters whenever they cast a spell": the defending player's own casts, the counters on the caster (the only form of this duration a delay has)
    const defendersCast = defendersNextTurnCounters(s);
    if (defendersCast !== null) return plain(`until the end of defending player's next turn, that player gets ${defendersCast} whenever they cast a spell`);
    // FAST5 T45 (CR 603.7b, 707.10): a copy of the next spell of any kind you cast this turn has its own wording, "copy the next spell you cast this turn when you
    // cast it" (the same delayed trigger as "when you next cast a spell this turn, copy that spell", which no card prints)
    const only = s.do.length === 1 ? s.do[0]! : undefined;
    let nextWords: string | null = null; // edh-next-65 (Sea Gate Stormcaller): "copy the next <described spell> you cast this turn when you cast it", beside "when you next cast ..., copy that spell"
    if (s.once === true && s.when.at === 'event' && s.when.or === undefined && only?.op === 'copy' && isNextSpellCopy(s, only) && only.count === undefined) {
      const nt = only.newTargets === true || only.newTargets === 'may' ? '. you may choose new targets for the copy' : '';
      // edh-next-65: a described spell has this wording beside the "when you next cast ..." one (below, `nextWords`)
      if ((s.when.event as { spell?: unknown }).spell === undefined) return plain(`copy the next spell you cast this turn when you cast it${nt}`, { standalone: true });
      const words = /^you cast an? (.+)$/.exec(K.events([s.when.event], cloneState(st), 'present', {}));
      if (words !== null) nextWords = `copy the next ${words[1]!} you cast this turn when you cast it${nt}`;
    }
    // edh-next-130 (CR 603.7b, 707.10, 606.3; Jaya's Phoenix): "copy the next loyalty ability you activate this turn when you activate it [. You may choose new targets for the copy]":
    // a once-only delayed trigger on your next loyalty ability activated this turn, copying that ability (nothing else)
    if (s.once === true && s.when.at === 'event' && s.when.or === undefined && s.duration?.d === 'endOfTurn' && only?.op === 'copy' && only.count === undefined
      && JSON.stringify(s.when.event) === JSON.stringify({ ev: 'activate', player: 'you', ability: 'loyalty' }) && Object.keys(s).filter((k) => k !== 'span').sort().join() === 'do,duration,once,op,when'
      && Object.keys(only).filter((k) => k !== 'newTargets' && k !== 'span').sort().join() === 'op,result,what,who' && only.result === 'spell' && only.who.ref === 'you' && JSON.stringify(only.what) === JSON.stringify({ ref: 'event', role: 'spell' })) {
      const nt = only.newTargets === true || only.newTargets === 'may' ? '. you may choose new targets for the copy' : '';
      return plain(`copy the next loyalty ability you activate this turn when you activate it${nt}`, { standalone: true });
    }
    const lead = delayedLead(s, st);
    // inside the delayed trigger `{ref:'event'}` is the event it waits for (CR 603.7)
    const saved = st.trigger;
    let hadSelf = false;
    const savedBatch = st.triggerBatch;
    const savedOwnEnters = st.inOwnEnters;
    let savedDelayEvent: boolean | undefined;
    if (s.when.at === 'event') {
      // std-rx11 (render/refs.ts#candidateCheck): created by the object's own "enters" trigger (CR 603.6a)
      if ((saved ?? []).length > 0 && saved!.every((ev) => ev.ev === 'zoneChange' && ev.subject.self === true && ev.to === 'battlefield')) st.inOwnEnters = true;
      st.trigger = [s.when.event, ...(s.when.or ?? [])]; // edh-next-74: `or`
      savedDelayEvent = st.inDelayEvent;
      st.inDelayEvent = true; // edh-c-77
      if (s.batch === true) st.triggerBatch = true; // FAST5 T50: "that many" and the plural roles of a batch (render/refs.ts)
      markTriggerRoles(st);
      // FAST5 T45: "Put a +1/+1 counter on ~. When you next cast a Lesson spell this turn, copy it": the spell the event names was mentioned last, so "it" is the
      // spell, not ~ (the parser's unique candidate would not see ~ in the delayed trigger's own clause)
      if (s.when.event.ev === 'cast') hadSelf = st.mentioned.delete('self');
    }
    let body: string;
    // edh-perms-10 (CR 614.1c, 603.7; rider rid.edhpm10.entersWith.ifCreature): "Return that card to the battlefield ... at the beginning of the next end step. If it enters as a creature, it
    // enters with an additional +1/+1 counter on it.": the sentence after the move is also said after the delayed trigger's words, not inside them
    // edh-next-133 (CR 603.7a, 707.2; Ochre Jelly): the same for a token copy whose counters are said in the sentence after it ("The token enters with half that many +1/+1 counters on it, rounded down.")
    const counted = s.when.at === 'step' && s.do.length === 1 && ((s.do[0]!.op === 'move' && s.do[0]!.to.countersIf !== undefined) || (s.do[0]!.op === 'copy' && halfThatManyCounters(s.do[0]!) !== null)) ? s.do[0]! : undefined;
    // edh-perms-20 (CR 603.7, 400.7; family delay-move-then-sentence; Grave Betrayal): a step-timed delayed trigger that moves an object to the battlefield and then makes an effect of it
    // ("Return it ... at the beginning of the next end step. That creature is a black Zombie ...", parser/lower/delay-tail.ts#foldNamedTail) is also said as two sentences, the time
    // words closing the first
    const moveThen = s.when.at === 'step' && s.do.length === 2 && s.do[0]!.op === 'move' && s.do[1]!.op === 'effect' ? s.do : undefined;
    // edh-next-54 (CR 603.7, 603.4, 608.2c; Angrath, the Flame-Chained, family delayed-lone-if-trailing; template eff.edhn54.sacrifice.nextEnd.ifCond): a step-timed delayed trigger whose
    // one instruction is a lone `if` with one instruction: "Sacrifice it at the beginning of the next end step if it has mana value 3 or less" (the condition is judged when the step
    // begins), also said with the condition first, after the time words
    const loneIf = s.when.at === 'step' && only !== undefined && only.op === 'if' && only.else === undefined && only.then.length === 1 ? only : undefined;
    try {
      if (loneIf !== undefined) {
        const old = cloneState(st);
        const oldBody = K.steps(s.do, old, { nested: true, sentences: true });
        const thenBody = K.steps(loneIf.then, st, { nested: true, sentences: true });
        // edh-next-89 (CR 603.7, 603.4, 608.2c; Tilonalli's Summoner, family delayed-lone-if-trailing): a negated condition is also said "unless": "At the beginning of the next end step, exile those tokens unless you have the city's blessing"
        const unlessText = loneIf.cond.cond === 'not' ? K.cond(loneIf.cond.of, cloneState(st)) : null;
        const condText = K.cond(loneIf.cond, st);
        return plain(alt(`${thenBody} ${lead} if ${condText}`, `${lead}, if ${condText}, ${thenBody}`, `${oldBody} ${lead}`, `${lead}, ${oldBody}`, ...(unlessText !== null ? [`${lead}, ${thenBody} unless ${unlessText}`, `${thenBody} ${lead} unless ${unlessText}`] : [])), { standalone: true });
      }
      const savedBody = st.inDelayBody;
      st.inDelayBody = true; // edh-next-79
      try { body = K.steps(s.do, st, { nested: true, sentences: true }); } finally { if (savedBody === undefined) delete st.inDelayBody; else st.inDelayBody = savedBody; } // (a step-timed delayed trigger too: parser/lower/delay-tail.ts, trek-8)
      if (moveThen !== undefined) {
        const again = cloneState(st);
        const first = K.steps([moveThen[0]!], again, { nested: true, sentences: true });
        const second = K.steps([moveThen[1]!], again, { nested: true, sentences: true });
        return plain(alt(`${lead}, ${body}`, `${first} ${lead}. ${second}`), { standalone: true });
      }
      // edh-next-76 (CR 603.7, 511.1, 712.14a; Conqueror's Galleon; family delay-exile-then-return): "exile it at end of combat, then return it to the battlefield transformed under your control"
      // (the delayed trigger's two instructions, the time words closing the first: the exile, then the return of what it exiled)
      if (s.when.at === 'endOfCombat' && s.do.length === 2 && s.do[0]!.op === 'move' && s.do[0]!.to.zone === 'exile' && s.do[1]!.op === 'move' && s.do[1]!.what.ref === 'bound' && s.do[1]!.to.zone === 'battlefield') {
        const again = cloneState(st);
        const first = K.steps([s.do[0]!], again, { nested: true, sentences: true });
        const second = K.steps([s.do[1]!], again, { nested: true, sentences: true });
        return plain(alt(`${lead}, ${body}`, `${first} ${lead}, then ${second}`), { standalone: true });
      }
      if (counted !== undefined) {
        // edh-next-133: the copy's own words without its counters, then the time words, then the counters' sentence (the body may hold several wordings: its last ". " is not the cut)
        const half = counted.op === 'copy' ? halfThatManyCounters(counted) : null;
        let second: string | null = null;
        if (half !== null && counted.op === 'copy') {
          const { counters: _c, ...bare } = counted;
          second = `${K.steps([bare as EffectStep], cloneState(st), { nested: true, sentences: true })} ${lead}. the token enters with half that many ${half} counters on it, rounded down`;
        } else {
          const cut = body.lastIndexOf('. ');
          if (cut > 0) second = `${body.slice(0, cut)} ${lead}${body.slice(cut)}`;
        }
        if (second !== null) return plain(alt(`${lead}, ${body}`, second), { standalone: true });
      }
    } finally {
      st.trigger = saved;
      if (hadSelf) st.mentioned.add('self');
      st.triggerBatch = savedBatch;
      st.inOwnEnters = savedOwnEnters;
      if (s.when.at === 'event') { if (savedDelayEvent === undefined) delete st.inDelayEvent; else st.inDelayEvent = savedDelayEvent; }
    }
    // FAST5 T50 (CR 603.7b): "Until end of turn, whenever ..." is the same delayed trigger as "Whenever ... this turn"; it is only ever written in front of its effect
    if (untilYourNextTurn(s) !== null) return plain(`${lead}, ${body}`, { standalone: true }); // r5-refs, std-rt
    const untilLead = s.when.at === 'event' && s.duration?.d === 'endOfTurn' && s.once !== true ? `until end of turn, whenever ${K.events([s.when.event], st, 'present', { batch: s.batch === true, ...(s.wholeBatch === true ? { wholeBatch: true } : {}) })}` : null;
    // edh-c-76 (CR 603.7b, 514.2; Harsh Justice; template eff.edhv76.thisTurn.whenever): and "This turn, whenever ..." (the same lead with "this turn" for "until end of turn")
    const thisLead = untilLead === null ? null : untilLead.replace(/^until end of turn,/, 'this turn,');
    if (hasBreak(body)) return plain(untilLead === null ? `${lead}, ${body}` : alt(`${lead}, ${body}`, `${untilLead}, ${body}`, `${thisLead}, ${body}`), { standalone: true });
    // (the leading wording first: a body that ends inside the quotes of a granted ability ends the sentence there, render/clause.ts#endSentence reads the first option)
    if (untilLead !== null) return plain(alt(`${lead}, ${body}`, `${untilLead}, ${body}`, `${thisLead}, ${body}`, `${body} ${lead}`), { standalone: true });
    // one instruction reads "Sacrifice it at the beginning of the next end step"; several read "At the beginning of ..., do this and that"
    return plain(s.do.length === 1 ? alt(`${body} ${lead}`, `${lead}, ${body}`, ...(nextWords !== null ? [nextWords] : [])) : alt(`${lead}, ${body}`, `${body} ${lead}`), { standalone: true });
  },

  reflexive: (s: StepOf<'reflexive'>, st: RenderState): Clause => {
    // FAST5X E16 (CR 603.12, 120.10): a reflexive trigger that waits for a result of the step: "when excess damage is dealt to ... this way, ..."
    // (wave 7 review, CR 603.4: "When you do, if X, Y": the intervening "if" of lower/conditions.ts#foldReflexive is also the lone `if` of the instructions, said once there)
    const lone = s.do.length === 1 && s.do[0]!.op === 'if' && s.do[0]!.else === undefined ? s.do[0]! : undefined;
    const intervening = s.when.if !== undefined && lone !== undefined && JSON.stringify(lone.cond) === JSON.stringify(s.when.if);
    if (s.when.if !== undefined && !intervening) {
      // r4-moved: "When you discard a card this way, target player mills cards equal to its mana value." (render/steps-flow.ts#movedCondFocus)
      const c = K.cond(s.when.if, st);
      const outer = st.focus;
      // std-combat-1 (CR 603.12, 608.2c): "When you put one or more Equipment onto the battlefield this way, you may attach one of them ...": "them" are the objects that
      // move put there (RefInfo.movedBinding, render/fold.ts#putAnyFromGroup)
      const w0 = s.when.if as { cond?: string; step?: string; which?: unknown; to?: string; not?: boolean };
      const putThere = w0.cond === 'did' && w0.which !== undefined && w0.to === 'battlefield' && w0.not !== true && w0.step !== undefined ? st.info.get(`r:${w0.step}`)?.movedBinding : undefined;
      const focus = movedCondFocus(s.when.if, st) ?? (putThere !== undefined ? `b:${putThere}` : undefined);
      if (focus !== undefined) st.focus = focus;
      // std-ra (CR 603.12, 608.2c): "... this way, tap up to that many target creatures": the count of what the condition asks about (render/refs.ts#countWord)
      const outerMoved = st.movedThatMany;
      const w = s.when.if as { cond?: string; step?: string; which?: unknown };
      if (w.cond === 'did' && w.which !== undefined) st.movedThatMany = JSON.stringify({ step: w.step, which: w.which });
      try {
        return plain(`when ${c}, ${K.steps(s.do, st)}`, { standalone: true });
      } finally {
        if (focus !== undefined) { if (outer === undefined) delete st.focus; else st.focus = outer; }
        if (outerMoved === undefined) delete st.movedThatMany; else st.movedThatMany = outerMoved;
      }
    }
    const info = st.info.get(`b:${s.when.did}`);
    const actor = info?.actor;
    const you = actor === undefined || actor === null || actor === 'you';
    const lead = you ? (info?.paidTimes === true ? alt('when you do', 'when you did', 'when you pay this cost one or more times') : alt('when you do', 'when you did')) : alt('when that player does', 'when the player does', 'when they do' /* edh-d-84 (CR 603.12; Yes Man, Personal Securitron): the one player whose action it waits for is "they" */); // edhn81: after "you may pay {M} any number of times"
    // r5-cost (CR 603.12, 700.2): a reflexive trigger with modes, "when you do, choose one -- • ... • ..." (its program: the modes, then its own instructions)
    if (s.modes !== undefined) return plain(`${lead}, ${K.program({ targets: s.targets, modes: s.modes, steps: s.do }, st)}`, { standalone: true });
    // std-rx32 (CR 701.3a, 603.12): after an attach of targets, "when one or more Equipment become attached to that creature this way" (render/steps-zones.ts#attach)
    const att = info?.attachedThisWay;
    if (att !== undefined) return plain(`when one or more ${att.noun} become attached to ${K.obj(att.to, st, 'object').text} this way, ${K.steps(s.do, st)}`, { standalone: true });
    // r5-moved (CR 603.12, 701.23a; family searched-this-way): after a search of your own library (render/steps-cards.ts#search), "when you search your library this way"
    if (you && info?.searched === true) return plain(`${alt(lead, 'when you search your library this way')}, ${K.steps(s.do, st)}`, { standalone: true });
    // edh-next-124 (CR 603.12, 107.3, 608.2h; Minsc & Boo, Timeless Heroes; the parser's lower/quantities.ts#reflexiveWhereX): "When you do, ~ deals X damage to any target, where X is that
    // creature's power. If the sacrificed creature was a Hamster, draw X cards.": the damage's computed amount is the X of the later instructions of the trigger too
    const sharedX = reflexiveSharedX(s, st, lead);
    // edh-next-27 (CR 107.3, 603.12; Go-Shintai of Hidden Cruelty): the reflexive trigger's own targets are announced with its program, so a limit on a target's toughness is also said "X or less, where X is ..." (render/program.ts)
    const text = `${lead}, ${s.targets !== undefined && s.targets.length > 0 ? K.program({ targets: s.targets, steps: s.do }, st) : K.steps(s.do, st)}`;
    return plain(sharedX === null ? text : alt(text, sharedX), { standalone: true });
  },

  extraTurn: (s: StepOf<'extraTurn'>, st: RenderState): Clause => {
    // std-rx30 (CR 500.7, 705.1): "Take an extra turn after this one for each coin that comes up heads" (Ral Zarek): as many as the coins an earlier flip came up heads
    const q = s.count;
    if (typeof q === 'object' && q.q === 'resultCount' && q.which === undefined && st.info.get(`r:${q.step}`)?.thisWay === 'that came up heads') {
      return byPlayer(s.who, st, 'take', 'an extra turn after this one for each coin that comes up heads');
    }
    // edh-d-34 (CR 500.7, 107.1c, 608.2h; Sage of Hours): "For each five counters removed this way, take an extra turn after this one": one extra turn per five counters the cost removed (X, rounded down)
    if (typeof q === 'object' && q.q === 'math' && q.op === 'floorDiv' && JSON.stringify(q.args) === '[{"q":"X"},5]' && s.who.ref === 'you' && s.skipUntap !== true) {
      return plain('for each five counters removed this way, take an extra turn after this one', { standalone: true });
    }
    // edh-next-46 (CR 500.7, 502.1, 614.10; Savor the Moment): "Take an extra turn after this one. Skip the untap step of that turn." (one extra turn; the rider is a sentence of its own)
    if (s.skipUntap === true) {
      if (s.count !== 1) throw new NoRenderer('a skipped untap step of several extra turns');
      const c = byPlayer(s.who, st, 'take', 'an extra turn after this one');
      return { ...c, imp: `${c.imp}. skip the untap step of that turn`, sub: `${c.sub}. skip the untap step of that turn`, standalone: true };
    }
    return byPlayer(s.who, st, 'take', () => (typeof s.count === 'number' && s.count === 1 ? 'an extra turn after this one' : `${typeof s.count === 'number' ? numWord(s.count) : K.qty(s.count, st)} extra turns after this one`));
  },

  /** std-control-3 (CR 723.1): "you control target opponent during their next turn" / "... during their next combat phase". */
  controlPlayer: (s: StepOf<'controlPlayer'>, st: RenderState): Clause => s.thenExtraTurn === true
    // edh-next-119 (CR 723.1, 500.7; Emrakul, the Promised End): the turn of control and the extra turn after it, two sentences
    ? (s.during !== 'turn' ? (() => { throw new NoRenderer('an extra turn after a controlled combat phase'); })() : plain(`you gain control of ${K.player(s.who, st, 'object').text} during that player's next turn. after that turn, that player takes an extra turn`, { standalone: true }))
    : plain(`you control ${K.player(s.who, st, 'object').text} during ${s.during === 'turn' ? alt('their next turn', "that player's next turn" /* edh-next-84 (Mindslaver, Sorin Markov, Worst Fears): the older wording */) : 'their next combat phase'}`),

  extraPhase: (s: StepOf<'extraPhase'>, st: RenderState): Clause => {
    // trek-20 (CR 505.1, 500.8; World at War): `after: 'main2'` is "the second main phase this turn" (the postcombat one), not "this main phase"
    if (s.after === 'main2' && s.phase === 'combat' && s.followedBy === 'main' && s.attackers === undefined) {
      return plain(alt("after the second main phase this turn, there is an additional combat phase followed by an additional main phase", "after the second main phase this turn, there's an additional combat phase followed by an additional main phase"));
    }
    if (s.after === 'main2') throw new NoRenderer('an added phase after the second main phase, other than a combat phase followed by a main phase');
    const after = s.after === undefined ? 'this phase' : `this ${s.after === 'main1' ? 'main phase' : s.after === 'combatDamage' || s.after === 'endCombat' ? 'combat' : 'phase'}`;
    // edh-d-34 (CR 500.8, 508.1; Last Night Together): "After this main phase, there is an additional combat phase. Only the chosen creatures can attack during that combat phase."
    if (s.onlyThese !== undefined) {
      if (s.phase !== 'combat' || s.followedBy !== undefined || s.attackers !== undefined || s.after !== 'main1') throw new NoRenderer('an attacker restriction to named creatures of another added phase');
      return plain(`after this main phase, there is an additional combat phase. only ${K.obj(s.onlyThese, st, 'subject').text} can attack during that combat phase`, { standalone: true });
    }
    // std-rq (CR 500.8, 508.1c): "After this phase, there is an additional combat phase. Only land creatures can attack during that combat phase."
    if (s.attackers !== undefined) {
      if (s.phase !== 'combat' || s.followedBy !== undefined || s.after !== undefined) throw new NoRenderer('an attacker restriction of another added phase');
      const only = K.np(s.attackers, st, { det: 'none', plural: true });
      return plain(`after this phase, there is an additional combat phase. only ${only} can attack during that combat phase`, { standalone: true });
    }
    // r4-mech (CR 500.8): "after this main phase, there is an additional combat phase followed by an additional main phase" and "there is an additional combat
    // phase after this phase, followed by an additional main phase"
    if (s.followedBy !== undefined) {
      if (s.followedBy !== 'main' || s.phase !== 'combat') throw new NoRenderer('an added phase followed by another kind of phase');
      const follow = 'followed by an additional main phase';
      return plain(alt(`after ${after}, there is an additional combat phase ${follow}`, `there is an additional combat phase after ${after}, ${follow}`, `there is an additional combat phase after ${after} ${follow}`));
    }
    return plain(alt(`after ${after}, there is an additional ${s.phase} phase`, `after this phase, there is an additional ${s.phase} phase`, `there is an additional ${s.phase} phase after ${after}`, ...(s.phase === 'combat' && (s.after === undefined || s.after === 'combatDamage' || s.after === 'endCombat') ? [`after this combat phase, there is an additional combat phase`] : []))); // r3-refs: the clause after an "and" ("untap ~ and there is an additional combat phase after this phase", CR 500.8)
  },

  // r4-fxb (CR 500.9): "there is an additional end step after this step", "you get that many additional upkeep steps after this phase"
  extraStep: (s: StepOf<'extraStep'>, st: RenderState): Clause => {
    const name = EXTRA_STEP_WORDS[s.step];
    if (name === undefined) throw new NoRenderer(`an additional ${s.step} step`);
    const anchor = s.afterPhase === true ? 'this phase' : 'this step';
    // edh-d-71 (CR 500.9, 503.1; Paradox Haze, The Ninth Doctor): an additional upkeep step after this step is also "you get an additional upkeep step after this step" and "that player gets ..." (the step belongs to the turn, whoever's upkeep it is)
    if (s.count === undefined || s.count === 1) return plain(alt(`there is an additional ${name} step after ${anchor}`, `after ${anchor}, there is an additional ${name} step`, ...(s.step === 'upkeep' && s.afterPhase !== true ? [`you get an additional ${name} step after ${anchor}`, `that player gets an additional ${name} step after ${anchor}`] : [])));
    const n = typeof s.count === 'number' ? numWord(s.count) : s.count.q === 'eventAmount' ? 'that many' : K.qty(s.count, st);
    return plain(alt(`you get ${n} additional ${name} steps after ${anchor}`, `there are ${n} additional ${name} steps after ${anchor}`));
  },

  // edh-next-74 (CR 107.3, 601.2b; Unbound Flourishing; template eff.edhn74.doubleX): "double the value of X" of the spell the trigger names
  doubleX: (s: StepOf<'doubleX'>): Clause => {
    if (s.what.ref !== 'event' || s.what.role !== 'spell') throw new NoRenderer('doubling the X of something other than the spell a cast trigger names');
    return plain('double the value of X');
  },

  endTurn: (): Clause => plain('end the turn'),
  // edh-next-137 (CR 727; Karn Liberated): "Restart the game, leaving in exile all non-Aura permanent cards exiled with ~. Then put those cards onto the battlefield under your control."
  restartGame: (s: StepOf<'restartGame'>, st: RenderState): Clause => {
    const k = s.keep;
    const f = k.ref === 'each' && 'filter' in k ? k.filter : undefined;
    if (f === undefined || JSON.stringify(f) !== JSON.stringify({ zone: 'exile', is: { ref: 'linked', link: 'exiled' }, isCard: true, types: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'], notSubtypes: ['Aura'] })) {
      throw new NoRenderer('a restart that leaves other cards in exile than the non-Aura permanent cards exiled with ~');
    }
    const then = s.toBattlefield === true ? '. then put those cards onto the battlefield under your control' : '';
    return plain(`restart the game, leaving in exile all non-Aura permanent cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}${then}`, { standalone: true });
  },
  endCombatPhase: (): Clause => plain('end the combat phase'), // trek-18 (CR 724.2)
  controlBlocks: (s: StepOf<'controlBlocks'>): Clause => { // edh-combat-7 (CR 509.1, 723.1; Odric, Master Tactician)
    if (s.who.ref !== 'you') throw new NoRenderer('a player other than you choosing the blocks');
    // edh-d-90 (CR 509.1, 723.1; Brutal Hordechief; family choose-how-those-block): the turn-long form after "Creatures your opponents control block this turn if able," is also "and you choose
    // how those creatures block" (template eff.edhd90.opponents.blockIfAble.youChooseHow: every creature that may block is one of "those creatures")
    if (s.turn === true) return plain(alt('you choose which creatures block this turn and how those creatures block', 'you choose how those creatures block'));
    return plain(`you choose which creatures block ${s.turn === true ? 'this turn' : 'this combat'} and how those creatures block`); // edh-d-89: the turn-long form (Master Warcraft)
  },
  controlAttacks: (s: StepOf<'controlAttacks'>): Clause => { // edh-d-89 (CR 508.1a, 723.1; Master Warcraft)
    if (s.who.ref !== 'you') throw new NoRenderer('a player other than you choosing the attackers');
    return plain('you choose which creatures attack this turn');
  },
  putSticker: (s: StepOf<'putSticker'>, st: RenderState): Clause => { // edh-next-147 (CR 123.3, 123.6; _____ Goblin): "put a name sticker on it"
    if (s.who.ref !== 'you' || s.sticker !== 'name') throw new NoRenderer('a sticker put by a player other than you, or a sticker other than a name sticker');
    return plain(`put a name sticker on ${K.obj(s.on, st, 'object').text}`);
  },
  reselectAttack: (s: StepOf<'reselectAttack'>, st: RenderState): Clause => {
    const which = s.playersOnly === true ? 'player' : 'player or permanent';
    const o = K.obj(s.what, st, 'subject').text;
    // edh-d-88 (CR 508.7; Capricopian, family reselect-self-named): the source itself is also said by its name again ("then you may reselect which player ~ is attacking")
    return plain(s.what.ref === 'self' && o !== '~' ? alt(`you may reselect which ${which} ${o} is attacking`, `you may reselect which ${which} ~ is attacking`) : `you may reselect which ${which} ${o} is attacking`);
  }, // trek-18 (CR 508.7); edh-d-88: `playersOnly`, "which player" (CR 508.7c)

  winGame: (s: StepOf<'winGame'>, st: RenderState): Clause => byPlayer(s.who, st, 'win', 'the game'),
  loseGame: (s: StepOf<'loseGame'>, st: RenderState): Clause => byPlayer(s.who, st, 'lose', 'the game'),

  createEmblem: (s: StepOf<'createEmblem'>, st: RenderState): Clause =>
    // edh-next-100 (CR 114.1; Saheeli, Filigree Master / Tamiyo, the Moon Sage / Sarkhan, the Dragonspeaker): a list of quoted abilities, `with "A" and "B."`: only the last keeps the
    // full stop (render/quote.ts#quotedListItem); a lone quoted ability keeps its own
    byPlayer(s.who, st, 'get', () => {
      const n = s.abilities.length;
      // Oracle prints a quoted ability inside a quoted ability in single quotes (render/quote.ts): "Enchanted planeswalker has "[-12]: You get an emblem with '...'""
      const mark = st.depth > 0 ? "'" : '"';
      if (mark === "'" && n > 1) throw new NoRenderer('a list of quoted emblem abilities inside a quoted ability');
      const items = s.abilities.map((a, i) => {
        const q = `${mark}${hoistFinalPeriod(K.ability(a, nestedState(st)))}${mark}`;
        return i < n - 1 ? quotedListItem(q, n >= 3 ? 'comma' : 'none') : q;
      });
      return `an emblem with ${joinList(items)}`;
    }),

  rollDie: (s: StepOf<'rollDie'>, st: RenderState): Clause => {
    st.diceRolled = s.count === undefined ? 1 : typeof s.count === 'number' ? s.count : 'many'; // edh-next-128 (review): "for each result of N" and "doubles" read a roll said before
    // edh-mana-keywords-10 (CR 706.1): "Roll X six-sided dice, where X is ..." (Luck Bobblehead): a computed number of dice, said as X with its definition after the dice
    // edh-d-49 (CR 706.2, 706.6; Iron Mastiff): "roll a d20 for each player being attacked and ignore all but the highest roll": one die for each opponent attacked this combat, the result the highest
    // edh-next-129 (CR 706.1, 602.2b; Mr. House, President and CEO): "Roll a six-sided die plus an additional six-sided die for each mana from Treasures spent to activate this ability"
    const plusEach = s.count !== undefined && typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '+' && s.count.args.length === 2 && s.count.args[0] === 1
      && typeof s.count.args[1] === 'object' && s.count.args[1].q === 'activationManaFrom' ? s.count.args[1] : null;
    if (plusEach !== null) {
      if (s.sides !== 6 || s.modifier !== undefined || s.chooseOne !== undefined || s.keepHighest !== undefined || s.highest !== undefined || s.afterRoll !== undefined || (s.table?.length ?? 0) > 0) throw new NoRenderer('a die plus one for each mana spent, other than the plain six-sided one');
      return byPlayer(s.who, st, 'roll', `a six-sided die plus an additional six-sided die for each mana from ${pluralize(plusEach.subtype)} spent to activate this ability`);
    }
    const keep = s.keepHighest === true;
    // edh-next-127 (CR 706.1, 706.6; Berserker's Frenzy): "roll two d20 and ignore the lower roll": two dice, the higher kept (a fixed two only)
    const keepTwo = keep && s.count === 2 && s.modifier === undefined && s.chooseOne === undefined && s.highest === undefined && s.afterRoll === undefined;
    if (keep && !keepTwo && (JSON.stringify(s.count) !== '{"q":"opponentsAttacked"}' || s.modifier !== undefined || s.chooseOne !== undefined || s.highest !== undefined || s.afterRoll !== undefined)) throw new NoRenderer('keep-the-highest dice other than "a die for each player being attacked" or "two dice, the lower ignored"');
    const computed = typeof s.count === 'object' && !keep;
    const count = keepTwo ? 'two' : s.count === undefined || s.count === 1 || keep ? 'a' : computed ? 'X' : numWord(s.count as number);
    const noun = (c: string): string => (c === 'a' ? 'die' : 'dice');
    // p2-c-dieroll-1 (CR 706.1): a d6 is also "a six-sided die" (family six-sided-die)
    // edh-c-16 (CR 706.1; Arden Angel): a d4 is also "a four-sided die" (same family)
    const dieWords = (c: string): string => (s.sides === 6 || s.sides === 4 ? alt(`${c} d${s.sides}`, `${c} ${s.sides === 6 ? 'six' : 'four'}-sided ${noun(c)}`) : `${c} d${s.sides}`);
    // edh-mana-keywords-10 (CR 706.2): "Roll a d20 and subtract the number of cards in your hand": the modifier is minus a number
    const sub = s.modifier !== undefined && typeof s.modifier === 'object' && s.modifier.q === 'math' && s.modifier.op === '-' && s.modifier.args.length === 2 && s.modifier.args[0] === 0 ? s.modifier.args[1]! : null;
    // edh-next-24 (CR 706.2; Diviner's Portent): any other modifier is a number added, "Roll a d20 and add the number of cards in your hand"
    const add = s.modifier !== undefined && sub === null ? s.modifier : null;
    // edh-top-16 (CR 706.1, 107.3m; Clown Car): the X of the spell itself needs no definition ("roll X six-sided dice")
    const spellX = computed && (s.count as Quantity & { q?: string }).q === 'X';
    const tail = (keepTwo ? ' and ignore the lower roll' : keep ? ' for each player being attacked and ignore all but the highest roll' : '') + (computed && !spellX ? `, where X is ${K.qty(s.count as Quantity, st)}` : '') + (sub !== null ? ` and subtract ${K.qty(sub, st)}` : '') + (add !== null ? ` and add ${K.qty(add, st)}` : '') + (s.chooseOne === true ? ' and choose one result' : '');
    const c = byPlayer(s.who, st, 'roll', () => `${dieWords(count)}${tail}`);
    // edh-mana-keywords-10 (CR 706.3b): the instructions between the roll and its table, in their own sentences
    const between = s.afterRoll !== undefined && s.afterRoll.length > 0 ? `. ${K.steps(s.afterRoll, cloneState(st))}` : '';
    if (!s.table || s.table.length === 0) return between === '' ? c : acting(c.actor ?? 'x', `${c.imp}${between}`, `${c.sub}${between}`, { standalone: true });
    // p2-c-dieroll-1 (CR 706.3a): only one row happens, so each row is said from what was said before the table, never after another row ("its controller" again)
    const rows = s.table.map((r, k) => { const fork = cloneState(st); const body = K.steps(r.do, fork); for (const u of fork.used) st.used.add(u); /* edh-next-55: a target a row names is used */ const those = ofThoseTokens(s.table!, k) ?? thoseCountedCards(s, k); /* edh-next-128 (Revivify) */ const again = r.again === 'may' ? '. you may roll again' : ''; /* edh-next-121 (CR 706.3a; Delina, Wild Mage) */ return `${rowLabel(r, k === 0, k === s.table!.length - 1)} ${rowSep(r)} ${those === null ? body : alt(body, those)}${again}`; }); // edh-next-55: the first row is also "9 or less"
    // edh-next-121 (CR 706.3a; Delina, Wild Mage): a row that ends with a quoted ability ("... it has "At end of combat, exile this token."") has its full stop inside the quote
    const quoteEnd = (t: string): boolean => firstAlt(t).endsWith('."');
    const joined = rows.map((r, k) => (k === rows.length - 1 ? r : `${r}${quoteEnd(r) ? ' ' : '. '}`)).join('');
    return acting(c.actor ?? 'x', `${c.imp}${between}. ${joined}`, `${c.sub}${between}. ${joined}`, { standalone: true, commaThen: true }); // p2-c-dieroll-1: "Exile target creature, then roll a d20." (CR 608.2c)
  },

  flipCoin: (s: StepOf<'flipCoin'>, st: RenderState): Clause => {
    if (s.stakes !== undefined || s.mayStop !== undefined || s.lostVoids !== undefined) throw new NoRenderer('a flip with stakes or that may stop, said only by its fold (render/fold-edhn129.ts)'); // edh-next-129
    const key = playerKey(s.who);
    // std-rx30 (CR 705.1, 608.2c): what a flip of several coins came up is "the number of coins that came up heads" for a later count (render/qty.ts, resultCount)
    // p2-coinflip-3 (CR 705.2): flips called for a later count are "each flip you win" (render/qty.ts, resultCount); by you only, several coins, no instructions
    if (s.called === true && (key !== 'you' || (s.count === undefined && s.times === undefined) || s.untilLose !== undefined || s.onWin !== undefined || s.onLose !== undefined)) throw new NoRenderer('called flips other than "flip N coins. For each flip you win, ..."');
    if (s.as !== undefined && s.called === true) st.info.set(`r:${s.as}`, { nouns: ['flip'], plural: true, thisWay: 'you win' });
    else if (s.as !== undefined && s.count !== undefined && s.onWin === undefined && s.onLose === undefined) st.info.set(`r:${s.as}`, { nouns: ['coin'], plural: true, thisWay: 'that came up heads', ...(s.count === 2 ? { twoCoins: true as const } : {}) });
    // p2-coinflip-1 (CR 705.1-705.2): "flip a coin until you lose a flip", by you only
    if (s.untilLose === true) {
      if (key !== 'you' || s.count !== undefined || s.times !== undefined /* edh-next-128: a capped run is said by render/fold-edhn128.ts only */ || s.onWin !== undefined || s.onLose !== undefined) throw new NoRenderer('a flip until a loss other than "flip a coin until you lose a flip"');
      // p2-coinflip-2 (CR 705.2, 608.2c): its count is "each flip you won" for a later count (render/qty.ts, resultCount)
      if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['flip'], plural: true, thisWay: 'you won' });
      return byPlayer(s.who, st, 'flip', 'a coin until you lose a flip');
    }
    // edh-next-128 (CR 705.1, 608.2c; Yusri, Fortune's Flame): "flip that many coins" after "choose a number between 1 and 5" (the chosen number), with no instructions of its own
    if (s.times !== undefined) {
      if (s.count !== undefined || s.onWin !== undefined || s.onLose !== undefined || s.onTails !== undefined || typeof s.times !== 'object' || s.times.q !== 'chosenNumber') throw new NoRenderer('a number of coins other than the chosen number, or with instructions of its own');
      return byPlayer(s.who, st, 'flip', 'that many coins');
    }
    const c = byPlayer(s.who, st, 'flip', s.count === undefined ? 'a coin' : `${numWord(s.count)} coin${s.count === 1 ? '' : 's'}`); // r4-mech: "flip five coins"
    const you = key === 'you';
    const subj = you ? 'you' : K.player(s.who, st, 'subject').text;
    const wins = you ? 'win' : 'wins';
    const loses = you ? 'lose' : 'loses';
    let imp = c.imp;
    let sub = c.sub;
    // std-copy-1 (CR 603.12, 705.2): a branch that is one reflexive trigger waiting for the flip itself is "when you win the flip, X" (by you only)
    const result = (branch: EffectStep[], verb: string): string => {
      const r = branch.length === 1 && branch[0]!.op === 'reflexive' ? branch[0]! : undefined;
      // edh-d-20 (CR 705.2, 608.2c; Planar Chaos): another player's flip is also read "If they lose the flip, ..." (family flip-result-they)
      if (r === undefined || r.op !== 'reflexive') return `. if ${you ? `${subj} ${verb}` : alt(`${subj} ${verb}`, `they ${verb.replace(/s$/, '')}`)} the flip, ${K.steps(branch, st)}`;
      if (!you || s.as === undefined || r.when.did !== s.as || r.when.if !== undefined || r.modes !== undefined) throw new NoRenderer('a reflexive trigger of a coin flip other than "when you win / lose the flip"');
      return `. when you ${verb} the flip, ${K.steps(r.do, st)}`;
    };
    const won = s.onWin && s.onWin.length > 0 ? result(s.onWin, wins) : '';
    const lost = s.onLose && s.onLose.length > 0 ? result(s.onLose, loses) : '';
    // edh-cast-7 (CR 705.2; family flip-results-either-order): the two results are said in either order, "If you lose the flip, return that spell to its owner's hand. If you win
    // the flip, copy that spell" (Krark, the Thumbless); the model keeps one branch for each result, not the order of the words
    // edh-d-20 (CR 705.2, 608.2c; Plasma Caster): and the second result is "Otherwise, ..." after the first
    const lostPrefix = `. if ${subj} ${loses} the flip, `;
    const lostOtherwise = lost.startsWith(lostPrefix) ? `. otherwise, ${lost.slice(lostPrefix.length)}` : lost;
    const t = won !== '' && lost !== '' ? alt(won + lost, lost + won, won + lostOtherwise) : won + lost;
    imp += t;
    sub += t;
    // edh-next-11 (CR 608.2c, 705.2; family then-flip-a-coin): "Create two 1/1 tokens, then flip a coin. If you win the flip, ..." (Molten Birth): a flip with a result is also joined to the instruction before it by ", then"
    // edh-d-20 (CR 608.2c, 705.2; Goblin Kaboomist): Oracle also begins the flip's sentence "Then flip a coin. If you lose the flip, ..." (Clause.leadThen)
    return acting(c.actor ?? 'x', imp, sub, { standalone: imp !== c.imp, commaThen: imp !== c.imp, leadThen: imp !== c.imp });
  },

  // p2-player-rules-2 (CR 701.30): "clash with an opponent. if you win, X. otherwise, Y." (by you only; the result sentences folded by parser/lower/clash.ts)
  clash: (s: StepOf<'clash'>, st: RenderState): Clause => {
    if (playerKey(s.who) !== 'you') throw new NoRenderer('a clash by another player than you');
    // edh-d-5 (CR 701.30, 608.2c; Pulling Teeth): the opponent clashed with is named only here, never the antecedent of a later "that player" (the target player of the branch before is)
    const c = byPlayer(s.who, st, 'clash', `with ${K.player(s.with, cloneState(st), 'object').text}`);
    let tail = '';
    if (s.onWin && s.onWin.length > 0) tail += `. if you win, ${K.steps(s.onWin, st)}`;
    if (s.onLose && s.onLose.length > 0) {
      if (tail === '') throw new NoRenderer('a clash with only a branch for a clash not won');
      tail += `. otherwise, ${K.steps(s.onLose, st)}`;
    }
    // edh-d-1 (CR 701.30, 608.2c; Hoarder's Greed): a clash with its result sentences also follows a plain instruction after ", then" (Clause.commaThen)
    return acting(c.actor ?? 'x', c.imp + tail, c.sub + tail, { standalone: tail !== '', ...(tail !== '' ? { commaThen: true } : {}) });
  },

  designate: (s: StepOf<'designate'>, st: RenderState): Clause => {
    switch (s.what) {
      case 'monarch': return byPlayer(s.who, st, 'become', 'the monarch');
      case 'initiative': return byPlayer(s.who, st, 'take', 'the initiative');
      case 'day': return plain('it becomes day');
      case 'night': return plain('it becomes night');
      // FAST5X-4 (CR 702.179c-d): the inherent ability of speed; no template writes it
      case 'speed': {
        // std-control-1 (CR 702.179): "reduce that opponent's speed by 1. This effect can't reduce their speed below 1." (one sentence pair, lower/ability.ts#joinSpeedFloor)
        if (s.decrease === true && s.floor !== undefined) {
          const p = K.player(s.who, st, 'possessive');
          if (p.person !== 'sg') throw new NoRenderer('a speed reduction of several players');
          return plain(`reduce ${p.text} speed by ${s.by ?? 1}. this effect can't reduce their speed below ${s.floor}`);
        }
        if (s.who.ref !== 'you') throw new NoRenderer('a speed increase of another player');
        return plain(`your speed increases by ${numWord(s.by ?? 1)}`);
      }
      // CMD3 (CR 702.131a, 702.131c): ascend's spell ability; no template writes it
      case 'citysBlessing': return byPlayer(s.who, st, 'get', "the city's blessing for the rest of the game");
    }
  },

  // std-mana-12 (CR 603.2): "you earthbend" / "you firebend", the report the earthbend macro and the firebending trigger end with; no template writes it
  reportAction: (s: StepOf<'reportAction'>, st: RenderState): Clause => {
    // edh-next-110 (CR 701.46a; Biomancer's Familiar): the mark that lets the next adapt of the creature this turn ignore its +1/+1 counters
    if (s.verb === 'adaptAsNoCounters') {
      if (s.object === undefined || s.who.ref !== 'you') throw new NoRenderer('an adapt mark without its creature');
      return plain(`the next time ${K.obj(s.object, st, 'subject').text} adapts this turn, it adapts as though it had no +1/+1 counters on it`);
    }
    return byPlayer(s.who, st, s.verb, '');
  },

  // M6-6 INTERFACE CHANGE (additive): designations of a permanent (CR 716.2a, 719.3a-b, 722.3a-b), as Oracle words them
  designateObject: (s: StepOf<'designateObject'>, st: RenderState): Clause => {
    if (s.designation === 'classLevel') {
      if (s.level === undefined) throw new NoRenderer('designateObject classLevel without a level');
      return plain(`${K.obj(s.what, st, 'possessive').text} level becomes ${s.level}`);
    }
    // FAST5X E8 (CR 709.5f-g): "unlock a locked door of <Room>", "lock or unlock a door of <Room>"
    if (s.designation === 'unlockDoor') return plain(`unlock a locked door of ${K.obj(s.what, st, 'object').text}`);
    if (s.designation === 'lockOrUnlockDoor') return plain(`lock or unlock a door of ${K.obj(s.what, st, 'object').text}`);
    // FAST5X E12, CR 701.60a: "it's no longer suspected", "all suspected creatures are no longer suspected", "have it become no longer suspected"
    if (s.designation === 'unsuspected') {
      const before = cloneState(st);
      const p = K.obj(s.what, st, 'subject');
      const be = p.plural ? 'are' : 'is';
      const contracted = p.text === 'it' ? ["it's no longer suspected"] : p.text === 'they' ? ["they're no longer suspected"] : [];
      // std-mkm (CR 701.60a, 701.60b): "If it's suspected, it's no longer suspected", "If any of them are suspected, they're no longer suspected": a permanent that
      // isn't suspected stays so when an effect makes it no longer suspected, so the condition says nothing the instruction doesn't (Airtight Alibi, Eliminate the Impossible)
      const first = K.obj(s.what, before, p.plural ? 'object' : 'subject').text;
      const again = K.obj(s.what, before, 'subject').text;
      const lead = p.plural ? `if any of ${first} are suspected, ${again} are no longer suspected` : `if ${first} is suspected, ${again} is no longer suspected`;
      return plain(alt(`${p.text} ${be} no longer suspected`, ...contracted, lead), { have: `${p.text} become no longer suspected` });
    }
    // cloud r3-mech (CR 701.64): "Harness ~."
    if (s.designation === 'harnessed') return plain(`harness ${K.obj(s.what, st, 'object').text}`);
    if (s.designation === 'suspected') {
      const p = K.obj(s.what, st, 'object');
      return plain(`suspect ${p.text}`); // CR 701.60a (the action form, keywords/actions/evidence.ts#SUSPECT, is what templates build)
    }
    // edh-d-86 (CR 702.143a; Ethereal Valkyrie): "It becomes foretold. Its foretell cost is its mana cost reduced by {2}."
    if (s.foretellLess !== undefined) {
      if (s.designation !== 'foretold' || !Number.isInteger(s.foretellLess) || s.foretellLess < 1) throw new NoRenderer('a foretell cost reduction outside "becomes foretold"');
      const w = K.obj(s.what, st, 'subject');
      return plain(`${w.text} becomes foretold. its foretell cost is its mana cost reduced by {${s.foretellLess}}`);
    }
    const who = K.obj(s.what, st, 'subject').text;
    // FAST5X E3, CR 702.171b: the saddled designation lasts until end of turn, and Oracle says so
    const until = s.designation === 'saddled' ? ' until end of turn' : '';
    return plain(`${who} becomes ${s.designation}${until}`, { have: `${who} become ${s.designation}${until}` });
  },

  action: (s: StepOf<'action'>, st: RenderState): Clause => {
    // T20 (FAST4): a computed N is written "discover X, where X is that spell's mana value" (CR 701.57a, 107.3)
    // FAST5 MX6: and "earthbend X, where X is ...", "it endures X, where X is ...", "empower Jace X, where X is ..." (CR 701.66a, 701.63a)
    // FAST5 T76: "it endures X, where X is the number of counters on this creature": the permanent that endures comes first in the text, so it is named before the amount
    // names anything else (the pronoun looks back, parser/lower/anaphora.ts#withoutLaterSelf)
    // std-rx26 (CR 701.57a): "discover again for the same value": the N of the discover that triggered the ability (`{q:'eventAmount'}` of a discover event)
    if (s.action === 'discover' && s.who.ref === 'you' && typeof s.n === 'object' && s.n !== null && s.n.q === 'eventAmount' && s.subject === undefined && s.arg === undefined && s.choices === undefined) {
      bind(st, s.as, { nouns: ['card'], plural: false, alts: ['the discovered card'] });
      return plain('discover again for the same value');
    }
    const endurer = s.action === 'endure' && s.subject !== undefined && !isPlayerRef(s.subject as never, st) ? K.obj(s.subject as never, st, 'object').text : null;
    const n = s.n === undefined ? null : WHERE_X_ACTIONS.has(s.action) && isComputed(s.n) ? whereX(s.n, st) : K.qty(s.n, st);
    // T20 (FAST4): the permanent manifest dread put onto the battlefield is a creature a later instruction names ("attach ~ to that creature", CR 701.62a,
    // 701.40a: a face-down 2/2 creature)
    // FAST5X E25: "manifest dread X times, then ... each of those creatures" (CR 701.62a, 608.2c): the permanents of every repetition; the permanent manifest or
    // cloak put onto the battlefield ("cloak the top card of your library, then attach ~ to it", CR 701.58a)
    if (s.action === 'manifestDread') bind(st, s.as, { nouns: ['creature', 'permanent'], plural: s.n !== undefined });
    // std-hob (CR 701.47c, 608.2c; the parser's participle "amassed", parser/lower/mentions.ts#producedBy): the Army an amass action chose is "the amassed Army" later
    if (s.action === 'amass') bind(st, s.as, { nouns: ['army'], plural: false, alts: ['the amassed Army', 'the Army you amassed'] });
    // edh-perms-15 (CR 701.36a, 608.2c; the parser's mention, parser/lower/mentions.ts#producedBy): the token a populate created is "the token created this way" later (Determined Iteration)
    if (s.action === 'populate' && s.n === undefined) bind(st, s.as, { nouns: ['token', 'creature'], plural: false, alts: ['the token created this way'] });
    // p2-attack-block-2 (CR 701.15a, 608.2c; parser/lower/mentions.ts#producedBy): the group a goad of a description goaded is "those creatures" / "they" later
    // edh-d-75 (CR 701.15a, 608.2c; Havoc Eater): and the targets of a goad "for each opponent" (a set: one target for each opponent), counted as "creatures goaded this way"
    if (s.action === 'goad' && s.as !== undefined && s.subject !== undefined && (s.subject as { ref?: string }).ref === 'target' && st.specs.get((s.subject as { id: string }).id)?.perOpponent === true) bind(st, s.as, { nouns: ['creature'], plural: true, thisWay: 'goaded this way' });
    if (s.action === 'goad' && s.as !== undefined && s.subject !== undefined && (s.subject as { ref?: string }).ref === 'each' && 'filter' in (s.subject as object)) bind(st, s.as, { ...infoOfRef(s.subject as never, st), thisWay: 'goaded this way' /* edh-d-75 (CR 701.15a): "for each creature goaded this way" */ });
    // CLOUD std-ecl (CR 701.68c; the parser's participle "blighted", parser/lower/mentions.ts#producedBy): the creature you chose as you blighted is "the blighted creature"
    if (s.action === 'blight' && s.who.ref === 'you') bind(st, s.as, { nouns: ['creature'], plural: false, alts: ['the blighted creature'] });
    // edh-d-89 (CR 701.39a, 608.2c; the parser's participle "chosen", parser/lower/mentions.ts#producedBy): the creature a bolster chose is "the chosen creature", then "that creature" (Optimus Prime, Autobot Leader)
    if (s.action === 'bolster' && s.who.ref === 'you' && s.subject === undefined) bind(st, s.as, { nouns: ['creature', 'permanent'], plural: false, alts: ['the chosen creature'] });
    // r4-mech (CR 701.57c; the parser's participle "discovered", parser/lower/mentions.ts#producedBy): the card a discover by you stopped at is "the discovered card"
    if (s.action === 'discover' && s.who.ref === 'you') bind(st, s.as, { nouns: ['card'], plural: false, alts: ['the discovered card'] });
    if ((s.action === 'cloak' || s.action === 'manifest') && s.subject === undefined) bind(st, s.as, { nouns: ['creature', 'permanent'], plural: s.n !== undefined });
    // T20 (FAST4): "support N" names its targets without the word (CR 701.41a): only "up to N [other] target creatures" may stand behind it
    if (s.action === 'support' && s.subject !== undefined) {
      const spec = (s.subject as { ref?: string }).ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const f = (spec?.filter ?? {}) as Record<string, unknown>;
      const ok = spec !== undefined && spec.kind === 'object' && spec.min === 0 && JSON.stringify(spec.max) === JSON.stringify(s.n)
        && JSON.stringify(f['types']) === '["Creature"]' && Object.keys(f).every((k) => k === 'types' || (k === 'other' && f[k] === true));
      if (!ok) throw new NoRenderer('support with targets that are not "up to N [other] target creatures" (CR 701.41a)');
    }
    // FAST5 MX6: "earthbend N" names its target without the word (CR 701.66a): only "target land you control" may stand behind it
    if (s.action === 'earthbend' && s.subject !== undefined) {
      const spec = (s.subject as { ref?: string }).ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const ok = spec !== undefined && spec.kind === 'object' && spec.min === 1 && spec.max === 1 && spec.onlyIf === undefined && spec.distinctFrom === undefined
        && JSON.stringify(spec.filter) === JSON.stringify({ types: ['Land'], controller: 'you' });
      if (!ok) throw new NoRenderer('earthbend with a target that is not "target land you control" (CR 701.66a)');
    }
    // trek-1 (assimilate: "put it onto the battlefield under your control", Star Trek reminder text): the macro moves a card, so only one target card in a graveyard,
    // assimilated by "you", may stand behind it (keywords/actions/assimilate.ts); anything else stays manual
    if (s.action === 'assimilate') {
      const spec = (s.subject as { ref?: string } | undefined)?.ref === 'target' ? st.specs.get((s.subject as { id: string }).id) : undefined;
      const f = (spec?.kind === 'object' ? spec.filter ?? {} : {}) as Record<string, unknown>;
      // trek-7 (The Borg Queen): or the one card another instruction of the ability exiled ("... until they exile a creature card. Assimilate that card."), a card in exile
      const sub = s.subject as { ref?: string; name?: string } | undefined;
      const exiledCard = sub?.ref === 'bound' && sub.name !== undefined && st.info.get(`b:${sub.name}`)?.zone === 'exile' && st.info.get(`b:${sub.name}`)?.plural === false
        && st.info.get(`b:${sub.name}`)?.nouns.includes('card') === true;
      const ok = exiledCard ? s.who.ref === 'you' && s.n === undefined
        // trek-13 (Assimilate the Wounded): or at most one card for each opponent, in that opponent's graveyard (the macro moves every target, keywords/actions/assimilate.ts)
        : spec !== undefined && spec.kind === 'object' && spec.max === 1 && ((spec.min === 1 && spec.perOpponent !== true) || (spec.perOpponent === true && (spec.min === 0 || spec.min === 1) && f['owner'] === 'opponent'))
          && f['zone'] === 'graveyard' && f['isCard'] === true && s.who.ref === 'you' && s.n === undefined;
      // trek-13 (The Best of Both Worlds): or one target creature on the battlefield (a permanent is not moved: its control changes, keywords/actions/assimilate.ts)
      const permanent = !exiledCard && spec !== undefined && spec.kind === 'object' && spec.min === 1 && spec.max === 1 && spec.perOpponent !== true && spec.perPlayer !== true && s.who.ref === 'you' && s.n === undefined
        && (f['zone'] === undefined || f['zone'] === 'battlefield') && f['isCard'] === undefined && Array.isArray(f['types']) && (f['types'] as string[]).join() === 'Creature';
      if (!ok && !permanent) throw new NoRenderer('assimilate of something that is not one target card in a graveyard, one target creature, or the one card an exile put into exile, or not by you');
    }
    const arg = s.arg ?? null;
    // FAST5X E10: airbend is run for permanents only (effects/handlers/airbend.ts; a spell or a card in another zone is airbent by hand): only targets or
    // "all/each ..." of the battlefield may stand behind it, so the gate keeps any other airbend manual (CR 701.65a)
    // std-rw6 (CR 701.65a): and a target that is a spell or a permanent ("target creature or spell", FAST5 T59's filter): the handler exiles a spell from the stack
    if (s.action === 'airbend') {
      const ref = s.subject as { ref?: string; id?: string; filter?: { zone?: unknown } } | undefined;
      const spec = ref?.ref === 'target' ? st.specs.get(ref.id!) : undefined;
      const spellOr = spec !== undefined && spec.kind === 'object' && spec.filter !== undefined && spellOrPermanentOf(spec.filter) !== null;
      const zone = spellOr ? 'battlefield' : spec !== undefined ? (spec.kind === 'object' ? (spec.filter as { zone?: unknown } | undefined)?.zone ?? 'battlefield' : 'none') : ref?.ref === 'each' ? ref.filter?.zone ?? 'battlefield' : 'none';
      // edh-next-113 (CR 701.65a, 115.1; Monk Gyatso): or the permanent a "becomes the target" trigger is about ("you may airbend that creature"): it is on the battlefield when the ability triggers
      const becomesTarget = ref?.ref === 'event' && (st.trigger ?? []).length > 0 && (st.trigger ?? []).every((e) => e.ev === 'becomes');
      if (zone !== 'battlefield' && !becomesTarget) throw new NoRenderer('airbend of something that is not a permanent, or not a target or "each" (CR 701.65a)');
    }
    // MX2 (additive): the meld cards' "exile them, then meld them into <result>" (effects/handlers/meld-pair.ts): "them" is the object and its partner
    if (s.action === 'meldPair') {
      if (s.subject !== undefined || s.n !== undefined || arg === null || s.who.ref !== 'you') throw new NoRenderer('meldPair: only "you" and the result');
      // edh-d-89 (CR 508.4; Mishra, Claimed by Gix): the attacking partner the condition named, and the melded permanent entering tapped and attacking: the two always go together
      if ((s.partner !== undefined || s.entersAttacking !== undefined) && (JSON.stringify(s.partner) !== '{"attacking":true}' || s.entersAttacking !== true)) throw new NoRenderer('meldPair: an attacking partner only with "It enters tapped and attacking"');
      if (s.entersAttacking === true) return plain(`exile them, then meld them into ${arg}. It enters tapped and attacking`);
      return plain(`exile them, then meld them into ${arg}`);
    }
    // M12-3 (CR 701.38a-b): "starting with you, each player votes for carnage or homage / a nonland permanent you don't control / a player"
    if (s.action === 'vote') return plain(voteText(s, st));
    // edh-d-48 (CR 701.40a, 701.40e, 107.1; eff.edhd48.manifest.numberEqual; Omarthis, Ghostfire Initiate): you manifest a calculated number of cards from the top of your library, "manifest a number of cards from the top of your library equal to <quantity>" (the engine reads the number as the step resolves, effects/handlers/face-ops.ts#howMany)
    if (s.action === 'manifest' && s.subject === undefined && s.arg === undefined && s.who.ref === 'you' && typeof s.n === 'object' && isComputed(s.n) && s.n.q !== 'eventAmount') {
      return plain(`manifest a number of cards from the top of your library equal to ${K.qty(s.n, st)}`);
    }
    if (s.choices !== undefined) throw new NoRenderer(`action ${s.action} with choices`);
    // `arg` has words in a few actions only ("amass Zombies 2", "behold an Elemental", "meld with", "double the number of ... counters")
    if (s.arg !== undefined && !['amass', 'behold', 'meld', 'doubleCounters', 'empower'].includes(s.action)) throw new NoRenderer(`action ${s.action} with an argument`);
    // r3-choose (CR 107.3a, 608.2h): a calculated number of times with its "where X is" clause, "investigate X times, where X is the total number of creatures those players
    // control" (Officious Interrogation; investigate only, the one action that reads it)
    // r4-fxb (CR 701.34a, 107.3a): proliferate reads it too, "proliferate X times, where X is the number of ..." (effects/handlers/actions-native-counters.ts#amount)
    const computedTimes = (s.action === 'investigate' || s.action === 'proliferate') && s.n !== undefined && isComputed(s.n) && typeof s.n === 'object' && s.n.q !== 'eventAmount'
      // std-rx18 (CR 102.3, 107.3a): a plain count of players too, "investigate X times, where X is the number of opponents you have" (Ethereal Investigator); a count
      // with a qualifier ("once for each opponent who ...") keeps timesWords' wording
      && (s.n.q !== 'countPlayers' || Object.keys(s.n).length === 2);
    // Standard merge wave 4 (family investigate-times-for-each): a count of objects is also cmd1's "once for each <object>" (Sophina, Spearsage Deserter); both
    // count as the instruction resolves (CR 608.2h)
    const eachTimes = computedTimes && typeof s.n === 'object' && ((s.n.q === 'count' && s.n.of.ref === 'each') || s.n.q === 'resultCount' || (s.n.q === 'math' && s.n.op === '*')) ? eachTimesWords(s.n, st) : ''; // edh-c-47: and a whole number of times each of a counted thing (steps-util.ts#timesWords)
    const times = ACTION_SUBJECT[s.action] || PRINTS_N.has(s.action) ? '' : computedTimes ? (eachTimes !== '' ? alt(` X times, where X is ${K.qty(s.n!, st)}`, eachTimes, ...(eachTimes.startsWith(' once for each') ? [eachTimes.replace(' once', '')] : [])) :  // edh-next-34: "investigate for each" says the same as "investigate once for each" (Declaration in Stone)
       ` X times, where X is ${K.qty(s.n!, st)}`) : s.action === 'investigate' && s.n === 1 ? alt('', ' an additional time') /* edh-next-113 (Erdwal Illuminator) */ : timesWords(s.n, st);
    if (s.action === 'ringTempts') return plain(`the Ring tempts you${times}`);
    const subjectForms = ACTION_SUBJECT[s.action];
    const obj = endurer ?? (s.subject !== undefined ? (isPlayerRef(s.subject as never, st) ? K.player(s.subject as never, st, 'object').text : K.obj(s.subject as never, st, 'object').text) : null);
    if (subjectForms) {
      const who = obj ?? K.obj({ ref: 'self' }, st, 'subject').text;
      // FAST5 T65 (CR 701.44a): the N of explore is how many times it explores ("it explores X times", "explores twice"), not a number said after the verb
      if (s.action === 'explore') {
        const times = timesWords(s.n);
        // std-lci (CR 701.44a-b): exploring twice is also said "X explores, then it explores again" (two complete explores, one after the other)
        if (s.n === 2 && obj !== null) return plain(alt(`${who} ${subjectForms[0]}${times}`, `${who} ${subjectForms[0]}, then it ${subjectForms[0]} again`), { have: `${who} ${subjectForms[1]}${times}` });
        return plain(`${who} ${subjectForms[0]}${times}`, { have: `${who} ${subjectForms[1]}${times}` });
      }
      return plain(`${who} ${subjectForms[0]}${n ? ` ${n}` : ''}`, { have: `${who} ${subjectForms[1]}` });
    }
    const objectual = ACTION_OBJECT[s.action];
    if (objectual && obj !== null) {
      const said = `${objectual(obj, n, arg)}${times}`;
      // edh-next-101 (CR 701.40a, 701.58a; family manifest-top-of-player): you manifest (or cloak) the top card of another player's library is also said with its actor ("you manifest the top card of that player's library", Thieving Amalgam)
      const top = s.subject as { ref?: string; player?: { ref?: string } } | undefined;
      return plain((s.action === 'manifest' || s.action === 'cloak') && s.who.ref === 'you' && top?.ref === 'topCards' && top.player?.ref !== 'you' ? alt(said, `you ${said}`) : said);
    }
    const actor = ACTION_ACTOR[s.action];
    // p2-counters-move-1 (CR 701.34a): proliferating twice is also said "proliferate, then proliferate again" (two whole proliferates, one after the other)
    if (actor && s.action === 'proliferate' && s.n === 2 && s.who.ref === 'you') {
      const c = byPlayer(s.who, st, 'proliferate', 'twice');
      return { ...c, imp: alt(c.imp, 'proliferate, then proliferate again') };
    }
    // pc-zones-2 (CR 701.40a, 701.58a): another player manifests (or cloaks) the top card of THEIR library ("Its controller manifests the top card of their library")
    const said = s.who.ref === 'you' || s.who.ref === 'each' ? actor?.(n, arg) : actor?.(n, arg).replace(' of your library', ' of their library'); // (a group stays "your library": the engine manifests for one player, so the gate refuses it)
    if (actor && said !== undefined) {
      const c = byPlayer(s.who, st, said.split(' ')[0]!, `${said.split(' ').slice(1).join(' ')}${times}`.trim());
      // edh-d-56 (CR 701.16a, 608.2h; Innocuous Researcher): investigating once for each counted thing is also led by the count, "For each nonland card revealed this way, you investigate."
      // (the same one instruction as "investigate once for each ...", family investigate-for-each-lead; a count with its own "for each" noun only, the controller investigating)
      if (s.action === 'investigate' && s.subject === undefined && s.who.ref === 'you' && eachTimes.startsWith(' once for each') && typeof s.n === 'object' && s.n.q === 'count') {
        const per = countParts(s.n, st);
        if (per !== null) return { ...c, imp: alt(c.imp, `for each ${per.singular}, you investigate`) };
      }
      // edh-c-38 (CR 701.40e, 701.58e; Ethereal Ambush; family manifest-top-n): manifesting (or cloaking) the top card twice is "manifest the top two cards of your library"
      return (s.action === 'manifest' || s.action === 'cloak') && s.subject === undefined && s.who.ref === 'you' && typeof s.n === 'number' && s.n >= 2
        ? { ...c, imp: alt(c.imp, `${s.action} the top ${s.n} cards of your library`) } : c;
    }
    throw new NoRenderer(`action ${s.action}`);
  },
};

/**
 * std-rx32 (CR 609.4, 702.3b, 613.1f, 613.4c): "Until end of turn, target creature you control gets +1/+0, gains "Whenever this creature deals combat damage to a player,
 * draw cards equal to its toughness," and can attack as though it didn't have defender." (The Pride of Hull Clade): one object's P/T change and ONE quoted ability, in
 * one continuous effect, and the permission to attack despite defender for that object, the duration said first; the comma of the list goes inside the quote.
 */
function pumpGainsNoDefender(s: StepOf<'effect'>, st: RenderState): string | null {
  const [e, r] = s.effects;
  if (e?.s !== 'continuous' || r?.s !== 'permit' || e.cda === true || e.mods.length !== 2 || r.action !== 'attackAsThoughNoDefender' || r.who.ref !== 'you' || r.asThough !== undefined) return null;
  const [pt, grant] = e.mods;
  if (pt?.layer !== '7c' || grant?.layer !== 6 || grant.add?.length !== 1 || grant.remove !== undefined || grant.removeAll !== undefined || grant.cantHave !== undefined) return null;
  const a = grant.add[0]!;
  if (a.kind === 'keyword' || e.affects.ref === 'each' || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) return null;
  if (r.of === undefined || Object.keys(r.of).length !== 1 || JSON.stringify(r.of.is) !== JSON.stringify(e.affects) || s.duration.d === 'permanent') return null;
  const dur = K.dur(s.duration, st);
  const subj = K.obj(e.affects as ObjRef, st, 'subject');
  if (subj.plural) return null;
  const pump = ptPredicate({ ...e, mods: [pt] }, st, false);
  if (pump === null) return null;
  const q = quotedListItem(quotedAbility(a, st, 'creature'), 'comma');
  return `${dur}, ${subj.text} ${pump}, gains ${q} and can attack as though it didn't have defender`;
}

/**
 * edh-next-124 (CR 603.12, 107.3, 608.2h; Minsc & Boo, Timeless Heroes): a reflexive trigger whose first instruction deals damage of a computed amount and whose later instructions use that same
 * amount: "When you do, ~ deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards." (the later uses say "X"). Null for any
 * other trigger. Rendered on a copy of the state.
 */
function reflexiveSharedX(s: StepOf<'reflexive'>, st: RenderState, lead: string): string | null {
  const [first, ...rest] = s.do;
  if (first === undefined || rest.length === 0 || first.op !== 'damage' || s.modes !== undefined) return null;
  const q = first.amount;
  if (q === null || typeof q !== 'object' || q.q === 'X' || (first.also ?? []).length > 0) return null;
  const key = JSON.stringify(q);
  const later = JSON.stringify(rest);
  if (!later.includes(key) || later.includes('"q":"X"')) return null;
  const v = cloneState(st);
  try {
    const head = K.program({ targets: s.targets ?? [], steps: [first] }, v);
    if (!/, where x is /i.test(head)) return null;
    const tail = K.steps(JSON.parse(later.split(key).join(JSON.stringify({ q: 'X' }))) as typeof rest, v);
    return `${lead}, ${head}. ${tail}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}
