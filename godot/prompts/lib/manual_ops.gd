extends RefCounted
## Manual adjustments for text the engine does not understand (`ManualOp` in packages/engine/src/types/decisions.ts). A port of
## packages/client/src/prompts/manualOps.ts: the panel edits a draft (a Dictionary); `build_op` turns it into the exact ManualOp the
## engine validates (core/validate.ts) or explains what is missing; `describe_op` names it for the list.

const J := preload("res://prompts/lib/json_read.gd")
const Names := preload("res://prompts/lib/names.gd")

## Zones a manual `move` may use (decisions.ts MANUAL_MOVE_ZONES).
const MANUAL_MOVE_ZONES := ["hand", "battlefield", "graveyard", "exile", "libraryTop", "libraryBottom"]
## decisions.ts MANUAL_MAX_STEPS: the most prompts one manual resolution may take.
const MANUAL_MAX_STEPS := 50

const ZONE_LABELS := {
	"hand": "Hand", "battlefield": "Battlefield", "graveyard": "Graveyard", "exile": "Exile", "libraryTop": "Top of library",
	"libraryBottom": "Bottom of library",
}
const ZONE_NAMES := {
	"hand": "its owner's hand", "battlefield": "the battlefield", "graveyard": "its owner's graveyard", "exile": "exile",
	"libraryTop": "the top of its library", "libraryBottom": "the bottom of its library",
}

## The panel's operations, in menu order: an engine op, or "exile", which is a `move` to exile named for what the text says.
const MANUAL_KINDS := [
	["move", "Move a card"],
	["discard", "Discard a card"],
	["exile", "Exile a card"],
	["life", "Change life"],
	["counters", "Counters"],
	["tap", "Tap or untap"],
	["draw", "Draw cards"],
	["shuffle", "Shuffle a library"],
	["control", "Change control"],
	["damage", "Deal damage"],
	["mana", "Add mana"],
	["attach", "Attach or unattach"],
	["token", "Create a token"],
	["tokenCopy", "Token copy of a creature"],
	["note", "Note"],
]

## Which draft fields each kind uses (the panel shows only these).
const FIELDS := {
	"move": ["object", "zone", "attachTo"],
	"discard": ["object"],
	"exile": ["object"],
	"tokenCopy": ["object", "player", "haste", "atNextEndStep"],
	"life": ["player", "amount"],
	"counters": ["target", "counter", "amount"],
	"tap": ["object", "tapped"],
	"draw": ["player", "amount"],
	"shuffle": ["player"],
	"control": ["object", "player"],
	"damage": ["target", "amount"],
	"mana": ["player", "mana"],
	"attach": ["object", "attachTo"],
	"token": ["player", "name", "typeLine", "power", "toughness", "colors", "tapped"],
	"note": ["text"],
}


## A fresh draft. A spectator's draft starts with the first player still in the game (CR 800.4a).
static func empty_draft(v: Dictionary, kind: String = "move") -> Dictionary:
	var me := Names.viewer(v)
	if me == "":
		for p: Dictionary in Names.players(v):
			if not J.bool_of(p, "hasLost"):
				me = J.str_of(p, "id")
				break
	var amount := "1"
	if kind == "life":
		amount = "-1"
	return {
		"kind": kind, "object": "", "target": "", "player": me, "zone": "graveyard", "attachTo": "", "amount": amount, "counter": "+1/+1",
		"tapped": kind == "tap", "mana": "", "name": "", "typeLine": "Token Creature — ", "power": "1", "toughness": "1", "colors": "",
		"text": "",
		# the usual temporary copy (Kiki-Jiki, Splinter Twin): with haste, sacrificed at the next end step
		"haste": true, "atNextEndStep": "sacrifice",
	}


## The zone a kind's card must be in (the panel offers only those), or "" for any card it can see.
static func kind_zone(kind: String) -> String:
	if kind == "discard":
		return "hand"
	if kind == "tokenCopy":
		return "battlefield"
	return ""


static func kind_label(kind: String) -> String:
	for k: Array in MANUAL_KINDS:
		if str(k[0]) == kind:
			return str(k[1])
	return kind


