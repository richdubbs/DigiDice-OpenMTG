class_name HomeFx
extends Control
## Home's living floor (packages/client/src/screens/homeFx.ts and HomeBackdrop.tsx): light cycles riding the grid's lines,
## leaving light walls behind them and derezzing in a shower of sparks when they hit one; pulses rippling across the floor and
## lighting its lines as they pass; flares running both ways along the horizon from a pillar of light; streaks crossing the sky;
## motes of light drifting up through the room. Drawn additively over the backdrop (scenes/Backdrop.tscn) and under the screen.
##
## Everything on the floor lives in the grid's own frame, in cells, where the lines are the whole numbers and stay put: it is
## projected with shaders/neon_grid.gdshader's own mapping and the same scroll (Backdrop.scroll_now), so it sits on the lines
## the shader draws. Sizes and speeds are the browser's, with its 64 px cell as one cell.

const CELLS: float = 9.0
const HORIZON: float = 0.42
const FLOOR_H: float = 1.0 - HORIZON
## The grid's depth per unit of shader depth (neon_grid.gdshader: depth * cells * 0.35).
const DEPTH_CELLS: float = CELLS * 0.35
const TURN: float = 0.3
const DEREZ_S: float = 0.6
const FLARE_S: float = 2.4
## A light wall's height, as a share of the camera's height over the floor.
const WALL: float = 0.07
const GLOW: Array[Color] = [Color8(31, 184, 255), Color8(245, 0, 245), Color8(255, 170, 40)]
const CORE: Array[Color] = [Color8(214, 246, 255), Color8(255, 214, 255), Color8(255, 238, 196)]
const LIT: Color = Color8(150, 228, 255)
const DX: Array[int] = [0, 1, 0, -1]
## Away from the viewer is up the grid (+y), toward the viewer down.
const DY: Array[int] = [1, 0, -1, 0]

var _rng := RandomNumberGenerator.new()
var _scroll: float = 0.0
var _time: float = 0.0
var _aspect: float = 16.0 / 9.0
## {wall: PackedVector2Array (oldest first, the last is the cycle), dir, speed, to_node, length, hue, state, fade, clock}
var _cycles: Array[Dictionary] = []
var _ripples: Array[Dictionary] = []
var _sparks: Array[Dictionary] = []
var _flares: Array[Dictionary] = []
var _streaks: Array[Dictionary] = []
var _motes: Array[Dictionary] = []
var _next_ripple: float = 1.2
var _next_flare: float = 2.0
var _next_streak: float = 0.8


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var add := CanvasItemMaterial.new()
	add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = add
	_rng.randomize()
	resized.connect(_seed_motes)
	var n := clampi(roundi(get_viewport_rect().size.x / 240.0), 5, 9)
	for i: int in n:
		_cycles.append(_waiting(0.1 + i * 0.3))
	_seed_motes()


func _process(delta: float) -> void:
	if not Settings.backgrounds_move() or not Settings.look_scene:
		return
	var dt := minf(delta, 0.05)
	_time += dt
	_scroll = Backdrop.scroll_now()
	var area := size
	_aspect = area.x / maxf(area.y, 1.0)
	for c: Dictionary in _cycles:
		_ride(c, dt)
	_step_ripples(dt)
	_step_sky(dt)
	queue_redraw()


# ---- the floor --------------------------------------------------------------------------------------------------------

## How far into the floor a grid row is (1 at the bottom of the screen; the shader's `depth`).
func _depth(gy: float) -> float:
	return (gy - _scroll) / DEPTH_CELLS


## The screen point of grid (gx, gy), raised h (a share of the camera's height) off the floor.
func _project(gx: float, gy: float, h: float = 0.0) -> Vector2:
	var d := maxf(_depth(gy), 0.05)
	var ux := 0.5 + gx / (_aspect * 0.5625 * CELLS * d)
	var uy := HORIZON + FLOOR_H * (1.0 - h) / d
	return Vector2(ux * size.x, uy * size.y)


