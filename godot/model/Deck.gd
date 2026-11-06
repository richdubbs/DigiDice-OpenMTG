class_name DeckModel
extends RefCounted
## The saved deck (packages/client/src/decks/model.ts, formats.ts, textio.ts, stats.ts, look.ts): the record, its sections, the
## changes the deck screens make, the export texts, reading a pasted list's header, a deck's colours and its stats. The library
## itself is the server's (GET /api/library/decks, GET /api/library/decks/<id>, POST /api/library/decks/save and /delete).
##
## Deck {id, name, format, main, sideboard, commander, companion: [{name, count, oracleId?}], notes, createdAt, updatedAt,
## cover?}. `updatedAt` is also the version a save names as the one it replaces.

const SECTIONS: Array[String] = ["commander", "companion", "main", "sideboard"]
const SECTION_LABEL: Dictionary = {"commander": "Commander", "companion": "Companion", "main": "Main deck", "sideboard": "Sideboard"}
## "Removed X from the main deck."
const SECTION_THE: Dictionary = {"commander": "the commander", "companion": "the companion", "main": "the main deck", "sideboard": "the sideboard"}
const WUBRG: Array[String] = ["W", "U", "B", "R", "G"]
const COLOR_NAMES: Dictionary = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green", "C": "Colorless"}
const EXPORT_KINDS: Array = [["arena", "Arena"], ["mtgo", "MTGO"], ["text", "Plain text"]]
const EXPORT_HINTS: Dictionary = {
	"arena": "MTG Arena import: About/Name, Commander, Companion, Deck and Sideboard blocks.",
	"mtgo": "MTGO text: main deck, a blank line, then the sideboard. MTGO has no commander block, so the commander and companion go in the sideboard.",
	"text": "Readable text with a header per section; also keeps the deck name, format, cover card and notes (best for a backup).",
}
const GENERIC_LINK_STEPS: Array[String] = [
	"Open the deck on its site and use the site's Export option to copy the list as text (MTGO or Arena format).",
	"Paste that text here.",
]
## Stats: the type groups, in the order a card is counted (its first match) and in the order they are shown.
const TYPE_ORDER: Array[String] = ["Creature", "Land", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Kindred"]
const TYPE_SHOWN: Array[String] = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Kindred", "Land"]
const CURVE_LABELS: Array[String] = ["1-", "2", "3", "4", "5", "6+"]
const BASIC_TYPES: Dictionary = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G"}
## The deck list's row tones (DeckSectionList.tsx toneOf).
const TONES: Dictionary = {
	"W": Color("#e4e2d4"), "U": Color("#2f8bff"), "B": Color("#9a74c2"), "R": Color("#ff5a3c"), "G": Color("#2ecc71"),
	"multi": Color("#f2c14e"), "land": Color("#b79a6e"), "artifact": Color("#9fb3c8"), "colorless": Color("#8d98ab"),
}

static var _re_any_color: RegEx = null
static var _re_add: RegEx = null
static var _re_symbol: RegEx = null
static var _words: Dictionary = {}


# ---- formats ------------------------------------------------------------------------------------------------------------

static func format_name(id: String) -> String:
	for f: Dictionary in Config.FORMAT_OPTIONS:
		if String(f["id"]) == id:
			return String(f["name"])
	return id


static func is_commander_format(id: String) -> bool:
	for f: Dictionary in Config.FORMAT_OPTIONS:
		if String(f["id"]) == id:
			return bool(f["commander"])
	return false


## The format the deck checks name ("" for Casual: no card-pool rules).
static func legality_key(id: String) -> String:
	for f: Dictionary in Config.FORMAT_OPTIONS:
		if String(f["id"]) == id:
			return "" if id == "casual" else id
	return ""


## What POST /api/decks/validate checks a deck as ("freeform" for Casual).
static func validate_format(id: String) -> String:
	return "freeform" if id == "casual" or id == "" else id


## A deck's size: 100 in Commander, Duel Commander and Brawl, else 60.
static func deck_size(id: String) -> int:
	return 100 if id in ["commander", "duel", "brawl"] else 60


## A format named in a deck file ("EDH", "Duel commander", "freeform"…), or "".
static func find_format_id(text: String) -> String:
	var t := text.strip_edges().to_lower()
	var aliases := {"edh": "commander", "freeform": "casual", "duel commander": "duel", "standard brawl": "standardbrawl"}
	if aliases.has(t):
		return String(aliases[t])
	for f: Dictionary in Config.FORMAT_OPTIONS:
		if String(f["id"]) == t or String(f["name"]).to_lower() == t:
			return String(f["id"])
	return ""


# ---- the record -------------------------------------------------------------------------------------------------------------

## A random UUID (version 4).
static func new_id() -> String:
	var b := Crypto.new().generate_random_bytes(16)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	var h := b.hex_encode()
	return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]


