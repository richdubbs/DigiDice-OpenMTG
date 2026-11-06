class_name PromptStage
extends Control
## A decision drawn large over the dimmed table (the browser's prompts/stage.tsx), Arena style: a title and a line under it across
## the top, the decision's cards in the middle, the prompt's buttons big and centred below them (the main one glowing at the
## right), and "View battlefield" at the top right to look at the table underneath (the buttons stay). A prompt opens it with
## PromptBase.open_stage(), only on the table; its frame stays at the bottom right with the prompt's own words.
##
## Cards on the stage are the board's card view (scenes/Card.tscn); pointing at one shows the table's zoom. Nothing is drawn over
## a picture: marks, amounts and notes sit under it. While Scryfall pictures may be on screen the cards sit apart and shrink to
## fit; with them off they may overlap (the browser's useStageOverlap).

signal peek_changed(on: bool)

const CARD_SCENE: PackedScene = preload("res://scenes/Card.tscn")
const VIOLET := Color("#3a2ec6")
## The stage starts under the table's game bar and phase bar (they stay usable above it).
const TOP: float = 92.0

var title: String = ""
var subtitle: String = ""

## The middle of the stage: the prompt lays its cards out here (fan(), row(), or its own).
var body: CenterContainer = null
## Controls under "View battlefield" (e.g. "Auto allocate damage").
var corner: VBoxContainer = null

var _bg: TextureRect = null
var _head: VBoxContainer = null
var _title: Label = null
var _sub: Label = null
var _peek: Button = null
var _actions_box: VBoxContainer = null
var _peeking: bool = false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_bg = TextureRect.new()
	var g := GradientTexture2D.new()
	var grad := Gradient.new()
	grad.set_color(0, Color(0.008, 0.024, 0.07, 0.74))
	grad.set_color(1, Color(0.008, 0.024, 0.07, 0.93))
	g.gradient = grad
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, 0.5)
	g.fill_to = Vector2(0.925, 0.5)
	_bg.texture = g
	_bg.stretch_mode = TextureRect.STRETCH_SCALE
	_bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_bg)
	var h := _h()
	var column := VBoxContainer.new()
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.offset_top = TOP + h * 0.012
	column.offset_bottom = -h * 0.03
	column.offset_left = 24.0
	column.offset_right = -24.0
	column.add_theme_constant_override("separation", int(h * 0.014))
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(column)
	_head = VBoxContainer.new()
	_head.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(_head)
	_title = Label.new()
	_title.text = title
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.add_theme_font_override("font", Hud.bold_font())
	_title.add_theme_font_size_override("font_size", int(clampf(h * 0.06, 24.0, 54.0)))
	_title.add_theme_color_override("font_color", Color("#eaf7ff"))
	_title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.65))
	_title.add_theme_constant_override("shadow_offset_y", 3)
	_title.add_theme_color_override("font_outline_color", Color(NeonTheme.colors()[0], 0.35))
	_title.add_theme_constant_override("outline_size", 6)
	_head.add_child(_title)
	var rule := ColorRect.new()
	rule.color = Color(0.62, 0.9, 1.0, 0.55)
	rule.custom_minimum_size = Vector2(0, 1)
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_head.add_child(rule)
	_sub = Label.new()
	_sub.text = subtitle
	_sub.visible = subtitle != ""
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub.custom_minimum_size = Vector2(minf(960.0, _w() * 0.78), 0)
	_sub.add_theme_font_size_override("font_size", int(clampf(h * 0.021, 13.0, 19.0)))
	_sub.add_theme_color_override("font_color", Color("#cfe6ff"))
	_head.add_child(_sub)
	body = CenterContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(body)
	_actions_box = VBoxContainer.new()
	_actions_box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_actions_box.alignment = BoxContainer.ALIGNMENT_CENTER
	_actions_box.add_theme_constant_override("separation", 8)
	column.add_child(_actions_box)
	corner = VBoxContainer.new()
	corner.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	corner.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	corner.offset_top = TOP + h * 0.012
	corner.offset_right = -22.0
	corner.alignment = BoxContainer.ALIGNMENT_BEGIN
	corner.add_theme_constant_override("separation", 10)
	add_child(corner)
	_peek = Button.new()
	_peek.text = "View battlefield"
	_peek.toggle_mode = true
	_peek.size_flags_horizontal = Control.SIZE_SHRINK_END
	_peek.add_theme_font_override("font", Hud.bold_font())
	_peek.add_theme_font_size_override("font_size", int(clampf(h * 0.02, 13.0, 18.0)))
	_pill(_peek, Color(0.012, 0.04, 0.1, 0.75), Color(0.92, 0.97, 1.0, 0.85), 2, Color(0, 0, 0, 0), 0)
	_peek.toggled.connect(_on_peek)
	corner.add_child(_peek)
	_fit_rule.call_deferred(rule)


