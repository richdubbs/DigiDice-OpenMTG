class_name HomeScreen
extends Control
## Home (packages/client/src/screens/HomeScreen.tsx): the top bar, the living floor (HomeFx), the DigiDice mark in 3D with its
## glow, its two turning rings and a spark orbiting each, "OPENMTG BY DIGIDICE" over its accent rule, the one-line description,
## the big PLAY slab (Back to game while a game is open) with its glint, then Decks, Images, Settings and About; the card
## automation panel on the left, its bars filling as Home opens (HomeProgress.tsx), the roadmap on the right, its items sliding
## in one after another (HomeRoadmap.tsx); the footer. The numbers are measured, not live: data/coverage-stats.json and
## data/roadmap.json are copied from the TypeScript source's client (screens/coverage-stats.json, screens/roadmap.ts).

const COVERAGE_PATH: String = "res://data/coverage-stats.json"
const ROADMAP_PATH: String = "res://data/roadmap.json"
## The upcoming set shown on its own (HomeProgress.tsx SPOTLIGHT_SET).
const SPOTLIGHT_SET: String = "TRK"
const SIDE_WIDTH: float = 316.0
const MONTHS: Array[String] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
	"November", "December"]

var _play: Button = null
var _note: Label = null


func _ready() -> void:
	var fx_layer := CanvasLayer.new()
	fx_layer.layer = -9
	add_child(fx_layer)
	fx_layer.add_child(HomeFx.new())
	TopBar.attach(self)
	var footer := Footer.attach(self)
	var body := MarginContainer.new()
	body.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	body.offset_top = TopBar.HEIGHT + 18
	body.offset_bottom = -64
	body.add_theme_constant_override("margin_left", 24)
	body.add_theme_constant_override("margin_right", 24)
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(body)
	move_child(body, footer.get_index())
	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 24)
	columns.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.add_child(columns)
	var coverage := _read_json(COVERAGE_PATH)
	columns.add_child(_progress_panel(coverage))
	columns.add_child(_hero())
	columns.add_child(_roadmap_panel(_read_json(ROADMAP_PATH), coverage))
	_play.owner = self
	_play.unique_name_in_owner = true
	GameClient.table_opened.connect(func(_t: String) -> void: _refresh())
	GameClient.disconnected.connect(_refresh)
	GameClient.connected.connect(_refresh)
	_refresh()


func _refresh() -> void:
	_play.text = "BACK TO GAME" if Nav.in_game() else "PLAY"
	if not Server.is_ready:
		_note.text = "The game server is not running."
	elif not GameClient.online:
		_note.text = "Connecting to the game server…"
	else:
		_note.text = ""


# ---- the middle ----------------------------------------------------------------------------------------------------------

func _hero() -> Control:
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 14)
	var emblem := Emblem.new()
	emblem.custom_minimum_size = Vector2(300, 290)
	emblem.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(emblem)
	var title := Hud.title("OpenMTG by DigiDice", 36)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(title)
	var rule := TitleRule.new()
	rule.custom_minimum_size = Vector2(180, 3)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(rule)
	var tagline := Hud.text("A free, open-source fan implementation of the Magic: The Gathering rules. Hot-seat play for two, or play against the computer.", 16)
	tagline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tagline.custom_minimum_size = Vector2(560, 0)
	tagline.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(tagline)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 10)
	col.add_child(gap)
	_play = Hud.primary("Play", 26)
	_play.name = "NewGame"
	_play.set_meta(&"slab_depth", 6.0)
	_play.set_meta(&"slab_glint", true)
	_play.set_meta(&"slab_pulse", true)
	_play.custom_minimum_size = Vector2(300, 64)
	_play.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_play.pressed.connect(Nav.go.bind("play"))
	col.add_child(_play)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 12)
	for item: Array in [["decks", "Decks"], ["images", "Images"], ["settings", "Settings"], ["about", "About"]]:
		var b := Hud.button(String(item[1]))
		b.name = String(item[1])
		b.custom_minimum_size = Vector2(130, 40)
		if Nav.exists(String(item[0])):
			b.pressed.connect(Nav.go.bind(String(item[0])))
		else:
			b.disabled = true
			b.tooltip_text = "Coming soon"
		row.add_child(b)
	col.add_child(row)
	_note = Hud.text("", 12)
	_note.name = "Note"
	_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_note)
	return col