## How much the floor is magnified at a row (2.2 at the bottom of the screen), for line widths.
func _scale(gy: float) -> float:
	return clampf(2.2 / maxf(_depth(gy), 0.05), 0.25, 3.0)


## The floor's fade into the haze near the horizon (the shader's), 0..1.
func _mask(gy: float) -> float:
	var d := _depth(gy)
	if d <= 0.0:
		return 0.0
	var near := 1.0 / d
	return clampf(smoothstep(0.0, 0.35, near) * (1.0 - smoothstep(1.05, 1.25, near)), 0.0, 1.0)


## Half the floor's width at a row, in cells.
func _half_width(gy: float) -> float:
	return _aspect * 0.5625 * CELLS * maxf(_depth(gy), 0.05) * 0.5


# ---- the light cycles -------------------------------------------------------------------------------------------------

func _waiting(clock: float) -> Dictionary:
	return {"wall": PackedVector2Array(), "dir": 0, "speed": 0.0, "to_node": 1.0, "length": 0.0, "hue": 0, "state": "wait",
		"fade": 1.0, "clock": clock}


func _hue(cyan: float, magenta: float) -> int:
	var r := _rng.randf()
	return 0 if r < cyan else (1 if r < cyan + magenta else 2)


## A crossing of grid lines somewhere on the floor in view, or null.
func _crossing() -> Variant:
	var d := _rng.randf_range(1.35, 4.6)
	var gy := roundf(_scroll + d * DEPTH_CELLS)
	var half := _half_width(gy) - 1.0
	if half <= 0.0:
		return null
	return Vector2(roundf(_rng.randf_range(-half, half)), gy)


func _rez(c: Dictionary) -> void:
	var at: Variant = _crossing()
	if at == null:
		c["clock"] = 1.0
		return
	c["wall"] = PackedVector2Array([at, at])
	c["dir"] = _rng.randi() % 4
	c["speed"] = _rng.randf_range(1.9, 3.6)
	c["length"] = _rng.randf_range(3.1, 7.2)
	c["to_node"] = 1.0
	c["hue"] = _hue(0.55, 0.35)
	c["state"] = "ride"
	c["fade"] = 1.0
	c["clock"] = 0.0


func _rest(c: Dictionary) -> void:
	c["state"] = "wait"
	c["wall"] = PackedVector2Array()
	c["clock"] = _rng.randf_range(0.4, 2.2)


func _ride(c: Dictionary, dt: float) -> void:
	match String(c["state"]):
		"wait":
			c["clock"] = float(c["clock"]) - dt
			if float(c["clock"]) <= 0.0:
				_rez(c)
			return
		"derez":
			c["fade"] = float(c["fade"]) - dt / DEREZ_S
			if float(c["fade"]) <= 0.0:
				_rest(c)
			return
		"gone":
			c["length"] = float(c["length"]) - float(c["speed"]) * 1.5 * dt
			if float(c["length"]) <= 0.0:
				_rest(c)
			else:
				c["wall"] = _trim(c["wall"], float(c["length"]))
			return
	c["clock"] = float(c["clock"]) + dt
	var wall: PackedVector2Array = c["wall"]
	var left := float(c["speed"]) * dt
	while left > 0.0:
		var step := minf(left, float(c["to_node"]))
		var head := wall[wall.size() - 1]
		var from := head
		head += Vector2(DX[int(c["dir"])], DY[int(c["dir"])]) * step
		wall[wall.size() - 1] = head
		left -= step
		c["to_node"] = float(c["to_node"]) - step
		if _crashes(c, from, head):
			c["wall"] = wall
			_derez(c, head)
			return
		if float(c["to_node"]) <= 1e-6:
			wall = _cross(c, wall)
	c["wall"] = _trim(wall, float(c["length"]))
	var tip: Vector2 = (c["wall"] as PackedVector2Array)[(c["wall"] as PackedVector2Array).size() - 1]
	if not _in_view(tip):
		c["state"] = "gone"


