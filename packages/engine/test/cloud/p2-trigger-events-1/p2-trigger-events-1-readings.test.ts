/**
 * p2-trigger-events-1 (Phase 2 lane p2-trigger-events): the readings this round added to the Event hole (parser/holes/event.ts), read by the stable trigger
 * template trg.when, and their renderer and engine support. No template file: every reading is a hole reading (docs/CARD_AUTOMATION.md section 1, "Fix families").
 *
 *   parser/holes/event.ts              "<player> mills a <card>", "mills one or more <cards>", "<cards> are milled" (CR 701.17a); "<permanent> enters tapped"
 *                                      (CR 603.6a, 110.5b); "<permanent> is put into a graveyard" (CR 110.1); "is exiled / put into exile from the battlefield"
 *                                      (CR 406.3); "<player> plays another land / a <land>" (CR 305.1); "<object> enters from your graveyard" (CR 400.3)
 *   triggers/normalize.ts, forms.ts    a milled card is its owner's action `mill` (feature:ev.action.mill); a card a replacement sends elsewhere is not milled
 *   render/evt.ts                      enters tapped of any subject; enters from your graveyard; the cards milled; families permanent-put-into-graveyard,
 *                                      exiled-from-the-battlefield, self-or-another-dies
 *
 * Guards (design 6.8): each reading's examples parse with trg.when to the JSON given, are fully automated and pass the render gate (G6, G9); counter-examples
 * do not give that JSON; near misses fail or differ; a nonsense word never leaves an automated card (G2). Examples are synthetic (design 6.10), checked against
 * the local index when it is present. The behavior is in p2-trigger-events-1-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import review from '../../m5/golden/cards/p2-trigger-events-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parsed = (text: string, type = 'Creature — Elf') => parseCard(card('Example Brute', type, text, { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
const on = (text: string, type?: string): unknown => (bare(parsed(text, type).abilities)[0] as { trigger?: { on: unknown } }).trigger?.on;

interface Reading { id: string; cr: string; examples: { text: string; on: unknown; batch?: true }[]; counter: string[] }

const READINGS: readonly Reading[] = [
  {
    id: 'mills a card', cr: 'CR 701.17a',
    examples: [
      { text: 'Whenever a player mills a creature card, draw a card.', on: [{ ev: 'action', verb: 'mill', actor: 'any', object: { types: ['Creature'], isCard: true } }] },
      { text: 'Whenever an opponent mills a nonland card, you gain 2 life.', on: [{ ev: 'action', verb: 'mill', actor: 'opponent', object: { notTypes: ['Land'], isCard: true } }] },
    ],
    counter: ['Whenever a player mills a creature, draw a card.', 'Whenever a player mills two creature cards, draw a card.', 'Whenever a player discards a creature card, draw a card.'],
  },
  {
    id: 'mills one or more cards', cr: 'CR 701.17a, 603.2c',
    examples: [
      { text: 'Whenever an opponent mills one or more land cards, you gain 2 life.', on: [{ ev: 'action', verb: 'mill', actor: 'opponent', object: { types: ['Land'], isCard: true } }], batch: true },
      { text: 'Whenever a player mills one or more artifact cards, draw a card.', on: [{ ev: 'action', verb: 'mill', actor: 'any', object: { types: ['Artifact'], isCard: true } }], batch: true },
    ],
    counter: ['Whenever a player mills one or more artifacts, draw a card.', 'Whenever a player mills a artifact card or more, draw a card.'],
  },
  {
    id: 'cards are milled', cr: 'CR 701.17a, 603.2c',
    examples: [
      { text: 'Whenever one or more artifact cards are milled, draw a card.', on: [{ ev: 'action', verb: 'mill', object: { types: ['Artifact'], isCard: true } }], batch: true },
      { text: 'Whenever a creature card is milled, you gain 1 life.', on: [{ ev: 'action', verb: 'mill', object: { types: ['Creature'], isCard: true } }] },
    ],
    counter: ['Whenever a creature is milled, draw a card.', 'Whenever one or more artifact cards are discarded, draw a card.'],
  },
  {
    id: 'enters tapped', cr: 'CR 603.6a, 110.5b',
    examples: [
      { text: 'Whenever a land you control enters tapped, you gain 1 life.', on: [{ ev: 'zoneChange', subject: { types: ['Land'], controller: 'you', tapped: true }, to: 'battlefield' }] },
      { text: 'Whenever an artifact an opponent controls enters tapped, draw a card.', on: [{ ev: 'zoneChange', subject: { types: ['Artifact'], controller: 'opponent', tapped: true }, to: 'battlefield' }] },
    ],
    counter: ['Whenever a tapped land you control enters, you gain 1 life.', 'Whenever a land you control becomes tapped, you gain 1 life.'],
  },
  {
    id: 'is put into a graveyard (a permanent)', cr: 'CR 110.1, 603.6c',
    examples: [
      { text: 'Whenever an artifact you control is put into a graveyard, draw a card.', on: [{ ev: 'zoneChange', subject: { types: ['Artifact'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }] },
      { text: 'Whenever a permanent an opponent controls is put into a graveyard, you gain 1 life.', on: [{ ev: 'zoneChange', subject: { controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }] },
    ],
    counter: ['When ~ is put into a graveyard, draw a card.', 'Whenever a creature card is put into a graveyard, draw a card.', 'Whenever one or more creatures you control are put into a graveyard, draw a card.'],
  },
  {
    id: 'exiled from the battlefield', cr: 'CR 406.3, 603.6c',
    examples: [
      { text: 'Whenever a creature you control is exiled from the battlefield, draw a card.', on: [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'exile' }] },
      { text: 'Whenever an enchantment is put into exile from the battlefield, you gain 3 life.', on: [{ ev: 'zoneChange', subject: { types: ['Enchantment'] }, from: 'battlefield', to: 'exile' }] },
    ],
    counter: ['Whenever a creature you control is exiled from a graveyard, draw a card.', 'Whenever a creature you control is exiled from your hand, draw a card.'],
  },
  {
    id: 'plays another land / a land of a type', cr: 'CR 305.1, 109.1',
    examples: [
      { text: 'Whenever you play another land, you gain 1 life.', on: [{ ev: 'action', verb: 'playLand', actor: 'you', object: { types: ['Land'], other: true } }] },
      { text: 'Whenever an opponent plays a Forest, draw a card.', on: [{ ev: 'action', verb: 'playLand', actor: 'opponent', object: { subtypes: ['Forest'] } }] },
    ],
    counter: ['Whenever you play a creature, draw a card.', 'Whenever you play another spell, draw a card.', 'Whenever you play a land card from your graveyard, draw a card.'],
  },
  {
    id: 'enters from your graveyard', cr: 'CR 400.3, 603.6a',
    examples: [
      { text: 'Whenever a creature enters from your graveyard, draw a card.', on: [{ ev: 'zoneChange', subject: { types: ['Creature'], owner: 'you' }, from: 'graveyard', to: 'battlefield' }] },
      { text: 'When ~ enters from your graveyard, draw two cards.', on: [{ ev: 'zoneChange', subject: { self: true, owner: 'you' }, from: 'graveyard', to: 'battlefield' }] },
    ],
    counter: ["Whenever a creature enters from an opponent's graveyard, draw a card.", 'Whenever a creature enters from your library, draw a card.', 'Whenever one or more creatures enter from your graveyard, draw a card.'],
  },
  {
    id: '~ or another <type> dies (render)', cr: 'CR 700.4, 603.6c',
    examples: [
      {
        text: 'Whenever ~ or another nontoken Elf you control dies, draw a card.',
        on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, { ev: 'zoneChange', subject: { token: false, subtypes: ['Elf'], controller: 'you', other: true }, from: 'battlefield', to: 'graveyard' }],
      },
      {
        text: 'Whenever ~ or another nontoken Elf dies, you gain 1 life.',
        on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, { ev: 'zoneChange', subject: { token: false, subtypes: ['Elf'], other: true }, from: 'battlefield', to: 'graveyard' }],
      },
    ],
    counter: ['Whenever ~ or another nontoken Elf you control enters, draw a card.', 'Whenever ~ and another nontoken Elf you control die, draw a card.'],
  },
];

describe('p2-trigger-events-1 guard G9 (design 6.8): each reading\'s examples and counter-examples', () => {
  for (const r of READINGS) {
    it(`${r.id} (${r.cr}): every example parses with trg.when to its trigger, is fully automated and passes the render gate; no counter-example gives that trigger`, () => {
      for (const e of r.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain('trg.when');
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        const trig = (bare(f.abilities)[0] as { trigger: { on: unknown; batch?: true } }).trigger;
        expect(trig.on, e.text).toEqual(e.on);
        expect(trig.batch, e.text).toBe(e.batch);
      }
      const ons = new Set(r.examples.map((e) => jsonKey(e.on as never)));
      for (const c of r.counter) {
        const f = parsed(c);
        expect(fullyAutomated(f) && ons.has(jsonKey(on(c) as never)), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to a different trigger. */
