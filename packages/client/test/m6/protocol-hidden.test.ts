// @vitest-environment node
/**
 * M6-11 (m6 design 5 "M6-11": "the hidden-information property test of M6-3 rerun over the protocol messages"; the milestone 9 protocol carries the same
 * view fields and nothing more). Random games with morph, megamorph, disguise, manifest and cloak decks (the M6-3 decks), played by the seeded random bot.
 * After every action, for each player, the message a player is sent is built exactly as the host builds it (packages/net game/host.ts#sendGuestView: `viewFor`,
 * the events through `eventsFor`, `legalActions`; the local server's bridge sends the host's browser the same three for the host player), put through the
 * wire's JSON and the guest's own check (`parseHostMessage`). Checked:
 *  - every message is accepted by the guest (a view that offers a special action included: the turn-face-up special action, CR 116.2b);
 *  - for every face-down permanent or spell and every player who may not look at it (CR 708.5), the message never carries its definition, card id, name
 *    (once it is face down), or the word "megamorph" on it (CR 702.37b-c), and its zone-change events name it as nobody;
 *  - every special action a player is offered goes back to the host as a valid action message (`parseGuestMessage`, with and without X).
 * In process only: no socket is opened (no network testing of any kind).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, viewFor, FACE_DOWN_DEF_IDS, type Action, type GameConfig, type GameEvent, type GameState, type PlayerId } from '@openmtg/engine';
import { eventsFor, parseGuestMessage, parseHostMessage, PROTOCOL_VERSION, type ViewMessage } from '@openmtg/net';
import { compiledDefs } from '../../../engine/test/fixtures';
import { Bot } from '../../../engine/test/m3/bot';
import { lands, putFaceDown, scenario, synthetic } from '../../../engine/test/m6/face-down/support';

const SYNTH = [
  synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' }),
  synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{1}{U}', '{1}: Turn target face-down creature face up.', { power: '1', toughness: '2' }),
  synthetic('Test Veil Caster', 'Creature — Human Wizard', '{1}{U}', '{2}: Turn target creature face down.', { power: '1', toughness: '2' }),
  synthetic('Test Mist Seer', 'Creature — Human Wizard', '{2}{U}', 'When this creature enters, manifest the top card of your library.', { power: '1', toughness: '1' }),
];
const ALICE = ['Exalted Angel', 'Den Protector', 'Hooded Hydra', 'Grinning Demon', 'Whisperwood Elemental', 'Test Shroud Tailor', 'Test Veil Caster', 'Lightning Bolt'];
const BOB = ['Willbender', 'Alley Assailant', 'Branchsnap Lorian', 'Clone', 'Test Mask Weaver', 'Test Mist Seer', 'Counterspell', 'Shock'];
const LANDS = ['Plains', 'Forest', 'Island', 'Swamp', 'Mountain'];

function deckOf(cards: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) out.push(...cards);
  while (out.length < 40) out.push(LANDS[out.length % LANDS.length]!);
  return out;
}

function config(seed: string): GameConfig {
  return {
    seed,
    players: [
      { name: 'Alice', deck: deckOf(ALICE), stops: { fullControl: true } },
      { name: 'Bob', deck: deckOf(BOB), stops: { fullControl: true } },
    ],
    defs: [...compiledDefs([...new Set([...ALICE, ...BOB, ...LANDS])].filter((n) => !n.startsWith('Test '))), ...SYNTH],
    options: { skipMulligans: true },
  };
}

const PSEUDO = new Set<string>(Object.values(FACE_DOWN_DEF_IDS));

/** The message `p` is sent after an action (game/host.ts#sendGuestView), through the wire's JSON and the guest's check. */
function sent(s: GameState, events: readonly GameEvent[], p: PlayerId, seq: number): { text: string; message: ViewMessage } {
  const message: ViewMessage = { v: PROTOCOL_VERSION, type: 'view', seq, view: viewFor(s, p), events: eventsFor(s, events, p), legal: legalActions(s, p) };
  const text = JSON.stringify(message);
  const parsed = parseHostMessage(JSON.parse(text));
  if (!parsed || parsed.type !== 'view') throw new Error(`the guest refuses the view sent to ${p} at #${seq} (legal kinds: ${[...new Set(message.legal.map((l) => l.kind))].join(', ')})`);
  return { text, message: parsed };
}

/** A card name is evidence of a leak only when no other object of that name exists in the game (the M6-3 rule): lands and duplicates are not checked. */
function checkable(s: GameState, id: string): string | null {
  const name = s.defs[s.objects[id]!.defId]?.name;
  if (!name || LANDS.includes(name)) return null;
  return Object.values(s.objects).some((x) => x.id !== id && s.defs[x.defId]?.name === name) ? null : name;
}

interface Tally { messages: number; checks: number; specialViews: number; specialActions: number; faceDowns: Set<string> }