## At a crossing: snap onto it, and maybe turn left or right, leaving a corner in the wall.
func _cross(c: Dictionary, wall: PackedVector2Array) -> PackedVector2Array:
	c["to_node"] = 1.0
	var head := wall[wall.size() - 1]
	head = Vector2(roundf(head.x), roundf(head.y))
	wall[wall.size() - 1] = head
	if _rng.randf() >= TURN:
		return wall
	c["dir"] = (int(c["dir"]) + (1 if _rng.randf() < 0.5 else 3)) % 4
	wall.insert(wall.size() - 1, head)
	return wall


## Shortens a wall from its oldest end to `length` (its segments run along grid lines, so lengths add up exactly).
static func _trim(wall: PackedVector2Array, length: float) -> PackedVector2Array:
	var total := 0.0
	for i: int in range(1, wall.size()):
		total += absf(wall[i].x - wall[i - 1].x) + absf(wall[i].y - wall[i - 1].y)
	var extra := total - maxf(0.0, length)
	while extra > 1e-9 and wall.size() > 1:
		var a := wall[0]
		var b := wall[1]
		var d := absf(b.x - a.x) + absf(b.y - a.y)
		if d <= extra:
			wall.remove_at(0)
			extra -= d
		else:
			wall[0] = a + (b - a) * (extra / d)
			extra = 0.0
	return wall


func _crashes(c: Dictionary, a: Vector2, b: Vector2) -> bool:
	for o: Dictionary in _cycles:
		if o == c or (String(o["state"]) != "ride" and String(o["state"]) != "gone"):
			continue
		var w: PackedVector2Array = o["wall"]
		for i: int in range(1, w.size()):
			if _touches(a, b, w[i - 1], w[i], 0.02):
				return true
	return false


static func _touches(a: Vector2, b: Vector2, p: Vector2, q: Vector2, tol: float) -> bool:
	return maxf(a.x, b.x) + tol >= minf(p.x, q.x) and minf(a.x, b.x) - tol <= maxf(p.x, q.x) \
		and maxf(a.y, b.y) + tol >= minf(p.y, q.y) and minf(a.y, b.y) - tol <= maxf(p.y, q.y)


func _derez(c: Dictionary, head: Vector2) -> void:
	c["state"] = "derez"
	c["fade"] = 1.0
	var at := _project(head.x, head.y, WALL * 0.3)
	var s := sqrt(_scale(head.y))
	for i: int in 26:
		var a := _rng.randf() * TAU
		var v := _rng.randf_range(60.0, 320.0) * s
		var life := _rng.randf_range(0.45, 1.1)
		_sparks.append({"p": at, "v": Vector2(cos(a) * v, sin(a) * v * 0.6 - 40.0 * s), "life": life, "max": life,
			"size": _rng.randf_range(0.8, 2.2) * s, "hue": int(c["hue"])})
	_ripples.append({"c": head, "r": 0.0, "max": 2.3, "speed": 4.0, "hue": int(c["hue"])})


func _in_view(p: Vector2) -> bool:
	var d := _depth(p.y)
	if d < 0.85 or d > 7.5:
		return false
	return absf(p.x) <= _half_width(p.y) + 0.5


# ---- ripples and the sky ----------------------------------------------------------------------------------------------

func _step_ripples(dt: float) -> void:
	for r: Dictionary in _ripples:
		r["r"] = float(r["r"]) + float(r["speed"]) * dt
	_ripples = _ripples.filter(func(r: Dictionary) -> bool: return float(r["r"]) < float(r["max"]))
	_next_ripple -= dt
	if _next_ripple > 0.0:
		return
	_next_ripple = _rng.randf_range(4.0, 9.0)
	var at: Variant = _crossing()
	if at != null:
		_ripples.append({"c": at, "r": 0.0, "max": _rng.randf_range(4.7, 9.0), "speed": _rng.randf_range(3.1, 4.4), "hue": _hue(0.7, 0.3)})


