class_name SideView
extends Control
## One player's side of the table: the life panel (packages/client/src/board/PlayerPanel.tsx: name with the Turn and Priority
## or Deciding badges, life, poison and other counters, designations, speed, commander damage "N / 21" lit from 15 with the
## whole table behind "+N", the mana pool; cards in library and hand, graveyard and exile buttons), the battlefield in the browser's groups (board/model.ts battlefieldRows: creatures on the main line, lands
## at the left of the row behind it, other permanents at its right; attachments drawn under their host), and the hand (the
## viewer's fanned face up; anyone else's as card backs, since the view hides them).
##
## The Table places each Side (bottom for the viewer, top for the others) and calls `show_side` with every new view. Card
## nodes are kept by object id; ids change when a card changes zones (CR 400.7), so a moved card is a new node here (the
## animator flies it with the plan's old id -> new id map).

signal card_clicked(id: String)
signal card_right_clicked(id: String)
signal card_hovered(id: String, inside: bool)
signal player_clicked(id: String)
signal zone_requested(player: String, zone: String)

const CARD_SCENE: PackedScene = preload("res://scenes/Card.tscn")
const BOARD_SCALE: float = 0.72
const HAND_SCALE: float = 0.85
const BACK_SCALE: float = 0.5
const INFO_WIDTH: float = 170.0
const GAP: float = 8.0
const ROW_GAP: float = 10.0
## How far above the hand's top edge a dragged card must be let go to be played.
const PLAY_LINE_PX: float = 24.0

var player_id: String = ""
var at_top: bool = false
## id -> CardView
var _cards: Dictionary = {}
## Where the hand is drawn (local), for the animator's flights into and out of a hand.
var _hand_rect: Rect2 = Rect2()
## The viewer's hand card pointed at, raised toward the player (Hand.tsx), or "".
var _raised: String = ""
var _fx: PanelFx = null
var _fx_front: PanelFx = null
var _badges: HBoxContainer = null
var _stats: HFlowContainer = null
var _pool: HBoxContainer = null
## Commander card id -> the damage last shown, so a rise pops its chip (the commanderDamage event's pop).
var _damage_seen: Dictionary = {}
var _damage_ready: bool = false
var _command: Button = null
## The viewer's own order of their hand (never sent to the game: CR 402 gives a hand no order); a new card joins at the right.
var _hand_order: Array[String] = []
## The hand card being dragged, and where the hand was laid out (for the slots the other cards make room in).
var _dragging: String = ""
var _drag_slot: int = -1
var _hand_args: Array = []

@onready var _layer: Control = %Cards
@onready var _info: PanelContainer = %Info
@onready var _name: Label = %Name
@onready var _life: Label = %Life
@onready var _detail: Label = %Detail
@onready var _graveyard: Button = %Graveyard
@onready var _exile: Button = %Exile


func _ready() -> void:
	_info.gui_input.connect(_on_info_input)
	_fx = PanelFx.new()
	_fx.panel = _info
	_fx.life = _life
	add_child(_fx)
	move_child(_fx, 0)
	_fx_front = PanelFx.new()
	_fx_front.panel = _info
	_fx_front.life = _life
	_fx_front.front = true
	add_child(_fx_front)
	var box := _name.get_parent()
	_badges = HBoxContainer.new()
	_badges.add_theme_constant_override("separation", 4)
	_badges.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(_badges)
	box.move_child(_badges, _name.get_index() + 1)
	_stats = HFlowContainer.new()
	_stats.add_theme_constant_override("h_separation", 4)
	_stats.add_theme_constant_override("v_separation", 3)
	box.add_child(_stats)
	box.move_child(_stats, _life.get_index() + 1)
	_pool = HBoxContainer.new()
	_pool.add_theme_constant_override("separation", 6)
	_pool.tooltip_text = "Mana pool (CR 106.4); it empties at the end of each step and phase (CR 500.5)"
	_pool.mouse_filter = Control.MOUSE_FILTER_PASS
	box.add_child(_pool)
	box.move_child(_pool, _stats.get_index() + 1)
	_command = Button.new()
	_command.add_theme_font_size_override("font_size", 11)
	_command.tooltip_text = "Command zone (CR 408)"
	_command.visible = false
	_command.pressed.connect(func() -> void: zone_requested.emit(player_id, "command"))
	_exile.get_parent().add_child(_command)
	_graveyard.tooltip_text = "Graveyard (CR 404)"
	_exile.tooltip_text = "Exile (CR 406)"
	_graveyard.pressed.connect(func() -> void: zone_requested.emit(player_id, "graveyard"))
	_exile.pressed.connect(func() -> void: zone_requested.emit(player_id, "exile"))


