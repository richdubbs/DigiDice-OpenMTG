extends "res://prompts/PromptBase.gd"
## assignDamage (CR 510.1c-d, 702.19b): divide a creature's combat damage among the creatures it is blocking or blocked by and, with
## trample, the player / planeswalker / battle it attacks (`trampleTarget`). One SpinBox and one HSlider per recipient; a creature's
## lethal damage is shown beside it and marked once reached (deathtouch makes it 1, CR 702.2c). OK is enabled only when the amounts add
## up to exactly `amount` and, if any goes to the trample target, every other recipient has at least its lethal damage. It starts with
## lethal damage in order and the rest to the trample target (or the first creature); "Lethal first" goes back to that.
## Keys: Up and Down pick a recipient (its row lit), Left / Right or - / + take one damage from it or give it one.
## Answer: {kind:'assignDamage', amounts: [{id, amount}]} (one entry per recipient, in the decision's order).

const Combat := preload("res://prompts/lib/combat.gd")

## recipient id -> damage assigned.
var amounts: Dictionary = {}
var _recipients: Array = []
var _order: Array = []
var _spins: Dictionary = {}
var _sliders: Dictionary = {}
var _notes: Dictionary = {}
## The recipient the keys change (its index in _recipients).
var _key_row: int = 0
var _rows: Array[Control] = []
## Auto allocate (the damage screen): on, the amounts follow the order, lethal damage first; changing an amount by hand turns it off.
var _auto: bool = true
var _auto_box: CheckBox = null
var _stage_row: HBoxContainer = null
var _stage_amounts: Dictionary = {}
var _stage_total: Array = []
var _stage_problem: Label = null
var _target_after: Label = null


func _build() -> void:
	_recipients = J.dicts(decision, "recipients")
	for r: Dictionary in _recipients:
		if not J.bool_of(r, "trampleTarget"):
			_order.append(J.str_of(r, "id"))
	amounts = Combat.allocate_in_order(decision, _order)
	var amount := J.int_of(decision, "amount")
	var ids: Array = []
	for r: Dictionary in _recipients:
		ids.append(J.str_of(r, "id"))
	var labels := Names.distinct_labels(view, ids)
	var grid := GridContainer.new()
	grid.name = "Amounts"
	grid.columns = 3
	for r: Dictionary in _recipients:
		var rid := J.str_of(r, "id")
		# The recipient, with its note ("lethal 2", "trample") under it rather than in a fourth column the frame has no room for.
		var who := VBoxContainer.new()
		_rows.append(who)
		who.add_child(make_cell_label(str(labels.get(rid, rid))))
		var note := make_cell_label("", &"PromptDetail")
		who.add_child(note)
		grid.add_child(who)
		var spin := SpinBox.new()
		spin.name = ("Amount_" + rid).validate_node_name()
		spin.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var slider := HSlider.new()
		slider.name = ("Slider_" + rid).validate_node_name()
		slider.custom_minimum_size = Vector2(100, 0)
		fit_cell(slider)
		for rng: Range in [spin, slider]:
			rng.min_value = 0
			rng.max_value = amount
			rng.step = 1
			rng.rounded = true
			rng.set_value_no_signal(J.to_int(amounts.get(rid, 0)))
		spin.value_changed.connect(_on_value_changed.bind(rid))
		slider.value_changed.connect(_on_value_changed.bind(rid))
		grid.add_child(spin)
		grid.add_child(slider)
		_spins[rid] = spin
		_sliders[rid] = slider
		_notes[rid] = note
	body.add_child(grid)
	add_action("Lethal first", "LethalFirst", lethal_first)
	_light_row()
	_open_damage_stage()


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or _recipients.is_empty():
		return
	var handled := true
	match k.keycode:
		KEY_UP:
			_key_row = (_key_row - 1 + _recipients.size()) % _recipients.size()
			_light_row()
		KEY_DOWN:
			_key_row = (_key_row + 1) % _recipients.size()
			_light_row()
		KEY_LEFT, KEY_MINUS, KEY_KP_SUBTRACT:
			_step(-1)
		KEY_RIGHT, KEY_PLUS, KEY_EQUAL, KEY_KP_ADD:
			_step(1)
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()


