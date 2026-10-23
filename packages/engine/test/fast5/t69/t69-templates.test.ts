/**
 * FAST5 T69 (one-shot "becomes" effects, base power setting and X-quantified pumps): the template data of parser/templates/zz-fast5/t69.json and the engine
 * and renderer additions its shapes needed (render/mods.ts, render/stat.ts, render/evt.ts, render/steps-lasting.ts, render/refs.ts; `Modification` layer 4
 * `named`, statics/mods.ts; a calculated number of targets read at announcement, actions/announce-targets.ts; lower/conditions.ts#absorbFollowers). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there too (the try step
 * of CONTRIBUTING "Adding a template"). Templates with a card's own name in them ("named Legitimate Businessperson", "named Mileva, the Stalwart") keep that
 * name: the name IS the shape.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t69 from '../../../src/parser/templates/zz-fast5/t69.json';
import review from '../../m5/golden/cards/fast5-t69-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T69 = t69 as Template[];
const OPTS = defaultParseOptions();

/** Design 6.9 evidence for a stable template: every card of the corpus that prints the sentence, each with a hand-verified golden card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t69.basepower.gains': { cards: ['Turtle-Duck'], line: /^(?:\{[^}]+\}(?:, )?)+: Until end of turn, this creature has base power \d+ and gains [a-z ]+\./m },
  'eff.t69.may.basept.become': { cards: ['Mirkwood Meditator'], line: /you may have this creature's base power and toughness become \d+\/\d+ until end of turn\./ },
  'eff.t69.pump.pair.whereX': { cards: ['Gloom Ripper'], line: /gets \+X\/\+0 until end of turn and up to one target creature an opponent controls gets -0\/-X until end of turn, where X is/ },
  'sta.t69.enchanted.loseall.becomes.named': { cards: ['Witness Protection'], line: /Enchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1\/1 named Legitimate Businessperson\./ },
  'eff.t69.becomes.legendary.named.mileva': { cards: ['Tenth District Hero'], line: /it becomes a legendary creature named Mileva, the Stalwart, it has base power and toughness 5\/5, and it gains/ },
  'eff.t69.itis.subtype.artifact.with.losesothers': { cards: ['Vraska, the Silencer'], line: /It's a Treasure artifact with "\{T\}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types\./ },
  'eff.t69.self.gains.quoted.permanent': { cards: ['Summon: Primal Odin'], line: /gains "Whenever this creature deals combat damage to a player, that player loses the game\."/ },
  'eff.t69.damage.double.toPlayerOrPermanents.dur': { cards: ['Lightning, Army of One'], line: /until your next turn, if a source would deal damage to that player or a permanent that player controls, it deals double that damage instead\./ },
};

/** A synthetic card in which a T69 example is an ability of the right kind. */
function exampleCard(text: string): OracleCard {
  if (/^Enchant/m.test(text)) return card('Example Charm', 'Enchantment — Aura', text);
  if (/^(When|Whenever|At)\b/.test(text) || /^\{[^}]+\}: /.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Instant', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('T69 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t69.json, after zz-fast5/t54.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t69.json');
    expect(files.indexOf('zz-fast5/t69.json')).toBeGreaterThan(files.indexOf('zz-fast5/t54.json'));
    expect(files.indexOf('zz-fast5/t69.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T69.length).toBe(8);
    for (const t of T69) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.t69\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T69 template has its evidence: its golden cards are every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T69.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      expect(whole, t.id).toBeDefined();
      expect(cards.slice().sort(), t.id).toEqual([...whole!.cards].sort());
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T69) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'named']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T69 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T69) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const at = lines.length - 1;
  const body = lines[at]!.replace(/\.$/, '');
  const put = (b: string): string => [...lines.slice(0, at), `${b.replace(/\s+/g, ' ').trim()}.`].join('\n');
  const out = [put(`${body} unless it is blue`), put(`${body} instead`), put(`${body} at random`), put(`${body} twice`), put(`${body} if able`)];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\buntil your next turn\b/, 'this turn'], [/\band gains\b/, 'and loses'], [/\bbase power\b/, 'base toughness'],
    [/\bdouble\b/, 'triple'], [/\bwhere X\b/, 'where Y'], [/\bloses all other card types\b/, 'keeps all other card types'], [/\bnamed\b/, 'called'],
    [/\bgains\b/, 'loses'], [/\bit becomes\b/, 'it becomes target'], [/\bwould\b/, 'would not'], [/\bup to one\b/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(put(body.replace(re, by)));
  return out;
}

