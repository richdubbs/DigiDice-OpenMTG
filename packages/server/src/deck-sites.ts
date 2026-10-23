/**
 * Deck-site links in pasted decklist text (docs/design/decks-and-formats.md "Deck links", docs/research/deck-sites.md). A link is recognized by its host
 * and answered with that site's export-and-paste steps. NO request is ever made to the site: no deck site permits link import today, and the two that
 * might (AetherHub, MTGTop8) stay switched off until they say yes. The steps are paraphrased and never claim the site permits anything.
 */
import type { DeckSiteLink } from './api';

interface Site {
  site: string;
  hosts: readonly string[];
  steps: readonly string[];
}

const SITES: readonly Site[] = [
  { site: 'Moxfield', hosts: ['moxfield.com'], steps: ['Open the deck on Moxfield.', 'Choose Export, then "Copy for MTGO".', 'Paste the copied list here.'] },
  { site: 'Archidekt', hosts: ['archidekt.com'], steps: ['Open the deck on Archidekt.', "Use the deck's Export option and copy the text list.", 'Paste the list here.'] },
  {
    site: 'TappedOut',
    hosts: ['tappedout.net'],
    steps: ["Open the deck on TappedOut.", "Use the deck page's export option and copy the list.", 'Paste the list here, then check the commander: the export may not mark it.'],
  },
  { site: 'MTGGoldfish', hosts: ['mtggoldfish.com'], steps: ['Open the deck on MTGGoldfish.', 'Use Download, then "Text File".', 'Paste the text here.'] },
  { site: 'Deckstats', hosts: ['deckstats.net'], steps: ['Open the deck on Deckstats.', 'Click Export in the deck toolbar and copy the list as text.', 'Paste the list here.'] },
  {
    site: 'AetherHub',
    hosts: ['aetherhub.com'],
    steps: [
      'Open the deck on AetherHub.',
      "Open the deck's Export panel and choose Text List (or MTG Arena).",
      'Paste the text here. In a Commander deck the commander is listed under Sideboard: move it to a "Commander" section.',
    ],
  },
  { site: 'MTGTop8', hosts: ['mtgtop8.com'], steps: ['Open the deck on MTGTop8.', 'Use Export, then MTGO.', 'Paste the text here.'] },
];

const GENERIC_STEPS: readonly string[] = [
  'OpenMTG does not open deck links.',
  'Export the deck as text on that site (MTGO or MTG Arena format) and paste the list here.',
];

const KNOWN_HOSTS = SITES.flatMap((s) => s.hosts).map((h) => h.replace(/\./g, '\\.')).join('|');
/** A web address with a scheme, or a bare known deck-site host with a path ("moxfield.com/decks/..."). */
const LINK_RE = new RegExp(`\\bhttps?://[^\\s<>"'\`]+|\\b(?:[a-z0-9-]+\\.)*(?:${KNOWN_HOSTS})/[^\\s<>"'\`]*`, 'gi');
const MAX_LINKS = 20;

function siteOf(host: string): Site | undefined {
  return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

/** The host of a link as typed, or null when it is not a usable address. Parsing only: nothing is fetched. */
function hostOf(link: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface ExtractedLinks {
  links: DeckSiteLink[];
  /**
   * The text with invisible format characters removed and every line that held a link turned into a comment, so line numbers and MTGO blank-line
   * sideboards are unchanged and the prose around a link ("Check out my deck:") is never read as a card name.
   */
  text: string;
  /** The text around a link on its line, per 1-based line number (reported to the player as ignored). */
  ignored: { line: number; text: string }[];
}

/** Unicode format characters (Cf: zero-width space and joiners, BOM, soft hyphen, direction marks) that web pages and chats leave in copied text. */
const INVISIBLE = /\p{Cf}/gu;

/** Find deck links in pasted text and take them out of the decklist. */
export function extractDeckLinks(input: string): ExtractedLinks {
  const links: DeckSiteLink[] = [];
  const ignored: { line: number; text: string }[] = [];
  const seen = new Set<string>();
  const lines = input.replace(INVISIBLE, '').split(/(\r\n|\r|\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]!;
    let found = false;
    const rest = line.replace(LINK_RE, (raw) => {
      const url = raw.replace(/[).,;:!?\]]+$/, '');
      const host = hostOf(url);
      if (host === null) return raw;
      found = true;
      if (!seen.has(url) && links.length < MAX_LINKS) {
        seen.add(url);
        const site = siteOf(host);
        links.push(site ? { site: site.site, url, exportSteps: [...site.steps], known: true } : { site: host, url, exportSteps: [...GENERIC_STEPS], known: false });
      }
      return ' ';
    });
    if (found) {
      if (/[\p{L}\p{N}]/u.test(rest)) ignored.push({ line: i / 2 + 1, text: rest.trim().replace(/\s+/g, ' ') });
      lines[i] = '//';
    }
  }
  return { links, text: lines.join(''), ignored };
}
