/**
 * Footer (branding slot 6): "OpenMTG by DigiDice", the Fan Content disclaimer (exact wording) with a link to the policy, About, a small Donate link,
 * and the build stamp (the commit and date this build was made from, vite.config.ts).
 */
import { FAN_CONTENT_POLICY_URL } from '../branding/brand';
import { AppTitle, Disclaimer, DonateLink } from '../branding/Branding';
import { useNav } from './nav';

/** `typeof` so that tests, which build without vite.config.ts, do not throw on the missing define. */
const BUILD_STAMP = typeof __OPENMTG_BUILD__ === 'string' ? __OPENMTG_BUILD__ : 'dev';

export function Footer() {
  const nav = useNav();
  return (
    <footer className="footer">
      <AppTitle as="strong" />
      <Disclaimer />
      <a href={FAN_CONTENT_POLICY_URL} target="_blank" rel="noopener noreferrer">
        Fan Content Policy
      </a>
      {nav.route.screen !== 'about' && (
        <button type="button" className="button-link" onClick={() => nav.go({ screen: 'about' })}>
          About
        </button>
      )}
      <DonateLink quiet />
      <span className="footer-build" title="The version of OpenMTG this build was made from">
        Build {BUILD_STAMP}
      </span>
    </footer>
  );
}