func _step_sky(dt: float) -> void:
	var w := size.x
	var h := size.y
	for s: Dictionary in _sparks:
		var drag := exp(-2.6 * dt)
		var v: Vector2 = s["v"]
		v = Vector2(v.x * drag, v.y * drag + 90.0 * dt)
		s["v"] = v
		s["p"] = (s["p"] as Vector2) + v * dt
		s["life"] = float(s["life"]) - dt
	_sparks = _sparks.filter(func(s: Dictionary) -> bool: return float(s["life"]) > 0.0)
	for f: Dictionary in _flares:
		f["t"] = float(f["t"]) + dt
	_flares = _flares.filter(func(f: Dictionary) -> bool: return float(f["t"]) < FLARE_S)
	_next_flare -= dt
	if _next_flare <= 0.0:
		_next_flare = _rng.randf_range(5.0, 11.0)
		_flares.append({"x": w / 2.0 + (_rng.randf() - 0.5) * w * 0.5, "t": 0.0, "hue": _hue(0.5, 0.5)})
	for s: Dictionary in _streaks:
		s["p"] = (s["p"] as Vector2) + (s["v"] as Vector2) * dt
		s["t"] = float(s["t"]) + dt
	_streaks = _streaks.filter(func(s: Dictionary) -> bool: return float(s["t"]) < float(s["life"]))
	_next_streak -= dt
	if _next_streak <= 0.0:
		_next_streak = _rng.randf_range(2.2, 6.2)
		var dir := 1.0 if _rng.randf() < 0.5 else -1.0
		var speed := _rng.randf_range(650.0, 1150.0)
		_streaks.append({"p": Vector2(_rng.randf() * w, h * _rng.randf_range(0.04, 0.3)),
			"v": Vector2(dir * speed, speed * _rng.randf_range(0.03, 0.12)), "len": _rng.randf_range(80.0, 220.0), "t": 0.0,
			"life": _rng.randf_range(0.9, 1.7), "hue": _hue(0.6, 0.3)})
	for m: Dictionary in _motes:
		m["y"] = float(m["y"]) + float(m["vy"]) * dt
		if float(m["y"]) < -10.0:
			m["y"] = h + 10.0
			m["x"] = _rng.randf() * w


func _seed_motes() -> void:
	var w := maxf(size.x, 1.0)
	var h := maxf(size.y, 1.0)
	var n := clampi(roundi(w * h / 24000.0), 24, 90)
	_motes.clear()
	for i: int in n:
		_motes.append({"x": _rng.randf() * w, "y": _rng.randf() * h, "vy": -_rng.randf_range(6.0, 22.0),
			"sway": _rng.randf_range(4.0, 14.0), "ph": _rng.randf() * TAU, "size": _rng.randf_range(0.6, 2.2),
			"alpha": _rng.randf_range(0.12, 0.57), "tw": _rng.randf_range(0.6, 2.8), "hue": _hue(0.6, 0.32)})


# ---- drawing ----------------------------------------------------------------------------------------------------------

func _draw() -> void:
	if not Settings.backgrounds_move() or not Settings.look_scene:
		return
	for r: Dictionary in _ripples:
		_draw_ripple(r)
	for c: Dictionary in _cycles:
		_draw_cycle(c)
	_draw_sky()