func _step(delta: int) -> void:
	_auto = false
	var rid := J.str_of(_recipients[_key_row], "id")
	var n := clampi(J.to_int(amounts.get(rid, 0)) + delta, 0, J.int_of(decision, "amount"))
	set_amount(rid, n)
	Sound.cue("ui.tick")


## The row the keys change is lit.
func _light_row() -> void:
	for i: int in _rows.size():
		_rows[i].modulate = Color(NeonTheme.colors()[0]).lightened(0.45) if i == _key_row else Color.WHITE


## Set one recipient's damage (the SpinBox and the slider of its row).
func set_amount(rid: String, n: int) -> void:
	amounts[rid] = maxi(0, n)
	var spin: SpinBox = _spins.get(rid)
	var slider: HSlider = _sliders.get(rid)
	if spin != null:
		spin.set_value_no_signal(amounts[rid])
	if slider != null:
		slider.set_value_no_signal(amounts[rid])
	_refresh()


func _on_value_changed(value: float, rid: String) -> void:
	_auto = false
	set_amount(rid, roundi(value))


func lethal_first() -> void:
	amounts = Combat.allocate_in_order(decision, _order)
	_sync_controls()


## The SpinBoxes and sliders follow `amounts`.
func _sync_controls() -> void:
	for r: Dictionary in _recipients:
		var rid := J.str_of(r, "id")
		var spin: SpinBox = _spins.get(rid)
		var slider: HSlider = _sliders.get(rid)
		if spin != null:
			spin.set_value_no_signal(J.to_int(amounts.get(rid, 0)))
		if slider != null:
			slider.set_value_no_signal(J.to_int(amounts.get(rid, 0)))
	_refresh()


# ---- the damage screen (the browser's DamageStage) ---------------------------------------------------------------------------------

