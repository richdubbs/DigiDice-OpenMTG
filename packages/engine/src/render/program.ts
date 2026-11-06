/**
 * Effect programs (WP2): the modes ("Choose two --" and its bullets), then the steps (design 2.3 `EffectProgram`, CR 700.2, 608.2c).
 */
import type { Count, EffectProgram, ModeSpec } from '../types/ability';
import { endSentence } from './clause';
import { K } from './kernel';
import { specPhrase } from './refs';
import { isCastChoice } from './self-replacement';
import { cloneState, type RenderState } from './state';
import { alt, firstAlt, joinList, NoRenderer, numWord, pluralize } from './text';
import { withX } from './fold';
import { isComputed } from './steps-util';
import { countQuantityForms } from '../model/forms';
import { chosenEachExileDamage } from './program-edhd102'; // edh-d-102

const word = (c: Count, st: RenderState): string => (typeof c === 'number' ? numWord(c) : c === 'any' ? 'any number' : K.qty(c, st));

/** "choose one --", "choose two --", "choose one or more --", "choose up to two --". */
function modeHeader(m: ModeSpec, st: RenderState): string {
  const { min, max } = m;
  const n = m.options.length;
  let count: string;
  // edh-next-139 (CR 601.2b, 601.4; Doomsday Confluence): "Choose X." (the number of modes is the spell's X)
  if (m.countIsX === true) count = 'x';
  else if (min === max) count = word(min, st);
  else if (min === 0 && max === 'any') count = 'any number';
  // r3-choose (CR 700.2, 107.3a): a calculated number of modes is said with its "where X is" clause, "choose up to X, where X is the number of Lesson cards in your graveyard"
  // std-combat-2 (CR 603.12, 700.2, 608.2h): "when you do, choose up to that many --": none up to the times a payment made a chosen number of times was made
  else if (min === 0 && typeof max === 'object' && max.q === 'resultCount' && max.which === undefined && st.info.get(`b:${max.step}`)?.paidUpTo === true) count = 'up to that many';
  else if (min === 0 && typeof max === 'object' && max.q !== 'X') count = `up to x, where x is ${K.qty(max, st)}`;
  else if (min === 0) count = `up to ${word(max, st)}`;
  else if (min === 1 && (max === 'any' || (typeof max === 'number' && max >= n && n > 2))) count = 'one or more';
  else if (min === 1 && max === 2 && n === 2) count = 'one or both';
  else if (max === 'any') count = `${word(min, st)} or more`;
  else count = `${word(min, st)} to ${word(max, st)}`;
  const chooser = m.chooser ? `${K.player(m.chooser, st, 'subject').text} chooses` : 'choose';
  // edh-players-19 (CR 700.2, 603.3c; Shadrix Silverquill): "you may choose two --": none or exactly that many of the modes (ModeSpec.mayChoose)
  if (m.mayChoose === true) {
    if (min !== 0 || typeof max !== 'number' || max < 2 || m.chooser !== undefined || m.random === true || m.unchosen !== undefined || m.allowRepeat === true || m.override !== undefined || m.pawprints !== undefined) throw new NoRenderer('modes that "you may choose" other than a fixed number of them');
    return `you may choose ${word(max, st)} --`;
  }
  // p2-modal-2 (CR 700.2): "choose one at random --" (ModeSpec.random)
  if (m.random === true) {
    if (min !== 1 || max !== 1 || m.chooser !== undefined || m.allowRepeat === true || m.unchosen !== undefined) throw new NoRenderer('modes chosen at random other than one of them');
    return 'choose one at random --';
  }
  // r3-choose (CR 700.2): "choose one that hasn't been chosen --", "... this turn --" (ModeSpec.unchosen)
  if (m.unchosen !== undefined) {
    if (min !== 1 || max !== 1 || m.chooser !== undefined || m.allowRepeat === true) throw new NoRenderer('modes that have not been chosen, other than one of them');
    return `choose one that hasn't been chosen${m.unchosen === 'turn' ? ' this turn' : ''} --`;
  }
  return `${chooser} ${count} --`;
}

/**
 * std-combat-2 (CR 702.183a, 613.4b; the parser's lower/ability.ts#chosenBasePtModes): tiered modes that are one instruction said again with only its base power and
 * toughness changed are printed as that instruction with "the chosen base power and toughness", each mode then only its power and toughness ("Until end of turn, target
 * creature you control gains "..." and has the chosen base power and toughness. • Galian Beast -- {0} -- 3/2."). Null for any other modes.
 */
function chosenBasePt(m: ModeSpec, st: RenderState): string | null {
  const shared = new Set<string>();
  const sizes: string[] = [];
  for (const o of m.options) {
    const b7 = JSON.stringify(o.program).match(/\{"layer":"7b","power":(\d+),"toughness":(\d+)\}/g);
    if (b7?.length !== 1) return null;
    const [, p, t] = /"power":(\d+),"toughness":(\d+)/.exec(b7[0]!)!;
    const text = endSentence(K.program(o.program, cloneState(st)));
    const phrase = `base power and toughness ${p}/${t}`;
    if (!text.includes(phrase)) return null;
    // the readings that say the size another way ("its base power and toughness become 3/2") keep a mark no Oracle text has, so they can match nothing
    shared.add(text.split(phrase).join('the chosen base power and toughness').split(`${p}/${t}`).join('#size'));
    sizes.push(`${p}/${t}`);
  }
  if (shared.size !== 1 || new Set(sizes).size !== sizes.length) return null;
  return `${[...shared][0]!} ${m.options.map((o, i) => `• ${o.label!} -- ${K.cost(o.cost!, st)} -- ${sizes[i]!}.`).join(' ')}`;
}