## A ripple lights the grid lines it passes over, and its front shows as a ring.
func _draw_ripple(r: Dictionary) -> void:
	var c: Vector2 = r["c"]
	var radius := float(r["r"])
	var a := pow(1.0 - radius / float(r["max"]), 1.4)
	var band := 0.34
	var reach := radius + band
	for k: int in range(floori(c.x - reach), ceili(c.x + reach) + 1):
		_lit_line(c, radius, band, a, Vector2(k, c.y - reach), Vector2(k, c.y + reach))
	for j: int in range(floori(c.y - reach), ceili(c.y + reach) + 1):
		_lit_line(c, radius, band, a, Vector2(c.x - reach, j), Vector2(c.x + reach, j))
	var front := PackedVector2Array()
	for i: int in 65:
		var t := TAU * i / 64.0
		front.append(_project(c.x + cos(t) * radius, c.y + sin(t) * radius))
	var tint: Color = GLOW[int(r["hue"])]
	var m := _mask(c.y)
	draw_polyline(front, Color(tint, a * 0.14 * m), 8.0, true)
	draw_polyline(front, Color(tint, a * 0.5 * m), 1.6, true)


## The part of one grid line inside the ripple's band, lit.
func _lit_line(c: Vector2, radius: float, band: float, a: float, from: Vector2, to: Vector2) -> void:
	var steps := 14
	var prev := from
	var prev_in := false
	for i: int in range(steps + 1):
		var p := from.lerp(to, float(i) / steps)
		var off := absf(p.distance_to(c) - radius)
		var inside := off < band
		if inside and prev_in:
			var mid := (p + prev) * 0.5
			var k := (1.0 - absf(mid.distance_to(c) - radius) / band) * a * _mask(mid.y)
			if k > 0.01:
				draw_line(_project(prev.x, prev.y), _project(p.x, p.y), Color(LIT, 0.85 * k), maxf(1.0, _scale(mid.y) * 0.8), true)
		prev = p
		prev_in = inside


func _draw_cycle(c: Dictionary) -> void:
	var wall: PackedVector2Array = c["wall"]
	if String(c["state"]) == "wait" or wall.size() < 2:
		return
	var fade := float(c["fade"]) * (1.0 if sin(_time * 70.0) > 0.0 else 0.45) if String(c["state"]) == "derez" else 1.0
	var glow: Color = GLOW[int(c["hue"])]
	var core: Color = CORE[int(c["hue"])]
	var length := maxf(float(c["length"]), 0.001)
	var behind := 0.0
	for i: int in range(wall.size() - 1, 0, -1):
		var b := wall[i]
		var a := wall[i - 1]
		var seg := absf(b.x - a.x) + absf(b.y - a.y)
		var pieces := maxi(1, ceili(seg / 0.19))
		for n: int in pieces:
			var t0 := float(n) / pieces
			var t1 := float(n + 1) / pieces
			var g0 := b.lerp(a, t0)
			var g1 := b.lerp(a, t1)
			var mid := (g0.y + g1.y) * 0.5
			var alpha := fade * pow(maxf(0.0, 1.0 - (behind + seg * (t0 + t1) * 0.5) / length), 1.3) * _mask(mid)
			if alpha < 0.01:
				continue
			var s := _scale(mid)
			var p0 := _project(g0.x, g0.y)
			var p1 := _project(g1.x, g1.y)
			var q0 := _project(g0.x, g0.y, WALL)
			var q1 := _project(g1.x, g1.y, WALL)
			# The wall standing on the line, its glow on the floor, and its bright foot and top edge.
			draw_colored_polygon(PackedVector2Array([p0, p1, q1, q0]), Color(glow, alpha * 0.2))
			draw_line(p0, p1, Color(glow, alpha * 0.28), 6.0 * s, true)
			draw_line(p0, p1, Color(core, alpha), 1.3 * s, true)
			draw_line(q0, q1, Color(core, alpha), 1.3 * s, true)
		behind += seg
	if String(c["state"]) != "ride":
		return
	var head := wall[wall.size() - 1]
	var m := _mask(head.y)
	if m <= 0.0:
		return
	var s := _scale(head.y)
	var p := _project(head.x, head.y, WALL * 0.5)
	var r := 16.0 * s
	draw_circle(p, r, Color(glow, 0.1 * m))
	draw_circle(p, r * 0.5, Color(glow, 0.22 * m))
	draw_circle(p, r * 0.2, Color(core, 0.75 * m))
	draw_circle(p, r * 0.1, Color(1, 1, 1, 0.95 * m))
	# Rezzing in: a beam of light from the floor and a ring spreading from its foot.
	var clock := float(c["clock"])
	if clock < 0.5:
		var k := clock / 0.5
		var foot := _project(head.x, head.y)
		var tip := _project(head.x, head.y, 0.9 * (1.0 - k * 0.5))
		draw_line(foot, tip, Color(core, (1.0 - k) * 0.8 * m), 2.0 * s, true)
		var ring := PackedVector2Array()
		var rr := 0.09 + 0.84 * k
		for i: int in 33:
			var t := TAU * i / 32.0
			ring.append(_project(head.x + cos(t) * rr, head.y + sin(t) * rr))
		draw_polyline(ring, Color(glow, (1.0 - k) * 0.7 * m), 1.5 * s, true)


