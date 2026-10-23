/**
 * WP2: well-known cards beyond the 53 worked examples. The JSON is what the parser should produce for them (design 2.3, 13); the Oracle text is the
 * printed wording. Each ability must pass the render gate: this is the false-reject probe (design 6.12) for common shapes. A failure here is either a
 * renderer gap or a wording the equivalence table should know.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CostDef, EffectStep, KeywordAbilityDef, ObjectFilter, StaticEffect, TargetSpec } from '../../../src/types/ability';
import { renderGate } from '../../../src/index';

const you = { ref: 'you' } as const;
const t = (id: string) => ({ ref: 'target', id }) as const;
const kw = (keyword: string, extra: Partial<KeywordAbilityDef> = {}): AbilityDef => ({ kind: 'keyword', text: '', keyword, ...extra });
const obj = (id: string, filter: ObjectFilter = {}, extra: Partial<TargetSpec> = {}): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: '', filter, ...extra });
const spell = (steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps } });
const trig = (on: Extract<AbilityDef, { kind: 'triggered' }>['trigger']['on'], steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => ({ kind: 'triggered', text: '', trigger: { on }, effect: { targets, steps } });
const act = (cost: CostDef, steps: EffectStep[], targets: TargetSpec[] = [], extra: Partial<Extract<AbilityDef, { kind: 'activated' }>> = {}): AbilityDef => ({ kind: 'activated', text: '', cost, effect: { targets, steps }, ...extra });
const stat = (effects: StaticEffect[]): AbilityDef => ({ kind: 'static', text: '', effects });
const mana = (...syms: ({ g: number } | { c: 'W' | 'U' | 'B' | 'R' | 'G' })[]) => syms.map((s) => ('g' in s ? ({ kind: 'generic', amount: s.g } as const) : ({ kind: 'colored', color: s.c } as const)));
const enters = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' } as const;
const searchBasic = (): EffectStep[] => [
  { op: 'search', who: you, zone: 'library', filter: { zone: 'library', types: ['Land'], supertypes: ['Basic'] }, max: 1, as: 'l' },
  { op: 'move', what: { ref: 'bound', name: 'l' }, to: { zone: 'battlefield', controller: you, tapped: true } },
  { op: 'shuffle', who: you },
];

/** `oracle` is the invented or rules-defined wording of a shape; `null` names a printed card whose wording is read from the local Oracle index (design 6.10). */
type Case = [name: string, selfTypes: string[], ability: AbilityDef, oracle: string | null];