## Now as an ISO time with milliseconds, in UTC ("2026-10-12T09:30:00.000Z").
static func now_iso() -> String:
	var t := Time.get_unix_time_from_system()
	return "%s.%03dZ" % [Time.get_datetime_string_from_unix_time(int(t), false), int(fmod(t, 1.0) * 1000.0)]


static func empty_deck(deck_name: String, format: String, now: String = "", id: String = "") -> Dictionary:
	var at := now if now != "" else now_iso()
	return {"id": id if id != "" else new_id(), "name": deck_name, "format": format, "main": [], "sideboard": [], "commander": [],
		"companion": [], "notes": "", "createdAt": at, "updatedAt": at}


## A copy with a new id and "Copy of <name>" (notes, format and cover kept).
static func duplicate_deck(d: Dictionary, now: String = "") -> Dictionary:
	var at := now if now != "" else now_iso()
	var copy := d.duplicate(true)
	copy["id"] = new_id()
	copy["name"] = "Copy of %s" % Val.text(d, "name")
	copy["createdAt"] = at
	copy["updatedAt"] = at
	return copy


## "New deck", "New deck 2", … : the first not taken (case-sensitively).
static func next_name(decks: Array) -> String:
	var taken := {}
	for d: Variant in decks:
		taken[Val.text(Val.as_dict(d), "name")] = true
	if not taken.has("New deck"):
		return "New deck"
	var n := 2
	while taken.has("New deck %d" % n):
		n += 1
	return "New deck %d" % n


static func shown_name(d: Dictionary) -> String:
	var n := Val.text(d, "name")
	return n if n.strip_edges() != "" else "(unnamed deck)"


static func section_count(d: Dictionary, section: String) -> int:
	var n := 0
	for e: Variant in Val.list(d, section):
		n += int(Val.num(Val.as_dict(e), "count"))
	return n


static func count_of(d: Dictionary, section: String, card_name: String) -> int:
	for e: Variant in Val.list(d, section):
		var entry := Val.as_dict(e)
		if Val.text(entry, "name") == card_name:
			return int(Val.num(entry, "count"))
	return 0


## Copies of a card across the four sections.
static func copies(d: Dictionary, card_name: String) -> int:
	var n := 0
	for s: String in SECTIONS:
		n += count_of(d, s, card_name)
	return n


## `delta` more copies (fewer when negative) of a card in a section; an entry at 0 goes. The same dictionary back when nothing
## changes, else a new one (the section keeps its order, a new card goes last).
static func add_card(d: Dictionary, section: String, card_name: String, oracle_id: String = "", delta: int = 1) -> Dictionary:
	var list: Array = Val.list(d, section)
	var at := -1
	for i: int in list.size():
		if Val.text(Val.as_dict(list[i]), "name") == card_name:
			at = i
			break
	var next: Array = list.duplicate(true)
	if at < 0:
		if delta <= 0:
			return d
		var entry := {"name": card_name, "count": delta}
		if oracle_id != "":
			entry["oracleId"] = oracle_id
		next.append(entry)
	else:
		var entry: Dictionary = next[at]
		var count := int(Val.num(entry, "count")) + delta
		if oracle_id != "" and Val.text(entry, "oracleId") == "":
			entry["oracleId"] = oracle_id
		if count > 0:
			entry["count"] = count
		else:
			next.remove_at(at)
	var out := d.duplicate()
	out[section] = next
	return out


## Move `count` copies (every copy when -1) of a card to another section, its Oracle id with it.
static func move_card(d: Dictionary, from: String, to: String, card_name: String, count: int = -1) -> Dictionary:
	if from == to:
		return d
	var have := count_of(d, from, card_name)
	if have <= 0:
		return d
	var n := have if count < 0 else mini(count, have)
	var oracle := ""
	for e: Variant in Val.list(d, from):
		if Val.text(Val.as_dict(e), "name") == card_name:
			oracle = Val.text(Val.as_dict(e), "oracleId")
	return add_card(add_card(d, from, card_name, "", -n), to, card_name, oracle, n)