## The underline is as wide as the title, with room each side (the browser's `padding: 0 48px`).
func _fit_rule(rule: ColorRect) -> void:
	if is_instance_valid(rule) and is_instance_valid(_title):
		rule.custom_minimum_size.x = _title.get_minimum_size().x + 96.0
		rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER


func set_title(text: String, line: String = "") -> void:
	title = text
	subtitle = line
	if _title != null:
		_title.text = text
		_sub.text = line
		_sub.visible = line != ""


func set_subtitle(line: String) -> void:
	set_title(title, line)


## The card's mana cost under the line ("Cost: {2}{R}"), in symbols.
func set_cost(cost_text: String) -> void:
	var line := HBoxContainer.new()
	line.alignment = BoxContainer.ALIGNMENT_CENTER
	line.add_theme_constant_override("separation", 6)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := Label.new()
	l.text = "Cost:"
	l.add_theme_font_size_override("font_size", int(clampf(_h() * 0.021, 13.0, 19.0)))
	l.add_theme_color_override("font_color", Color("#cfe6ff"))
	line.add_child(l)
	var mc := ManaCost.new()
	mc.symbol_size = 18.0
	mc.cost = cost_text
	mc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(mc)
	_head.add_child(line)


func _w() -> float:
	return get_viewport_rect().size.x if is_inside_tree() else 1600.0


func _h() -> float:
	return get_viewport_rect().size.y if is_inside_tree() else 900.0


func _on_peek(on: bool) -> void:
	_peeking = on
	_peek.text = "Back" if on else "View battlefield"
	_bg.visible = not on
	_head.visible = not on
	body.visible = not on
	for c: Node in corner.get_children():
		if c != _peek:
			(c as CanvasItem).visible = not on
	mouse_filter = Control.MOUSE_FILTER_IGNORE if on else Control.MOUSE_FILTER_STOP
	peek_changed.emit(on)


## Lines of the prompt that stay in sight on the stage (why OK is off, the engine's refusal): under the buttons, centred.
func take_labels(labels: Array[Label]) -> void:
	for l: Label in labels:
		l.reparent(_actions_box)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.custom_minimum_size = Vector2(minf(900.0, _w() * 0.7), 0)
		l.add_theme_font_override("font", Hud.bold_font())
		l.add_theme_color_override("font_color", Color("#ffcf6b"))


## The prompt's buttons move onto the stage as big pills, the main one (`primary`) last and lit; `hint` goes under them.
func take_actions(actions: HBoxContainer, primary: Button, hint: String = "") -> void:
	var h := _h()
	actions.reparent(_actions_box)
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 22)
	if primary != null and primary.get_parent() == actions:
		actions.move_child(primary, -1)
	for c: Node in actions.get_children():
		var b := c as Button
		if b == null:
			continue
		b.custom_minimum_size = Vector2(clampf(h * 0.22, 150.0, 240.0), clampf(h * 0.06, 40.0, 56.0))
		b.add_theme_font_override("font", Hud.bold_font())
		b.add_theme_font_size_override("font_size", int(clampf(h * 0.026, 15.0, 22.0)))
		b.autowrap_mode = TextServer.AUTOWRAP_OFF
		if b == primary:
			b.set_meta(&"slab", "primary")
			b.set_meta(&"slab_depth", 5.0)
			b.add_theme_color_override("font_color", Color(0.02, 0.05, 0.12))
		else:
			_pill(b, VIOLET, Color(0.725, 0.63, 1.0, 0.9), 2, Color(0.47, 0.39, 1.0, 0.55), 18)
			b.add_theme_color_override("font_color", Color.WHITE)
	if hint != "":
		var l := Label.new()
		l.text = hint
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(minf(900.0, _w() * 0.7), 0)
		l.add_theme_font_size_override("font_size", int(clampf(h * 0.02, 13.0, 17.0)))
		l.add_theme_color_override("font_color", Color("#cfe6ff"))
		l.add_theme_font_override("font", _italic())
		_actions_box.add_child(l)


