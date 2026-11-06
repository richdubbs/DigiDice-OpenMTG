class_name View
extends RefCounted
## Read-only helpers over the view Dictionary the server sends (the engine's `GameView`: packages/engine/src/core/view.ts, a
## `GameState` without its random source, plus `viewer` and `midAction`). Ports of the browser's read model where it is pure
## (packages/client/src/board/model.ts: isHidden, defOf, shownFace, attachmentsOf, battlefieldRows, playerName, objectName).
##
## The view is the only truth on screen: nothing here keeps state, and nothing is computed that the engine computes (the
## characteristics after the layers come from Chars.gd, which reads what the view carries).
##
## Shapes used (see the TypeScript source's types/state.ts):
##   view.players[]   {id, name, life, poison, manaPool, counters, stops, hasLost, conceded, commanderDamage?, ...}
##   view.objects{}   GameObject {id, kind, cardId?, defId, owner, controller, zone, tapped, faceDown, face, flipped,
##                    counters{}, damage, attachedTo?, controlledSinceTurn, stack?{kind, sourceName?, targets, x?}, ...}
##   view.zones       {library{pid:[ids]}, hand{pid:[ids]}, graveyard{pid:[ids]}, battlefield[], stack[] (last = top),
##                    exile[], command[]}
##   view.defs{}      CardDef {id, name, layout, faces[{name, manaCost, typeLine, oracleText, power?, toughness?, colors, ...}]}
##   view.turn        {number, activePlayer, step, ...}; view.priority {player, ...}; view.combat {attackers[], blockers[]} or null
##   view.pending     a Decision or null; view.log[] {seq, turn, text, privateText?{players, text}, level?}; view.result or null

## The definition id of an object the viewer cannot see (core/view.ts HIDDEN_DEF).
const HIDDEN_DEF: String = "__hidden__"
## The pseudo-definitions of face-down objects (types/card.ts FACE_DOWN_DEF_IDS).
const FACE_DOWN_DEFS: Array[String] = ["__facedown__", "__facedown_ward2__"]

const STEP_LABELS: Dictionary = {
	"untap": "Untap", "upkeep": "Upkeep", "draw": "Draw", "main1": "Main 1", "beginCombat": "Combat",
	"declareAttackers": "Attackers", "declareBlockers": "Blockers", "combatDamage": "Damage", "endCombat": "End combat",
	"main2": "Main 2", "end": "End", "cleanup": "Cleanup",
}


static func viewer(view: Dictionary) -> String:
	return Val.text(view, "viewer", "")


