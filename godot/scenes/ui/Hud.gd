class_name Hud
extends RefCounted
## The Neon Grid pieces every screen is built from, as the browser draws them (packages/client/src/theme/styles.css,
## neon-grid.css): glowing wide-spaced titles (`.neon-title`), small capital kickers (`.hp-kicker`), dark glass panels with a
## neon edge and lit corner brackets (`.hud-panel`), the big lit primary button (`.button-primary`) and progress bars.

const TEXT: Color = Color(0.949, 0.984, 1.0)
const MUTED: Color = Color(0.72, 0.78, 0.88)
const PANEL_BG: Color = Color(0.016, 0.031, 0.078, 0.84)

static var _bold: FontVariation = null
static var _wide: FontVariation = null


## Segoe UI bold, as the browser's HUD font (--hud-font), with no extra spacing.
static func bold_font() -> FontVariation:
	if _bold == null:
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Segoe UI", "Noto Sans", "sans-serif"])
		f.font_weight = 700
		_bold = FontVariation.new()
		_bold.base_font = f
	return _bold


## The title face: bold with the letters spaced out (letter-spacing 0.06-0.12em).
static func wide_font() -> FontVariation:
	if _wide == null:
		_wide = FontVariation.new()
		_wide.base_font = bold_font()
		_wide.spacing_glyph = 3
	return _wide


## A glowing title in capitals (`.neon-title`): near-white text with a neon halo.
static func title(words: String, size: int = 30) -> Label:
	var l := Label.new()
	l.text = words.to_upper()
	var s := LabelSettings.new()
	s.font = wide_font()
	s.font_size = size
	s.font_color = TEXT
	s.outline_size = maxi(2, size / 10)
	s.outline_color = Color(NeonTheme.colors()[0], 0.55)
	s.shadow_size = maxi(6, size / 3)
	s.shadow_color = Color(NeonTheme.colors()[0], 0.45)
	s.shadow_offset = Vector2.ZERO
	l.label_settings = s
	return l


## A small capital line above a title (`.hp-kicker`), in the second neon.
static func kicker(words: String, color: Color = Color.TRANSPARENT) -> Label:
	var l := Label.new()
	l.text = words.to_upper()
	var s := LabelSettings.new()
	s.font = wide_font()
	s.font_size = 11
	s.font_color = color if color.a > 0.0 else NeonTheme.colors()[1]
	l.label_settings = s
	return l


## Body text: wrapping, muted unless a colour is given.
static func text(body: String, size: int = 14, color: Color = MUTED) -> Label:
	var l := Label.new()
	l.text = body
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


## A dark glass panel with a neon edge and corner brackets (`.hud-panel`); children go in its returned content box.
static func panel(padding: int = 16) -> PanelContainer:
	var p := PanelContainer.new()
	var box := StyleBoxFlat.new()
	box.bg_color = PANEL_BG
	box.set_border_width_all(1)
	box.border_color = Color(NeonTheme.colors()[0], 0.45)
	box.set_corner_radius_all(6)
	box.shadow_color = Color(NeonTheme.colors()[0], 0.18)
	box.shadow_size = 14
	box.set_content_margin_all(padding)
	p.add_theme_stylebox_override("panel", box)
	var brackets := Brackets.new()
	brackets.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(brackets)
	return p


## The big lit button (`.button-primary`): a neon slab with dark bold text (autoload/Slabs.gd draws it). Its press sounds as a
## confirm (UiSounds).
static func primary(label: String, font_size: int = 22) -> Button:
	var b := Button.new()
	b.text = label.to_upper()
	b.theme_type_variation = &"Primary"
	b.set_meta(&"slab", "primary")
	b.set_meta(&"slab_depth", 5.0)
	b.custom_minimum_size = Vector2(0, 56)
	b.add_theme_font_override("font", wide_font())
	b.add_theme_font_size_override("font_size", font_size)
	return b


## A secondary button with an outline, the browser's ordinary button.
static func button(label: String) -> Button:
	var b := Button.new()
	b.text = label
	b.custom_minimum_size = Vector2(0, 38)
	b.add_theme_font_override("font", bold_font())
	return b


## A thin bar from 0 to 1 with the neon fill (`.hp-bar`), `pct` 0-100.
static func bar(pct: float, height: int = 8) -> ProgressBar:
	var p := ProgressBar.new()
	p.min_value = 0
	p.max_value = 100
	p.value = pct
	p.show_percentage = false
	p.custom_minimum_size = Vector2(0, height)
	var fill := StyleBoxFlat.new()
	fill.set_corner_radius_all(height / 2)
	fill.bg_color = NeonTheme.colors()[0]
	fill.border_color = NeonTheme.colors()[1]
	fill.border_width_right = 2
	fill.shadow_color = Color(NeonTheme.colors()[0], 0.5)
	fill.shadow_size = 6
	var back := StyleBoxFlat.new()
	back.set_corner_radius_all(height / 2)
	back.bg_color = Color(0.06, 0.09, 0.18, 0.9)
	back.set_border_width_all(1)
	back.border_color = Color(NeonTheme.colors()[0], 0.3)
	p.add_theme_stylebox_override("fill", fill)
	p.add_theme_stylebox_override("background", back)
	return p


## "25,148": a whole number with thousands commas.
static func thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


## The lit corners of a HUD panel: four short L shapes in the second neon, drawn over the panel's edge.
class Brackets:
	extends Control

	const ARM: float = 14.0

	func _ready() -> void:
		resized.connect(queue_redraw)
		item_rect_changed.connect(queue_redraw)

	func _draw() -> void:
		var c := Color(NeonTheme.colors()[1], 0.9)
		# The panel's own corners (this control fills only the panel's content box).
		var parent := get_parent_control()
		var r := Rect2(-position, parent.size if parent != null else size)
		var w := 2.0
		var corners := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]
		var dirs := [Vector2(1, 1), Vector2(-1, 1), Vector2(-1, -1), Vector2(1, -1)]
		for i: int in 4:
			var p: Vector2 = corners[i]
			var d: Vector2 = dirs[i]
			draw_line(p, p + Vector2(ARM * d.x, 0), c, w)
			draw_line(p, p + Vector2(0, ARM * d.y), c, w)
