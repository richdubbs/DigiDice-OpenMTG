extends "res://prompts/PromptBase.gd"
## priority (CR 117). EXCEPTION to the prompt contract: priority is answered with a priority ACTION, not a DecisionAnswer, so this scene
## emits `acted(action)` with a whole engine Action (packages/engine/src/types/actions.ts) and never `answered`:
##   - Pass priority (OK, Space): the `pass` action from client.legal, else {type:'pass', player} (CR 117.3d).
##   - Resolve all, shown while the stack holds something: {type:'pass', player, resolveAll: true} (passes until the stack is empty unless
##     another player casts or activates something).
##   - Any legal action of client.legal: a card clicked on the board (or its chip here) with one thing to do does it at once; with several,
##     its menu opens. By-hand tools (manualTrigger / manualStatic), special actions (turn face up, plot) and abilities of a card in the hand
##     always open the menu. Sources with nothing but mana abilities are one "Mana abilities (N)" group, by-hand-only sources "By hand (N)".
##     Special actions about no object (a companion, playing a card from outside the game) are buttons of their own.
##   - Hold priority (H, or the toggle): the engine's StopSettings.holdPriority (CR 117.3c), sent with client.stops(player, stops) when the
##     client has that method (the table channel's `stops` message), else emitted as {type:'setStops', player, stops}. Disabled while full
##     control is on.

signal acted(action: Dictionary)

var _legal: Array = []
## object id -> its legal actions, in the engine's order.
var _by_object: Dictionary = {}
var _cards: Array = []
var _mana_only: Array = []
var _by_hand_only: Array = []
## The object whose menu is open ("" = none).
var open_id: String = ""
var _holding: bool = false
var _hold_button: Button = null
var _menu: VBoxContainer = null
var _mana_row: HFlowContainer = null
var _by_hand_row: HFlowContainer = null


func _build() -> void:
	_legal = legal_actions()
	for a: Dictionary in _legal:
		var oid := J.str_of(a, "object")
		if J.str_of(a, "kind") == "pass" or oid == "":
			continue
		if not _by_object.has(oid):
			_by_object[oid] = []
		var list: Array = _by_object[oid]
		list.append(a)
	for oid: Variant in _by_object:
		var list: Array = _by_object[oid]
		var all_mana := true
		var all_by_hand := true
		for a: Dictionary in list:
			if not J.bool_of(a, "isMana"):
				all_mana = false
			if not is_by_hand_kind(J.str_of(a, "kind")):
				all_by_hand = false
		if all_mana:
			_mana_only.append(str(oid))
		elif all_by_hand:
			_by_hand_only.append(str(oid))
		else:
			_cards.append(str(oid))
	set_ok(true, "Pass priority")
	var stack := J.arr(J.dict(view, "zones"), "stack")
	if not stack.is_empty():
		add_action("Resolve all", "ResolveAll", resolve_all)
	var me := Names.find_player(view, J.str_of(decision, "player"))
	if not me.is_empty():
		var stops := J.dict(me, "stops")
		_holding = J.bool_of(stops, "holdPriority")
		_hold_button = add_action("", "HoldPriority", toggle_hold)
		_hold_button.toggle_mode = true
		if J.bool_of(stops, "fullControl"):
			_hold_button.disabled = true
			_hold_button.tooltip_text = "Full control is on: the game already stops at every priority"
		else:
			_hold_button.tooltip_text = "H: stop at every priority until the end of this turn, also right after your own spells and abilities (CR 117.3c)"
	for i: int in _legal.size():
		var a: Dictionary = _legal[i]
		if J.str_of(a, "kind") == "special" and J.str_of(a, "object") == "":
			var b := add_action(J.str_of(a, "label"), "Special_%d" % i, _do.bind(a))
			b.tooltip_text = objectless_special_title(a)
	if not _mana_only.is_empty():
		add_action("Mana abilities (%d)" % _mana_only.size(), "ManaAbilities", _toggle_row.bind("mana"))
	if not _by_hand_only.is_empty():
		var bh := add_action("By hand (%d)" % _by_hand_only.size(), "ByHand", _toggle_row.bind("byHand"))
		bh.tooltip_text = "Manual text the engine does not run: apply it by hand"
	var lines: Array = []
	if not stack.is_empty():
		lines.append("Top of the stack: %s. It resolves when all players pass in succession (CR 117.4)." % Names.object_name(view, str(stack[stack.size() - 1])))
	if _cards.is_empty():
		var nothing := "Nothing to play right now"
		if not _mana_only.is_empty():
			nothing += " except mana abilities"
		if not _by_hand_only.is_empty():
			nothing += " and by-hand tools" if not _mana_only.is_empty() else " except by-hand tools"
		lines.append(nothing + ".")
	set_detail("\n".join(J.packed(lines)))
	if not _cards.is_empty():
		add_chips(body, _cards, _toggle_menu)
	if not _mana_only.is_empty():
		_mana_row = add_chips(body, _mana_only, _toggle_menu)
		_mana_row.visible = false
	if not _by_hand_only.is_empty():
		_by_hand_row = add_chips(body, _by_hand_only, _toggle_menu)
		_by_hand_row.visible = false
	_menu = VBoxContainer.new()
	_menu.name = "Menu"
	body.add_child(_menu)


