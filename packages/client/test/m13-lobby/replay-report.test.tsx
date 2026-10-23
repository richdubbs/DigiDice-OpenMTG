/**
 * M13-12: a game on the DigiDice server keeps a replay of what this player was shown (hosted/replay.ts), and its bug reports can go to the server's
 * inbox (hosted/report.ts, the bug report dialog's Send). A real small game supplies the views and patches; the server is a fake socket (no network).
 */
import { checkReplay, recordingFrameView, type GameView, type RecordingKeyView } from '@openmtg/engine';
import { HOSTED_LIMITS, reportAttachmentsProblem } from '@openmtg/hosted/api';
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BugReportDialog } from '../../src/bugs/BugReportDialog';
import type { ReportEnvironment } from '../../src/bugs/report';
import { HostedConnection } from '../../src/connection/HostedConnection';
import { sealConnection } from '../../src/game/sealed';
import { recordHostedGame } from '../../src/hosted/replay';
import { reportAttachments, reportText, sendHostedBugReport } from '../../src/hosted/report';
import { liveReplayOf } from '../../src/replays/live';
import { testEnv, testClock } from '../replays/helpers';
import { fakeHosted, flush, gameViews, seatView, tableMsg, welcomeMsg } from '../m13/fakes';

const keyless = (v: GameView): RecordingKeyView => {
  const { defs: _defs, ...key } = v;
  return JSON.parse(JSON.stringify(key)) as RecordingKeyView;
};

