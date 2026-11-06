class_name ArenaFx
extends Node2D
## The arena's decal on the table's middle line (packages/client/src/board/ArenaBackdrop.tsx, arena.css), drawn behind the
## cards: the DigiDice emblem lying flat on the table (a glowing core, a lit ring, a ring of dots, the mark's chamfered chip with
## its magenta leads), a dashed magenta ring turning once every 63 s while squashed flat onto the table (ring-turn), and the
## beam between the two sides, breathing (arena-midline, 4.5 s). Purely decorative: no input.

## The emblem's size on the table, as a share of the browser's 800 x 260 drawing.
const SCALE: float = 0.8

var center: Vector2 = Vector2(660, 466)
var width: float = 1320.0
var _t: float = 0.0


func _process(delta: float) -> void:
	if not Settings.reduced_motion:
		_t += delta
	queue_redraw()


func _draw() -> void:
	var neon := NeonTheme.colors()[0]
	var neon2 := NeonTheme.colors()[1]
	# The core: a pool of the first neon fading out (radialGradient arena-core).
	for i: int in 6:
		var k := 1.0 - i / 6.0
		_ellipse_fill(Vector2(300, 120) * SCALE * k, Color(neon, 0.035))
	# The lit ring and the ring of dots round it.
	_ellipse_line(Vector2(250, 100) * SCALE, Color(neon, 0.18), 8.0)
	_ellipse_line(Vector2(250, 100) * SCALE, Color(neon, 0.55), 2.5)
	_ellipse_dots(Vector2(286, 114) * SCALE, 0.0, 72, Color(neon, 0.2), 2.5)
	# The chip: the mark's chamfered square, flat on the table, with its magenta leads.
	var chip := PackedVector2Array()
	for p: Vector2 in [Vector2(330, 104), Vector2(470, 104), Vector2(494, 116), Vector2(494, 144), Vector2(470, 156), Vector2(330, 156),
			Vector2(306, 144), Vector2(306, 116), Vector2(330, 104)]:
		chip.append(center + (p - Vector2(400, 130)) * SCALE)
	draw_polyline(chip, Color(neon, 0.18), 7.0, true)
	draw_polyline(chip, Color(neon, 0.55), 2.5, true)
	for lead: Array in [[Vector2(306, 124), Vector2(276, 124), Vector2(262, 116)], [Vector2(306, 136), Vector2(276, 136), Vector2(262, 144)],
			[Vector2(494, 124), Vector2(524, 124), Vector2(538, 116)], [Vector2(494, 136), Vector2(524, 136), Vector2(538, 144)]]:
		var pts := PackedVector2Array()
		for p: Vector2 in lead:
			pts.append(center + (p - Vector2(400, 130)) * SCALE)
		draw_polyline(pts, Color(neon2, 0.5), 2.0, true)
	# The dashed ring, turning flat on the table (a circle squashed to 214 x 86).
	var turn := _t * TAU / 63.3
	_ellipse_dashes(Vector2(214, 86) * SCALE, turn, 79, Color(neon2, 0.18), 7.0)
	_ellipse_dashes(Vector2(214, 86) * SCALE, turn, 79, Color(neon2, 0.42), 2.0)
	# The beam between the two sides, breathing.
	var breathe := 0.45 + 0.3 * (0.5 - 0.5 * cos(_t * TAU / 4.5))
	var y := center.y
	var xs := PackedVector2Array([Vector2(center.x - width / 2.0, y), Vector2(center.x - width * 0.38, y), Vector2(center.x, y),
		Vector2(center.x + width * 0.38, y), Vector2(center.x + width / 2.0, y)])
	var mid := Color(0.63, 0.92, 1.0)
	draw_polyline_colors(xs, PackedColorArray([Color(neon2, 0.0), Color(neon2, 0.12 * breathe), Color(neon, 0.25 * breathe),
		Color(neon2, 0.12 * breathe), Color(neon2, 0.0)]), 26.0, true)
	draw_polyline_colors(xs, PackedColorArray([Color(neon2, 0.0), Color(neon2, 0.55 * breathe), Color(mid, 0.95 * breathe),
		Color(neon2, 0.55 * breathe), Color(neon2, 0.0)]), 3.0, true)