static func _italic() -> FontVariation:
	var f := FontVariation.new()
	f.base_font = ThemeDB.fallback_font
	f.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.2, 1), Vector2.ZERO)
	return f


## A pill-shaped button style (normal, hover, pressed, disabled) in `fill` with a `border` and a `glow`.
static func _pill(b: Button, fill: Color, border: Color, border_w: int, glow: Color, glow_size: int) -> void:
	for state: String in ["normal", "hover", "pressed", "disabled", "focus"]:
		var s := StyleBoxFlat.new()
		s.set_corner_radius_all(999)
		s.set_border_width_all(border_w)
		s.border_color = border
		s.bg_color = fill
		s.shadow_color = glow
		s.shadow_size = glow_size
		s.content_margin_left = 22
		s.content_margin_right = 22
		s.content_margin_top = 8
		s.content_margin_bottom = 8
		match state:
			"hover":
				s.bg_color = fill.lightened(0.15)
			"pressed":
				s.bg_color = fill.darkened(0.2)
			"disabled":
				s.bg_color = Color(fill, fill.a * 0.45)
				s.border_color = Color(border, border.a * 0.45)
				s.shadow_color = Color(0, 0, 0, 0)
			"focus":
				s.bg_color = Color(0, 0, 0, 0)
				s.border_color = Color(0.92, 0.97, 1.0)
				s.shadow_size = 0
		b.add_theme_stylebox_override(state, s)


# ---- the cards ------------------------------------------------------------------------------------------------------------------

## Whether cards on the stage may overlap: never while Scryfall pictures may be on screen (no picture is ever covered).
static func may_overlap() -> bool:
	return not Settings.scryfall_images


## A card of `view` on the stage, `width` wide, as the board draws it, the artist of its picture under it.
func card(view: Dictionary, id: String, width: float) -> StageCard:
	var c := StageCard.new()
	c.setup(view, id, width)
	c.hovered.connect(_on_card_hovered)
	return c


func _on_card_hovered(id: String, inside: bool) -> void:
	var table := get_tree().current_scene
	if table != null and table.has_method("show_zoom"):
		table.call("show_zoom", id, inside)


## The cards fanned out like a hand (the opening hand, the new hand after a mulligan): side by side, tilted a little from the
## middle, each coming up under the pointer.
func fan(view: Dictionary, ids: Array) -> Array[StageCard]:
	var n := maxi(1, ids.size())
	var w := _w()
	var h := _h()
	var overlap := may_overlap()
	var width := minf(minf(h * 0.30, w * 0.15), (w * 0.88) / (1.0 + (n - 1) * 0.74) if overlap else (w * 0.90 - (n - 1) * 12.0) / n)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", int(-width * 0.26) if overlap else 12)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.add_child(row)
	var out: Array[StageCard] = []
	for i: int in ids.size():
		var c := card(view, String(ids[i]), width)
		var k := i - (ids.size() - 1) / 2.0
		c.tilt(k * (3.5 if overlap else 1.5), k * k * h * (0.008 if overlap else 0.005))
		c.hover_lift = h * 0.02
		c.hover_scale = 1.04
		row.add_child(c)
		out.append(c)
	return out


