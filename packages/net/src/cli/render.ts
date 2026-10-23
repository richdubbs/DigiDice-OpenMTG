/** Text rendering of a view for the test CLI (the real UI is the client, milestone 8/9). Only what the view contains: hidden cards stay "?". */
import { decidingPlayer, type GameView, type PlayerId } from '@openmtg/engine';
import type { LegalList } from '../game/autoplay';

function nameOf(view: GameView, id: string): string {
  const o = view.objects[id];
  if (!o) return id;
  const def = view.defs[o.defId];
  return def ? def.name : '?';
}

export function renderView(view: GameView, me: PlayerId, legal: LegalList): string[] {
  const out: string[] = [];
  const pname = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  out.push(`--- Turn ${view.turn.number}, ${pname(view.turn.activePlayer)}'s turn, step ${view.turn.step}`);
  for (const p of view.players) {
    const hand = view.zones.hand[p.id] ?? [];
    const lib = view.zones.library[p.id] ?? [];
    const gy = view.zones.graveyard[p.id] ?? [];
    out.push(`${p.id === me ? '*' : ' '} ${p.name}: ${p.life} life, hand ${hand.length}, library ${lib.length}, graveyard ${gy.length}`);
    const perms = view.zones.battlefield.filter((id) => view.objects[id]?.controller === p.id);
    if (perms.length) out.push(`    battlefield: ${perms.map((id) => `${nameOf(view, id)}${view.objects[id]!.tapped ? ' (T)' : ''} [${id}]`).join(', ')}`);
    if (p.id === me && hand.length) out.push(`    hand: ${hand.map((id) => `${nameOf(view, id)} [${id}]`).join(', ')}`);
  }
  if (view.zones.stack.length) out.push(`  stack: ${view.zones.stack.map((id) => nameOf(view, id)).join(' <- ')}`);
  for (const l of view.log.slice(-4)) out.push(`  log: ${l.text}`);
  if (view.result) {
    out.push(`GAME OVER: ${view.result.winner ? `${pname(view.result.winner)} wins` : 'draw'} (${view.result.reason})`);
    return out;
  }
  const d = view.pending;
  if (!d) return out;
  if (decidingPlayer(d) !== me) { // std-control-3: a decision of a player `me` controls is `me`'s (CR 723.5)
    out.push(`Waiting for ${pname(decidingPlayer(d))}...`);
    return out;
  }
  if (d.kind === 'priority') {
    out.push('You have priority:');
    legal.forEach((l, i) => out.push(`  ${i + 1}. ${l.label}`));
  } else {
    out.push(`Decision (${d.kind}): ${d.prompt}`);
    out.push(`  details: ${JSON.stringify(d)}`);
    out.push('  answer with: a <answer JSON>   or   d (default answer)   or   cancel');
  }
  return out;
}

export const HELP = [
  'Commands: <n> (play legal action n), pass, d (default answer to a decision), a <answer JSON>, cancel,',
  '          auto (toggle automatic play), view, chat <text>, concede, quit',
  "Host only: accept, reject <reason> (the guest's manual adjustments), forfeit [player] (end the game for a guest that left)",
  "3-4 players: everyone answers every other player's manual adjustments (accept, reject <reason>); host only: leave (concede, keep serving the game)",
];
