extends Node
## Mana symbols as small textures (autoload "Glyphs"), so rules text in a RichTextLabel shows {T}, {2}{R} and the rest as the
## symbols themselves (`fill`). They are drawn once, shortly after start, in a hidden viewport with ManaCost.draw_symbol and cut
## into one texture each. Until then, and without a screen, a symbol stays text ("{T}").

signal rendered()

const SIZE: int = 40
const SYMBOLS: Array[String] = [
	"W", "U", "B", "R", "G", "C", "X", "Y", "Z", "S", "T", "Q", "E",
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "20",
	"W/U", "U/B", "B/R", "R/G", "G/W", "W/B", "U/R", "B/G", "R/W", "G/U",
	"2/W", "2/U", "2/B", "2/R", "2/G", "C/W", "C/U", "C/B", "C/R", "C/G",
	"W/P", "U/P", "B/P", "R/P", "G/P", "C/P",
	"W/U/P", "U/B/P", "B/R/P", "R/G/P", "G/W/P", "W/B/P", "U/R/P", "B/G/P", "R/W/P", "G/U/P",
]

var _textures: Dictionary = {}
var _viewport: SubViewport = null


func _ready() -> void:
	if DisplayServer.get_name() == "headless":
		return
	_viewport = SubViewport.new()
	_viewport.size = Vector2i(SIZE * SYMBOLS.size(), SIZE)
	_viewport.transparent_bg = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	var painter := Painter.new()
	painter.size = Vector2(_viewport.size)
	_viewport.add_child(painter)
	add_child(_viewport)
	_cut.call_deferred()


func _cut() -> void:
	for i: int in 3:
		await RenderingServer.frame_post_draw
	var image := _viewport.get_texture().get_image()
	if image == null or image.is_empty():
		return
	for i: int in SYMBOLS.size():
		_textures[SYMBOLS[i]] = ImageTexture.create_from_image(image.get_region(Rect2i(i * SIZE, 0, SIZE, SIZE)))
	_viewport.queue_free()
	_viewport = null
	rendered.emit()


func is_ready() -> bool:
	return not _textures.is_empty()


func texture(symbol: String) -> Texture2D:
	return _textures.get(symbol.to_upper())


## `text` into `label` (cleared first), its {…} symbols drawn `size` px tall; text not a symbol is added as it is (no BBCode).
func fill(label: RichTextLabel, text: String, size: int = 16) -> void:
	label.clear()
	append(label, text, size)


## `text` added to what `label` holds, its symbols drawn as in `fill`.
func append(label: RichTextLabel, text: String, size: int = 16) -> void:
	var i := 0
	while i < text.length():
		var a := text.find("{", i)
		if a < 0:
			label.add_text(text.substr(i))
			break
		var b := text.find("}", a)
		if b < 0:
			label.add_text(text.substr(i))
			break
		if a > i:
			label.add_text(text.substr(i, a - i))
		var t := texture(text.substr(a + 1, b - a - 1))
		if t != null:
			label.add_image(t, size, size, Color.WHITE, INLINE_ALIGNMENT_CENTER)
		else:
			label.add_text(text.substr(a, b - a + 1))
		i = b + 1


class Painter:
	extends Control

	func _draw() -> void:
		var r := Glyphs.SIZE / 2.0 - 1.0
		for i: int in Glyphs.SYMBOLS.size():
			ManaCost.draw_symbol(self, Glyphs.SYMBOLS[i], Vector2(i * Glyphs.SIZE + Glyphs.SIZE / 2.0, Glyphs.SIZE / 2.0), r)
