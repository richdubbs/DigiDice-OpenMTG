/**
 * Soak test: random bots play real fixture cards (plus a few synthetic ones for targets, modes, kicker,
 * flashback and costs) for 20 games x 300 actions. Since milestone 4 the bots also declare attackers and blockers and divide combat damage
 * (a random legal choice of everything the engine offers), and the creatures, keywords, Auras and legendary cards in the decks exercise the
 * state-based actions. Checks that
 *  - the engine never throws,
 *  - every action listed by legalActions() is accepted,
 *  - structural invariants hold after every action,
 *  - replaying the action log reproduces the final state exactly (determinism).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, getChars, legalActions, ptNumbers, replay, type Action, type CardDef, type GameConfig, type GameEvent, type GameState, type StopSettings,
} from '../../src/index';
import { compiledDefs } from '../fixtures';
import { describeSlow } from '../slow';
import { Bot } from './bot';
import { activated, charm, keyword, poke, smite, spellAbility, synth, targetPlayer } from './synthetic';

const GAMES = 20;
const ACTIONS = 300;
/**
 * The auto-pass half of the games gets more actions to cover as many turns (set when FAST1's M2 rule asked every player holding cards; AP1's smart
 * auto-pass, asks only a player who can act, so the budget is generous now).
 */
const AUTO_ACTIONS = 500;
/** Every listed action is applied at each priority; the converse check (unlisted plays are rejected) costs more, so it samples. */
const VALIDATE_EVERY = 1;
const CONVERSE_EVERY = 6;

const NAMES: [string, number][] = [
  ['Forest', 3], ['Mountain', 3], ['Plains', 3], ['Island', 3], ['Swamp', 3], ['Taiga', 1], ['Snow-Covered Forest', 2], ['Wastes', 1], ['Dryad Arbor', 1],
  ['Llanowar Elves', 2], ['Birds of Paradise', 2], ['Sol Ring', 1], ['Lotus Petal', 1], ['Mind Stone', 1],
  ['Grizzly Bears', 3], ['Hill Giant', 1], ['Kitchen Finks', 1], ['Porcelain Legionnaire', 1], ['Reaper King', 1], ['Thought-Knot Seer', 1],
  ['Icehide Golem', 1], ['Endless One', 2], ['Ambush Viper', 1],
  ['Lightning Bolt', 2], ['Giant Growth', 1], ['Counterspell', 1], ['Mana Leak', 1], ['Dismember', 1], ['Gitaxian Probe', 1], ['Day of Judgment', 1],
  ['Fire // Ice', 1], ['Bonecrusher Giant // Stomp', 1], ['Agadeem\'s Awakening // Agadeem, the Undercrypt', 1], ['Delver of Secrets // Insectile Aberration', 1],
  ['Akki Lavarunner // Tok-Tok, Volcano Born', 1], ['Think Twice', 1],
  // Added with the milestone 3 review fixes: fuse, aftermath, omen, casting restrictions, split second, planeswalkers, mixed keyword lines, manual mana.
  ['Wear // Tear', 1], ['Commit // Memory', 1], ['Cunning Azurescale // Divining Dive', 1], ['Angelic Favor', 1], ['Sudden Shock', 1], ['Jace Beleren', 1],
  ['Akoum Firebird', 1], ['Karplusan Forest', 2], ['Dark Ritual', 1],
  // Added with milestone 4: combat keywords, evasion, Auras and Equipment, planeswalkers and legendary cards (legend rule).
  ['Serra Angel', 2], ['Typhoid Rats', 2], ['Vampire Nighthawk', 1], ['Fencing Ace', 2], ['Colossal Dreadmaw', 1], ['Giant Spider', 1], ['Wall of Stone', 2], ['Raging Goblin', 2],
  ['White Knight', 1], ['Black Knight', 1], ['Alpine Watchdog', 1], ['Darksteel Myr', 1], ['Gladecover Scout', 1], ['Glistener Elf', 1], ['Scuzzback Scrapper', 1], ['Branchblight Stalker', 1],
  ['Furtive Homunculus', 1], ['Soltari Foot Soldier', 1], ['Bog Raiders', 1], ['Dross Prowler', 1], ['Highborn Ghoul', 1], ['Mirran Crusader', 1], ['Elephant-Rat', 1], ['Shu Cavalry', 1],
  ['Isamaru, Hound of Konda', 2], ['Pacifism', 2], ['Holy Strength', 1], ['Bonesplitter', 1], ['Chandra, Torch of Defiance', 1], ['Arboria', 1],
];