static func is_by_hand_kind(kind: String) -> bool:
	return kind == "manualTrigger" or kind == "manualStatic"


static func is_plot(a: Dictionary) -> bool:
	var act := J.dict(a, "action")
	return J.str_of(act, "type") == "special" and J.str_of(act, "kind") == "plot"


## The tooltip of an objectless special action's button.
static func objectless_special_title(a: Dictionary) -> String:
	var act := J.dict(a, "action")
	if J.str_of(act, "type") == "special" and J.str_of(act, "kind") == "playOutside":
		return "A card you own outside the game (your sideboard), played because an effect lets you: a land is played as your land drop, any other permanent card is cast the usual way with its mana cost, so it can be responded to. The effect's use for this turn is spent, and covers your graveyard too (CR 400.11b, 305.1, 601.3)."
	return "A special action: it doesn't use the stack, so nobody can respond; once per game, in a main phase of your turn with an empty stack (CR 116.2g, 702.139a)"


## What the player should know before a special action of a permanent: turning it face up (CR 116.2b, 702.37e) or plotting (CR 116.2k).
static func special_hint(special: Array) -> String:
	var all_plot := not special.is_empty()
	var x := false
	for a: Dictionary in special:
		if not is_plot(a):
			all_plot = false
		if J.str_of(a, "label").contains("{X}"):
			x = true
	if all_plot:
		return "Plotting is a special action: you pay the plot cost and exile the card without using the stack, so nobody can respond. On a later turn you may cast it from exile without paying its mana cost, during your main phase while the stack is empty (CR 116.2k, 702.170a, 702.170d)."
	var ways := " Choose how: it can be turned face up in %d ways." % special.size() if special.size() > 1 else ""
	return "Turning a face-down permanent face up is a special action: it doesn't use the stack, so nobody can respond (CR 116.2b, 702.37e).%s%s" % [ways, " You choose X next (CR 702.37f)." if x else ""]


## Why a land card in the hand isn't offered as a land play right now (CR 305.1, 305.2), or "".
func land_play_hint(id: String, list: Array) -> String:
	var o := Names.object_of(view, id)
	var cd := Names.def_of(view, o)
	if o.is_empty() or cd.is_empty() or J.str_of(o, "zone") != "hand":
		return ""
	for a: Dictionary in list:
		if J.str_of(a, "kind") == "playLand":
			return ""
	var faces := J.arr(cd, "faces")
	var face_count := faces.size() if J.str_of(cd, "layout") == "modal_dfc" else mini(1, faces.size())
	var land := false
	for i: int in face_count:
		if faces[i] is Dictionary and J.strings(faces[i], "types").has("Land"):
			land = true
	if not land:
		return ""
	var player := J.str_of(decision, "player")
	var turn := J.dict(view, "turn")
	var step := J.str_of(turn, "step")
	var why := "something stops it"
	if J.str_of(turn, "activePlayer") != player:
		why = "lands are played only during your own turn"
	elif (step != "main1" and step != "main2") or not J.arr(J.dict(view, "zones"), "stack").is_empty():
		why = "lands are played only in your main phase while the stack is empty"
	elif J.int_of(Names.find_player(view, player), "landsPlayedThisTurn") > 0:
		why = "you have already played a land this turn"
	return "You can't play it as a land right now: %s (CR 305.1, 305.2)." % why


func _do(a: Dictionary) -> void:
	open_id = ""
	send_action(J.dict(a, "action"))


## Emit a priority action (the arm delay and busy state apply, as for answers).
func send_action(action: Dictionary) -> void:
	if _busy or not is_armed() or action.is_empty():
		return
	acted.emit(action)


func pass_action() -> Dictionary:
	for a: Dictionary in _legal:
		if J.str_of(a, "kind") == "pass":
			var act := J.dict(a, "action")
			if not act.is_empty():
				return act
	return {"type": "pass", "player": J.str_of(decision, "player")}


