import { describe, expect, it } from 'vitest';
import {
  compileCard, enumerateAbilities, getChars, parseManaAbilityLine, type OracleCard,
} from '../../src/index';
import { compiledDef, getCard } from '../fixtures';
import { castAuto, find, passBoth, scenario } from './scenario';

const keysOf = (s: ReturnType<typeof scenario>, name: string, zone: 'battlefield' | 'hand'): string[] => {
  const o = s.objects[find(s, name, zone)]!;
  return enumerateAbilities(s, o).map((a) => a.key);
};

describe('characteristics (CR 109.3)', () => {
  it('CR 202.2, 205: an ordinary card has the characteristics of its face', () => {
    const s = scenario(['Llanowar Elves'], { p1: { hand: ['Llanowar Elves'] } });
    const c = getChars(s, find(s, 'Llanowar Elves', 'hand'));
    expect(c).toMatchObject({ name: 'Llanowar Elves', colors: ['G'], types: ['Creature'], subtypes: ['Elf', 'Druid'], power: '1', toughness: '1', manaValue: 1 });
  });

  it('CR 709.4: a split card outside the stack has both halves combined (names, cost, colors, mana value)', () => {
    const s = scenario(['Fire // Ice'], { p1: { hand: ['Fire // Ice'] } });
    const c = getChars(s, find(s, 'Fire // Ice', 'hand'));
    expect(c.names).toEqual(['Fire', 'Ice']);
    expect(c.combined).toBe(true);
    expect(c.colors).toEqual(['U', 'R'].sort((a, b) => 'WUBRG'.indexOf(a) - 'WUBRG'.indexOf(b)));
    expect(c.manaValue).toBe(4);
  });

  it('CR 709.3b: on the stack only the half being cast exists', () => {
    let s = scenario(['Fire // Ice', 'Mountain', 'Mountain'], { p1: { hand: ['Fire // Ice'], battlefield: ['Mountain', 'Mountain'] } });
    s = castAuto(s, 'Fire // Ice', { face: 0 });
    const spell = s.objects[s.zones.stack[0]!]!;
    const c = getChars(s, spell.id);
    expect(c).toMatchObject({ name: 'Fire', colors: ['R'], manaValue: 2, combined: false });
    expect(c.names).toEqual(['Fire']);
  });

  it('CR 715.4: an adventurer card has only its normal characteristics outside the stack; CR 715.3b: only the Adventure on the stack', () => {
    let s = scenario(['Bonecrusher Giant // Stomp', 'Mountain', 'Mountain'], { p1: { hand: ['Bonecrusher Giant // Stomp'], battlefield: ['Mountain', 'Mountain'] } });
    const inHand = getChars(s, find(s, 'Bonecrusher Giant // Stomp', 'hand'));
    expect(inHand).toMatchObject({ name: 'Bonecrusher Giant', types: ['Creature'], power: '4', manaValue: 3 });
    s = castAuto(s, 'Bonecrusher Giant // Stomp', { face: 1 });
    expect(getChars(s, s.zones.stack[0]!)).toMatchObject({ name: 'Stomp', types: ['Instant'], manaValue: 2 });
  });

  it('CR 712.8a: a double-faced card outside the battlefield and stack has only its front face', () => {
    const s = scenario(['Agadeem\'s Awakening // Agadeem, the Undercrypt'], { p1: { hand: ['Agadeem\'s Awakening // Agadeem, the Undercrypt'] } });
    expect(getChars(s, find(s, 'Agadeem\'s Awakening // Agadeem, the Undercrypt', 'hand'))).toMatchObject({ name: 'Agadeem\'s Awakening', types: ['Sorcery'] });
  });

  it('CR 712.8f: a modal double-faced permanent has the characteristics of the face that is up', () => {
    const name = 'Agadeem\'s Awakening // Agadeem, the Undercrypt';
    const s = scenario([name], { p1: { battlefield: [{ name, face: 1 }] } });
    expect(getChars(s, find(s, name, 'battlefield'))).toMatchObject({ name: 'Agadeem, the Undercrypt', types: ['Land'] });
  });

  it('CR 710.2: a flip card has only its normal characteristics until the permanent is flipped', () => {
    const name = 'Akki Lavarunner // Tok-Tok, Volcano Born';
    const s = scenario([name], { p1: { battlefield: [name] } });
    expect(getChars(s, find(s, name, 'battlefield')).name).toBe('Akki Lavarunner');
    s.objects[find(s, name, 'battlefield')]!.flipped = true;
    const flipped = getChars(s, find(s, name, 'battlefield'));
    expect(flipped.name).toBe('Tok-Tok, Volcano Born');
    expect(flipped.colors).toEqual(['R']); // CR 710.1c: color and mana cost don't change
    expect(flipped.manaValue).toBe(4);
  });

  it('CR 708.2a: a face-down permanent is a 2/2 colorless nameless creature with no abilities', () => {
    const s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Llanowar Elves'] } });
    const id = find(s, 'Llanowar Elves', 'battlefield');
    s.objects[id]!.faceDown = true;
    expect(getChars(s, id)).toMatchObject({ name: '', colors: [], types: ['Creature'], subtypes: [], power: '2', toughness: '2', abilities: [], manaCost: null });
  });

  it('CR 204: Dryad Arbor is a green Land Creature - Forest Dryad (color indicator)', () => {
    const s = scenario(['Dryad Arbor'], { p1: { battlefield: ['Dryad Arbor'] } });
    expect(getChars(s, find(s, 'Dryad Arbor', 'battlefield'))).toMatchObject({ colors: ['G'], types: ['Land', 'Creature'], subtypes: ['Forest', 'Dryad'], manaCost: null });
  });
});