function synthetic(): CardDef[] {
  return [
    poke(),
    smite(),
    charm(),
    synth({ name: 'Test Pinger', cost: '{1}{R}', type: 'Creature — Wizard', pt: ['1', '1'], abilities: [activated('{T}: Ping target player.', { tap: true }, [targetPlayer])] }),
    synth({ name: 'Test Kicker', cost: '{G}', type: 'Creature', pt: ['1', '1'], abilities: [keyword('kicker', { mana: [{ kind: 'generic', amount: 2 }] })] }),
    synth({ name: 'Test Flash', cost: '{R}', type: 'Instant', abilities: [spellAbility('Nothing.'), keyword('flashback', { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'R' }] })] }),
    synth({ name: 'Test Altar', cost: '{1}', type: 'Artifact', abilities: [activated('{1}, Sacrifice a creature: go.', { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })] }),
    synth({ name: 'Test X', cost: '{1}', type: 'Artifact', abilities: [activated('{X}: go.', { mana: [{ kind: 'variable', name: 'X' }] })] }),
    synth({ name: 'Test Walker', cost: '{3}', type: 'Planeswalker — Test', abilities: [activated('+1: go.', { loyalty: 1 }, [], { isLoyalty: true }), activated('-1: go.', { loyalty: -1 }, [targetPlayer], { isLoyalty: true })] }),
  ];
}

const SYNTH_NAMES = ['Test Poke', 'Test Smite', 'Test Charm', 'Test Pinger', 'Test Kicker', 'Test Flash', 'Test Altar', 'Test X', 'Test Walker'];

function deck(): string[] {
  const out: string[] = [];
  for (const [n, c] of NAMES) for (let i = 0; i < c; i++) out.push(n);
  for (const n of SYNTH_NAMES) out.push(n, n);
  return out;
}

/**
 * FAST2 MRE: the stops the soak's tallies were calibrated with (DEFAULT_STOPS before FAST2). DEFAULT_STOPS now also stop both players in the declare
 * blockers step (CR 509.2, tested in test/fast2/mre.test.ts); here every extra stop is one more random priority action out of the fixed per-game budget, so
 * the same seeds play fewer turns and fewer combats (8 blocks instead of 18). Pinned so the soak keeps exercising combat as before.
 */
const SOAK_STOPS: Omit<StopSettings, 'fullControl'> = { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] };

function config(seed: string, fullControl: boolean): GameConfig {
  const d = deck();
  const defs = [...compiledDefs([...new Set(NAMES.map(([n]) => n))]), ...synthetic()];
  // Planeswalkers need loyalty counters to be useful; the bot just uses whatever the engine allows.
  return {
    seed,
    players: [
      { name: 'Alice', deck: d, stops: { ...SOAK_STOPS, fullControl } },
      { name: 'Bob', deck: d, stops: { ...SOAK_STOPS, fullControl } },
    ],
    defs,
  };
}

/** Structural invariants of a state (zones and objects agree, pools are sane, a decision is pending). Plain checks: vitest expect() is too slow here. */
export function checkInvariants(s: GameState): void {
  const fail = (msg: string): never => {
    throw new Error(`Invariant violated: ${msg}`);
  };
  if (s.pending?.kind === 'priority') checkRulesInvariants(s, fail);
  const seen = new Map<string, string>();
  const note = (zone: string, ids: string[]) => {
    for (const id of ids) {
      const o = s.objects[id];
      if (!o) fail(`${id} listed in ${zone} but missing from objects`);
      if (seen.has(id)) fail(`${id} is in both ${seen.get(id)} and ${zone}`);
      seen.set(id, zone);
      if (o!.zone !== zone.replace(/:.*/, '')) fail(`${id} says it is in ${o!.zone} but is listed in ${zone}`);
    }
  };
  for (const p of s.players) {
    note(`library:${p.id}`, s.zones.library[p.id]!);
    note(`hand:${p.id}`, s.zones.hand[p.id]!);
    note(`graveyard:${p.id}`, s.zones.graveyard[p.id]!);
    if (!Number.isInteger(p.life)) fail(`life of ${p.id} is not an integer`);
    for (const u of p.manaPool) if (!'WUBRGC'.includes(u.type)) fail(`bad mana type ${u.type}`);
  }
  note('battlefield', s.zones.battlefield);
  note('stack', s.zones.stack);
  note('exile', s.zones.exile);
  for (const id of Object.keys(s.objects)) if (!seen.has(id)) fail(`${id} (${s.objects[id]!.defId}) is in no zone`);
  for (const id of s.zones.battlefield) if (s.objects[id]!.kind === 'ability') fail('an ability object is on the battlefield');
  if (!s.result && s.pending === null) fail('a decision must be pending while the game runs');
  if (s.pending?.kind === 'priority' && s.suspended !== null) fail('priority is pending but an action is suspended');
}

