class_name Config
extends RefCounted
## From the New game screen's choices to an engine `GameConfig`: a port of the pure parts of the browser's
## packages/client/src/game/config.ts (`buildGameConfig` and its helpers), plus the format table of decks/formats.ts and the
## Commander variants of packages/engine/src/core/commander.ts. tests/model/test_config.gd checks it against configs exported
## from the TypeScript.
##
## Shapes (JSON, as the TypeScript source's types):
##   DeckList    {"main": [{"name", "count"}], "sideboard": [...], "commander"?: [...], "companion"?: [...]}
##   PlayerSetup {"name": String, "deck": DeckList, "companion"?: String or null (the deck check's reading; absent: the
##                deck's Companion section)}
##   StartOptions {"startingLife": int, "firstPlayer": "random" or a seat index}
##   StopSettings {"ownTurn": [Step], "opponentTurn": [Step], "fullControl": bool}

const PLAYER_IDS: Array[String] = ["p1", "p2", "p3", "p4"]
const MIN_PLAYERS: int = 2
const MAX_PLAYERS: int = 4
const DEFAULT_FORMAT: String = "casual"

## Arena-like default stops (packages/engine/src/core/create.ts DEFAULT_STOPS).
const DEFAULT_STOPS: Dictionary = {
	"ownTurn": ["main1", "declareBlockers", "main2"],
	"opponentTurn": ["declareAttackers", "declareBlockers", "end"],
	"fullControl": false,
}

## The steps of a turn in order (types/state.ts STEP_ORDER).
const STEP_ORDER: Array[String] = [
	"untap", "upkeep", "draw", "main1", "beginCombat", "declareAttackers", "declareBlockers", "combatDamage", "endCombat",
	"main2", "end", "cleanup",
]

## The Commander variants a game can be started in (config.ts COMMANDER_GAME_VARIANTS) and their rules (commander.ts).
const COMMANDER_VARIANTS: Dictionary = {
	"commander": {"name": "Commander", "startingLife": 40, "multiplayerLife": 40, "options": {"variant": "commander", "damageLimit": 21, "tax": 2, "freeMulligan": false}},
	"duel": {"name": "Duel Commander", "startingLife": 20, "multiplayerLife": null, "options": {"variant": "duel", "damageLimit": null, "tax": 2, "freeMulligan": false}},
	"brawl": {"name": "Brawl", "startingLife": 25, "multiplayerLife": 30, "options": {"variant": "brawl", "damageLimit": null, "tax": 2, "freeMulligan": true}},
	"standardbrawl": {"name": "Standard Brawl", "startingLife": 25, "multiplayerLife": 30, "options": {"variant": "standardbrawl", "damageLimit": null, "tax": 2, "freeMulligan": true}},
}

## The deck library's formats (decks/formats.ts FORMAT_OPTIONS): id, name, commander.
const FORMAT_OPTIONS: Array = [
	{"id": "casual", "name": "Casual (no restrictions)", "commander": false},
	{"id": "standard", "name": "Standard", "commander": false},
	{"id": "pioneer", "name": "Pioneer", "commander": false},
	{"id": "modern", "name": "Modern", "commander": false},
	{"id": "legacy", "name": "Legacy", "commander": false},
	{"id": "vintage", "name": "Vintage", "commander": false},
	{"id": "pauper", "name": "Pauper", "commander": false},
	{"id": "commander", "name": "Commander", "commander": true},
	{"id": "duel", "name": "Duel Commander", "commander": true},
	{"id": "brawl", "name": "Brawl", "commander": true},
	{"id": "standardbrawl", "name": "Standard Brawl", "commander": true},
	{"id": "historic", "name": "Historic", "commander": false},
	{"id": "timeless", "name": "Timeless", "commander": false},
]

const _FORMAT_ALIASES: Dictionary = {"freeform": "casual", "none": "casual", "edh": "commander"}

## Control characters removed from shown text (engine util/shown-text.ts CONTROL_RANGES), by code point.
const _CONTROL_RANGES: Array = [[0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]]


