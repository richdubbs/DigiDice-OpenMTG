/**
 * FAST5X E17: the template data of parser/templates/zz-fast5x/e17.json and the parser and renderer readings E17 needed (design 6.8 G6):
 *  - "at the beginning of your second main phase" is the main phase numbered 2 in its turn (`nth: 2`, CR 505.1b), printed back as Oracle says it;
 *  - "This ability triggers only once." is a limit of once for the object (CR 603.2h, 400.7);
 *  - "this is the first time this ability has resolved this turn" and "if it's the second time" (`{q:'resolvedThisTurn'}`, CR 608.2, 400.7);
 *  - "if you controlled it" (the object's controller as it last existed, CR 608.2h), "if a creature you controlled was destroyed this way" (`did` with
 *    `which`), "if you controlled a Mount as you cast ~" (`asCast`, CR 601.2i);
 *  - the trailing "if" shapes "you gain N life if C", "surveil N if C", "Then draw a card if C", and three survival effects.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e17 from '../../../src/parser/templates/zz-fast5x/e17.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { normalizedOracleLines, normalizeLine } from '../../m5/templates-d/support';
import { localIndex } from '../../m5/parser/support';
import { getCard, loadFixtureCards } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e17-review.json';

const E17 = e17 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As long)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const steps = (text: string, type?: string): unknown => (first(text, type) as { effect?: { steps: unknown[] } }).effect?.steps;
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e17.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e17.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E17) {
      expect(t.id, t.id).toMatch(/^eff\.e17\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E17 template has its evidence: hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // every card of the local index whose automated part the template builds (each one checked against the Oracle text and the rules by hand, see the review
    // file); the template is also tried on Weatherlight Compleated and The Golden City of Orazca, whose abilities stay manual for other reasons
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.e17.gainlife.if': ['Belladonna Took', 'Vito, Fanatic of Aclazotz', 'Sphinx Sovereign', 'Omnath, Locus of Creation'],
      'eff.e17.surveil.if': ["Victor, Valgavoth's Seneschal", 'Plan the Heist'],
      'eff.e17.then.draw.if': ['Harvestrite Host'],
      'eff.e17.search.may.gy': ['Cynical Loner'],
      'eff.e17.may.put.permanentFromHand': ['Kona, Rescue Beastie', 'Invasion of Shandalar // Leyline Surge', 'The Ur-Dragon'],
      'eff.e17.put.fromAGraveyard': ["Victor, Valgavoth's Seneschal", 'Breaking // Entering'],
      'eff.e17.pump.additional.if': ['Faerie Fencing'],
    };
    for (const t of E17.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect([...new Set(cards)].sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E17) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it('carry no Wizards text in their examples (design 6.10): no example equals a single Oracle line of a fixture card or of the local index', () => {
    const oracle = normalizedOracleLines([...Object.values(loadFixtureCards()), ...(localIndex() ?? [])]);
    expect(E17.flatMap((t) => t.examples.filter((e) => oracle.has(normalizeLine(e.text))).map((e) => `${t.id}: ${e.text}`))).toEqual([]);
  });
});

describe('E17 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E17) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(f.abilities, e.text).toMatchObject(e.expect as object[]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('CR 505.1b: "your second main phase" is the main phase numbered 2 in its turn', () => {
  it('reads nth 2 and prints it back as Oracle says it; "first main phase" stays the precombat main phase (CR 505.1a)', () => {
    const a = first('At the beginning of your second main phase, if ~ is tapped, you gain 1 life.');
    expect(a['trigger']).toEqual({ on: [{ ev: 'step', step: 'main2', whose: 'you', nth: 2 }] });
    expect(gateOk('At the beginning of your second main phase, if ~ is tapped, you gain 1 life.')).toBe(true);
    expect(gateOk('At the beginning of your second main phase, draw a card.')).toBe(true);
    expect((first('At the beginning of your postcombat main phase, draw a card.')['trigger'] as { on: unknown[] }).on).toEqual([{ ev: 'step', step: 'main2', whose: 'you' }]);
    expect((first('At the beginning of your first main phase, draw a card.')['trigger'] as { on: unknown[] }).on).toEqual([{ ev: 'step', step: 'main1', whose: 'you' }]);
  });
  it('CR 603.2h, 400.7: "This ability triggers only once." is once for the object', () => {
    const a = first('At the beginning of your second main phase, if ~ is tapped, put a flying counter on it. This ability triggers only once.');
    expect(a['limit']).toEqual({ per: 'game', max: 1 });
    expect(gateOk('At the beginning of your second main phase, if ~ is tapped, put a flying counter on it. This ability triggers only once.')).toBe(true);
    // anything else after "This ability triggers only" stays a restriction the model cannot state
    expect(first('At the beginning of your upkeep, draw a card. This ability triggers only once each game.')['kind']).toBe('manual');
  });
});

describe('CR 608.2, 400.7: "this is the Nth time this ability has resolved this turn"', () => {
  const resolved = (op: string, n: number) => ({ cond: 'compare', left: { q: 'resolvedThisTurn' }, op, right: n });
  it('the first sentence names the count, "if it\'s the second time" names it again', () => {
    const s = steps('Whenever an artifact you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If it\'s the second time, draw a card. If it\'s the third time, create a 1/1 white Soldier creature token.') as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ op: 'gainLife', guard: resolved('==', 1) });
    expect(s[1]).toMatchObject({ op: 'if', cond: resolved('==', 2) });
    expect(s[2]).toMatchObject({ op: 'if', cond: resolved('==', 3) });
    expect(gateOk('Whenever an artifact you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If it\'s the second time, draw a card. If it\'s the third time, create a 1/1 white Soldier creature token.')).toBe(true);
  });
  it('activated and triggered abilities; "the first or second time" is at most two', () => {
    expect(gateOk('{1}: ~ gets +1/+0 until end of turn. If this is the third time this ability has resolved this turn, draw a card.')).toBe(true);
    expect(steps('Whenever a creature you control enters, create a Treasure token if this is the first or second time this ability has resolved this turn.')).toMatchObject([{ op: 'createToken', guard: resolved('<=', 2) }]);
    expect(gateOk('Whenever a creature you control enters, create a Treasure token if this is the first or second time this ability has resolved this turn.')).toBe(true);
    const c = parseCard(exampleCard('Whenever a creature you control enters, scry 1. If this is the first or second time this ability has resolved this turn, draw a card.'), OPTS).faces[0]!;
    expect(JSON.stringify(c.abilities)).toContain(JSON.stringify(resolved('<=', 2)));
  });
  it('"this game" is not "this turn": stays manual', () => {
    expect(fullyAutomated(parsed('When ~ enters, if it\'s the first time this ability has resolved this game, draw a card.'))).toBe(false);
  });
});

describe('CR 608.2h: last known control', () => {
  it('"if you controlled it" reads the object the ability acted on, never the source itself', () => {
    const s = steps('When ~ enters, exile up to one other target creature. If you controlled it, draw a card.') as Record<string, unknown>[];
    expect(s[1]).toMatchObject({ op: 'if', cond: { cond: 'matches', object: { ref: 'target', id: 't0' }, filter: { controller: 'you' } } });
    expect(gateOk('When ~ enters, exile up to one other target creature. If you controlled it, draw a card.')).toBe(true);
    expect(gateOk('Return target nonland permanent to its owner\'s hand. If you controlled that permanent, you gain 2 life.')).toBe(true);
    expect(gateOk('Destroy target artifact. If you controlled that artifact, draw a card.')).toBe(true);
  });
  it('"if a creature you controlled was destroyed this way" reads the destroy step right before it', () => {
    const s = steps('Destroy target creature. If a creature you controlled was destroyed this way, draw a card.') as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ op: 'destroy', as: expect.any(String) });
    expect(s[1]).toMatchObject({ op: 'if', cond: { cond: 'did', step: (s[0] as { as: string }).as, which: { types: ['Creature'], controller: 'you' } } });
    expect(gateOk('Destroy target creature. If a creature you controlled was destroyed this way, draw a card.')).toBe(true);
    expect(gateOk('Destroy target artifact. If a permanent you controlled or a token was destroyed this way, you gain 3 life.')).toBe(true);
    // only a destroy step can answer it
    expect(fullyAutomated(parsed('Exile target creature. If a creature you controlled was destroyed this way, draw a card.'))).toBe(false);
  });
  it('CR 601.2i: "if you controlled a Wizard as you cast ~" is decided as the spell is cast', () => {
    const s = steps('~ deals 2 damage to target creature. ~ deals 3 damage to that creature instead if you controlled a Wizard as you cast ~.') as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ op: 'if', cond: { cond: 'asCast', held: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Wizard'], controller: 'you' } } } } });
    expect(gateOk('~ deals 2 damage to target creature. ~ deals 3 damage to that creature instead if you controlled a Wizard as you cast ~.', 'Instant')).toBe(true);
  });
});

describe('E17 real cards (npm run cards -- try): full now', () => {
  it('the resolution count', () => {
    for (const name of ['Belladonna Took', 'Venom Connoisseur', 'Harvestrite Host', 'Tannuk, Memorial Ensign', "Victor, Valgavoth's Seneschal", 'Vito, Fanatic of Aclazotz', 'South Pole Voyager']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('last known control and "as you cast"', () => {
    for (const name of ['Hotshot Investigators', 'Boomerang Basics', 'Break the Spell', 'Steer Clear', 'Faerie Fencing']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  it('survival', () => {
    for (const name of ['Cautious Survivor', 'Savior of the Small', 'Kona, Rescue Beastie', 'Defiant Survivor', 'Acrobatic Cheerleader', 'Shrewd Storyteller', 'Glimmer Seeker', 'Cynical Loner', 'Scheming Silvertongue // Sign in Blood']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('full with the other merged packages too (FAST5 batch 4 integration): Soulbright Seeker (E11 behold, CR 701.4a), Kellan (its Adventure, T38 extra land, CR 305.2, 715)', () => {
    for (const name of ['Soulbright Seeker', 'Kellan, Inquisitive Prodigy // Tail the Suspect']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  // Merge wave 7: the emblem (sta.e27.asTransforms.emblem) was already automated; the back face's last manual unit, "Whenever ~ attacks, you may sacrifice
  // any number of other creatures. If you do, draw that many cards." (draw the number actually sacrificed, CR 608.2c, 701.21a), is read since round 4
  it('full since merge wave 7: Sephiroth (the emblem and the back face attack trigger)', () => {
    for (const name of ['Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});
