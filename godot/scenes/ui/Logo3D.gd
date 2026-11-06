class_name Logo3D
extends Control
## The DigiDice mark as a 3D object (packages/client/src/branding/Logo3D.tsx, branding.css): the transparent logo stacked in
## layers along its depth (14 at hero size, 10 from 80 px, 7 from 48 px, else 5), the back ones darker and purple so its sides
## read as metal, swaying (rotateY -17..17 degrees, rotateX 4..-3 over 9 s), tilting toward the mouse anywhere in the window
## (up to 20 degrees, 16 up and down), a neon halo behind it breathing (5.5 s), and with `shadow` a pool of light under it.
## Reduced motion: posed at a slight angle, still. The control's size is the logo's box; the halo reaches past it.

const LOGO: Texture2D = preload("res://assets/brand/digidice-mark-transparent.png")
const MAX_TILT_DEG: float = 20.0

var shadow: bool = false
var still: bool = false

var _t: float = 0.0
var _tilt: Vector2 = Vector2.ZERO
var _halo: Texture2D = null
var _pool: Texture2D = null


## A logo of `px` pixels.
static func make(px: float, with_shadow: bool = false) -> Logo3D:
	var l := Logo3D.new()
	l.custom_minimum_size = Vector2(px, px)
	l.shadow = with_shadow
	return l


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var neon := NeonTheme.colors()[0]
	var neon2 := NeonTheme.colors()[1]
	_halo = radial([0.0, 0.38, 0.58, 0.72, 1.0], [Color(neon, 0.36), Color(0.0, 0.6, 0.94, 0.16), Color(neon2, 0.1), Color(neon2, 0.0),
		Color(neon2, 0.0)])
	_pool = radial([0.0, 0.55, 0.75, 1.0], [Color(neon, 0.55), Color(neon2, 0.2), Color(neon2, 0.0), Color(neon2, 0.0)])


static func radial(offsets: Array, colors: Array) -> GradientTexture2D:
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


static func layers_for(px: float) -> int:
	if px >= 160.0:
		return 14
	if px >= 80.0:
		return 10
	if px >= 48.0:
		return 7
	return 5


func _process(delta: float) -> void:
	if Settings.reduced_motion:
		return
	_t += delta
	var vp := get_viewport_rect().size
	var m := get_viewport().get_mouse_position()
	var want := Vector2(clampf(m.x / maxf(vp.x, 1.0) * 2.0 - 1.0, -1.0, 1.0), clampf(m.y / maxf(vp.y, 1.0) * 2.0 - 1.0, -1.0, 1.0))
	_tilt = _tilt.lerp(want, minf(1.0, delta * 8.0))
	queue_redraw()


func _draw() -> void:
	var px := minf(size.x, size.y)
	var c := size / 2.0
	var reduced := Settings.reduced_motion
	var breathe := 0.8 + 0.2 * (0.5 - 0.5 * cos(_t * TAU / 5.5))
	var halo_r := px * 0.78
	draw_texture_rect(_halo, Rect2(c - Vector2(halo_r, halo_r), Vector2(halo_r, halo_r) * 2.0), false, Color(1, 1, 1, breathe))
	if shadow:
		draw_texture_rect(_pool, Rect2(c + Vector2(-px * 0.42, px * 0.52), Vector2(px * 0.84, px * 0.12)), false, Color(1, 1, 1, breathe))
	var sway := 0.0 if (still or reduced) else cos(_t * TAU / 9.0)
	var ry := deg_to_rad((-8.0 if reduced else -17.0 * sway) + _tilt.x * MAX_TILT_DEG)
	var rx := deg_to_rad((3.0 if reduced else 0.5 + 3.5 * sway) - _tilt.y * MAX_TILT_DEG * 0.8)
	draw_logo(self, c, px, rx, ry, layers_for(px))


## Draw the logo's layers on `canvas` about `c`, `px` wide, rotated by rx then ry, in perspective (px * 4.5 away).
static func draw_logo(canvas: CanvasItem, c: Vector2, px: float, rx: float, ry: float, n: int) -> void:
	var depth := px * 0.12
	var step := depth / maxf(1.0, n - 1)
	for i: int in n:
		var z := (i - (n - 1) / 2.0) * step
		var t := float(i) / maxf(1.0, n - 1)
		var front := i == n - 1
		var b := 0.16 + 0.42 * t
		var tint := Color.WHITE if front else Color(b * 0.95, b * 0.75, b * 1.35, 1.0)
		var half := px / 2.0
		var pts := PackedVector2Array()
		var persp := px * 4.5
		for p3: Vector3 in [Vector3(-half, -half, z), Vector3(half, -half, z), Vector3(half, half, z), Vector3(-half, half, z)]:
			var y1 := p3.y * cos(rx) - p3.z * sin(rx)
			var z1 := p3.y * sin(rx) + p3.z * cos(rx)
			var x2 := p3.x * cos(ry) + z1 * sin(ry)
			var z2 := -p3.x * sin(ry) + z1 * cos(ry)
			var k := persp / (persp - z2)
			pts.append(c + Vector2(x2, y1) * k)
		canvas.draw_colored_polygon(pts, tint, PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]), LOGO)
