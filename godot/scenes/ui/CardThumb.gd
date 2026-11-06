class_name CardThumb
extends Control
## A card of the card data (a CardSummary of GET /api/cards/search or /api/cards/<name>) at 63:88: its picture (the player's,
## else Scryfall's when that setting is on, through Pictures) or, without one, a text frame: the name and mana cost, the type
## line, the rules text and power/toughness on a dark card edged in the card's tone. Nothing is drawn over a picture.
## `lift` makes it rise and grow a little under the pointer (the deckbuilder's result cards); a left click emits `clicked`.

signal clicked()

const ASPECT: float = 63.0 / 88.0
const AUTOMATION: Dictionary = {
	"full": ["Full", Color("#1f6f43"), "Fully automated: the engine runs all of its rules text."],
	"partial": ["Partial", Color("#8a6a12"), "Partly automated: it may not function as written. Some of its text is resolved by hand (painted on the card)."],
	"manual": ["Manual", Color("#8b2b2b"), "Manual: the players resolve its rules text by hand."],
}

var card: Dictionary = {}:
	set(v):
		card = v
		_refresh()
## Which face shows (two-sided cards).
var face: int = 0:
	set(v):
		face = v
		_refresh()
var lift: bool = false

var _texture: Texture2D = null
var _key: String = ""
var _hover: float = 0.0
var _over: bool = false
var _down: bool = false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP if lift else Control.MOUSE_FILTER_PASS
	Pictures.picture_ready.connect(_on_picture)
	Pictures.pictures_changed.connect(_refresh)
	mouse_entered.connect(func() -> void: _over = true)
	mouse_exited.connect(func() -> void:
		_over = false
		_down = false)
	_refresh()


func _refresh() -> void:
	if not is_inside_tree():
		return
	_key = Pictures.key_for(card, face)
	_texture = Pictures.texture_for(card, face) if _key != "" else null
	queue_redraw()


## The artist of the picture shown, "" when it is ours or the player's.
func artist() -> String:
	return Pictures.artist_of(_key)


func _on_picture(key: String, texture: Texture2D) -> void:
	if key == _key:
		_texture = texture
		queue_redraw()


func _gui_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb == null or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	if mb.pressed:
		_down = true
	elif _down:
		_down = false
		clicked.emit()
	accept_event()


func _process(delta: float) -> void:
	if not lift:
		return
	var target := 1.0 if _over else 0.0
	if _hover != target:
		_hover = move_toward(_hover, target, delta / 0.14)
		queue_redraw()


## The card's rectangle in the control: 63:88, as large as fits, at the top.
func card_rect() -> Rect2:
	var w := minf(size.x, size.y * ASPECT)
	return Rect2(Vector2((size.x - w) / 2.0, 0.0), Vector2(w, w / ASPECT))


func _draw() -> void:
	var r := card_rect()
	if lift and not Settings.reduced_motion:
		var k := 1.0 - pow(1.0 - _hover, 3.0)
		var s := lerpf(1.0, 0.98 if _down else 1.04, k)
		var c := r.get_center()
		draw_set_transform(c - c * s + Vector2(0, (-1.0 if _down else -5.0) * k), 0.0, Vector2(s, s))
		if k > 0.0:
			draw_rect(Rect2(r.position + Vector2(0, 8), r.size), Color(0, 0, 0, 0.35 * k))
	if _texture != null:
		draw_texture_rect(_texture, r, false)
		return
	_draw_frame(r)


func _draw_frame(r: Rect2) -> void:
	var faces: Array = Val.list(card, "faces")
	var f := Val.as_dict(faces[clampi(face, 0, faces.size() - 1)]) if not faces.is_empty() else {}
	var tone := DeckModel.tone_of(card)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.035, 0.05, 0.1)
	style.border_color = tone
	style.set_border_width_all(maxi(2, int(r.size.x / 60.0)))
	style.set_corner_radius_all(int(r.size.x * 0.045))
	draw_style_box(style, r)
	var pad := r.size.x * 0.06
	var font := Hud.bold_font()
	var plain: Font = get_theme_default_font()
	var fs := maxi(8, int(r.size.x / 13.0))
	var inner := r.grow(-pad)
	# Name and mana cost.
	var cost := ManaCost.symbols(Val.text(f, "manaCost"))
	var sym := fs * 1.05
	var cost_w := cost.size() * (sym + 1.0)
	var title := Val.text(f, "name", Val.text(card, "name"))
	draw_string(font, inner.position + Vector2(0, fs), title, HORIZONTAL_ALIGNMENT_LEFT, inner.size.x - cost_w - 4.0, fs, Color("#f2fbff"))
	for i: int in cost.size():
		ManaCost.draw_symbol(self, cost[i], Vector2(inner.end.x - cost_w + i * (sym + 1.0) + sym / 2.0, inner.position.y + fs * 0.62), sym / 2.0)
	# The art box: the card's tone, darkened.
	var art := Rect2(inner.position + Vector2(0, fs * 1.6), Vector2(inner.size.x, inner.size.y * 0.36))
	draw_rect(art, Color(tone.darkened(0.7), 0.9))
	draw_rect(art, Color(tone, 0.5), false, 1.0)
	# Type line.
	var type_y := art.end.y + fs * 1.2
	draw_string(font, Vector2(inner.position.x, type_y), Val.text(f, "typeLine"), HORIZONTAL_ALIGNMENT_LEFT, inner.size.x, maxi(7, fs - 2),
		Color("#cfe9ff"))
	# Rules text, as much as fits.
	var text_fs := maxi(7, fs - 3)
	var lines := int((inner.end.y - type_y - fs * 1.6) / (text_fs * 1.15))
	if lines > 0:
		draw_multiline_string(plain, Vector2(inner.position.x, type_y + text_fs * 1.4), Val.text(f, "oracleText"), HORIZONTAL_ALIGNMENT_LEFT,
			inner.size.x, text_fs, lines, Color(0.86, 0.9, 0.96))
	var pt := ""
	if f.has("power") and f.has("toughness"):
		pt = "%s/%s" % [Val.text(f, "power"), Val.text(f, "toughness")]
	elif f.has("loyalty"):
		pt = Val.text(f, "loyalty")
	if pt != "":
		var w := font.get_string_size(pt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(font, Vector2(inner.end.x - w, inner.end.y), pt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)


## The automation badge: "Full", "Partial" or "Manual" in a pill, with what it means as its tooltip.
static func automation_badge(level: String) -> Control:
	var a: Array = AUTOMATION.get(level, [])
	var l := Label.new()
	if a.is_empty():
		return l
	l.text = String(a[0])
	l.tooltip_text = String(a[2])
	l.mouse_filter = Control.MOUSE_FILTER_PASS
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", Color.WHITE)
	var s := StyleBoxFlat.new()
	s.bg_color = a[1]
	s.set_corner_radius_all(999)
	s.content_margin_left = 7
	s.content_margin_right = 7
	s.content_margin_top = 1
	s.content_margin_bottom = 1
	l.add_theme_stylebox_override("normal", s)
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return l