## The damage screen on the stage (Arena style): the creature dealing the damage large at the left with how much it deals, the
## creatures it may assign damage to in a row First ... Last (drag one to change the order Auto allocate uses), the damage each is
## assigned and its lethal damage under its picture, and with trample what it attacks at the right (CR 510.1c-d, 702.19b). A click
## assigns one more damage, a right-click takes one back. The frame keeps the same amounts as number fields.
func _open_damage_stage() -> void:
	var st := open_stage("Assign damage",
		"Click a creature for one more damage, right-click for one less. Drag them to change the order Auto allocate gives lethal damage in.")
	if st == null:
		return
	var size := st.get_viewport_rect().size
	var w := minf(size.y * 0.24, size.x * 0.14)
	_auto_box = CheckBox.new()
	_auto_box.text = "Auto allocate damage"
	_auto_box.button_pressed = _auto
	_auto_box.add_theme_font_override("font", Hud.bold_font())
	_auto_box.add_theme_font_size_override("font_size", int(clampf(size.y * 0.019, 13.0, 17.0)))
	_auto_box.add_theme_color_override("font_color", Color("#eaf7ff"))
	_auto_box.toggled.connect(_set_auto)
	st.corner.add_child(_auto_box)
	var line := HBoxContainer.new()
	line.alignment = BoxContainer.ALIGNMENT_CENTER
	line.add_theme_constant_override("separation", int(size.x * 0.03))
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	st.body.add_child(line)
	var attacker := st.card(view, J.str_of(decision, "attacker"), w * 1.2)
	_stage_total = _amount_box(attacker.under, true)
	line.add_child(attacker)
	var middle := VBoxContainer.new()
	middle.add_theme_constant_override("separation", 8)
	middle.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	middle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var frame := PanelContainer.new()
	var fs := StyleBoxFlat.new()
	fs.bg_color = Color(0.012, 0.04, 0.1, 0.45)
	fs.set_border_width_all(1)
	fs.border_color = Color(0.92, 0.97, 1.0, 0.4)
	fs.set_corner_radius_all(10)
	fs.content_margin_left = 18
	fs.content_margin_right = 18
	fs.content_margin_top = size.y * 0.024
	fs.content_margin_bottom = size.y * 0.024
	frame.add_theme_stylebox_override("panel", fs)
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stage_row = HBoxContainer.new()
	_stage_row.alignment = BoxContainer.ALIGNMENT_CENTER
	_stage_row.add_theme_constant_override("separation", 18)
	_stage_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(_stage_row)
	middle.add_child(frame)
	for rid: Variant in _order:
		var c := st.card(view, str(rid), w)
		c.hover_lift = 0.0
		c.hover_ring = Color("#ffb43a")
		c.make_clickable()
		c.pressed.connect(_add_damage)
		c.right_pressed.connect(_take_damage)
		c.slot.set_drag_forwarding(_drag_from.bind(str(rid)), _can_drop_on.bind(str(rid)), _drop_on.bind(str(rid)))
		c.slot.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		c.name = ("Dmg_" + str(rid)).validate_node_name()
		_stage_amounts[str(rid)] = _amount_box(c.under, false)
		_stage_row.add_child(c)
	if _order.size() > 1:
		var ends := HBoxContainer.new()
		ends.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for word: String in ["First", "Last"]:
			var l := Label.new()
			l.text = word
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if word == "First" else HORIZONTAL_ALIGNMENT_RIGHT
			l.add_theme_font_override("font", PromptStage._italic())
			l.add_theme_font_size_override("font_size", int(clampf(size.y * 0.036, 16.0, 32.0)))
			l.add_theme_color_override("font_color", Color("#eaf7ff"))
			ends.add_child(l)
		middle.add_child(ends)
	_stage_problem = Label.new()
	_stage_problem.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_stage_problem.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_stage_problem.add_theme_font_override("font", Hud.bold_font())
	_stage_problem.add_theme_color_override("font_color", Color("#ffcf6b"))
	middle.add_child(_stage_problem)
	line.add_child(middle)
	var target := {}
	for r: Dictionary in _recipients:
		if J.bool_of(r, "trampleTarget"):
			target = r
	if not target.is_empty():
		var tid := J.str_of(target, "id")
		var side := VBoxContainer.new()
		side.alignment = BoxContainer.ALIGNMENT_CENTER
		side.add_theme_constant_override("separation", 8)
		side.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		side.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if Names.is_player(view, tid):
			side.add_child(_player_target(tid, size))
		else:
			var c := st.card(view, tid, w)
			c.hover_lift = 0.0
			c.hover_ring = Color("#ffb43a")
			c.make_clickable()
			c.pressed.connect(_add_damage)
			c.right_pressed.connect(_take_damage)
			_stage_amounts[tid] = _amount_box(c.under, false)
			side.add_child(c)
		var trample := Label.new()
		trample.text = "TRAMPLE"
		trample.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		trample.add_theme_font_override("font", Hud.bold_font())
		trample.add_theme_font_size_override("font_size", 12)
		trample.add_theme_color_override("font_color", NeonTheme.colors()[1])
		side.add_child(trample)
		line.add_child(side)
	_refresh()