static func players(view: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p: Variant in Val.list(view, "players"):
		if p is Dictionary:
			out.append(p)
	return out


static func player_ids(view: Dictionary) -> Array[String]:
	var out: Array[String] = []
	for p: Dictionary in players(view):
		out.append(Val.text(p, "id"))
	return out


static func player(view: Dictionary, id: String) -> Dictionary:
	for p: Dictionary in players(view):
		if Val.text(p, "id") == id:
			return p
	return {}


static func player_name(view: Dictionary, id: String) -> String:
	var p := player(view, id)
	return Val.text(p, "name", id) if not p.is_empty() else id


static func zones(view: Dictionary) -> Dictionary:
	return Val.dict(view, "zones")


static func objects(view: Dictionary) -> Dictionary:
	return Val.dict(view, "objects")


static func object(view: Dictionary, id: String) -> Dictionary:
	return Val.dict(objects(view), id)


static func defs(view: Dictionary) -> Dictionary:
	return Val.dict(view, "defs")


## The definition of a visible object, or {} for a hidden one (board/model.ts `defOf`).
static func def_of(view: Dictionary, obj: Dictionary) -> Dictionary:
	if obj.is_empty() or is_hidden(obj):
		return {}
	return Val.dict(defs(view), Val.text(obj, "defId"))


## An object the viewer cannot see (CR 400.2): a blank card.
static func is_hidden(obj: Dictionary) -> bool:
	return Val.text(obj, "defId") == HIDDEN_DEF


## A face-down object shown to others as the face-down pseudo-definition (CR 708.2).
static func is_face_down_profile(obj: Dictionary) -> bool:
	return FACE_DOWN_DEFS.has(Val.text(obj, "defId"))


## A face-down object whose card the viewer may look at (their own face-down permanent; board/model.ts `isKnownFaceDown`).
static func is_known_face_down(obj: Dictionary) -> bool:
	var zone := Val.text(obj, "zone")
	return not is_hidden(obj) and Val.flag(obj, "faceDown") and zone != "hand" and zone != "library"


## The face that is up (board/model.ts `shownFace`): on the stack the cast face, on the battlefield the flipped half or the
## face up of a double-faced card, the front face elsewhere.
static func shown_face(def: Dictionary, obj: Dictionary) -> int:
	var last: int = maxi(0, Val.list(def, "faces").size() - 1)
	match Val.text(obj, "zone"):
		"stack":
			var st := Val.dict(obj, "stack")
			var face: int = Val.num(st, "face", Val.num(obj, "face")) if st.has("face") else Val.num(obj, "face")
			return mini(face, last)
		"battlefield":
			if Val.text(def, "layout") == "flip":
				return 1 if Val.flag(obj, "flipped") and last >= 1 else 0
			return mini(Val.num(obj, "face"), last)
		_:
			return 0


## A display name: the name after the layers when the view carries it, the source of an ability, or "Hidden card".
static func name_of(view: Dictionary, obj: Dictionary) -> String:
	if obj.is_empty():
		return "a card"
	if is_hidden(obj):
		return "Face-down card" if Val.flag(obj, "faceDown") else "Hidden card"
	if Val.text(obj, "kind") == "ability":
		var src := Val.text(Val.dict(obj, "stack"), "sourceName")
		if src == "":
			src = Val.text(def_of(view, obj), "name", "a permanent")
		return "Ability of %s" % src
	if is_face_down_profile(obj):
		return "Face-down permanent"
	var chars := Chars.of(view, obj)
	var name := Val.text(chars, "name")
	if name == "":
		name = Val.text(def_of(view, obj), "name", "a card")
	return name


## The name of an object by id, or of what it was (last known information), or "a card".
static func name_by_id(view: Dictionary, id: String) -> String:
	var obj := object(view, id)
	if not obj.is_empty():
		return name_of(view, obj)
	var lki := Val.dict(Val.dict(view, "lki"), id)
	if not lki.is_empty():
		var c := Val.text(Val.dict(lki, "chars"), "name")
		if c != "":
			return c
		return Val.text(def_of(view, Val.dict(lki, "object")), "name", "a card")
	if not player(view, id).is_empty():
		return player_name(view, id)
	return "a card"


## Ids of a per-player zone (library, hand, graveyard).
static func player_zone(view: Dictionary, zone: String, player_id: String) -> Array[String]:
	return Val.texts(Val.dict(zones(view), zone), player_id)


## Ids of a shared zone (battlefield, stack, exile, command).
static func shared_zone(view: Dictionary, zone: String) -> Array[String]:
	return Val.texts(zones(view), zone)


static func hand_of(view: Dictionary, player_id: String) -> Array[String]:
	return player_zone(view, "hand", player_id)


static func library_count(view: Dictionary, player_id: String) -> int:
	return player_zone(view, "library", player_id).size()


static func graveyard_of(view: Dictionary, player_id: String) -> Array[String]:
	return player_zone(view, "graveyard", player_id)


## The exiled objects a player owns (exile is one shared zone).
static func exile_of(view: Dictionary, player_id: String) -> Array[String]:
	var out: Array[String] = []
	for id: String in shared_zone(view, "exile"):
		if Val.text(object(view, id), "owner") == player_id:
			out.append(id)
	return out


## The command zone objects a player owns.
static func command_of(view: Dictionary, player_id: String) -> Array[String]:
	var out: Array[String] = []
	for id: String in shared_zone(view, "command"):
		if Val.text(object(view, id), "owner") == player_id:
			out.append(id)
	return out


## The permanents a player controls (after layer 2, CR 613.1b: the summary's controller when the view carries it), in battlefield order.
static func battlefield_of(view: Dictionary, player_id: String) -> Array[String]:
	var out: Array[String] = []
	for id: String in shared_zone(view, "battlefield"):
		if Chars.controller_of(view, object(view, id)) == player_id:
			out.append(id)
	return out


## The permanents attached to an object (Auras, Equipment; CR 301.5, 303.4), in battlefield order.
static func attachments_of(view: Dictionary, id: String) -> Array[String]:
	var out: Array[String] = []
	for a: String in shared_zone(view, "battlefield"):
		if Val.text(object(view, a), "attachedTo") == id:
			out.append(a)
	return out


## A player's permanents in the battlefield's groups (board/model.ts `battlefieldRows`): creatures (and permanents whose
## characteristics are unknown), lands, others. Attachments are left out (they are drawn with their host).
static func rows_of(view: Dictionary, player_id: String) -> Dictionary:
	var creatures: Array[String] = []
	var lands: Array[String] = []
	var others: Array[String] = []
	for id: String in battlefield_of(view, player_id):
		var obj := object(view, id)
		var host := Val.text(obj, "attachedTo")
		if host != "" and Val.text(object(view, host), "zone") == "battlefield":
			continue
		var chars := Chars.of(view, obj)
		var types := Val.texts(chars, "types")
		if chars.is_empty() or types.has("Creature"):
			creatures.append(id)
		elif types.has("Land"):
			lands.append(id)
		else:
			others.append(id)
	return {"creatures": creatures, "lands": lands, "others": others}


## The stack, bottom first (the last id is the top, CR 405.2).
static func stack(view: Dictionary) -> Array[String]:
	return shared_zone(view, "stack")


## The pending decision, or {} when none (the view's `pending` is null then).
static func pending(view: Dictionary) -> Dictionary:
	return Val.dict(view, "pending")


static func turn(view: Dictionary) -> Dictionary:
	return Val.dict(view, "turn")


static func step(view: Dictionary) -> String:
	return Val.text(turn(view), "step")


static func active_player(view: Dictionary) -> String:
	return Val.text(turn(view), "activePlayer")


static func priority_player(view: Dictionary) -> String:
	return Val.text(Val.dict(view, "priority"), "player")


## The combat, or {} outside combat.
static func combat(view: Dictionary) -> Dictionary:
	return Val.dict(view, "combat")


static func is_attacking(view: Dictionary, id: String) -> bool:
	for a: Variant in Val.list(combat(view), "attackers"):
		if Val.text(Val.as_dict(a), "id") == id:
			return true
	return false


static func is_blocking(view: Dictionary, id: String) -> bool:
	for b: Variant in Val.list(combat(view), "blockers"):
		if Val.text(Val.as_dict(b), "id") == id:
			return true
	return false


## The log entries (named `log_entries` because `log` is a built-in function of GDScript).
static func log_entries(view: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for e: Variant in Val.list(view, "log"):
		if e is Dictionary:
			out.append(e)
	return out


## A log entry's text for the viewer: the private text when the viewer is among its players (CR 400.2).
static func log_text(entry: Dictionary, viewer_id: String) -> String:
	var priv := Val.dict(entry, "privateText")
	if viewer_id != "" and Val.texts(priv, "players").has(viewer_id):
		return Val.text(priv, "text", Val.text(entry, "text"))
	return Val.text(entry, "text")


## The game's result ({winner, reason}), or {} while the game goes on.
## The text of an ability on the stack (board/model.ts abilityText): its inline text, else the printed or keyword ability its
## reference names; "~" and "¤" read as its source's name.
static func ability_text(view: Dictionary, obj: Dictionary) -> String:
	var st := Val.dict(obj, "stack")
	if st.is_empty():
		return ""
	var def := Val.dict(defs(view), Val.text(obj, "defId"))
	var source := Val.text(st, "sourceName", Val.text(def, "name"))
	var text := Val.text(Val.dict(st, "inline"), "text")
	var ref := Val.dict(st, "abilityRef")
	if text == "" and (Val.text(ref, "source") == "printed" or Val.text(ref, "source") == "keyword"):
		var faces: Array = Val.list(def, "faces")
		var face := int(Val.num(ref, "face"))
		if face >= 0 and face < faces.size():
			var abilities: Array = Val.list(Val.as_dict(faces[face]), "abilities")
			var index := int(Val.num(ref, "index"))
			if index >= 0 and index < abilities.size():
				text = Val.text(Val.as_dict(abilities[index]), "text")
	return text.replace("~", source).replace("¤", source)


static func result(view: Dictionary) -> Dictionary:
	return Val.dict(view, "result")


## Whether the pending decision is for the viewer to answer (its player, or the player who controls them, CR 723.5).
static func decision_is_mine(view: Dictionary, decision: Dictionary) -> bool:
	var me := viewer(view)
	if me == "" or decision.is_empty():
		return false
	return Val.text(decision, "player") == me or Val.text(decision, "decidedBy") == me
