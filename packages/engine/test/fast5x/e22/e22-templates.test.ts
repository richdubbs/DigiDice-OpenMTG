/**
 * FAST5X E22: the template data of parser/templates/zz-fast5x/e22.json and the parser and renderer readings E22 needed (design 6.8 G6):
 *  - triggers "whenever a card leaves your graveyard during your turn" and "whenever one or more cards leave your graveyard during your turn" (CR 603.2c,
 *    603.10a, 500.1);
 *  - statics "as long as C, ~ gets an additional +N/+N [and can't be blocked by more than one creature]" (descend 8, CR 207.2c, 613.4c) and
 *    "~ gets -X/-0, where X is Q" (fathomless descent);
 *  - conditions (parser/holes/cond.ts, render/cond.ts): "you descended this turn" (CR 700.11), "you gained or lost life this turn", "you gained and lost
 *    life this turn" (CR 119.9, 119.10), "a card left your graveyard this turn", "N or more cards left your graveyard this turn" (CR 400.3), "one or more
 *    cards were put into exile this turn" (CR 406.1), "you sacrificed one or more permanents this turn" (CR 701.21a), "you didn't cast a spell this turn"
 *    (CR 601.2i); the quantity "the number of times you descended this turn"; "that much" after the sacrifice condition;
 *  - a spell's "Choose one. If C, you may choose both instead." / "If C as you cast this spell, choose one or more instead." (CR 700.2, 601.2b).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import e22 from '../../../src/parser/templates/zz-fast5x/e22.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e22-review.json';

const E22 = e22 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As long|Enchanted|Equipped|~)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const typeFor = (text: string): string | undefined => (/^Enchanted /.test(text) ? 'Enchantment — Aura' : undefined);
const parsed = (text: string, type?: string) => {
  const t = type ?? typeFor(text);
  const body = t === 'Enchantment — Aura' ? `Enchant creature\n${text}` : text;
  return parseCard(exampleCard(body, t), OPTS).faces[0]!;
};
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e22.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e22.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E22) {
      expect(t.id, t.id).toMatch(/^(trg|sta)\.e22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E22 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // the local index prints these sentences on these cards only
    const WHOLE_CORPUS: Record<string, string[]> = {
      'trg.e22.cardLeavesYourGraveyard.yourTurn': ['Kishla Skimmer'],
      'trg.e22.cardsLeaveYourGraveyard.batch.yourTurn': ['Attuned Hunter', 'Kheru Goldkeeper'],
      'sta.e22.aslong.pump.blockedByOne': ['Akawalli, the Seething Tower'],
    };
    for (const t of E22.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E22) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E22) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) {
          const ab = f.abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
          expect(t.kind === 'trigger' ? ab['trigger'] : ab, e.text).toMatchObject(e.expect as object);
        }
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('E22 conditions and quantities: what the readings mean, and that they pass the render gate', () => {
  const endStep = (cond: string): string => `At the beginning of your end step, if ${cond}, draw a card.`;
  const iff = (text: string): unknown => first(text)['interveningIf'];
  const life = (change: 'gain' | 'loss') => ({ cond: 'happened', event: { ev: 'life', change, player: 'you' }, scope: 'turn' });
  it('CR 700.11: "you descended this turn" is one or more permanent cards put into your graveyard this turn', () => {
    expect(iff(endStep('you descended this turn'))).toEqual({ cond: 'compare', left: { q: 'descendedThisTurn' }, op: '>=', right: 1 });
    expect(gateOk(endStep('you descended this turn'))).toBe(true);
  });
  it('CR 700.11: "the number of times you descended this turn"', () => {
    const f = first('At the beginning of your end step, create X 1/1 black Fungus creature tokens, where X is the number of times you descended this turn.');
    expect(JSON.stringify(f['effect'])).toContain('"count":{"q":"descendedThisTurn"}');
    expect(gateOk('At the beginning of your end step, create X 1/1 black Fungus creature tokens, where X is the number of times you descended this turn.')).toBe(true);
  });
  it('CR 119.9, 119.10: "you gained or lost life" is either event, "you gained and lost life" both (not a net change)', () => {
    expect(iff(endStep('you gained or lost life this turn'))).toEqual({ cond: 'any', of: [life('gain'), life('loss')] });
    expect(iff(endStep('you gained and lost life this turn'))).toEqual({ cond: 'all', of: [life('gain'), life('loss')] });
    expect(gateOk(endStep('you gained or lost life this turn'))).toBe(true);
    expect(gateOk(endStep('you gained and lost life this turn'))).toBe(true);
  });
  it('CR 400.3: "a card left your graveyard this turn" (a card you own; any destination); the counted form is read by the cost reduction template only (G5)', () => {
    const left = { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, from: 'graveyard' };
    expect(iff(endStep('a card left your graveyard this turn'))).toEqual({ cond: 'happened', event: left, scope: 'turn' });
    expect(gateOk(endStep('a card left your graveyard this turn'))).toBe(true);
    expect(compileCard(getCard('Wilt in the Heat')).automation.level).toBe('full');
  });
  it('CR 406.1: "one or more cards were put into exile this turn" (any card, from anywhere; a token is no card)', () => {
    expect(iff(endStep('one or more cards were put into exile this turn'))).toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { isCard: true }, to: 'exile' }, scope: 'turn' });
    expect(gateOk(endStep('one or more cards were put into exile this turn'))).toBe(true);
  });
  it('CR 701.21a: "you sacrificed a permanent this turn" / "one or more permanents"; "that much" after it is the count of those sacrifices', () => {
    const sac = { cond: 'happened', event: { ev: 'action', verb: 'sacrifice', actor: 'you' }, scope: 'turn' };
    expect(iff(endStep('you sacrificed a permanent this turn'))).toEqual(sac);
    expect(iff(endStep('you sacrificed one or more permanents this turn'))).toEqual(sac);
    const text = 'At the beginning of your end step, if you sacrificed one or more permanents this turn, ~ deals that much damage to any target.';
    expect(JSON.stringify(first(text)['effect'])).toContain('"amount":{"q":"happenedCount","event":{"ev":"action","verb":"sacrifice","actor":"you"},"scope":"turn"}');
    expect(gateOk(text)).toBe(true);
    // "that much" with no count to refer to is not read
    expect(fullyAutomated(parsed('At the beginning of your end step, if you control a Swamp, ~ deals that much damage to any target.'))).toBe(false);
  });
  it('CR 601.2i: "you didn\'t cast a spell this turn"', () => {
    expect(iff(endStep("you didn't cast a spell this turn"))).toEqual({ cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: 'you' }, scope: 'turn' } });
    expect(gateOk(endStep("you didn't cast a spell this turn"))).toBe(true);
  });
});

describe('E22 CR 700.2, 601.2b: a spell whose number of modes changes with a condition', () => {
  const modes = (text: string): Record<string, unknown> => ((first(text, 'Sorcery')['effect'] as Record<string, unknown>)['modes'] as Record<string, unknown>);
  it('"If you descended this turn, you may choose both instead": one, or one or both', () => {
    const text = 'Choose one. If you descended this turn, you may choose both instead.\n• Draw a card.\n• You gain 3 life.';
    expect(modes(text)).toMatchObject({ min: 1, max: 1, override: { when: { cond: 'compare', left: { q: 'descendedThisTurn' }, op: '>=', right: 1 }, min: 1, max: 2 } });
    expect(gateOk(text, 'Sorcery')).toBe(true);
  });
  it('"If there are N or more permanent cards in your graveyard as you cast this spell, choose one or more instead": one, or one up to all', () => {
    const text = 'Choose one. If there are five or more permanent cards in your graveyard as you cast this spell, choose one or more instead.\n• Draw a card.\n• You gain 3 life.\n• Each opponent loses 1 life.';
    expect(modes(text)).toMatchObject({ min: 1, max: 1, override: { when: { cond: 'exists', atLeast: 5 }, min: 1, max: 3 } });
    expect(gateOk(text, 'Sorcery')).toBe(true);
  });
  it('a condition with no reading, or another instruction, keeps the header manual', () => {
    expect(fullyAutomated(parsed('Choose one. If the moon is full, you may choose both instead.\n• Draw a card.\n• You gain 3 life.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(parsed('Choose one. If you descended this turn, you may choose all three instead.\n• Draw a card.\n• You gain 3 life.', 'Sorcery'))).toBe(false);
  });
});

describe('E22 real cards (npm run cards -- try): full now', () => {
  it('descended this turn, descend 4 / 8 and fathomless descent', () => {
    for (const name of ['Child of the Volcano', 'Deep Goblin Skulltaker', 'Stalactite Stalker', 'Enterprising Scallywag', 'Canonized in Blood', 'Broodrage Mycoid', 'Ruin-Lurker Bat', 'Molten Collapse', 'Akawalli, the Seething Tower', 'Song of Stupefaction']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('life gained or lost, cards that left your graveyard, cards put into exile, permanents sacrificed, no spell cast', () => {
    for (const name of ['Starlit Soothsayer', 'Starseer Mentor', 'Lunar Convocation', 'Primary Research', 'Living History', 'Ennis, Debate Moderator', 'Sawblade Skinripper', 'Edgar, Moonlit Sovereign']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('graveyard-leave triggers during your turn', () => {
    for (const name of ['Kishla Skimmer', 'Attuned Hunter']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  it('the same families outside the package: "-X/-0, where X is" Auras and "it gets an additional" Equipment', () => {
    for (const name of ['Fear of Death', 'Spontaneous Mutation', 'Disturbing Conversion', 'Heavy Mattock', 'True-Faith Censer', 'Silver-Inlaid Dagger']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('Kheru Goldkeeper is full since FAST5 T65 (its renew effect "two +1/+1 counters and a flying counter" is the T65 template eff.t65.counters.put.nAndKeyword)', () => {
    expect(compileCard(getCard('Kheru Goldkeeper')).automation.level).toBe('full');
  });
  it('Wail of the Forgotten is full with FAST5 T43 ("put one of them into your hand and the rest into your graveyard", CR 701.20e) and E22\'s descend 8 (CR 700.11, 700.2)', () => {
    const w = compileCard(getCard('Wail of the Forgotten'));
    expect(w.automation.level).toBe('full');
    const modes = (w.faces[0]!.abilities[0] as { effect: { modes: { min: number; max: number; override: { min: number; max: number } } } }).effect.modes;
    expect([modes.min, modes.max, modes.override.min, modes.override.max]).toEqual([1, 1, 1, 3]);
  });
});
