class_name ReplayBar
extends PanelContainer
## The transport of a watched replay (packages/client/src/replays/viewer/ReplayBar.tsx), at the foot of the replay's panel: where the
## replay is ("Turn 7 · Bob · Declare blockers · action 83 of 214"), the timeline (a tick at every turn's start in the colour of
## that turn's player's seat, a dot for every spell cast, combat damage, life change and player leaving, and the head), and the
## transport: the turn before, one change back, play or pause, one change forward, the turn after, and the speed. The server's
## replay player moves (GameClient.replay_control); the bar only asks and shows GameClient.replay_state. Like the board, it makes no
## generic button sounds.

## The seats' colours, in seating order (a turn's tick).
const SEAT_COLORS: Array[Color] = [Color("#4fc3ff"), Color("#ff6bd5"), Color("#ffd166"), Color("#7ee081")]
const MARK_COLORS: Dictionary = {"spell": Color("#b98bff"), "combat": Color("#ff7a59"), "life": Color("#5ce1a7"), "left": Color.WHITE}
const MARK_NAMES: Dictionary = {"spell": "Spell cast", "combat": "Combat damage", "life": "Life change", "left": "A player left"}
## Which kind a position's dot shows when it has several (the first present wins).
const MARK_ORDER: Array[String] = ["left", "combat", "spell", "life"]
## The speeds offered, slowest first, then the players' own pace.
const SPEEDS: Array = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, "real"]

var _label: Label = null
var _timeline: Timeline = null
var _previous: Button = null
var _back: Button = null
var _play: Button = null
var _forward: Button = null
var _next: Button = null
var _speed: OptionButton = null


func _ready() -> void:
	set_meta(&"sfx_manual", true)
	var neon := NeonTheme.colors()[0]
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.02, 0.06, 0.14, 0.86)
	style.border_color = Color(neon, 0.35)
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 10
	style.shadow_color = Color(neon, 0.16)
	style.shadow_size = 10
	add_theme_stylebox_override("panel", style)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	add_child(box)
	_label = Label.new()
	_label.add_theme_font_override("font", Hud.bold_font())
	_label.add_theme_font_size_override("font_size", 12)
	_label.add_theme_color_override("font_color", Hud.TEXT)
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_label)
	_timeline = Timeline.new()
	_timeline.custom_minimum_size = Vector2(0, 22)
	_timeline.seek.connect(_on_seek)
	box.add_child(_timeline)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	_previous = _button(TransportIcon.PREVIOUS_TURN, "Previous turn (Shift+Left)", func() -> void: GameClient.replay_control("previousTurn"))
	_back = _button(TransportIcon.BACK, "Step back (Left)", func() -> void: GameClient.replay_control("step", -1))
	_play = _button(TransportIcon.PLAY, "Play (Space)", func() -> void: GameClient.replay_control("toggle"))
	_play.custom_minimum_size = Vector2(46, 32)
	_play.set_meta(&"slab", "primary")
	_forward = _button(TransportIcon.FORWARD, "Step forward (Right)", func() -> void: GameClient.replay_control("step", 1))
	_next = _button(TransportIcon.NEXT_TURN, "Next turn (Shift+Right)", func() -> void: GameClient.replay_control("nextTurn"))
	for b: Button in [_previous, _back, _play, _forward, _next]:
		row.add_child(b)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(gap)
	_speed = OptionButton.new()
	_speed.tooltip_text = "Speed ([ slower, ] faster)"
	_speed.focus_mode = Control.FOCUS_NONE
	_speed.add_theme_font_size_override("font_size", 13)
	for s: Variant in SPEEDS:
		_speed.add_item(speed_label(s))
	_speed.item_selected.connect(func(i: int) -> void: GameClient.replay_control("speed", SPEEDS[i]))
	row.add_child(_speed)
	box.add_child(row)
	GameClient.replay_state_changed.connect(_refresh)
	_refresh()