/**
 * p2-modal-1 (CR 700.2, 115.3; the parser's lower/ability.ts#differentPlayerModes): "Each mode must target a different player." Every mode targets one player and the
 * player target of each mode names those of the modes before it in `distinctFrom`. Returns the modes without those `distinctFrom` (each mode then says "target player",
 * not "another target player"), null when no mode's target names another mode's, and throws for any other use of them.
 */
function differentPlayers(m: ModeSpec): ModeSpec | null {
  const ids = m.options.map((o) => o.program.targets.map((t) => t.id));
  const cross = m.options.some((o, i) => o.program.targets.some((t) => (t.distinctFrom ?? []).some((d) => ids.some((x, j) => j !== i && x.includes(d)))));
  if (!cross) return null;
  const fits = m.options.every((o, i) => {
    const t = o.program.targets;
    if (t.length !== 1 || t[0]!.kind !== 'player' || t[0]!.min !== 1 || t[0]!.max !== 1) return false;
    const before = m.options.slice(0, i).map((q) => q.program.targets[0]!.id);
    return JSON.stringify(t[0]!.distinctFrom ?? []) === JSON.stringify(before);
  });
  if (!fits || (m.min === 0 && m.mayChoose !== true) || m.max === 1 || m.chooser || m.override || m.allowRepeat || m.unchosen !== undefined || m.pawprints !== undefined || m.options.some((o) => o.cost !== undefined)) {
    throw new NoRenderer('modes whose targets must differ other than "each mode must target a different player"');
  }
  return { ...m, options: m.options.map((o) => ({ ...o, program: { ...o.program, targets: o.program.targets.map(({ distinctFrom: _d, ...t }) => t) } })) };
}

