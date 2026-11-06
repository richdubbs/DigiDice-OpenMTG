extends "res://prompts/PromptBase.gd"
## manualResolve: the engine does not understand this effect; the players resolve it by hand with manual adjustments and confirm (never
## silently skipped). A port of the browser's ManualResolvePrompt.tsx and ManualPanel.tsx: the text, why, what the engine already did,
## what was chosen so far; an editor that builds one ManualOp at a time (move, discard, exile, life, counters, tap/untap, draw, shuffle,
## control, damage, mana, attach, token, token copy, note; a card can also be picked by clicking it on the board) and adds it to the list.
##
## - Done (OK, Space with adjustments): {kind:'manualResolve', ops}. With no adjustments on the first step it asks first ("Resolve with no
##   changes?"): nothing of the effect would happen.
## - Apply and continue: {kind:'manualResolve', ops, continue: true}: the engine applies them now and asks again (step + 1); refused by the
##   engine on the last step (MANUAL_MAX_STEPS - 1), so it is not offered there. After a step nothing can be cancelled any more (CR 733.1).
## - An adjustment naming a card an earlier one moved is refused with the reason (CR 400.7).
## Answer: {kind:'manualResolve', ops: ManualOp[], continue?: true}.

const Ops := preload("res://prompts/lib/manual_ops.gd")

var ops: Array = []
var draft: Dictionary = {}
var _confirm_empty: bool = false
var _exclude: String = ""
var _fields_box: GridContainer = null
var _panel_error: Label = null
var _ops_box: VBoxContainer = null
var _kind_pick: OptionButton = null
var _continue_button: Button = null
var _back_button: Button = null
var _field_widgets: Dictionary = {}
var _pt_nodes: Array = []


func _build() -> void:
	_exclude = J.str_of(decision, "resolvingId")
	draft = Ops.empty_draft(view)
	var step := J.int_of(decision, "step")
	var lines: Array = []
	lines.append("%s%s" % [J.str_of(decision, "sourceName"), " · Step %d" % (step + 1) if step > 0 else ""])
	lines.append(J.str_of(decision, "text"))
	if J.str_of(decision, "reason") != "":
		lines.append("Why by hand: %s" % J.str_of(decision, "reason"))
	var done := J.strings(decision, "done")
	if not done.is_empty():
		lines.append("Already done by the engine:")
		for t: Variant in done:
			lines.append("- %s" % str(t))
	var bound := J.dicts(decision, "bound")
	if not bound.is_empty():
		lines.append("Chosen so far:")
		for b: Dictionary in bound:
			var objs := J.strings(b, "objects")
			lines.append("- %s: %s" % [J.str_of(b, "name"), ", ".join(J.packed(objs)) if not objs.is_empty() else "nothing"])
	if step > 0:
		lines.append("%s already applied: the board and the log show %s. Add what is left, then Done." % [
			Names.plural(step, "step"), "it" if step == 1 else "them"])
	if J.has(decision, "reminder"):
		lines.append("The game will keep a reminder of this effect for its duration.")
	set_detail("\n".join(J.packed(lines)))
	# The editor of one adjustment.
	var panel := VBoxContainer.new()
	panel.name = "Panel"
	body.add_child(panel)
	panel.add_child(make_label("Manual adjustment", &"PromptDetail"))
	var kind_row := HBoxContainer.new()
	kind_row.add_child(make_cell_label("Operation"))
	_kind_pick = OptionButton.new()
	_kind_pick.name = "Operation"
	fit_cell(_kind_pick)
	for k: Array in Ops.MANUAL_KINDS:
		_kind_pick.add_item(str(k[1]))
		_kind_pick.set_item_metadata(_kind_pick.item_count - 1, str(k[0]))
	_kind_pick.item_selected.connect(_on_kind_picked)
	kind_row.add_child(_kind_pick)
	panel.add_child(kind_row)
	_fields_box = GridContainer.new()
	_fields_box.name = "Fields"
	_fields_box.columns = 2
	panel.add_child(_fields_box)
	var add := Button.new()
	add.name = "Add"
	add.text = "Add adjustment"
	add.pressed.connect(add_draft)
	panel.add_child(add)
	_panel_error = make_label("", &"PromptWarning")
	_panel_error.visible = false
	panel.add_child(_panel_error)
	body.add_child(make_label("Adjustments to apply", &"PromptDetail"))
	_ops_box = VBoxContainer.new()
	_ops_box.name = "Ops"
	body.add_child(_ops_box)
	_continue_button = add_action("Apply and continue", "ApplyAndContinue", apply_and_continue)
	_continue_button.tooltip_text = "Apply these adjustments now and keep resolving: see what they did before the rest of the text"
	_back_button = add_action("Back", "Back", _on_back)
	_rebuild_fields()


