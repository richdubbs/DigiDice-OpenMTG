/**
 * How the owner's command prints reports (design 4.8; package M13-13). Everything a player wrote reaches the terminal through `shown`: control
 * characters (an ESC would start a terminal escape sequence: screen clearing, window titles, a clipboard write) are removed and every text is bounded.
 */
import { cleanText } from '@openmtg/engine';
import type { HostedExport } from './export';
import type { ReportDetails, ReportSummary } from './inbox';

/** One line of text safe to print, cut to `max` characters. */
export function shown(s: unknown, max = 200): string {
  const t = cleanText(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Text of several lines, each safe to print, indented. */
function block(s: string, indent: string, maxLines = 40): string[] {
  const lines = s.split(/\r\n|\r|\n/).map((l) => indent + shown(l, 1_000));
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `${indent}... (${lines.length - maxLines} more lines)`] : lines;
}

const stamp = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const kb = (bytes: number): string => (bytes < 1_024 ? `${bytes} B` : `${(bytes / 1_024).toFixed(1)} KB`);

/** The listing: one line per report, newest first. */
export function listLines(items: readonly ReportSummary[]): string[] {
  if (items.length === 0) return ['No reports.'];
  const out = items.map((r) => {
    const where = r.game === null ? '' : ` game ${shown(r.game, 40)}${r.seat === null ? '' : ` seat ${r.seat}`}`;
    return `${shown(r.id, 40)}  ${stamp(r.createdAt)}  ${r.status.padEnd(6)} ${r.kind.padEnd(5)}${where}  ${shown(r.text, 70) || '(no words)'}`;
  });
  return [...out, '', `${plural(items.length, 'report')} (newest first).`];
}

/** One report in full. */
export function showLines(d: ReportDetails): string[] {
  const r = d.report;
  const out = [`Report ${shown(r.id, 40)}: ${r.kind === 'bug' ? 'a bug' : 'a table title'}, ${r.status}, made ${stamp(r.createdAt)} UTC by session ${shown(r.session, 40)}`];
  if (r.game !== null) {
    const g = d.game;
    out.push(`  Game ${shown(r.game, 40)}${r.seat === null ? '' : `, the reporter's seat ${r.seat}`}${g ? `: ${shown(g.format, 40)}, ${shown(g.status, 20)}${g.startedAt ? `, started ${stamp(g.startedAt)} UTC` : ', never started'}` : ' (no longer stored)'}`);
    if (g) out.push(`  Seats: ${g.seats.map((s) => `${s.seat} ${s.name === null ? '(open)' : shown(s.name, 64)}`).join(', ')}`);
  }
  if (d.title) out.push(`  The title reported: "${shown(d.title.title, 200)}"${d.title.creator === null ? '' : `, by ${shown(d.title.creator, 64)}`}`);
  out.push(r.kind === 'bug' ? '  What the player wrote:' : '  What the player wrote (about the title):');
  out.push(...(r.text.trim() === '' ? ['    (nothing written)'] : block(r.text, '    ')));
  const c = d.client;
  if (c.card !== null) out.push(`  The card it is about: ${shown(c.card, 200)}`);
  if (c.app) out.push(`  Made with OpenMTG ${shown(c.app.version, 40)} (${c.app.commit === null ? 'no commit' : `commit ${shown(c.app.commit, 64)}`})`);
  if (c.browser) out.push(`  Browser: ${shown(c.browser.userAgent, 300) || '(not given)'}${c.browser.language ? `; ${shown(c.browser.language, 64)}` : ''}${c.browser.screen ? `; ${shown(c.browser.screen, 64)}` : ''}`);
  const settings = Object.entries(c.settings).map(([k, v]) => `${shown(k, 64)}=${shown(v, 100)}`);
  if (settings.length > 0) out.push(`  Settings: ${settings.join(', ')}`);
  out.push(`  Errors the page caught: ${c.errors.length === 0 ? 'none' : c.errors.length}`);
  c.errors.forEach((e, i) => {
    out.push(`    ${i + 1}. ${e.time ? `${shown(e.time, 40)} ` : ''}${shown(e.message, 1_000)}`);
    if (e.stack) out.push(...block(e.stack, '       ', 6));
  });
  out.push(`  Attachments: ${r.attachments.length === 0 ? 'none' : r.attachments.map((a) => `${shown(a.kind, 20)} (${kb(a.json.length)})`).join(', ')}`);
  for (const n of c.notes) out.push(`  Note: ${shown(n, 300)}`);
  if (r.kind === 'bug' && r.game !== null && d.game?.startedAt) {
    out.push(`  The game's log is attached when it is exported: openmtg-hosted inbox export ${shown(r.id, 40)}, then npm run bug -- replay <file>.`);
  }
  return out;
}

/** What an export found out about the game, for the owner (the file itself is written by the command). */
export function exportLines(x: HostedExport, o: { file: string | null }): string[] {
  const c = x.checks;
  const out: string[] = [];
  out.push(`Replayed under this build: ${plural(c.applied, 'action')} of ${c.records}${c.final ? `, turn ${c.final.turn.number}` : ''}${c.final?.result ? (c.final.result.winner === null ? ', a draw' : `, ${shown(c.final.result.winner, 64)} won`) : ', not over'}.`);
  if (c.compared === 0) out.push('The server\'s own checkpoints (every 100th action): none to compare.');
  else if (c.mismatches.length === 0 && c.stopped === null) out.push(`The server's own checkpoints (every 100th action): ${plural(c.compared, 'checkpoint')} compared, every one matches this build.`);
  else out.push(`The server's own checkpoints (every 100th action): ${c.mismatches.length} of ${c.compared} differ on this build${c.mismatches.length > 0 ? ` (first at record ${c.mismatches[0]})` : ''}.`);
  for (const n of x.notes) out.push(`Note: ${shown(n, 400)}`);
  out.push('');
  out.push('This file holds the whole game: both players\' cards and the seed. It is for the developer only; never give it to a player.');
  if (o.file !== null) out.push(`Written to ${o.file}: npm run bug -- replay "${o.file}"`);
  return out;
}
