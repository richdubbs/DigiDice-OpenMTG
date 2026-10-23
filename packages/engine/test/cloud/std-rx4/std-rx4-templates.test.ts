/**
 * std-rx4 (card wave 2, slice s23): the round's parser and renderer support and its two promotions. No template file of its own:
 *  - Cond: "they lost life this turn" / "that player lost life this turn", a player anaphor's life lost this turn (parser/holes/cond.ts#anaphorLostLife,
 *    render/cond.ts);
 *  - mentions: the hand an earlier instruction of the same nested list revealed is "it" (parser/lower/mentions.ts#mentionsInside);
 *  - mentions and render: what YOUR sacrifice of one permanent sacrificed is "the sacrificed <noun>" (parser/lower/mentions.ts, render/steps-zones.ts);
 *  - render: the card exiled from among a group is "the exiled card" in a later sentence (render/fold.ts#chooseFromGroup), and the excess damage an "if" named is
 *    also "add that much {R}" (render/steps-cards.ts, family mana-that-much);
 *  - promotions: eff.t43.dig.exile.nonland (The Key to the Vault, Make Your Own Luck) and eff.e19.mana.keep.color.untilEndOfTurn (The Last Agni Kai).
 * Sentences are synthetic wordings (design 6.10), checked against the local index when it is present; the behavior is in std-rx4-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t43 from '../../../src/parser/templates/zz-fast5/t43.json';
import e19 from '../../../src/parser/templates/zz-fast5x/e19.json';
import review from '../../m5/golden/cards/cloud-std-rx4-review.json';
import t43Review from '../../m5/golden/cards/fast5-t43-review.json';
import e19Review from '../../m5/golden/cards/fast5x-e19-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: unknown = review): string[] => (file as Golden).filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);
const face = (text: string, type = 'Sorcery') => parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

/** Every sentence this file parses, for the 6.10 check below. */
const SENTENCES: string[] = [];
const said = (text: string): string => { SENTENCES.push(text); return text; };

