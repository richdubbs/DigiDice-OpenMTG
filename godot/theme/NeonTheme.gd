class_name NeonTheme
extends RefCounted
## The Neon Grid look: two colours, "neon" (edges, glows, the main buttons) and "neon2" (corner
## brackets, the horizon, pressed and danger states), with four presets. theme/neon_grid.tres holds the styles every Control uses
## (it is the project's custom theme) and, as metadata, the two colours and the presets. `apply` re-colours that theme in place,
## so changing the preset is one call and every screen follows.

const THEME_PATH: String = "res://theme/neon_grid.tres"
const PRESET_ORDER: Array[String] = ["DigiDice", "Synthwave", "Toxic", "Ember"]

## Used only if the theme file cannot be read (the same values as its metadata).
const _FALLBACK: Dictionary = {
	"DigiDice": [Color(0.121569, 0.721569, 1.0), Color(0.960784, 0.0, 0.960784)],
	"Synthwave": [Color(1.0, 0.309804, 0.847059), Color(1.0, 0.690196, 0.0)],
	"Toxic": [Color(0.223529, 1.0, 0.478431), Color(0.0, 0.882353, 1.0)],
	"Ember": [Color(1.0, 0.478431, 0.121569), Color(1.0, 0.168627, 0.290196)],
}


static func presets() -> Dictionary:
	var theme := load(THEME_PATH) as Theme
	if theme != null and theme.has_meta("presets"):
		var p: Variant = theme.get_meta("presets")
		if p is Dictionary:
			return p
	return _FALLBACK


## [neon, neon2] of a preset (DigiDice when unknown).
static func preset_colors(preset_name: String) -> Array[Color]:
	var all := presets()
	var pair: Array = Val.as_list(all.get(preset_name, all.get("DigiDice", _FALLBACK["DigiDice"])))
	var out: Array[Color] = [Color(0.121569, 0.721569, 1.0), Color(0.960784, 0.0, 0.960784)]
	if pair.size() >= 2 and pair[0] is Color and pair[1] is Color:
		out[0] = pair[0]
		out[1] = pair[1]
	return out


## Re-colour the theme's styles from the two colours (alpha of each style is kept).
static func apply(theme: Theme, neon: Color, neon2: Color) -> void:
	theme.set_meta("neon", neon)
	theme.set_meta("neon2", neon2)
	_border(theme, "normal", "Button", neon)
	_border(theme, "hover", "Button", neon)
	_border(theme, "pressed", "Button", neon2)
	_border(theme, "focus", "Button", neon2)
	_border(theme, "panel", "PanelContainer", neon)
	_border(theme, "normal", "LineEdit", neon)
	_border(theme, "background", "ProgressBar", neon)
	var fill := theme.get_stylebox("fill", "ProgressBar") as StyleBoxFlat
	if fill != null:
		fill.bg_color = Color(neon, fill.bg_color.a)
		fill.shadow_color = Color(neon, fill.shadow_color.a)
	_check_boxes(theme, neon)


## Check boxes and radio buttons: no button frame (CheckBox would take Button's), and neon boxes and rings drawn here so
## they follow the colours.
static func _check_boxes(theme: Theme, neon: Color) -> void:
	var none := StyleBoxEmpty.new()
	none.set_content_margin_all(3)
	for state: String in ["normal", "hover", "pressed", "hover_pressed", "disabled", "focus"]:
		theme.set_stylebox(state, "CheckBox", none)
	var text := Color(0.909804, 0.909804, 0.941176)
	theme.set_color("font_color", "CheckBox", text)
	theme.set_color("font_pressed_color", "CheckBox", text)
	theme.set_color("font_hover_pressed_color", "CheckBox", Color.WHITE)
	theme.set_color("font_hover_color", "CheckBox", Color.WHITE)
	theme.set_color("font_focus_color", "CheckBox", text)
	theme.set_constant("h_separation", "CheckBox", 8)
	for disabled: bool in [false, true]:
		var c := Color(neon, 0.35) if disabled else neon
		var suffix := "_disabled" if disabled else ""
		theme.set_icon("unchecked" + suffix, "CheckBox", _mark(c, false, false))
		theme.set_icon("checked" + suffix, "CheckBox", _mark(c, true, false))
		theme.set_icon("radio_unchecked" + suffix, "CheckBox", _mark(c, false, true))
		theme.set_icon("radio_checked" + suffix, "CheckBox", _mark(c, true, true))


## One 18 px mark: a rounded box (a tick in it when `on`) or a ring (a dot in it when `on`), smoothed at the edges.
static func _mark(color: Color, on: bool, radio: bool) -> ImageTexture:
	const N := 18
	var img := Image.create(N, N, false, Image.FORMAT_RGBA8)
	var c := Vector2(N, N) / 2.0
	var ink := Color(0.02, 0.04, 0.1)
	for y: int in N:
		for x: int in N:
			var p := Vector2(x + 0.5, y + 0.5)
			var out := Color(0, 0, 0, 0)
			if radio:
				var d := p.distance_to(c)
				var ring := clampf(1.0 - absf(d - 7.0) + 0.5, 0.0, 1.0)
				out = Color(0.02, 0.04, 0.1, 0.5 * clampf(7.5 - d, 0.0, 1.0))
				out = out.blend(Color(color, color.a * ring))
				if on:
					out = out.blend(Color(color, color.a * clampf(4.5 - d, 0.0, 1.0)))
			else:
				# Distance outside a rounded square of half-size 6.5 and corner radius 3.
				var q := (p - c).abs() - Vector2(3.5, 3.5)
				var d := Vector2(maxf(q.x, 0.0), maxf(q.y, 0.0)).length() + minf(maxf(q.x, q.y), 0.0) - 3.0
				var inside := clampf(0.5 - d, 0.0, 1.0)
				var edge := clampf(1.0 - absf(d + 0.75) + 0.25, 0.0, 1.0)
				if on:
					out = Color(color, color.a * inside)
					var tick := minf(_segment(p, Vector2(4.5, 9.2), Vector2(7.6, 12.3)), _segment(p, Vector2(7.6, 12.3), Vector2(13.6, 5.8)))
					out = out.blend(Color(ink, inside * clampf(1.6 - tick, 0.0, 1.0)))
				else:
					out = Color(0.02, 0.04, 0.1, 0.5 * inside).blend(Color(color, color.a * edge))
			img.set_pixel(x, y, out)
	return ImageTexture.create_from_image(img)


static func _segment(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
	return p.distance_to(a + ab * t)


static func _border(theme: Theme, style: String, type_name: String, color: Color) -> void:
	var box := theme.get_stylebox(style, type_name) as StyleBoxFlat
	if box == null:
		return
	box.border_color = Color(color, box.border_color.a)
	box.shadow_color = Color(color, box.shadow_color.a)


## The current colours (from the theme's metadata), for screens that draw their own glows.
static func colors() -> Array[Color]:
	var theme := load(THEME_PATH) as Theme
	var out: Array[Color] = preset_colors("DigiDice")
	if theme != null:
		if theme.has_meta("neon"):
			out[0] = theme.get_meta("neon")
		if theme.has_meta("neon2"):
			out[1] = theme.get_meta("neon2")
	return out