const cases: Case[] = [
  ['Lightning Helix', ['Instant'], spell([{ op: 'damage', source: { ref: 'self' }, to: t('a'), amount: 3 }, { op: 'gainLife', who: you, amount: 3 }], [{ id: 'a', kind: 'anyTarget', min: 1, max: 1, text: '' }]), null],
  ['Terror', ['Instant'], spell([{ op: 'destroy', what: t('a'), regeneration: 'cant' }], [obj('a', { types: ['Creature'], notTypes: ['Artifact'], notColors: ['B'] })]), null],
  ['Divination', ['Sorcery'], spell([{ op: 'draw', who: you, count: 2 }]), null],
  ['Rampant Growth', ['Sorcery'], spell(searchBasic()), null],
  ['Eternal Witness', ['Creature'], trig([enters], [{ op: 'may', who: you, do: [{ op: 'move', what: t('a'), to: { zone: 'hand' } }] }], [obj('a', { zone: 'graveyard', owner: 'you' })]), null],
  ['Mulldrifter', ['Creature'], trig([enters], [{ op: 'draw', who: you, count: 2 }]), null],
  ['Mulldrifter evoke', ['Creature'], kw('evoke', { cost: { mana: mana({ g: 2 }, { c: 'U' }) } }), null],
  ['Sol Ring', ['Artifact'], act({ tap: true }, [{ op: 'addMana', who: you, units: [['C'], ['C']] }], [], { isMana: true }), null],
  ['Birds of Paradise', ['Creature'], act({ tap: true }, [{ op: 'addMana', who: you, units: [['W', 'U', 'B', 'R', 'G']] }], [], { isMana: true }), null],
  ['Prodigal Pyromancer', ['Creature'], act({ tap: true }, [{ op: 'damage', source: { ref: 'self' }, to: t('a'), amount: 1 }], [{ id: 'a', kind: 'anyTarget', min: 1, max: 1, text: '' }]), null],
  ['Shivan Dragon', ['Creature'], act({ mana: mana({ c: 'R' }) }, [{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 0 }] }], duration: { d: 'endOfTurn' } }]), null],
  ['Dark Confidant', ['Creature'], trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [
    { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, as: 'c' },
    { op: 'move', what: { ref: 'bound', name: 'c' }, to: { zone: 'hand' } },
    { op: 'loseLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'bound', name: 'c' } } },
  ]), null],
  ['Phyrexian Arena', ['Enchantment'], trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'draw', who: you, count: 1 }, { op: 'loseLife', who: you, amount: 1 }]), null],
  ['Soul Warden', ['Creature'], trig([{ ev: 'zoneChange', subject: { types: ['Creature'], other: true }, to: 'battlefield' }], [{ op: 'gainLife', who: you, amount: 1 }]), null],
  ['Control Magic', ['Enchantment', 'Aura'], stat([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 2, controller: you }] }]), null],
  ['Pacifism', ['Enchantment', 'Aura'], stat([{ s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'attack' }, { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'block' }]), null],
  ['Pacifism enchant', ['Enchantment', 'Aura'], kw('enchant', { filter: { types: ['Creature'] } }), null],
  ['Wall of Omens', ['Creature'], trig([enters], [{ op: 'draw', who: you, count: 1 }]), null],
  ['Kitchen Finks', ['Creature'], trig([enters], [{ op: 'gainLife', who: you, amount: 2 }]), null],
  ['Pyroclasm', ['Sorcery'], spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', filter: { types: ['Creature'] } }, amount: 2 }]), null],
  ['Disenchant', ['Instant'], spell([{ op: 'destroy', what: t('a') }], [obj('a', { types: ['Artifact', 'Enchantment'] })]), null],
  ['Remove Soul', ['Instant'], spell([{ op: 'counter', what: t('a') }], [{ id: 'a', kind: 'spell', min: 1, max: 1, text: '', filter: { types: ['Creature'] } }]), null],
  ['Negate', ['Instant'], spell([{ op: 'counter', what: t('a') }], [{ id: 'a', kind: 'spell', min: 1, max: 1, text: '', filter: { notTypes: ['Creature'] } }]), null],
  ['Mind Rot', ['Sorcery'], spell([{ op: 'discard', who: t('p'), count: 2 }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), null],
  ['Hymn to Tourach', ['Sorcery'], spell([{ op: 'discard', who: t('p'), count: 2, mode: 'random' }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), null],
  ['Unsummon', ['Instant'], spell([{ op: 'move', what: t('a'), to: { zone: 'hand' } }], [obj('a', { types: ['Creature'] })]), null],
  ['Vindicate', ['Sorcery'], spell([{ op: 'destroy', what: t('a') }], [obj('a')]), null],
  ['Sakura-Tribe Elder', ['Creature'], act({ other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, searchBasic()), null],
  ['Skullclamp bonus', ['Artifact', 'Equipment'], stat([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 1, toughness: -1 }] }]), null],
  ['Skullclamp trigger', ['Artifact', 'Equipment'], trig([{ ev: 'zoneChange', subject: { attachedToSource: true }, from: 'battlefield', to: 'graveyard' }], [{ op: 'draw', who: you, count: 2 }]), null],
  ['Kor Skyfisher', ['Creature'], trig([enters], [{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { controller: 'you' } }, min: 1, max: 1, as: 'p' }, { op: 'move', what: { ref: 'bound', name: 'p' }, to: { zone: 'hand' } }]), null],
  ['Man-o\'-War', ['Creature'], trig([enters], [{ op: 'move', what: t('a'), to: { zone: 'hand' } }], [obj('a', { types: ['Creature'] })]), null],
  ['Treasure', ['Artifact'], act({ tap: true, other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, [{ op: 'addMana', who: you, units: [['W', 'U', 'B', 'R', 'G']] }], [], { isMana: true }), '{T}, Sacrifice this artifact: Add one mana of any color.'],
  ['Armageddon', ['Sorcery'], spell([{ op: 'destroy', what: { ref: 'each', filter: { types: ['Land'] } } }]), null],
  ['Time Walk', ['Sorcery'], spell([{ op: 'extraTurn', who: you, count: 1 }]), null],
  ['Ancestral Recall', ['Instant'], spell([{ op: 'draw', who: t('p'), count: 3 }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), null],
  ['Black Lotus', ['Artifact'], act({ tap: true, other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, [{ op: 'addMana', who: you, dynamic: { kind: 'anyOneColor', count: 3 } }], [], { isMana: true }), null],
  ['Braingeyser', ['Sorcery'], spell([{ op: 'draw', who: t('p'), count: { q: 'X' } }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), null],
  ['Demonic Tutor', ['Sorcery'], spell([
    { op: 'search', who: you, zone: 'library', filter: { zone: 'library' }, max: 1, as: 'c' },
    { op: 'move', what: { ref: 'bound', name: 'c' }, to: { zone: 'hand' } },
    { op: 'shuffle', who: you },
  ]), null],
  ['Mana Tithe', ['Instant'], spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('a') }, cost: { mana: mana({ g: 1 }) }, else: [{ op: 'counter', what: t('a') }] }], [{ id: 'a', kind: 'spell', min: 1, max: 1, text: '' }]), null],
  ['Lava Axe', ['Sorcery'], spell([{ op: 'damage', source: { ref: 'self' }, to: t('a'), amount: 5 }], [{ id: 'a', kind: 'objectOrPlayer', min: 1, max: 1, text: '', filter: { types: ['Planeswalker'] } }]), null],
  ['Fetchland', ['Land'], act({ tap: true, other: [{ kind: 'payLife', amount: 1 }, { kind: 'sacrifice', filter: {}, count: 1, self: true }] }, [
    { op: 'search', who: you, zone: 'library', filter: { zone: 'library', subtypes: ['Forest', 'Plains'] }, max: 1, as: 'l' },
    { op: 'move', what: { ref: 'bound', name: 'l' }, to: { zone: 'battlefield', controller: you } },
    { op: 'shuffle', who: you },
  ]), '{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle.'],
  ['Wrath variant with exile', ['Sorcery'], spell([{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'] } }, to: { zone: 'exile' } }]), 'Exile all creatures.'],
  ['Duress-like discard', ['Sorcery'], spell([{ op: 'discard', who: t('p'), count: 1, filter: { notTypes: ['Creature', 'Land'] } }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), 'Target player discards a noncreature, nonland card.'],
  ['Raise Dead', ['Sorcery'], spell([{ op: 'move', what: t('a'), to: { zone: 'hand' } }], [obj('a', { zone: 'graveyard', owner: 'you', types: ['Creature'] })]), null],
  ['Reanimate-ish', ['Sorcery'], spell([{ op: 'move', what: t('a'), to: { zone: 'battlefield', controller: you } }], [obj('a', { zone: 'graveyard', types: ['Creature'] })]), 'Put target creature card from a graveyard onto the battlefield under your control.'],
  ['Counterspell with a bonus', ['Instant'], spell([{ op: 'counter', what: t('a') }, { op: 'draw', who: you, count: 1 }], [{ id: 'a', kind: 'spell', min: 1, max: 1, text: '' }]), 'Counter target spell. Draw a card.'],
  ['Fog', ['Instant'], spell([{ op: 'effect', effects: [{ s: 'replace', replaces: { ev: 'damage', combat: true }, body: { b: 'prevent', amount: 'all' } }], duration: { d: 'endOfTurn' } }]), null],
  ['Draw step trigger', ['Artifact'], trig([{ ev: 'step', step: 'draw' }], [{ op: 'draw', who: { ref: 'active' }, count: 1 }]), 'At the beginning of each draw step, the active player draws a card.'],
  ['Liliana of the Veil +1', ['Planeswalker'], act({ loyalty: 1 }, [{ op: 'discard', who: { ref: 'each', who: 'player' }, count: 1 }], [], { isLoyalty: true }), null],
  ['Liliana of the Veil -2', ['Planeswalker'], act({ loyalty: -2 }, [{ op: 'sacrificeChoice', who: t('p'), filter: { types: ['Creature'] }, count: 1 }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }], { isLoyalty: true }), null],
  ['Merfolk lord', ['Creature'], stat([{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Merfolk'], controller: 'you', other: true } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }]), 'Other Merfolk you control get +1/+1.'],
  ['Goblin haste', ['Enchantment'], stat([{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Goblin'], controller: 'you' } }, mods: [{ layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'haste' }] }] }]), 'Goblins you control have haste.'],
  ['Mana lord', ['Enchantment'], stat([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [act({ tap: true }, [{ op: 'addMana', who: you, units: [['G']] }], [], { isMana: true })] }] }]), 'Creatures you control have "{T}: Add {G}."'],
  ['Overrun', ['Sorcery'], spell([{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 3, toughness: 3 }, { layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'trample' }] }] }], duration: { d: 'endOfTurn' } }]), null],
  ['Cant be blocked', ['Creature'], stat([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked' }]), "This creature can't be blocked."],
  ['Pump on attack', ['Creature'], trig([{ ev: 'attacks', attacker: { self: true } }], [{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }], duration: { d: 'endOfTurn' } }]), 'Whenever this creature attacks, it gets +1/+1 until end of turn.'],
  ['Spirit for the controller', ['Instant'], spell([{ op: 'move', what: t('a'), to: { zone: 'exile' } }, { op: 'createToken', who: { ref: 'controllerOf', object: t('a') }, count: 1, token: { name: 'Spirit', types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1 } }], [obj('a', { types: ['Creature'] })]), 'Exile target creature. Its controller creates a 1/1 colorless Spirit creature token.'],
  ['Looting', ['Instant'], spell([{ op: 'draw', who: you, count: 2 }, { op: 'discard', who: you, count: 2 }]), 'Draw two cards, then discard two cards.'],
  ['Flying removal', ['Instant'], spell([{ op: 'destroy', what: t('a') }], [obj('a', { types: ['Creature'], keyword: 'flying' })]), 'Destroy target creature with flying.'],
  ['Artifact discount', ['Creature'], stat([{ s: 'costMod', applies: { spells: { zone: 'stack', types: ['Artifact'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } }]), 'Artifact spells you cast cost {1} less to cast.'],
  ['Saga chapter', ['Enchantment', 'Saga'], { kind: 'chapter', text: '', chapters: [1], effect: { targets: [obj('a', { types: ['Creature'] })], steps: [{ op: 'destroy', what: t('a') }] } }, 'I -- Destroy target creature.'],
  ['Rakdos Charm-like modal', ['Instant'], { kind: 'spell', text: '', effect: { targets: [], modes: { min: 1, max: 1, options: [
    { text: '', program: { targets: [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }], steps: [{ op: 'loseLife', who: t('p'), amount: 2 }] } },
    { text: '', program: { targets: [], steps: [{ op: 'destroy', what: { ref: 'each', filter: { types: ['Artifact'] } } }] } },
  ] }, steps: [] } }, 'Choose one -- • Target player loses 2 life. • Destroy all artifacts.'],
  ['Hexproof from', ['Creature'], kw('hexproof', { quality: 'color:B' }), 'Hexproof from black'],
  ['Protection', ['Creature'], kw('protection', { quality: 'color:R' }), 'Protection from red'],
  ['Cycling', ['Instant'], kw('cycling', { cost: { mana: mana({ g: 2 }) } }), 'Cycling {2}'],
  ['Flashback with life', ['Sorcery'], kw('flashback', { cost: { mana: mana({ g: 1 }, { c: 'B' }), other: [{ kind: 'payLife', amount: 3 }] } }), 'Flashback--{1}{B}, Pay 3 life.'],
  ['Draw and lose', ['Sorcery'], spell([{ op: 'draw', who: t('p'), count: 1 }, { op: 'loseLife', who: t('p'), amount: 1 }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), 'Target player draws a card and loses 1 life.'],
  ['Each opponent loses per creature', ['Sorcery'], spell([{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }]), 'Each opponent loses 1 life for each creature you control.'],
  ['Life equal to creatures they control', ['Sorcery'], spell([{ op: 'loseLife', who: t('p'), amount: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: t('p') } } } }], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '' }]), 'Target player loses life equal to the number of creatures they control.'],
];

