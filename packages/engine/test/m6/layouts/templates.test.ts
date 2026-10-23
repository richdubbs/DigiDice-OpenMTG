/**
 * M6-6 (m6 design 5 "M6-6", 8.3 family L): the templates of parser/templates/zz-m6/layouts.json and the layout lines read by the segmenter (the Prototype
 * keyword line, the Case lines), on fixture cards and synthetic wordings, through the game path (compileCard with the engine's capabilities).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, missingCapabilities, type AbilityDef, type CardDef, type OracleCard } from '../../../src/index';
import { getCard } from '../../fixtures';
import { Game } from '../../../src/core/game';
import { performObjectSbas } from '../../../src/core/sba-objects';
import { clone } from '../../../src/util/clone';
import { find, scenario } from '../../m3/scenario';
import { cast, resolveTop } from '../../m5/cr-examples/helpers';

const synthetic = (name: string, layout: string, typeLine: string, manaCost: string, lines: string[], pt?: [string, string]): CardDef =>
  compileCard({ name, layout, type_line: typeLine, mana_cost: manaCost, oracle_text: lines.join('\n'), colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const abilities = (def: CardDef): AbilityDef[] => def.faces.flatMap((f) => f.abilities);

describe('family L templates (zz-m6/layouts.json)', () => {
  it('"This creature enters prepared." is the enters replacement with `prepared` (CR 722.3a); Strife Scholar is full', () => {
    const def = compileCard(getCard('Strife Scholar // Awaken the Ages'));
    expect(abilities(def)[1]).toMatchObject({ kind: 'static', effects: [{ s: 'replace', body: { b: 'enters', prepared: true } }] });
    expect(def.automation.level).toBe('full');
  });

  it('"Whenever this creature attacks, it becomes prepared." (CR 722.3a); Encouraging Aviator is full', () => {
    const def = compileCard(getCard('Encouraging Aviator // Jump'));
    expect(abilities(def)[1]).toMatchObject({ kind: 'triggered', effect: { steps: [{ op: 'designateObject', designation: 'prepared' }] } });
    expect(def.automation.level).toBe('full');
  });

  it('"Target creature becomes unprepared." and "if this creature isn\'t prepared" (CR 722.3b)', () => {
    const un = synthetic('Test Unready', 'normal', 'Instant', '{U}', ['Target creature becomes unprepared.']);
    expect(abilities(un)[0]).toMatchObject({ kind: 'spell', effect: { steps: [{ op: 'designateObject', what: { ref: 'target', id: 't0' }, designation: 'unprepared' }] } });
    expect(un.automation.level).toBe('full');
    const upkeep = synthetic('Test Studious Wizard', 'normal', 'Creature — Human Wizard', '{1}{U}', ["At the beginning of your upkeep, if this creature isn't prepared, it becomes prepared."], ['2', '2']);
    expect(abilities(upkeep)[0]).toMatchObject({
      kind: 'triggered', interveningIf: { cond: 'not', of: { cond: 'matches', object: { ref: 'self' }, filter: { prepared: true } } },
      effect: { steps: [{ op: 'designateObject', what: { ref: 'self' }, designation: 'prepared' }] },
    });
    expect(missingCapabilities(abilities(upkeep)[0]!, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('"When this Class becomes level N, ..." (CR 716.2a) inside a class level', () => {
    const def = synthetic('Test Grove Class', 'class', 'Enchantment — Class', '{G}', ['(Gain the next level as a sorcery to add its ability.)', 'You have no maximum hand size.', '{1}{G}: Level 2', 'When this Class becomes level 2, draw a card.']);
    const level2 = abilities(def)[1] as Extract<AbilityDef, { kind: 'classLevel' }>;
    expect(level2.abilities[0]).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'becomes', what: 'classLevel', object: { self: true }, level: 2 }] } });
    expect(def.automation.level).toBe('full');
  });

  it('the Prototype line is the keyword with its cost (CR 702.160) and the face gets the inset frame (CR 718.2)', () => {
    const def = compileCard(getCard('Phyrexian Fleshgorger'));
    expect(abilities(def)[0]).toMatchObject({ kind: 'keyword', keyword: 'prototype', text: 'Prototype {1}{B}{B}' });
    expect(def.faces[0]!.prototype).toMatchObject({ power: '3', toughness: '3' });
  });
});

describe('CR 722.3c: a permanent that phases in prepared gets a new copy of its prepare spell', () => {
  it('phased out: the copy ceases to exist (704.5e); phased in: a new one is made by the next check', () => {
    let s = scenario(['Strife Scholar // Awaken the Ages', 'Mountain'], { p1: { hand: ['Strife Scholar // Awaken the Ages'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    s = resolveTop(cast(s, 'Strife Scholar // Awaken the Ages'));
    const id = find(s, 'Strife Scholar // Awaken the Ages', 'battlefield');
    const first = s.objects[id]!.preparedCopy!;
    const g = new Game(clone(s));
    g.s.objects[id]!.phasedOut = true;
    performObjectSbas(g);
    expect(g.s.objects[first]).toBeUndefined();
    expect(g.s.objects[id]!.preparedCopy).toBeUndefined();
    expect(g.s.objects[id]!.prepared).toBe(true); // it keeps the designation while phased out (CR 702.26d, 722.3c)
    g.s.objects[id]!.phasedOut = false;
    performObjectSbas(g);
    const second = g.s.objects[id]!.preparedCopy!;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(g.s.objects[second]).toMatchObject({ kind: 'spellCopy', zone: 'exile', preparedFor: id });
  });
});