## The player a trampler attacks: the name, the life in a ring, the damage assigned and the life after.
func _player_target(pid: String, size: Vector2) -> Control:
	var p := Names.find_player(view, pid)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 8)
	box.mouse_filter = Control.MOUSE_FILTER_STOP
	box.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	box.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			_add_damage(pid)
		elif mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
			_take_damage(pid))
	var pname := Label.new()
	pname.text = Names.player_name(view, pid)
	pname.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pname.add_theme_font_override("font", Hud.bold_font())
	pname.add_theme_color_override("font_color", Color("#eaf7ff"))
	pname.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(pname)
	var ring_size := clampf(size.y * 0.14, 64.0, 130.0)
	var ring := PanelContainer.new()
	ring.custom_minimum_size = Vector2(ring_size, ring_size)
	ring.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	ring.tooltip_text = "Life now"
	var rs := StyleBoxFlat.new()
	rs.bg_color = Color(0.012, 0.04, 0.1, 0.95)
	rs.set_border_width_all(3)
	rs.border_color = NeonTheme.colors()[0]
	rs.set_corner_radius_all(int(ring_size / 2.0))
	rs.shadow_color = Color(NeonTheme.colors()[0], 0.5)
	rs.shadow_size = 18
	ring.add_theme_stylebox_override("panel", rs)
	ring.mouse_filter = Control.MOUSE_FILTER_PASS
	var life := Label.new()
	life.text = str(J.int_of(p, "life"))
	life.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	life.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	life.add_theme_font_override("font", Hud.bold_font())
	life.add_theme_font_size_override("font_size", int(clampf(size.y * 0.06, 24.0, 54.0)))
	life.add_theme_color_override("font_color", Color.WHITE)
	ring.add_child(life)
	box.add_child(ring)
	_stage_amounts[pid] = _amount_box(box, false)
	_target_after = Label.new()
	_target_after.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_target_after.add_theme_font_size_override("font_size", 13)
	_target_after.add_theme_color_override("font_color", Color("#cfe6ff"))
	_target_after.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(_target_after)
	return box


## An amount under a picture: the number in an orange box (red once lethal; the attacker's in the neon) and a note beside it.
func _amount_box(parent: Control, total: bool) -> Array:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 8)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var n := Label.new()
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	n.custom_minimum_size = Vector2(44, 0)
	n.add_theme_font_override("font", Hud.bold_font())
	n.add_theme_font_size_override("font_size", 26)
	row.add_child(n)
	var note := Label.new()
	note.add_theme_font_size_override("font_size", 13)
	note.add_theme_color_override("font_color", Color("#cfe6ff"))
	row.add_child(note)
	parent.add_child(row)
	return [n, note, total]


func _paint_amount(box: Array, value: int, note: String, lethal: bool) -> void:
	var n: Label = box[0]
	var total: bool = box[2]
	n.text = str(value)
	var edge := NeonTheme.colors()[0] if total else (Color("#ff5a5a") if lethal else Color("#ffb43a"))
	var s := StyleBoxFlat.new()
	s.bg_color = Color("#05070f")
	s.set_border_width_all(2)
	s.border_color = edge
	s.set_corner_radius_all(8)
	s.content_margin_left = 10
	s.content_margin_right = 10
	s.content_margin_top = 2
	s.content_margin_bottom = 2
	n.add_theme_stylebox_override("normal", s)
	n.add_theme_color_override("font_color", Color("#eaf7ff") if total else (Color("#ff8080") if lethal else Color("#ffc35a")))
	(box[1] as Label).text = note


func _set_auto(on: bool) -> void:
	_auto = on
	if on:
		amounts = Combat.allocate_in_order(decision, _order)
	_sync_controls()


## One more damage to `rid`: from what is still unassigned, else taken from the trample target, else from the last creature in the
## order that has some (never from `rid` itself).
func _add_damage(rid: String) -> void:
	if _busy:
		return
	var total := 0
	for r: Dictionary in _recipients:
		total += J.to_int(amounts.get(J.str_of(r, "id"), 0))
	if total < J.int_of(decision, "amount"):
		amounts[rid] = J.to_int(amounts.get(rid, 0)) + 1
	else:
		var from_list: Array = []
		for r: Dictionary in _recipients:
			if J.bool_of(r, "trampleTarget"):
				from_list.append(J.str_of(r, "id"))
		var back := _order.duplicate()
		back.reverse()
		from_list.append_array(back)
		var from := ""
		for x: Variant in from_list:
			if str(x) != rid and J.to_int(amounts.get(x, 0)) > 0:
				from = str(x)
				break
		if from == "":
			return
		amounts[from] = J.to_int(amounts.get(from, 0)) - 1
		amounts[rid] = J.to_int(amounts.get(rid, 0)) + 1
	Sound.cue("ui.tick")
	_auto = false
	_sync_controls()


