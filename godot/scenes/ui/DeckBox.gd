class_name DeckBox
extends Control
## A deck as a box (packages/client/src/decks/chrome.tsx DeckBox, decks.css): a card box in perspective, its face the deck's cover
## card or the DigiDice sleeve of the deck's colours (assets/brand/sleeves, "classic" while the colours are not known), its sides
## striped with a magenta band, a pool of light under it. At rest it is turned 30 degrees; `lifted` (the tile under the pointer)
## turns it to 10 degrees and raises it 6 px over 380 ms; `sway` turns it slowly back and forth (10 s), as the large box does.
## `empty` draws a faint outline (no deck chosen). The box is as wide as two thirds of the control.

const SLEEVES_DIR: String = "res://assets/brand/sleeves/"
const REST_YAW: float = -30.0
const REST_PITCH: float = 4.0
const LIFT_YAW: float = -10.0
const LIFT_PITCH: float = 2.0
const PERSPECTIVE: float = 800.0

var colors: String = "":
	set(v):
		if v != colors:
			colors = v
			_face = null
			queue_redraw()
var cover: Texture2D = null:
	set(v):
		cover = v
		_face = null
		queue_redraw()
var empty: bool = false:
	set(v):
		empty = v
		queue_redraw()
var lifted: bool = false
var sway: bool = false
## The large box's neon ring on the floor.
var ring: bool = false
## The room under the box for its floor (px).
var floor_room: float = 26.0

var _lift: float = 0.0
var _t: float = 0.0
var _pop: float = 1.0
var _face: Texture2D = null

static var _sleeves: Dictionary = {}
static var _sleeve_list: Array = []


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


## The sleeve of exactly these colours ("WU", any order), else the classic one.
static func sleeve_for(deck_colors: String) -> Texture2D:
	if _sleeve_list.is_empty():
		var data := Val.as_dict(JSON.parse_string(FileAccess.get_file_as_string(SLEEVES_DIR + "sleeves.json")))
		_sleeve_list = Val.list(data, "sleeves")
		_sleeves["classic"] = load(SLEEVES_DIR + Val.text(data, "classic", "sleeve-classic.png"))
	var want := {}
	for c: String in deck_colors.split(""):
		if c in DeckModel.WUBRG:
			want[c] = true
	if want.is_empty():
		return _sleeves["classic"]
	for s: Variant in _sleeve_list:
		var sd := Val.as_dict(s)
		var have: Array = Val.list(sd, "colors")
		if have.size() != want.size():
			continue
		var same := true
		for c: Variant in have:
			if not want.has(String(c)):
				same = false
		if same:
			var id := Val.text(sd, "id")
			if not _sleeves.has(id):
				_sleeves[id] = load(SLEEVES_DIR + Val.text(sd, "file"))
			return _sleeves[id]
	return _sleeves["classic"]


## new-game-pop: rise 10 px and grow from 92 % in 260 ms.
func pop() -> void:
	_pop = 0.0


func _process(delta: float) -> void:
	var moving := false
	var target := 1.0 if lifted else 0.0
	if _lift != target:
		_lift = move_toward(_lift, target, delta / 0.38)
		moving = true
	if sway and Settings.backgrounds_move():
		_t += delta
		moving = true
	if _pop < 1.0:
		_pop = minf(1.0, _pop + delta / 0.26)
		moving = true
	if moving:
		queue_redraw()


func _pose() -> Vector3:
	# x: yaw (degrees), y: pitch, z: lift (px).
	if sway and not Settings.reduced_motion:
		var k := 0.5 - 0.5 * cos(_t * TAU / 10.0)
		return Vector3(lerpf(-32.0, -8.0, k), lerpf(5.0, 3.0, k), 0.0)
	var e := _ease(_lift)
	return Vector3(lerpf(REST_YAW, LIFT_YAW, e), lerpf(REST_PITCH, LIFT_PITCH, e), -6.0 * e)


## cubic-bezier(.2,.8,.2,1), near enough.
static func _ease(x: float) -> float:
	return 1.0 - pow(1.0 - x, 3.0)