func _button(kind: int, tip: String, action: Callable) -> Button:
	var b := Button.new()
	b.tooltip_text = tip
	b.custom_minimum_size = Vector2(38, 32)
	b.focus_mode = Control.FOCUS_NONE
	b.set_meta(&"slab_depth", 3.0)
	b.pressed.connect(action)
	var icon := TransportIcon.new()
	icon.kind = kind
	icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(icon)
	return b


## "0.25×", "1×", "16×", "Real time".
static func speed_label(s: Variant) -> String:
	if s is String:
		return "Real time"
	var f := float(s)
	return ("%d×" % int(f)) if is_equal_approx(f, roundf(f)) else ("%s×" % str(f))


func _on_seek(position_index: int) -> void:
	GameClient.replay_control("seek", position_index)


func _refresh() -> void:
	var s := GameClient.replay_state
	var playable := Val.flag(s, "playable")
	var at := int(Val.num(s, "position"))
	var last := int(Val.num(s, "last"))
	_label.text = Val.text(s, "label", "Opening the replay…")
	var playing := Val.flag(s, "playing")
	(_play.get_child(0) as TransportIcon).kind = TransportIcon.PAUSE if playing else TransportIcon.PLAY
	_play.get_child(0).queue_redraw()
	_play.tooltip_text = "Pause (Space)" if playing else "Play (Space)"
	_play.disabled = not playable
	_previous.disabled = not playable or at == 0
	_back.disabled = not playable or at == 0
	_forward.disabled = not playable or at >= last
	_next.disabled = not playable or at >= last
	var speed: Variant = s.get("speed", 1.0)
	for i: int in SPEEDS.size():
		var x: Variant = SPEEDS[i]
		if (x is String and speed is String) or (not x is String and not speed is String and speed != null and is_equal_approx(float(x), float(speed))):
			_speed.select(i)
	_timeline.enabled = playable
	_timeline.last = last
	if not _timeline.dragging:
		_timeline.position_index = at
	_timeline.ticks = Val.list(s, "ticks")
	_timeline.markers = Val.list(s, "markers")
	_timeline.value_text = Val.text(s, "valueText")
	_timeline.queue_redraw()


## A transport glyph drawn as shapes (no font has every media symbol): the turn before (bar and two triangles), one back, play,
## pause, one forward, the turn after.
class TransportIcon:
	extends Control

	const PREVIOUS_TURN: int = 0
	const BACK: int = 1
	const PLAY: int = 2
	const PAUSE: int = 3
	const FORWARD: int = 4
	const NEXT_TURN: int = 5

	var kind: int = PLAY

	func _draw() -> void:
		var parent := get_parent() as BaseButton
		var c := Hud.TEXT
		if parent != null and parent.disabled:
			c = Color(c, 0.35)
		elif parent != null and String(parent.get_meta(&"slab", "")) == "primary":
			c = Color(0.02, 0.05, 0.12)
		var m := size / 2.0
		var h := 6.0
		match kind:
			PLAY:
				_tri(m + Vector2(1, 0), h + 1.0, 1.0, c)
			PAUSE:
				draw_rect(Rect2(m + Vector2(-5, -h), Vector2(3.5, h * 2.0)), c)
				draw_rect(Rect2(m + Vector2(1.5, -h), Vector2(3.5, h * 2.0)), c)
			BACK:
				_tri(m, h, -1.0, c)
			FORWARD:
				_tri(m, h, 1.0, c)
			PREVIOUS_TURN:
				draw_rect(Rect2(m + Vector2(-8, -h), Vector2(2, h * 2.0)), c)
				_tri(m + Vector2(-1, 0), h, -1.0, c)
				_tri(m + Vector2(5, 0), h, -1.0, c)
			NEXT_TURN:
				_tri(m + Vector2(-5, 0), h, 1.0, c)
				_tri(m + Vector2(1, 0), h, 1.0, c)
				draw_rect(Rect2(m + Vector2(6, -h), Vector2(2, h * 2.0)), c)

	## A triangle centred on `at`, `h` high each side of the middle, pointing right (dir 1) or left (-1).
	func _tri(at: Vector2, h: float, dir: float, c: Color) -> void:
		var w := h * 0.95
		draw_colored_polygon(PackedVector2Array([at + Vector2(-w / 2.0 * dir, -h), at + Vector2(w / 2.0 * dir, 0), at + Vector2(-w / 2.0 * dir, h)]), c)


