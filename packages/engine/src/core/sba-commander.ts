/**
 * M11-1 (m11 design 2): the state-based actions of the Commander rules (CR 704.6c, 704.6d). Owner: M11-1. core/sba.ts calls them; outside a Commander game
 * (`GameOptions.commander` absent) neither does anything.
 *
 *  - CR 704.6c, 903.10a, 702.124d: a player who has been dealt `damageLimit` (21) or more combat damage by the same commander over the course of the game loses
 *    (checked with the other player-loss state-based actions, simultaneously, CR 704.3). Not used when the variant's `damageLimit` is null (Brawl, CR 903.12h;
 *    Duel Commander).
 *  - CR 704.6d, 903.9a: a commander put into a graveyard or exile since the last check (`GameObject.commanderMoved`, core/move-parts/commander.ts): its owner
 *    may put it into the command zone (`commanderZone`, rule '903.9a'). The flag is removed whatever the answer, so a commander left there is not asked about
 *    again. Asked in APNAP order of the owners (CR 101.4), each owner's graveyard first, then exile. The objects flagged when the check begins are the ones
 *    asked: a commander put there by this check's own actions is asked in the next check (it was put there after this check began).
 *
 * Hidden information (CR 406.3a, 400.2): a commander exiled face down is asked about (its owner may look at it), the decision is redacted for other players
 * (core/view.ts#redactDecision), and nothing public names it while it stays face down in exile: no log line when its owner leaves it there. Put into the
 * command zone, it is face up there (a public zone) like any commander.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { Game } from './game';
import { commanderDamageTotals, commanderName, revealCommanderDamage } from './commander-damage';
import { moveObject, zoneArray } from './zones';

/** CR 704.6c: why `player` loses to commander damage now (the reason for the log), or null. */
export function commanderDamageLoss(s: GameState, player: PlayerId): string | null {
  const limit = s.options.commander?.damageLimit;
  if (limit === undefined || limit === null) return null;
  // review finding 2: the damage of a face-down commander counts too (it is kept private until revealed); the reason then names no card (CR 400.2)
  for (const { card, total, hidden } of commanderDamageTotals(s, player)) {
    if (total < limit) continue;
    return `has been dealt ${total} combat damage by ${hidden ? 'a face-down commander' : `the commander ${commanderName(s, card)}`}`;
  }
  return null;
}

/**
 * Review finding 2, CR 708.8: a commander that dealt combat damage face down and is a permanent no longer face down (turned face up) is revealed: its damage
 * joins the public tally (one that left the battlefield was revealed as it left: core/move-parts/commander.ts). Checked first in each state-based action check.
 */
export function revealTurnedFaceUp(g: Game): void {
  if (g.s.options.commander === undefined) return;
  for (const id of [...g.s.zones.battlefield]) {
    const o = g.s.objects[id];
    if (o?.hiddenCommanderDamage && !o.faceDown) revealCommanderDamage(g, o, true);
  }
}

/** CR 704.6d, 903.9a: ask about each flagged commander. Returns true if a commander was put into the command zone. */
export function commanderZoneChoices(g: Game): boolean {
  if (g.s.options.commander === undefined) return false;
  const flagged: ObjectId[] = [];
  for (const owner of g.apnap()) {
    for (const id of zoneArray(g, 'graveyard', owner)) if (g.s.objects[id]?.commanderMoved) flagged.push(id);
    for (const id of g.s.zones.exile) if (g.s.objects[id]?.owner === owner && g.s.objects[id]?.commanderMoved) flagged.push(id);
  }
  let any = false;
  for (const id of flagged) {
    const o = g.s.objects[id];
    if (!o || !o.commanderMoved || o.cardId === undefined || (o.zone !== 'graveyard' && o.zone !== 'exile')) continue;
    delete o.commanderMoved; // asked once, whatever the answer (CR 903.9a: "since the last time state-based actions were checked")
    const hidden = o.faceDown;
    const name = g.nameOf(id);
    const where = o.zone === 'graveyard' ? 'your graveyard' : 'exile';
    const ans = g.choose({
      kind: 'commanderZone', player: o.owner, object: id, card: o.cardId, rule: '903.9a', zone: o.zone,
      prompt: `Your commander ${name} was put into ${where}${hidden ? ' face down' : ''}. Put it into the command zone?`, rules: ['CR 903.9a', 'CR 704.6d'],
    });
    const owner = g.player(o.owner).name;
    if (ans.command) {
      moveObject(g, id, 'command', { cause: 'commander' });
      g.log(`${owner} puts ${name} into the command zone.`, { rules: ['CR 903.9a', 'CR 704.6d'], level: 'action' });
      any = true;
    } else if (!hidden) {
      g.log(`${owner} leaves ${name} in ${o.zone === 'graveyard' ? 'their graveyard' : 'exile'}.`, { rules: ['CR 903.9a'], level: 'info' });
    }
  }
  return any;
}
