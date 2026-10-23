/**
 * M11-1: helpers for the Commander rules tests (test/m11/rules/*). A two-player Commander game (CR 903.2) at the first main phase of turn 1 (Alice active),
 * with synthetic commanders and real fixture cards placed into zones, driven by real actions and answers (the milestone 3/4 scenario style).
 */
import {
  applyAction, commanderOptions, compileCard, createGame, type AbilityDef, type CardDef, type Color, type CommanderVariant, type DecisionAnswer, type GameConfig,
  type GameState, type ObjectId, type OracleCard, type PlayerId,
} from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { compiledDefs } from '../../fixtures';
import { put, type PutOptions } from '../../m3/scenario';

export { act, answer, find, findAll, pass, put } from '../../m3/scenario';
export { declareAttackers, passUntil, runCombat, toDeclareAttackers, toStep, tweak, lifeOf, logHas } from '../../m4/helpers';
export { drive } from '../../m5/cr-examples/helpers';

/** A legendary creature with a color identity (CR 903.3, 903.4: Scryfall's color_identity, `CardDef.colorIdentity`). */
export function legend(name: string, cost: string, pt: [string, string], identity: Color[] | null, text = '', type = 'Legendary Creature — Elf Warrior'): CardDef {
  const d = compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, power: pt[0], toughness: pt[1], oracle_text: text } as OracleCard);
  return identity ? { ...d, colorIdentity: identity } : d;
}

/** A synthetic card (any type). */
export function card(name: string, cost: string, type: string, text = '', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, ...(pt ? { power: pt[0], toughness: pt[1] } : {}), oracle_text: text } as OracleCard);
}

/** The definition with the abilities of its (only) face replaced: hand-built ability data for what M11-4's templates will produce. */
export function withAbilities(def: CardDef, abilities: AbilityDef[]): CardDef {
  return { ...def, faces: def.faces.map((f, i) => (i === 0 ? { ...f, abilities } : f)) };
}

/** The same definition with every ability's `zone` set (an ability that functions in the command zone, CR 113.6). */
export function functioningIn(def: CardDef, zone: NonNullable<Extract<AbilityDef, { kind: 'static' }>['zone']>): CardDef {
  return withAbilities(def, def.faces[0]!.abilities.map((a) => ({ ...a, zone }) as AbilityDef));
}

type Zones = Partial<Record<'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile', (string | PutOptions)[]>>;
export interface CommanderScenario {
  variant?: CommanderVariant;
  p1Commanders: CardDef[];
  p2Commanders: CardDef[];
  p1?: Zones;
  p2?: Zones;
  /** Fixture card names used besides Forest. */
  cards?: string[];
  defs?: CardDef[];
  /** Keep the mulligans (default: skipped). */
  mulligans?: boolean;
  seed?: string;
}

/** The game configuration of a Commander scenario (decks of 40 Forests and the commanders). */
export function commanderConfig(o: CommanderScenario): GameConfig {
  const defs = [...compiledDefs([...new Set(['Forest', ...(o.cards ?? [])])]), ...o.p1Commanders, ...o.p2Commanders, ...(o.defs ?? [])];
  const deck = Array(40).fill('Forest') as string[];
  return {
    seed: o.seed ?? 'm11-rules',
    players: [
      { name: 'Alice', deck, stops: { fullControl: true }, commanders: o.p1Commanders.map((d) => d.id) },
      { name: 'Bob', deck, stops: { fullControl: true }, commanders: o.p2Commanders.map((d) => d.id) },
    ],
    defs: [...new Map(defs.map((d) => [d.id, d])).values()],
    options: { startingPlayer: 'p1', ...(o.mulligans ? {} : { skipMulligans: true }), commander: commanderOptions(o.variant ?? 'commander') },
  };
}

/** A Commander game at the first main phase of turn 1 (Alice active, both with full control), with exactly the given cards besides the commanders. */
export function commanderScenario(o: CommanderScenario): GameState {
  let s = clone(createGame(commanderConfig(o)));
  for (const [p, zones] of [['p1', o.p1], ['p2', o.p2]] as const) {
    for (const z of ['hand', 'library'] as const) {
      for (const id of s.zones[z][p]!) delete s.objects[id];
      s.zones[z][p] = [];
    }
    for (const name of ['library', 'hand', 'graveyard', 'battlefield', 'exile'] as const) for (const spec of zones?.[name] ?? []) put(s, p, name, spec);
    for (let i = 0; i < 20; i++) put(s, p, 'library', 'Forest');
  }
  while (s.turn.step !== 'main1') {
    const r = applyAction(s, { type: 'pass', player: s.pending!.player });
    if (r.error) throw new Error(r.error.message);
    s = r.state;
  }
  return s;
}

/** The player's commander object in the command zone (by name). */
export function inCommand(s: GameState, name: string): ObjectId {
  const id = s.zones.command.find((x) => s.defs[s.objects[x]!.defId]!.name === name);
  if (!id) throw new Error(`${name} is not in the command zone`);
  return id;
}

/** `n` untapped Forests on the battlefield of `player` (not summoning sick). */
export const forests = (n: number): PutOptions[] => Array.from({ length: n }, () => ({ name: 'Forest' }));

/** Answer every pending decision with these answers in order (payment automatic), until priority. */
export function answerUntilPriority(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  let i = 0;
  for (let n = 0; n < 50 && t.pending && t.pending.kind !== 'priority'; n++) {
    let a: DecisionAnswer | undefined;
    if (t.pending.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else a = answers[i++];
    if (!a) break;
    const r = applyAction(t, { type: 'answer', player: t.pending.player, decisionId: t.pending.id, answer: a });
    if (r.error) throw new Error(`${r.error.message} (answering ${t.pending.kind})`);
    t = r.state;
  }
  return t;
}

export const commanderRec = (s: GameState, player: PlayerId, name: string) => s.players.find((p) => p.id === player)!.commanders!.find((c) => s.defs[c.defId]!.name === name)!;
export const untappedForests = (s: GameState, player: PlayerId): number =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.defs[s.objects[id]!.defId]!.name === 'Forest' && !s.objects[id]!.tapped).length;

/**
 * A scenario puts cards onto the battlefield as new cards: make the one named `name` on the battlefield the commander CARD itself (it takes the commander's
 * card id, and the commander object in the command zone is removed), as if it had been cast and resolved (CR 903.3: the designation is the card's).
 */
export function commanderOnBattlefield(s: GameState, name: string): GameState {
  const t = clone(s);
  const id = t.zones.battlefield.find((x) => t.defs[t.objects[x]!.defId]!.name === name);
  if (!id) throw new Error(`${name} is not on the battlefield`);
  const owner = t.objects[id]!.owner;
  const rec = t.players.find((p) => p.id === owner)!.commanders!.find((c) => t.defs[c.defId]!.name === name)!;
  const old = t.zones.command.find((x) => t.objects[x]!.cardId === rec.card)!;
  t.zones.command = t.zones.command.filter((x) => x !== old);
  delete t.objects[old];
  t.objects[id]!.cardId = rec.card;
  return t;
}
