/**
 * RPL-0 (replays design 6): `openView` shows everything `viewFor` hides (CR 400.2): every hand, every library in order, face-down permanents and spells
 * (CR 708), cards exiled face down (CR 406.3a), every log line's private text. Adding it changed nothing of `viewFor` for any viewer.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_VIEW_SCHEMA, FACE_DOWN_DEF_IDS, HIDDEN_DEF, openView, viewFor, type GameState, type PlayerId } from '../../src/index';
import { aiGame, botGame, faceDownConfig, type PlayedGame } from './games';

const PSEUDO = new Set<string>([HIDDEN_DEF, ...Object.values(FACE_DOWN_DEF_IDS)]);

function viewers(s: GameState): (PlayerId | null)[] {
  return [...s.players.map((p) => p.id), null];
}

let fd: PlayedGame | undefined;
const faceDownGame = (): PlayedGame => (fd ??= botGame(faceDownConfig('rpl0-open-fd'), 500));

describe('RPL-0: openView (replays design 6)', { timeout: 300_000 }, () => {
  it('ENGINE_VIEW_SCHEMA is 2 (Godot plan phase 2 added the characteristics summary `chars`; schema 1 is still read, core/view.ts)', () => {
    expect(ENGINE_VIEW_SCHEMA).toBe(2);
  });

  it('CR 400.2, 401.2: shows every object as it is, the hands and libraries in order, and nothing a view never carries', () => {
    const g = aiGame('rpl0-open-ai', 1, 2);
    for (const s of g.states.filter((_, i) => i % 10 === 0)) {
      const v = openView(s);
      expect(v.viewer).toBeNull();
      expect(v.open).toBe(true);
      for (const k of ['rng', 'seed', 'suspended']) expect(Object.hasOwn(v, k), k).toBe(false);
      expect(v.midAction).toBe(s.suspended !== null);
      expect(v.zones).toEqual(s.zones);
      expect(Object.keys(v.objects).sort()).toEqual(Object.keys(s.objects).sort());
      for (const [id, o] of Object.entries(s.objects)) expect(v.objects[id]).toEqual(o);
      expect(v.lki).toEqual(s.lki);
      expect(v.history).toEqual(s.history);
      expect(v.pending).toEqual(s.pending);
      expect(Object.keys(v.defs).sort()).toEqual(Object.keys(s.defs).sort());
    }
  });

  it('CR 400.2: every log line shows its private text, and none keeps the private part', () => {
    const g = aiGame('rpl0-open-log', 0, 2);
    const s = g.states[g.states.length - 1]!;
    const v = openView(s);
    const privateLines = s.log.filter((l) => l.privateText);
    expect(privateLines.length).toBeGreaterThan(0);
    expect(v.log).toHaveLength(s.log.length);
    s.log.forEach((l, i) => {
      expect(Object.hasOwn(v.log[i]!, 'privateText')).toBe(false);
      expect(v.log[i]!.text).toBe(l.privateText ? l.privateText.text : l.text);
    });
  });

  it('shows what viewFor hides: other hands, libraries, face-down permanents and spells (CR 400.2, 708.5)', () => {
    const g = faceDownGame();
    let hiddenFromSomeone = 0;
    let faceDown = 0;
    for (const s of g.states) {
      const open = openView(s);
      for (const viewer of viewers(s)) {
        if (s.suspended !== null && s.pending?.cancellable === true && s.pending.player !== viewer) continue; // shown from the state the action started from (CR 733.1)
        const v = viewFor(s, viewer);
        for (const [id, o] of Object.entries(s.objects)) {
          const seen = v.objects[id];
          if (seen && !PSEUDO.has(seen.defId)) continue;
          hiddenFromSomeone++;
          expect(open.objects[id]!.defId).toBe(o.defId);
          expect(PSEUDO.has(open.objects[id]!.defId)).toBe(false);
          if (o.faceDown) faceDown++;
        }
      }
    }
    expect(hiddenFromSomeone).toBeGreaterThan(1000);
    expect(faceDown).toBeGreaterThan(20);
  });

  it('CR 406.3a: a card exiled face down, which no player may look at, is shown by its card in the open view only', () => {
    const g = aiGame('rpl0-open-exile', 0, 1);
    const s = JSON.parse(JSON.stringify(g.states.find((st) => st.players.some((p) => (st.zones.graveyard[p.id] ?? []).length > 0))!)) as GameState;
    const owner = s.players.find((p) => (s.zones.graveyard[p.id] ?? []).length > 0)!.id;
    const id = s.zones.graveyard[owner]!.pop()!;
    s.zones.exile.push(id);
    s.objects[id] = { ...s.objects[id]!, zone: 'exile', faceDown: true };
    for (const viewer of viewers(s)) expect(viewFor(s, viewer).objects[id]!.defId).toBe(HIDDEN_DEF);
    expect(openView(s).objects[id]).toEqual(s.objects[id]);
  });

  it('viewFor is unchanged: openView changes neither the state nor any viewer\'s view, and viewFor never marks a view open', () => {
    const g = faceDownGame();
    for (const s of g.states.filter((_, i) => i % 20 === 0)) {
      const stateText = JSON.stringify(s);
      const before = viewers(s).map((p) => JSON.stringify(viewFor(s, p)));
      const open = openView(s);
      open.objects = {}; // the open view is a copy: changing it changes nothing else
      open.log.length = 0;
      expect(JSON.stringify(s)).toBe(stateText);
      expect(viewers(s).map((p) => JSON.stringify(viewFor(s, p)))).toEqual(before);
      for (const p of viewers(s)) expect(Object.hasOwn(viewFor(s, p), 'open')).toBe(false);
    }
  });
});
