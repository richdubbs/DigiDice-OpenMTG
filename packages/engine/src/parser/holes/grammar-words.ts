/**
 * The words the hole grammars use as literals (every `P('...')` phrase in this folder), as a static list. Owner: WP6.
 *
 * The chart parser tells an UNKNOWN word (guard G2, diagnostic `unknownWords`) from a known word in the wrong place by this set. It must not depend on which
 * grammar functions have run so far (many `P()` calls sit inside function bodies), so core.ts takes it from this list once, when the holes load, and then
 * stops registering. Generated: the test `review-fixes.test.ts` scans the sources and fails with the current list when this file is stale
 * (set OPENMTG_UPDATE_GRAMMAR_WORDS=1 to rewrite it).
 */
export const GRAMMAR_WORD_LIST: readonly string[] = [
  "'", "'s", ',', '--', 'a', 'abilities', 'ability', 'activate', 'activated', 'activates', 'active', 'addition', 'additional', 'adventure', 'all',
  'alone', 'among', 'amount', 'an', 'and', 'and/or', 'another', 'any', 'anywhere', 'are', "aren't", 'artifact', "artifacts'", 'as', 'at', 'attached',
  'attack', 'attacked', 'attackers', 'attacking', 'attacks', 'aura', 'auras', 'bargained', 'base', 'basic', 'battle', 'battlefield', 'become',
  'becomes', 'been', 'beginning', 'beheld', 'behold', 'being', 'between', 'black', 'blessing', 'blight', 'block', 'blocked', 'blockers', 'blocking',
  'blocks', 'blue', 'both', 'bottom', 'but', 'by', 'came', "can't", 'cannot', 'card', 'cards', "cards'", 'case', 'cast', 'casts', 'choice', 'choose',
  'chose', 'chosen', 'city', 'coin', 'coins', 'collect', 'collected', 'collects', 'color', 'colors', 'combat', 'comes', 'command', 'commander',
  'commanders', 'commit', 'commits', 'committed', 'common', 'completed', 'control', 'controlled', 'controller', 'controls', 'copies', 'copy', 'cost',
  'costs', 'counter', 'countered', 'counters', 'craft', 'create', 'created', 'creates', 'creature', 'creatures', "creatures'", 'crewed', 'crews',
  'crime', 'cycle', 'cycles', 'damage', 'deal', 'deals', 'dealt', 'declare', 'defending', 'defense', 'descended', 'destroyed', 'devotion', 'dice',
  'did', "didn't", 'die', 'died', 'dies', 'difference', 'different', 'differently', 'discard', 'discarded', 'discards', 'do', 'does', "doesn't",
  "don't", 'done', 'door', 'doors', 'double', 'down', 'draw', 'drawn', 'draws', 'drew', 'dungeon', 'during', 'dying', 'each', 'enchanted', 'end',
  'enduring', 'enter', 'entered', 'enters', 'equal', 'equip', 'equipped', 'escaped', 'even', 'every', 'evidence', 'exactly', 'except', 'excess',
  'exert', 'exerts', 'exhaust', 'exile', 'exiled', 'expend', 'expends', 'exploit', 'exploits', 'explore', 'explores', 'face', 'fewer', 'fewest',
  'fifth', 'finish', 'first', 'flip', 'for', 'forage', 'forages', 'foretold', 'fourth', 'from', 'full', 'gain', 'gained', 'gains', 'game', 'get',
  'gets', 'gift', 'graveyard', 'graveyards', 'greater', 'greatest', 'green', 'had', 'half', 'hand', 'hands', 'has', 'have', "haven't", 'he', 'heads',
  'her', 'highest', 'him', 'his', 'historic', 'if', 'in', 'initiative', 'into', 'is', "isn't", 'it', "it's", 'its', 'kicked', 'kicker', 'kinds',
  'land', 'last', 'least', 'leave', 'leaves', 'left', 'legendary', 'less', 'lesser', 'libraries', 'library', 'life', 'long', 'lose', 'loses', 'lost',
  'lowest', 'loyalty', 'main', 'mana', 'many', 'max', 'mayhem', 'mill', 'milled', 'minus', 'mode', 'monarch', 'monstrous', 'more', 'most', 'mount',
  'much', 'name', 'named', 'names', 'next', 'no', 'non', 'noncombat', 'none', 'nonland', 'nontoken', 'not', 'number', 'odd', 'of', 'on', 'one',
  'only', 'onto', 'opponent', 'opponents', "opponents'", 'or', 'other', 'outlaw', 'outlaws', 'own', 'owner', 'owners', "owners'", 'paid', 'pairs',
  'party', 'pay', 'permanent', 'permanents', "permanents'", 'phase', 'phases', 'planeswalker', 'planeswalkers', 'play', 'played', 'player',
  'players', "players'", 'plays', 'plus', 'poison', 'poisoned', 'postcombat', 'power', 'powers', 'precombat', 'prime', 'produced', 'promised', 'put',
  'quality', 'random', 'red', 'remain', 'remains', 'remove', 'removed', 'renowned', 'resolved', 'rest', 'result', 'return', 'returned', 'reveal',
  'revealed', 'right', 'ring', 'ring-bearer', 'ring-bearers', 'roll', 'rolls', 'rounded', 'sacrifice', 'sacrificed', 'sacrifices', 'saddled',
  'saddles', 'same', 'scried', 'search', 'searches', 'second', 'share', 'shares', 'she', 'shuffled', 'single', 'sneak', 'solve', 'source', 'sources',
  'spectacle', 'speed', 'spell', 'spells', 'spent', 'stack', 'starting', 'stays', 'step', 'steps', 'story', 'surge', 'surveilled', 'suspended',
  'symbols', 'tap', 'tapped', 'taps', 'target', 'targets', 'teamwork', 'tempts', 'than', 'that', "that's", 'the', 'their', 'them', 'there',
  "there's", 'they', "they're", "they've", 'third', 'this', 'those', 'three', 'tied', 'time', 'times', 'to', 'token', 'tokens', 'top', 'total',
  'toughness', 'toughnesses', 'transform', 'transforms', 'triggered', 'triple', 'turn', 'turned', 'twice', 'two', 'type', 'types', 'under', 'unlock',
  'unlocked', 'unspent', 'untap', 'untapped', 'until', 'up', 'upkeep', 'upkeeps', 'used', 'using', 'value', 'values', 'vehicle', 'vote', 'voted',
  'votes', 'voting', 'warp', 'warped', 'was', "wasn't", 'waterbend', 'way', 'web-slinging', 'were', "weren't", 'where', 'whichever', 'while',
  'white', 'who', 'win', 'wins', 'with', 'without', 'won', 'would', 'x', 'you', "you're", "you've", 'your', 'zone', '{e}', '{x}', '~',
];