## A whole number from text ("3", "-2", "+1"), or null.
static func parse_int(s: String) -> Variant:
	var t := s.strip_edges()
	var re := RegEx.create_from_string("^[-+]?\\d+$")
	if re.search(t) == null:
		return null
	return int(t)


static func _need(what: String) -> Dictionary:
	return {"error": "Choose %s." % what}


## The draft as a ManualOp: {"op": ManualOp} or {"error": why not}. `resolver`: the player making the adjustments (the engine refuses a
## token copy they give away and would sacrifice, CR 603.7d, 701.21a).
static func build_op(d: Dictionary, resolver: String = "") -> Dictionary:
	var object := J.str_of(d, "object")
	var target := J.str_of(d, "target")
	var player := J.str_of(d, "player")
	var n: Variant = parse_int(J.str_of(d, "amount"))
	match J.str_of(d, "kind"):
		"move":
			if object == "":
				return _need("the card to move")
			var zone := J.str_of(d, "zone")
			if not MANUAL_MOVE_ZONES.has(zone):
				return _need("where it goes")
			var op := {"op": "move", "object": object, "to": zone}
			if zone == "battlefield" and J.str_of(d, "attachTo") != "":
				op["attachTo"] = J.str_of(d, "attachTo")
			return {"op": op}
		"discard":
			return {"op": {"op": "discard", "object": object}} if object != "" else _need("the card to discard")
		"exile":
			return {"op": {"op": "move", "object": object, "to": "exile"}} if object != "" else _need("the card to exile")
		"tokenCopy":
			if object == "":
				return _need("the creature to copy")
			if player == "":
				return _need("who creates the token")
			var at := J.str_of(d, "atNextEndStep")
			if at == "sacrifice" and resolver != "" and player != resolver:
				return {"error": "You can't sacrifice a token another player controls at the next end step (CR 701.21a): choose Exile it instead."}
			var copy := {"op": "tokenCopy", "object": object, "player": player}
			if J.bool_of(d, "haste"):
				copy["haste"] = true
			if at != "":
				copy["atNextEndStep"] = at
			return {"op": copy}
		"life":
			if player == "":
				return _need("a player")
			if n == null or J.to_int(n) == 0:
				return {"error": "Enter the life change as a whole number, such as 3 or -2 (CR 119)."}
			return {"op": {"op": "life", "player": player, "delta": J.to_int(n)}}
		"counters":
			if target == "":
				return _need("the object or player")
			var counter := J.str_of(d, "counter").strip_edges()
			if counter == "":
				return _need("the kind of counter")
			if n == null or J.to_int(n) == 0:
				return {"error": "Enter how many counters to add (or remove, with a minus sign)."}
			return {"op": {"op": "counters", "object": target, "counter": counter, "delta": J.to_int(n)}}
		"tap":
			if object == "":
				return _need("the permanent")
			return {"op": {"op": "tap", "object": object, "tapped": J.bool_of(d, "tapped")}}
		"draw":
			if player == "":
				return _need("a player")
			if n == null or J.to_int(n) < 0 or J.to_int(n) > 100:
				return {"error": "Draw from 0 to 100 cards."}
			return {"op": {"op": "draw", "player": player, "count": J.to_int(n)}}
		"shuffle":
			return {"op": {"op": "shuffle", "player": player}} if player != "" else _need("a player")
		"control":
			if object == "":
				return _need("the permanent")
			return {"op": {"op": "control", "object": object, "player": player}} if player != "" else _need("the new controller")
		"damage":
			if target == "":
				return _need("what is dealt damage")
			if n == null or J.to_int(n) < 0:
				return {"error": "Damage is a whole number of 0 or more (CR 120)."}
			return {"op": {"op": "damage", "target": target, "amount": J.to_int(n)}}
		"mana":
			var types: Array = []
			for ch: String in J.str_of(d, "mana").to_upper():
				if "WUBRGC".contains(ch):
					types.append(ch)
			if player == "":
				return _need("a player")
			if types.is_empty():
				return {"error": "Type the mana to add as letters W, U, B, R, G, C (for example \"RRR\")."}
			return {"op": {"op": "mana", "player": player, "types": types}}
		"attach":
			if object == "":
				return _need("the Aura, Equipment or Fortification")
			var to: Variant = null
			if J.str_of(d, "attachTo") != "":
				to = J.str_of(d, "attachTo")
			return {"op": {"op": "attach", "object": object, "to": to}}
		"token":
			if player == "":
				return _need("who creates the token")
			var token_name := J.str_of(d, "name").strip_edges()
			if token_name == "":
				return {"error": "A token needs a name (CR 111.4)."}
			var type_line := J.str_of(d, "typeLine").strip_edges()
			var card_type := RegEx.create_from_string("\\b(Creature|Artifact|Enchantment|Land|Planeswalker|Battle)\\b")
			if card_type.search(type_line) == null:
				return {"error": "A token needs a type line with a card type, such as \"Token Creature — Soldier\" (CR 111.4)."}
			var token := {"op": "token", "player": player, "name": token_name, "typeLine": type_line}
			if is_creature_line(type_line):
				token["power"] = J.str_of(d, "power").strip_edges()
				token["toughness"] = J.str_of(d, "toughness").strip_edges()
			var colors: Array = []
			for ch: String in J.str_of(d, "colors").to_upper():
				if "WUBRG".contains(ch) and not colors.has(ch):
					colors.append(ch)
			if not colors.is_empty():
				token["colors"] = colors
			if J.bool_of(d, "tapped"):
				token["tapped"] = true
			return {"op": token}
		"note":
			var note := J.str_of(d, "text").strip_edges()
			return {"op": {"op": "note", "text": note}} if note != "" else {"error": "Write the note."}
	return {"error": "Choose an operation."}


