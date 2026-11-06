class_name TableArrows
extends Node2D
## Arrows across the table (packages/client/src/board/fx/TargetArrows.tsx, arena.css), drawn under the cards: from the spell or
## ability on top of the stack to what it targets (CR 115.1, 601.2c), and from the stack object pointed at; from the spell being
## cast to the targets picked so far and to the pointer while the viewer chooses targets; from each attacker to what it attacks
## and from each blocker to the attacker it blocks (CR 508.1, 509.1); attackers picked but not declared yet to their target. An
## arrow leaves its source's edge and stops at its target's, bowed a little, its dashes running toward the target; it fades
## while the animator plays a change (the cards then show what happens).

const COLORS: Dictionary = {
	"target": Color("#ff5a7a"), "focus": Color("#ff5a7a"), "choose": Color("#5fd2ff"), "pointer": Color("#5fd2ff"),
	"attack": Color("#ff8a3c"), "block": Color("#7fb0ff"),
}
const DASH: float = 12.0
const GAP: float = 8.0
## The dashes run one pattern (20 px) every 0.7 s (arrow-flow).
const FLOW_S: float = 0.7
## The longest arrow drawn (a board is a few thousand pixels across).
const MAX_LENGTH: float = 8000.0

## The table (its `rect_of(id)`, `animating()`, `hovered_id`, `focus_stack`).
var table: Node = null
var _t: float = 0.0
var _alpha: float = 1.0


func _process(delta: float) -> void:
	_t += delta
	var busy := table != null and bool(table.call("animating"))
	_alpha = move_toward(_alpha, 0.0 if busy else 1.0, delta / 0.16)
	queue_redraw()


## The arrows to draw now: [{from: Rect2, to: Rect2 or null (the pointer), kind}].
func _specs() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var view := GameClient.view
	if view.is_empty() or table == null:
		return out
	var pending := View.pending(view)
	var mine := not pending.is_empty() and Val.text(pending, "player") == View.viewer(view) and View.viewer(view) != ""
	var choosing := mine and Val.text(pending, "kind") == "chooseTargets"
	var sel: BoardSelection = GameClient.selection
	var stack := View.stack(view)
	var top := String(stack[stack.size() - 1]) if not stack.is_empty() else ""
	var focus := String(table.get("focus_stack"))
	if top != "":
		if choosing and sel != null:
			for id: Variant in sel.selected.keys():
				out.append({"from": top, "to": String(id), "kind": "choose"})
			if sel.selected.size() < int(Val.num(pending, "max")):
				out.append({"from": top, "to": "", "kind": "pointer"})
		else:
			for t: String in _targets(view, top):
				out.append({"from": top, "to": t, "kind": "focus" if focus == top else "target"})
	if focus != "" and focus != top:
		for t: String in _targets(view, focus):
			out.append({"from": focus, "to": t, "kind": "focus"})
	var c := View.combat(view)
	var attackers: Array = Val.list(c, "attackers")
	if not attackers.is_empty():
		for a: Variant in attackers:
			var ad := Val.as_dict(a)
			# A blocked attacker points at its blockers through their block arrows, not at the defender (CR 509.1h).
			if Val.text(ad, "defender") != "" and not Val.flag(ad, "blocked"):
				out.append({"from": Val.text(ad, "id"), "to": Val.text(ad, "defender"), "kind": "attack"})
		for b: Variant in Val.list(c, "blockers"):
			var bd := Val.as_dict(b)
			for at: Variant in Val.list(bd, "blocking"):
				out.append({"from": Val.text(bd, "id"), "to": String(at), "kind": "block"})
	elif mine and Val.text(pending, "kind") == "declareAttackers" and sel != null:
		var opponents: Array[String] = []
		for p: Dictionary in View.players(view):
			if Val.text(p, "id") != View.viewer(view) and not Val.flag(p, "hasLost"):
				opponents.append(Val.text(p, "id"))
		var picked: Dictionary = Val.as_dict(table.get("attack_targets"))
		for id: Variant in sel.selected.keys():
			var target := Val.text(picked, String(id))
			if target == "" and opponents.size() == 1:
				target = opponents[0]
			if target != "":
				out.append({"from": String(id), "to": target, "kind": "attack"})
	return out


static func _targets(view: Dictionary, id: String) -> Array[String]:
	var out: Array[String] = []
	var st := Val.dict(View.object(view, id), "stack")
	for group: Variant in Val.list(st, "targets"):
		for t: Variant in Val.as_list(group):
			var tid := Val.text(Val.as_dict(t), "id")
			if tid != "":
				out.append(tid)
	return out


