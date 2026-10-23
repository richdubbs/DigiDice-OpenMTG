/**
 * A bug report from a game on the DigiDice server (hosted design 4.8, 12; package M13-13's inbox): the player's words go to the server's bug inbox as
 * `report { kind: 'bug' }`. The server knows the game and the seat from the session, and its owner reads the report with the game's own record
 * (`openmtg-hosted inbox show` / `export`): the whole game stays on the server, never on this page (CR 400.2). What this page adds is what only it
 * knows, as attachments (at most 4, 64 KB in all, `reportAttachmentsProblem`):
 *  - `client`: this OpenMTG's version, the browser and its window, and the errors this page caught (their messages);
 *  - `settings`: the display settings a report records (bugs/environment.ts);
 *  - `view`: the view on screen when the report was opened, without its card definitions (the server has them), when it fits.
 * The server takes one report a minute from a player: a second one sooner is refused with the wait, and nothing is sent.
 */
import type { GameView } from '@openmtg/engine';
import { HOSTED_LIMITS, reportAttachmentsProblem, type ReportAttachment } from '@openmtg/hosted/api';
import type { ReporterWords, ReportEnvironment } from '../bugs/report';
import { hostedErrorText } from './errors';
import type { HostedLink } from './HostedLink';

/** The most of the page's caught errors a report sends. */
const ERRORS_SENT = 20;

/** The report's text: the player's words, then the card it is about, within the server's 10 KB. */
export function reportText(said: ReporterWords): string {
  const card = said.card?.trim() ? `\n\nCard: ${said.card.trim()}` : '';
  const max = HOSTED_LIMITS.reportText - card.length;
  return `${said.words.trim().slice(0, max)}${card}`;
}

/** The attachments of the report (see the file comment): each kind once, within the server's limits; the view only when it fits. */
export function reportAttachments(env: ReportEnvironment, view: GameView | null): ReportAttachment[] {
  const out: ReportAttachment[] = [
    { kind: 'client', json: JSON.stringify({ app: env.app, browser: env.browser, errors: env.errors.slice(-ERRORS_SENT) }) },
    { kind: 'settings', json: JSON.stringify(env.settings) },
  ];
  // the client part is bounded by what it holds; a page with a very long error list sends the latest only
  while (out[0]!.json.length > HOSTED_LIMITS.reportAttachments / 4 && env.errors.length > 0) {
    const kept = JSON.parse(out[0]!.json) as { errors: unknown[] };
    if (kept.errors.length === 0) break;
    out[0] = { kind: 'client', json: JSON.stringify({ ...kept, errors: kept.errors.slice(Math.ceil(kept.errors.length / 2)) }) };
  }
  if (view) {
    const { defs: _defs, ...rest } = view;
    const json = JSON.stringify(rest);
    const used = out.reduce((n, a) => n + a.json.length, 0);
    if (used + json.length <= HOSTED_LIMITS.reportAttachments) out.push({ kind: 'view', json });
  }
  return reportAttachmentsProblem(out) === null ? out : out.filter((a) => a.kind !== 'view');
}

/** Sends the report to the server's bug inbox. Resolves null when it was taken, else what went wrong in words. Never throws. */
export async function sendHostedBugReport(link: HostedLink, said: ReporterWords, env: ReportEnvironment, view: GameView | null): Promise<string | null> {
  try {
    const text = reportText(said);
    if (text.trim() === '') return 'Please say what went wrong.';
    const r = await link.command({ t: 'report', kind: 'bug', text, attachments: reportAttachments(env, view) }, { timeoutMs: 20_000, maxPaceMs: 0 });
    return r.ok ? null : hostedErrorText(r.error);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
