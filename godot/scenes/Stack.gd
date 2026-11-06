class_name StackView
extends PanelContainer
## The stack (CR 405), top first: each spell or ability as a small card with its name, its controller and its targets (an
## ability as the card it comes from with a Trigger or Ability band, and its own text). Hidden
## while the stack is empty. Clicks and hovers on its cards go to the Table like the board's.

signal card_clicked(id: String)
signal card_hovered(id: String, inside: bool)

const CARD_SCENE: PackedScene = preload("res://scenes/Card.tscn")
const CARD_SCALE: float = 0.42

@onready var _items: VBoxContainer = %Items

## id -> CardView of the objects shown (the animator measures them).
var _cards: Dictionary = {}
## The top item's card holder, which bobs 2 px up and down every 2.4 s (arena.css stack-top).
var _top_holder: Control = null
var _t: float = 0.0


func show_stack(view: Dictionary, selection: BoardSelection) -> void:
	for child: Node in _items.get_children():
		child.queue_free()
	_cards.clear()
	_top_holder = null
	var ids := View.stack(view)
	visible = not ids.is_empty()
	ids.reverse()
	for id: String in ids:
		var obj := View.object(view, id)
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_theme_constant_override("separation", 8)
		var holder := Control.new()
		holder.custom_minimum_size = CardView.SIZE * CARD_SCALE
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if _top_holder == null or not is_instance_valid(_top_holder) or _top_holder.is_queued_for_deletion():
			_top_holder = holder
		# In the tree first: the card's child nodes are ready only once it is inside the tree.
		_items.add_child(row)
		row.add_child(holder)
		var card: CardView = CARD_SCENE.instantiate()
		holder.add_child(card)
		card.show_object(view, id)
		card.set_card_scale(CARD_SCALE)
		card.position = CardView.SIZE * CARD_SCALE * 0.5 - card.pivot_offset
		_cards[id] = card
		card.clicked.connect(func(cid: String) -> void: card_clicked.emit(cid))
		card.hovered.connect(func(cid: String, inside: bool) -> void: card_hovered.emit(cid, inside))
		if selection != null and selection.is_selected(id):
			card.set_glow(CardView.GlowKind.SELECTED)
		elif selection != null and selection.can_select(id):
			card.set_glow(CardView.GlowKind.SELECTABLE)
		var label := Label.new()
		label.custom_minimum_size = Vector2(160, 0)
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.add_theme_font_size_override("font_size", 12)
		label.text = _describe(view, obj)
		row.add_child(label)


func _process(delta: float) -> void:
	_t += delta
	if _top_holder == null or not is_instance_valid(_top_holder) or Settings.reduced_motion:
		return
	# The animator moves the stack's cards while it plays a change: the bob waits for it.
	var animator := get_tree().current_scene.get_node_or_null("Animator") if get_tree().current_scene != null else null
	if animator != null and bool(animator.get("playing")):
		return
	for c: Node in _top_holder.get_children():
		if c is CardView:
			var card := c as CardView
			card.position.y = CardView.SIZE.y * CARD_SCALE * 0.5 - card.pivot_offset.y - 2.0 * (0.5 - 0.5 * cos(_t * TAU / 2.4))


## The card nodes on the stack by object id (fx/Animator.gd).
func card_nodes() -> Dictionary:
	return _cards


## Where a spell arriving on the stack is drawn (global canvas rect of the top item, also while the stack is empty and hidden).
func anchor_rect() -> Rect2:
	var size := CardView.SIZE * CARD_SCALE
	var top_left := get_global_rect().position + Vector2(12.0, 34.0)
	return Rect2(top_left, size)


## "Name\nby Player\ntargets: A, B" for one stack object.
func _describe(view: Dictionary, obj: Dictionary) -> String:
	var lines: Array[String] = [View.name_of(view, obj)]
	lines.append("by %s" % View.player_name(view, Chars.controller_of(view, obj)))
	if Val.text(obj, "kind") == "ability":
		var text := View.ability_text(view, obj)
		if text != "":
			lines.append(text)
	var st := Val.dict(obj, "stack")
	var names: Array[String] = []
	for group: Variant in Val.list(st, "targets"):
		for t: Variant in Val.as_list(group):
			names.append(View.name_by_id(view, Val.text(Val.as_dict(t), "id")))
	if not names.is_empty():
		lines.append("targets: %s" % ", ".join(names))
	if st.has("x"):
		lines.append("X = %d" % Val.num(st, "x"))
	return "\n".join(lines)
