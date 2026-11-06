class_name CardPreview
extends PanelContainer
## A card shown large (packages/client/src/decks/CardPreview.tsx, keywords.ts): the card on the left (a Back / Front switch for a
## two-sided card, "Illustrated by" under a Scryfall picture); on the right each face's name and cost, type line with
## power/toughness or loyalty, and rules text with its symbols; the automation badge, the warning of a partly automated card,
## a box for each keyword its text uses, and what is resolved by hand. `pinned` (the card opened by its name) adds "Use as deck
## cover" and Close; the preview that follows the pointer has neither and lets the pointer through.

signal cover_chosen(card_name: String)
signal close_pressed()

const KEYWORDS: Array = [
	["Flying", "CR 702.9", "A creature with flying can't be blocked except by creatures with flying or reach."],
	["Reach", "CR 702.17", "A creature with reach can block creatures with flying."],
	["First strike", "CR 702.7", "This creature deals combat damage before creatures without first strike."],
	["Double strike", "CR 702.4", "This creature deals combat damage twice: once with the first strikers and once with everything else."],
	["Deathtouch", "CR 702.2", "Any amount of damage this deals to a creature is enough to destroy it."],
	["Lifelink", "CR 702.15", "Damage dealt by this also makes its controller gain that much life."],
	["Haste", "CR 702.10", "This can attack and use {T} abilities as soon as it comes under your control."],
	["Vigilance", "CR 702.20", "Attacking doesn't cause this creature to tap."],
	["Trample", "CR 702.19", "If this is blocked, it can assign damage beyond what is lethal to its blockers to the player or planeswalker it attacks."],
	["Menace", "CR 702.111", "This creature can't be blocked except by two or more creatures."],
	["Hexproof", "CR 702.11", "This can't be the target of spells or abilities your opponents control."],
	["Shroud", "CR 702.18", "This can't be the target of any spells or abilities."],
	["Indestructible", "CR 702.12", "Damage and \"destroy\" effects can't destroy this permanent."],
	["Flash", "CR 702.8", "You may cast this any time you could cast an instant."],
	["Defender", "CR 702.3", "This creature can't attack."],
	["Ward", "CR 702.21", "When this becomes the target of a spell or ability an opponent controls, counter it unless that player pays the ward cost."],
	["Protection", "CR 702.16", "Damage, enchanting or equipping, blocking, and targeting by anything with the stated quality are all prevented."],
	["Prowess", "CR 702.108", "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn."],
	["Kicker", "CR 702.33", "You may pay an extra cost as you cast this spell for a bigger effect."],
	["Flashback", "CR 702.34", "You may cast this from your graveyard by paying its flashback cost; it is exiled afterwards."],
	["Equip", "CR 702.6", "Pay the equip cost, at sorcery speed, to attach this to a creature you control."],
	["Cycling", "CR 702.29", "Pay the cycling cost and discard this card to draw a card."],
	["Cascade", "CR 702.85", "When you cast this, exile cards from the top of your library until you find a cheaper nonland card, and cast it free."],
	["Convoke", "CR 702.51", "Your creatures can help pay for this spell: each one you tap pays for {1} or one mana of its color."],
	["Undying", "CR 702.93", "When this creature dies, if it had no +1/+1 counters, return it with a +1/+1 counter."],
	["Persist", "CR 702.79", "When this creature dies, if it had no -1/-1 counters, return it with a -1/-1 counter."],
	["Infect", "CR 702.90", "This deals damage to creatures as -1/-1 counters and to players as poison counters."],
	["Toxic", "CR 702.164", "A player dealt combat damage by this creature also gets that many poison counters."],
	["Scry", "CR 701.22", "Look at the top cards of your library; put any number on the bottom and the rest back in any order."],
	["Surveil", "CR 701.25", "Look at the top cards of your library; put any number into your graveyard and the rest back in any order."],
	["Fight", "CR 701.14", "Each of the two creatures deals damage equal to its power to the other."],
	["Mill", "CR 701.17", "Put the top cards of a library into its owner’s graveyard."],
	["Proliferate", "CR 701.34", "Choose any permanents and players with counters, then give each one more counter of a kind it already has."],
	["Exalted", "CR 702.83", "Whenever a creature you control attacks alone, it gets +1/+1 until end of turn."],
	["Storm", "CR 702.40", "When you cast this, copy it for each spell cast before it this turn."],
	["Evolve", "CR 702.100", "Whenever a bigger creature enters under your control, put a +1/+1 counter on this."],
]
const BY_HAND: Dictionary = {
	"ability": "You resolve this ability by hand.", "trigger": "You resolve this triggered ability by hand.",
	"static": "You apply this effect by hand.", "step": "You do this part by hand.", "condition": "You check this condition by hand.",
	"quantity": "You choose this number by hand.", "cost": "You pay this cost by hand.", "target": "You choose these targets by hand.",
	"restriction": "You keep to this restriction by hand.", "mana": "You add this mana by hand.",
}
const MAGENTA: Color = Color("#ff4fd8")