## Draw this player's side from the view. `area` is where the side sits (in the parent's coordinates); `top` mirrors the rows
## (hand at the top edge, creatures toward the middle). `selection` and `client` give the glows.
func show_side(view: Dictionary, pid: String, top: bool, area: Rect2, selection: BoardSelection, client: Node) -> void:
	player_id = pid
	at_top = top
	position = area.position
	size = area.size
	_show_info(view, selection)
	var rows := View.rows_of(view, pid)
	var creatures: Array[String] = []
	creatures.assign(rows["creatures"])
	var lands: Array[String] = []
	lands.assign(rows["lands"])
	var others: Array[String] = []
	others.assign(rows["others"])
	var hand := _ordered_hand(View.hand_of(view, pid))
	var wanted: Dictionary = {}
	for id: String in creatures + lands + others + hand:
		wanted[id] = true
		for a: String in View.attachments_of(view, id):
			wanted[a] = true
	# Drop the cards that left; make the new ones.
	for id: Variant in _cards.keys():
		if not wanted.has(id):
			var gone: CardView = _cards[id]
			gone.queue_free()
			_cards.erase(id)
	for id: Variant in wanted.keys():
		if not _cards.has(id):
			var card: CardView = CARD_SCENE.instantiate()
			_layer.add_child(card)
			card.clicked.connect(func(cid: String) -> void: card_clicked.emit(cid))
			card.right_clicked.connect(func(cid: String) -> void: card_right_clicked.emit(cid))
			card.hovered.connect(func(cid: String, inside: bool) -> void:
				_on_hovered(cid, inside)
				card_hovered.emit(cid, inside))
			card.drag_started.connect(_on_drag_started)
			card.drag_moved.connect(_on_drag_moved)
			card.drag_ended.connect(_on_drag_ended)
			_cards[id] = card
		var shown: CardView = _cards[id]
		shown.show_object(view, String(id))
	# Rows.
	var x0: float = INFO_WIDTH
	var x1: float = size.x - 10.0
	var row_h: float = CardView.SIZE.y * BOARD_SCALE
	var hand_h: float = CardView.SIZE.y * (BACK_SCALE if top else HAND_SCALE)
	var creature_y: float
	var back_y: float
	var hand_y: float
	if top:
		hand_y = 0.0
		back_y = hand_h + ROW_GAP
		creature_y = back_y + row_h + ROW_GAP
	else:
		creature_y = 6.0
		back_y = creature_y + row_h + ROW_GAP
		hand_y = size.y - hand_h
	var split: float = x0 + (x1 - x0) * 0.55
	_place_row(view, creatures, x0, x1, creature_y, false)
	_place_row(view, lands, x0, split - GAP, back_y, false)
	_place_row(view, others, split + GAP, x1, back_y, true)
	for id: String in hand:
		(_cards[id] as CardView).draggable = not top and View.viewer(view) == pid
	_hand_args = [hand, x0, x1, hand_y, top]
	if _dragging == "":
		_place_hand(hand, x0, x1, hand_y, top)
	_hand_rect = Rect2(x0, hand_y, x1 - x0, hand_h)
	_set_glows(view, selection, client)
	_info.position = Vector2(0.0, size.y - _info.size.y - 4.0 if top else 4.0)


# ---- what the animator reads (fx/Animator.gd) ------------------------------------------------------------------------------------

## The card nodes of this side by object id (battlefield, attachments and hand). The animator measures and moves them; it never
## keeps them past the change it plays.
func card_nodes() -> Dictionary:
	return _cards


## The player's panel (name, life, zones): the animator's "disc" for blows, life changes and the final blow.
func avatar_node() -> Control:
	return _info