func _on_ok() -> void:
	open_id = ""
	send_action(pass_action())


func resolve_all() -> void:
	send_action({"type": "pass", "player": J.str_of(decision, "player"), "resolveAll": true})


## The hold-priority toggle (H): the game stops for this player at every priority until the end of the turn (CR 117.3c).
func toggle_hold() -> void:
	if _hold_button == null or _hold_button.disabled or _busy:
		return
	var player := J.str_of(decision, "player")
	var stops := J.dict(Names.find_player(view, player), "stops").duplicate(true)
	_holding = not _holding
	stops["holdPriority"] = _holding
	if client != null and client.has_method("stops"):
		client.call("stops", player, stops)
	else:
		send_action({"type": "setStops", "player": player, "stops": stops})
	_refresh()


func _toggle_row(which: String) -> void:
	var row := _mana_row if which == "mana" else _by_hand_row
	if row != null:
		row.visible = not row.visible


func _toggle_menu(id: String) -> void:
	open_id = "" if open_id == id else id
	_refresh()


## A click on the board: with one thing to do it does it at once (Arena style), with several its menu opens. Never at once: a by-hand
## tool, a special action, or an ability of a card in the hand (the click meant "play it").
func _on_card_clicked(id: String) -> void:
	var list: Array = _by_object.get(id, [])
	if list.size() == 1:
		var only: Dictionary = list[0]
		var kind := J.str_of(only, "kind")
		var in_hand := J.str_of(Names.object_of(view, id), "zone") == "hand"
		if not is_by_hand_kind(kind) and kind != "special" and not (kind == "activate" and in_hand):
			_do(only)
			return
	_toggle_menu(id)


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k != null and k.pressed and not k.echo and k.keycode == KEY_H and not k.ctrl_pressed and not k.alt_pressed and not k.meta_pressed:
		toggle_hold()
		get_viewport().set_input_as_handled()
		return
	super(event)


func _on_escape() -> bool:
	if open_id == "":
		return false
	open_id = ""
	_refresh()
	return true


func _refresh() -> void:
	if _hold_button != null:
		_hold_button.set_pressed_no_signal(_holding)
		_hold_button.text = "Holding priority" if _holding else "Hold priority"
	var marks := {}
	for id: Variant in _mana_only:
		marks[id] = "mana"
	for id: Variant in _by_hand_only:
		marks[id] = "by hand"
	for id: Variant in _by_object:
		update_chip(str(id), open_id == str(id), str(marks.get(id, "")))
	_rebuild_menu()
	publish_selection(_by_object.keys(), [open_id] if open_id != "" else [], marks)


func _rebuild_menu() -> void:
	clear_children(_menu)
	if open_id == "" or not _by_object.has(open_id):
		_menu.visible = false
		return
	_menu.visible = true
	var list: Array = _by_object[open_id]
	var regular: Array = []
	var special: Array = []
	var by_hand: Array = []
	for a: Dictionary in list:
		var kind := J.str_of(a, "kind")
		if is_by_hand_kind(kind):
			by_hand.append(a)
		elif kind == "special":
			special.append(a)
		else:
			regular.append(a)
	_menu.add_child(make_label("Actions of %s" % Names.object_name(view, open_id), &"PromptDetail"))
	var land_hint := land_play_hint(open_id, list)
	if land_hint != "":
		_menu.add_child(make_label(land_hint, &"PromptDetail"))
	var n := 0
	for a: Dictionary in regular:
		_menu.add_child(_action_button(a, n))
		n += 1
	if not special.is_empty():
		_menu.add_child(make_label(special_hint(special), &"PromptDetail"))
		for a: Dictionary in special:
			_menu.add_child(_action_button(a, n))
			n += 1
	if not by_hand.is_empty():
		_menu.add_child(make_label("By hand: the engine does not run this text (CR 603.2, 603.3 for a trigger; CR 604.1 for a static ability). You apply its effect with manual adjustments; the log names the card and the text.", &"PromptDetail"))
		for a: Dictionary in by_hand:
			_menu.add_child(_action_button(a, n))
			n += 1
	var close := Button.new()
	close.name = "CloseMenu"
	close.text = "Close"
	close.pressed.connect(_toggle_menu.bind(open_id), CONNECT_DEFERRED)
	_menu.add_child(close)


func _action_button(a: Dictionary, n: int) -> Button:
	var b := Button.new()
	b.name = "Action_%d" % n
	b.text = J.str_of(a, "label")
	b.pressed.connect(_do.bind(a), CONNECT_DEFERRED)
	return b