func _draw() -> void:
	if _alpha <= 0.01 or table == null:
		return
	for s: Dictionary in _specs():
		var from: Rect2 = table.call("rect_of", String(s["from"]))
		if from.size == Vector2.ZERO:
			continue
		var kind := String(s["kind"])
		var to_rect := Rect2()
		var to_point := Vector2.ZERO
		if String(s["to"]) == "":
			var hovered := String(table.get("hovered_id"))
			var sel: BoardSelection = GameClient.selection
			if hovered != "" and sel != null and sel.can_select(hovered):
				to_rect = table.call("rect_of", hovered)
			if to_rect.size == Vector2.ZERO:
				to_point = get_global_mouse_position()
		else:
			to_rect = table.call("rect_of", String(s["to"]))
			if to_rect.size == Vector2.ZERO:
				continue
		_arrow(_local(from), _local(to_rect) if to_rect.size != Vector2.ZERO else Rect2(), to_local(to_point), kind)


func _local(r: Rect2) -> Rect2:
	return Rect2(to_local(r.position), r.size)


## One arrow (TargetArrows.tsx arrowPath): out of the source's edge, into the target's edge (or to the pointer), bowed.
func _arrow(fr: Rect2, to_rect: Rect2, to_point: Vector2, kind: String) -> void:
	var s := fr.get_center()
	var t := to_rect.get_center() if to_rect.size != Vector2.ZERO else to_point
	s = _clip(fr, t, s, 4.0)
	if to_rect.size != Vector2.ZERO:
		t = _clip(to_rect, s, t, 10.0)
	var len := s.distance_to(t)
	# An end the layout has not placed yet (a point at infinity, on a table just opened) draws nothing.
	if not is_finite(len) or len < 8.0 or len > MAX_LENGTH:
		return
	var mid := (s + t) / 2.0
	var bow := minf(90.0, len * 0.22)
	var ctrl := Vector2(mid.x + ((s.y - t.y) / len) * bow * (1.0 if t.x > s.x else -1.0) * 0.5, mid.y - bow * 0.6)
	var pts := PackedVector2Array()
	var n := 28
	for i: int in n + 1:
		var k := float(i) / n
		pts.append(s.lerp(ctrl, k).lerp(ctrl.lerp(t, k), k))
	var color: Color = COLORS.get(kind, Color.WHITE)
	var a := _alpha * (0.75 if kind == "target" else 1.0)
	draw_polyline(pts, Color(color, 0.22 * _alpha), 11.0, true)
	var pattern := Vector2(6.0, 8.0) if kind == "pointer" else Vector2(DASH, GAP)
	var period := pattern.x + pattern.y
	var offset := fmod(_t / FLOW_S * period, period)
	_dashes(pts, pattern, period - offset, Color(color, a), 3.0)
	# The head.
	var dir := (pts[n] - pts[n - 1]).normalized()
	var side := Vector2(-dir.y, dir.x)
	var tip := t
	draw_colored_polygon(PackedVector2Array([tip + dir * 4.0, tip - dir * 10.0 + side * 7.0, tip - dir * 10.0 - side * 7.0]), Color(color, a))


## Dashes along a polyline: `pattern` = (on, off), starting `phase` px into it. The position in the pattern is kept within one
## period, and every step moves on, so the loop always ends.
func _dashes(pts: PackedVector2Array, pattern: Vector2, phase: float, color: Color, width: float) -> void:
	var period := pattern.x + pattern.y
	var pos := fposmod(-phase, period)
	for i: int in range(1, pts.size()):
		var a := pts[i - 1]
		var b := pts[i]
		var seg := a.distance_to(b)
		if not is_finite(seg) or seg > MAX_LENGTH:
			return
		var along := 0.0
		while along < seg:
			var in_period := fposmod(pos + along, period)
			var step := 0.0
			if in_period < pattern.x:
				step = minf(pattern.x - in_period, seg - along)
				draw_line(a.lerp(b, along / seg), a.lerp(b, (along + step) / seg), color, width, true)
			else:
				step = minf(period - in_period, seg - along)
			along += maxf(step, 0.05)
		pos = fposmod(pos + seg, period)


## Where the line from `toward` meets the edge of `r` (padded), or `fallback` when it does not leave the box.
static func _clip(r: Rect2, toward: Vector2, fallback: Vector2, pad: float) -> Vector2:
	var hw := r.size.x / 2.0 + pad
	var hh := r.size.y / 2.0 + pad
	var c := r.get_center()
	var d := toward - c
	var k := minf(hw / maxf(1e-6, absf(d.x)), hh / maxf(1e-6, absf(d.y)))
	return c + d * k if k < 1.0 else fallback
