import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installSoundUnlock, prerenderOrder } from './audio/engine';
import { soundEngine } from './audio/sfx';
import { installUiSounds } from './audio/uiSounds';
import { installErrorTrail } from './bugs/errors';
import { connectScryfallSetting } from './images/settings';
import { connectProfiles } from './profiles/profiles';
import { scryfallSettingSource, settingsStore } from './settings/settings';
import { applyTheme, themeVars } from './theme/theme';
import './theme/styles.css';
import './theme/neon-grid.css';
import './theme/lcars.css';
import './theme/fracture.css';

// RPL-4: the errors this page catches, kept for a bug report (bugs/errors.ts); nothing leaves the page unless the player saves a report.
installErrorTrail(window);
applyTheme(document.documentElement);
// The UI profile in use (profiles/profiles.ts): its template and colors, kept on the root element as it changes (Settings, Look and feel).
connectProfiles(document.documentElement, undefined, themeVars());
// One copy of the Scryfall images setting for the whole page: the Settings screen's store (C7) is its source for cards and the Images screen (C2).
connectScryfallSetting(scryfallSettingSource(settingsStore()));
// Sound (docs/design/sound.md): browsers start audio only from a user gesture, so the first pointer or key press unlocks it; the delegated interface
// sounds (audio/uiSounds.ts) give every button, toggle and text field its sound.
installSoundUnlock(soundEngine());
installUiSounds(document);
// Every sound is synthesized (no files to load): the page renders them while it is idle, the most needed first, so none is made at the moment it plays.
soundEngine().prerender(prerenderOrder());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
