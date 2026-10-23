/**
 * std-control-1 (lane std-control): the template data of parser/templates/zz-cloud/std-control-1.json and the round's other parser, lowering and renderer changes:
 *  - Cond (parser/holes/cond.ts#speedGreatest): "that opponent's speed is greater than each other player's speed" (`countPlayers` with `speedVs`, CR 702.179f);
 *  - lower/ability.ts#joinSpeedFloor: the sentence pairs "reduce <player>'s speed by 1. This effect can't reduce their speed below 1.", "Take an extra turn after this
 *    one. During that turn, <keyword> abilities can't be activated." and the five Dragons of Call the Spirit Dragons are one instruction each;
 *  - Event (parser/holes/event.ts): "~ is cast from exile" (the card moving from exile to the stack, CR 601.2a); lower/ability.ts#selfIsExiledCard: "this card" of an
 *    ability whose cost exiled it from the hand is the card in exile (`costExiled` self, CR 400.7);
 *  - parser/parse.ts#linkChosenObject, #linkChosenOpponent: "the chosen creature" / "the chosen player" of another ability of the face (CR 607.2d);
 *  - renderer: the controller of "target creature an opponent controls" is also "that opponent" (render/refs.ts), a reading that closes its sentence with its own period
 *    is followed by the next sentence after a space (render/steps.ts#QUOTE_END), one object chosen out of a description is "the chosen <noun>" (render/steps-flow.ts),
 *    "other than ~ and the chosen creature" (render/np.ts), "~ is cast from exile" (render/evt.ts), the five-color fold (render/fold-stdcontrol1.ts).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-control-1-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdControl1 from '../../../src/parser/templates/zz-cloud/std-control-1.json';
import review from '../../m5/golden/cards/std-control-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C1 = stdControl1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, a keyword line, "this permanent", a cost), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At |^Flying|^Power-up|this permanent|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces.map((f) => f.abilities));

const IDS = [
  'eff.stdcontrol1.speed.reduce.floor', 'eff.stdcontrol1.extraTurn.thatTurn.cantActivate', 'eff.stdcontrol1.forEachColor.counter.winIfFive',
  'eff.stdcontrol1.choose.permanent.opponentControls', 'eff.stdcontrol1.pump.othersThanSelfAndChosen.eot', 'trg.stdcontrol1.chosenObject.leaves',
  'sta.stdcontrol1.asTransforms.chooseOpponent', 'trg.stdcontrol1.chosenPlayer.losesGame',
];

describe('std-control-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-control-1.json, after zz-cloud/std-blb.json, before zz-cloud/std-dft.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-control-1.json');
    expect(files.indexOf('zz-cloud/std-control-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-control-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(C1.map((t) => t.id)).toEqual(IDS);
    for (const t of C1) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdcontrol1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one Standard card prints each), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the
    // round record (guide section 5, "Narrow wordings")
    expect(goldenUsing('eff.stdcontrol1.speed.reduce.floor')).toEqual(['Spikeshell Harrier']);
    expect(goldenUsing('eff.stdcontrol1.extraTurn.thatTurn.cantActivate')).toEqual(['Kang the Conqueror']);
    expect(goldenUsing('eff.stdcontrol1.forEachColor.counter.winIfFive')).toEqual(['Call the Spirit Dragons']);
    for (const id of IDS.slice(3)) expect(goldenUsing(id), id).toEqual(['Zenos yae Galvus // Shinryu, Transcendent Rival']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'choose', 'extra']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-control-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bis greater than each other player's speed\b/, "is less than each other player's speed"], [/\bspeed below 1\b/, 'speed below 2'], [/\breduce (\S+ \S+)'s speed by 1\b/, "reduce $1's speed by 2"],
    [/\bpower-up abilities\b/, 'loyalty abilities'], [/\bDuring that turn\b/, 'During your next turn'], [/\bafter this one\b/, 'after that one'],
    [/\bfive Dragons\b/, 'four Dragons'], [/\bof that color\b/, 'of that type'], [/\bfor each color\b/, 'for each opponent'],
    [/\ban opponent controls\b/, 'a player controls'], [/\bother than this creature and\b/, 'other than this creature or'], [/\bUntil end of turn\b/, 'Until your next turn'],
    [/\bleaves the battlefield\b/, 'dies'], [/\bthe chosen creature leaves\b/, 'a chosen creature leaves'],
    [/\bchoose an opponent\b/, 'choose a player'], [/\btransforms into\b/, 'enters as'], [/\bloses the game\b/, 'wins the game'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-control-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C1) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-control-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of C1) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is another ability of the card)
        const [cost, rest] = /^((?:Power-up — )?\{[^:]*: )(.*)$/.exec(lines[last]!)?.slice(1) ?? ['', lines[last]!];
        const words = rest!.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), `${cost}${[...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')}`].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-control-1 Cond (parser/holes/cond.ts#speedGreatest; CR 702.179f)', () => {
  it('"that opponent\'s speed is greater than each other player\'s speed": one player (that opponent) with speed at least theirs', () => {
    const text = "When this creature enters, tap target creature an opponent controls. If that opponent's speed is greater than each other player's speed, reduce that opponent's speed by 1. This effect can't reduce their speed below 1.";
    expect(json('Creature — Turtle', text)).toContain('{"q":"countPlayers","of":{"ref":"each","who":"player"},"speedVs":{"op":">=","than":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}}},"op":"==","right":1');
  });
  it('fails closed on another subject or another comparison ("your speed", "each opponent\'s speed")', () => {
    expect(level('Creature — Turtle', "When this creature enters, if your speed is greater than each other player's speed, draw a card.")).not.toBe('full');
    expect(level('Creature — Turtle', "When this creature enters, tap target creature an opponent controls. If that opponent's speed is greater than each opponent's speed, draw a card.")).not.toBe('full');
  });
});

describe('std-control-1 lowering (lower/ability.ts)', () => {
  it('#joinSpeedFloor: only the exact rider joins; without it the reduction is not read (a speed never goes down without its floor)', () => {
    expect(level('Creature — Turtle', "Whenever this creature deals combat damage to a player, reduce that player's speed by 1. This effect can't reduce their speed below 1.")).toBe('full');
    expect(level('Creature — Turtle', "Whenever this creature deals combat damage to a player, reduce that player's speed by 1. This effect can't reduce their speed below 2.")).not.toBe('full');
  });
  it('#joinSpeedFloor: "During that turn" joins only "Take an extra turn after this one." (that turn is the extra turn)', () => {
    expect(level('Creature — Human', "{5}: Draw a card. Take an extra turn after this one. During that turn, power-up abilities can't be activated.")).toBe('full');
    expect(level('Creature — Human', "{5}: Draw a card. During that turn, power-up abilities can't be activated.")).not.toBe('full');
  });
  it('#selfIsExiledCard (CR 400.7): "this card" after a cost that exiled it from the hand is the card in exile; the quoted ability of another object keeps its own "this"', () => {
    const j = json('Creature — Eldrazi', '{2}, Exile this card from your hand: Target land gains "{T}: Add {C}{C}{C}" until this card is cast from exile. You may cast this card for as long as it remains exiled.');
    expect(j).toContain('{"ev":"zoneChange","subject":{"is":{"ref":"costExiled","self":true}},"from":"exile","to":"stack"}');
    expect(j).toContain('"of":{"is":{"ref":"costExiled","self":true}}');
    expect(j).not.toContain('{"ref":"self"}');
    const k = json('Creature — Eldrazi', '{2}, Exile this card from your hand: Target creature gains "{T}: Sacrifice this creature: Draw a card." until end of turn. You may cast this card for as long as it remains exiled.');
    if (k.includes('Sacrifice')) expect(k).not.toMatch(/"sacrifice"[^}]*costExiled/);
  });
});

describe('std-control-1 links of the face (parser/parse.ts#linkChosenObject, #linkChosenOpponent; CR 607.2d)', () => {
  it('the one choice of one object in another ability gets the link; with no such choice the reader is manual', () => {
    const j = json('Creature — Human', 'When this creature enters, choose a creature an opponent controls. Tap that creature.\nWhen the chosen creature leaves the battlefield, draw a card.');
    expect(j).toContain('"as":"chosen","link":"chosen"');
    expect(level('Creature — Human', 'When this creature enters, tap target creature an opponent controls.\nWhen the chosen creature leaves the battlefield, draw a card.')).not.toBe('full');
    expect(level('Creature — Human', 'When this creature enters, choose a creature an opponent controls. Tap that creature.\nWhenever this creature attacks, choose a creature you control. Tap that creature.\nWhen the chosen creature leaves the battlefield, draw a card.')).not.toBe('full');
  });
  it('"the chosen player" needs exactly one "choose an opponent" as ~ enters or transforms', () => {
    expect(level('Creature — Human', 'As this permanent enters, choose an opponent.\nWhen the chosen player loses the game, draw a card.')).toBe('full');
    expect(level('Creature — Human', 'When the chosen player loses the game, draw a card.')).not.toBe('full');
  });
});

describe('std-control-1 renderer support (G6: the render gate is exact)', () => {
  it('render/refs.ts: the controller of "target creature an opponent controls" is "that opponent" later (it is an opponent, CR 102.3)', () => {
    expect(level('Creature — Turtle', "When this creature enters, return target creature an opponent controls to its owner's hand. That opponent loses 2 life.")).toBe('full');
    expect(level('Creature — Turtle', "When this creature enters, return target creature to its owner's hand. That opponent loses 2 life.")).not.toBe('full');
  });
  it('render/steps.ts: a sentence that ends with its own period after a quoted grant is followed by the next one after a space', () => {
    expect(level('Creature — Eldrazi', '{2}, Exile this card from your hand: Target land gains "{T}: Add {C}{C}" until end of turn. You may cast this card for as long as it remains exiled.')).toBe('full');
  });
  it('render/steps-flow.ts, render/np.ts: one object chosen out of a description is "the chosen creature"; "other than ~ and the chosen creature"', () => {
    expect(level('Creature — Human', 'When this creature enters, choose a creature an opponent controls. Until end of turn, creatures other than this creature and the chosen creature get -1/-1.')).toBe('full');
    expect(level('Creature — Human', 'When this creature enters, choose two creatures an opponent controls. Until end of turn, creatures other than this creature and the chosen creature get -1/-1.')).not.toBe('full');
  });
  it('render/fold-stdcontrol1.ts: the five-color fold reads only the Dragons of its own shape', () => {
    expect(level('Enchantment', 'At the beginning of your end step, for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game.')).toBe('full');
    expect(level('Enchantment', 'At the beginning of your end step, for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, draw a card.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-control-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-control-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|permanent)\b/gi, '~').trim());
        }
      }
    }
    const context = /^(Haste|Flying)$/;
    const verbatim = C1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