static func is_creature_line(type_line: String) -> bool:
	return RegEx.create_from_string("\\bCreature\\b").search(type_line) != null


## The adjustment in words, for the list.
static func describe_op(v: Dictionary, op: Dictionary) -> String:
	var obj := Names.entity_name(v, J.str_of(op, "object"))
	var who := Names.player_name(v, J.str_of(op, "player"))
	match J.str_of(op, "op"):
		"move":
			var to := J.str_of(op, "to")
			var where := str(ZONE_NAMES.get(to, to))
			var att := ""
			if J.str_of(op, "attachTo") != "":
				att = ", attached to %s" % Names.entity_name(v, J.str_of(op, "attachTo"))
			return "Move %s to %s%s" % [obj, where, att]
		"life":
			var delta := J.int_of(op, "delta")
			return "%s %s %d life" % [who, "gains" if delta >= 0 else "loses", absi(delta)]
		"counters":
			var delta := J.int_of(op, "delta")
			var k := absi(delta)
			return "%s %d %s counter%s %s %s" % [
				"Put" if delta >= 0 else "Remove", k, J.str_of(op, "counter"), "" if k == 1 else "s", "on" if delta >= 0 else "from", obj]
		"tap":
			return "%s %s" % ["Tap" if J.bool_of(op, "tapped") else "Untap", obj]
		"draw":
			var count := J.int_of(op, "count")
			return "%s draws %s" % [who, Names.plural(count, "card")]
		"shuffle":
			return "%s shuffles their library" % who
		"control":
			return "%s gains control of %s" % [who, obj]
		"damage":
			return "Deal %d damage to %s" % [J.int_of(op, "amount"), Names.entity_name(v, J.str_of(op, "target"))]
		"attach":
			if not J.has(op, "to"):
				return "Unattach %s" % obj
			return "Attach %s to %s" % [obj, Names.entity_name(v, J.str_of(op, "to"))]
		"mana":
			var symbols := ""
			for t: Variant in J.arr(op, "types"):
				symbols += "{%s}" % str(t)
			return "%s adds %s" % [who, symbols]
		"token":
			var pt := ""
			if J.has(op, "power"):
				pt = ", %s/%s" % [J.str_of(op, "power"), J.str_of(op, "toughness")]
			return "%s creates %s (%s%s)" % [who, J.str_of(op, "name"), J.str_of(op, "typeLine"), pt]
		"discard":
			return "Discard %s" % obj
		"tokenCopy":
			var text: String = "%s creates a token copy of %s%s" % [who, obj, " with haste" if J.bool_of(op, "haste") else ""]
			var at := J.str_of(op, "atNextEndStep")
			if at != "":
				text += "; %s it at the beginning of the next end step" % ("sacrifice" if at == "sacrifice" else "exile")
			return text
		"note":
			return "Note: %s" % J.str_of(op, "text")
	return J.str_of(op, "op")