## The formats a game can be played in: every deck format except Commander formats that are not a game variant.
static func formats() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for f: Dictionary in FORMAT_OPTIONS:
		if not bool(f["commander"]) or commander_variant_of(String(f["id"])) != "":
			out.append({"id": f["id"], "label": f["name"]})
	return out


## The Commander variant a format id plays as, or "" for a format without a commander.
static func commander_variant_of(format: String) -> String:
	return format if COMMANDER_VARIANTS.has(format) else ""


## The id among `formats()` for a deck's saved format, or "" when it is not one offered.
static func offered_format(format: String) -> String:
	if format == "":
		return ""
	var lower := format.to_lower()
	var id: String = String(_FORMAT_ALIASES.get(lower, lower))
	for f: Dictionary in formats():
		if String(f["id"]) == id:
			return id
	return ""


## CR 103.4: 20 life, or the Commander variant's own starting life (multiplayer life with three or four players).
static func starting_life_for(format: String, players: int = 2) -> int:
	var v := commander_variant_of(format)
	if v == "":
		return 20
	var variant: Dictionary = COMMANDER_VARIANTS[v]
	if players > 2 and typeof(variant["multiplayerLife"]) != TYPE_NIL:
		return int(variant["multiplayerLife"])
	return int(variant["startingLife"])


## Why `format` cannot be played with `players` players, or "".
static func format_problem(format: String, players: int) -> String:
	var v := commander_variant_of(format)
	if players > 2 and v != "" and typeof(COMMANDER_VARIANTS[v]["multiplayerLife"]) == TYPE_NIL:
		return "%s is a two-player format: choose Commander, Brawl or Standard Brawl for %d players." % [COMMANDER_VARIANTS[v]["name"], players]
	return ""