/**
 * What must hold whenever a player has priority (CR 704.3: state-based actions have just been performed): no creature with toughness 0 or
 * lethal damage (unless indestructible), no planeswalker without loyalty, no token outside the battlefield, no legend-rule or illegal Aura
 * leftovers, and a combat structure that refers only to live creatures.
 */
function checkRulesInvariants(s: GameState, fail: (m: string) => never): void {
  const legends = new Set<string>();
  for (const id of s.zones.battlefield) {
    const o = s.objects[id]!;
    const c = getChars(s, id);
    if (c.types.includes('Creature')) {
      const t = ptNumbers(c).toughness;
      if (t !== null) {
        if (t <= 0) fail(`${c.name} has toughness ${t} on the battlefield`);
        if (o.damage >= t && !c.keywords.some((k) => k.keyword === 'indestructible')) fail(`${c.name} has lethal damage on the battlefield`);
      }
    }
    if (c.types.includes('Planeswalker') && (o.counters.loyalty ?? 0) <= 0) fail(`${c.name} has no loyalty on the battlefield`);
    if (c.supertypes.includes('Legendary')) {
      const key = `${o.controller}|${c.name}`;
      if (legends.has(key)) fail(`${o.controller} controls two legendary ${c.name}`);
      legends.add(key);
    }
    if (c.subtypes.includes('Aura') && c.keywords.some((k) => k.keyword === 'enchant')) {
      if (o.attachedTo === undefined) fail(`${c.name} is an unattached Aura on the battlefield`);
      const to = o.attachedTo === undefined ? undefined : s.objects[o.attachedTo];
      if (to && to.zone !== 'battlefield') fail(`${c.name} is attached to an object that left the battlefield`);
    }
    if (o.attachedTo !== undefined && !c.subtypes.some((x) => x === 'Aura' || x === 'Equipment' || x === 'Fortification')) fail(`${c.name} is attached but is not an Aura, Equipment or Fortification`);
  }
  for (const o of Object.values(s.objects)) if (o.kind === 'token' && o.zone !== 'battlefield') fail('a token exists outside the battlefield');
  const cb = s.combat;
  if (cb) {
    for (const a of cb.attackers) {
      const o = s.objects[a.id];
      if (!o || o.zone !== 'battlefield') fail('an attacker is not on the battlefield');
      if (o!.controller !== s.turn.activePlayer) fail('an attacker is not controlled by the active player');
      for (const b of a.blockedBy) if (!cb.blockers.some((x) => x.id === b && x.blocking.includes(a.id))) fail('blockedBy and blockers disagree');
      if (a.blockedBy.length > 0 && !a.blocked) fail('a creature with blockers is not marked blocked');
    }
    for (const b of cb.blockers) {
      const o = s.objects[b.id];
      if (!o || o.zone !== 'battlefield') fail('a blocker is not on the battlefield');
      for (const t of b.blocking) if (!cb.attackers.some((a) => a.id === t && a.blockedBy.includes(b.id))) fail('blockers and blockedBy disagree');
    }
  } else if (['declareBlockers', 'combatDamage', 'endCombat'].includes(s.turn.step)) fail(`no combat during the ${s.turn.step} step`);
}

interface CombatStats {
  attacks: number;
  attackers: number;
  blocks: number;
  combatDamage: number;
  deaths: number;
  poison: number;
  results: number;
}