var _thumb: CardThumb = null
var _artist: Label = null
var _flip: Button = null
var _right: VBoxContainer = null
var _card: Dictionary = {}

static var _re_reminder: RegEx = null


## A preview of `card` (a CardSummary) with `detail` (GET /api/cards/<name>: its manualParts) when known.
static func make(card: Dictionary, detail: Dictionary, pinned: bool, is_cover: bool = false) -> CardPreview:
	var p := CardPreview.new()
	p._build(card, detail, pinned, is_cover)
	return p


func _build(card: Dictionary, detail: Dictionary, pinned: bool, is_cover: bool) -> void:
	_card = card
	# Pinned, it sits in a modal's panel; following the pointer, it is its own panel.
	if pinned:
		add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	else:
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0.02, 0.035, 0.08, 0.97)
		style.border_color = Color(NeonTheme.colors()[0], 0.8)
		style.set_border_width_all(1)
		style.set_corner_radius_all(12)
		style.set_content_margin_all(14)
		style.shadow_color = Color(0, 0, 0, 0.6)
		style.shadow_size = 18
		add_theme_stylebox_override("panel", style)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	add_child(row)
	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(280, 0)
	left.add_theme_constant_override("separation", 6)
	row.add_child(left)
	_thumb = CardThumb.new()
	_thumb.custom_minimum_size = Vector2(280, 391)
	_thumb.card = card
	left.add_child(_thumb)
	if Pictures.is_two_sided(card):
		_flip = Hud.button("Back")
		_flip.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_flip.pressed.connect(func() -> void:
			_thumb.face = 1 - _thumb.face
			_flip.text = "Front" if _thumb.face == 1 else "Back"
			_show_artist())
		left.add_child(_flip)
	_artist = Hud.text("", 12)
	_artist.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	left.add_child(_artist)
	Pictures.picture_ready.connect(_on_picture)
	_show_artist()
	_right = VBoxContainer.new()
	_right.add_theme_constant_override("separation", 8)
	_right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_right.custom_minimum_size = Vector2(280, 0)
	row.add_child(_right)
	for f: Variant in Val.list(card, "faces"):
		_face(Val.as_dict(f))
	var level := Val.text(card, "automation")
	var badge := CardThumb.automation_badge(level)
	badge.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_right.add_child(badge)
	if level == "partial":
		_right.add_child(_box("⚠ This card may not function as written: it is only partly automated, and some of its text is resolved by hand.",
			Color("#ffd27a")))
	for k: Array in _keywords_of(card):
		var text := RichTextLabel.new()
		text.fit_content = true
		text.scroll_active = false
		text.mouse_filter = Control.MOUSE_FILTER_PASS
		text.custom_minimum_size = Vector2(240, 0)
		text.add_theme_font_size_override("normal_font_size", 13)
		text.add_theme_font_size_override("bold_font_size", 13)
		_right.add_child(_framed(text, MAGENTA))
		_keyword_text(text, k)
		if not Glyphs.is_ready():
			Glyphs.rendered.connect(_keyword_text.bind(text, k), CONNECT_ONE_SHOT)
	var parts: Array = Val.list(detail, "manualParts")
	if not parts.is_empty():
		_right.add_child(Hud.text("Resolved by hand during a game:", 13, Hud.TEXT))
		for part: Variant in parts:
			var pd := Val.as_dict(part)
			var line := ("“%s” " % Val.text(pd, "text")) if Val.text(pd, "text") != "" else ""
			_right.add_child(Hud.text(line + Val.text(pd, "summary"), 12))
			if pinned:
				_right.add_child(Hud.text("%s (%s)" % [String(BY_HAND.get(Val.text(pd, "impact"), "You do this part by hand.")),
					Val.text(pd, "reason")], 11))
	if pinned:
		var actions := HBoxContainer.new()
		actions.add_theme_constant_override("separation", 8)
		actions.alignment = BoxContainer.ALIGNMENT_END
		var cover := Hud.button("Deck cover" if is_cover else "Use as deck cover")
		cover.disabled = is_cover
		cover.pressed.connect(func() -> void:
			cover.text = "Deck cover"
			cover.disabled = true
			cover_chosen.emit(Val.text(card, "name")))
		actions.add_child(cover)
		var close := Hud.button("Close")
		close.set_meta(&"sfx", "ui.close")
		close.pressed.connect(func() -> void: close_pressed.emit())
		actions.add_child(close)
		_right.add_child(actions)


