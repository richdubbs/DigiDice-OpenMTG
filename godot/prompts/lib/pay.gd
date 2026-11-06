extends RefCounted
## Manual mana payment (CR 601.2g-h): building the `payCost` answer from the sources the player picked and the Phyrexian symbols paid
## with life. A port of packages/client/src/prompts/payCost.ts.
##
## A picked source is {objectId, abilityKey, color?} (`color` only for a source that can make several kinds of mana, CR 106.1).

const J := preload("res://prompts/lib/json_read.gd")

const MANA_LETTERS := ["W", "U", "B", "R", "G", "C"]


## The symbols of a cost text, one per symbol ("{2}{B/P}" -> ["{2}", "{B/P}"]); `lifeForPhyrexian` indices point into this list.
static func cost_symbols(cost_text: String) -> Array:
	var re := RegEx.create_from_string("\\{[^}]+\\}")
	var out: Array = []
	for m: RegExMatch in re.search_all(cost_text):
		out.append(m.get_string())
	return out


## Indices of the Phyrexian symbols (CR 107.4f: "{B/P}", "{W/U/P}"), which may be paid with 2 life each.
static func phyrexian_indices(cost_text: String) -> Array:
	var out: Array = []
	var symbols := cost_symbols(cost_text)
	for i: int in symbols.size():
		if str(symbols[i]).ends_with("/P}"):
			out.append(i)
	return out


static func source_key(s: Dictionary) -> String:
	return "%s|%s" % [J.str_of(s, "objectId"), J.str_of(s, "abilityKey")]


## Click a mana ability: add it, or take it back. One mana ability per permanent at a time. A source that can make several colors
## starts with the first of them the cost still needs (`needed`), else its first color.
static func toggle_picked(picked: Array, src: Dictionary, needed: Array) -> Array:
	var key := source_key(src)
	var out: Array = []
	var had := false
	for p: Dictionary in picked:
		if source_key(p) == key:
			had = true
		elif J.str_of(p, "objectId") != J.str_of(src, "objectId"):
			out.append(p)
	if had:
		var kept: Array = []
		for p: Dictionary in picked:
			if source_key(p) != key:
				kept.append(p)
		return kept
	var produces := J.strings(src, "produces")
	var entry := {"objectId": J.str_of(src, "objectId"), "abilityKey": J.str_of(src, "abilityKey")}
	if produces.size() > 1:
		var color: String = str(produces[0])
		for c: Variant in needed:
			if produces.has(str(c)):
				color = str(c)
				break
		entry["color"] = color
	out.append(entry)
	return out


## The colors that could still pay a colored symbol of the cost, after the mana already chosen and the mana in the pool (CR 601.2h).
## A hybrid symbol accepts either color (CR 107.4e), a Phyrexian one its color (CR 107.4f); generic and X need no color.
static func needed_colors(cost_text: String, provided: Array, pool_types: Array) -> Array:
	var open: Array = []
	for s: Variant in cost_symbols(cost_text):
		var sym := str(s)
		var parts := sym.substr(1, sym.length() - 2).split("/")
		var cs: Array = []
		for c: String in MANA_LETTERS:
			if parts.has(c):
				cs.append(c)
		if not cs.is_empty():
			open.append(cs)
	var spent: Array = pool_types.duplicate()
	spent.append_array(provided)
	for c: Variant in spent:
		for i: int in open.size():
			var cs2: Array = open[i]
			if cs2.has(str(c)):
				open.remove_at(i)
				break
	var out: Array = []
	for cs3: Array in open:
		for c: Variant in cs3:
			if not out.has(c):
				out.append(c)
	return out


## The manual answer: {kind:'payCost', auto:false, activations:[...], lifeForPhyrexian?: sorted indices}.
static func manual_answer(picked: Array, life: Array) -> Dictionary:
	var activations: Array = []
	for p: Dictionary in picked:
		var a := {"objectId": J.str_of(p, "objectId"), "abilityKey": J.str_of(p, "abilityKey")}
		if J.has(p, "color"):
			a["color"] = J.str_of(p, "color")
		activations.append(a)
	var out := {"kind": "payCost", "auto": false, "activations": activations}
	if not life.is_empty():
		var sorted_life: Array = []
		for i: Variant in life:
			sorted_life.append(J.to_int(i))
		sorted_life.sort()
		out["lifeForPhyrexian"] = sorted_life
	return out