# ---- the automation panel (left) --------------------------------------------------------------------------------------------

func _progress_panel(stats: Dictionary) -> Control:
	var panel := Hud.panel(16)
	panel.name = "Progress"
	panel.custom_minimum_size = Vector2(SIDE_WIDTH, 0)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 12)
	scroll.add_child(box)
	box.add_child(Hud.kicker("Rules engine progress"))
	box.add_child(Hud.title("Cards automated", 21))
	if stats.is_empty():
		box.add_child(Hud.text("The measured numbers are missing.", 13))
		return panel
	box.add_child(_bar("All cards", Val.dict(stats, "all"), "hero", 0.25))
	var formats: Array = Val.list(stats, "formats")
	for f: Variant in formats:
		if Val.text(Val.as_dict(f), "key") == "standard":
			box.add_child(_bar("Standard", Val.as_dict(f), "big", 0.55))
	for u: Variant in Val.list(stats, "upcoming"):
		var spot := Val.as_dict(u)
		if Val.text(spot, "code") != SPOTLIGHT_SET:
			continue
		var known := int(Val.num(spot, "cards")) + int(Val.num(spot, "notInIndex"))
		var counts := spot.duplicate()
		counts["cards"] = known
		var open := int(Val.num(spot, "partial")) + int(Val.num(spot, "manual")) + int(Val.num(spot, "notInIndex"))
		var box_spot := Hud.panel(10)
		var inner := VBoxContainer.new()
		inner.add_theme_constant_override("separation", 6)
		box_spot.add_child(inner)
		inner.add_child(Hud.kicker("Upcoming set · out %s" % _date_words(Val.text(spot, "released")), NeonTheme.colors()[0]))
		inner.add_child(_bar(Val.text(spot, "name"), counts, "big", 0.7, "%s currently known cards: %s completed · %s not completed" % [
			Hud.thousands(known), Hud.thousands(int(Val.num(spot, "full"))), Hud.thousands(open)]))
		box.add_child(box_spot)
	var i := 0
	for f: Variant in formats:
		var d := Val.as_dict(f)
		if Val.text(d, "key") != "standard":
			box.add_child(_bar(Val.text(d, "label"), d, "mid", 0.8 + i * 0.12))
			i += 1
	var sets: Array = Val.list(stats, "standardSets")
	if not sets.is_empty():
		box.add_child(Hud.kicker("Standard sets", Hud.MUTED))
		var grid := GridContainer.new()
		grid.columns = 2
		grid.add_theme_constant_override("h_separation", 14)
		grid.add_theme_constant_override("v_separation", 8)
		var k := 0
		for s: Variant in sets:
			var d := Val.as_dict(s)
			var cell := _bar(Val.text(d, "code"), d, "set", 1.3 + k * 0.06)
			cell.tooltip_text = "%s: %s of %s cards fully automated" % [Val.text(d, "name"), Hud.thousands(int(Val.num(d, "full"))),
				Hud.thousands(int(Val.num(d, "cards")))]
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			grid.add_child(cell)
			k += 1
		box.add_child(grid)
	box.add_child(Hud.text("Fully automated: the engine plays every ability. Measured %s%s." % [Val.text(stats, "measured"),
		" (%s)" % Val.text(stats, "revision") if Val.text(stats, "revision") != "" else ""], 11))
	return panel