function nearMisses(text: string): string[] {
  const out = [text.replace(/\.$/, ' at random.'), text.replace(/\.$/, ' twice.')];
  const swaps: [RegExp, string][] = [
    [/\bmills\b/, 'discards'], [/\bmilled\b/, 'discarded'], [/\benters tapped\b/, 'enters untapped'], [/\bfrom the battlefield\b/, 'from a graveyard'],
    [/\bis put into a graveyard\b/, 'is put into a hand'], [/\banother land\b/, 'a land'], [/\bplays a Forest\b/, 'plays a Mountain'], [/\byour graveyard\b/, 'your library'],
    [/\bnontoken\b/, 'token'], [/\bopponent\b/, 'player'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-trigger-events-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const r of READINGS) {
    it(`${r.id}: an appended rider or a swapped key word never gives the example's trigger`, () => {
      for (const e of r.examples) {
        for (const m of nearMisses(e.text)) {
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(on(m) as never) === jsonKey(e.on as never), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-trigger-events-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const r of READINGS) {
    it(`${r.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of r.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,') return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-trigger-events-1 engine support', () => {
  it('CR 701.17a: the action `mill` is a capability (triggers/normalize.ts emits it for each card milled)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.mill')).toBe(true);
  });
  it('CR 110.1: "is put into a graveyard" without "from" is read of a permanent\'s description only, never of the object itself or a card', () => {
    expect(on('Whenever enchanted artifact is put into a graveyard, draw a card.', 'Enchantment — Aura')).toEqual([{ ev: 'zoneChange', subject: { types: ['Artifact'], attachedToSource: true }, from: 'battlefield', to: 'graveyard' }]);
    expect(fullyAutomated(parsed('When ~ is put into a graveyard, draw a card.'))).toBe(false);
    expect(fullyAutomated(parsed('Whenever a card is put into a graveyard, draw a card.'))).toBe(false);
  });
  it('CR 305.1: a bare "a land" keeps its earlier reading (no object); "another" is a land other than the object itself', () => {
    expect(on('Whenever you play a land, draw a card.')).toEqual([{ ev: 'action', verb: 'playLand', actor: 'you' }]);
    expect(on('When you play another land, sacrifice ~.', 'Land')).toEqual([{ ev: 'action', verb: 'playLand', actor: 'you', object: { types: ['Land'], other: true } }]);
  });
});

describe('p2-trigger-events-1 golden cards (docs/CARD_AUTOMATION.md section 6)', () => {
  it('every card of the review is pinned full and names trg.when and the rules it was checked against', () => {
    expect(review.length).toBe(15);
    for (const g of review as { card: string; expect: string; verified: string }[]) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/\(trg\.when, /);
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-trigger-events-1 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name, x.oracle_text])] as [string, string | undefined][]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = READINGS.flatMap((r) => [...r.examples.map((e) => e.text), ...r.counter].filter((x) => lines.has(x)));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the golden cards read their lines, pass the render gate and are fully automated', () => {
    for (const g of review as { card: string }[]) {
      const c = (index ?? []).find((x) => x.name === g.card);
      expect(c, g.card).toBeDefined();
      for (const f of parseCard(c!, OPTS).faces) {
        expect(fullyAutomated(f), `${g.card}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((x) => x.ok), g.card).toBe(true);
      }
    }
  }, 60_000);
});