## A pile's place on screen (global canvas rect): the graveyard and exile buttons; the library and anything else is the panel.
func pile_rect(zone: String) -> Rect2:
	match zone:
		"graveyard":
			return _graveyard.get_global_rect()
		"exile":
			return _exile.get_global_rect()
		_:
			return _info.get_global_rect()


## The hand's place on screen (global canvas rect).
func hand_rect() -> Rect2:
	return Rect2(get_global_rect().position + _hand_rect.position, _hand_rect.size)


func _show_info(view: Dictionary, selection: BoardSelection) -> void:
	var p := View.player(view, player_id)
	_name.text = Val.text(p, "name", player_id)
	_life.text = str(Val.num(p, "life"))
	_life.tooltip_text = "Life total (CR 119)"
	_show_badges(view, p)
	_show_stats(view, p)
	_show_pool(p)
	var lines: Array[String] = []
	lines.append("Library %d · Hand %d" % [View.library_count(view, player_id), View.hand_of(view, player_id).size()])
	var command := View.command_of(view, player_id)
	if not command.is_empty():
		lines.append("Command zone %d" % command.size())
	_detail.text = "\n".join(lines)
	# Each pile says how many of its cards can be used now or picked in the current decision (ZoneViewer.tsx flags).
	for pair: Array in [[_graveyard, "Grave", View.graveyard_of(view, player_id)], [_exile, "Exile", View.exile_of(view, player_id)],
			[_command, "Cmd", View.command_of(view, player_id)]]:
		var b: Button = pair[0]
		var ids: Array[String] = pair[2]
		var playable := 0
		var choosable := 0
		for id: String in ids:
			if GameClient.is_playable(id):
				playable += 1
			if selection != null and (selection.can_select(id) or selection.is_selected(id)):
				choosable += 1
		var flags: Array[String] = []
		if playable > 0:
			flags.append("%d playable" % playable)
		if choosable > 0:
			flags.append("%d to choose" % choosable)
		b.text = "%s %d%s" % [pair[1], ids.size(), (" · " + ", ".join(flags)) if not flags.is_empty() else ""]
		b.modulate = Color(NeonTheme.colors()[0]).lightened(0.5) if not flags.is_empty() else Color.WHITE
	_command.visible = not View.command_of(view, player_id).is_empty()
	var life := int(Val.num(p, "life"))
	# Life at 10 or less turns amber, at 5 or less red and pulses (board.css is-low, is-critical; arena.css life-critical).
	if life <= 5:
		_life.add_theme_color_override("font_color", Color("#ff6b6b"))
	elif life <= 10:
		_life.add_theme_color_override("font_color", Color("#ffd27a"))
	else:
		_life.remove_theme_color_override("font_color")
	for fx: PanelFx in [_fx, _fx_front]:
		fx.critical = life <= 5
		fx.active = Val.text(View.turn(view), "activePlayer") == player_id
		fx.deciding = Val.text(View.pending(view), "player") == player_id
		fx.targetable = selection != null and selection.can_select(player_id) and not selection.is_selected(player_id)
	var colors := NeonTheme.colors()
	if selection != null and selection.is_selected(player_id):
		_info.modulate = Color(colors[1]).lightened(0.4)
	elif selection != null and selection.can_select(player_id):
		_info.modulate = Color(colors[0]).lightened(0.5)
	else:
		_info.modulate = Color.WHITE


## Turn (the active player, CR 102.1; nobody before the play order is chosen, CR 103.1), Priority or Deciding (CR 117: only the
## viewer's own decision is known), and Conceded, Lost or Won.
func _show_badges(view: Dictionary, p: Dictionary) -> void:
	for c: Node in _badges.get_children():
		c.queue_free()
	var turn := View.turn(view)
	if int(Val.num(turn, "number")) > 0 and Val.text(turn, "activePlayer") == player_id:
		_badges.add_child(_chip("Turn", "Active player (CR 102.1)", NeonTheme.colors()[0], true))
	var pending := View.pending(view)
	if Val.text(pending, "player") == player_id:
		var mine := View.viewer(view) == player_id
		var own_priority := mine and Val.text(pending, "kind") == "priority"
		_badges.add_child(_chip("Priority" if own_priority else "Deciding",
			"You must act or decide now (CR 117)" if mine else Val.text(pending, "prompt", "This player is deciding"), Color("#ffd27a"), true))
	var status := ""
	if Val.flag(p, "conceded"):
		status = "Conceded"
	elif Val.flag(p, "hasLost"):
		status = "Lost"
	elif Val.text(View.result(view), "winner") == player_id:
		status = "Won"
	if status != "":
		_badges.add_child(_chip(status, "", NeonTheme.colors()[1], true))
	_badges.visible = _badges.get_child_count() > 0