describe('ability enumeration with stable keys', () => {
  it('CR 305.6: a basic land type gives the intrinsic mana ability even without rules text', () => {
    const s = scenario(['Forest', 'Dryad Arbor', 'Taiga'], { p1: { battlefield: ['Forest', 'Dryad Arbor', 'Taiga'] } });
    expect(keysOf(s, 'Forest', 'battlefield')).toEqual(['r:basic:G']);
    expect(keysOf(s, 'Dryad Arbor', 'battlefield')).toEqual(['r:basic:G']);
    expect(keysOf(s, 'Taiga', 'battlefield')).toEqual(['r:basic:R', 'r:basic:G']); // Mountain Forest
  });

  it('printed abilities are keyed p:<face>:<index>; reminder text is ignored (CR 605.1a mana abilities)', () => {
    const s = scenario(['Llanowar Elves', 'Birds of Paradise', 'Sol Ring', 'Wastes'], { p1: { battlefield: ['Llanowar Elves', 'Birds of Paradise', 'Sol Ring', 'Wastes'] } });
    expect(keysOf(s, 'Llanowar Elves', 'battlefield')).toEqual(['p:0:0']);
    expect(keysOf(s, 'Sol Ring', 'battlefield')).toEqual(['p:0:0']);
    expect(keysOf(s, 'Wastes', 'battlefield')).toEqual(['p:0:0']);
    // Birds: since the milestone 5 compile pipeline (WP18) the abilities are in printed line order: Flying, then the mana ability.
    const birds = s.objects[find(s, 'Birds of Paradise', 'battlefield')]!;
    const infos = enumerateAbilities(s, birds);
    expect(infos.map((i) => [i.key, i.def.kind])).toEqual([['p:0:0', 'keyword'], ['p:0:1', 'activated']]);
  });

  it('every face of a double-faced card numbers its own abilities', () => {
    const def = compiledDef('Agadeem\'s Awakening // Agadeem, the Undercrypt');
    expect(def.faces).toHaveLength(2);
  });
});

