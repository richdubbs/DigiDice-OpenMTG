/**
 * WP17: parseCard end to end (design 6.1 steps 2-7, 6.6, 6.8). Contract C1 (never throws), the ledger (G4) over every fixture card, each ability shape,
 * guards G1/G3/G5/G8 as parseCard reports them, the chart budget, quoted abilities, labels, determinism and purity. Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, OracleCard } from '../../../src/index';
import { PARSER_VERSION, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { faceContexts, ledgerProblems, normalizeText } from '../../../src/parser/preprocess';
import { loadFixtureCards } from '../../fixtures';
import { EXTRA, card, face, freeze, options, tpl } from './support';

const kinds = (defs: readonly AbilityDef[]): string[] => defs.map((a) => (a.kind === 'manual' ? `manual:${a.shape}` : a.kind));
const effect = (a: AbilityDef | undefined): { targets: unknown[]; steps: Record<string, unknown>[]; modes?: unknown } => (a as unknown as { effect: { targets: unknown[]; steps: Record<string, unknown>[] } }).effect;

/** A small deterministic generator for the totality fuzz (tests stay reproducible). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('WP17 contract C1: parseCard never throws', () => {
  it('random garbage text, odd layouts and broken objects all give a result', () => {
    const rnd = lcg(17);
    const alphabet = 'abc ~{}()[]:.,—•−+-/0123456789XTWUBRG"\'\n|';
    for (let i = 0; i < 200; i++) {
      let text = '';
      const n = Math.floor(rnd() * 80);
      for (let k = 0; k < n; k++) text += alphabet[Math.floor(rnd() * alphabet.length)];
      const layout = ['normal', 'split', 'saga', 'class', 'adventure', 'leveler'][i % 6]!;
      const r = parseCard(card(`Garbage ${i}`, i % 2 ? 'Instant' : 'Creature — Elf', text, { layout }), options(EXTRA));
      expect(r.parserVersion).toBe(PARSER_VERSION);
      expect(r.faces.length).toBeGreaterThan(0);
    }
    expect(() => parseCard({} as OracleCard, options())).not.toThrow();
    expect(() => parseCard({ name: 'X', layout: 'split', card_faces: [null, null] } as unknown as OracleCard, options())).not.toThrow();
  });
  it('an exception inside a face becomes one manual ability with diagnostic parser-error', () => {
    const broken = { ...options(), templates: null } as unknown as ReturnType<typeof options>;
    const f = parseCard(card('Broken Bolt', 'Instant', 'Draw a card.'), broken).faces[0]!;
    expect(f.abilities).toEqual([expect.objectContaining({ kind: 'manual', shape: 'unknown', reason: expect.stringMatching(/^parser-error/) })]);
    expect(f.diagnostics.map((d) => d.code)).toContain('parser-error');
    expect(ledgerProblems(normalizeText('Draw a card.').text, f.ledger)).toEqual([]);
  });
  it('is deterministic and pure: the same input gives the same output, and the card is not modified', () => {
    const c = freeze(card('Pure Wisp', 'Creature — Spirit', 'Flying\nWhen this creature enters, target player draws two cards.\n{2}, {T}: Add {G}.'));
    const a = parseCard(c, options(EXTRA));
    const b = parseCard(c, options(EXTRA));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('WP17 guard G4: every ledger tiles', () => {
  it('every face of every fixture card: every non-space character is in exactly one ledger entry', () => {
    const opts = options(EXTRA);
    let faces = 0;
    for (const c of Object.values(loadFixtureCards())) {
      const res = parseCard(c, opts);
      const ctxs = faceContexts(c, opts);
      res.faces.forEach((f, i) => {
        faces++;
        expect(ledgerProblems(normalizeText(ctxs[i]!.text).text, f.ledger), `${c.name} face ${i}`).toEqual([]);
        expect(f.gate).toHaveLength(f.abilities.length);
      });
    }
    expect(faces).toBeGreaterThan(150);
  }, 60_000); // parses every fixture card: past the 5 s default since the fixture set grew (5.3-6.1 s on a 4-CPU cloud machine, 2026-10-21)
  it('consumed text names the templates that consumed it; manual text says why', () => {
    const f = face(card('Half Spell', 'Sorcery', 'Draw two cards. Shuffle your graveyard into the moon.'));
    expect(f.ledger.find((e) => e.status === 'consumed')?.by).toBe('eff.draw.you');
    expect(f.ledger.find((e) => e.status === 'manual')?.reason).toMatch(/unknown word|no template/);
  });
});

describe('WP17 ability shapes (design 6.2, 6.6)', () => {
  it('CR 702: a keyword list is one keyword ability per item; an unknown keyword is a manual static ability', () => {
    expect(kinds(face(card('Kw Wisp', 'Creature — Spirit', 'Flying, vigilance')).abilities)).toEqual(['keyword', 'keyword']);
    const f = face(card('Kw Wisp', 'Creature — Spirit', 'Flying\nFlibbertigibbet'));
    expect(kinds(f.abilities)).toEqual(['keyword', 'manual:static']);
  });
  it('CR 602.5d, 605.1a: activation restrictions become fields; a mana ability is flagged, an ability with a target is not', () => {
    const f = face(card('Odd Totem', 'Artifact', '{2}, {T}: Add {G}. Activate only as a sorcery.\n{T}: Target player draws a card. Activate only once each turn.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', isMana: true, sorcerySpeed: true, cost: { tap: true, mana: [{ kind: 'generic', amount: 2 }] } });
    expect(f.abilities[1]).toMatchObject({ kind: 'activated', limit: { per: 'turn', max: 1 } });
    expect((f.abilities[1] as { isMana?: boolean }).isMana).toBeUndefined();
  });
  it('CR 602.2b, design 6.6: a cost part that does not parse is a manual cost part; the understood parts and the effect are kept', () => {
    const f = face(card('Odd Totem', 'Artifact', '{2}, Juggle three apples: Draw a card.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 2 }], other: [{ kind: 'manual', text: 'Juggle three apples' }] }, effect: { steps: [{ op: 'draw' }] } });
  });
  it('CR 606: loyalty abilities', () => {
    const f = face(card('Test Walker', 'Legendary Planeswalker — Test', '+1: Draw a card.\n−3: Target player draws two cards.'));
    expect(f.abilities.map((a) => (a as { cost?: unknown }).cost)).toEqual([{ loyalty: 1 }, { loyalty: -3 }]);
    expect(f.abilities.every((a) => (a as { isLoyalty?: boolean }).isLoyalty)).toBe(true);
  });
  it('CR 603.4: an intervening "if" right after the trigger condition', () => {
    const f = face(card('If Wisp', 'Creature — Spirit', "When this creature enters, if it's your turn, draw a card."));
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'turnOf', whose: 'you' }, effect: { steps: [{ op: 'draw' }] } });
  });
  it('design 6.6: an unparsed trigger clause is a manual triggered ability with the understood effect ("Trigger now"), linted and gated on its own text', () => {
    const f = face(card('Odd Wisp', 'Creature — Spirit', 'Whenever the moon rises, draw a card.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'triggered', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } });
    expect(f.gate[0]).toMatchObject({ ok: true });
  });
  it('CR 603.2h: "This ability triggers only once each turn." is the limit, not an effect', () => {
    const f = face(card('Limit Wisp', 'Creature — Spirit', 'Whenever a creature you control dies, draw a card. This ability triggers only once each turn.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', limit: { per: 'turn', max: 1 }, effect: { steps: [{ op: 'draw' }] } });
  });
  it('CR 700.2: a modal spell; target ids run across the modes', () => {
    const f = face(card('Pick Spell', 'Sorcery', 'Choose one —\n• Destroy target artifact.\n• Target player draws two cards.'));
    expect(effect(f.abilities[0])).toMatchObject({ targets: [], steps: [], modes: { min: 1, max: 1, options: [{ program: { targets: [{ id: 't0' }] } }, { program: { targets: [{ id: 't1' }] } }] } });
  });
  it('CR 714.2: saga chapters', () => {
    const f = face(card('Test Saga', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter.)\nI, II — Draw a card.\nIII — Target player draws two cards.', { layout: 'saga' }));
    expect(f.abilities.map((a) => (a as { chapters?: number[] }).chapters)).toEqual([[1, 2], [3]]);
  });
  it('CR 604: a static line that does not parse is a manual static ability', () => {
    expect(kinds(face(card('Odd Banner', 'Enchantment', 'Creatures you control dream of electric sheep.')).abilities)).toEqual(['manual:static']);
  });
  it('a spell of which nothing is understood is one manual spell ability, as in milestone 4', () => {
    expect(kinds(face(card('Odd Spell', 'Instant', 'Juggle three apples. Then juggle them again.')).abilities)).toEqual(['manual:spell']);
  });
  it('CR 207.2c: an ability word is kept as `label` and never affects behavior', () => {
    const f = face(card('Word Wisp', 'Creature — Spirit', 'Landfall — Whenever a creature you control dies, draw a card.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', label: 'Landfall' });
  });
  it('CR 113.1c, 201.5a: a quoted ability granted by an effect is parsed as a sub-stream', () => {
    const gain = tpl('effect', '{o:Objs} gain[s] {a:Abilities} {d:Dur}', { op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 6, add: '$a' }] }] }, { id: 'test.gain' });
    const f = face(card('Grant Spell', 'Instant', 'Creatures you control gain "{T}: Add {G}." until end of turn.'), options([...EXTRA, gain]));
    expect(effect(f.abilities[0]).steps[0]).toMatchObject({ op: 'effect', effects: [{ mods: [{ layer: 6, add: [{ kind: 'activated', cost: { tap: true }, isMana: true, effect: { steps: [{ op: 'addMana', units: [['G']] }] } }] }] }] });
  });
});

describe('WP17 guards as parseCard reports them (design 6.8)', () => {
  it('G1: a sentence with words left over is not a shorter sentence: "Destroy target creature unless it is blue." is manual', () => {
    const f = face(card('Odd Blade', 'Instant', 'Destroy target creature unless it is blue.'));
    expect(kinds(f.abilities)).toEqual(['manual:spell']);
  });
  it('G3: a critical word in a template literal that the template does not consume makes the sentence manual', () => {
    const sloppy = tpl('effect', 'you may draw {n:Qty} card[s]', { op: 'draw', who: { ref: 'you' }, count: '$n' }, { id: 'test.sloppy' });
    const f = face(card('Sloppy', 'Sorcery', 'You may draw a card.'), options([sloppy]));
    expect(f.diagnostics.find((d) => d.code === 'critical-word')?.message).toMatch(/"may"/);
  });
  it('G5: two readings with different JSON are ambiguous, both kept in the diagnostic', () => {
    const a = tpl('effect', 'zap {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'test.zap1' });
    const b = tpl('effect', 'zap {o:Objs}', { op: 'sacrifice', what: '$o' }, { id: 'test.zap2' });
    const f = face(card('Bolt Jar', 'Instant', 'Zap target creature.'), options([a, b]));
    const d = f.diagnostics.find((x) => x.code === 'ambiguous')!;
    expect(d.alternatives).toHaveLength(2);
    expect(kinds(f.abilities)).toEqual(['manual:spell']);
  });
  it('G8: a template whose `needs` the engine lacks leaves its sentence manual with needs-engine', () => {
    const needy = tpl('effect', 'zap {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'test.needy', needs: ['op:zap'] });
    const f = face(card('Bolt Jar', 'Instant', 'Zap target creature.'), options([needy], { capabilities: new Set() }));
    expect(f.diagnostics.find((d) => d.code === 'needs-engine')?.message).toMatch(/op:zap/);
    // with the capability the template is used (and the gate then judges the invented verb: "Zap" is not "Destroy")
    const g = face(card('Bolt Jar', 'Instant', 'Zap target creature.'), options([needy], { capabilities: new Set(['op:zap']) }));
    expect(g.diagnostics.some((d) => d.code === 'needs-engine')).toBe(false);
    expect(g.templatesUsed).toContain('test.needy');
  });
  it('design 6.3 rule 4: an ability over the chart budget is manual with code budget', () => {
    const f = face(card('Big Bolt', 'Instant', '~ deals 3 damage to any target.'), options([], { budget: 5 }));
    expect(f.diagnostics.some((d) => d.code === 'budget')).toBe(true);
    expect(kinds(f.abilities)).toEqual(['manual:spell']);
  });
  it('design 6.9: an experimental template is reported (it caps the card at partial)', () => {
    const exp = tpl('effect', 'zap {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'test.exp', status: 'experimental' });
    const f = face(card('Bolt Jar', 'Instant', 'Zap target creature.'), options([exp]));
    expect(f.experimental).toEqual(['test.exp']);
    expect(f.diagnostics.some((d) => d.code === 'experimental')).toBe(true);
  });
  it('G6: an ability the render gate rejects is manual with the two strings in the diagnostic', () => {
    // a template whose build drops the duration: the JSON does not say what the text says
    const lossy = tpl('effect', '{o:Obj} get[s] {pt:PT} until end of turn', { op: 'effect', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: '7c', power: '$pt.p', toughness: '$pt.t' }] }], duration: { d: 'permanent' } }, { id: 'test.lossy', consumes: ['until'] });
    const f = face(card('Lossy Growth', 'Instant', 'Target creature gets +2/+2 until end of turn.'), defaultParseOptions({ templates: [lossy] }));
    expect(kinds(f.abilities)).toEqual(['manual:spell']);
    expect(f.diagnostics.find((d) => d.code === 'gate-mismatch')?.message).toMatch(/rendered .* Oracle/);
    expect(f.gate[0]!.ok).toBe(false);
  });
});
