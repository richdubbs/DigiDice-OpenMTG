extends RefCounted
## Display names for the objects and players a decision mentions, read only from the view (never a raw state: a hidden card stays
## hidden, CR 400.2). A port of the browser's packages/client/src/prompts/names.ts.
##
## Object and player names come from res://model/View.gd (View.name_by_id, View.player_name: the name after the layers when the view
## carries it, "Hidden card", "Ability of ..."); this file adds what the prompts need around them: labels with zone and owner,
## numbering of equal labels, "~" as the source's name, counts.

const J := preload("res://prompts/lib/json_read.gd")
const ViewModel := preload("res://model/View.gd")

## The engine's stand-in definition of a card the viewer can't see (core/view.ts HIDDEN_DEF).
const HIDDEN_DEF := "__hidden__"
const MANA_NAMES := {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green", "C": "Colorless"}
const ZONE_WORDS := {
	"hand": "in hand", "library": "in library", "graveyard": "in graveyard", "exile": "in exile", "stack": "on the stack",
	"command": "in the command zone",
}


static func players(v: Dictionary) -> Array:
	return J.dicts(v, "players")


static func find_player(v: Dictionary, id: String) -> Dictionary:
	for p: Dictionary in J.dicts(v, "players"):
		if J.str_of(p, "id") == id:
			return p
	return {}


static func is_player(v: Dictionary, id: String) -> bool:
	return not find_player(v, id).is_empty()


static func player_name(v: Dictionary, id: String) -> String:
	return ViewModel.player_name(v, id)


## The player this view is for ("" for a spectator).
static func viewer(v: Dictionary) -> String:
	return J.str_of(v, "viewer")


## The object, or its last known information (CR 608.2h), or {}.
static func object_of(v: Dictionary, id: String) -> Dictionary:
	var objects := J.dict(v, "objects")
	if objects.get(id) is Dictionary:
		return objects[id]
	var lki := J.dict(v, "lki")
	if lki.get(id) is Dictionary:
		return J.dict(lki[id], "object")
	return {}


static func def_of(v: Dictionary, o: Dictionary) -> Dictionary:
	return J.dict(J.dict(v, "defs"), J.str_of(o, "defId"))


## The name a viewer may see (View.name_by_id): the name after the layers, "Hidden card" in a hidden zone, "Ability of <source>" for an
## ability on the stack; the id itself for an id the view does not know.
static func object_name(v: Dictionary, id: String) -> String:
	if object_of(v, id).is_empty():
		return id
	return ViewModel.name_by_id(v, id)


## A player id or an object id, named.
static func entity_name(v: Dictionary, id: String) -> String:
	return player_name(v, id) if is_player(v, id) else object_name(v, id)


## "Grizzly Bears (Bob's, tapped)": the name plus where it is and whose it is, when that is not obvious.
static func object_label(v: Dictionary, id: String) -> String:
	var o := object_of(v, id)
	if o.is_empty():
		return id
	var bits: Array = []
	var controller := Chars.controller_of(v, o)
	if controller != viewer(v):
		bits.append("%s's" % player_name(v, controller))
	var zone := J.str_of(o, "zone")
	if zone != "battlefield":
		bits.append(str(ZONE_WORDS.get(zone, zone)))
	elif J.bool_of(o, "tapped"):
		bits.append("tapped")
	var n := object_name(v, id)
	if bits.is_empty():
		return n
	return "%s (%s)" % [n, ", ".join(J.packed(bits))]


## Number the labels that occur more than once, in list order ("Forest #1", "Forest #2"); unique labels stay as they are.
static func number_duplicates(labels: Array) -> Array:
	var total := {}
	for l: Variant in labels:
		total[str(l)] = J.to_int(total.get(str(l), 0)) + 1
	var seen := {}
	var out: Array = []
	for l: Variant in labels:
		var s := str(l)
		if J.to_int(total.get(s, 0)) < 2:
			out.append(s)
			continue
		var k := J.to_int(seen.get(s, 0)) + 1
		seen[s] = k
		out.append("%s #%d" % [s, k])
	return out


## Labels for a list of ids (id -> label), numbered when two would read the same.
static func distinct_labels(v: Dictionary, ids: Array) -> Dictionary:
	var raw: Array = []
	for id: Variant in ids:
		var s := str(id)
		raw.append(player_name(v, s) if is_player(v, s) else object_label(v, s))
	var labels := number_duplicates(raw)
	var out := {}
	for i: int in ids.size():
		out[str(ids[i])] = labels[i]
	return out


## Engine labels write a card's reference to itself as "~" (CR 201.5): show the source's name instead.
static func with_self_name(text: String, source_name: String) -> String:
	return text.replace("~", source_name) if source_name != "" else text


static func mana_name(c: String) -> String:
	return str(MANA_NAMES.get(c, c))


## "Choose 2", "Choose 1 to 3", "Choose up to 2".
static func count_text(lo: int, hi: int) -> String:
	if lo == hi:
		return "Choose %d" % lo
	if lo == 0:
		return "Choose up to %d" % hi
	return "Choose %d to %d" % [lo, hi]


## Toggle `id` in a selection of at most `hi` (with `hi` 1 a click replaces the selection).
static func toggle(list: Array, id: String, hi: int) -> Array:
	if list.has(id):
		var out := list.duplicate()
		out.erase(id)
		return out
	if hi == 1:
		return [id]
	if list.size() >= hi:
		return list.duplicate()
	var grown := list.duplicate()
	grown.append(id)
	return grown


static func plural(n: int, word: String) -> String:
	return "%d %s%s" % [n, word, "" if n == 1 else "s"]