/** `stop`: the header of unchosen modes may also end with a full stop (r4-cost); false where the caller rewrites the header's words. */
function modes(m: ModeSpec, st: RenderState, stop = true): string {
  // p2-modal-1 (CR 700.2, 115.3): "Choose one or more. Each mode must target a different player." and the modes, each with its own "target player"
  const apart = differentPlayers(m);
  if (apart !== null) {
    const options = apart.options.map((o) => `${o.label !== undefined ? `• ${o.label} -- ` : '• '}${endSentence(K.program(o.program, cloneState(st)))}`);
    return `${modeHeader(apart, st).replace(/ --$/, '.')} each mode must target a different player. ${options.join(' ')}`;
  }
  // std-blb (CR 700.2i, 700.2d): "Choose up to five {P} worth of modes. You may choose the same mode more than once." and each mode after its pawprints
  if (m.pawprints !== undefined) {
    if (m.min !== 0 || m.max !== m.pawprints || m.chooser || m.override || m.options.some((o) => o.pawprints === undefined || o.cost !== undefined || o.label !== undefined)) {
      throw new NoRenderer('pawprint modes other than "choose up to N {P} worth of modes"');
    }
    const head = `choose up to ${word(m.pawprints, st)} {P} worth of modes.${m.allowRepeat ? ' you may choose the same mode more than once.' : ''}`;
    return `${head} ${m.options.map((o) => `${'{P}'.repeat(o.pawprints!)} -- ${endSentence(K.program(o.program, cloneState(st)))}`).join(' ')}`;
  }
  // FAST5X E11 (CR 702.183a): the modes of a tiered spell are printed "• Name -- {cost} -- effect" with no header (the "Tiered" keyword line says "choose one")
  const tiered = m.options.length > 0 && m.options.every((o) => o.cost !== undefined && o.label !== undefined);
  if (tiered) {
    if (m.min !== 1 || m.max !== 1 || m.chooser || m.override || m.allowRepeat) throw new NoRenderer('tiered modes chosen other than one');
    const shared = chosenBasePt(m, st); // std-combat-2
    if (shared !== null) return shared;
    return m.options.map((o) => `• ${o.label!} -- ${K.cost(o.cost!, st)} -- ${endSentence(K.program(o.program, cloneState(st)))}`).join(' ');
  }
  // edh-next-129 (CR 700.2, 111.1; Outlaws' Merriment): "choose one at random. Create a red and white creature token with those characteristics." and the bare characteristics of each token
  if (m.tokenChars === true) {
    if (m.random !== true || m.min !== 1 || m.max !== 1 || m.chooser || m.override || m.allowRepeat || m.unchosen !== undefined || m.options.some((o) => o.cost !== undefined || o.label !== undefined)) throw new NoRenderer('token characteristics as modes other than one chosen at random');
    const colors = new Set<string>();
    const bullets = m.options.map((o) => {
      const one = o.program.steps.length === 1 ? o.program.steps[0] : undefined;
      if (o.program.targets.length > 0 || one?.op !== 'createToken' || one.count !== 1 || one.who.ref !== 'you' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token', 'span', 'sentence'].includes(k))) throw new NoRenderer('a mode of token characteristics that is not one plain creation');
      const text = firstAlt(endSentence(K.program(o.program, cloneState(st)))); // the plain reading ("create ...", not "you create ...")
      const r = /^create an? (\d+\/\d+) ((?:[a-z]+ and )?[a-z]+) (.+?) creature token( with .*)?$/is.exec(text);
      if (r === null) throw new NoRenderer('a token creation not said "create a P/T <colors> <subtypes> creature token ..."');
      colors.add(r[2]!.toLowerCase());
      return `• ${r[1]} ${r[3]}${r[4] ?? '.'}`;
    });
    if (colors.size !== 1) throw new NoRenderer('token characteristics of different colors');
    const c = [...colors][0]!;
    return `choose one at random. create ${/^[aeiou]/.test(c) ? 'an' : 'a'} ${c} creature token with those characteristics. ${bullets.join(' ')}`;
  }
  const spree = m.options.length > 0 && m.options.every((o) => o.cost !== undefined);
  // FAST5X E1 (CR 702.172a): the modes of a Spree spell are printed with no header (the "Spree" keyword line, a separate ability, says "choose one or more")
  const spreeNoHeader = spree && m.min === 1 && m.max === m.options.length && !m.chooser && !m.override && !m.allowRepeat;
  // r4-cost (CR 700.2): Oracle also prints "choose one that hasn't been chosen this turn." with a full stop before the bullets
  const plain = m.unchosen !== undefined && stop ? alt(modeHeader(m, st), modeHeader(m, st).replace(/ --$/, '.')) : modeHeader(m, st);
  const header = spree ? (spreeNoHeader ? alt('', 'spree', modeHeader(m, st)) : alt('spree', modeHeader(m, st))) : plain;
  const options = m.options.map((o) => {
    const text = endSentence(K.program(o.program, cloneState(st)));
    if (o.label !== undefined && o.cost !== undefined) throw new NoRenderer('a named mode with a cost outside a tiered spell');
    // FAST5X E11 (CR 207.2d): "• Street Justice -- Exile target creature ...": the mode's name, a flavor word
    return o.cost ? `+ ${K.cost(o.cost, st)} -- ${text}` : o.label !== undefined ? `• ${o.label} -- ${text}` : `• ${text}`;
  });
  // p2-modal-2 (CR 700.2): "Choose one at random. If you discarded a card this turn, you choose one instead." (the override lets the player choose)
  if (m.override?.chosen === true) {
    if (m.random !== true || spree || m.allowRepeat || m.override.min !== 1 || m.override.max !== 1) throw new NoRenderer('a chosen override other than "you choose one instead" of one random mode');
    return `choose one at random. if ${K.cond(m.override.when, st)}, you choose one instead. ${options.join(' ')}`;
  }
  if (m.random === true && m.override !== undefined) throw new NoRenderer('a changed number of modes chosen at random');
  // FAST5X E11 (CR 700.2): Oracle prints a count that changes before the modes: "Choose one. If this spell was cast using teamwork, choose both instead."
  if (m.override && !spree && !m.allowRepeat) {
    const n = m.options.length;
    const head = modeHeader(m, st).replace(/ --$/, '.');
    // FAST5X E22 (CR 700.2, 601.2b): "If you descended this turn, you may choose both instead." (one or both of two modes) and "If there are eight or more
    // permanent cards in your graveyard as you cast this spell, choose one or more instead." (one up to all); "as you cast ~" is when modes are chosen anyway
    if (m.min === 1 && m.max === 1 && m.override.min === 1 && typeof m.override.max === 'number' && m.override.max === n && n >= 2) {
      const when = K.cond(m.override.when, st);
      // p2-modal-1 (CR 700.2): "If this spell was kicked, choose any number instead." (three or more modes) is one up to all of them too
      const choose = n === 2 ? alt('you may choose both instead', 'choose one or more instead') : alt('choose one or more instead', 'choose any number instead');
      return `${head} if ${alt(when, `${when} as you cast ${K.obj({ ref: 'self' }, st, 'object').text}`)}, ${choose}. ${options.join(' ')}`;
    }
    // edh-cast-8 (CR 700.2, 601.2b; Flame of Anor): "If you control a Wizard as you cast this spell, you may choose two instead." (three or more modes: one or two)
    if (m.min === 1 && m.max === 1 && m.override.min === 1 && m.override.max === 2 && n >= 3) {
      const when = K.cond(m.override.when, st);
      return `${head} if ${alt(when, `${when} as you cast ${K.obj({ ref: 'self' }, st, 'object').text}`)}, you may choose two instead. ${options.join(' ')}`;
    }
    const instead = m.override.min === n && m.override.max === n && n === 2 ? 'both' : m.override.min === m.override.max ? word(m.override.max, st) : null;
    if (instead === null) throw new NoRenderer('a changed number of modes that is not one number');
    return `${head} if ${K.cond(m.override.when, st)}, choose ${instead} instead. ${options.join(' ')}`;
  }
  let out = `${header} ${options.join(' ')}`;
  // std-blb (CR 700.2d): Oracle prints the Confluences' "Choose three. You may choose the same mode more than once." before the bullets
  // r5-cost (CR 700.2d): and "Choose up to four. You may choose the same mode more than once." (Moment of Reckoning)
  if (m.allowRepeat && !spree && !m.override && (m.min === m.max || m.min === 0 || m.countIsX === true) && m.pawprints === undefined) out = alt(`${out} you may choose the same mode more than once.`, `${modeHeader(m, st).replace(/ --$/, '.')} you may choose the same mode more than once. ${options.join(' ')}`);
  else if (m.allowRepeat) out += ' you may choose the same mode more than once.';
  if (m.override) out += ` if ${K.cond(m.override.when, st)}, choose ${word(m.override.max, st)} instead.`;
  return out;
}

export function program(p: EffectProgram, st: RenderState): string {
  for (const t of p.targets) st.specs.set(t.id, t);
  const parts: string[] = [];
  // r3-choose (CR 700.2): "choose one that hasn't been chosen and you lose 2 life --": the ability's own instructions are said in the header, before the bullets
  if (p.modes?.unchosen !== undefined && p.steps.length > 0) {
    st.afterTrigger = false;
    const own = K.steps(p.steps, st);
    return modes(p.modes, st, false).replace(/^(choose one that hasn't been chosen(?: this turn)?) --/, `$1 and ${own} --`);
  }
  if (p.modes) {
    st.afterTrigger = false;
    const shared = sharedModes(p, st);
    if (shared !== null) return shared;
    parts.push(modes(p.modes, st));
  }
  const chosen = p.modes === undefined ? (chosenInstead(p, st) ?? chosenSacrificeReturn(p, st) ?? chosenFirst(p, st) ?? chosenPair(p, st) ?? chosenKicked(p, st) ?? chosenPlayerAndTarget(p, st) ?? chosenUpToOneEach(p, st) ?? chosenEachExileDamage(p, st) /* edh-d-102 */) : null;
  // p2-damage-2: one target announced first, the later ones in their own instructions, as a further reading (chosenFirst)
  const later = p.modes === undefined && p.targets.length > 1 ? chosenFirst(p, st, true) : null;
  const whereX = p.modes === undefined ? targetCountWhereX(p, st) : null; // p2-counters-state-3
  const valueWhereX = p.modes === undefined ? targetManaValueWhereX(p, st) : null; // edh-cast-5
  const body = K.steps(p.steps, st);
  // edh-next-39 (CR 602.2b, 601.2c; Endurance Bobblehead): in an activated ability the number of targets is read as the ability is activated
  const activatedX = whereX !== null && st.activating === true ? `${whereX} as you activate this ability` : null;
  const readings = [chosen, later, whereX, valueWhereX, activatedX].filter((x): x is string => x !== null);
  // edh-d-101 (CR 700.2, 608.2c; Blood on the Snow; family then-after-modes): the instructions printed after a spell's bullets are done after the chosen mode, "Then return ..." as well
  // as "Return ..." (the modes run first either way)
  if (body !== '' && p.modes !== undefined && readings.length === 0 && !/^then /.test(body)) { parts.push(alt(body, `then ${body}`)); return parts.join(' '); }
  if (body !== '') parts.push(readings.length === 0 ? body : alt(body, ...readings));
  return parts.join(' ');
}

/**
 * p2-counters-state-3 (CR 107.3, 601.2c, 608.2h): a sentence whose targets' number is a calculated quantity is also said with X and one "where X is" clause after it:
 * "Destroy up to X target lands, where X is the number of verse counters on ~" (Rumbling Crescendo), "return up to X target permanents to their owners' hands, where
 * X is ..."; every instruction of the sentence that uses the same quantity says X too ("up to X target creatures each get +X/+X"). Only one such count among the
 * targets, and only a body that is one sentence (the clause closes that sentence). Null for anything else; the plain reading stays the first.
 */
function targetCountWhereX(p: EffectProgram, st: RenderState): string | null {
  // the specs of the targets the steps name (a sentence of a longer ability is rendered with the ability's specs already known: RenderState.specs)
  const named = JSON.stringify(p.steps);
  const counted = [...st.specs.values()].filter((t) => named.includes(`"ref":"target","id":"${t.id}"`) && typeof t.max === 'object' && isComputed(t.max));
  if (counted.length !== 1) return null;
  const t = counted[0]!;
  const key = JSON.stringify(t.max);
  if (!(t.min === 0 || JSON.stringify(t.min) === key)) return null;
  // guard G10 (fail closed): only a count the targets' announcement reads (model/forms.ts#countQuantityForms); any other one ("your devotion to black", "the number of
  // opponents you have") would gate a sentence the engine then cannot run, and the whole ability would lose what its fallback kept automated
  // edh-d-49 (CR 603.12, 706.2; Slight Malfunction): the result of the roll before a "When you do" is fixed as the reflexive trigger is created (model/cap-walk.ts#reflexiveBakedCounts)
  if (countQuantityForms(t.max as never).includes('feature:count.quantity') && JSON.stringify(t.max) !== '{"q":"dieResult"}') return null;
  const v = cloneState(st);
  v.xCount = key;
  const text = K.steps(p.steps.map((s) => withX(s, key)), v);
  if (text === '' || / where x is /.test(text)) return null;
  if (/[.!?]\s/.test(text)) {
    // edh-next-140 (CR 107.3, 601.2c, 608.2h; Archipelagore): the clause closes the FIRST sentence when only its instruction uses the count and a later sentence follows: "tap up to X target
    // creatures, where X is the number of times this creature has mutated. Those creatures don't untap during their controller's next untap step."
    if (p.steps.length < 2 || p.steps.slice(1).some((x) => JSON.stringify(x).includes(key))) return null;
    const w = cloneState(st);
    w.xCount = key;
    const first = K.steps([withX(p.steps[0]!, key)], w);
    if (first === '' || /[.!?]\s/.test(first) || / where x is /.test(first)) return null;
    const where = K.qty(t.max as never, w);
    const rest = K.steps(p.steps.slice(1), w);
    if (rest === '' || / where x is /.test(rest)) return null;
    return `${first.replace(/\.$/, '')}, where x is ${where}. ${rest}`;
  }
  return `${text.replace(/\.$/, '')}, where x is ${K.qty(t.max as never, v)}`;
}

/**
 * edh-cast-5 (CR 107.3, 202.3, 601.2c, 608.2h; family target-mana-value-where-x): a target whose description limits its mana value by a calculated quantity ("counter target
 * spell with mana value less than or equal to the number of Faeries you control") is also said with X and one "where X is" clause closing the sentence: "Counter target
 * spell with mana value X or less, where X is the number of Faeries you control." (Spellstutter Sprite). The quantity is read as the target is announced, the same number
 * either way. Only one such target among the steps' targets and a body that is one sentence (the clause closes that sentence). Null for anything else; the plain reading stays
 * the first.
 */
function targetManaValueWhereX(p: EffectProgram, st: RenderState): string | null {
  const named = JSON.stringify(p.steps);
  // edh-next-27 (CR 107.3, 208.1, 601.2c; Go-Shintai of Hidden Cruelty): the same for a limit on toughness or power, "destroy target creature with toughness X or less, where X is the number of Shrines you control"
  const FIELDS = ['manaValue', 'toughness', 'power'] as const;
  const limits = [...st.specs.values()].flatMap((t) => FIELDS.map((field) => {
    const mv = t.kind === 'object' || t.kind === 'spell' || t.kind === 'stackObject' ? t.filter?.[field] : undefined;
    return named.includes(`"ref":"target","id":"${t.id}"`) && mv !== undefined && mv.op === '<=' && typeof mv.value === 'object' && isComputed(mv.value) && mv.value.q !== 'X' && mv.value.q !== 'var' ? { t, field, mv } : null;
  })).filter((x): x is NonNullable<typeof x> => x !== null);
  if (limits.length !== 1) return null;
  const { t, field, mv } = limits[0]!;
  const v = cloneState(st);
  v.specs.set(t.id, { ...t, filter: { ...t.filter, [field]: { op: '<=', value: { q: 'X' } } } } as typeof t);
  const text = K.steps(p.steps, v);
  if (text === '' || /[.!?]\s/.test(text) || / where x is /.test(text)) return null;
  return `${text.replace(/\.$/, '')}, where x is ${K.qty(mv.value as never, v)}`;
}

/** std-costs-2: the binding name the shared instruction of target-only modes says "those cards" with (sharedModes). */
const SHARED = '$modes';

/**
 * std-costs-2 (CR 700.2, 115.1, 608.2c; the parser's lower/ability.ts#sharedInstructionModes): modes that are each one target and no instruction, with the
 * program's first step acting on the union of exactly those targets, are printed "Choose up to two. Return those cards from your graveyard to your hand. • Target
 * artifact card. • Target creature card.": the header with a full stop, the instruction on "those cards", then each mode's target phrase. The zone of the targets
 * is said once by the instruction ("those cards from your graveyard"), so a bullet leaves it out; with targets of different zones or owners there is no such
 * wording (null: the usual rendering, which the gate refuses). Rendered on a copy of the state.
 */
function sharedModes(p: EffectProgram, st: RenderState): string | null {
  const m = p.modes;
  if (m === undefined || m.override || m.allowRepeat || m.pawprints !== undefined || m.unchosen !== undefined || m.chooser !== undefined) return null;
  if (m.options.length < 2 || !m.options.every((o) => o.program.steps.length === 0 && o.program.targets.length === 1 && o.program.modes === undefined && o.cost === undefined && o.label === undefined)) return null;
  const specs = m.options.map((o) => o.program.targets[0]!);
  const zone = specs[0]!.filter?.zone;
  if (typeof zone !== 'string' || !specs.every((t) => t.kind === 'object' && t.min === 1 && t.max === 1 && t.filter?.zone === zone && t.filter.owner === 'you' && t.filter.isCard === true)) return null;
  const first = p.steps[0];
  const union = JSON.stringify({ ref: 'union', of: specs.map((t) => ({ ref: 'target', id: t.id })) });
  const pieces = first === undefined ? [] : JSON.stringify(first).split(union);
  if (pieces.length !== 2 || specs.some((t) => JSON.stringify(p.steps.slice(1)).includes(JSON.stringify({ ref: 'target', id: t.id })))) return null;
  const v = cloneState(st);
  v.info.set(`b:${SHARED}`, { nouns: ['card'], plural: true, zone, alts: [`those cards from your ${zone}`] });
  v.mentioned.add(`b:${SHARED}`);
  const step = JSON.parse(pieces.join(JSON.stringify({ ref: 'bound', name: SHARED }))) as EffectProgram['steps'][number];
  const body = endSentence(K.steps([step, ...p.steps.slice(1)], v));
  const bullets = specs.map((t) => `• ${endSentence(specPhrase(t, v, { noZone: true }))}`);
  return `${modeHeader(m, v).replace(/ --$/, '.')} ${body} ${bullets.join(' ')}`;
}

/** edh-next-124: the binding name the group of chosenUpToOneEach's targets is said with. */
const CHOSEN_EACH = '$chosenEach';

/**
 * edh-next-124 (CR 115.1, 601.2c, 608.2b; the parser's template eff.edhn124.choose.threeTargets and lower/mentions.ts#announcedGroup; Teferi, Who Slows the Sunset): two or more
 * object targets, each "up to one", announced together in a sentence of their own, with instructions that name them only as one group: "Choose up to one target artifact, up to
 * one target creature, and up to one target land. Untap the chosen permanents you control. Tap the chosen permanents you don't control. You gain 2 life." The group is "the
 * chosen <nouns>" (a noun every target's description has). Null for any other program. Rendered on a copy of the state.
 */
function chosenUpToOneEach(p: EffectProgram, st: RenderState): string | null {
  if (p.targets.length < 2 || p.steps.length === 0) return null;
  if (!p.targets.every((t) => t.kind === 'object' && t.min === 0 && t.max === 1 && t.perOpponent !== true && t.perPlayer !== true && t.onlyIf === undefined && t.chooser === undefined)) return null;
  const union = JSON.stringify({ ref: 'union', of: p.targets.map((t) => ({ ref: 'target', id: t.id })) });
  const pieces = JSON.stringify(p.steps).split(union);
  if (pieces.length < 2 || pieces.some((x) => p.targets.some((t) => x.includes(JSON.stringify({ ref: 'target', id: t.id }))))) return null;
  const v = cloneState(st);
  try {
    const phrases = p.targets.map((t) => K.obj({ ref: 'target', id: t.id }, v, 'object').text);
    const nounsOf = (id: string): string[] => v.info.get(`t:${id}`)?.nouns ?? [];
    // the nouns every target's description has, and "permanent" when every target is a permanent (no zone but the battlefield)
    const onBattlefield = p.targets.every((t) => t.filter?.zone === undefined || t.filter.zone === 'battlefield');
    const shared = [...nounsOf(p.targets[0]!.id), ...(onBattlefield ? ['permanent'] : [])]
      .filter((n, i, all) => all.indexOf(n) === i && (n === 'permanent' ? onBattlefield : p.targets.every((t) => nounsOf(t.id).includes(n))));
    if (shared.length === 0) return null;
    v.afterTrigger = false;
    v.info.set(`b:${CHOSEN_EACH}`, { nouns: shared, plural: true, alts: shared.map((n) => `the chosen ${pluralize(n)}`) });
    v.mentioned.add(`b:${CHOSEN_EACH}`);
    const steps = JSON.parse(pieces.join(JSON.stringify({ ref: 'bound', name: CHOSEN_EACH }))) as EffectProgram['steps'];
    return `choose ${joinList(phrases)}. ${K.steps(steps, v)}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}

/** std-costs-2: the binding name the group of chosenInstead's targets is said with. */
const CHOSEN = '$chosen';

/**
 * std-costs-2 (CR 601.2b, 601.2c, 608.2c; the parser's lower/choose.ts#insteadChoose and lower/mentions.ts#insteadChosenGroup): two object targets, the first announced
 * only when a condition decided at announcement does not hold and the second only when it does, with instructions that act on the two as one group: "Choose target
 * creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each chosen creature to your hand." The group is
 * "the chosen creatures" or "each chosen <noun>" (a noun both targets' descriptions have). Null unless the instructions name the targets only as that group.
 */
function chosenInstead(p: EffectProgram, st: RenderState): string | null {
  if (p.targets.length !== 2 || p.steps.length === 0) return null;
  const [a, b] = [p.targets[0]!, p.targets[1]!];
  const c = b.onlyIf;
  if (a.kind !== 'object' || b.kind !== 'object' || c === undefined || !isCastChoice(c) || JSON.stringify(a.onlyIf) !== JSON.stringify({ cond: 'not', of: c })) return null;
  const union = JSON.stringify({ ref: 'union', of: [{ ref: 'target', id: a.id }, { ref: 'target', id: b.id }] });
  const pieces = JSON.stringify(p.steps).split(union);
  if (pieces.length < 2 || pieces.some((x) => x.includes(`"ref":"target","id":"${a.id}"`) || x.includes(`"ref":"target","id":"${b.id}"`))) return null;
  const v = cloneState(st);
  try {
    const head = `choose ${K.obj({ ref: 'target', id: a.id }, v, 'object').text}. if ${K.cond(c, v)}, instead choose ${K.obj({ ref: 'target', id: b.id }, v, 'object').text}.`;
    v.conds.add(JSON.stringify({ cond: 'not', of: c })); // "instead" says the first targets are chosen only when the condition does not hold (as render/steps-flow.ts does)
    const na = v.info.get(`t:${a.id}`)?.nouns ?? [];
    const nouns = (v.info.get(`t:${b.id}`)?.nouns ?? []).filter((n) => na.includes(n));
    if (nouns.length === 0) return null;
    v.afterTrigger = false;
    // std-costs-6 (CR 601.2c, 702.194b): two single targets are one object either way, "the chosen card"
    const one = [a, b].every((t) => t.min === 1 && t.max === 1);
    v.info.set(`b:${CHOSEN}`, one ? { nouns, plural: false, alts: nouns.map((n) => `the chosen ${n}`) } : { nouns, plural: true, alts: nouns.flatMap((n) => [`the chosen ${pluralize(n)}`, `each chosen ${n}`]) });
    v.mentioned.add(`b:${CHOSEN}`);
    const steps = JSON.parse(pieces.join(JSON.stringify({ ref: 'bound', name: CHOSEN }))) as EffectProgram['steps'];
    return `${head} ${K.steps(steps, v)}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}

/** std-rx10: the controller words a target phrase ends with, as the parser reads "the creature you control" (parser/holes/object.ts#W_CONTROLS). */
const CONTROLS_WORDS = ['you control', "you don't control", 'an opponent controls'];

/**
 * std-rx10 (CR 115.1, 601.2c, 608.2c; the parser's template eff.stdrx10.choose.twoTargets and lower/mentions.ts#announcedGroup): two single object targets announced
 * together in a sentence of their own before the instructions, "Choose target creature you control and target creature you don't control. ... Then those creatures
 * fight each other.": the same targets and instructions. After it each target is also "the chosen <noun>" and, when its phrase is "target <noun> <controller
 * words>", "the <noun> <controller words>"; the fight of the two is "those creatures fight each other" (state.ts#chosenPair). Null unless every target is named by
 * an instruction. Rendered on a copy of the state.
 */
function chosenPair(p: EffectProgram, st: RenderState): string | null {
  if (p.targets.length !== 2 || p.steps.length === 0) return null;
  if (!p.targets.every((t) => t.kind === 'object' && t.min === 1 && t.max === 1 && t.perOpponent !== true && t.perPlayer !== true)) return null;
  const body = JSON.stringify(p.steps);
  if (!p.targets.every((t) => body.includes(JSON.stringify({ ref: 'target', id: t.id })))) return null;
  const v = cloneState(st);
  try {
    const [ta, tb] = [p.targets[0]!, p.targets[1]!];
    const head = `choose ${K.obj({ ref: 'target', id: ta.id }, v, 'object').text} and ${K.obj({ ref: 'target', id: tb.id }, v, 'object').text}`;
    v.afterTrigger = false;
    const nounsOf = (id: string): string[] => v.info.get(`t:${id}`)?.nouns ?? [];
    const noun = nounsOf(ta.id).find((n) => nounsOf(tb.id).includes(n));
    if (noun === undefined) return null;
    for (const t of [ta, tb]) {
      const key = `t:${t.id}`;
      const info = v.info.get(key);
      if (info === undefined) return null;
      const extra = info.nouns.map((n) => `the chosen ${n}`);
      const m = /^target (\w+) (.+)$/.exec((t.text ?? '').toLowerCase());
      if (m !== null && CONTROLS_WORDS.includes(m[2]!)) extra.push(`the ${m[1]} ${m[2]}`);
      v.info.set(key, { ...info, alts: [...new Set([...(info.alts ?? []), ...extra])] });
    }
    v.chosenPair = { a: ta.id, b: tb.id, noun };
    // the first instruction may follow the announcement with "then" (Oracle: "... you don't control. Then those creatures fight each other.")
    return `${head}. ${alt('', 'then ')}${K.steps(p.steps, v)}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}

/**
 * edh-mana-keywords-9 (CR 115.1, 115.3, 601.2c, 702.33c, 608.2c; the parser's template eff.edhmk9.choose.anyTarget.thenAnotherPerKick and lower/mentions.ts#announcedGroup; Comet
 * Storm): "Choose any target, then choose another target for each time ~ was kicked. ~ deals X damage to each of them.": any target and as many other targets as the spell was
 * kicked, announced together in a sentence of their own, and the one damage step that deals the same damage to every one of them. Null for any other program. Rendered on a copy.
 */
function chosenKicked(p: EffectProgram, st: RenderState): string | null {
  if (p.targets.length !== 2 || p.steps.length !== 1) return null;
  const [a, b] = [p.targets[0]!, p.targets[1]!];
  const kicks = JSON.stringify({ q: 'kickCount' });
  if (a.kind !== 'anyTarget' || a.min !== 1 || a.max !== 1 || a.filter !== undefined || a.players !== undefined || a.distinctFrom !== undefined) return null;
  if (b.kind !== 'anyTarget' || JSON.stringify(b.min) !== kicks || JSON.stringify(b.max) !== kicks || b.filter !== undefined || b.players !== undefined || JSON.stringify(b.distinctFrom) !== JSON.stringify([a.id])) return null;
  const [step] = p.steps;
  if (step?.op !== 'damage' || step.guard !== undefined || step.as !== undefined || JSON.stringify(step.to) !== JSON.stringify({ ref: 'union', of: [{ ref: 'target', id: a.id }, { ref: 'target', id: b.id }] })) return null;
  const v = cloneState(st);
  try {
    const one = K.steps([{ ...step, to: { ref: 'target', id: a.id } }], v);
    if (!/ to any target\.?$/.test(one)) return null;
    return `choose any target, then choose another target for each time ~ was kicked. ${one.replace(/ to any target(\.?)$/, ' to each of them$1')}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}

/**
 * std-rx30 (CR 115.1, 601.2c; the parser's eff.stdrx30.choose.targetPlayer.andTargets): a target player and up to one target object that player controls announced
 * together in a sentence of their own, "Choose target opponent and up to one target creature they control. They reveal their hand. ..." (Cloak and Dagger, Entwined):
 * the same targets and instructions; afterwards the player is "they" and the object also "the chosen <noun>". Rendered on a copy of the state.
 */
function chosenPlayerAndTarget(p: EffectProgram, st: RenderState): string | null {
  const [tp, to] = p.targets;
  if (p.targets.length !== 2 || tp?.kind !== 'player' || to?.kind !== 'object' || p.steps.length === 0 || to.perPlayer === true || to.perOpponent === true) return null;
  if (JSON.stringify(to.filter?.controller) !== JSON.stringify({ ref: 'target', id: tp.id })) return null;
  const body = JSON.stringify(p.steps);
  if (![tp, to].every((t) => body.includes(JSON.stringify({ ref: 'target', id: t.id })))) return null;
  const v = cloneState(st);
  try {
    const player = K.obj({ ref: 'target', id: tp.id }, v, 'object').text;
    const object = K.obj({ ref: 'target', id: to.id }, v, 'object').text.replace(/ that player controls$/, alt(' that player controls', ' they control'));
    v.afterTrigger = false;
    const pk = `t:${tp.id}`;
    const pi = v.info.get(pk);
    if (pi !== undefined) v.info.set(pk, { ...pi, alts: [...new Set([...(pi.alts ?? []), 'they', 'the chosen player'])] });
    const ok = `t:${to.id}`;
    const oi = v.info.get(ok);
    if (oi === undefined) return null;
    v.info.set(ok, { ...oi, alts: [...new Set([...(oi.alts ?? []), ...oi.nouns.map((n) => `the chosen ${n}`)])] });
    return `choose ${player} and ${object}. ${K.steps(p.steps, v)}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}

/**
 * edh-zones-26 (CR 701.21a, 115.1, 608.2b, 608.2c; the parser's templates eff.edhz26.* and lower/choose.ts#lowerSacrificeReturnPair; Goblin Welder): a permanent and a card in a
 * graveyard of its controller announced together, "Choose target artifact a player controls and target artifact card in that player's graveyard.", and the one
 * `exchange` step of kind `sacrificeReturn` after it: "If both targets are still legal as this ability resolves, that player simultaneously sacrifices the artifact and returns
 * the artifact card to the battlefield." (also "Then that player ..."). One card type word for both. Null for any other program. Rendered on a copy of the state.
 */
function chosenSacrificeReturn(p: EffectProgram, st: RenderState): string | null {
  const [ta, tb] = p.targets;
  const [step] = p.steps;
  if (p.targets.length !== 2 || p.steps.length !== 1 || ta === undefined || tb === undefined || step?.op !== 'exchange' || step.what !== 'sacrificeReturn' || step.guard !== undefined || step.as !== undefined) return null;
  if (JSON.stringify(step.a) !== JSON.stringify({ ref: 'target', id: ta.id }) || JSON.stringify(step.b) !== JSON.stringify({ ref: 'target', id: tb.id })) return null;
  const single = (t: typeof ta, keys: string[]): string | null => {
    const f = t.filter as unknown as Record<string, unknown> | undefined;
    const types = f?.['types'];
    if (t.kind !== 'object' || t.min !== 1 || t.max !== 1 || t.onlyIf !== undefined || t.distinctFrom !== undefined || f === undefined || Object.keys(f).sort().join() !== keys.join()) return null;
    return Array.isArray(types) && types.length === 1 && typeof types[0] === 'string' ? types[0].toLowerCase() : null;
  };
  const a = single(ta, ['types']);
  const b = single(tb, ['isCard', 'owner', 'types', 'zone']);
  const f2 = tb.filter as unknown as Record<string, unknown>;
  if (a === null || a !== b || ta.perOpponent === true || ta.perPlayer === true || f2['zone'] !== 'graveyard' || f2['isCard'] !== true) return null;
  if (JSON.stringify(f2['owner']) !== JSON.stringify({ ref: 'controllerOf', object: { ref: 'target', id: ta.id } })) return null;
  return `choose target ${a} a player controls and target ${a} card in that player's graveyard. ${alt('if both targets are still legal as this ability resolves, ', 'then ')}that player simultaneously sacrifices the ${a} and returns the ${a} card to the battlefield`;
}

/**
 * Cloud std-eoe (CR 115.1, 601.2c; the parser's lower/choose.ts): the one object target of an effect announced in a sentence of its own before the instructions,
 * "Choose up to one target creature. That creature can't be blocked this turn ...": the same targets and the same instructions, the first of which names the
 * target as "that creature" or "it" (state.ts#chosen). Only when the first instruction names that target; null otherwise. Rendered on a copy of the state.
 */
function chosenFirst(p: EffectProgram, st: RenderState, laterTargets = false): string | null {
  const [t] = p.targets;
  // r3-choose: a player too; r4-dig: a spell too ("Choose target spell. Surveil 2, then counter the chosen spell ...", CR 115.1, 601.2c)
  if (t === undefined || (t.kind !== 'object' && t.kind !== 'player' && t.kind !== 'spell' && t.kind !== 'stackObject' /* edh-cast-15: Subtlety, "choose up to one target creature spell or planeswalker spell" */ && !(t.kind === 'anyTarget' && t.min === 1 && t.max === 1 && t.filter === undefined) /* edh-c-46: Blast of Genius, "choose any target" */) || p.steps.length === 0) return null;
  // p2-damage-2 (CR 115.1, 601.2c): later targets of their own instructions after it ("Choose target creature an opponent controls. When that creature dies this turn,
  // you gain 3 life. Target creature you control fights that creature.", Time to Feed): only targets the first instruction does not name, and only when no reading
  // of several targets announced together applies (`laterTargets`, the last one tried)
  if (p.targets.length > 1 && (!laterTargets || p.targets.slice(1).some((o) => (JSON.stringify(p.steps[0]).includes(JSON.stringify({ ref: 'target', id: o.id })) && !(t.kind === 'player' && o.kind === 'object' && JSON.stringify(o.filter?.controller) === JSON.stringify({ ref: 'target', id: t.id }))) /* edh-c-77 (CR 115.1, 601.2c; The Fall of Kroog): "Choose target opponent. Destroy target land that player controls." */ || o.chooser !== undefined) || t.perPlayer === true)) return null;
  const ref = JSON.stringify({ ref: 'target', id: t.id });
  // r3-choose (the parser's lower/choose.ts): a later instruction may be the first to name it ("You may sacrifice an artifact. If you do, return the chosen card ...")
  const first = JSON.stringify(p.steps[0]).includes(ref);
  if (!first && !p.steps.some((s) => JSON.stringify(s).includes(ref))) return null;
  const v = cloneState(st);
  try {
    // std-rx30 (CR 115.1, 601.2c): up to one target of each player, announced "For each player, choose up to one other target artifact or creature that player controls."
    // (Kitesail Larcenist); afterwards "the chosen permanents" as well
    // edh-d-101 (CR 115.1, 601.2c; Disorienting Choice): and up to one target of each opponent, "For each opponent, choose up to one target artifact or enchantment that player controls."
    const each = t.kind === 'object' && t.perPlayer === true ? 'for each player, ' : t.kind === 'object' && t.perOpponent === true ? 'for each opponent, ' : '';
    const head = `${each}choose ${K.obj({ ref: 'target', id: t.id }, v, 'object').text}`;
    v.afterTrigger = false;
    // r3-choose (CR 608.2c; the parser's participle, lower/mentions.ts): the target is also "the chosen <noun>" after its own sentence
    const key = `t:${t.id}`;
    const info = v.info.get(key);
    const nouns = info?.player === true ? ['player'] : each !== '' ? [...new Set([...(info?.nouns ?? []), 'permanent'])] : (info?.nouns ?? []);
    // std-costs-2 (family each-chosen): several targets are also "each chosen <noun>" ("Return each chosen creature to your hand")
    const chosenAs = (n: string): string[] => (info?.plural === true && info.player !== true ? [alt(`the chosen ${pluralize(n)}`, `each chosen ${n}`)] : [`the chosen ${info?.plural ? pluralize(n) : n}`]);
    // edh-c-46 (CR 115.1, 608.2c; Blast of Genius): the player or permanent any target chose is "that permanent or player"
    // edh-next-74 (CR 115.1, 608.2c; Radiant Performer): the spell or ability any "target spell or ability" chose is "that spell or ability"
    const anyAlts = t.kind === 'anyTarget' ? ['that permanent or player'] : t.kind === 'stackObject' && t.filter?.stackKind === undefined ? ['that spell or ability'] : [];
    if (info !== undefined) v.info.set(key, { ...info, alts: [...new Set([...(info.alts ?? []), ...nouns.flatMap(chosenAs), ...anyAlts])] });
    if (first) v.chosen = { key, list: p.steps };
    const rest = K.steps(p.steps, v);
    // p2-c-dieroll-2 (family choose-then-roll): "choose target creature an opponent controls, then roll a d20." over result rows (the parser's lower/choose.ts#thenRoll)
    // edh-top-8 (family choose-then-roll; CR 115.1, 705.1; Invert Polarity): and "choose target spell, then flip a coin." (the parser's lower/choose.ts#thenRoll, a flip with riders after it)
    if (p.steps[0]?.op === 'rollDie' || p.steps[0]?.op === 'flipCoin') return alt(`${head}. ${rest}`, `${head}, then ${rest}`);
    return `${head}. ${rest}`;
  } catch (e) {
    if (e instanceof NoRenderer) return null;
    throw e;
  }
}