describe('T69 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T69) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T69 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T69) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = lines.length - 1;
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || /^~'s$/.test(w)) return;
          const mutatedLine = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const mutated = [...lines.slice(0, at), mutatedLine].join('\n');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T69 lowering: what the shapes mean', () => {
  const effect = (text: string): unknown[] => {
    const f = parsedWith(text);
    return (f.abilities as { effect?: { steps?: unknown[] } }[]).flatMap((a) => a.effect?.steps ?? []);
  };
  it('"base power N" sets the power alone: one layer 7b change with no toughness (CR 613.4b)', () => {
    const [step] = effect('Until end of turn, ~ has base power 5 and gains haste.') as { effects: { mods: Record<string, unknown>[] }[] }[];
    const mods = step!.effects[0]!.mods;
    expect(mods[0]).toEqual({ layer: '7b', power: 5 });
    expect(mods[0]).not.toHaveProperty('toughness');
  });
  it('the pair of pumps shares the one X of its "where" clause: both changes read the same quantity (CR 107.3c)', () => {
    const [step] = effect('Target creature you control gets +X/+0 until end of turn and up to one target creature an opponent controls gets -0/-X until end of turn, where X is the number of Goblins you control.') as { effects: { mods: { power: unknown; toughness: unknown }[] }[] }[];
    const goblins = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Goblin'], controller: 'you' } } };
    expect(step!.effects[0]!.mods[0]!.power).toEqual(goblins);
    expect(JSON.stringify(step!.effects[1]!.mods[0]!.toughness)).toContain(JSON.stringify(goblins));
  });
  it('a name is set in layer 4 beside the type change (CR 201.2, 613.1d)', () => {
    const f = parsedWith('Enchant creature\nEnchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.');
    const text = JSON.stringify(f.abilities);
    expect(text).toContain('"named":"Legitimate Businessperson"');
    expect(text).toContain('"set":["G","W"]');
  });
  it('the lasting replacement reads "that player" as the player who was dealt the damage, locked as the effect resolves, and the object part is their permanents', () => {
    const f = parsedWith('Whenever ~ deals combat damage to a player, until your next turn, if a source would deal damage to that player or a permanent that player controls, it deals double that damage instead.');
    const [step] = (f.abilities as { effect?: { steps?: unknown[] } }[]).flatMap((a) => a.effect?.steps ?? []) as { duration: unknown; effects: { replaces: { recipient: { player: unknown; object: { controller: unknown } } }; body: unknown }[] }[];
    expect(step!.duration).toEqual({ d: 'untilNextTurn', whose: { ref: 'you' } });
    const r = step!.effects[0]!.replaces.recipient;
    expect(r.player).toEqual({ ref: 'event', role: 'recipient' });
    expect(r.object.controller).toEqual({ ref: 'event', role: 'recipient' });
    expect(step!.effects[0]!.body).toEqual({ b: 'modify', amount: { mul: 2 } });
  });
});

describe('T69 lowering (parser/lower/conditions.ts#absorbFollowers): the sentence after "If you do," that acts on the card only those instructions returned goes with them (CR 118.12, 608.2c)', () => {
  const steps = (text: string): { op: string; then?: { op: string }[] }[] => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', text), OPTS).faces[0]!;
    return (f.abilities as { effect?: { steps?: unknown[] } }[]).flatMap((a) => a.effect?.steps ?? []) as { op: string; then?: { op: string }[] }[];
  };
  it("it is the last step of the payment's then: no payment, no such card, nothing to change", () => {
    const [pay, ...rest] = steps("Whenever a creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It's a Gold artifact with \"Sacrifice this artifact: Add one mana of any color,\" and it loses all other card types.");
    expect(rest).toEqual([]);
    expect(pay!.op).toBe('pay');
    expect(pay!.then!.map((x) => x.op)).toEqual(['move', 'effect']);
  });
  it('a following sentence that names nothing the folded instructions bound stays a step of its own', () => {
    const [pay, gain, ...rest] = steps('Whenever ~ attacks, you may pay {1}. If you do, draw a card. You gain 1 life.');
    expect(rest).toEqual([]);
    expect(pay!.op).toBe('pay');
    expect(pay!.then!.map((x) => x.op)).toEqual(['draw']);
    expect(gain!.op).toBe('gainLife');
  });
});

const index = localIndex();

describe.skipIf(index === null)('T69 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T69 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T69.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => l.trim() !== 'Enchant creature' && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
    it(`${id}: ${w.cards.join(', ')} read the line with it, pass the render gate and leave no manual ability`, () => {
      for (const name of w.cards) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        expect(f.gate.every((g) => g.ok), name).toBe(true);
        const def = compileCard(c!);
        expect(def.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