async function playing() {
  const f = fakeHosted({ welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
  await f.link.connect();
  await flush();
  const g = gameViews('hosted-replay');
  f.socket().push(tableMsg({ status: 'playing', format: 'casual', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
  f.socket().push(g.full('p1'));
  return { ...f, g };
}

const ENV: ReportEnvironment = {
  app: { name: 'OpenMTG', version: '0.0.0-test', commit: 'testcommit' } as ReportEnvironment['app'],
  browser: { userAgent: 'test', language: 'en', window: { width: 1280, height: 800, dpr: 1 } } as unknown as ReportEnvironment['browser'],
  settings: { theme: 'dark' } as unknown as ReportEnvironment['settings'],
  errors: [],
};

describe('M13-12 the replay of a hosted game', () => {
  it('records one frame per change shown, which plays back as exactly the views the server sent; a resent view is not a frame', async () => {
    const s = await playing();
    const clock = testClock();
    const env = testEnv({ now: clock.now });
    const conn = new HostedConnection(s.link);
    const sealed = sealConnection(conn);
    const rec = recordHostedGame(conn, s.link, sealed, env)!;
    expect(liveReplayOf(conn)).toBe(rec.live);
    expect(liveReplayOf(sealed)).toBe(rec.live);
    const sent: GameView[] = [s.link.view()!.view];
    for (let i = 0; i < 8; i++) {
      const base = s.g.seq;
      const events = s.g.step();
      clock.advance(1000);
      s.socket().push(s.g.patch('p1', base, events));
      sent.push(s.link.view()!.view);
    }
    // a new socket's full view of the same change is not news
    s.socket().push(s.g.full('p1'));
    const file = rec.live.soFar!();
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    expect(file).toMatchObject({ kind: 'recording', game: { mode: 'hosted', savedBy: 'p1', format: 'casual', ended: 'abandoned' }, reveal: { policy: 'own' } });
    const frames = file.recording!.frames;
    expect(frames).toHaveLength(sent.length);
    let prev: RecordingKeyView | null = null;
    frames.forEach((f, i) => {
      const v = recordingFrameView(prev, f, { viewer: 'p1', defs: file.recording!.defs });
      if (!v.ok) throw new Error(v.error.message);
      expect(v.value, `frame ${i}`).toEqual(keyless(sent[i]!));
      prev = v.value;
    });
    // the first frame is a full view, the next ones patches
    expect(frames[0]!.key).toBeDefined();
    expect(frames[1]!.patch).toBeDefined();
  });

  it('leaving the game screen keeps it in the library as conceded or abandoned; Keep replay marks it kept', async () => {
    const s = await playing();
    const env = testEnv();
    const conn = new HostedConnection(s.link);
    const rec = recordHostedGame(conn, s.link, sealConnection(conn), env)!;
    rec.live.setKept(true);
    rec.live.left();
    const entry = await rec.finish();
    expect(entry).not.toBeNull();
    expect(rec.live.state()).toMatchObject({ phase: 'saved', kept: true });
    const kept = await env.library.read(entry!.key);
    expect(kept.ok && kept.value).toMatchObject({ kind: 'recording', game: { mode: 'hosted', ended: 'abandoned' } });
    expect((await env.library.entry(entry!.key))?.keep).toBe(true);
    expect(await rec.live.file()).toMatchObject({ id: rec.id });
  });
});

describe('M13-12 bug reports from a hosted game', () => {
  it('the text is the words and the card, within the server\'s 10 KB', () => {
    expect(reportText({ words: '  It did the wrong thing.  ', card: 'Llanowar Elves' })).toBe('It did the wrong thing.\n\nCard: Llanowar Elves');
    expect(reportText({ words: 'x'.repeat(30_000), card: null }).length).toBe(HOSTED_LIMITS.reportText);
  });

  it('the attachments are the client, the settings and the view without its definitions, within the server\'s limits', async () => {
    const s = await playing();
    const view = s.link.view()!.view;
    const att = reportAttachments(ENV, view);
    expect(att.map((a) => a.kind)).toEqual(['client', 'settings', 'view']);
    expect(reportAttachmentsProblem(att)).toBeNull();
    expect(JSON.parse(att[2]!.json)).not.toHaveProperty('defs');
    // a view too big to send stays home; the rest goes
    const huge = { ...view, log: Array.from({ length: 5000 }, (_, i) => ({ text: `line ${i} `.repeat(4) })) } as unknown as GameView;
    expect(reportAttachments(ENV, huge).map((a) => a.kind)).toEqual(['client', 'settings']);
    const noisy = { ...ENV, errors: Array.from({ length: 500 }, (_, i) => ({ message: `error ${i} `.repeat(30), at: 'x' })) } as unknown as ReportEnvironment;
    expect(reportAttachmentsProblem(reportAttachments(noisy, view))).toBeNull();
  });

  it('sends kind bug to the server; a second report within a minute is refused here with the wait, and nothing is sent', async () => {
    const s = await playing();
    const sending = sendHostedBugReport(s.link, { words: 'The trigger did not go on the stack.' }, ENV, s.link.view()!.view);
    await flush();
    expect(s.socket().last('report')).toMatchObject({ t: 'report', kind: 'bug', text: 'The trigger did not go on the stack.' });
    s.socket().reply('report');
    expect(await sending).toBeNull();
    const again = await sendHostedBugReport(s.link, { words: 'Again' }, ENV, null);
    expect(again).toMatch(/try again in about a minute/i);
    expect(s.socket().all('report')).toHaveLength(1);
    expect(await sendHostedBugReport(s.link, { words: '   ' }, ENV, null)).toBe('Please say what went wrong.');
  });

  it('the dialog offers Send report for a hosted game, and says when it was sent', async () => {
    const s = await playing();
    const conn = new HostedConnection(s.link);
    const sent: string[] = [];
    render(
      <BugReportDialog
        connection={sealConnection(conn)}
        view={conn.view()}
        environment={() => ENV}
        send={async (said) => (sent.push(said.words), null)}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/Send the report to the people who run the DigiDice server/)).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await reactAct(async () => void fireEvent.change(screen.getByLabelText('What happened, and what did you expect?'), { target: { value: 'Wrong damage' } }));
    await reactAct(async () => void fireEvent.click(send));
    expect(sent).toEqual(['Wrong damage']);
    expect(screen.getByText(/Sent\. Thank you/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save as a file' })).toBeTruthy();
  });
});