## The cards in one row, left to right (a search, a revealed hand, the modes): apart and wrapping onto more rows while pictures
## may be on screen, else overlapping just enough to fit; the card under the pointer comes up above the others.
func row(view: Dictionary, ids: Array, copies_of: String = "") -> Array[StageCard]:
	var n := maxi(1, ids.size())
	var w := _w()
	var h := _h()
	var overlap := may_overlap()
	var width := minf(h * 0.36, w * 0.16)
	var holder: Container = null
	if overlap:
		var step := minf(width + 10.0, (w * 0.92 - width) / maxf(1.0, n - 1.0))
		var line := HBoxContainer.new()
		line.alignment = BoxContainer.ALIGNMENT_CENTER
		line.add_theme_constant_override("separation", int(step - width))
		holder = line
	else:
		width = maxf(h * 0.10, minf(width, (w * 0.92 - (n - 1) * 10.0) / n))
		var flow := HFlowContainer.new()
		flow.alignment = FlowContainer.ALIGNMENT_CENTER
		flow.add_theme_constant_override("h_separation", 10)
		flow.add_theme_constant_override("v_separation", 10)
		flow.custom_minimum_size = Vector2(w * 0.92, 0)
		holder = flow
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_top", int(h * 0.05))
	pad.add_theme_constant_override("margin_bottom", int(h * 0.02))
	pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pad.add_child(holder)
	body.add_child(pad)
	var out: Array[StageCard] = []
	for i: int in ids.size():
		var c := card(view, copies_of if copies_of != "" else String(ids[i]), width)
		c.hover_lift = h * 0.03
		c.hover_scale = 1.15
		c.selected_lift = h * 0.045
		holder.add_child(c)
		out.append(c)
	return out


