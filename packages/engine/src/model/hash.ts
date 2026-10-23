/**
 * SHA-256 of the normalized Oracle text of all faces (design 12.3). Owner: WP1. Contract: model/api.ts#TextHash.
 *
 * The hash decides whether a stored entry (a rules pack, the LLM cache) still describes the card in the player's local index: an erratum or a new
 * wording changes it and the entry is discarded instead of attaching old behavior to new text (design 11.4). It must therefore be insensitive to
 * typography that differs between data sources (curly quotes, no-break spaces, line endings, Unicode composition) and to nothing else.
 */
import { sha256Hex } from './sha256';
import type { TextHash } from './api';

/** NFC, straight quotes, spaces collapsed, one line per rules line without blank lines. */
export function normalizeOracleText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/[ \t   ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

export const textHash: TextHash = (cardFacesOracleText) => sha256Hex(cardFacesOracleText.map(normalizeOracleText).join('\n//\n'));
