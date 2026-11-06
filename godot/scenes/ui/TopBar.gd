class_name TopBar
extends PanelContainer
## The bar across the top of every screen but the table (packages/client/src/app/TopNav.tsx): the DigiDice mark and
## "OPENMTG" (back to Home), then Play, Decks, Replays, Images, Settings and About, the current one lit. Play reads
## "Back to game" while a game is open. A screen not built yet is shown dimmed with "Coming soon".

const HEIGHT: float = 52.0
const LOGO: String = "res://assets/brand/digidice-mark-transparent.png"

var _tabs: Dictionary = {}


## Put the bar at the top of `screen`.
static func attach(screen: Control) -> TopBar:
	var bar := TopBar.new()
	screen.add_child(bar)
	return bar


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	custom_minimum_size = Vector2(0, HEIGHT)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.01, 0.02, 0.05, 0.92)
	style.border_width_bottom = 1
	style.border_color = Color(NeonTheme.colors()[0], 0.35)
	style.shadow_color = Color(NeonTheme.colors()[0], 0.12)
	style.shadow_size = 10
	style.content_margin_left = 16
	style.content_margin_right = 16
	add_theme_stylebox_override("panel", style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	add_child(row)
	row.add_child(_brand())
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(36, 0)
	row.add_child(gap)
	var here := Nav.current()
	for t: Array in Nav.TABS:
		var screen := String(t[0])
		var label := String(t[1])
		if screen == "play" and Nav.in_game():
			label = "Back to game"
		var b := _tab(label.to_upper(), screen == here or (screen == "play" and (here == "newGame" or here == "table")))
		b.name = "Tab_" + screen
		if Nav.exists(screen):
			b.pressed.connect(Nav.go.bind(screen))
		else:
			b.disabled = true
			b.tooltip_text = "Coming soon"
		row.add_child(b)
		_tabs[screen] = b


func _brand() -> Control:
	var b := Button.new()
	b.name = "Brand"
	b.flat = true
	b.tooltip_text = "Home"
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(Nav.go.bind("home"))
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 8)
	var logo := TextureRect.new()
	logo.texture = load(LOGO)
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(34, 34)
	logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(logo)
	var word := RichTextLabel.new()
	word.bbcode_enabled = true
	word.fit_content = true
	word.autowrap_mode = TextServer.AUTOWRAP_OFF
	word.scroll_active = false
	word.mouse_filter = Control.MOUSE_FILTER_IGNORE
	word.add_theme_font_override("normal_font", Hud.wide_font())
	word.add_theme_font_size_override("normal_font_size", 16)
	word.text = "[color=#f2fbff]OPEN[/color][color=#%s]MTG[/color]" % NeonTheme.colors()[0].to_html(false)
	word.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(word)
	b.add_child(row)
	b.custom_minimum_size = Vector2(150, HEIGHT - 8)
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	return b


func _tab(text: String, lit: bool) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, HEIGHT - 12)
	b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	b.add_theme_font_override("font", Hud.wide_font())
	b.add_theme_font_size_override("font_size", 12)
	var neon := NeonTheme.colors()[0]
	for state: String in ["normal", "hover", "pressed", "focus", "disabled"]:
		var s := StyleBoxFlat.new()
		s.set_corner_radius_all(6)
		s.content_margin_left = 16
		s.content_margin_right = 16
		s.bg_color = Color(neon, 0.16) if lit else (Color(neon, 0.08) if state == "hover" else Color.TRANSPARENT)
		if lit:
			s.set_border_width_all(1)
			s.border_color = Color(neon, 0.8)
			s.shadow_color = Color(neon, 0.35)
			s.shadow_size = 10
		b.add_theme_stylebox_override(state, s)
	b.add_theme_color_override("font_color", Hud.TEXT if lit else Hud.MUTED)
	b.add_theme_color_override("font_hover_color", Hud.TEXT)
	b.add_theme_color_override("font_disabled_color", Color(Hud.MUTED, 0.4))
	return b
