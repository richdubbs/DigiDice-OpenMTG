/**
 * About (branding slot 8, docs/design/m8-client.md screen 10): logo, creator credit, Donate, the full Fan Content disclaimer, Scryfall credit, MIT
 * license and third-party notices, card-data date, rules-pack version and automation coverage (from GET /api/status), and the Update button (UPD1,
 * UpdatePanel.tsx).
 */
import { useCallback, useEffect, useState } from 'react';
import type { StatusResponse } from '@openmtg/server/api';
import { apiGet } from '../api/http';
import { ScreenHeader } from '../app/ScreenHeader';
import { CREATOR_CREDIT, FAN_CONTENT_POLICY_URL } from '../branding/brand';
import { AppTitle, Disclaimer, DonateLink } from '../branding/Branding';
import { Logo3D } from '../branding/Logo3D';
import { UpdatePanel } from './UpdatePanel';
import './screens.css';

type StatusState = { kind: 'loading' } | { kind: 'ok'; status: StatusResponse } | { kind: 'error'; message: string };

function useStatus(): [StatusState, () => void] {
  const [state, setState] = useState<StatusState>({ kind: 'loading' });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  useEffect(() => {
    const ctl = new AbortController();
    apiGet('GET /api/status', { signal: ctl.signal })
      .then((status) => setState({ kind: 'ok', status }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => ctl.abort();
  }, [generation]);
  return [state, reload];
}

/** ISO date part ("2026-10-11"): unambiguous in every locale. */
const day = (iso: string) => iso.slice(0, 10);

function pct(n: number, total: number): string {
  return total > 0 ? `${((100 * n) / total).toFixed(1)}%` : '0%';
}

function VersionInfo({ state }: { state: StatusState }) {
  if (state.kind === 'loading') return <p>Loading…</p>;
  if (state.kind === 'error') return <p>The local server did not answer ({state.message}).</p>;
  const s = state.status;
  return (
    <dl>
      <dt>Version</dt>
      <dd>{s.app.version}</dd>
      <dt>Card data</dt>
      <dd>
        {s.cardData
          ? `Scryfall Oracle data of ${day(s.cardData.updatedAt)} (downloaded ${day(s.cardData.downloadedAt)}${s.cardData.cards !== undefined ? `, ${s.cardData.cards.toLocaleString('en-US')} cards` : ''})`
          : 'Not downloaded yet: use Check for updates below (or run npm run cards -- refresh)'}
      </dd>
      <dt>Rules pack</dt>
      <dd>{s.rulesPack ?? 'None installed'}</dd>
      <dt>Compiler</dt>
      <dd>{s.compilerVersion}</dd>
      <dt>Automation coverage</dt>
      <dd>
        {s.coverage
          ? `${pct(s.coverage.full, s.coverage.total)} fully automated, ${pct(s.coverage.partial, s.coverage.total)} partly, ${pct(s.coverage.manual, s.coverage.total)} manual (${s.coverage.total.toLocaleString('en-US')} cards)`
          : 'Not computed yet'}
      </dd>
    </dl>
  );
}

export function AboutScreen() {
  const [status, reloadStatus] = useStatus();
  return (
    <div className="screen about">
      <ScreenHeader title="About" />
      <section className="hud-panel about-credits" aria-label="Credits">
        <Logo3D size={112} track="window" />
        <div className="about-credits-text">
          <h2>
            <AppTitle />
          </h2>
          <p>{CREATOR_CREDIT}</p>
          <p>Free and open source. No ads, no paid tiers, no accounts. Donations unlock nothing.</p>
          <DonateLink />
        </div>
      </section>
      <section className="hud-panel" aria-label="Fan Content">
        <h2>Fan Content</h2>
        <Disclaimer />
        <p>OpenMTG is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or Scryfall.</p>
        <p>
          <a href={FAN_CONTENT_POLICY_URL} target="_blank" rel="noopener noreferrer">
            Wizards of the Coast Fan Content Policy
          </a>
        </p>
      </section>
      <section className="hud-panel" aria-label="Card data">
        <h2>Card data</h2>
        <p>
          Card data comes from{' '}
          <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
            Scryfall
          </a>
          . OpenMTG is not produced by or endorsed by Scryfall. Card images are never bundled: cards are shown as text unless you add your own images or
          turn on Scryfall images in Settings.
        </p>
        <VersionInfo state={status} />
        <UpdatePanel onFinished={reloadStatus} />
      </section>
      <section className="hud-panel" aria-label="Licenses">
        <h2>Licenses</h2>
        <p>OpenMTG&apos;s code is licensed under the MIT License, copyright © 2026 DigiDice LLC.</p>
        <p>
          The MIT License does not cover Wizards of the Coast&apos;s intellectual property (card names, card text, card art, mana and set symbols, logos,
          the Comprehensive Rules text). The DigiDice name, logos and card back belong to DigiDice LLC and are not licensed under the MIT License.
        </p>
        <ul>
          <li>
            <a href="/legal/LICENSE.txt" target="_blank" rel="noopener">
              MIT License
            </a>
          </li>
          <li>
            <a href="/legal/NOTICE.txt" target="_blank" rel="noopener">
              Notice
            </a>
          </li>
          <li>
            <a href="/legal/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">
              Third-party notices
            </a>
          </li>
          <li>
            <a href="/brand/README.md" target="_blank" rel="noopener">
              DigiDice brand assets notice
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
