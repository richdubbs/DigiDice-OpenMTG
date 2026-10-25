/**
 * Lane trek, round trek-5 (Star Trek: differently named lands, hand size, life, Treasure, returned to hand): the template data of
 * parser/templates/zz-cloud/trek-5.json and the changes that read the other wordings of its cards: the condition "you control N or more differently named lands"
 * (parser/holes/cond.ts, render/cond.ts, actions/announce-cond.ts), "a permanent was returned to your hand from the battlefield this turn" (parser/holes/cond.ts#zoneHistory,
 * render/cond.ts#zoneHistoryPhrase), "that card is still on top of your library" (cond.ts, family still-on-top), the title "Ensign" in a legendary short name
 * (parser/front/selfref.ts), the focus left on a card a cast named (model/focus.ts#focusEffect), "the chosen cards" and "that player owns exiled this way"
 * (render/np.ts, render/steps-flow.ts) and the renderer's "double your life total", "can't sacrifice <filter>" and "~'s base power and toughness become N/M".
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in trek-5-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-5.json';
import review from '../../m5/golden/cards/trek-5-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the examples are effects (or a static ability, or an activated ability with its cost) of a card. */
const parse = (text: string, type = 'Sorcery', extra: { power?: string; toughness?: string; supertypes?: string } = {}) => {
  const creature = type.includes('Creature');
  return parseCard(card('Example Ooze', type, text, creature ? { power: extra.power ?? '1', toughness: extra.toughness ?? '1' } : undefined), OPTS).faces[0]!;
};
const parseOf = (text: string) => parse(text, /^(\{|Flying)|can't sacrifice|base power and toughness|Activate only/.test(text) ? 'Creature — Ooze' : 'Sorcery');
const golden = review as { card: string; verified: string; expect?: string }[];
/** The golden cards whose `verified` text names the template (the id followed by a comma, a closing bracket or a space, never by "." and more of another id). */
const evidence = (id: string): string[] => {
  const re = new RegExp(`(^|[ (])${id.replace(/\./g, '\\.')}(?=[,) ]|$)`);
  return golden.filter((g) => re.test(g.verified)).map((g) => g.card);
};

describe('trek-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-5.json, after std-woe, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-5.json');
    expect(files.indexOf('zz-cloud/trek-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-woe.json'));
    expect(files.indexOf('zz-cloud/trek-5.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta).trek5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.trek5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner 2026-10-24): all six wordings are printed on one or two cards of the index each, so each is stable on its hand-verified golden cards (fewer than three each)', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.trek5.base.become', 'eff.trek5.cast.free.ifSpellMvAtMost', 'eff.trek5.double.life', 'eff.trek5.double.life.you', 'eff.trek5.nomaxhand.dur', 'sta.trek5.player.cantSacrifice',
    ]);
    expect(evidence('eff.trek5.nomaxhand.dur')).toEqual(['Deep Space Scan', 'Live Long and Prosper']);
    expect(evidence('eff.trek5.double.life.you')).toEqual(['Live Long and Prosper']);
    expect(evidence('eff.trek5.double.life')).toEqual(['Beacon of Immortality']);
    expect(evidence('eff.trek5.base.become')).toEqual(['Seven of Nine, Unassimilated']);
    expect(evidence('eff.trek5.cast.free.ifSpellMvAtMost')).toEqual(['Commander Spock']);
    expect(evidence('sta.trek5.player.cantSacrifice')).toEqual(['Quark, Humble Proprietor']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parseOf(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parseOf(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parseOf(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bDouble\b/, 'Triple'], [/\bdouble\b/, 'triple'], [/\blife total\b/, 'poison counters'], [/\bno maximum\b/, 'a maximum'], [/\bmaximum hand size\b/, 'minimum hand size'],
    [/\buntil your next turn\b/, 'for the rest of the turn'], [/\bcan't sacrifice\b/, 'can sacrifice'], [/\bcan't sacrifice\b/, "can't discard"], [/\bbecome\b/, 'gain'], [/\bbase power and toughness\b/, 'power and toughness'],
    [/\bequal to or less than\b/, 'equal to or greater than'], [/\bequal to or less than\b/, 'greater than'], [/\bmay cast\b/, 'cast'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parseOf(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parseOf(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parseOf(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-5 readings of the other wordings (parser/holes/cond.ts, parser/front/selfref.ts, model/focus.ts)', () => {
  it('CR 201.5c: "Ensign" is a title kept in the short name of a legendary card (Ensign Pavel Chekov is "Ensign Chekov")', () => {
    const f = parseCard(card('Ensign Pavel Tester', 'Legendary Creature — Human Pilot', 'When Ensign Tester enters, you gain 1 life.', { power: '1', toughness: '5' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    // not for a card that is not legendary: the short name is the name before a comma only (CR 201.5c)
    const g = parseCard(card('Ensign Pavel Tester', 'Creature — Human Pilot', 'When Ensign Tester enters, you gain 1 life.', { power: '1', toughness: '5' }), OPTS).faces[0]!;
    expect(fullyAutomated(g)).toBe(false);
  });
  it('CR 201.2: "you control five or more differently named lands" is the different names among the lands you control, at least five (and "fewer" is its negation)', () => {
    const f = parseOf('Draw a card. Then discard a card unless you control five or more differently named lands.');
    expect(JSON.stringify(f.abilities)).toContain('"cond":"compare","left":{"q":"distinct","what":"names","among":{"ref":"each","filter":{"types":["Land"],"controller":"you"}}},"op":">=","right":5');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(fullyAutomated(parseOf('Draw a card. Then discard a card unless an opponent controls five or more differently named lands.')), 'an opponent: one per opponent, not read').toBe(false);
  });
  it('CR 602.5b: "Activate only if you control seven or more differently named lands." is read at announcement (the different names among the visible lands)', () => {
    const f = parseOf('{T}: Draw a card. Activate only if you control seven or more differently named lands.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.distinct.names.each')).toBe(true);
  });
  it('CR 603.4, 400.3: "if a permanent was returned to your hand from the battlefield this turn" is a turn-history zoneChange of a permanent you own, battlefield to hand', () => {
    const f = parse('At the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card.', 'Creature — Ooze');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"happened","event":{"ev":"zoneChange","subject":{"owner":"you"},"from":"battlefield","to":"hand"},"scope":"turn"}');
    // an opponent's hand: another condition (the owner is not you), not read
    expect(fullyAutomated(parse("At the beginning of each end step, if a permanent was returned to an opponent's hand from the battlefield this turn, draw a card.", 'Creature — Ooze'))).toBe(false);
  });
  it('CR 400.7, 401.5: "If that card is still on top of your library, draw a card." names a card an earlier instruction revealed', () => {
    const f = parse('Reveal the top card of your library. If that card is still on top of your library, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"zone":"library","is":{"ref":"topCards","player":{"ref":"you"},"count":1}}');
    // no earlier instruction named a card: "that card" has no antecedent
    expect(fullyAutomated(parse('If that card is still on top of your library, draw a card.'))).toBe(false);
  });
  it('CR 608.2c, 601.2: the cast of a revealed card leaves the discourse on that card ("If it\'s a land card, you may put it onto the battlefield tapped."), in a trigger of the creature too', () => {
    const cast = "You may cast that card without paying its mana cost if that spell's mana value is equal to or less than the number of lands you control.";
    for (const text of [
      `Reveal the top card of your library. ${cast} If it's a land card, you may put it onto the battlefield tapped.`,
      `Whenever ~ enters or attacks, reveal the top card of your library. ${cast} If it's a land card, you may put it onto the battlefield tapped.`,
    ]) {
      const f = parse(text, text.startsWith('Whenever') ? 'Creature — Ooze' : 'Sorcery');
      expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
      expect(f.templatesUsed).toContain('eff.trek5.cast.free.ifSpellMvAtMost');
      // the cap is the cast step's own `maxManaValue` (the mana value of the spell the cast makes, per face), never a comparison on the card in the library
      expect(JSON.stringify(f.abilities)).toContain('"op":"cast","who":{"ref":"you"},"what":{"ref":"bound","name":');
      expect(JSON.stringify(f.abilities)).toContain('"free":true,"optional":true,"maxManaValue":{"q":"count"');
      expect(JSON.stringify(f.abilities)).not.toContain('"stat":"manaValue"');
    }
    // "less than or equal to" (std-rx31's template) gives the same step; "less than" (std-rj's) is a strict comparison, another step
    const cap = (text: string): string | undefined => JSON.stringify((parse(`Reveal the top card of your library. You may cast that card without paying its mana cost if that spell's mana value is ${text}.`).abilities[0] as { effect?: { steps: unknown[] } }).effect?.steps[1]);
    expect(cap('less than or equal to the number of lands you control')).toBe(cap('equal to or less than the number of lands you control'));
    expect(cap('less than the number of lands you control')).not.toBe(cap('equal to or less than the number of lands you control'));
  });
  it('CR 608.2c: "For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards ..." (the chosen cards, the owner said)', () => {
    const f = parse('Each opponent exiles the top two cards of their library. For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards for as long as they remain exiled.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

describe('trek-5 renderer (render/steps-life.ts, render/stat.ts, render/mods.ts, render/cond.ts, render/np.ts)', () => {
  it('CR 119.5, 701.10: the life total set to twice itself is also "double"; of another player and of you, never for a different multiple or another player\'s life', () => {
    expect(fullyAutomated(parseOf('Double your life total.'))).toBe(true);
    expect(fullyAutomated(parseOf("Double target opponent's life total."))).toBe(true);
    // the plain wording is the same JSON (the setting of a life total to a calculated number), so "double" is only another way to say it
    const steps = (text: string): string => JSON.stringify((parseOf(text).abilities[0] as { effect: { steps: unknown } }).effect.steps);
    expect(steps('Your life total becomes twice your life total.')).toBe(steps('Double your life total.'));
  });
  it('CR 119.5, 608.2h (review of 2026-10-24): "double" is one player\'s life total; "each player\'s", "each opponent\'s", "each other player\'s" and a plural target stay manual (the step reads its value once)', () => {
    for (const text of [
      "Double each player's life total.", "Double each opponent's life total.", "Double each other player's life total.", "Double your opponents' life totals.", "Double up to two target players' life totals.",
      "Each opponent loses 1 life. Double each opponent's life total.", "Each opponent loses 1 life. Double their life total.",
    ]) {
      const f = parseOf(text);
      expect(fullyAutomated(f), text).toBe(false);
      expect(JSON.stringify(f.abilities), text).not.toContain('"op":"setLife"');
    }
    // one player, named as a target, stays automated (and the lead-in that names the target does not change that)
    expect(fullyAutomated(parseOf("Target opponent loses 1 life. Double that player's life total."))).toBe(true);
    expect(fullyAutomated(parseOf("Double target player's life total."))).toBe(true);
  });
  it('CR 701.21a: "<player> can\'t sacrifice <filter>" says the filter as a plural noun phrase', () => {
    expect(fullyAutomated(parseOf("Your opponents can't sacrifice creatures."))).toBe(true);
    expect(fullyAutomated(parseOf("You can't sacrifice Treasure tokens."))).toBe(true);
  });
  it('CR 613.4b: "<object>\'s base power and toughness become N/M" with and without a duration after it (a duration in front of it is std-msh\'s own wording, kept apart)', () => {
    expect(fullyAutomated(parseOf('{2}: ~\'s base power and toughness become 4/4.'))).toBe(true);
    expect(fullyAutomated(parseOf("{2}: Target creature's base power and toughness become 4/4 until end of turn."))).toBe(true);
    expect(fullyAutomated(parseOf("{2}: Until end of turn, target creature's base power and toughness become 4/4.")), 'not read: a leading duration has no template here').toBe(false);
  });
});

describe('trek-5 engine capabilities: registered by the code that honors them', () => {
  it('`feature:announce.qty.distinct.names.each` (actions/announce-cond.ts) is an engine capability', () => {
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.distinct.names.each')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-5 design 6.10 (local index): synthetic examples', () => {
  it('no trek-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