describe('std-rx4 promotions (design 6.9; docs/CARD_AUTOMATION.md section 5, narrow wordings)', () => {
  const status = (file: Template[], id: string): string | undefined => file.find((t) => t.id === id)?.status;
  it('eff.t43.dig.exile.nonland is stable: its two cards in the index, both golden in fast5-t43-review.json (a 6.9 deviation, named in the round record and the PR)', () => {
    expect(status(t43 as Template[], 'eff.t43.dig.exile.nonland')).toBe('stable');
    expect(goldenUsing('eff.t43.dig.exile.nonland', t43Review)).toEqual(['The Key to the Vault', 'Make Your Own Luck']); // evidence in the template's own round's review file (guide section 6)
  });
  it('eff.e19.mana.keep.color.untilEndOfTurn is stable: its one card in the index, golden in fast5x-e19-review.json, played in std-rx4-scenarios (a 6.9 deviation)', () => {
    expect(status(e19 as Template[], 'eff.e19.mana.keep.color.untilEndOfTurn')).toBe('stable');
    expect(goldenUsing('eff.e19.mana.keep.color.untilEndOfTurn', e19Review)).toEqual(['The Last Agni Kai']);
  });
  it('every golden entry is pinned full and cites rules', () => {
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
});

describe('std-rx4 Cond: "<they | that player> lost life this turn" (CR 119.3, 120.3a)', () => {
  it('the chosen target opponent\'s life lost this turn, 1 or more; the gate says it back', () => {
    const f = face(said('Choose target opponent. If they lost life this turn, they discard a card. Otherwise, you gain 2 life.'));
    expect(understood(f), json(f)).toBe(true);
    expect(json(f)).toContain('"cond":{"cond":"compare","left":{"q":"lifeLostThisTurn","of":{"ref":"target","id":"t0"}},"op":">=","right":1}');
  });
  it('"that player" reads the same', () => {
    const a = face(said('Choose target opponent. If that player lost life this turn, they discard a card. Otherwise, you gain 2 life.'));
    expect(understood(a)).toBe(true);
    expect(json(a)).toContain('"left":{"q":"lifeLostThisTurn","of":{"ref":"target","id":"t0"}}');
  });
  it('"you lost life this turn" keeps its history reading (happened), not this one', () => {
    const f = face(said('Draw a card. If you lost life this turn, you gain 2 life.'));
    expect(understood(f)).toBe(true);
    expect(json(f)).toContain('"cond":"happened"');
    expect(json(f)).not.toContain('lifeLostThisTurn');
  });
  it('a pronoun with no player before it stays manual (fails closed)', () => {
    expect(understood(face(said('If they lost life this turn, you gain 2 life.')))).toBe(false);
  });
});

describe('std-rx4 mentions: the hand revealed by an earlier instruction of the same list (CR 701.20a, 402.3)', () => {
  it('"If C, they reveal their hand, you choose a <card> from it, and they discard that card": "it" is the revealed hand, inside the branch', () => {
    const f = face(said('Choose target opponent. If they lost life this turn, they reveal their hand, you choose an artifact card from it, and they discard that card.'));
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"is":{"ref":"bound","name":"them"}');
  });
  it('without a reveal in the list, "it" has no hand to name and the sentence stays manual', () => {
    expect(understood(face(said('Choose target opponent. If they lost life this turn, you choose an artifact card from it, and they discard that card.')))).toBe(false);
  });
});

describe('std-rx4 render (fold.ts#chooseFromGroup): the card exiled from among a group is "the exiled card" later (CR 406.1, 400.7, 608.2c)', () => {
  it('"You may exile a nonland card from among them. ... You may cast the exiled card without paying its mana cost."', () => {
    const f = face(said('Look at the top four cards of your library. You may exile a nonland card from among them. Put the rest into your graveyard. You may cast the exiled card without paying its mana cost.'));
    expect(understood(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"op":"cast","who":{"ref":"you"},"what":{"ref":"bound","name":"chosen"}');
  });
  it('the cards put into your hand from among them are no "exiled card" (the fold binds the name only for exile)', () => {
    expect(fullyAutomated(face(said('Look at the top four cards of your library. You may put a creature card from among them into your hand. Put the rest into your graveyard. You may cast the exiled card without paying its mana cost.')))).toBe(false);
  });
});

describe('std-rx4 mentions and render: "the sacrificed <noun>" after your own sacrifice (CR 701.21a, 608.2h)', () => {
  it('"You may sacrifice a creature. If you do, draw cards equal to the sacrificed creature\'s power."', () => {
    const f = face(said("You may sacrifice a creature. If you do, draw cards equal to the sacrificed creature's power."));
    expect(understood(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"count":{"q":"stat","stat":"power","of":{"ref":"bound","name":"them"}}');
  });
  it('the noun must fit what was sacrificed: "the sacrificed artifact" after a creature stays manual', () => {
    expect(understood(face(said("You may sacrifice a creature. If you do, draw cards equal to the sacrificed artifact's mana value.")))).toBe(false);
  });
  it('a participle-only mention: a bare "it" never names what was sacrificed', () => {
    expect(fullyAutomated(face(said('You may sacrifice a creature. If you do, return it to its owner\'s hand.')))).toBe(false);
  });
  it('several sacrificed permanents are no one "sacrificed creature"', () => {
    expect(understood(face(said("Sacrifice two creatures. Draw cards equal to the sacrificed creature's power.")))).toBe(false);
  });
});

describe('std-rx4 render (family mana-that-much): "add that much {R}" of the excess damage an "if" named (CR 120.4a, 106.4)', () => {
  it('after a fight, the excess dealt to the opponent\'s creature is the amount of red mana', () => {
    const f = face(said('Target creature you control fights target creature an opponent controls. If the creature an opponent controls is dealt excess damage this way, add that much {R}.'), 'Instant');
    expect(understood(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"dynamic":{"kind":"ofType","type":"R","count":{"q":"excessDamage","step":"dealt"');
  });
  it('two symbols are not one type with an amount: "add that much {R}{R}" stays manual', () => {
    expect(understood(face(said('Target creature you control fights target creature an opponent controls. If the creature the opponent controls is dealt excess damage this way, add that much {R}{R}.'), 'Instant'))).toBe(false);
  });
  it('"add that much {R}" with no amount before it stays manual', () => {
    expect(understood(face(said('Target creature you control fights target creature an opponent controls. Add that much {R}.'), 'Instant'))).toBe(false);
  });
  it('the same JSON as "add an amount of {R} equal to the excess damage dealt to the creature the opponent controls this way"', () => {
    const a = face('Target creature you control fights target creature an opponent controls. If the creature an opponent controls is dealt excess damage this way, add that much {R}.', 'Instant');
    const b = face(said('Target creature you control fights target creature an opponent controls. If the creature the opponent controls is dealt excess damage this way, add an amount of {R} equal to that excess damage.'), 'Instant');
    if (understood(b)) expect(jsonKey(b.abilities)).toBe(jsonKey(a.abilities));
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx4 design 6.10 (local index): synthetic sentences', () => {
  it('no sentence parsed here is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    expect(SENTENCES.length).toBeGreaterThan(10);
    expect(SENTENCES.filter((s) => s.split('\n').some((l) => lines.has(l.trim())))).toEqual([]);
  }, 120_000);
});