## One bar (HomeProgress.tsx Bar): the name and the percentage counting up on a line, the bar filling from empty after `delay`
## seconds, then the count ("25,148 of 34,635 cards · 9,487 to go") or `note`. Sizes: hero, big, mid, set.
func _bar(label: String, counts: Dictionary, kind: String, delay: float, note: String = "") -> Control:
	var cards := int(Val.num(counts, "cards"))
	var full := int(Val.num(counts, "full"))
	var pct := 100.0 * full / cards if cards > 0 else 0.0
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	var line := HBoxContainer.new()
	var title_size: int = {"hero": 22, "big": 17, "mid": 12, "set": 11}[kind]
	var pct_size: int = {"hero": 30, "big": 22, "mid": 13, "set": 12}[kind]
	var caption := Hud.title(label, title_size) if kind == "hero" or kind == "big" else Hud.kicker(label, Hud.TEXT)
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	caption.size_flags_vertical = Control.SIZE_SHRINK_END
	line.add_child(caption)
	var value := Hud.title("0.0%", pct_size)
	value.size_flags_vertical = Control.SIZE_SHRINK_END
	line.add_child(value)
	col.add_child(line)
	var bar := FillBar.new()
	bar.target = pct
	bar.delay = delay
	bar.duration = 1.1 if kind == "set" else 1.7
	bar.value_label = value
	bar.custom_minimum_size = Vector2(0, {"hero": 14, "big": 12, "mid": 8, "set": 6}[kind])
	col.add_child(bar)
	if kind != "set":
		var togo := cards - full
		var count := note if note != "" else "%s of %s cards · %s" % [Hud.thousands(full), Hud.thousands(cards),
			"%s to go" % Hud.thousands(togo) if togo > 0 else "complete"]
		col.add_child(Hud.text(count, 11))
	return col


static func _date_words(iso: String) -> String:
	var parts := iso.split("-")
	if parts.size() != 3:
		return iso
	return "%s %d, %s" % [MONTHS[clampi(int(parts[1]) - 1, 0, 11)], int(parts[2]), parts[0]]


# ---- the roadmap (right) ----------------------------------------------------------------------------------------------------

func _roadmap_panel(roadmap: Dictionary, stats: Dictionary) -> Control:
	var panel := Hud.panel(16)
	panel.name = "Roadmap"
	panel.custom_minimum_size = Vector2(SIDE_WIDTH, 0)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 12)
	scroll.add_child(box)
	box.add_child(Hud.kicker("Roadmap"))
	box.add_child(Hud.title("What's coming", 21))
	var standard_pct := ""
	for f: Variant in Val.list(stats, "formats"):
		var d := Val.as_dict(f)
		if Val.text(d, "key") == "standard" and Val.num(d, "cards") > 0:
			standard_pct = "%.1f" % (100.0 * Val.num(d, "full") / Val.num(d, "cards"))
	var labels := Val.dict(roadmap, "labels")
	var list := Timeline.new()
	list.add_theme_constant_override("separation", 12)
	box.add_child(list)
	var neon := NeonTheme.colors()[0]
	var neon2 := NeonTheme.colors()[1]
	var i := 0
	for it: Variant in Val.list(roadmap, "items"):
		var item := Val.as_dict(it)
		var status := Val.text(item, "status")
		var row := MarginContainer.new()
		row.add_theme_constant_override("margin_left", 22)
		var node := RoadNode.new()
		node.status = status
		row.add_child(node)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", 2)
		var status_color := neon2 if status == "done" or status == "now" else (Hud.MUTED if status == "planned" or status == "later" else neon)
		words.add_child(Hud.kicker(Val.text(labels, status, status), status_color))
		var heading := Hud.text(Val.text(item, "title"), 15, Hud.MUTED if status == "later" else Hud.TEXT)
		heading.add_theme_font_override("font", Hud.bold_font())
		words.add_child(heading)
		var body := Val.text(item, "text")
		if Val.flag(item, "standardProgress") and standard_pct != "":
			body += " %s%% there." % standard_pct
		words.add_child(Hud.text(body, 12))
		row.add_child(words)
		list.add_child(row)
		# rm-in: each item slides in from the right and fades in, 300 + 110 ms apart.
		row.modulate.a = 0.0
		var t := row.create_tween()
		t.tween_interval(0.3 + i * 0.11)
		t.tween_property(row, "modulate:a", 1.0, 0.6).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		t.parallel().tween_method(func(x: float) -> void: row.position.x = x, 14.0, 0.0, 0.6) \
			.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		i += 1
	box.add_child(Hud.text("Plans can change.", 11))
	return panel