func _draw() -> void:
	var bw := minf(size.x / 1.5, (size.y - floor_room) / 1.396)
	if bw <= 4.0:
		return
	if _pop < 1.0 and not Settings.reduced_motion:
		var k := 1.0 - pow(1.0 - _pop, 3.0) + sin(_pop * PI) * 0.06
		var s := lerpf(0.92, 1.0, k)
		draw_set_transform(size / 2.0 * (1.0 - s) + Vector2(0, 10.0 * (1.0 - k)), 0.0, Vector2(s, s))
	var neon := NeonTheme.colors()[0]
	var bh := bw * 1.396
	var dp := bw * 0.2
	var pose := _pose()
	var center := Vector2(size.x / 2.0, (size.y - floor_room) / 2.0 + pose.z)
	var floor_y := center.y + bh / 2.0 + floor_room * 0.45 - pose.z
	# The pool of light on the floor, wider than the box (and the large box's ring).
	for k: int in 6:
		var f := 1.0 - k / 6.0
		_ellipse(Vector2(center.x, floor_y), Vector2(bw * 0.85 * f, bw * 0.15 * f), Color(neon, 0.05 if not empty else 0.015))
	if ring:
		_ellipse_line(Vector2(center.x, floor_y), Vector2(bw * 0.95, bw * 0.17), Color(neon, 0.5), 2.0)
	# CSS rotateY(-30deg) brings the right edge toward the viewer: here a positive yaw does.
	var yaw := deg_to_rad(-pose.x)
	var pitch := deg_to_rad(pose.y)
	var p := func(v: Vector3) -> Vector2:
		var x := v.x * cos(yaw) + v.z * sin(yaw)
		var z := -v.x * sin(yaw) + v.z * cos(yaw)
		var y := v.y * cos(pitch) - z * sin(pitch)
		z = v.y * sin(pitch) + z * cos(pitch)
		var s := PERSPECTIVE / (PERSPECTIVE + z)
		return center + Vector2(x, y) * s
	var hw := bw / 2.0
	var hh := bh / 2.0
	var hd := dp / 2.0
	# Front face (toward the viewer: z = -hd), corners from top left, clockwise.
	var front: Array[Vector2] = [p.call(Vector3(-hw, -hh, -hd)), p.call(Vector3(hw, -hh, -hd)), p.call(Vector3(hw, hh, -hd)),
		p.call(Vector3(-hw, hh, -hd))]
	# The side that shows: the right one while the right edge is turned toward the viewer.
	var side_x := hw if yaw > 0.0 else -hw
	var side: Array[Vector2] = [p.call(Vector3(side_x, -hh, -hd)), p.call(Vector3(side_x, -hh, hd)), p.call(Vector3(side_x, hh, hd)),
		p.call(Vector3(side_x, hh, -hd))]
	var top: Array[Vector2] = [p.call(Vector3(-hw, -hh, hd)), p.call(Vector3(hw, -hh, hd)), p.call(Vector3(hw, -hh, -hd)),
		p.call(Vector3(-hw, -hh, -hd))]
	var alpha := 0.35 if empty else 1.0
	if empty:
		draw_polyline(PackedVector2Array(front + [front[0]]), Color(neon, 0.35), 2.0, true)
		return
	# The glow round the face.
	for k: int in 4:
		var grow := 3.0 + k * 4.0
		_quad(_grown(front, grow), Color(neon, 0.08 - k * 0.015))
	# The side: a striped edge with a magenta band across its middle.
	_quad(side, Color("#0c1d3d"))
	var stripes := 9
	for i: int in stripes:
		var a := float(i) / stripes
		var b := a + 0.33 / stripes
		_quad([side[0].lerp(side[1], a), side[0].lerp(side[1], b), side[3].lerp(side[2], b), side[3].lerp(side[2], a)], Color("#1b4a8f"))
	var band_top := 0.46
	var band_bottom := 0.54
	_quad([side[0].lerp(side[3], band_top), side[1].lerp(side[2], band_top), side[1].lerp(side[2], band_bottom),
		side[0].lerp(side[3], band_bottom)], Color(NeonTheme.colors()[1], 0.85))
	if pitch > 0.0:
		_quad(top, Color("#13305e"))
	# The face: the cover card or the sleeve.
	if _face == null:
		_face = cover if cover != null else sleeve_for(colors)
	if _face != null:
		var uv := PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)])
		draw_polygon(PackedVector2Array(front), PackedColorArray([Color(1, 1, 1, alpha)]), uv, _face)
	else:
		_quad(front, Color(0.03, 0.05, 0.1))
	draw_polyline(PackedVector2Array(front + [front[0]]), Color(neon, 0.55), 1.5, true)


func _quad(pts: Array, color: Color) -> void:
	draw_colored_polygon(PackedVector2Array(pts), color)


static func _grown(pts: Array[Vector2], by: float) -> Array:
	var c := (pts[0] + pts[1] + pts[2] + pts[3]) / 4.0
	var out: Array = []
	for v: Vector2 in pts:
		out.append(v + (v - c).normalized() * by)
	return out


func _ellipse(c: Vector2, r: Vector2, color: Color) -> void:
	var pts := PackedVector2Array()
	for i: int in 40:
		var a := TAU * i / 40.0
		pts.append(c + Vector2(cos(a) * r.x, sin(a) * r.y))
	draw_colored_polygon(pts, color)


func _ellipse_line(c: Vector2, r: Vector2, color: Color, w: float) -> void:
	var pts := PackedVector2Array()
	for i: int in 61:
		var a := TAU * i / 60.0
		pts.append(c + Vector2(cos(a) * r.x, sin(a) * r.y))
	draw_polyline(pts, color, w, true)
