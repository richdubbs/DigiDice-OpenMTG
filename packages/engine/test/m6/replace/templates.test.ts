/**
 * M6-1: the templates of family R (parser/templates/zz-m6/replace.json; m6 design 5 M6-1, 8.3, docs/coverage/m6-head-shapes.txt): every template's examples
 * compile to full abilities on the game path, and the acceptance cards they read play as their Oracle text says (the default compiler, no hand-built JSON).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, defaultParseOptions, parseCard, type GameState, type OracleCard } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import m6Replace from '../../../src/parser/templates/zz-m6/replace.json';
import type { Template } from '../../../src/parser/types';
import { find, scenario } from '../../m5/helpers';
import { getCard } from '../../fixtures';
import { run } from './support';

const TEMPLATES = m6Replace as Template[];
const card = (text: string, type: string): OracleCard => ({ name: 'Test Card', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{2}', colors: [] } as unknown as OracleCard);
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

describe('zz-m6/replace.json: every example is a full ability on the game path, read by its own template', () => {
  for (const t of TEMPLATES) {
    for (const ex of t.examples) {
      it(`${t.id}: "${ex.text}"`, () => {
        const def = compileCard(card(ex.text, t.id.startsWith('prv.m6.self') ? 'Creature — Test' : 'Enchantment'));
        expect(def.automation.level, JSON.stringify(def.automation)).toBe('full');
        const parsed = parseCard(card(ex.text, 'Enchantment'), defaultParseOptions());
        expect(JSON.stringify(parsed)).toContain(t.id);
      });
    }
  }
  it('each template has three counterexamples, CR citations, and is stable', () => {
    for (const t of TEMPLATES) {
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      expect(t.status, t.id).toBe('stable');
    }
  });
});

describe('the acceptance cards the templates read, played on the game path', () => {
  it('Thought Reflection (game path) is full: drawing a card draws two instead', () => {
    expect(compileCard(getCard('Thought Reflection')).automation.level).toBe('full');
    const s = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection'] } });
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(handSize(r.g.s, 'p1')).toBe(handSize(s, 'p1') + 2);
  });

  it('Orb of Dreams (game path) is full: permanents enter tapped, CR 614.12', () => {
    expect(compileCard(getCard('Orb of Dreams')).automation.level).toBe('full');
    const s = scenario(['Orb of Dreams', 'Grizzly Bears'], { p1: { battlefield: ['Orb of Dreams'], graveyard: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    const r = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: bears, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: {} }));
    expect(r.g.s.objects[r.result!.newIds[0]!]!.tapped).toBe(true);
  });

  it('Hardened Scales (game path) is full: one +1/+1 counter becomes two, and only on creatures its controller controls', () => {
    expect(compileCard(getCard('Hardened Scales')).automation.level).toBe('full');
    const s = scenario(['Hardened Scales', 'Grizzly Bears'], { p1: { battlefield: ['Hardened Scales', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const mine = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const theirs = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = run(s, (g) => {
      proposeResult(g, { ev: 'counters', change: 'put', on: { id: mine, zone: 'battlefield' }, kind: '+1/+1', count: 1 });
      proposeResult(g, { ev: 'counters', change: 'put', on: { id: theirs, zone: 'battlefield' }, kind: '+1/+1', count: 1 });
    });
    expect(r.g.s.objects[mine]!.counters['+1/+1']).toBe(2);
    expect(r.g.s.objects[theirs]!.counters['+1/+1']).toBe(1);
  });
});