## Main and sideboard, plus commander and companion when they hold cards (what the deck checks and New game take).
static func to_deck_list(d: Dictionary) -> Dictionary:
	var out := {"main": Val.list(d, "main").duplicate(true), "sideboard": Val.list(d, "sideboard").duplicate(true)}
	for s: String in ["commander", "companion"]:
		if not Val.list(d, s).is_empty():
			out[s] = Val.list(d, s).duplicate(true)
	return out


## Every card name of the main deck and the commander (what colours and stats count), in order, once each.
static func playing_names(d: Dictionary) -> Array[String]:
	var out: Array[String] = []
	for s: String in ["commander", "main"]:
		for e: Variant in Val.list(d, s):
			var n := Val.text(Val.as_dict(e), "name")
			if n != "" and not out.has(n):
				out.append(n)
	return out


# ---- export (textio.ts exportDeck) ---------------------------------------------------------------------------------------------

static func _lines(entries: Array) -> Array[String]:
	var out: Array[String] = []
	for e: Variant in entries:
		var entry := Val.as_dict(e)
		out.append("%d %s" % [int(Val.num(entry, "count")), Val.text(entry, "name")])
	return out


static func _block(header: String, entries: Array) -> Array[String]:
	var out: Array[String] = []
	if entries.is_empty():
		return out
	out.append(header)
	out.append_array(_lines(entries))
	out.append("")
	return out


static func _joined(lines: Array[String]) -> String:
	var text := "\n".join(lines)
	while text.ends_with("\n\n"):
		text = text.substr(0, text.length() - 1)
	return text


## The deck as text: "arena", "mtgo" or "text" (plain, which also keeps the name, format, cover and notes).
static func export_text(d: Dictionary, kind: String) -> String:
	var lines: Array[String] = []
	match kind:
		"arena":
			lines.append_array(["About", "Name %s" % Val.text(d, "name"), ""])
			lines.append_array(_block("Commander", Val.list(d, "commander")))
			lines.append_array(_block("Companion", Val.list(d, "companion")))
			lines.append("Deck")
			lines.append_array(_lines(Val.list(d, "main")))
			lines.append("")
			lines.append_array(_block("Sideboard", Val.list(d, "sideboard")))
		"mtgo":
			var side: Array = Val.list(d, "commander") + Val.list(d, "companion") + Val.list(d, "sideboard")
			if not Val.list(d, "main").is_empty():
				lines.append_array(_lines(Val.list(d, "main")))
				if not side.is_empty():
					lines.append("")
					lines.append_array(_lines(side))
				lines.append("")
			elif not side.is_empty():
				for l: String in _lines(side):
					lines.append("SB: %s" % l)
				lines.append("")
		_:
			lines.append("// %s" % Val.text(d, "name"))
			lines.append("// Format: %s" % format_name(Val.text(d, "format")))
			if Val.text(d, "cover") != "":
				lines.append("// Cover: %s" % Val.text(d, "cover"))
			var notes := Val.text(d, "notes").rstrip(" \t\r\n")
			if notes != "":
				var note_lines := notes.replace("\r\n", "\n").replace("\r", "\n").split("\n")
				for i: int in note_lines.size():
					if i == 0:
						lines.append("// Notes: %s" % note_lines[0])
					else:
						lines.append("// %s" % note_lines[i] if note_lines[i] != "" else "//")
			lines.append("")
			var any := false
			for s: Array in [["commander", "Commander"], ["companion", "Companion"], ["main", "Main"], ["sideboard", "Sideboard"]]:
				var block := _block(String(s[1]), Val.list(d, String(s[0])))
				any = any or not block.is_empty()
				lines.append_array(block)
			if not any:
				lines.append_array(["Main", ""])
	return "" if lines.is_empty() else _joined(lines)


## "<name> (arena).txt": the name with \ / : * ? " < > | turned into spaces ("deck" when nothing is left).
static func export_file_name(deck_name: String, kind: String) -> String:
	var n := deck_name
	for ch: String in ["\\", "/", ":", "*", "?", "\"", "<", ">", "|"]:
		n = n.replace(ch, " ")
	var parts: PackedStringArray = []
	for w: String in n.split(" ", false):
		if w.strip_edges() != "":
			parts.append(w.strip_edges())
	var base := " ".join(parts)
	return "%s (%s).txt" % [base if base != "" else "deck", kind]


