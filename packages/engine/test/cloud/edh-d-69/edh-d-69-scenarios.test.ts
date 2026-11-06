/**
 * edh-d-69 (Commander coordinator D, lane designations): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of
 * 2026-09-25 (fetched in the cloud session and checked with grep); the rulings were fetched from Scryfall on 2026-11-04.
 *
 *   CR 603.7, 603.7c, 508.1b, 725.1   "Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn." (Okoye, Mighty and Adored)
 *   CR 707.9b, 508.4, 701.54e         "Create a tapped and attacking token that's a copy of that card, except it's a 3/3 black Wraith with menace. ... exile that token unless ~ is your Ring-bearer." (Sauron, the Necromancer)
 *   CR 611.2a, 205.1b, 104.3e, 701.54c "... it becomes a Halfling Rogue with "Whenever ~ deals combat damage to a player, that player loses the game if the Ring has tempted you four or more times this game." (Frodo, Sauron's Bane)
 *   CR 118.12a, 701.21a               "Whenever ~ attacks, for each opponent, you create a 2/2 black Zombie unless that player sacrifices a creature of their choice." (Acererak the Archlich)
 *   CR 608.2c, 700.3, 701.20e         "Choose an opponent. They look at the top four cards of your library and separate them into a face-down pile and a face-up pile." (Sauron's Ransom)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';
import { tweak } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onBattlefield = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; options?: string[][]; attackers?: { attacker: ObjectId; defender: PlayerId }[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${(p as { player?: string }).player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attackers ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script, asked);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
const attackStep = (s: GameState): boolean => s.pending?.kind === 'declareAttackers' && s.pending.player === s.turn.activePlayer;

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [HUNTER, WRAITH_LORD, HALFLING, TEMPT, ZOMBIE_LORD, RANSOM, BEAR, ROGUE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const HUNTER = card('Test Monarch Hunter', 'Creature — Human Warrior', 'At the beginning of combat on your turn, put a +1/+1 counter on target creature. Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn.', { pt: ['2', '2'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 603.7, 603.7c, 508.1b, 725.1: "Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn."', () => {
  const play = (monarch: PlayerId | undefined, defender: PlayerId, changeTo?: PlayerId): { s: GameState; id: ObjectId } => {
    let s = mpScenario({ defs: [HUNTER, BEAR], zones: { p1: { battlefield: ['Test Monarch Hunter', 'Test Plain Bear'] } }, setup: (x) => { if (monarch) x.designations.monarch = monarch; } });
    const bear = onBattlefield(s, 'Test Plain Bear', 'p1')[0]!;
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets' || attackStep(x), 'the combat trigger');
    s = settle(answer(s, { kind: 'chooseTargets', targets: [obj(bear)] }));
    if (changeTo) s = tweak(s, (t) => { t.designations.monarch = changeTo; });
    s = passUntil(s, attackStep, 'the attack');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender }] }));
    s = settle(s);
    return { s, id: bear };
  };
  const keywords = (s: GameState, id: ObjectId): string[] => [...new Set(JSON.stringify(getChars(s, id).keywords ?? []).match(/double strike|trample/g) ?? [])];
  it('is automated with no manual part', () => expect(full(HUNTER)).toBe(true));
  it('the chosen creature attacks the monarch (p2): +1/+1 counter and double strike and trample until end of turn', () => {
    const { s, id } = play('p2', 'p2');
    expect(Number(getChars(s, id).power)).toBe(3);
    expect(keywords(s, id).sort()).toEqual(['double strike', 'trample']);
  });
  it('negative: it attacks a player who is not the monarch (p3, while p2 is): the counter stays, no keywords', () => {
    const { s, id } = play('p2', 'p3');
    expect(Number(getChars(s, id).power)).toBe(3);
    expect(keywords(s, id)).toEqual([]);
  });
  it('the monarch is judged as the attack is declared, not when the delayed trigger was made: p3 became the monarch meanwhile, so attacking p3 gives the keywords and attacking p2 (the old monarch) does not', () => {
    expect(keywords(play('p2', 'p3', 'p3').s, play('p2', 'p3', 'p3').id)).toEqual(['double strike', 'trample']);
    const old = play('p2', 'p2', 'p3');
    expect(keywords(old.s, old.id)).toEqual([]);
  });
  it('negative: nobody is the monarch: no keywords', () => {
    const { s, id } = play(undefined, 'p2');
    expect(keywords(s, id)).toEqual([]);
  });
});

const WRAITH_LORD = card('Test Wraith Lord', 'Legendary Creature — Wraith Noble', "Whenever ~ attacks, exile target creature card from your graveyard. Create a tapped and attacking token that's a copy of that card, except it's a 3/3 black Wraith with menace. At the beginning of the next end step, exile that token unless ~ is your Ring-bearer.", { pt: ['4', '4'] });
const DEAD = card('Test Dead Knight', 'Creature — Human Knight', 'Vigilance', { pt: ['1', '2'] });

describe('CR 707.9b, 508.4, 701.54e: the tapped and attacking Wraith copy, exiled at the end step unless the lord is your Ring-bearer', () => {
  const play = (bearer: boolean): GameState => {
    let s = mpScenario({ defs: [WRAITH_LORD, DEAD], zones: { p1: { battlefield: ['Test Wraith Lord'], graveyard: ['Test Dead Knight'] } }, setup: (x) => { if (bearer) { const id = x.zones.battlefield.find((o) => nameOf(x, o) === 'Test Wraith Lord')!; x.designations.ring = { ...(x.designations.ring ?? {}), p1: { tempted: 1, bearer: id } }; } } });
    const lord = onBattlefield(s, 'Test Wraith Lord', 'p1')[0]!;
    s = passUntil(s, attackStep, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: lord, defender: 'p2' }] });
    return settle(s, { targets: [[obj(find(s, 'Test Dead Knight', 'graveyard', 'p1'))]] });
  };
  it('is automated with no manual part', () => expect(full(WRAITH_LORD)).toBe(true));
  it('the token is a tapped and attacking 3/3 black Wraith with menace and the copied vigilance, and the exiled card left the graveyard', () => {
    const s = play(false);
    const tok = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Dead Knight')!;
    expect(tok).toBeDefined();
    const c = getChars(s, tok);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    expect(c.subtypes).toEqual(['Wraith']);
    expect(JSON.stringify(c.colors)).toContain('B');
    expect(JSON.stringify(c.keywords)).toContain('menace');
    expect(JSON.stringify(c.keywords)).toContain('vigilance');
    expect(s.objects[tok]!.tapped).toBe(true);
    expect(s.zones.graveyard['p1']).toHaveLength(0);
  });
  it('at the next end step the token is exiled when the lord is not your Ring-bearer; it stays when it is', () => {
    let gone = play(false);
    gone = passUntil(gone, (x) => x.turn.step === 'cleanup' || x.turn.number > 1, 'the end of the turn');
    expect(gone.zones.battlefield.some((id) => nameOf(gone, id) === 'Test Dead Knight')).toBe(false);
    let kept = play(true);
    kept = passUntil(kept, (x) => x.turn.step === 'cleanup' || x.turn.number > 1, 'the end of the turn');
    expect(kept.zones.battlefield.some((id) => nameOf(kept, id) === 'Test Dead Knight')).toBe(true);
  });
});

const HALFLING = card('Test Halfling', 'Legendary Creature — Halfling Citizen', '{0}: If ~ is a Citizen, it becomes a Halfling Scout with base power and toughness 2/3 and lifelink.\n{0}: If ~ is a Scout, it becomes a Halfling Rogue with "Whenever this creature deals combat damage to a player, that player loses the game if the Ring has tempted you four or more times this game. Otherwise, the Ring tempts you."', { pt: ['1', '2'] });
const ROGUE = card('Test Rogue Twin', 'Creature — Halfling Rogue', 'Whenever this creature deals combat damage to a player, that player loses the game if the Ring has tempted you four or more times this game. Otherwise, the Ring tempts you.', { pt: ['2', '2'] });
const TEMPT = card('Test Temptation', 'Sorcery', 'The Ring tempts you.');

describe('CR 611.2a, 205.1b, 104.3e, 701.54c: Frodo\'s two activated abilities and the combat damage trigger it grants', () => {
  it('the abilities check the creature types as they resolve: a Citizen becomes a Scout (2/3 lifelink); asking for the Rogue first does nothing; a Scout becomes a Rogue', () => {
    let s = mpScenario({ defs: [HALFLING], zones: { p1: { battlefield: ['Test Halfling'] } } });
    const id = onBattlefield(s, 'Test Halfling', 'p1')[0]!;
    const activate = (idx: number): void => { s = settle(act(s, { type: 'activate', player: 'p1', source: id, ability: `p:0:${idx}` } as never)); };
    activate(1);
    expect(getChars(s, id).subtypes).toEqual(['Halfling', 'Citizen']);
    activate(0);
    expect(getChars(s, id).subtypes).toEqual(['Halfling', 'Scout']);
    expect([Number(getChars(s, id).power), Number(getChars(s, id).toughness)]).toEqual([2, 3]);
    activate(1);
    expect(getChars(s, id).subtypes).toEqual(['Halfling', 'Rogue']);
  });
  const attackWith = (tempts: number): GameState => {
    let s = mpScenario({ defs: [ROGUE, TEMPT], zones: { p1: { battlefield: ['Test Rogue Twin'], hand: Array(tempts).fill('Test Temptation') as string[] } } });
    for (let i = 0; i < tempts; i++) s = cast(s, 'Test Temptation');
    const r = onBattlefield(s, 'Test Rogue Twin', 'p1')[0]!;
    s = passUntil(s, attackStep, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: r, defender: 'p2' }] });
    for (let g = 0; g < 60 && s.turn.step !== 'end' && s.turn.number === 1; g++) s = s.pending?.kind === 'priority' ? drive(act(s, { type: 'pass', player: s.pending.player })) : drive(s);
    return s;
  };
  const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
  it('the Ring has tempted you four times: the player dealt combat damage loses the game', () => expect(lost(attackWith(4), 'p2')).toBe(true));
  it('negative: only three times: that player stays in the game and the Ring tempts you the fourth time', () => {
    const s = attackWith(3);
    expect(lost(s, 'p2')).toBe(false);
    expect(s.designations.ring?.['p1']?.tempted).toBe(4);
  });
});

const ZOMBIE_LORD = card('Test Grave Warden', 'Legendary Creature — Zombie Wizard', 'Whenever ~ attacks, for each opponent, you create a 2/2 black Zombie creature token unless that player sacrifices a creature of their choice.', { pt: ['3', '3'] });

describe('CR 118.12a, 701.21a: "for each opponent, you create a 2/2 black Zombie creature token unless that player sacrifices a creature of their choice" in a four-player game', () => {
  it('p2 sacrifices (no token for p2), p3 has nothing to sacrifice (a token), p4 declines (a token): two Zombies, p2 lost a creature', () => {
    let s = mpScenario({ defs: [ZOMBIE_LORD, BEAR], zones: { p1: { battlefield: ['Test Grave Warden'] }, p2: { battlefield: ['Test Plain Bear'] }, p4: { battlefield: ['Test Plain Bear'] } } });
    const warden = onBattlefield(s, 'Test Grave Warden', 'p1')[0]!;
    s = passUntil(s, attackStep, 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: warden, defender: 'p2' }] });
    s = settle(s, { yes: [true, false] });
    expect(onBattlefield(s, 'Test Plain Bear', 'p2')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Plain Bear', 'p4')).toHaveLength(1);
    expect(count(s, 'p1', 'Test Grave Warden')).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id).includes('Zombie')).length).toBe(2);
  });
});

const RANSOM = card('Test Ransom Rite', 'Instant', 'Choose an opponent. They look at the top four cards of your library and separate them into a face-down pile and a face-up pile. Put one pile into your hand and the other into your graveyard. The Ring tempts you.');

describe('CR 608.2c, 700.3, 701.20e, 701.54a: "Choose an opponent. They look at the top four cards ... and separate them into a face-down pile and a face-up pile. ..."', () => {
  it('p3 is chosen: p3 is the one who separates, you take one pile into your hand and the other goes to your graveyard, and the Ring tempts you', () => {
    let s = mpScenario({ defs: [RANSOM], zones: { p1: { hand: ['Test Ransom Rite'] } } });
    const handBefore = s.zones.hand['p1']!.length;
    const asked: string[] = [];
    s = cast(s, 'Test Ransom Rite', { options: [['p3']], objects: [(options) => options.slice(0, 2)] }, 'p1', asked);
    expect(asked.some((a) => a.endsWith(':p3')), asked.join(' ')).toBe(true);
    expect(s.designations.ring?.['p1']?.tempted).toBe(1);
    expect(s.zones.hand['p1']!.length + s.zones.graveyard['p1']!.length).toBe(handBefore - 1 + 4 + 1);
  });
});
void lifeOf;