func _take_damage(rid: String) -> void:
	if _busy or J.to_int(amounts.get(rid, 0)) <= 0:
		return
	amounts[rid] = J.to_int(amounts.get(rid, 0)) - 1
	Sound.cue("ui.tick")
	_auto = false
	_sync_controls()


func _drag_from(_at: Vector2, rid: String) -> Variant:
	if _busy:
		return null
	var tag := Label.new()
	tag.text = Names.object_name(view, rid)
	tag.add_theme_font_override("font", Hud.bold_font())
	tag.add_theme_color_override("font_color", Color("#ffc35a"))
	_stage_row.set_drag_preview(tag)
	return {"damage_order": rid}


func _can_drop_on(_at: Vector2, data: Variant, rid: String) -> bool:
	return data is Dictionary and (data as Dictionary).has("damage_order") and str((data as Dictionary)["damage_order"]) != rid


## Move the dragged creature to where it was dropped; with Auto allocate on, the damage follows the new order.
func _drop_on(_at: Vector2, data: Variant, onto: String) -> void:
	var from := str((data as Dictionary)["damage_order"])
	var next := _order.duplicate()
	next.erase(from)
	var at := next.find(onto) + (1 if _order.find(from) < _order.find(onto) else 0)
	next.insert(at, from)
	_order = next
	for i: int in _order.size():
		var node := _stage_row.get_node_or_null(NodePath(("Dmg_" + str(_order[i])).validate_node_name()))
		if node != null:
			_stage_row.move_child(node, i)
	if _auto:
		amounts = Combat.allocate_in_order(decision, _order)
	_sync_controls()


func _refresh_stage(total: int) -> void:
	if stage == null:
		return
	var amount := J.int_of(decision, "amount")
	var left := amount - total
	_paint_amount(_stage_total, amount, "%d left" % left if left > 0 else ("%d too many" % -left if left < 0 else "all assigned"), false)
	for r: Dictionary in _recipients:
		var rid := J.str_of(r, "id")
		var box: Array = _stage_amounts.get(rid, [])
		if box.is_empty():
			continue
		var n := J.to_int(amounts.get(rid, 0))
		if J.bool_of(r, "trampleTarget"):
			_paint_amount(box, n, "", false)
			if _target_after != null:
				_target_after.text = "life after: %d" % (J.int_of(Names.find_player(view, rid), "life") - n)
		else:
			var lethal := J.int_of(r, "lethal")
			_paint_amount(box, n, "lethal" if n >= lethal else "lethal %d" % lethal, n >= lethal)
	_stage_problem.text = Combat.assignment_problem(decision, amounts)
	_stage_problem.visible = _stage_problem.text != ""
	if _auto_box != null:
		_auto_box.set_pressed_no_signal(_auto)


func _refresh() -> void:
	var total := 0
	for r: Dictionary in _recipients:
		var rid := J.str_of(r, "id")
		var n := J.to_int(amounts.get(rid, 0))
		total += n
		var note: Label = _notes.get(rid)
		if note == null:
			continue
		if J.bool_of(r, "trampleTarget"):
			note.text = "attacked: trample damage"
		else:
			var lethal := J.int_of(r, "lethal")
			note.text = "lethal" if n >= lethal else "lethal: %d" % lethal
	var amount := J.int_of(decision, "amount")
	set_detail("%s assigns %d combat damage (%d assigned).%s" % [
		Names.object_name(view, J.str_of(decision, "attacker")), amount, total,
		" It has trample (CR 702.19b)." if J.bool_of(decision, "canTrample") else ""])
	var problem := Combat.assignment_problem(decision, amounts)
	set_problem(problem)
	set_ok(problem == "", "Assign damage")
	_refresh_stage(total)


func _on_ok() -> void:
	if Combat.assignment_problem(decision, amounts) != "":
		return
	var out: Array = []
	for r: Dictionary in _recipients:
		var rid := J.str_of(r, "id")
		out.append({"id": rid, "amount": J.to_int(amounts.get(rid, 0))})
	send_answer({"kind": "assignDamage", "amounts": out})