func _can_continue() -> bool:
	return J.int_of(decision, "step") < Ops.MANUAL_MAX_STEPS - 1


## Choose the operation being built (one of manual_ops.gd MANUAL_KINDS); the draft starts over, keeping the player.
func select_kind(kind: String) -> void:
	var player := J.str_of(draft, "player")
	draft = Ops.empty_draft(view, kind)
	draft["player"] = player
	for i: int in _kind_pick.item_count:
		if str(_kind_pick.get_item_metadata(i)) == kind:
			_kind_pick.select(i)
	_panel_error.visible = false
	_rebuild_fields()


func _on_kind_picked(index: int) -> void:
	select_kind.call_deferred(str(_kind_pick.get_item_metadata(index)))


## Set one field of the draft (the editor's controls call this; so may a test).
func set_field(key: String, value: Variant) -> void:
	draft[key] = value
	if key == "zone":
		_rebuild_fields.call_deferred()
	elif key == "typeLine":
		for n: Control in _pt_nodes:
			n.visible = Ops.is_creature_line(str(value))
	elif _field_widgets.has(key):
		var w: Control = _field_widgets[key]
		if w is OptionButton:
			var pick: OptionButton = w
			for i: int in pick.item_count:
				if str(pick.get_item_metadata(i)) == str(value):
					pick.select(i)
	_refresh()


## Build the ManualOp from the draft and add it to the list, or say why not.
func add_draft() -> void:
	var r := Ops.build_op(draft, Names.viewer(view))
	if r.has("error"):
		_show_panel_error(str(r["error"]))
		return
	var op: Dictionary = r["op"]
	var stale := Ops.stale_reference(view, ops, op)
	if stale != "":
		_show_panel_error(stale)
		return
	ops.append(op)
	_confirm_empty = false
	var player := J.str_of(draft, "player")
	draft = Ops.empty_draft(view, J.str_of(draft, "kind"))
	draft["player"] = player
	_panel_error.visible = false
	_rebuild_fields()


func _show_panel_error(text: String) -> void:
	_panel_error.text = text
	_panel_error.visible = true


func remove_op(index: int) -> void:
	if index >= 0 and index < ops.size():
		ops.remove_at(index)
	_refresh()