## Objects a manual adjustment may name, with labels ([{id, label}]): everything the viewer can see (battlefield, stack, graveyards,
## exile, their own hand, revealed cards), plus the top and bottom card of each library (hidden, named by position). `exclude`: the
## resolving spell, which leaves the stack by itself.
static func pickable_objects(v: Dictionary, exclude: String = "") -> Array:
	var ids: Array = []
	var labels: Array = []
	var zones := J.dict(v, "zones")
	var add := func(id: String, label: String) -> void:
		if id != exclude and not ids.has(id):
			ids.append(id)
			labels.append(label if label != "" else Names.object_label(v, id))
	for id: Variant in J.arr(zones, "battlefield"):
		add.call(str(id), "")
	for id: Variant in J.arr(zones, "stack"):
		add.call(str(id), "")
	for p: Dictionary in Names.players(v):
		for id: Variant in J.arr(J.dict(zones, "graveyard"), J.str_of(p, "id")):
			add.call(str(id), "")
	for id: Variant in J.arr(zones, "exile"):
		add.call(str(id), "")
	for p: Dictionary in Names.players(v):
		for id: Variant in J.arr(J.dict(zones, "hand"), J.str_of(p, "id")):
			if J.str_of(Names.object_of(v, str(id)), "defId") != Names.HIDDEN_DEF:
				add.call(str(id), "")
	for p: Dictionary in Names.players(v):
		var pid := J.str_of(p, "id")
		var lib := J.arr(J.dict(zones, "library"), pid)
		if lib.size() > 0:
			add.call(str(lib[0]), "Top card of %s's library" % Names.player_name(v, pid))
		if lib.size() > 1:
			add.call(str(lib[lib.size() - 1]), "Bottom card of %s's library" % Names.player_name(v, pid))
	var numbered := Names.number_duplicates(labels)
	var out: Array = []
	for i: int in ids.size():
		out.append({"id": ids[i], "label": numbered[i]})
	return out


## The players a by-hand change can name: those still in the game (CR 800.4a).
static func players_in_game(v: Dictionary) -> Array:
	var out: Array = []
	for p: Dictionary in Names.players(v):
		if not J.bool_of(p, "hasLost"):
			out.append(p)
	return out


## The object and player ids an adjustment names.
static func referenced_ids(op: Dictionary) -> Array:
	match J.str_of(op, "op"):
		"move":
			var ids: Array = [J.str_of(op, "object")]
			if J.str_of(op, "attachTo") != "":
				ids.append(J.str_of(op, "attachTo"))
			return ids
		"counters", "tap", "control", "discard", "tokenCopy":
			return [J.str_of(op, "object")]
		"damage":
			return [J.str_of(op, "target")]
		"attach":
			var ids2: Array = [J.str_of(op, "object")]
			if J.has(op, "to"):
				ids2.append(J.str_of(op, "to"))
			return ids2
	return []


## Why `op` can't follow `earlier` in the same answer, or "". A card that an earlier adjustment moves, discards or draws becomes a new
## object (CR 400.7), so a later adjustment naming it would fail.
static func stale_reference(v: Dictionary, earlier: Array, op: Dictionary) -> String:
	var ids := referenced_ids(op)
	for i: int in earlier.size():
		var e: Dictionary = earlier[i]
		var kind := J.str_of(e, "op")
		var gone: Array = []
		if kind == "move" or kind == "discard":
			gone = [J.str_of(e, "object")]
		elif kind == "draw":
			gone = J.arr(J.dict(J.dict(v, "zones"), "library"), J.str_of(e, "player")).slice(0, J.int_of(e, "count"))
		for id: Variant in ids:
			if gone.has(id):
				var verb := "moved" if kind == "move" else ("discarded" if kind == "discard" else "drawn")
				return ("%s is %s by adjustment %d, so it is a new object (CR 400.7) and a later adjustment can't name it. " +
					"Adjustments to it after the move are not supported yet: add a Note saying what still has to happen.") % [
						Names.entity_name(v, str(id)), verb, i + 1]
	return ""