## Poison and other counters (CR 122.1), the monarch (CR 725), the initiative (CR 726), completed dungeons (CR 309.7), the city's
## blessing (CR 702.131c), commander damage (CR 903.10a), an enduring story, speed (CR 702.179).
func _show_stats(view: Dictionary, p: Dictionary) -> void:
	for c: Node in _stats.get_children():
		c.queue_free()
	var neon := NeonTheme.colors()[0]
	var poison := int(Val.num(p, "poison"))
	if poison > 0:
		_stats.add_child(_chip("☠ %d" % poison, "Poison counters; ten or more loses the game (CR 122.1f, 704.5c)", Color("#8fe36b")))
	var counters := Val.dict(p, "counters")
	for k: Variant in counters:
		if Val.as_int(counters[k]) > 0:
			_stats.add_child(_chip("%s %d" % [k, Val.as_int(counters[k])], "%s counters (CR 122.1)" % k, neon))
	var d := Val.dict(view, "designations")
	if Val.text(d, "monarch") == player_id:
		_stats.add_child(_chip("Monarch", "The monarch (CR 725)", neon))
	if Val.text(d, "initiative") == player_id:
		_stats.add_child(_chip("Initiative", "The initiative (CR 726)", neon))
	var completed: Array = Val.list(Val.dict(d, "completedDungeons"), player_id)
	if not completed.is_empty():
		_stats.add_child(_chip("Dungeons %d" % completed.size(), "Completed dungeons (CR 309.7): %s" % ", ".join(PackedStringArray(completed)), neon))
	if Val.list(d, "citysBlessing").has(player_id):
		_stats.add_child(_chip("City's blessing", "City's blessing (CR 702.131c)", neon))
	var lines := damage_lines(view, p)
	var shown := lines
	if lines.size() > 3:
		# The highest three (ties in the table's order) and "+N" for the whole table.
		var order: Array = range(lines.size())
		order.sort_custom(func(a: int, b: int) -> bool:
			return int(lines[a]["amount"]) > int(lines[b]["amount"]) or (int(lines[a]["amount"]) == int(lines[b]["amount"]) and a < b))
		var top := {}
		for i: int in 3:
			top[order[i]] = true
		shown = []
		for i: int in lines.size():
			if top.has(i):
				shown.append(lines[i])
	for l: Dictionary in shown:
		var high := bool(l["high"])
		var chip := _chip("%s %d / %d" % [l["name"], l["amount"], l["limit"]],
			"Combat damage from %s this game; %d or more from one commander loses the game (CR 903.10a, 704.6c)" % [l["name"], l["limit"]],
			NeonTheme.colors()[1] if high else neon, high)
		_stats.add_child(chip)
		# A rise since the panel was last drawn pops the chip (not the damage already there when the table opened).
		if _damage_ready and int(l["amount"]) > int(_damage_seen.get(l["commander"], 0)):
			_pop(chip)
		_damage_seen[l["commander"]] = int(l["amount"])
	if lines.size() > 3:
		var more := Button.new()
		more.text = "+%d" % (lines.size() - 3)
		more.tooltip_text = "Commander damage of the whole table (CR 903.10a)"
		more.add_theme_font_size_override("font_size", 11)
		more.pressed.connect(func() -> void: _damage_table(view))
		_stats.add_child(more)
	if Val.list(d, "enduringStory").has(player_id):
		_stats.add_child(_chip("Enduring story", "Enduring story: kept for the rest of the game (Storied: three or more artifacts, legendaries and/or Sagas)", neon))
	var speed := Val.dict(d, "speed")
	if speed.has(player_id):
		var n := Val.as_int(speed[player_id])
		_stats.add_child(_chip("Speed %s" % (("%d (max)" % n) if n >= 4 else str(n)),
			"Speed: increases once on each of your turns when an opponent loses life; max speed is 4 (CR 702.179)", neon))
	_stats.visible = _stats.get_child_count() > 0
	_damage_ready = true