static func _read_json(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	return Val.as_dict(JSON.parse_string(f.get_as_text()))


## The roadmap's line down the left (rm-list::before): the second neon at the top fading into the first.
class Timeline:
	extends VBoxContainer

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var pts := PackedVector2Array([Vector2(6, 6), Vector2(6, size.y * 0.35), Vector2(6, size.y - 6)])
		var cols := PackedColorArray([neon2, neon, Color(neon, 0.15)])
		draw_polyline_colors(pts, PackedColorArray([Color(neon2, 0.25), Color(neon, 0.25), Color(neon, 0.04)]), 8.0, true)
		draw_polyline_colors(pts, cols, 2.0, true)

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			queue_redraw()


## A roadmap node (rm-node): a ring on the line, filled and coloured by its status; "now" pulses.
class RoadNode:
	extends Control

	var status: String = "planned"
	var _t: float = 0.0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(0, 0)
		size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		size_flags_vertical = Control.SIZE_SHRINK_BEGIN

	func _process(delta: float) -> void:
		if status == "now":
			_t += delta
			queue_redraw()

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var c := Vector2(-15, 10)
		var border := neon
		var fill := Color(0.016, 0.039, 0.094)
		var glow := Color(neon, 0.35)
		match status:
			"now":
				border = Color.WHITE
				fill = neon2
				glow = Color(neon2, 0.6 * (0.55 + 0.45 * (0.5 - 0.5 * cos(_t * TAU / 1.6))))
			"next":
				fill = neon
			"done":
				border = neon2
				fill = neon2
				glow = Color(neon2, 0.35)
			"later":
				border = Color(neon, 0.45)
				glow = Color(0, 0, 0, 0)
		draw_circle(c, 10.0, Color(glow, glow.a * 0.4))
		draw_circle(c, 7.0, glow)
		draw_circle(c, 5.0, fill)
		draw_arc(c, 5.0, 0.0, TAU, 24, border, 2.0, true)


## A bar of the automation panel (hp-track, hp-fill): a dark pill, filling from empty to its value over `duration` after
## `delay` (cubic-bezier(0.2, 0.8, 0.2, 1)), the fill a gradient from deep neon to the second neon with stripes running along it
## and a white leading edge that pulses until it is full. The value's label counts up with it.
class FillBar:
	extends Control

	var target: float = 0.0
	var delay: float = 0.0
	var duration: float = 1.7
	var value_label: Label = null
	var _t: float = 0.0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS

	func _process(delta: float) -> void:
		_t += delta
		if value_label != null:
			value_label.text = "%.1f%%" % (target * _progress())
		queue_redraw()

	func _progress() -> float:
		if Settings.reduced_motion:
			return 1.0
		var x := clampf((_t - delay) / duration, 0.0, 1.0)
		return 1.0 - pow(1.0 - x, 3.0)

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var h := size.y
		var r := h / 2.0
		var track := StyleBoxFlat.new()
		track.bg_color = Color(neon, 0.07)
		track.set_border_width_all(1)
		track.border_color = Color(neon, 0.45)
		track.set_corner_radius_all(int(r))
		track.shadow_color = Color(neon, 0.12)
		track.shadow_size = 6
		draw_style_box(track, Rect2(Vector2.ZERO, size))
		var w := size.x * clampf(target / 100.0, 0.0, 1.0) * _progress()
		if w <= 1.0:
			return
		var fill := Rect2(Vector2.ZERO, Vector2(w, h))
		# The glow under the fill.
		var glow := StyleBoxFlat.new()
		glow.bg_color = Color(0, 0, 0, 0)
		glow.draw_center = false
		glow.set_corner_radius_all(int(r))
		glow.shadow_color = Color(neon, 0.45)
		glow.shadow_size = 10
		draw_style_box(glow, fill)
		# The gradient (neon-deep, neon at 60 %, the second neon), drawn as two quads with the colours at the corners.
		var deep := neon.darkened(0.45)
		var mid_x := w * 0.6
		draw_polygon(PackedVector2Array([Vector2(r * 0.4, 0), Vector2(mid_x, 0), Vector2(mid_x, h), Vector2(r * 0.4, h)]),
			PackedColorArray([deep, neon, neon, deep]))
		draw_polygon(PackedVector2Array([Vector2(mid_x, 0), Vector2(w - r * 0.4, 0), Vector2(w - r * 0.4, h), Vector2(mid_x, h)]),
			PackedColorArray([neon, neon2, neon2, neon]))
		draw_circle(Vector2(r, r), r * 0.98, deep)
		draw_circle(Vector2(w - r, r), r * 0.98, neon2)
		# The stripes running along it (-55 degrees, 22 px apart, one tile every 0.67 s).
		var shift := fmod(_t / 0.67, 1.0) * 22.0
		var x := -h + shift - 22.0
		while x < w:
			var a := Vector2(maxf(x, 0.0), h)
			var b := Vector2(x + h * 0.7, 0.0)
			if b.x > 0.0 and a.x < w:
				draw_line(Vector2(clampf(x, 0.0, w), h), Vector2(clampf(x + h * 0.7, 0.0, w), 0.0), Color(1, 1, 1, 0.26), 8.0 * 0.55)
			x += 22.0
		# The bright leading edge, pulsing, until the bar is full.
		if target < 99.95:
			var pulse := 0.55 + 0.45 * (0.5 - 0.5 * cos(_t * TAU / 1.6))
			var edge := Rect2(Vector2(w - 5.0, -3.0), Vector2(6.0, h + 6.0))
			draw_circle(edge.get_center(), h * 1.4, Color(neon, 0.18 * pulse))
			draw_circle(edge.get_center(), h * 0.9, Color(neon2, 0.3 * pulse))
			var head := StyleBoxFlat.new()
			head.bg_color = Color(1, 1, 1, pulse)
			head.set_corner_radius_all(3)
			draw_style_box(head, edge)


## The accent rule under the title (.home-title::after): a short line from the second neon through the first and back, glowing.
class TitleRule:
	extends Control

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var y := size.y / 2.0
		var pts := PackedVector2Array([Vector2(0, y), Vector2(size.x * 0.25, y), Vector2(size.x * 0.5, y), Vector2(size.x * 0.75, y),
			Vector2(size.x, y)])
		draw_polyline_colors(pts, PackedColorArray([Color(neon2, 0), Color(neon2, 0.25), Color(neon, 0.3), Color(neon2, 0.25),
			Color(neon2, 0)]), 14.0, true)
		draw_polyline_colors(pts, PackedColorArray([Color(neon2, 0), neon2, neon, neon2, Color(neon2, 0)]), 3.0, true)


## The DigiDice mark in 3D (branding/Logo3D.tsx, home.css): the transparent logo stacked in 14 layers along its depth, the back
## ones darker and purple so the sides read as metal, swaying (rotateY -17..17 degrees, rotateX 4..-3 over 9 s) and tilting
## toward the mouse anywhere in the window (up to 20 degrees); a neon halo behind it and a pool of light under it, both
## breathing (5.5 s); behind it a dashed ring turning once a minute and a broken ring turning the other way (38 s); round it a
## cyan spark with a tail of light orbiting one ring clockwise (7 s) and a magenta one the other way round the other (11 s).
class Emblem:
	extends Control

	const LOGO: String = "res://assets/brand/digidice-mark-transparent.png"
	const SIZE: float = 232.0
	const LAYERS: int = 14
	const MAX_TILT_DEG: float = 20.0

	var _logo: Texture2D = null
	var _t: float = 0.0
	var _tilt: Vector2 = Vector2.ZERO
	var _halo: Texture2D = null
	var _pool: Texture2D = null

	func _ready() -> void:
		_logo = load(LOGO)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		_halo = _radial([0.0, 0.38, 0.58, 0.72, 1.0], [Color(neon, 0.36), Color(0.0, 0.6, 0.94, 0.16), Color(neon2, 0.1), Color(neon2, 0.0),
			Color(neon2, 0.0)])
		_pool = _radial([0.0, 0.55, 0.75, 1.0], [Color(neon, 0.55), Color(neon2, 0.2), Color(neon2, 0.0), Color(neon2, 0.0)])

	static func _radial(offsets: Array, colors: Array) -> GradientTexture2D:
		var g := Gradient.new()
		g.offsets = PackedFloat32Array(offsets)
		g.colors = PackedColorArray(colors)
		var tex := GradientTexture2D.new()
		tex.gradient = g
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = 256
		tex.height = 256
		return tex

	func _process(delta: float) -> void:
		if Settings.reduced_motion:
			return
		_t += delta
		# The tilt follows the mouse anywhere in the window, eased a little.
		var vp := get_viewport_rect().size
		var m := get_viewport().get_mouse_position()
		var want := Vector2(clampf(m.x / maxf(vp.x, 1.0) * 2.0 - 1.0, -1.0, 1.0), clampf(m.y / maxf(vp.y, 1.0) * 2.0 - 1.0, -1.0, 1.0))
		_tilt = _tilt.lerp(want, minf(1.0, delta * 8.0))
		queue_redraw()

	func _draw() -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var c := size / 2.0
		var breathe := 0.8 + 0.2 * (0.5 - 0.5 * cos(_t * TAU / 5.5))
		# The halo and the pool of light under the logo.
		var halo_r := SIZE * 0.78
		draw_texture_rect(_halo, Rect2(c - Vector2(halo_r, halo_r), Vector2(halo_r, halo_r) * 2.0), false, Color(1, 1, 1, breathe))
		draw_texture_rect(_pool, Rect2(c + Vector2(-SIZE * 0.42, SIZE * 0.52), Vector2(SIZE * 0.84, SIZE * 0.12)), false, Color(1, 1, 1, breathe))
		# The rings behind it: dashed, turning once a minute; broken (the second neon on top, the first underneath), the other way.
		var r_in := SIZE * 0.72
		var r_out := SIZE * 0.84
		var rings_t := _t if Settings.backgrounds_move() else 0.0
		var a_in := rings_t * TAU / 60.0
		draw_arc(c, r_in, 0.0, TAU, 96, Color(neon, 0.08), 10.0, true)
		for k: int in 60:
			var a0 := a_in + k * TAU / 60.0
			draw_arc(c, r_in, a0, a0 + TAU / 120.0, 3, Color(neon, 0.45), 1.0, true)
		var a_out := -rings_t * TAU / 38.0
		draw_arc(c, r_out, a_out - PI * 0.75, a_out - PI * 0.25, 32, Color(neon2, 0.55), 2.0, true)
		draw_arc(c, r_out, a_out + PI * 0.25, a_out + PI * 0.75, 32, Color(neon, 0.4), 2.0, true)
		# The logo: layers along its depth, rotated and seen in perspective (Logo3D).
		var ry := deg_to_rad(-17.0 * cos(_t * TAU / 9.0) + _tilt.x * MAX_TILT_DEG)
		var rx := deg_to_rad(0.5 + 3.5 * cos(_t * TAU / 9.0) - _tilt.y * MAX_TILT_DEG * 0.8)
		Logo3D.draw_logo(self, c, SIZE, rx, ry, LAYERS)
		# The sparks: cyan clockwise round the inner ring (7 s), magenta the other way round the outer one (11 s), each with a
		# tail of light behind it.
		_spark(c, r_in, _t * TAU / 7.0 - PI / 2.0, 1.0, deg_to_rad(70.0), neon, Color("#e6faff"), 3.0)
		_spark(c, r_out, -_t * TAU / 11.0 - PI / 2.0, -1.0, deg_to_rad(80.0), neon2, Color("#ffe6ff"), 3.5)

	func _spark(c: Vector2, r: float, angle: float, dir: float, tail: float, glow: Color, core: Color, size_px: float) -> void:
		var steps := 24
		var pts := PackedVector2Array()
		var cols := PackedColorArray()
		for i: int in range(steps + 1):
			var a := angle - dir * tail * (1.0 - float(i) / steps)
			pts.append(c + Vector2(cos(a), sin(a)) * r)
			cols.append(Color(glow, 0.75 * float(i) / steps))
		draw_polyline_colors(pts, cols, 2.5, true)
		var p := c + Vector2(cos(angle), sin(angle)) * r
		draw_circle(p, size_px * 6.0, Color(glow, 0.12))
		draw_circle(p, size_px * 2.6, Color(glow, 0.45))
		draw_circle(p, size_px, core)
