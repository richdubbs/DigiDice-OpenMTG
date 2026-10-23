/**
 * The decks and players of the performance harness (package P1). They copy the M3 soak (`test/m3/soak.test.ts`) and the M4 real games
 * (`test/m4/realgame.test.ts`) so the harness measures exactly the games those tests play; the test files keep their own copies because the
 * milestone 1-4 tests are not edited (and importing a test file would run its tests). `decks-sync.test.ts` reads those two test files as text and checks
 * that the copies here (card lists, synthetic cards, game counts, seeds, players, options, the converse cadence the harness uses) still say the same.
 * It does not compare the soak loop of `harness.ts` with the soak's `playGame` line by line.
 */
import {
  getChars, legalActions, ptNumbers, type Action, type AssignDamageDecision, type CardDef, type DecisionAnswer, type GameConfig, type GameState, type StopSettings,
} from '../../src/index';
import { compiledDefs } from '../fixtures';
import { activated, charm, keyword, poke, smite, spellAbility, synth, targetPlayer } from '../m3/synthetic';

export const SOAK_GAMES = 20;
export const SOAK_ACTIONS = 300;
/** The soak samples the converse check (unlisted plays are rejected) at every SOAK_CONVERSE_EVERY-th priority (`CONVERSE_EVERY` there). */
export const SOAK_CONVERSE_EVERY = 6;

const SOAK_NAMES: [string, number][] = [
  ['Forest', 3], ['Mountain', 3], ['Plains', 3], ['Island', 3], ['Swamp', 3], ['Taiga', 1], ['Snow-Covered Forest', 2], ['Wastes', 1], ['Dryad Arbor', 1],
  ['Llanowar Elves', 2], ['Birds of Paradise', 2], ['Sol Ring', 1], ['Lotus Petal', 1], ['Mind Stone', 1],
  ['Grizzly Bears', 3], ['Hill Giant', 1], ['Kitchen Finks', 1], ['Porcelain Legionnaire', 1], ['Reaper King', 1], ['Thought-Knot Seer', 1],
  ['Icehide Golem', 1], ['Endless One', 2], ['Ambush Viper', 1],
  ['Lightning Bolt', 2], ['Giant Growth', 1], ['Counterspell', 1], ['Mana Leak', 1], ['Dismember', 1], ['Gitaxian Probe', 1], ['Day of Judgment', 1],
  ['Fire // Ice', 1], ['Bonecrusher Giant // Stomp', 1], ['Agadeem\'s Awakening // Agadeem, the Undercrypt', 1], ['Delver of Secrets // Insectile Aberration', 1],
  ['Akki Lavarunner // Tok-Tok, Volcano Born', 1], ['Think Twice', 1],
  ['Wear // Tear', 1], ['Commit // Memory', 1], ['Cunning Azurescale // Divining Dive', 1], ['Angelic Favor', 1], ['Sudden Shock', 1], ['Jace Beleren', 1],
  ['Akoum Firebird', 1], ['Karplusan Forest', 2], ['Dark Ritual', 1],
  ['Serra Angel', 2], ['Typhoid Rats', 2], ['Vampire Nighthawk', 1], ['Fencing Ace', 2], ['Colossal Dreadmaw', 1], ['Giant Spider', 1], ['Wall of Stone', 2], ['Raging Goblin', 2],
  ['White Knight', 1], ['Black Knight', 1], ['Alpine Watchdog', 1], ['Darksteel Myr', 1], ['Gladecover Scout', 1], ['Glistener Elf', 1], ['Scuzzback Scrapper', 1], ['Branchblight Stalker', 1],
  ['Furtive Homunculus', 1], ['Soltari Foot Soldier', 1], ['Bog Raiders', 1], ['Dross Prowler', 1], ['Highborn Ghoul', 1], ['Mirran Crusader', 1], ['Elephant-Rat', 1], ['Shu Cavalry', 1],
  ['Isamaru, Hound of Konda', 2], ['Pacifism', 2], ['Holy Strength', 1], ['Bonesplitter', 1], ['Chandra, Torch of Defiance', 1], ['Arboria', 1],
];

const SYNTH_NAMES = ['Test Poke', 'Test Smite', 'Test Charm', 'Test Pinger', 'Test Kicker', 'Test Flash', 'Test Altar', 'Test X', 'Test Walker'];