/** The printed card behind a case that has no committed wording (the case name is the card unless this says otherwise). */
const CARD: Record<string, string> = {
  'Mulldrifter evoke': 'Mulldrifter',
  'Pacifism enchant': 'Pacifism',
  'Skullclamp bonus': 'Skullclamp',
  'Skullclamp trigger': 'Skullclamp',
  'Liliana of the Veil +1': 'Liliana of the Veil',
  'Liliana of the Veil -2': 'Liliana of the Veil',
};

describe('CR 601-608: shapes of common abilities with invented wording pass the render gate', () => {
  it.each(cases.filter((c): c is [string, string[], AbilityDef, string] => c[3] !== null))('%s', (name, selfTypes, def, oracle) => {
    const ctx = { selfNames: [name], selfTypes };
    const r = renderGate(def, [oracle], ctx);
    expect(r.ok, `rendered: ${r.rendered}
expected: ${r.expected}
firstDiff: ${r.firstDiff}`).toBe(true);
  });
});

// The printed wording of real cards is read from the local Oracle index (git-ignored; set OPENMTG_CACHE_DIR to the cache of the main checkout when running
// from a worktree) and the tests are skipped without it: committed tests hold no verbatim card text (design 6.10, D26).
const cacheFile = join(process.env['OPENMTG_CACHE_DIR'] ?? join(process.cwd(), '.cache', 'scryfall'), 'cards.jsonl');