## The timeline: a 6 px track with the turn ticks, the markers and the head, under the whole width as a slider (a click or a drag
## goes to that position, once it is let go). Hovering a tick or a marker names it.
class Timeline:
	extends Control

	signal seek(position_index: int)

	var enabled: bool = true
	var last: int = 0
	var position_index: int = 0
	var ticks: Array = []
	var markers: Array = []
	var value_text: String = ""
	var dragging: bool = false

	func _ready() -> void:
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		tooltip_text = " "

	func _x(p: float) -> float:
		return 0.0 if last <= 0 else size.x * p / float(last)

	func _at(x: float) -> int:
		return clampi(roundi(x / maxf(1.0, size.x) * last), 0, last)

	func _gui_input(event: InputEvent) -> void:
		if not enabled:
			return
		var mb := event as InputEventMouseButton
		if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				dragging = true
				position_index = _at(mb.position.x)
				queue_redraw()
			elif dragging:
				dragging = false
				seek.emit(_at(mb.position.x))
			accept_event()
			return
		var mm := event as InputEventMouseMotion
		if mm != null and dragging:
			position_index = _at(mm.position.x)
			queue_redraw()

	func _get_tooltip(at_position: Vector2) -> String:
		var best := ""
		var near := 5.0
		for t: Variant in ticks:
			var td := Val.as_dict(t)
			var d := absf(_x(Val.real(td, "position")) - at_position.x)
			if d <= near:
				near = d
				best = "Turn %d" % int(Val.num(td, "turn"))
		for mk: Variant in markers:
			var md := Val.as_dict(mk)
			var d := absf(_x(Val.real(md, "position")) - at_position.x)
			if d < near:
				near = d
				var names: Array[String] = []
				for k: Variant in Val.list(md, "kinds"):
					names.append(String(MARK_NAMES.get(String(k), String(k))))
				best = ", ".join(names)
		return best if best != "" else value_text

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var dim := 1.0 if enabled else 0.45
		var track := Rect2(0, 8, size.x, 6)
		var bg := StyleBoxFlat.new()
		bg.bg_color = Color(neon, 0.18 * dim)
		bg.set_corner_radius_all(3)
		draw_style_box(bg, track)
		for t: Variant in ticks:
			var td := Val.as_dict(t)
			var c: Color = SEAT_COLORS[clampi(int(Val.num(td, "seat")), 0, SEAT_COLORS.size() - 1)]
			draw_rect(Rect2(_x(Val.real(td, "position")) - 1.0, 2, 2, 18), Color(c, dim))
		for mk: Variant in markers:
			var md := Val.as_dict(mk)
			var kinds := Val.list(md, "kinds")
			var kind := ""
			for k: String in MARK_ORDER:
				if kinds.has(k):
					kind = k
					break
			if kind == "" and not kinds.is_empty():
				kind = String(kinds[0])
			var c: Color = MARK_COLORS.get(kind, Color("#cfe6ff"))
			var x := _x(Val.real(md, "position"))
			draw_circle(Vector2(x, 11), 3.0 if kind == "left" else 2.0, Color(c, dim))
		var hx := _x(position_index)
		draw_rect(Rect2(hx - 4.0, 2, 8, 18), Color(neon, 0.25 * dim))
		var head := StyleBoxFlat.new()
		head.bg_color = Color(1, 1, 1, dim)
		head.set_corner_radius_all(2)
		head.shadow_color = Color(neon, 0.9 * dim)
		head.shadow_size = 6
		draw_style_box(head, Rect2(hx - 2.0, 4, 4, 14))