function soakSynthetic(): CardDef[] {
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

function soakDeck(): string[] {
  const out: string[] = [];
  for (const [n, c] of SOAK_NAMES) for (let i = 0; i < c; i++) out.push(n);
  for (const n of SYNTH_NAMES) out.push(n, n);
  return out;
}

/** The soak's pinned stops (the DEFAULT_STOPS before FAST2 MRE added declareBlockers), as `test/m3/soak.test.ts` sets them. */
const SOAK_STOPS: Omit<StopSettings, 'fullControl'> = { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'] };

/** The config of soak game `index` (seed `soak-<index>`, full control on even games), as `test/m3/soak.test.ts` builds it. */
export function soakConfig(index: number): GameConfig {
  const d = soakDeck();
  const fullControl = index % 2 === 0;
  return {
    seed: `soak-${index}`,
    players: [{ name: 'Alice', deck: d, stops: { ...SOAK_STOPS, fullControl } }, { name: 'Bob', deck: d, stops: { ...SOAK_STOPS, fullControl } }],
    defs: [...compiledDefs([...new Set(SOAK_NAMES.map(([n]) => n))]), ...soakSynthetic()],
  };
}

export const REAL_GAMES = 8;
export const REAL_MAX_ACTIONS = 1500;

const DECK_A = [['Forest', 8], ['Plains', 8], ['Grizzly Bears', 6], ['Giant Spider', 3], ['Serra Angel', 2], ['Fencing Ace', 3], ['White Knight', 2], ['Alpine Watchdog', 2], ['Colossal Dreadmaw', 1]] as const;
const DECK_B = [['Mountain', 8], ['Swamp', 8], ['Hill Giant', 5], ['Vampire Nighthawk', 2], ['Typhoid Rats', 4], ['Raging Goblin', 3], ['Black Knight', 2], ['Dross Prowler', 2], ['Craw Wurm', 1]] as const;

const expand = (d: readonly (readonly [string, number])[]): string[] => d.flatMap(([n, c]) => Array<string>(c).fill(n));

/** The config of M4 real game `index` (seed `m4-real-<index>`), as `test/m4/realgame.test.ts` builds it. */
export function realConfig(index: number): GameConfig {
  return {
    seed: `m4-real-${index}`,
    players: [{ name: 'Alice', deck: expand(DECK_A), stops: { fullControl: true } }, { name: 'Bob', deck: expand(DECK_B), stops: { fullControl: true } }],
    defs: compiledDefs([...DECK_A, ...DECK_B].map(([n]) => n)),
    options: { startingPlayer: 'p1', skipMulligans: true },
  };
}

/** The scripted player of the M4 real games: land, creatures, attack with everything, block when it trades or survives, divide damage in order. */
export function realChoose(s: GameState): Action {
  const d = s.pending!;
  const answerWith = (answer: DecisionAnswer): Action => ({ type: 'answer', player: d.player, decisionId: d.id, answer });
  switch (d.kind) {
    case 'priority': {
      const la = legalActions(s, d.player).filter((a) => a.kind !== 'pass' && !a.isMana);
      const land = la.find((a) => a.kind === 'playLand');
      if (land) return land.action;
      const cast = la.filter((a) => a.kind === 'cast');
      if (cast.length > 0) return cast[cast.length - 1]!.action;
      return { type: 'pass', player: d.player };
    }
    case 'payCost': return answerWith({ kind: 'payCost', auto: true });
    case 'declareAttackers': return answerWith({ kind: 'declareAttackers', attacks: d.candidates.map((c) => ({ attacker: c.id, defender: c.defenders[0]! })) });
    case 'declareBlockers': {
      const used = new Set<string>();
      const blocks: { blocker: string; attacker: string }[] = [];
      for (const c of d.candidates) {
        const me = ptNumbers(getChars(s, c.id));
        const target = c.attackers.find((a) => {
          if (used.has(a) || d.needsMultiple.includes(a)) return false;
          const them = ptNumbers(getChars(s, a));
          return (me.toughness ?? 0) > (them.power ?? 0) || (me.power ?? 0) >= (them.toughness ?? 99);
        });
        if (target) { used.add(target); blocks.push({ blocker: c.id, attacker: target }); }
      }
      return answerWith({ kind: 'declareBlockers', blocks });
    }
    case 'assignDamage': return answerWith({ kind: 'assignDamage', amounts: divide(d) });
    case 'chooseObjects': return answerWith({ kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    case 'manualResolve': return answerWith({ kind: 'manualResolve', ops: [] });
    default: throw new Error(`The scripted player can't answer ${d.kind}: ${d.prompt}`);
  }
}

function divide(d: AssignDamageDecision): { id: string; amount: number }[] {
  let left = d.amount;
  const out = d.recipients.map((r) => {
    const n = r.trampleTarget ? 0 : Math.min(left, r.lethal);
    left -= n;
    return { id: r.id, amount: n };
  });
  const last = d.recipients.find((r) => r.trampleTarget) ?? d.recipients[d.recipients.length - 1]!;
  out.find((x) => x.id === last.id)!.amount += left;
  return out;
}

/**
 * A 60-card deck of 24 distinct fixture cards of several layouts (split, adventure, MDFC, transform, planeswalker, Aura, Equipment), for the
 * "compile a deck cold" measurement.
 */
export const COMPILE_DECK: [string, number][] = [
  ['Forest', 6], ['Mountain', 6], ['Island', 4], ['Karplusan Forest', 4], ['Taiga', 2],
  ['Llanowar Elves', 4], ['Birds of Paradise', 2], ['Kitchen Finks', 2], ['Bonecrusher Giant // Stomp', 3], ['Delver of Secrets // Insectile Aberration', 2],
  ['Lightning Bolt', 4], ['Counterspell', 2], ['Mana Leak', 2], ['Fire // Ice', 2], ['Think Twice', 1], ['Dismember', 1],
  ['Serra Angel', 1], ['Vampire Nighthawk', 1], ['Colossal Dreadmaw', 1], ['Chandra, Torch of Defiance', 1], ['Jace Beleren', 1],
  ['Pacifism', 2], ['Bonesplitter', 2], ['Agadeem\'s Awakening // Agadeem, the Undercrypt', 4],
];
