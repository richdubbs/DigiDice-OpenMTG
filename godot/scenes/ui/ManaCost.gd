class_name ManaCost
extends Control
## A mana cost drawn as symbols ("{2}{R}{R}": a grey 2, two red discs), left to right, as the browser's mana glyphs: coloured
## discs with their letter or number; hybrid symbols split in two; Phyrexian ones with the Phyrexian mark; {T} and {Q} as turning
## arrows. `draw_symbol` also draws the symbols Glyphs makes into textures for rules text.

const FILLS: Dictionary = {
	"W": Color("#f8f6d8"), "U": Color("#c1d7e9"), "B": Color("#bab1ab"), "R": Color("#e49977"), "G": Color("#a3c095"),
}
const GENERIC: Color = Color("#cbc2bf")
const INK: Color = Color("#141414")

var cost: String = "":
	set(v):
		cost = v
		_symbols = symbols(v)
		update_minimum_size()
		queue_redraw()
## A symbol's width (px); the symbols sit 1 px apart.
var symbol_size: float = 16.0:
	set(v):
		symbol_size = v
		update_minimum_size()
		queue_redraw()

var _symbols: Array[String] = []

static var _re: RegEx = null


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _get_minimum_size() -> Vector2:
	return Vector2(_symbols.size() * (symbol_size + 1.0), symbol_size)


## The symbols of a cost, in order ("{2}{W/U}" -> ["2", "W/U"]).
static func symbols(text: String) -> Array[String]:
	if _re == null:
		_re = RegEx.create_from_string("\\{([^}]+)\\}")
	var out: Array[String] = []
	for m: RegExMatch in _re.search_all(text):
		out.append(m.get_string(1).to_upper())
	return out


func _draw() -> void:
	var r := symbol_size / 2.0
	var y := size.y / 2.0
	for i: int in _symbols.size():
		draw_symbol(self, _symbols[i], Vector2(r + i * (symbol_size + 1.0), y), r)


static func _fill_of(part: String) -> Color:
	return FILLS.get(part, GENERIC)


## One symbol, a disc of radius `r` at `c`.
static func draw_symbol(ci: CanvasItem, sym: String, c: Vector2, r: float) -> void:
	var parts := sym.split("/")
	# A thin dark rim, as the printed symbols have.
	ci.draw_circle(c + Vector2(-0.6, 0.8) * r * 0.08, r, Color(0, 0, 0, 0.55))
	if parts.size() >= 2 and parts[parts.size() - 1] != "P":
		# Hybrid: the first half top left, the second bottom right.
		var a := _fill_of(parts[0])
		var b := _fill_of(parts[1])
		ci.draw_colored_polygon(_half(c, r, true), a)
		ci.draw_colored_polygon(_half(c, r, false), b)
		_text(ci, parts[0], c + Vector2(-r * 0.36, -r * 0.3), r * 0.95)
		_text(ci, parts[1], c + Vector2(r * 0.36, r * 0.36), r * 0.95)
		return
	if parts.size() >= 2:
		# Phyrexian: the colour (or both halves of a hybrid) with the Phyrexian mark.
		ci.draw_circle(c, r, _fill_of(parts[0]))
		if parts.size() == 3:
			ci.draw_colored_polygon(_half(c, r, false), _fill_of(parts[1]))
		ci.draw_arc(c, r * 0.42, 0.0, TAU, 20, INK, maxf(1.0, r * 0.16), true)
		ci.draw_line(c + Vector2(0, -r * 0.72), c + Vector2(0, r * 0.72), INK, maxf(1.0, r * 0.16), true)
		return
	var s := parts[0]
	ci.draw_circle(c, r, _fill_of(s))
	match s:
		"T", "Q":
			# A turning arrow, clockwise for {T} (tap), back the other way for {Q} (untap).
			var w := maxf(1.2, r * 0.2)
			var from := -PI * 0.75 if s == "T" else -PI * 0.25
			var to := PI * 0.35 if s == "T" else -PI * 1.35
			ci.draw_arc(c, r * 0.5, from, to, 16, INK, w, true)
			var tip := c + Vector2(cos(to), sin(to)) * r * 0.5
			var dir := Vector2(-sin(to), cos(to)) * (1.0 if s == "T" else -1.0)
			var side := Vector2(-dir.y, dir.x)
			ci.draw_colored_polygon(PackedVector2Array([tip + dir * r * 0.32, tip + side * r * 0.3, tip - side * r * 0.3]), INK)
		_:
			_text(ci, s, c, r * (1.3 if s.length() == 1 else 1.05))


static func _half(c: Vector2, r: float, first: bool) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var start := PI * 0.75 if first else -PI * 0.25
	for i: int in 17:
		var a := start + PI * i / 16.0
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	return pts


static func _text(ci: CanvasItem, s: String, c: Vector2, font_size: float) -> void:
	var font := Hud.bold_font()
	var fs := maxi(6, int(font_size))
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	ci.draw_string(font, c + Vector2(-w / 2.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, INK)