## The combat damage each commander has dealt `p` this game against the variant's limit (none without that rule: Brawl).
static func damage_lines(view: Dictionary, p: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var limit_v: Variant = Val.dict(Val.dict(view, "options"), "commander").get("damageLimit")
	var taken := Val.dict(p, "commanderDamage")
	if limit_v == null or taken.is_empty():
		return out
	var limit := Val.as_int(limit_v)
	for q: Dictionary in View.players(view):
		for rec: Variant in Val.list(q, "commanders"):
			var r := Val.as_dict(rec)
			var amount := Val.as_int(taken.get(Val.text(r, "card")))
			if amount <= 0:
				continue
			var def := Val.dict(View.defs(view), Val.text(r, "defId"))
			out.append({"commander": Val.text(r, "card"), "name": Val.text(def, "name", "Commander"), "owner": Val.text(q, "id"),
				"amount": amount, "limit": limit, "high": amount >= limit - 6})
	return out


## Every player's combat damage from every commander that dealt any (CR 903.10a), lit from the limit minus 6.
func _damage_table(view: Dictionary) -> void:
	var popup := PopupPanel.new()
	var grid := GridContainer.new()
	var commanders: Array = []
	var limit := 21
	for p: Dictionary in View.players(view):
		for l: Dictionary in damage_lines(view, p):
			limit = int(l["limit"])
			var known := false
			for c: Dictionary in commanders:
				known = known or c["card"] == l["commander"]
			if not known:
				commanders.append({"card": l["commander"], "name": l["name"]})
	grid.columns = commanders.size() + 1
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_child(Label.new())
	for c: Dictionary in commanders:
		grid.add_child(Hud.kicker(String(c["name"]), Hud.MUTED))
	for p: Dictionary in View.players(view):
		var name_label := Label.new()
		name_label.text = Val.text(p, "name")
		grid.add_child(name_label)
		var taken := Val.dict(p, "commanderDamage")
		for c: Dictionary in commanders:
			var n := Val.as_int(taken.get(c["card"]))
			var cell := Label.new()
			cell.text = str(n)
			if n >= limit - 6:
				cell.add_theme_color_override("font_color", NeonTheme.colors()[1])
			grid.add_child(cell)
	popup.add_child(grid)
	add_child(popup)
	popup.popup(Rect2i(Vector2i(get_global_mouse_position()), Vector2i.ZERO))


## The mana pool (CR 106.4): each type with its count; "*" when some of it is restricted or snow (CR 106.6).
func _show_pool(p: Dictionary) -> void:
	for c: Node in _pool.get_children():
		c.queue_free()
	var pool: Array = Val.list(p, "manaPool")
	for t: String in ["W", "U", "B", "R", "G", "C"]:
		var n := 0
		var special := 0
		for u: Variant in pool:
			var unit := Val.as_dict(u)
			if Val.text(unit, "type") == t:
				n += 1
				if unit.has("restriction") or Val.flag(unit, "snow"):
					special += 1
		if n == 0:
			continue
		var symbol := ManaCost.new()
		symbol.symbol_size = 16.0
		symbol.cost = "{%s}" % t
		symbol.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_pool.add_child(symbol)
		var count := Label.new()
		count.text = "×%d%s" % [n, "*" if special > 0 else ""]
		count.add_theme_font_size_override("font_size", 12)
		_pool.add_child(count)
	_pool.visible = not pool.is_empty()


## A small rounded label (a badge or a stat), its meaning as the tooltip.
func _chip(text: String, tip: String, edge: Color, strong: bool = false) -> Label:
	var l := Label.new()
	l.text = text
	l.tooltip_text = tip
	l.mouse_filter = Control.MOUSE_FILTER_PASS
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", Color.WHITE if strong else Color(0.9, 0.93, 1.0))
	var s := StyleBoxFlat.new()
	s.bg_color = Color(edge, 0.28 if strong else 0.1)
	s.border_color = Color(edge, 0.85 if strong else 0.45)
	s.set_border_width_all(1)
	s.set_corner_radius_all(6)
	s.content_margin_left = 5
	s.content_margin_right = 5
	l.add_theme_stylebox_override("normal", s)
	return l


## The commander-damage pop: the chip grows and settles back (the animator's commanderDamage beat).
func _pop(chip: Control) -> void:
	if Settings.reduced_motion:
		return
	chip.pivot_offset = chip.size / 2.0
	chip.scale = Vector2.ONE * 1.35
	var t := chip.create_tween()
	t.tween_property(chip, "scale", Vector2.ONE, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


# ---- dragging hand cards (Hand.tsx) --------------------------------------------------------------------------------------------

## The hand in the player's own order; cards not placed yet join at the right.
func _ordered_hand(ids: Array[String]) -> Array[String]:
	var out: Array[String] = []
	for id: String in _hand_order:
		if ids.has(id):
			out.append(id)
	for id: String in ids:
		if not out.has(id):
			out.append(id)
	_hand_order = out.duplicate()
	return out


func _on_drag_started(id: String) -> void:
	_dragging = id
	_drag_slot = _hand_order.find(id)
	_raise(_cards[id] as CardView, false, false)
	(_cards[id] as CardView).z_index = 60
	Sound.cue("card.pickup")


## The card follows the pointer; the others make room where it would go.
func _on_drag_moved(id: String, at: Vector2) -> void:
	if id != _dragging or _hand_args.is_empty():
		return
	var card: CardView = _cards[id]
	var local := get_global_transform().affine_inverse() * at
	card.position = local - card.pivot_offset
	card.rotation_degrees = 0.0
	var others: Array[String] = []
	for h: String in _hand_order:
		if h != id:
			others.append(h)
	# The slot: how many of the other cards' centres lie left of the pointer.
	var slot := 0
	for h: String in others:
		var c: CardView = _cards[h]
		if (c.get_meta(&"hand_base", c.position) as Vector2).x + c.pivot_offset.x < local.x:
			slot += 1
	if slot != _drag_slot:
		_drag_slot = slot
		var order: Array[String] = others.duplicate()
		order.insert(slot, id)
		_place_hand(order, float(_hand_args[1]), float(_hand_args[2]), float(_hand_args[3]), bool(_hand_args[4]))
		card.position = local - card.pivot_offset
		card.z_index = 60


## Let go above the hand's top edge (by PLAY_LINE_PX) a card is played as a click plays it; anywhere else it takes its new place.
func _on_drag_ended(id: String, at: Vector2) -> void:
	if id != _dragging:
		return
	_dragging = ""
	var local := get_global_transform().affine_inverse() * at
	var played := not at_top and local.y < _hand_rect.position.y - PLAY_LINE_PX and not GameClient.legal_for(id).is_empty()
	var others: Array[String] = []
	for h: String in _hand_order:
		if h != id:
			others.append(h)
	var order: Array[String] = others.duplicate()
	order.insert(clampi(_drag_slot, 0, others.size()), id)
	var moved := order != _hand_order
	if not played:
		_hand_order = order
	if not _hand_args.is_empty():
		_place_hand(_hand_order, float(_hand_args[1]), float(_hand_args[2]), float(_hand_args[3]), bool(_hand_args[4]))
	if played:
		Sound.cue("card.drop")
		card_clicked.emit(id)
	elif moved:
		Sound.cue("ui.tick")


## A row of permanents between x0 and x1 (squeezed when there is no room), each with its attachments peeking out behind it.
func _place_row(view: Dictionary, ids: Array[String], x0: float, x1: float, y: float, align_right: bool) -> void:
	if ids.is_empty():
		return
	var widths: Array[float] = []
	var total: float = 0.0
	for id: String in ids:
		var tapped := Val.flag(View.object(view, id), "tapped")
		var w: float = (CardView.SIZE.y if tapped else CardView.SIZE.x) * BOARD_SCALE + GAP
		widths.append(w)
		total += w
	var room: float = maxf(1.0, x1 - x0)
	var squeeze: float = minf(1.0, room / total)
	var x: float = (x1 - total * squeeze) if align_right else x0
	var center_y: float = y + CardView.SIZE.y * BOARD_SCALE * 0.5
	for i: int in range(ids.size()):
		var w: float = widths[i] * squeeze
		var center := Vector2(x + w * 0.5, center_y)
		var host: CardView = _cards[ids[i]]
		_put(host, center, BOARD_SCALE, 2)
		var attached := View.attachments_of(view, ids[i])
		for k: int in range(attached.size()):
			if _cards.has(attached[k]):
				var a: CardView = _cards[attached[k]]
				_put(a, center + Vector2(-8.0 - 8.0 * k, -14.0 - 10.0 * k), BOARD_SCALE, 1)
		x += w


## The hand: the viewer's fanned, face up; anyone else's as a row of small card backs.
func _place_hand(ids: Array[String], x0: float, x1: float, y: float, top: bool) -> void:
	var n := ids.size()
	if n == 0:
		return
	var s: float = BACK_SCALE if top else HAND_SCALE
	var card_w: float = CardView.SIZE.x * s
	var step: float = minf(card_w * (0.55 if top else 0.92), (x1 - x0 - card_w) / maxf(1.0, n - 1.0))
	var width: float = step * (n - 1) + card_w
	var start: float = x0 + (x1 - x0 - width) * 0.5 + card_w * 0.5
	for i: int in range(n):
		var card: CardView = _cards[ids[i]]
		var t: float = (i - (n - 1) * 0.5)
		var lift: float = 0.0 if top else absf(t) * absf(t) * 1.2
		_put(card, Vector2(start + step * i, y + CardView.SIZE.y * s * 0.5 + lift), s, 3 + i)
		card.set_meta(&"hand_base", card.position)
		card.set_meta(&"hand_z", 3 + i)
		if not top:
			card.rotation_degrees = t * 2.5
			card.set_meta(&"hand_rot", t * 2.5)
			if String(ids[i]) == _raised:
				_raise(card, true, false)


## Place a card with its centre at `center` (the card's pivot is its centre, so scale and rotation keep it there).
func _put(card: CardView, center: Vector2, s: float, z: int) -> void:
	card.set_card_scale(s)
	card.position = center - card.pivot_offset
	card.z_index = z


func _set_glows(view: Dictionary, selection: BoardSelection, client: Node) -> void:
	# With priority, every card that has an action is clickable (lands and mana sources too), but only what can be cast or
	# activated now glows (GameClient.is_playable): a land never does.
	var priority := Val.text(View.pending(view), "kind") == "priority"
	for id: Variant in _cards.keys():
		var card: CardView = _cards[id]
		var cid := String(id)
		card.set_mark(selection.mark_of(cid) if selection != null else "")
		if selection != null and selection.is_selected(cid):
			card.set_glow(CardView.GlowKind.SELECTED)
		elif selection != null and selection.can_select(cid) and not priority:
			card.set_glow(CardView.GlowKind.SELECTABLE)
		elif View.is_attacking(view, cid):
			card.set_glow(CardView.GlowKind.ATTACKING)
		elif View.is_blocking(view, cid):
			card.set_glow(CardView.GlowKind.BLOCKING)
		elif client != null and client.has_method("is_playable") and bool(client.call("is_playable", cid)):
			card.set_glow(CardView.GlowKind.PLAYABLE)
		else:
			card.set_glow(CardView.GlowKind.NONE)


## Redraw only the glows (the selection changed; the view did not).
func refresh_glows(view: Dictionary, selection: BoardSelection, client: Node) -> void:
	_show_info(view, selection)
	_set_glows(view, selection, client)


func _on_info_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
		player_clicked.emit(player_id)


# ---- the hand raising the card pointed at -------------------------------------------------------------------------------

func _on_hovered(cid: String, inside: bool) -> void:
	if at_top or not _cards.has(cid) or not (_cards[cid] as CardView).has_meta(&"hand_base"):
		return
	var card: CardView = _cards[cid]
	if not card.has_meta(&"hand_rot"):
		return
	if inside:
		if _raised != "" and _raised != cid and _cards.has(_raised):
			_raise(_cards[_raised], false, true)
		_raised = cid
		_raise(card, true, true)
	elif _raised == cid:
		_raised = ""
		_raise(card, false, true)


## Raise a hand card toward the player (upright, on top of the others) or put it back in the fan.
func _raise(card: CardView, up: bool, animate: bool) -> void:
	var base: Vector2 = card.get_meta(&"hand_base")
	var to := base - Vector2(0.0, CardView.SIZE.y * HAND_SCALE * 0.22 + 4.0) if up else base
	var rot: float = 0.0 if up else float(card.get_meta(&"hand_rot", 0.0))
	card.z_index = 60 if up else int(card.get_meta(&"hand_z", 3))
	if not animate or Settings.reduced_motion:
		card.position = to
		card.rotation_degrees = rot
		return
	var t := card.create_tween().set_parallel().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	t.tween_property(card, "position", to, 0.14)
	t.tween_property(card, "rotation_degrees", rot, 0.14)


## The player panel's idle light (arena.css): the active player's ring turns (disc-spin, 14 s); the deciding player's panel
## breathes light (disc-breathe, 1.8 s); a player who can be chosen pulses (target-pulse, 1.1 s); critical life pulses
## (life-critical, 1.1 s). Drawn behind the panel; the life number is scaled about its centre.
class PanelFx:
	extends Control

	var panel: Control = null
	var life: Label = null
	## In front of the panel (the ring round the life number), else behind it (the halo and the target ring).
	var front: bool = false
	var active: bool = false
	var deciding: bool = false
	var targetable: bool = false
	var critical: bool = false
	var _t: float = 0.0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _process(delta: float) -> void:
		_t += delta
		if panel == null:
			return
		position = panel.position
		size = panel.size
		if life != null and front:
			life.pivot_offset = life.size / 2.0
			var k := 1.0
			if critical and not Settings.reduced_motion:
				k = 1.0 + 0.12 * (0.5 - 0.5 * cos(_t * TAU / 1.1))
			life.scale = Vector2(k, k)
		queue_redraw()

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var still := Settings.reduced_motion
		var rect := Rect2(Vector2.ZERO, size)
		if front:
			_draw_ring(still)
			return
		if deciding:
			var breathe := 0.6 if still else 0.5 - 0.5 * cos(_t * TAU / 1.8)
			var halo := StyleBoxFlat.new()
			halo.draw_center = false
			halo.set_corner_radius_all(8)
			halo.shadow_color = Color(neon, 0.75 * breathe)
			halo.shadow_size = 22
			draw_style_box(halo, rect)
		if targetable:
			var k := 0.0 if still else 0.5 - 0.5 * cos(_t * TAU / 1.1)
			var grow := rect.grow(2.0 + 6.0 * k)
			var ring := StyleBoxFlat.new()
			ring.draw_center = false
			ring.set_border_width_all(2)
			ring.border_color = Color(neon, 0.9 - 0.4 * k)
			ring.set_corner_radius_all(10)
			draw_style_box(ring, grow)

	## A turning ring round the life number of the player whose turn it is, in two arcs of the two colours.
	func _draw_ring(still: bool) -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		if active and life != null:
			# Round the number itself: the label may be wider than its text.
			var font := life.get_theme_font("font")
			var font_size := life.get_theme_font_size("font_size")
			var text_w := font.get_string_size(life.text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x if font != null else life.size.x
			var box := life.get_global_rect()
			var left := box.position.x
			if life.horizontal_alignment == HORIZONTAL_ALIGNMENT_CENTER:
				left += (box.size.x - text_w) / 2.0
			elif life.horizontal_alignment == HORIZONTAL_ALIGNMENT_RIGHT:
				left += box.size.x - text_w
			var c := Vector2(left + text_w / 2.0, box.get_center().y) - get_global_rect().position
			var r := maxf(life.size.y * 0.62, 24.0)
			var a := 0.0 if still else _t * TAU / 14.0
			draw_arc(c, r, a, a + PI * 0.7, 32, Color(neon, 0.8), 2.0, true)
			draw_arc(c, r, a + PI, a + PI * 1.7, 32, Color(neon2, 0.8), 2.0, true)
			draw_arc(c, r + 5.0, -a * 1.3, -a * 1.3 + PI * 0.35, 16, Color(neon, 0.35), 1.0, true)