func _rebuild_fields() -> void:
	clear_children(_fields_box)
	_field_widgets.clear()
	_pt_nodes.clear()
	var kind := J.str_of(draft, "kind")
	var fields: Array = Ops.FIELDS.get(kind, [])
	var zone_only := Ops.kind_zone(kind)
	var objects: Array = []
	for o: Dictionary in Ops.pickable_objects(view, _exclude):
		if zone_only == "" or J.str_of(Names.object_of(view, J.str_of(o, "id")), "zone") == zone_only:
			objects.append(o)
	if fields.has("object"):
		var label := "Attachment" if kind == "attach" else ("Copy of" if kind == "tokenCopy" else "Card")
		_add_object_field("object", label, objects, false, "(choose)")
	if fields.has("target"):
		_add_object_field("target", "Damage to" if kind == "damage" else "Counters on", objects, true, "(choose)")
	if fields.has("zone"):
		var zones: Array = []
		for z: Variant in Ops.MANUAL_MOVE_ZONES:
			zones.append([str(z), str(Ops.ZONE_LABELS.get(z, z))])
		_add_pick_field("zone", "To", zones)
	if fields.has("attachTo") and (kind == "attach" or J.str_of(draft, "zone") == "battlefield"):
		_add_object_field("attachTo", "Attached to", objects, true, "(nothing: unattach)" if kind == "attach" else "(not attached)")
	if fields.has("player"):
		var players: Array = []
		for p: Dictionary in Ops.players_in_game(view):
			players.append([J.str_of(p, "id"), J.str_of(p, "name", J.str_of(p, "id"))])
		var label2 := "New controller" if kind == "control" else ("Created by" if kind == "tokenCopy" else "Player")
		_add_pick_field("player", label2, players)
	if fields.has("counter"):
		_add_text_field("counter", "Counter kind", "+1/+1, loyalty, poison...")
	if fields.has("amount"):
		var amount_label := "Amount"
		match kind:
			"life":
				amount_label = "Life change"
			"draw":
				amount_label = "Cards"
			"counters":
				amount_label = "Number (minus to remove)"
		_add_text_field("amount", amount_label, "")
	if fields.has("mana"):
		_add_text_field("mana", "Mana", "e.g. RRG")
	if fields.has("name"):
		_add_text_field("name", "Token name", "")
	if fields.has("typeLine"):
		_add_text_field("typeLine", "Type line", "")
	if fields.has("power"):
		_pt_nodes.append_array(_add_text_field("power", "Power", ""))
	if fields.has("toughness"):
		_pt_nodes.append_array(_add_text_field("toughness", "Toughness", ""))
	for n: Control in _pt_nodes:
		n.visible = Ops.is_creature_line(J.str_of(draft, "typeLine"))
	if fields.has("colors"):
		_add_text_field("colors", "Colors", "e.g. W or UB; empty for colorless")
	if fields.has("tapped"):
		_add_check_field("tapped", "Tapped (untick to untap)" if kind == "tap" else "Enters tapped")
	if fields.has("haste"):
		_add_check_field("haste", "With haste")
	if fields.has("atNextEndStep"):
		_add_pick_field("atNextEndStep", "At the next end step", [["sacrifice", "Sacrifice it"], ["exile", "Exile it"], ["", "Keep it"]])
	if fields.has("text"):
		_add_text_field("text", "Note text", "")
	_refresh()


func _add_object_field(key: String, label: String, objects: Array, with_players: bool, none_label: String) -> void:
	var items: Array = [["", none_label]]
	if with_players:
		for p: Dictionary in Ops.players_in_game(view):
			items.append([J.str_of(p, "id"), "Player: %s" % J.str_of(p, "name", J.str_of(p, "id"))])
	for o: Dictionary in objects:
		items.append([J.str_of(o, "id"), J.str_of(o, "label")])
	_add_pick_field(key, label, items)


## items: [[value, label]].
func _add_pick_field(key: String, label: String, items: Array) -> void:
	_fields_box.add_child(make_cell_label(label))
	var pick := OptionButton.new()
	pick.name = ("Field_" + key).validate_node_name()
	# A long card or player name is cut short in the button (the list shows it whole), not allowed to widen the frame.
	pick.fit_to_longest_item = false
	pick.clip_text = true
	fit_cell(pick)
	var current := J.str_of(draft, key)
	for it: Array in items:
		pick.add_item(str(it[1]))
		pick.set_item_metadata(pick.item_count - 1, str(it[0]))
		if str(it[0]) == current:
			pick.select(pick.item_count - 1)
	pick.item_selected.connect(_on_pick.bind(key, pick))
	_fields_box.add_child(pick)
	_field_widgets[key] = pick


func _on_pick(index: int, key: String, pick: OptionButton) -> void:
	set_field(key, str(pick.get_item_metadata(index)))


## Returns the label and the field, so the power and toughness rows can be hidden.
func _add_text_field(key: String, label: String, placeholder: String) -> Array:
	var l := make_cell_label(label)
	_fields_box.add_child(l)
	var edit := LineEdit.new()
	edit.name = ("Field_" + key).validate_node_name()
	edit.text = J.str_of(draft, key)
	edit.placeholder_text = placeholder
	edit.custom_minimum_size = Vector2(200, 0)
	fit_cell(edit)
	edit.text_changed.connect(_on_text.bind(key))
	_fields_box.add_child(edit)
	_field_widgets[key] = edit
	return [l, edit]