## A card on the stage: the board's card view in a slot `width` wide (63:88), the artist under it, and `under` for marks, amounts
## and notes (never on the picture). It comes up and grows a little under the pointer; chosen, it glows round its picture and
## stays lifted (or, `drop_when_chosen`, drops a little: the mulligan's bottom cards); a card that cannot be chosen is dimmed.
class StageCard:
	extends Control

	signal pressed(id: String)
	signal right_pressed(id: String)
	signal hovered(id: String, inside: bool)

	## What a click answers (an object, or an option shown on a copy of its card).
	var id: String = ""
	## The object drawn (the zoom shows it).
	var object_id: String = ""
	var view_card: CardView = null
	var slot: Control = null
	var under: VBoxContainer = null
	## The picture, the artist and what is under them, moved together (lifted, dropped, grown).
	var _content: VBoxContainer = null
	var hover_lift: float = 0.0
	var hover_scale: float = 1.0
	var selected_lift: float = 0.0
	var drop_when_chosen: float = 0.0
	var clickable: bool = false
	var _width: float = 0.0
	var _base_y: float = 0.0
	var _over: bool = false
	var _selected: bool = false
	var _ring: Panel = null
	var _mark: Label = null
	var _tween: Tween = null

	var _mode_box: PanelContainer = null
	var _mode_label: Label = null
	var _view: Dictionary = {}
	var _credit: Label = null
	## The ring's colour while pointed at (the damage screen's orange), or none.
	var hover_ring: Color = Color(0, 0, 0, 0)
	var _press_at: Vector2 = Vector2.ZERO
	var _pressing: bool = false

	func setup(view: Dictionary, p_id: String, width: float) -> void:
		id = p_id
		object_id = p_id
		_width = width
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_content = VBoxContainer.new()
		_content.alignment = BoxContainer.ALIGNMENT_BEGIN
		_content.add_theme_constant_override("separation", 6)
		_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_content)
		slot = Control.new()
		slot.custom_minimum_size = Vector2(width, width * 88.0 / 63.0)
		slot.mouse_filter = Control.MOUSE_FILTER_STOP
		slot.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_content.add_child(slot)
		_ring = Panel.new()
		var ring := StyleBoxFlat.new()
		ring.bg_color = Color(0, 0, 0, 0)
		ring.set_border_width_all(3)
		ring.border_color = NeonTheme.colors()[0]
		ring.set_corner_radius_all(10)
		ring.shadow_color = Color(NeonTheme.colors()[0], 0.85)
		ring.shadow_size = 18
		ring.set_expand_margin_all(3)
		_ring.add_theme_stylebox_override("panel", ring)
		_ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_ring.visible = false
		slot.add_child(_ring)
		view_card = CARD_SCENE.instantiate()
		slot.add_child(view_card)
		_ring.size = slot.custom_minimum_size
		_view = view
		_credit = Label.new()
		_credit.visible = false
		_credit.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_credit.custom_minimum_size = Vector2(width, 0)
		_credit.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_credit.add_theme_font_size_override("font_size", 11)
		_credit.add_theme_color_override("font_color", Hud.MUTED)
		_content.add_child(_credit)
		under = VBoxContainer.new()
		under.alignment = BoxContainer.ALIGNMENT_CENTER
		under.add_theme_constant_override("separation", 4)
		under.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_content.add_child(under)
		_content.minimum_size_changed.connect(_fit)
		_fit()
		slot.mouse_entered.connect(func() -> void: _set_over(true))
		slot.mouse_exited.connect(func() -> void: _set_over(false))
		slot.gui_input.connect(_on_slot_input)

	## The card is drawn once it is in the tree (the card view's own nodes are ready then), with the artist of its picture.
	func _ready() -> void:
		view_card.show_object(_view, object_id)
		# The slot takes the pointer for the whole card.
		view_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for n: Node in view_card.find_children("*", "Control", true, false):
			(n as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
		# Drawn as the card itself, upright and without the board's chips (tapped, summoning sick).
		view_card.rotation_degrees = 0.0
		var chips := view_card.get_node_or_null("Chips") as Control
		if chips != null:
			chips.visible = false
		view_card.pivot_offset = Vector2.ZERO
		view_card.set_card_scale(_width / CardView.SIZE.x)
		var artist := Pictures.artist_of(view_card.picture_key)
		_credit.text = "Illustrated by %s" % artist
		_credit.visible = artist != ""
		_fit()

	## The card takes the room of what it holds, which moves inside it.
	func _fit() -> void:
		var m := _content.get_combined_minimum_size()
		custom_minimum_size = m
		_content.size = m
		_content.pivot_offset = Vector2(m.x / 2.0, slot.custom_minimum_size.y / 2.0)

	## Tilted by `degrees` round a point under the card, and `down` pixels lower (a fan).
	func tilt(degrees: float, down: float) -> void:
		pivot_offset = Vector2(_width / 2.0, _width * 88.0 / 63.0 * 1.1)
		rotation_degrees = degrees
		_base_y = down
		_place(false)

	func _on_slot_input(event: InputEvent) -> void:
		var mb := event as InputEventMouseButton
		if mb == null or not clickable:
			return
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_pressing = true
				_press_at = mb.position
			elif _pressing:
				_pressing = false
				if mb.position.distance_to(_press_at) < 8.0 and Rect2(Vector2.ZERO, slot.size).has_point(mb.position):
					pressed.emit(id)
			slot.accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			right_pressed.emit(id)
			slot.accept_event()

	func _set_over(on: bool) -> void:
		_over = on
		z_index = 100 if on else (50 if _selected else 0)
		if hover_ring.a > 0.0 and not _selected:
			_ring_color(hover_ring if on else NeonTheme.colors()[0])
			_ring.visible = on
		hovered.emit(object_id, on)
		_place(true)

	## Chosen: lifted (or dropped) with a glow round the picture and `mark` under it ("" for none).
	func set_selected(on: bool, mark: String = "") -> void:
		_selected = on
		_ring.visible = on
		if z_index != 100:
			z_index = 50 if on else 0
		if mark != "" and on:
			if _mark == null:
				_mark = Label.new()
				var s := StyleBoxFlat.new()
				s.bg_color = NeonTheme.colors()[0]
				s.set_corner_radius_all(999)
				s.content_margin_left = 12
				s.content_margin_right = 12
				s.content_margin_top = 2
				s.content_margin_bottom = 2
				_mark.add_theme_stylebox_override("normal", s)
				_mark.add_theme_color_override("font_color", Color("#03101f"))
				_mark.add_theme_font_override("font", Hud.bold_font())
				_mark.add_theme_font_size_override("font_size", 14)
				_mark.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
				under.add_child(_mark)
				under.move_child(_mark, 0)
			_mark.text = mark
			_mark.visible = true
		elif _mark != null:
			_mark.visible = false
		_place(true)

	func _ring_color(c: Color) -> void:
		var ring := _ring.get_theme_stylebox("panel") as StyleBoxFlat
		if ring != null:
			ring.border_color = c
			ring.shadow_color = Color(c, 0.75)

	## A card the choice cannot take: dimmed, with a note under it.
	func set_unchoosable(note: String) -> void:
		clickable = false
		view_card.modulate = Color(0.5, 0.5, 0.55)
		slot.mouse_default_cursor_shape = Control.CURSOR_ARROW
		add_note(note)

	func add_note(text: String, color: Color = Hud.MUTED) -> Label:
		var l := Label.new()
		l.text = text
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(minf(_width, 220.0), 0)
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.016, 0.04, 0.1, 0.9)
		s.set_corner_radius_all(999)
		s.content_margin_left = 10
		s.content_margin_right = 10
		s.content_margin_top = 2
		s.content_margin_bottom = 2
		l.add_theme_stylebox_override("normal", s)
		l.add_theme_color_override("font_color", color)
		l.add_theme_font_override("font", Hud.bold_font())
		l.add_theme_font_size_override("font_size", 12)
		l.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		under.add_child(l)
		return l

	## A mode written under the card, in a box the card's width, with its additional cost first ("+{1}").
	func add_mode_text(text: String, extra_cost: String) -> Control:
		_mode_box = PanelContainer.new()
		_mode_box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_mode_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var box := VBoxContainer.new()
		box.add_theme_constant_override("separation", 2)
		_mode_box.add_child(box)
		if extra_cost != "":
			var cost_line := HBoxContainer.new()
			cost_line.alignment = BoxContainer.ALIGNMENT_CENTER
			var plus := Label.new()
			plus.text = "+"
			plus.add_theme_font_override("font", Hud.bold_font())
			plus.add_theme_color_override("font_color", NeonTheme.colors()[0])
			cost_line.add_child(plus)
			var mc := ManaCost.new()
			mc.symbol_size = 15.0
			mc.cost = extra_cost
			mc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			cost_line.add_child(mc)
			box.add_child(cost_line)
		_mode_label = Label.new()
		_mode_label.text = text
		_mode_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_mode_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_mode_label.custom_minimum_size = Vector2(maxf(60.0, _width - 20.0), 0)
		_mode_label.add_theme_font_size_override("font_size", 14)
		_mode_label.add_theme_color_override("font_color", Color("#f2f8ff"))
		box.add_child(_mode_label)
		under.add_child(_mode_box)
		set_mode_text(text, false)
		return _mode_box

	func set_mode_text(text: String, chosen: bool) -> void:
		if _mode_box == null:
			return
		_mode_label.text = text
		var s := StyleBoxFlat.new()
		s.bg_color = Color(0.016, 0.04, 0.1, 0.92)
		s.set_border_width_all(1)
		s.border_color = NeonTheme.colors()[0] if chosen else Color(NeonTheme.colors()[0], 0.45)
		s.set_corner_radius_all(8)
		s.content_margin_left = 10
		s.content_margin_right = 10
		s.content_margin_top = 6
		s.content_margin_bottom = 6
		if chosen:
			s.shadow_color = Color(NeonTheme.colors()[0], 0.5)
			s.shadow_size = 12
		_mode_box.add_theme_stylebox_override("panel", s)

	func make_clickable() -> void:
		clickable = true
		slot.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND

	func _place(animate: bool) -> void:
		var y := _base_y
		var sc := 1.0
		if _selected:
			y += drop_when_chosen if drop_when_chosen != 0.0 else -selected_lift
		if _over:
			y -= hover_lift + (selected_lift * 0.25 if _selected and drop_when_chosen == 0.0 else 0.0)
			sc = hover_scale
		var target_scale := Vector2(sc, sc)
		if _tween != null:
			_tween.kill()
		if not animate or Settings.reduced_motion or not is_inside_tree():
			_content.position.y = y
			_content.scale = target_scale
			return
		_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
		_tween.tween_property(_content, "position:y", y, 0.14)
		_tween.tween_property(_content, "scale", target_scale, 0.14)
