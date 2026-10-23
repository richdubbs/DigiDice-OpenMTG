/**
 * GY1: the template data of parser/templates/zz-fast5x/gy1.json ("You may play lands from your graveyard.", CR 305.1, 305.2, 305.9, 116.2a, 404.1), its
 * evidence for `stable` (design 6.9: every card of the local index that prints the sentence, reviewed) and the cards it makes full.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import gy1 from '../../../src/parser/templates/zz-fast5x/gy1.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import { act, find, scenario } from '../../m5/helpers';
import review from '../../m5/golden/cards/fast5x-gy1-review.json';

const GY1 = gy1 as Template[];
const OPTS = defaultParseOptions();
const LANDS = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'] }, from: 'graveyard' };

const exampleCard = (text: string): OracleCard => ({
  name: 'Example Subject', layout: 'normal', type_line: 'Creature — Mole', oracle_text: text, mana_cost: '{1}', colors: [], keywords: [], power: '2', toughness: '2',
} as unknown as OracleCard);
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('GY1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/gy1.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/gy1.json');
    expect(files.indexOf('zz-fast5x/gy1.json')).toBe(files.indexOf('zz-fast5x/e9.json') + 1);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has two examples and two counter-examples, consumes "may", and is of version 8', () => {
    for (const t of GY1) {
      expect(t.id).toMatch(/^sta\.gy1\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
      expect(t.consumes).toContain('may');
      expect(t.since).toBe(8);
    }
  });
  it('design 6.9: stable with its evidence: every card of the local index that prints the sentence and has no other blocker, reviewed by hand', () => {
    // the cards of the local index that print the sentence (npm run cards -- snapshot, 2026-10-15): these six play exactly as written; Conduit of Worlds,
    // Szarel, Genesis Shepherd, Glacierwood Siege and Walk-In Closet // Forgotten Cellar have another sentence that is not automated (they stay partial or manual)
    expect(GY1.map((t) => t.status)).toEqual(['stable']);
    const cards = (review as { card: string; verified: string }[]).filter((g) => g.verified.includes('(sta.gy1.graveyard.lands)')).map((g) => g.card).sort();
    expect(cards).toEqual(['Ancient Greenwarden', 'Crucible of Worlds', 'Icetill Explorer', 'Mole Man, Moloid Master', 'Perennial Behemoth', 'Ramunap Excavator']);
  });
});

describe('GY1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of GY1) {
    it(`${t.id} (${t.cr.join(', ')})`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('the sentence lowers to exactly the one permission form the engine honors', () => {
    const a = parsed('You may play lands from your graveyard.').abilities[0] as unknown as { kind: string; effects: unknown[] };
    expect(a.kind).toBe('static');
    expect(a.effects).toEqual([LANDS]);
  });
  // C10 (zz-cloud/c10.json) automates "You may cast creature spells from your graveyard." and "You may play lands and cast spells from your graveyard."
  // std-rk's "historic" noun phrase parses "historic lands" (an `anyOf` filter the engine's graveyard land permission does not honor), so that sentence is
  // held back by the capability walker, not the parser: the card's compiled level is what must stay below full
  it('the other "from your graveyard" permissions stay manual (fail closed)', () => {
    for (const text of ['Each player may play lands from their graveyard.', 'Each player may cast creature spells from their graveyard.', 'You may play historic lands from your graveyard.']) {
      expect(compileCard(exampleCard(text)).automation.level, text).not.toBe('full');
    }
    for (const text of ['Each player may play lands from their graveyard.', 'Each player may cast creature spells from their graveyard.']) {
      expect(fullyAutomated(parsed(text)), text).toBe(false);
    }
  });
});

describe('GY1: the real cards', () => {
  it('the cards whose blocker was this sentence compile full; the ones with another blocker do not', () => {
    for (const name of ['Crucible of Worlds', 'Ramunap Excavator', 'Perennial Behemoth', 'Icetill Explorer', 'Mole Man, Moloid Master', 'Ancient Greenwarden']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
    for (const name of ['Conduit of Worlds', 'Szarel, Genesis Shepherd']) expect(compileCard(getCard(name)).automation.level, name).not.toBe('full');
    // cloud r3-mech: Glacierwood Siege's other sentences (the Siege's choice and its Temur ability, CR 614.12a, 607.2d) are automated since then
    expect(compileCard(getCard('Glacierwood Siege')).automation.level).toBe('full');
  });
  it('Crucible of Worlds (CR 305.1, 305.2, 116.2a): a land in your graveyard is played as the land of the turn', () => {
    let s = scenario(['Crucible of Worlds', 'Forest', 'Mountain'], { p1: { battlefield: ['Crucible of Worlds'], graveyard: ['Forest', 'Mountain'] } });
    const forest = find(s, 'Forest', 'graveyard', 'p1');
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => a.label).sort()).toEqual(['Play Forest from graveyard', 'Play Mountain from graveyard']);
    s = act(s, { type: 'playLand', player: 'p1', card: forest });
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Forest')).toBe(true);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.2');
  });
  it('Icetill Explorer (CR 305.2): with its additional land play, two lands from the graveyard in one turn, and each one is a landfall (mills a card)', () => {
    let s = scenario(['Icetill Explorer', 'Forest', 'Mountain'], { p1: { battlefield: ['Icetill Explorer'], graveyard: ['Forest', 'Mountain'] } });
    const library = s.zones.library.p1!.length;
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
    while (s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending!.player });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'graveyard', 'p1') });
    while (s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(2);
    expect(s.zones.library.p1!.length).toBe(library - 2);
  });
});