function tally(stats: CombatStats, events: GameEvent[]): void {
  for (const e of events) {
    if (e.type === 'attackersDeclared' && e.attackers.length > 0) { stats.attacks++; stats.attackers += e.attackers.length; }
    else if (e.type === 'blockersDeclared') stats.blocks += e.blocks.length;
    else if (e.type === 'damageDealt' && e.combat) stats.combatDamage++;
    else if (e.type === 'zoneChanged' && e.from === 'battlefield' && e.to === 'graveyard') stats.deaths++;
    else if (e.type === 'countersChanged' && e.counter === 'poison') stats.poison++;
    else if (e.type === 'gameOver') stats.results++;
  }
}

interface GameRun {
  config: GameConfig;
  actions: Action[];
  final: GameState;
  checkedListed: number;
  checkedUnlisted: number;
  casts: number;
  abilities: number;
  /** Decisions that cannot be answered: a payment that is not auto-payable, or a choice with fewer options than it demands. */
  deadEnds: string[];
  combat: CombatStats;
}

export function playGame(index: number, validateListed: boolean): GameRun {
  const fullControl = index % 2 === 0;
  const cfg = config(`soak-${index}`, fullControl);
  const bot = new Bot(`soak-${index}`);
  let s = createGame(cfg);
  const actions: Action[] = [];
  let checkedListed = 0;
  let checkedUnlisted = 0;
  let casts = 0;
  let abilities = 0;
  let priorities = 0;
  const deadEnds: string[] = [];
  const combat: CombatStats = { attacks: 0, attackers: 0, blocks: 0, combatDamage: 0, deaths: 0, poison: 0, results: 0 };
  const budget = fullControl ? ACTIONS : AUTO_ACTIONS;
  for (let i = 0; i < budget && !s.result; i++) {
    const d = s.pending!;
    if (d.kind === 'priority' && validateListed && priorities++ % VALIDATE_EVERY === 0) {
      // Every listed action must be accepted by the engine (checked at every VALIDATE_EVERY-th priority: each check clones the state).
      const listed = legalActions(s, d.player);
      for (const la of listed) {
        const r = applyAction(s, la.action);
        if (r.error) throw new Error(`Game ${index}, action ${i}: listed action "${la.label}" was rejected: ${r.error.message} (${r.error.rules.join(', ')})`);
        checkedListed++;
      }
      // The converse for lands and spells in hand: what is not listed is rejected (the list is not missing legal plays).
      const keys = new Set(listed.map((la) => JSON.stringify(la.action)));
      for (const card of priorities % CONVERSE_EVERY === 1 ? s.zones.hand[d.player]! : []) {
        const faces = s.defs[s.objects[card]!.defId]!.faces.length;
        for (let face = 0; face < faces; face++) {
          for (const type of ['playLand', 'cast'] as const) {
            const action: Action = { type, player: d.player, card, face };
            const listedForm: Action = { type, player: d.player, card, ...(face > 0 ? { face } : {}) };
            if (keys.has(JSON.stringify(listedForm))) continue;
            const r = applyAction(s, action);
            if (!r.error) throw new Error(`Game ${index}, action ${i}: ${JSON.stringify(action)} is accepted but legalActions does not list it`);
            checkedUnlisted++;
          }
        }
      }
    }
    // A listed action must never lead to a decision nobody can answer (docs/ARCHITECTURE.md: legalActions only lists completable actions).
    if (d.kind === 'payCost' && !d.autoPayable) deadEnds.push(`game ${index}, action ${i}: ${d.prompt} is not payable`);
    if (d.kind === 'chooseObjects' && d.options.length < d.min) deadEnds.push(`game ${index}, action ${i}: ${d.prompt} has ${d.options.length} options for ${d.min}`);
    const action = bot.next(s);
    if (action.type === 'cast') casts++;
    if (action.type === 'activate') abilities++;
    const r = applyAction(s, action);
    if (r.error) throw new Error(`Game ${index}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message} (${r.error.rules.join(', ')})`);
    s = r.state;
    actions.push(action);
    tally(combat, r.events);
    checkInvariants(s);
  }
  return { config: cfg, actions, final: s, checkedListed, checkedUnlisted, casts, abilities, deadEnds, combat };
}