func _ellipse_points(radii: Vector2, n: int, turn: float = 0.0) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i: int in n + 1:
		var a := TAU * i / n + turn
		# A circle turned, then squashed flat: the dashes run round the ellipse as the browser's turning ring does.
		pts.append(center + Vector2(cos(a) * radii.x, sin(a) * radii.y))
	return pts


func _ellipse_fill(radii: Vector2, color: Color) -> void:
	var pts := _ellipse_points(radii, 48)
	pts.remove_at(pts.size() - 1)
	draw_colored_polygon(pts, color)


func _ellipse_line(radii: Vector2, color: Color, w: float) -> void:
	draw_polyline(_ellipse_points(radii, 96), color, w, true)


func _ellipse_dots(radii: Vector2, turn: float, n: int, color: Color, w: float) -> void:
	for i: int in n:
		var a := TAU * i / n + turn
		var p := center + Vector2(cos(a) * radii.x, sin(a) * radii.y)
		draw_circle(p, w * 0.5, color)


func _ellipse_dashes(radii: Vector2, turn: float, n: int, color: Color, w: float) -> void:
	# Each dash is 5 of every 17 units round the circle (stroke-dasharray 5 12).
	for i: int in n:
		var a0 := TAU * i / n + turn
		var a1 := a0 + TAU / n * (5.0 / 17.0)
		var pts := PackedVector2Array()
		for k: int in 4:
			var a := lerpf(a0, a1, k / 3.0)
			pts.append(center + Vector2(cos(a) * radii.x, sin(a) * radii.y))
		draw_polyline(pts, color, w, true)


## Light running along the floor's grid lines toward the horizon, Tron style (arena.css .arena-streaks): six streaks on lines
## either side of the middle, each a short bright dash with a glow, fading in as it starts and out as it reaches the haze, every
## 5.5 to 7.2 s. Drawn on the floor (under the table), projected with the grid shader's own mapping (HomeFx).
class FloorStreaks:
	extends Control

	## [grid line, period s, phase s, magenta]
	const STREAKS: Array = [[-3, 5.5, 0.4, false], [2, 6.5, 2.1, false], [-1, 7.2, 3.6, false], [5, 5.5, 1.2, true],
		[-5, 6.1, 4.4, true], [3, 6.8, 2.8, false]]

	var _t: float = 0.0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		var add := CanvasItemMaterial.new()
		add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		material = add

	func _process(delta: float) -> void:
		if not Settings.backgrounds_move():
			return
		_t += delta
		queue_redraw()

	func _draw() -> void:
		if not Settings.backgrounds_move() or not Settings.look_scene:
			return
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var aspect := size.x / maxf(size.y, 1.0)
		for s: Array in STREAKS:
			var period := float(s[1])
			var u := fposmod(_t + float(s[2]), period) / period
			# Opacity: in over the first 10 %, then out to the end (the keyframes' from 0, 10% 1, to 0).
			var alpha := u / 0.1 if u < 0.1 else 1.0 - (u - 0.1) / 0.9
			# The head runs from the bottom of the screen toward the horizon; the floor is shorter far away.
			var head_near := lerpf(1.0, 0.12, pow(u, 0.7))
			var tail_near := minf(1.0, head_near + 0.22 * head_near)
			var head := _on_line(int(s[0]), head_near, aspect)
			var tail := _on_line(int(s[0]), tail_near, aspect)
			var core := Color(1.0, 0.55, 1.0) if bool(s[3]) else Color(0.63, 0.92, 1.0)
			var glow := neon2 if bool(s[3]) else neon
			var pts := PackedVector2Array([tail, tail.lerp(head, 0.6), head])
			draw_polyline_colors(pts, PackedColorArray([Color(glow, 0.0), Color(glow, 0.35 * alpha), Color(glow, 0.0)]), 10.0, true)
			draw_polyline_colors(pts, PackedColorArray([Color(core, 0.0), Color(core, 0.9 * alpha), Color(core, 0.0)]), 2.0, true)

	## The screen point on grid line `k` at `near` (1 at the bottom of the screen, toward 0 at the horizon).
	func _on_line(k: int, near: float, aspect: float) -> Vector2:
		var depth := 1.0 / maxf(near, 0.02)
		var ux := 0.5 + k / (aspect * 0.5625 * HomeFx.CELLS * depth)
		var uy := HomeFx.HORIZON + HomeFx.FLOOR_H * near
		return Vector2(ux * size.x, uy * size.y)