// QT: the index is read once per file, not once per card (70 reads of the whole index took about 10 s)
let indexLines: string[] | undefined;

function printedLines(card: string): string[] {
  const out: string[] = [];
  indexLines ??= readFileSync(cacheFile, 'utf8').split('\n');
  for (const l of indexLines) {
    if (!l.includes(`"name":"${card.replace(/"/g, '\\"')}"`)) continue;
    const c = JSON.parse(l) as { name: string; oracle_text?: string; card_faces?: { name: string; oracle_text?: string }[] };
    for (const f of c.card_faces ?? [c]) if (f.name === card && f.oracle_text) out.push(...f.oracle_text.split('\n'));
    if (c.name === card && out.length > 0) break;
  }
  return out;
}

describe.skipIf(!existsSync(cacheFile))('CR 601-608: the printed wording of well-known cards passes the render gate (local Oracle index)', () => {
  it.each(cases.filter((c) => c[3] === null))('%s', (name, selfTypes, def) => {
    const card = CARD[name] ?? name;
    const lines = printedLines(card).filter((l) => !(l.startsWith('(') && l.endsWith(')')));
    expect(lines.length, `${card} is not in the local index`).toBeGreaterThan(0);
    const ctx = { selfNames: [card, ...(card.includes(',') ? [card.split(',')[0]!] : [])], selfTypes };
    // the ability is some run of consecutive lines of the card (a card has several abilities)
    let best = '';
    for (let start = 0; start < lines.length; start++) {
      for (let k = 1; start + k <= lines.length; k++) {
        const r = renderGate(def, lines.slice(start, start + k), ctx);
        if (r.ok) return;
        if (k === 1 && best === '') best = `rendered: ${r.rendered}
expected: ${r.expected}`;
      }
    }
    expect.fail(`${card}: no run of its printed lines passes the gate
${best}`);
  });
});
