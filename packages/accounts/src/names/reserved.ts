/**
 * M14-2: the static reserved-name rules of design 6.2, as words. NameRules keys every word once, when it is built, and compares keys only (the key
 * rewrites literals: "Admin" has the key "adrnln"). These rules are public, so `nameReserved` reveals nothing about anyone.
 */

/** A name whose key equals the key of one of these is reserved. */
export const RESERVED_EXACT: readonly string[] = [
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help', 'system', 'server', 'official', 'operator', 'owner', 'openmtg',
  'digidice', 'guest', 'deleted', 'deletedplayer', 'hiddenplayer', 'anonymous', 'unknown', 'player', 'everyone', 'here', 'null', 'undefined', 'root',
];

/** A name whose key contains the key of one of these is reserved, unless the place is inside an exception's (RESERVED_EXCEPTIONS). */
export const RESERVED_CONTAINS: readonly string[] = ['openmtg', 'digidice', 'admin', 'moderator', 'official'];

/** Ordinary words and names that contain a word of RESERVED_CONTAINS ("badminton" holds "admin"; "Padmini" is a given name). */
export const RESERVED_EXCEPTIONS: readonly string[] = ['badminton', 'padmini'];

/** A name whose key ends in the key of this is reserved: guests are shown "Name (guest)", and no account may look like one. */
export const RESERVED_SUFFIX = 'guest';

/** The forced-rename series (9.4): the key of this, then one or more keys of the digits 0-9 ("Player 101010", "P1ayer 42"). */
export const RENAME_SERIES_PREFIX = 'Player';
/** How many digits a generated rename name has. */
export const RENAME_SERIES_DIGITS = 6;

/**
 * RESERVED_NAMES_FILE's default (used when the variable is unset), in the file's format: one name per line, compared by its key; `!word` an
 * exception to the contains-rules (an ordinary word holding "admin", "official", ...); blank lines and lines starting with "#" are skipped. Other
 * companies' and products' names, so that nobody poses as them; OpenMTG never uses them itself. An operator's file replaces this list, so it should
 * start from a copy of it.
 */
export const DEFAULT_RESERVED_NAMES = `# Reserved account names (RESERVED_NAMES_FILE): one per line, compared by the canonical key (case, look-alikes, accents and separators ignored).
# A line "!word" lets names that hold "word" through the built-in contains-rules (openmtg, digidice, admin, moderator, official) at that place.
# Companies and products a player could pose as. OpenMTG never uses these names itself.
Wizards of the Coast
Wizards
WotC
Hasbro
Magic The Gathering
MTG
MTGA
MTG Arena
Magic Arena
MTGO
Magic Online
Scryfall
EDHREC
Moxfield
Archidekt
TappedOut
MTGGoldfish
TCGplayer
Cardmarket
Card Kingdom
Star City Games
ChannelFireball
Untapped
17Lands
Cockatrice
XMage
Shopify
Discord
Twitch
YouTube
Reddit
GitHub
Patreon
Ko-fi
PayPal
Steam
`;