# ---- import (textio.ts readDeckHeader, deckFromResolve, replaceLineName) ------------------------------------------------------

## The name, format, cover and notes a list carries: an Arena "About / Name …" block, or the leading comment lines of a plain
## export ("// name", "// Format: …", "// Cover: …", "// Notes: …").
static func read_header(text: String) -> Dictionary:
	var out := {}
	var lines := text.trim_prefix("﻿").replace("\r\n", "\n").replace("\r", "\n").split("\n")
	for i: int in lines.size():
		var l := lines[i].strip_edges()
		if l.to_lower() == "about" or l.to_lower() == "about:":
			for j: int in range(i + 1, lines.size()):
				var next := lines[j].strip_edges()
				if next == "":
					continue
				if next.to_lower().begins_with("name ") or next.to_lower().begins_with("name\t"):
					out["name"] = next.substr(5).strip_edges()
				break
			break
	var notes: Array[String] = []
	var in_notes := false
	var started := false
	for raw: String in lines:
		var l := raw.strip_edges()
		if l == "":
			if in_notes:
				break
			continue
		var body := ""
		if l.begins_with("//"):
			body = l.substr(2)
		elif l.begins_with("#"):
			body = l.substr(1)
		else:
			break
		if body.begins_with(" "):
			body = body.substr(1)
		started = true
		if in_notes:
			notes.append(body)
			continue
		var t := body.strip_edges()
		var lower := t.to_lower()
		# "format:", "cover:" or "notes:", then one optional space or tab.
		var value := ""
		for key: String in ["format:", "cover:", "notes:"]:
			if lower.begins_with(key):
				value = t.substr(key.length())
				if value.begins_with(" ") or value.begins_with("\t"):
					value = value.substr(1)
		if lower.begins_with("format:"):
			var f := find_format_id(value)
			if f != "":
				out["format"] = f
		elif lower.begins_with("cover:"):
			if value.strip_edges() != "":
				out["cover"] = value.strip_edges()
		elif lower.begins_with("notes:"):
			in_notes = true
			notes.append(value)
		elif not out.has("name") and t != "":
			out["name"] = t
	if started and not notes.is_empty():
		var joined := "\n".join(notes).rstrip(" \t\n\r")
		if joined != "":
			out["notes"] = joined
	return out


## A deck from POST /api/decks/resolve's answer: its cards in their sections (same names merged), unknown cards left out.
static func deck_from_resolve(res: Dictionary, deck_name: String, format: String, header: Dictionary, now: String = "") -> Dictionary:
	var d := empty_deck(deck_name, format, now)
	for c: Variant in Val.list(res, "cards"):
		var card := Val.as_dict(c)
		var section := Val.text(card, "section", "main")
		if not SECTIONS.has(section):
			section = "main"
		d = add_card(d, section, Val.text(card, "name"), Val.text(card, "oracleId"), int(Val.num(card, "count", 1)))
	if Val.text(header, "notes") != "":
		d["notes"] = Val.text(header, "notes")
	if Val.text(header, "cover") != "":
		d["cover"] = Val.text(header, "cover")
	return d


## Line `line` (from 1) with the first case-insensitive `old` replaced by `new` (the count, "SB:" and set code stay).
static func replace_line_name(text: String, line: int, old: String, new: String) -> String:
	var lines := text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
	if line < 1 or line > lines.size():
		return text
	var l := lines[line - 1]
	var at := l.to_lower().find(old.to_lower())
	if at < 0:
		return text
	lines[line - 1] = l.substr(0, at) + new + l.substr(at + old.length())
	return "\n".join(lines)


## "1 maybeboard card was left out." / "3 maybeboard cards will be left out."
static func ignored_text(n: int, verb: String) -> String:
	if n == 1:
		return "1 maybeboard card %s left out." % ("was" if verb == "were" else "will be")
	return "%d maybeboard cards %s left out." % [n, verb]


# ---- colours, tones and stats (useDeckInfo deckColors, stats.ts) ------------------------------------------------------------------

static func front_type_line(card: Dictionary) -> String:
	var faces: Array = Val.list(card, "faces")
	return Val.text(Val.as_dict(faces[0]), "typeLine") if not faces.is_empty() else ""


static func is_land(card: Dictionary) -> bool:
	return _word(front_type_line(card), "Land")