describe('the local mana-ability recognizer (until the milestone 5 parser)', () => {
  const ok = (line: string, name = 'Thing') => parseManaAbilityLine(line, name);
  it('recognizes the simple Oracle wordings', () => {
    expect(ok('{T}: Add {C}.')).toMatchObject({ isMana: true, cost: { tap: true } });
    expect(ok('{T}: Add {C}{C}.')!.effect.steps[0]).toEqual({ op: 'addMana', who: { ref: 'you' }, units: [['C'], ['C']] });
    expect(ok('{T}: Add {R} or {G}.')!.effect.steps[0]).toEqual({ op: 'addMana', who: { ref: 'you' }, units: [['R', 'G']] });
    expect(ok('{T}: Add {W}, {U}, or {B}.')!.effect.steps[0]).toEqual({ op: 'addMana', who: { ref: 'you' }, units: [['W', 'U', 'B']] });
    expect((ok('{T}: Add one mana of any color.')!.effect.steps[0] as unknown as { units: string[][] }).units[0]).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(ok('{T}, Sacrifice this artifact: Add one mana of any color.')!.cost).toEqual({ tap: true, other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] });
  });
  it('does not recognize anything it would get wrong', () => {
    expect(ok('{T}: Add {C}{C}. This land deals 2 damage to you.')).toBeNull(); // extra sentence
    expect(ok('{T}: Add one mana of any color. Spend this mana only to cast a legendary spell.')).toBeNull();
    expect(ok('{T}: Add three mana of any one color.')).toBeNull();
    expect(ok('{1}, {T}: Add {G}{G}.')).toBeNull(); // mana cost in a mana ability
    expect(ok('{T}: Add {X}.')).toBeNull();
    expect(ok('{T}: You gain 1 life.')).toBeNull();
  });
  it('the basic compiler keeps unknown lines as ONE manual ability and reports them', () => {
    // Milestone 4 compiles Deathtouch, so Ambush Viper (Flash, Deathtouch) is now fully automated.
    const viper = compiledDef('Ambush Viper');
    expect(viper.faces[0]!.abilities.map((a) => a.kind)).toEqual(['keyword', 'keyword']);
    expect(viper.automation).toMatchObject({ level: 'full', unsupported: [] });
    // FAST5X E28: persist is automated (CR 702.79a), so Kitchen Finks plays fully: its enters trigger (CR 603.6a) and the keyword.
    const persist = compiledDef('Kitchen Finks');
    expect(persist.faces[0]!.abilities.map((a) => a.kind)).toEqual(['triggered', 'keyword']);
    expect(persist.automation.level).toBe('full');
    // An unimplemented keyword stays a manual ability: Aven Warhawk's flying is automated, its amplify (CR 702.38) is manual with the capability it needs
    // (std-ry8: Hexbane Tortoise, the example before, is full now that enlist is implemented).
    const amplify = compiledDef('Aven Warhawk');
    expect(amplify.faces[0]!.abilities.map((a) => a.kind)).toEqual(['manual', 'keyword']);
    expect(amplify.automation.level).toBe('partial');
    const raw = getCard('Aven Warhawk');
    const def = compileCard(raw);
    expect(def.faces[0]!.abilities[0]).toMatchObject({ kind: 'manual', reason: expect.stringContaining('keyword:amplify') });
    const elves = compiledDef('Llanowar Elves');
    expect(elves.automation).toMatchObject({ level: 'full', unsupported: [] });
  });
  it('Lotus Petal parses its sacrifice cost, Mind Stone keeps the unparsed draw ability manual', () => {
    expect(compiledDef('Lotus Petal').faces[0]!.abilities[0]).toMatchObject({ kind: 'activated', isMana: true, cost: { tap: true } });
    // WP18: the compile pipeline understands Mind Stone's draw ability too ({1}, {T}, sacrifice: draw a card, CR 602, 121.1)
    expect(compiledDef('Mind Stone').faces[0]!.abilities.map((a) => a.kind)).toEqual(['activated', 'activated']);
    expect(compiledDef('Mind Stone').automation.level).toBe('full');
  });
});

// Silence unused imports in some configurations.
void passBoth;
void ({} as OracleCard);