func _on_picture(_key: String, _texture: Texture2D) -> void:
	_show_artist()


func _show_artist() -> void:
	if _thumb == null or _artist == null:
		return
	var a := _thumb.artist()
	_artist.text = ("Illustrated by %s" % a) if a != "" else ""


func _face(f: Dictionary) -> void:
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = Val.text(f, "name")
	title.add_theme_font_override("font", Hud.bold_font())
	title.add_theme_font_size_override("font_size", 17)
	head.add_child(title)
	var cost := ManaCost.new()
	cost.symbol_size = 18.0
	cost.cost = Val.text(f, "manaCost")
	cost.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(cost)
	_right.add_child(head)
	var type_line := Val.text(f, "typeLine")
	if f.has("power") and f.has("toughness"):
		type_line += " %s/%s" % [Val.text(f, "power"), Val.text(f, "toughness")]
	if f.has("loyalty"):
		type_line += " Loyalty %s" % Val.text(f, "loyalty")
	_right.add_child(Hud.text(type_line, 13, Color("#cfe9ff")))
	var rules := RichTextLabel.new()
	rules.fit_content = true
	rules.scroll_active = false
	rules.selection_enabled = true
	rules.mouse_filter = Control.MOUSE_FILTER_PASS
	rules.add_theme_font_size_override("normal_font_size", 14)
	rules.custom_minimum_size = Vector2(260, 0)
	Glyphs.fill(rules, Val.text(f, "oracleText"), 15)
	if not Glyphs.is_ready():
		Glyphs.rendered.connect(func() -> void: Glyphs.fill(rules, Val.text(f, "oracleText"), 15), CONNECT_ONE_SHOT)
	_right.add_child(rules)


func _box(text: String, edge: Color) -> PanelContainer:
	return _framed(Hud.text(text, 12, Hud.TEXT), edge)


## `content` in a box with a coloured left edge (the warning, the keyword boxes).
static func _framed(content: Control, edge: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(edge, 0.1)
	s.border_color = edge
	s.border_width_left = 3
	s.set_corner_radius_all(6)
	s.set_content_margin_all(8)
	panel.add_theme_stylebox_override("panel", s)
	panel.add_child(content)
	return panel


## "Haste This can attack and use {T} abilities… (CR 702.10)", the keyword bold and its symbols drawn.
func _keyword_text(text: RichTextLabel, k: Array) -> void:
	if not is_instance_valid(text):
		return
	text.clear()
	text.push_bold()
	text.add_text(String(k[0]))
	text.pop()
	text.add_text(" ")
	Glyphs.append(text, String(k[2]), 14)
	text.push_color(Color(1, 1, 1, 0.55))
	text.add_text(" (%s)" % String(k[1]))
	text.pop()


## The keywords the rules text of any face uses (reminder text in parentheses left out), in the table's order.
static func _keywords_of(card: Dictionary) -> Array:
	if _re_reminder == null:
		_re_reminder = RegEx.create_from_string("\\([^)]*\\)")
	var text := ""
	for f: Variant in Val.list(card, "faces"):
		text += _re_reminder.sub(Val.text(Val.as_dict(f), "oracleText"), "", true) + "\n"
	var out: Array = []
	for k: Array in KEYWORDS:
		var word := String(k[0]).replace(" ", "\\s+")
		var re := RegEx.create_from_string("(?i)(^|[^\\w])%s(?![\\w])" % word)
		if re.search(text) != null:
			out.append(k)
	return out