static func _word(text: String, word: String) -> bool:
	if not _words.has(word):
		_words[word] = RegEx.create_from_string("\\b%s\\b" % word)
	return (_words[word] as RegEx).search(text) != null


## The colours of the non-land cards of the main deck and the commander, in WUBRG order. `cards`: name -> CardSummary.
static func deck_colors(d: Dictionary, cards: Dictionary) -> String:
	var seen := {}
	for n: String in playing_names(d):
		var card := Val.as_dict(cards.get(n))
		if card.is_empty() or is_land(card):
			continue
		for c: Variant in Val.list(card, "colors"):
			seen[String(c)] = true
	var out := ""
	for c: String in WUBRG:
		if seen.has(c):
			out += c
	return out


## The commanders' colour identity (WUBRG order; "C" when it is empty; "" with no commander or no card data yet).
static func commander_identity(d: Dictionary, cards: Dictionary) -> String:
	var list: Array = Val.list(d, "commander")
	if list.is_empty():
		return ""
	var seen := {}
	for e: Variant in list:
		var card := Val.as_dict(cards.get(Val.text(Val.as_dict(e), "name")))
		if card.is_empty():
			return ""
		for c: Variant in Val.list(card, "colorIdentity"):
			seen[String(c)] = true
	var out := ""
	for c: String in WUBRG:
		if seen.has(c):
			out += c
	return out if out != "" else "C"


## A deck-list row's tone: land, multicolour, its one colour, artifact or colourless.
static func tone_of(card: Dictionary) -> Color:
	if card.is_empty():
		return TONES["colorless"]
	if is_land(card):
		return TONES["land"]
	var colors: Array = Val.list(card, "colors")
	if colors.size() > 1:
		return TONES["multi"]
	if colors.size() == 1 and TONES.has(String(colors[0])):
		return TONES[String(colors[0])]
	return TONES["artifact"] if _word(front_type_line(card), "Artifact") else TONES["colorless"]


## The colours a land can make: its basic land types, all five for "any color", and the {W}… of its "Add …" sentences.
static func land_colors(card: Dictionary) -> Array[String]:
	if _re_any_color == null:
		_re_any_color = RegEx.create_from_string("(?i)mana of any (?:one )?color|any color of mana")
		_re_add = RegEx.create_from_string("Add ([^.]*)")
		_re_symbol = RegEx.create_from_string("\\{([WUBRG])\\}")
	var seen := {}
	var type_line := front_type_line(card)
	for t: String in BASIC_TYPES:
		if _word(type_line, t):
			seen[BASIC_TYPES[t]] = true
	# The front face's text only.
	var faces: Array = Val.list(card, "faces")
	var text := Val.text(Val.as_dict(faces[0]), "oracleText") if not faces.is_empty() else ""
	if _re_any_color.search(text) != null:
		for c: String in WUBRG:
			seen[c] = true
	for m: RegExMatch in _re_add.search_all(text):
		for s: RegExMatch in _re_symbol.search_all(m.get_string(1)):
			seen[s.get_string(1)] = true
	var out: Array[String] = []
	for c: String in WUBRG:
		if seen.has(c):
			out.append(c)
	return out


## The coloured symbols of a cost, each colour of a symbol once ({G/W} counts both, {G/P} counts G).
static func cost_pips(cost: String) -> Dictionary:
	var out := {}
	var i := 0
	while true:
		var a := cost.find("{", i)
		if a < 0:
			break
		var b := cost.find("}", a)
		if b < 0:
			break
		var seen := {}
		for part: String in cost.substr(a + 1, b - a - 1).split("/"):
			if WUBRG.has(part) and not seen.has(part):
				seen[part] = true
				out[part] = int(out.get(part, 0)) + 1
		i = b + 1
	return out


