/**
 * Which hosted game server this page may offer (hosted design 12, D17): the local server tells the page in `GET /api/status` (`hostedUrl`, from its
 * `--hosted-url` or OPENMTG_HOSTED_URL), and only then does New game show "Play on the DigiDice server". The server's Content-Security-Policy allows
 * exactly that one WebSocket origin, so no other address could be opened from this page anyway.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../api/http';

let asked: Promise<string | null> | null = null;

/** The hosted server's WebSocket origin, or null when none is configured (or the status could not be read: the next call asks again). Once per page. */
export function hostedServerUrl(): Promise<string | null> {
  if (!asked) {
    const request = apiGet('GET /api/status').then(
      (s) => s.hostedUrl ?? null,
      () => {
        if (asked === request) asked = null;
        return null;
      },
    );
    asked = request;
  }
  return asked;
}

/** Tests: forget what was read. */
export function resetHostedServerUrl(): void {
  asked = null;
}

/**
 * The hosted server's address for a screen: `undefined` while it is being read, then the address or null. `override` (tests, or a screen that was given
 * its server) is used as it is, without asking.
 */
export function useHostedServer(override?: string | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(override);
  useEffect(() => {
    if (override !== undefined) {
      setUrl(override);
      return;
    }
    let live = true;
    void hostedServerUrl().then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [override]);
  return override !== undefined ? override : url;
}