// QT: about 70 s; a slow suite (npm run test:all)
describeSlow('soak: seeded random bots on real cards', () => {
  const runs: GameRun[] = [];

  it(`plays ${GAMES} games of up to ${ACTIONS} (${AUTO_ACTIONS} with auto-pass) actions without engine exceptions; every listed action is accepted`, async () => {
    // W3b: a yield between games keeps the test worker's RPC answered (one synchronous minute fails the run with "Timeout calling onTaskUpdate")
    for (let g = 0; g < GAMES; g++) {
      runs.push(playGame(g, true));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const total = runs.reduce((n, r) => n + r.actions.length, 0);
    expect(total).toBeGreaterThan(GAMES * 100);
    // The bots really exercised the rules: lots of legal actions were validated, spells cast and abilities used.
    console.log('soak:', total, 'actions;', runs.reduce((n, r) => n + r.checkedListed, 0), 'listed actions accepted;', runs.reduce((n, r) => n + r.checkedUnlisted, 0), 'unlisted plays rejected;', runs.reduce((n, r) => n + r.casts, 0), 'casts;', runs.reduce((n, r) => n + r.abilities, 0), 'activations');
    expect(runs.flatMap((r) => r.deadEnds)).toEqual([]);
    expect(runs.reduce((n, r) => n + r.checkedListed, 0)).toBeGreaterThan(500);
    expect(runs.reduce((n, r) => n + r.casts, 0)).toBeGreaterThan(100);
    expect(runs.reduce((n, r) => n + r.abilities, 0)).toBeGreaterThan(100);
    // Random games include combat: attackers, blockers, combat damage, deaths and players losing.
    const sum = (k: keyof CombatStats) => runs.reduce((n, r) => n + r.combat[k], 0);
    console.log('soak combat:', sum('attacks'), 'attacks with', sum('attackers'), 'attackers;', sum('blocks'), 'blocks;', sum('combatDamage'), 'combat damage events;', sum('deaths'), 'creatures died;', sum('poison'), 'poison events;', sum('results'), 'games ended');
    expect(sum('attacks')).toBeGreaterThan(50);
    // WP18: with the compile pipeline the fixture's removal spells (Day of Judgment, Dismember, Lightning Bolt) resolve by themselves, so more creatures
    // die before combat; the decks got one more Grizzly Bears and Wall of Stone (WP18 review) so blocking stays exercised as in milestone 4 (33 blocks
    // with the default seeds; milestone 4 gave 47). M6-5a: Angelic Favor's alternative cost ("If you control a Plains, you may tap an untapped creature you
    // control rather than pay this spell's mana cost", CR 118.9) is now offered, and the bots tap would-be blockers to pay it: 19 blocks with the default
    // seeds (29 with that cost withheld, every other tally unchanged), so the floor was 15. Standard merge wave 4 (CMD5): Karplusan Forest's colored mana is
    // automated now (a pain mana ability run by the resolver, CR 605.3b, 120.3), so the bots take 1 damage for each colored mana and games end sooner: 14 blocks
    // with the default seeds (18 before; 10 games ended instead of 8; CMD5's line alone gives the same tallies), so the floor is 10.
    expect(sum('blocks')).toBeGreaterThan(10);
    expect(sum('combatDamage')).toBeGreaterThan(100);
    expect(sum('deaths')).toBeGreaterThan(20);
    expect(sum('results')).toBeGreaterThan(3);
  }, 300_000); // W3b: about 45 s alone since the whole template set automates more of the decks (layered states, rule hooks); see STATUS, performance

  it('replaying each action log reproduces the final state exactly (CR determinism)', () => {
    expect(runs.length).toBe(GAMES);
    for (const [i, r] of runs.entries()) {
      const { state, errors } = replay(r.config, r.actions);
      expect(errors, `game ${i}`).toEqual([]);
      expect(JSON.stringify(state), `game ${i}`).toBe(JSON.stringify(r.final));
    }
  }, 120_000); // replays 20 games; the default 5 s was close to the limit once the history is written and layers are computed

  it('games are independent of unrelated state: the same seeds give the same games', () => {
    const again = playGame(3, false);
    expect(JSON.stringify(again.final)).toBe(JSON.stringify(runs[3]!.final));
  }, 60_000); // W3b: one game takes about 3 s alone
});
