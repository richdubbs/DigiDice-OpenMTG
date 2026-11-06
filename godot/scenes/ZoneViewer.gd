class_name ZoneViewer
extends Control
## A graveyard, exile or command zone shown as its cards, top first (packages/client/src/board/ZoneViewer.tsx; CR 404, 406, 408:
## these zones are public, except face-down exiled cards, which only their controller may look at). The cards glow and click as on
## the battlefield, so a card usable from here (flashback, escape …) or one to pick in the current decision is used from here.
## Escape, Close or the dimmed table closes it (ui.close); it follows every new view while open.

const RULES: Dictionary = {"graveyard": "CR 404", "exile": "CR 406", "command": "CR 408"}
const TITLES: Dictionary = {"graveyard": "graveyard", "exile": "exile", "command": "command zone"}
const CARD_SCALE: float = 0.8

var player: String = ""
var zone: String = ""
var _table: Node = null
var _title: Label = null
var _grid: HFlowContainer = null
var _cards: Dictionary = {}


## Over `table`'s interface layer (its "UI" CanvasLayer).
static func open(table: Node, player_id: String, zone_name: String) -> ZoneViewer:
	var v := ZoneViewer.new()
	v.player = player_id
	v.zone = zone_name
	v._table = table
	v.mouse_filter = Control.MOUSE_FILTER_STOP
	v.z_index = 40
	table.get_node("UI").add_child(v)
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v._build()
	Sound.cue("ui.open")
	return v


## The cards of a player's zone, top first.
static func ids_of(view: Dictionary, player_id: String, zone_name: String) -> Array[String]:
	var ids: Array[String] = []
	match zone_name:
		"graveyard":
			ids = View.graveyard_of(view, player_id)
		"exile":
			ids = View.exile_of(view, player_id)
		"command":
			ids = View.command_of(view, player_id)
	ids.reverse()
	return ids


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.008, 0.02, 0.047, 0.78)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			close())
	add_child(dim)
	var panel := Hud.panel(18)
	panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	panel.offset_left = 120
	panel.offset_right = -120
	panel.offset_top = 90
	panel.offset_bottom = -90
	add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	_title = Label.new()
	_title.add_theme_font_override("font", Hud.bold_font())
	_title.add_theme_font_size_override("font_size", 20)
	head.add_child(_title)
	var rule := Hud.text(String(RULES.get(zone, "")), 12)
	rule.autowrap_mode = TextServer.AUTOWRAP_OFF
	rule.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	rule.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(rule)
	var close_button := Hud.button("Close")
	close_button.set_meta(&"sfx", "none")
	close_button.pressed.connect(close)
	head.add_child(close_button)
	box.add_child(head)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(scroll)
	_grid = HFlowContainer.new()
	_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_grid.add_theme_constant_override("h_separation", 14)
	_grid.add_theme_constant_override("v_separation", 14)
	scroll.add_child(_grid)
	GameClient.view_changed.connect(_on_view_changed)
	refresh()
	close_button.grab_focus.call_deferred()


func _on_view_changed(_seq: int) -> void:
	refresh()


## Draw the zone as the view has it now, and its cards' glows.
func refresh() -> void:
	var view := GameClient.view
	var ids := ids_of(view, player, zone)
	_title.text = "%s's %s (%d card%s)" % [View.player_name(view, player), String(TITLES.get(zone, zone)), ids.size(), "" if ids.size() == 1 else "s"]
	var wanted := {}
	for id: String in ids:
		wanted[id] = true
	for id: Variant in _cards.keys():
		if not wanted.has(id):
			(_cards[id] as Control).get_parent().queue_free()
			_cards.erase(id)
	for i: int in ids.size():
		var id := ids[i]
		if not _cards.has(id):
			var holder := Control.new()
			holder.custom_minimum_size = CardView.SIZE * CARD_SCALE
			var card: CardView = SideView.CARD_SCENE.instantiate()
			card.scale = Vector2.ONE * CARD_SCALE
			holder.add_child(card)
			card.clicked.connect(func(cid: String) -> void: _table.call("_on_card_clicked", cid))
			card.hovered.connect(func(cid: String, inside: bool) -> void: _table.call("_on_card_hovered", cid, inside))
			_grid.add_child(holder)
			_cards[id] = card
		var shown: CardView = _cards[id]
		shown.show_object(view, id)
		shown.rotation_degrees = 0.0
		_grid.move_child(shown.get_parent(), i)
	if ids.is_empty() and _grid.get_child_count() == 0:
		_grid.add_child(Hud.text("No cards.", 14))
	_glows(view)


func _glows(view: Dictionary) -> void:
	var sel: BoardSelection = GameClient.selection
	var priority := Val.text(View.pending(view), "kind") == "priority"
	for id: Variant in _cards:
		var card: CardView = _cards[id]
		var cid := String(id)
		card.set_mark(sel.mark_of(cid) if sel != null else "")
		if sel != null and sel.is_selected(cid):
			card.set_glow(CardView.GlowKind.SELECTED)
		elif sel != null and sel.can_select(cid) and not priority:
			card.set_glow(CardView.GlowKind.SELECTABLE)
		elif GameClient.is_playable(cid):
			card.set_glow(CardView.GlowKind.PLAYABLE)
		else:
			card.set_glow(CardView.GlowKind.NONE)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		close()


func close() -> void:
	Sound.cue("ui.close")
	queue_free()