func _on_text(new_text: String, key: String) -> void:
	draft[key] = new_text
	if key == "typeLine":
		for n: Control in _pt_nodes:
			n.visible = Ops.is_creature_line(new_text)


func _add_check_field(key: String, label: String) -> void:
	_fields_box.add_child(Control.new())
	var check := CheckBox.new()
	check.name = ("Field_" + key).validate_node_name()
	check.text = label
	check.button_pressed = J.bool_of(draft, key)
	check.toggled.connect(_on_check.bind(key))
	_fields_box.add_child(check)
	_field_widgets[key] = check


func _on_check(on: bool, key: String) -> void:
	draft[key] = on


## The draft's field a click on the board fills: the object, else the object-or-player target ("" = none).
func _pick_field() -> String:
	var fields: Array = Ops.FIELDS.get(J.str_of(draft, "kind"), [])
	if fields.has("object"):
		return "object"
	if fields.has("target"):
		return "target"
	return ""


func _on_card_clicked(id: String) -> void:
	var key := _pick_field()
	if key != "":
		set_field(key, id)


func apply_and_continue() -> void:
	if ops.is_empty() or not _can_continue():
		return
	send_answer({"kind": "manualResolve", "ops": ops.duplicate(true), "continue": true})


func _on_back() -> void:
	_confirm_empty = false
	_refresh()


func _refresh() -> void:
	if _ops_box == null:
		return
	clear_children(_ops_box)
	for i: int in ops.size():
		var row := HBoxContainer.new()
		var text := Ops.describe_op(view, ops[i])
		row.add_child(fit_cell(make_label("%d. %s" % [i + 1, text])))
		var remove := Button.new()
		remove.name = "Remove_%d" % i
		remove.text = "Remove"
		remove.tooltip_text = "Remove: %s" % text
		remove.pressed.connect(remove_op.bind(i), CONNECT_DEFERRED)
		row.add_child(remove)
		_ops_box.add_child(row)
	var step := J.int_of(decision, "step")
	var asking := ops.is_empty() and step == 0 and _confirm_empty
	if asking:
		set_problem("Resolve with no changes? Nothing of this effect will happen.")
		set_ok(true, "Resolve with no changes")
	else:
		var notes: Array = []
		if _can_continue() and is_cancellable() and step == 0:
			notes.append("\"Apply and continue\" commits this action: after it, it can no longer be cancelled (CR 733.1).")
		if not _can_continue():
			notes.append("The last step (%d at most): finish with Done." % Ops.MANUAL_MAX_STEPS)
		set_problem("\n".join(J.packed(notes)))
		if not ops.is_empty():
			set_ok(true, "Done: apply %s" % Names.plural(ops.size(), "adjustment"))
		elif step > 0:
			set_ok(true, "Done")
		else:
			set_ok(true, "Done (no changes)")
	_back_button.visible = asking
	_continue_button.visible = _can_continue() and not asking
	_continue_button.disabled = ops.is_empty()
	var key := _pick_field()
	var selectable: Array = []
	if key != "":
		var zone_only := Ops.kind_zone(J.str_of(draft, "kind"))
		for o: Dictionary in Ops.pickable_objects(view, _exclude):
			var oid := J.str_of(o, "id")
			if zone_only == "" or J.str_of(Names.object_of(view, oid), "zone") == zone_only:
				selectable.append(oid)
		if key == "target":
			for p: Dictionary in Ops.players_in_game(view):
				selectable.append(J.str_of(p, "id"))
	var chosen := J.str_of(draft, key) if key != "" else ""
	publish_selection(selectable, [chosen] if chosen != "" else [])


func _on_ok() -> void:
	var step := J.int_of(decision, "step")
	if ops.is_empty() and step == 0 and not _confirm_empty:
		_confirm_empty = true
		_refresh()
		return
	send_answer({"kind": "manualResolve", "ops": ops.duplicate(true)})


## Confirming with no adjustments means nothing of the effect happens, so it is never a key press: Space confirms only with adjustments.
func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k != null and k.keycode == KEY_SPACE and ops.is_empty() and J.int_of(decision, "step") == 0:
		return
	super(event)