function checkMessages(s: GameState, events: readonly GameEvent[], seq: number, firstSeen: Map<string, number>, t: Tally, where: string): void {
  for (const p of s.players.map((x) => x.id)) {
    const { text, message } = sent(s, events, p, seq);
    t.messages++;
    // the special actions this player is offered go back to the host as valid action messages (CR 116.2b; the guest's own check of the host)
    const specials = message.legal.filter((l) => l.kind === 'special');
    if (specials.length > 0) t.specialViews++;
    for (const l of specials) {
      for (const action of [l.action, { ...l.action, x: 1 }] as Action[]) {
        const back = parseGuestMessage(JSON.parse(JSON.stringify({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq, action })));
        if (!back.ok) throw new Error(`${where}: the host refuses the special action "${l.label}": ${back.error}`);
      }
      t.specialActions++;
    }
    for (const id of [...s.zones.battlefield, ...s.zones.stack]) {
      const o = s.objects[id]!;
      if (!o.faceDown || o.kind === 'ability' || o.controller === p) continue;
      const seen = message.view.objects[id];
      if (!seen) continue; // another player's cancellable action is shown from the state it started from (CR 733.1)
      t.faceDowns.add(id);
      const fail = (what: string): never => {
        throw new Error(`${where}: the message to ${p} identifies ${o.defId} (${id}) through ${what}`);
      };
      // the view (the M6-3 rule, now as the guest received it): the object itself, the log since it went face down, its abilities on the stack
      if (!PSEUDO.has(seen.defId)) fail(`its defId ${seen.defId}`);
      for (const k of ['cardId', 'cast', 'chosen', 'links', 'faceUpX'] as const) if (seen[k] !== undefined) fail(k);
      if (JSON.stringify(seen).toLowerCase().includes('megamorph')) fail('the word megamorph');
      const name = checkable(s, id);
      const since = firstSeen.get(id) ?? 0;
      if (name) {
        for (const l of message.view.log) if (l.seq >= since && l.text.includes(name)) fail(`the log line "${l.text}"`);
        for (const sid of message.view.zones.stack) if (message.view.objects[sid]?.stack?.sourceId === id && JSON.stringify(message.view.objects[sid]).includes(name)) fail('an ability of it on the stack');
      }
      // what the protocol adds to the view: the events and the legal actions name neither its card nor its name (a permanent turned face down was public
      // before, under the same object id: what the player saw then is not checked, as in M6-3)
      const extra = JSON.stringify({ events: message.events, legal: message.legal });
      if (o.cardId && extra.includes(`"${o.cardId}"`)) fail('its card id in the events or legal actions');
      if (name && extra.includes(name)) fail(`its name "${name}" in the events or legal actions`);
      for (const e of message.events) if (e.type === 'zoneChanged' && e.newId === id && e.name !== '' && e.name !== 'a face-down card') fail(`the zoneChanged event "${e.name}"`);
      if (text.length === 0) fail('an empty message');
      t.checks++;
    }
  }
}

function play(seed: string, budget: number, t: Tally): void {
  const bot = new Bot(seed);
  let s = createGame(config(seed));
  const firstSeen = new Map<string, number>();
  for (let i = 0; i < budget && !s.result; i++) {
    const d = s.pending!;
    let action: Action = bot.next(s);
    // now and then the player at priority takes a special action it is offered (the bot never does), as a player of the client would
    // (and, more often than the bot would, casts a creature face down: CR 702.37c, 702.168b)
    if (d.kind === 'priority') {
      const legal = legalActions(s, d.player);
      const special = legal.find((l) => l.kind === 'special');
      const faceDown = legal.find((l) => l.kind === 'cast' && ['morph', 'disguise'].includes((l.action as { method?: string }).method ?? ''));
      if (special && i % 2 === 0) action = special.action;
      else if (faceDown && i % 3 === 0) action = faceDown.action;
    }
    const r = applyAction(s, action);
    if (r.error) throw new Error(`${seed} #${i}: ${r.error.message}`);
    s = r.state;
    for (const id of [...s.zones.battlefield, ...s.zones.stack]) if (s.objects[id]!.faceDown && !firstSeen.has(id)) firstSeen.set(id, s.counters.log);
    checkMessages(s, r.events, i + 1, firstSeen, t, `${seed} #${i}`);
  }
}

describe('M6-11: the hidden information of face-down objects over the milestone 9 protocol messages (property, random games)', () => {
  it('every view message is accepted by the guest, and none identifies a face-down permanent or spell to a player who may not look at it', () => {
    const t: Tally = { messages: 0, checks: 0, specialViews: 0, specialActions: 0, faceDowns: new Set() };
    for (let g = 0; g < 4; g++) play(`m6-11-protocol-${g}`, 300, t);
    expect(t.faceDowns.size).toBeGreaterThan(5); // the games did put cards face down
    expect(t.checks).toBeGreaterThan(100);
    expect(t.messages).toBeGreaterThan(1000); // one message per player per action, every one accepted by the guest (sent() throws otherwise)
  }, 240_000);

  it('CR 116.2b: a view that offers the turn-face-up special action is accepted by the guest, and the action comes back as a valid message', () => {
    // Before M6-11 the guest's check knew no legal action of kind "special" and refused the whole view: a guest with a face-down creature it could turn
    // face up never got its view. (Random games rarely reach a payable morph cost, so this is checked on a set board.)
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 4) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel', { by: 'morph', profile: 'plain' });
    const t: Tally = { messages: 0, checks: 0, specialViews: 0, specialActions: 0, faceDowns: new Set() };
    checkMessages(s, [], 1, new Map([[id, 0]]), t, 'set board');
    expect([t.messages, t.specialViews, t.specialActions, t.checks]).toEqual([2, 1, 1, 1]); // Alice's view offers it; Bob's view hides the card
    const { message } = sent(s, [], 'p1', 1);
    expect(message.legal.find((l) => l.kind === 'special')?.label).toBe('Turn Exalted Angel face up (morph {2}{W}{W})');
    // the action shape check: an unknown `via` or a negative X is refused (the engine decides the rest)
    const action = (extra: object) => parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 1, action: { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id, ...extra } });
    expect(action({ via: 'morph', x: 2 }).ok).toBe(true);
    expect(action({ via: 'sideways' }).ok).toBe(false);
    expect(action({ x: -1 }).ok).toBe(false);
  });
});