static func _entries(deck: Dictionary, section: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for e: Variant in Val.list(deck, section):
		if e is Dictionary:
			out.append(e)
	return out


static func _commander_entries(deck: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for e: Dictionary in _entries(deck, "commander"):
		if Val.num(e, "count") > 0:
			out.append(e)
	return out


## CMP1 (CR 702.139a): the companion a player reveals, or "": the deck check's reading when there is one, else the deck's
## Companion section when it holds exactly one card.
static func companion_of(p: Dictionary) -> String:
	if p.has("companion"):
		return Val.as_text(p["companion"], "")
	var section: Array[Dictionary] = []
	for e: Dictionary in _entries(Val.dict(p, "deck"), "companion"):
		if Val.num(e, "count") > 0:
			section.append(e)
	if section.size() == 1 and Val.num(section[0], "count") == 1:
		return Val.text(section[0], "name")
	return ""


## Every Oracle name the decks use, once each, sorted (the body of POST /api/cards/defs): main decks, commanders, sideboards, companions.
static func deck_card_names(players: Array) -> Array[String]:
	var names: Dictionary = {}
	for p: Dictionary in players:
		var deck: Dictionary = Val.dict(p, "deck")
		for e: Dictionary in _entries(deck, "main") + _commander_entries(deck) + _entries(deck, "sideboard"):
			names[Val.text(e, "name")] = true
	for p: Dictionary in players:
		var c := companion_of(p)
		if c != "":
			names[c] = true
	var out: Array[String] = []
	out.assign(names.keys())
	out.sort()
	return out


## The Oracle names of the cards that start in the game (main decks and commanders), once each, sorted.
static func main_card_names(players: Array) -> Array[String]:
	var names: Dictionary = {}
	for p: Dictionary in players:
		var deck: Dictionary = Val.dict(p, "deck")
		for e: Dictionary in _entries(deck, "main") + _commander_entries(deck):
			names[Val.text(e, "name")] = true
	var out: Array[String] = []
	out.assign(names.keys())
	out.sort()
	return out


static func commander_count(deck: Dictionary) -> int:
	var n: int = 0
	for e: Dictionary in _commander_entries(deck):
		n += Val.num(e, "count")
	return n


## Why a deck cannot be played in a game of `format`, or "".
static func unplayable_reason(deck: Dictionary, format: String = DEFAULT_FORMAT) -> String:
	var commanders := commander_count(deck)
	var variant := commander_variant_of(format)
	if variant == "" and commanders > 0:
		return "This deck has a commander: choose a Commander format to play it (CR 903.3)."
	if variant != "" and commanders == 0:
		return "A Commander game needs a commander: set one in the deckbuilder (CR 903.3)."
	if variant != "" and commanders > 2:
		return "This deck has %d commanders: a deck has one, or two with a partner ability (CR 702.124)." % commanders
	var any_main := false
	for e: Dictionary in _entries(deck, "main"):
		if Val.num(e, "count") > 0:
			any_main = true
	if not any_main:
		return "The deck has no cards in its main deck."
	return ""


## Things the players should know about how a deck enters the game.
static func deck_notes(deck: Dictionary) -> Array[String]:
	var notes: Array[String] = []
	var side: int = 0
	for e: Dictionary in _entries(deck, "sideboard"):
		side += Val.num(e, "count")
	if side > 0:
		notes.append("The sideboard (%d cards) stays outside the game (CR 100.4); learn can put its Lesson cards into your hand (CR 701.48a)." % side)
	var companion := companion_of({"name": "", "deck": deck})
	if companion != "":
		notes.append("%s is your companion: it starts outside the game, revealed to both players; once per game, in a main phase of your turn with an empty stack, you may pay {3} to put it into your hand (CR 702.139a, 116.2g)." % companion)
	return notes


## The game's configuration (config.ts `buildGameConfig`). `args`: {"players": Array[PlayerSetup], "defs": {name: CardDef}
## (from POST /api/cards/defs), "seed": String, "start": StartOptions, "stops": StopSettings, "commander"?: variant id or "" }.
## Returns {"ok": true, "config": GameConfig} or {"ok": false, "error": text} (the TypeScript's ConfigBuildError).
static func build_game_config(args: Dictionary) -> Dictionary:
	var players: Array = Val.list(args, "players")
	var defs: Dictionary = Val.dict(args, "defs")
	var seed_text: String = Val.text(args, "seed")
	var start: Dictionary = Val.dict(args, "start")
	var stops: Dictionary = Val.dict(args, "stops")
	if players.size() < MIN_PLAYERS or players.size() > MAX_PLAYERS:
		return _fail("A game has %d to %d players (CR 800.1)." % [MIN_PLAYERS, MAX_PLAYERS])
	var variant: String = commander_variant_of(Val.text(args, "commander", ""))
	var used: Dictionary = {} # def id -> def, in first-use order (the TypeScript Map)
	var missing: Dictionary = {}
	var player_configs: Array[Dictionary] = []
	for i: int in range(players.size()):
		var p: Dictionary = Val.as_dict(players[i])
		var deck_list: Dictionary = Val.dict(p, "deck")
		var deck := _ids_of(_entries(deck_list, "main"), defs, used, missing)
		var companion_name := companion_of(p)
		var companion: String = ""
		if companion_name != "":
			var ids := _ids_of([{"name": companion_name, "count": 1}], defs, used, missing)
			if not ids.is_empty():
				companion = ids[0]
		var skip_companion: bool = companion != ""
		var sideboard: Array[String] = []
		for e: Dictionary in _entries(deck_list, "sideboard"):
			var def_v: Variant = defs.get(Val.text(e, "name"))
			if not (def_v is Dictionary):
				continue
			var def_id: String = Val.text(def_v, "id")
			used[def_id] = def_v
			for _n: int in range(Val.num(e, "count")):
				if skip_companion and def_id == companion:
					skip_companion = false
					continue
				sideboard.append(def_id)
		var config: Dictionary = {"id": PLAYER_IDS[i], "name": player_name(Val.text(p, "name")), "deck": deck}
		if not sideboard.is_empty():
			config["sideboard"] = sideboard
		if companion != "":
			config["companion"] = companion
		# A copy of the stops with fresh step lists, keys in the stops' own order ({ ...stops, ownTurn: [...], opponentTurn: [...] }).
		var stop_copy: Dictionary = {}
		for k: Variant in stops.keys():
			stop_copy[k] = stops[k]
		stop_copy["ownTurn"] = Val.texts(stops, "ownTurn")
		stop_copy["opponentTurn"] = Val.texts(stops, "opponentTurn")
		config["stops"] = stop_copy
		if variant != "":
			config["commanders"] = _ids_of(_commander_entries(deck_list), defs, used, missing)
		player_configs.append(config)
	if not missing.is_empty():
		var names: Array[String] = []
		names.assign(missing.keys())
		names.sort()
		return _fail("No card definition for: %s." % ", ".join(names))
	var multiplayer: bool = player_configs.size() > 2
	var first: int
	var first_v: Variant = start.get("firstPlayer", "random")
	if first_v is String and first_v == "random":
		first = random_seat(seed_text, player_configs.size())
	elif Patch.is_index(first_v):
		first = int(first_v)
	else:
		return _fail("The player chosen to play first is not in this game.")
	if first < 0 or first >= player_configs.size():
		return _fail("The player chosen to play first is not in this game.")
	var options: Dictionary = {"startingLife": Val.num(start, "startingLife", 20), "startingPlayer": PLAYER_IDS[first]}
	if variant != "":
		var variant_rules: Dictionary = COMMANDER_VARIANTS[variant]["options"]
		options["commander"] = variant_rules.duplicate(true)
	if multiplayer:
		options["multiplayer"] = {"variant": "freeForAll", "attack": "multiple"}
	var seated: Array = seat_at_random(player_configs, seed_text) if multiplayer else player_configs
	return {"ok": true, "config": {"seed": seed_text, "players": seated, "defs": used.values(), "options": options}}


static func _fail(message: String) -> Dictionary:
	return {"ok": false, "error": message}


## Each entry's definition id, once per copy; names without a definition go to `missing`.
static func _ids_of(entries: Array, defs: Dictionary, used: Dictionary, missing: Dictionary) -> Array[String]:
	var out: Array[String] = []
	for e: Dictionary in entries:
		var name := Val.text(e, "name")
		var def_v: Variant = defs.get(name)
		if not (def_v is Dictionary):
			missing[name] = true
			continue
		var def_id: String = Val.text(def_v, "id")
		used[def_id] = def_v
		for _n: int in range(Val.num(e, "count")):
			out.append(def_id)
	return out


## FNV-1a of a text: the seed's hash for the random choices here (the same hash as the art seed).
static func seed_hash(text: String) -> int:
	return ArtSeed.hash_string(text)


## A seat picked at random from the game's seed, so the same seed always gives the same first player.
static func random_seat(seed_text: String, seats: int) -> int:
	return seed_hash(seed_text) % seats


## The players in a seating order shuffled from the seed (Fisher-Yates, one hash per swap; CR 806.3).
static func seat_at_random(players: Array, seed_text: String) -> Array:
	var out: Array = players.duplicate()
	var i: int = out.size() - 1
	while i > 0:
		var j: int = seed_hash("%s:seating:%d" % [seed_text, i]) % (i + 1)
		var tmp: Variant = out[i]
		out[i] = out[j]
		out[j] = tmp
		i -= 1
	return out


## A player's name as the game gets it: without control characters, trimmed (engine util/shown-text.ts `cleanText`).
static func player_name(typed: String) -> String:
	return clean_text(typed).strip_edges()


static func clean_text(s: String) -> String:
	var out := ""
	for i: int in range(s.length()):
		var c := s.unicode_at(i)
		var control := false
		for r: Array in _CONTROL_RANGES:
			if c >= int(r[0]) and c <= int(r[1]):
				control = true
				break
		if not control:
			out += String.chr(c)
	return out


## A fresh seed: 128 random bits as hex (services.ts `newSeed`).
static func new_seed() -> String:
	var crypto := Crypto.new()
	return crypto.generate_random_bytes(16).hex_encode()