func _draw_sky() -> void:
	for s: Dictionary in _sparks:
		var a := float(s["life"]) / float(s["max"])
		var p: Vector2 = s["p"]
		var v: Vector2 = s["v"]
		draw_line(p, p - v * 0.035, Color(CORE[int(s["hue"])], a), float(s["size"]), true)
	var y := HORIZON * size.y
	for f: Dictionary in _flares:
		var t := float(f["t"])
		var env := sin(PI * minf(1.0, t / FLARE_S))
		var run := t * 560.0
		var hue := int(f["hue"])
		for dir: float in [-1.0, 1.0]:
			var hx := float(f["x"]) + dir * run
			var tail := hx - dir * 220.0
			var pts := PackedVector2Array([Vector2(tail, y), Vector2(hx, y)])
			var cols := PackedColorArray([Color(GLOW[hue], 0.0), Color(CORE[hue], env)])
			draw_polyline_colors(pts, cols, 2.0, true)
			var wide := PackedColorArray([Color(GLOW[hue], 0.0), Color(CORE[hue], env * 0.3)])
			draw_polyline_colors(pts, wide, 8.0, true)
			draw_circle(Vector2(hx, y), 28.0, Color(GLOW[hue], 0.12 * env))
			draw_circle(Vector2(hx, y), 9.0, Color(GLOW[hue], 0.35 * env))
			draw_circle(Vector2(hx, y), 3.0, Color(1, 1, 1, 0.8 * env))
		# A pillar of light where it starts.
		var k := maxf(0.0, 1.0 - t / 0.9)
		if k > 0.0:
			var top := y - size.y * 0.22 * (1.0 - k * 0.4)
			var x := float(f["x"])
			var pts := PackedVector2Array([Vector2(x, y), Vector2(x, top)])
			draw_polyline_colors(pts, PackedColorArray([Color(CORE[hue], 0.7 * k), Color(GLOW[hue], 0.0)]), 3.0, true)
			draw_polyline_colors(pts, PackedColorArray([Color(CORE[hue], 0.7 * k * 0.25), Color(GLOW[hue], 0.0)]), 14.0, true)
	for s: Dictionary in _streaks:
		var env := sin(PI * float(s["t"]) / float(s["life"]))
		var p: Vector2 = s["p"]
		var dir := (s["v"] as Vector2).normalized()
		var hue := int(s["hue"])
		draw_polyline_colors(PackedVector2Array([p - dir * float(s["len"]), p]),
			PackedColorArray([Color(GLOW[hue], 0.0), Color(CORE[hue], 0.75 * env)]), 1.4, true)
	for m: Dictionary in _motes:
		var a := float(m["alpha"]) * (0.55 + 0.45 * sin(_time * float(m["tw"]) + float(m["ph"])))
		var hue := int(m["hue"])
		var x := float(m["x"]) + sin(_time * 0.5 + float(m["ph"])) * float(m["sway"])
		draw_circle(Vector2(x, float(m["y"])), float(m["size"]), Color(CORE[0] if hue == 0 else GLOW[hue], a))