## The numbers Deck Details shows (stats.ts), over the main deck and the commander. `cards`: name -> CardSummary.
static func stats(d: Dictionary, cards: Dictionary) -> Dictionary:
	var creature_curve: Array[int] = [0, 0, 0, 0, 0, 0]
	var other_curve: Array[int] = [0, 0, 0, 0, 0, 0]
	var pips := {}
	var sources := {}
	var groups := {}
	var lands := 0
	var not_loaded := 0
	var mv_sum := 0.0
	var spell_count := 0
	for s: String in ["commander", "main"]:
		for e: Variant in Val.list(d, s):
			var entry := Val.as_dict(e)
			var n := int(Val.num(entry, "count"))
			var card := Val.as_dict(cards.get(Val.text(entry, "name")))
			if card.is_empty():
				not_loaded += n
				continue
			var type_line := front_type_line(card)
			var group := ""
			for t: String in TYPE_ORDER:
				if _word(type_line, t):
					group = t
					break
			if group != "":
				var g: Dictionary = groups.get(group, {"count": 0, "subtypes": {}})
				g["count"] = int(g["count"]) + n
				var dash := type_line.find("—")
				if dash >= 0:
					var subs: Dictionary = g["subtypes"]
					for sub: String in type_line.substr(dash + 1).split(" ", false):
						subs[sub] = int(subs.get(sub, 0)) + n
				groups[group] = g
			if is_land(card):
				lands += n
				for c: String in land_colors(card):
					sources[c] = int(sources.get(c, 0)) + n
				continue
			var mv := Val.real(card, "manaValue")
			var bucket := mini(maxi(1, int(floor(mv))), 6) - 1
			if _word(type_line, "Creature"):
				creature_curve[bucket] += n
			else:
				other_curve[bucket] += n
			mv_sum += mv * n
			spell_count += n
			var cost := ""
			var faces: Array = Val.list(card, "faces")
			if Val.text(card, "layout") == "split":
				for f: Variant in faces:
					cost += Val.text(Val.as_dict(f), "manaCost")
			elif not faces.is_empty():
				cost = Val.text(Val.as_dict(faces[0]), "manaCost")
			var p := cost_pips(cost)
			for c: String in p:
				pips[c] = int(pips.get(c, 0)) + int(p[c]) * n
	var shown_groups: Array = []
	for t: String in TYPE_SHOWN:
		if groups.has(t):
			var subs: Dictionary = groups[t]["subtypes"]
			var sub_list: Array = []
			for k: String in subs:
				sub_list.append([k, int(subs[k])])
			sub_list.sort_custom(func(a: Array, b: Array) -> bool: return int(a[1]) > int(b[1]) or (int(a[1]) == int(b[1]) and String(a[0]) < String(b[0])))
			shown_groups.append({"type": t, "count": int(groups[t]["count"]), "subtypes": sub_list})
	return {"creatureCurve": creature_curve, "otherCurve": other_curve, "average": mv_sum / spell_count if spell_count > 0 else 0.0,
		"lands": lands, "notLoaded": not_loaded, "pips": pips, "sources": sources, "groups": shown_groups}


# ---- the library on the server ------------------------------------------------------------------------------------------------

## {ok, decks, error}: every deck, newest first.
static func list_decks() -> Dictionary:
	var r: Dictionary = await Server.get_json("/api/library/decks")
	if not bool(r["ok"]):
		return {"ok": false, "decks": [], "error": String(r["error"])}
	return {"ok": true, "decks": Val.list(Val.as_dict(r["data"]), "decks"), "error": ""}


## {ok, deck, missing, error}.
static func get_deck(id: String) -> Dictionary:
	var r: Dictionary = await Server.get_json("/api/library/decks/%s" % id.uri_encode())
	if bool(r["ok"]):
		return {"ok": true, "deck": Val.dict(Val.as_dict(r["data"]), "deck"), "missing": false, "error": ""}
	return {"ok": false, "deck": {}, "missing": int(r["status"]) == 404, "error": String(r["error"])}


## Save `d`. `expected`: the updatedAt of the version it replaces, null when it must be new, or "*" for no check.
## {ok, deck, conflict, stored, error}.
static func save_deck(d: Dictionary, expected: Variant = "*") -> Dictionary:
	var body := {"deck": d}
	if not (expected is String and String(expected) == "*"):
		body["expected"] = expected
	var r: Dictionary = await Server.post_json("/api/library/decks/save", body)
	if bool(r["ok"]):
		return {"ok": true, "deck": Val.dict(Val.as_dict(r["data"]), "deck"), "conflict": false, "stored": {}, "error": ""}
	var data := Val.as_dict(r["data"])
	return {"ok": false, "deck": {}, "conflict": Val.text(data, "code") == "deckConflict", "stored": Val.dict(data, "stored"),
		"error": String(r["error"])}


## {ok, deleted, error}.
static func delete_deck(id: String) -> Dictionary:
	var r: Dictionary = await Server.post_json("/api/library/decks/delete", {"id": id})
	return {"ok": bool(r["ok"]), "deleted": Val.flag(Val.as_dict(r["data"]), "deleted"), "error": String(r["error"])}
