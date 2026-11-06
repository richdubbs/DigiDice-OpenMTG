/**
 * Lane trek, round trek-15 (Star Trek: the opponents you attacked this turn, goad, quest counters): the template data of parser/templates/zz-cloud/trek-15.json and what
 * finishes the ten cards around it:
 *  - a calculated NUMBER OF TARGETS that reads "the number of opponents you attacked this turn" as the targets are chosen (CR 506.3, 508.1, 601.2c, 603.3d; model/forms.ts
 *    #countQuantityForms, actions/announce-cond.ts#announceQty, rules/history.ts#opponentsAttackedCount), with "where X is" said back (render/program.ts#targetCountWhereX);
 *  - the spell's own cost reduced "for each opponent you attacked this turn" (CR 601.2f; statics/costmods.ts, actions/cast.ts#modifiedPlan, render/stat.ts#perText);
 *  - "If X is 6 or more, ..." after a "-X/-X ..., where X is ..." (CR 107.3, 608.2h; render/mods.ts#powerToughness marks X, render/cond.ts compare);
 *  - "all other Klingon and Warrior creature cards" after a sacrifice in a "you may" (CR 109.2, 400.7; parser/lower/targets.ts) and "and" between creature types of a set of
 *    cards (render/np.ts, family subtype-card-set-and);
 *  - "That player loses 2 life instead ..." after "Target opponent loses 1 life." in a trigger whose event names no player (parser/lower/anaphora.ts, render/refs.ts);
 *  - "for each <count>, create a tapped and attacking <token>" (render/steps-zones.ts, family token-tapped-attacking-front-counted).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10). The behavior is in trek-15-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { opponentsAttackedCount } from '../../../src/rules/history';
import round from '../../../src/parser/templates/zz-cloud/trek-15.json';
import review from '../../m5/golden/cards/trek-15-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 4;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An ability of a creature card. */
const parse = (text: string, type = 'Creature — Klingon Warrior') => parseCard(card('Example Klingon', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-15.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-15.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek15.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek15\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, covered by the owner decision of 2026-10-24 for single-printing Star Trek wordings and the standing rule of 2026-10-27): each wording is printed on one card, so each template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('eff.trek15.goaded.selfAnd.dur')).toEqual(['Kang, Suspicious Captain']);
    expect(evidence('eff.trek15.you.surveil')).toEqual(['Tell Me What You See']);
    expect(evidence('eff.trek15.forEach.oppAttacked.token.tappedAttacking.front')).toEqual(['Rite of Ascension']);
    expect(evidence('eff.trek15.forEach.filter.token.tappedAttacking.front')).toEqual(['Worf, Still Not Merry']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
    expect(golden.map((g) => g.card).sort()).toEqual(['Galvanizing Tenor', 'Kang, Suspicious Captain', 'Martok, Hero of the Empire', 'Own the Day', 'Rite of Ascension', 'Tell Me What You See', 'The Destruction of Praxis', 'The Promise of Kahless', 'Vengeance Mission', 'Worf, Still Not Merry']);
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

describe('trek-15 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('the counter-examples that stay automated do not use the template (a wording near it is another reading or not understood)', () => {
    for (const t of MECH) for (const c of t.counterExamples) expect(parse(c).templatesUsed, `${t.id}: ${c}`).not.toContain(t.id);
  });
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/for each/, 'for every'], [/tapped and attacking/, 'tapped and blocking'], [/tapped and attacking/, 'attacking'], [/tapped and attacking/, 'tapped'], [/create a/, 'create two'],
    [/are goaded/, 'are not goaded'], [/are goaded/, 'are goaded and tapped'], [/for as long as you control ~/, 'for as long as ~ is tapped'], [/you surveil 3/, 'you surveil 3 cards'], [/you surveil/, 'target player surveils'],
    [/opponents you attacked this turn/, 'opponents you attacked'], [/attacking/, 'blocking'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

/** The level of a whole card (G2 on the card as printed: every word of every sentence matters). */
function levelOf(name: string, type: string, text: string, pt?: [string, string], cost = '{2}{R}'): { level: string; manualPart: boolean } {
  const def = compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: ['R'], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
  return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
}

const CARDS: { name: string; type: string; text: string; pt?: [string, string]; cost?: string }[] = [
  { name: 'Example Tenor', type: 'Creature — Klingon Performer', text: 'Menace\nWhenever this creature attacks, goad up to X target creatures, where X is the number of opponents you attacked this turn.', pt: ['2', '3'] },
  { name: 'Example Martok', type: 'Legendary Creature — Klingon Warrior', text: 'Whenever you attack, put a +1/+1 counter on each of up to X target creatures you control, where X is the number of opponents you attacked this turn.', pt: ['3', '3'] },
  { name: 'Example Day', type: 'Sorcery', text: 'This spell costs {1} less to cast for each opponent you attacked this turn.\nUntap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.', cost: '{2}{R}{R}' },
  { name: 'Example Rite', type: 'Enchantment', text: 'Whenever you attack, for each opponent you attacked this turn, create a tapped and attacking 2/1 red Klingon Warrior creature token with haste.' },
  { name: 'Example Worlds', type: 'Sorcery', text: 'All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.' },
  { name: 'Example Promise', type: 'Sorcery', text: 'You may sacrifice a Klingon or Warrior. If you do, return all other Klingon and Warrior creature cards from your graveyard to the battlefield.' },
  { name: 'Example Worf', type: 'Legendary Creature — Klingon Warrior Officer', text: 'Whenever Example Worf attacks, for each attacking non-Faerie creature, create a tapped and attacking 1/1 blue Faerie creature token with flying.', pt: ['4', '4'] },
  { name: 'Example Kang', type: 'Legendary Creature — Klingon Warrior Officer', text: 'When Example Kang enters, choose target creature an opponent controls. Example Kang and that creature are goaded for as long as you control Example Kang.\nWhenever one or more goaded creatures attack, put a +1/+1 counter on target creature you control.', pt: ['3', '3'] },
  { name: 'Example Mission', type: 'Enchantment', text: 'Whenever a creature dies, put a quest counter on this enchantment. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on this enchantment.' },
  { name: 'Example Vision', type: 'Enchantment', text: "When this enchantment enters, target opponent may have you draw a card. If they don't, they lose 4 life and you surveil 1.\nWhenever you face a dilemma, you may return this enchantment to its owner's hand." },
];

describe('trek-15 guard G2 on the whole card: a nonsense word in any place of the card\'s own text never leaves it full', () => {
  for (const c of CARDS) {
    it(`${c.name}: as printed it is full with no manual part; replacing any one word by an invented word never leaves it full`, () => {
      expect(levelOf(c.name, c.type, c.text, c.pt, c.cost), c.name).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word ("a quest counter"): an invented kind is a kind
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = levelOf(c.name, c.type, mutated, c.pt, c.cost);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
});

describe('CR 506.3, 508.1, 601.2c, 603.3d: "up to X target creatures, where X is the number of opponents you attacked this turn"', () => {
  it('goad and counters on up to X targets are automated, the count said back with "where X is"; the quantity is announced from the history (capability announce.qty.opponentsAttacked)', () => {
    for (const text of [
      'Whenever this creature attacks, goad up to X target creatures, where X is the number of opponents you attacked this turn.',
      'Whenever you attack, put a +1/+1 counter on each of up to X target creatures you control, where X is the number of opponents you attacked this turn.',
    ]) {
      const f = parse(text);
      expect(fullyAutomated(f), `${text}: ${JSON.stringify([f.diagnostics, f.gate])}`).toBe(true);
      expect(JSON.stringify(f.abilities[0])).toContain('"max":{"q":"opponentsAttacked","scope":"turn"}');
    }
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.opponentsAttacked')).toBe(true);
  });
  it('a count of the opponents of a single combat has no announcement (melee only): "this combat" as the number of targets stays manual (the negative case)', () => {
    const f = parse('Whenever this creature attacks, goad up to X target creatures, where X is the number of opponents you attacked with a creature this combat.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('other counts of players: "the number of opponents you have" is readable as a number of targets since edh-next-39 (capability announce.qty.countPlayers.bare, CR 102.3, 601.2c)', () => {
    expect(fullyAutomated(parse('Whenever this creature attacks, goad up to X target creatures, where X is the number of opponents you have.'))).toBe(true);
  });
  it('rules/history.ts#opponentsAttackedCount: the different opponents declared against this turn; a planeswalker or battle attacked, a player attacked on another turn and the controller themselves are not counted', () => {
    const entry = (turn: number, actor: string, defendingPlayer: string, defenderKind = 'player') => ({ ev: 'attacks', turn, actor, subject: 'o1', facts: { defenderKind, defendingPlayer } });
    const s = { turn: { number: 5 }, history: [entry(5, 'p1', 'p2'), entry(5, 'p1', 'p2'), entry(5, 'p1', 'p3', 'planeswalker'), entry(4, 'p1', 'p4'), entry(5, 'p2', 'p1'), entry(5, 'p1', 'p1')] } as never;
    expect(opponentsAttackedCount(s, 'p1', null)).toBe(1);
    const s2 = { turn: { number: 5 }, history: [{ ...entry(5, 'p1', 'p2'), combat: 1 }, { ...entry(5, 'p1', 'p3'), combat: 2 }] } as never;
    expect(opponentsAttackedCount(s2, 'p1', null)).toBe(2); // the whole turn
    expect(opponentsAttackedCount(s2, 'p1', 2)).toBe(1); // one combat
  });
});

describe('CR 601.2f, 118.7: "This spell costs {1} less to cast for each opponent you attacked this turn"', () => {
  it('is automated and said back; the quantity is a capability of cost changes (rq:cost.opponentsAttacked)', () => {
    const f = parse('This spell costs {1} less to cast for each opponent you attacked this turn.', 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
    expect(ENGINE_CAPABILITIES.has('rq:cost.opponentsAttacked')).toBe(true);
  });
  it('"more" and a combat\'s own count are not understood (the negative case)', () => {
    expect(fullyAutomated(parse('This spell costs {1} more to cast for each opponent you attacked with a creature this combat.', 'Sorcery'))).toBe(false);
  });
});

describe('CR 107.3, 608.2h: "If X is 6 or more, ..." after a "-X/-X ..., where X is ..."', () => {
  const pump = 'All creatures get -X/-X until end of turn, where X is the number of differently named lands you control.';
  it('the X the first sentence defined is X again: automated, and said back with "X is 6 or more"', () => {
    const f = parse(`${pump} If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.`, 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
  });
  it('without a "where X is" in the first sentence there is no X to compare: the same second sentence after a plain pump is not understood (the negative case)', () => {
    expect(fullyAutomated(parse('All creatures get -2/-2 until end of turn. If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.', 'Sorcery'))).toBe(false);
  });
  it('"6 or less" is another comparison and is not read as "6 or more"', () => {
    const more = parse(`${pump} If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.`, 'Sorcery');
    const less = parse(`${pump} If X is 6 or less, create two 2/1 red Klingon Warrior creature tokens with haste.`, 'Sorcery');
    expect(fullyAutomated(less) && jsonKey(less.abilities) === jsonKey(more.abilities)).toBe(false);
  });
});

describe('CR 109.2, 701.21a, 400.7: "all other Klingon and Warrior creature cards" after a sacrifice in a "you may"', () => {
  const lead = 'You may sacrifice a Klingon or Warrior. If you do, return all other';
  it('"other" is other than the permanent sacrificed: the filter leaves out the binding of the sacrifice', () => {
    const f = parse(`${lead} Klingon and Warrior creature cards from your graveyard to the battlefield.`, 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toMatch(/"not":\{"is":\{"ref":"bound","name":"[^"]+"\}\}/);
  });
  it('the reading is the sacrifice of a "you may" of the same player, and nothing else: a sacrifice by another player, or no sacrifice, leaves "other" unread (the negative cases)', () => {
    expect(fullyAutomated(parse('Draw a card. Return all other Klingon and Warrior creature cards from your graveyard to the battlefield.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(parse('Target opponent may sacrifice a Klingon or Warrior. If they do, return all other Klingon and Warrior creature cards from your graveyard to the battlefield.', 'Sorcery'))).toBe(false);
  });
  it('a set of cards of two creature types is "Klingon and Warrior creature cards" and "Klingon or Warrior creature cards" (family subtype-card-set-and); a target is only "or"', () => {
    for (const w of ['and', 'or']) {
      const f = parse(`Return all Klingon ${w} Warrior creature cards from your graveyard to the battlefield.`, 'Sorcery');
      expect(fullyAutomated(f), `${w}: ${JSON.stringify([f.diagnostics, f.gate])}`).toBe(true);
    }
    expect(fullyAutomated(parse('Return target Klingon and Warrior creature card from your graveyard to the battlefield.', 'Sorcery'))).toBe(false);
  });
});

describe('CR 608.2c: "That player loses 2 life instead ..." after "Target opponent loses 1 life." in a trigger whose event names no player', () => {
  const rest = 'put a quest counter on ~. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on ~.';
  it('"Whenever a creature dies": "that player" is the target opponent (the creature has no controller or owner in the text)', () => {
    const f = parse(`Whenever a creature dies, ${rest}`, 'Enchantment');
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
    expect(JSON.stringify(f.abilities[0])).not.toContain('"role":"player"');
  });
  it('a trigger that names the controller of the creature ("a creature you control", "an opponent controls") has another candidate again: not understood (the negative case)', () => {
    for (const trig of ['Whenever a creature an opponent controls dies', 'Whenever a creature you control dies']) {
      const f = parse(`${trig}, ${rest}`, 'Enchantment');
      expect(fullyAutomated(f) && !JSON.stringify(f.abilities[0]).includes('"ref":"target"'), trig).toBe(false);
    }
  });
});

describe('CR 508.4, 111.1: the tokens of a counted number are said tapped and attacking before the token words', () => {
  it('the same creation is also said with the flags after the token words and the count last (family token-tapped-attacking-front-counted)', () => {
    for (const text of [
      "Whenever you attack, for each opponent you attacked this turn, create a 2/1 red Klingon Warrior creature token with haste that's tapped and attacking.",
      "Whenever you attack, create a 2/1 red Klingon Warrior creature token with haste that's tapped and attacking for each opponent you attacked this turn.",
    ]) {
      const f = parse(text, 'Enchantment');
      const fr = parse('Whenever you attack, for each opponent you attacked this turn, create a tapped and attacking 2/1 red Klingon Warrior creature token with haste.', 'Enchantment');
      expect(fullyAutomated(f), `${text}: ${JSON.stringify([f.diagnostics, f.gate])}`).toBe(true);
      expect(jsonKey(f.abilities), text).toBe(jsonKey(fr.abilities));
    }
  });
});

describe('trek-15 engine capabilities', () => {
  it('the quantity of the attacks is an engine capability, as the cost change and the number of targets read it', () => {
    for (const c of ['q:opponentsAttacked', 'feature:announce.qty.opponentsAttacked', 'rq:cost.opponentsAttacked', 'op:createToken', 'op:sacrificeChoice']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-15 design 6.10 (local index): synthetic examples', () => {
  it('no trek-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
