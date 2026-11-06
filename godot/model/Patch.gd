class_name Patch
extends RefCounted
## View patches: a faithful port of `applyPatch`, `applyViewPatch`, `nextView` and `jsonEqual` from the TypeScript source's
## packages/engine/src/core/view-patch.ts (RPL-0). The server sends a full `view` on attach and after a gap, and otherwise a
## `patch` against the view this client holds.
##
## The contract, as in the TypeScript:
## - `apply(base, ops)` never changes `base`: it copies the containers on the paths it changes (once each) and shares the rest.
## - Every op is checked; an op that does not fit (a missing path, a wrong type, a bad index) is a PatchError. TypeScript throws;
##   here the error comes back as `{"ok": false, "error": text}` and the caller asks for a full view (`attach`).
## - Applying is bounded work (PATCH_MAX_WORK): every entry of a copied container, every element a splice inserts, removes or
##   moves, every key reordered and every op counts, and the patch is refused before it does work past the bound.
## - JSON key order is part of "exactly". Godot Dictionaries keep insertion order, as JavaScript objects do, except that
##   JavaScript puts "array index" keys ("0", "17", never "01") first, in ascending order. `_set_key` and the `keys` op follow
##   that rule, so the result has the key order the server's view has.
##
## Differences that cannot matter: JavaScript's `undefined` does not exist in JSON (so the "present but undefined key" case is
## gone), and JSON numbers arrive as floats here, so an index segment may be a float with no fraction (3.0 is index 3).
## The diff side (`diffJson`) stays in the TypeScript source: the client only applies.

const PATCH_MAX_WORK: int = 250000


## Apply `ops` (a parsed JSON list of PatchOp) to `base`. Returns {"ok": true, "value": result} or {"ok": false, "error": text}.
static func apply(base: Variant, ops: Variant, max_work: int = PATCH_MAX_WORK) -> Dictionary:
	var run := Applier.new(base, max_work)
	run.apply_all(ops)
	if run.error != "":
		return {"ok": false, "error": run.error}
	return {"ok": true, "value": run.root}


## Apply a view patch to this seat's previous view (the same as `apply`, named as in the TypeScript).
static func apply_view_patch(prev: Dictionary, ops: Variant, max_work: int = PATCH_MAX_WORK) -> Dictionary:
	return apply(prev, ops, max_work)


## The client's step for a `patch` message (port of `nextView`). `current` is {"seq": int, "view": Dictionary}, or {} when no
## view is held; `msg` holds `seq`, `base` and `ops`. Returns {"seq": int, "view": Dictionary}, or {} when the patch's base is not
## the view held, the patch does not fit, or the result is not a view of the same seat. On {} the client asks for a full view.
static func next_view(current: Dictionary, msg: Dictionary) -> Dictionary:
	if current.is_empty():
		return {}
	var held_seq: int = Val.num(current, "seq", -1)
	var seq: int = Val.num(msg, "seq", -1)
	var base: int = Val.num(msg, "base", -2)
	if held_seq != base or not (seq > base):
		return {}
	var held: Dictionary = Val.dict(current, "view")
	var r := apply_view_patch(held, msg.get("ops"))
	if not Val.flag(r, "ok"):
		return {}
	var value: Variant = r.get("value")
	if not (value is Dictionary):
		return {}
	var view: Dictionary = value
	# The same viewer: `viewer` present in both or in neither, with the same value (null is a spectator).
	if view.has("viewer") != held.has("viewer") or not Val.same(view.get("viewer"), held.get("viewer")):
		return {}
	return {"seq": seq, "view": view}


## JSON equality. With `ordered` (the default) object key order counts, as in the TypeScript `jsonEqual`; numbers compare by
## value (3 equals 3.0, since JSON numbers arrive as floats).
static func json_equal(a: Variant, b: Variant, ordered: bool = true) -> bool:
	if a is Array:
		if not (b is Array):
			return false
		var la: Array = a
		var lb: Array = b
		if la.size() != lb.size():
			return false
		for i: int in range(la.size()):
			if not json_equal(la[i], lb[i], ordered):
				return false
		return true
	if a is Dictionary:
		if not (b is Dictionary):
			return false
		var da: Dictionary = a
		var db: Dictionary = b
		if da.size() != db.size():
			return false
		var ka: Array = da.keys()
		if ordered:
			var kb: Array = db.keys()
			for i: int in range(ka.size()):
				if not Val.same(ka[i], kb[i]):
					return false
		for k: Variant in ka:
			if not db.has(k):
				return false
			if not json_equal(da[k], db[k], ordered):
				return false
		return true
	if b is Array or b is Dictionary:
		return false
	return Val.same(a, b)


## A path segment that is an array index: a non-negative whole number (an int, or a float with no fraction).
static func is_index(x: Variant) -> bool:
	if x is int:
		return int(x) >= 0
	if x is float:
		var f: float = x
		return is_finite(f) and f >= 0.0 and f == floorf(f) and f < 9007199254740992.0
	return false


## A key JavaScript treats as an array index (canonical decimal of 0 .. 2^32 - 2): such keys come first in an object's key order.
static func is_array_index_key(k: String) -> bool:
	var n := k.length()
	if n == 0 or n > 10:
		return false
	if n > 1 and k.unicode_at(0) == 48: # a leading "0"
		return false
	for i: int in range(n):
		var c := k.unicode_at(i)
		if c < 48 or c > 57:
			return false
	return k.to_int() < 4294967295


## The order JavaScript gives an object whose keys were inserted in this order: array-index keys first (ascending), then the
## others in insertion order.
static func js_order(keys: Array) -> Array:
	var ints: Array = []
	var others: Array = []
	for k: Variant in keys:
		if k is String and is_array_index_key(k):
			ints.append(k)
		else:
			others.append(k)
	ints.sort_custom(func(x: Variant, y: Variant) -> bool: return String(x).to_int() < String(y).to_int())
	return ints + others


## Set a key the way JavaScript's `Object.defineProperty` does: an existing key keeps its place; a new key goes last, unless
## it is an array index, which takes its place among the leading index keys.
static func _set_key(d: Dictionary, k: String, value: Variant) -> void:
	if d.has(k) or not is_array_index_key(k):
		d[k] = value
		return
	var order: Array = d.keys()
	order.append(k)
	_rebuild(d, js_order(order), {k: value})


## Re-insert the keys of `d` in `order` (in place; `extra` supplies values for keys `d` does not hold yet).
static func _rebuild(d: Dictionary, order: Array, extra: Dictionary) -> void:
	var values: Dictionary = {}
	for k: Variant in order:
		values[k] = extra[k] if extra.has(k) else d[k]
	d.clear()
	for k: Variant in order:
		d[k] = values[k]


static func _path_text(path: Array) -> String:
	return JSON.stringify(path)


## One application of a patch. `root` is the result so far. Which containers were copied (and so may be changed in place) is
## kept in a tree of markers that mirrors the paths: the TypeScript keeps a Set of copied objects by identity, and Godot has no
## identity key for Arrays and Dictionaries. The markers stay exact because every op that replaces, removes or moves an element
## drops or shifts the marker at that place (a replaced value is not a copy and is copied before it is changed, as in the
## TypeScript), so the work counted is the same.
class Applier:
	extends RefCounted

	var root: Variant
	var max_work: int
	var work: int = 0
	var error: String = ""
	var root_copied: bool = false
	## Markers of the copied containers under the root: segment (String key or int index) -> the child's markers.
	var root_marks: Dictionary = {}
	## The markers of the container the last `container` call returned.
	var last_marks: Dictionary = {}

	func _init(base: Variant, bound: int) -> void:
		root = base
		max_work = bound

	## Count `n` units of work; false (with the error set) once they pass the bound.
	func spend(n: int) -> bool:
		work += n
		if work > max_work:
			error = "The patch takes more work than %d (a view's entries copied, inserted, moved or reordered)." % max_work
			return false
		return true

	## A shallow copy of a container, counted as its size plus one; null when the bound is passed.
	func copy(x: Variant) -> Variant:
		if x is Array:
			var a: Array = x
			if not spend(a.size() + 1):
				return null
			return a.duplicate(false)
		var d: Dictionary = x
		if not spend(d.size() + 1):
			return null
		return d.duplicate(false)

	## The container at the first `n` segments of `path`, copied (once) so that it may be changed; null with `error` set when
	## the path does not fit. Leaves that container's markers in `last_marks`.
	func container(path: Array, n: int) -> Variant:
		if not (root is Dictionary or root is Array):
			error = "The patch goes into a value that is not an object or a list."
			return null
		if not root_copied:
			var c: Variant = copy(root)
			if error != "":
				return null
			root = c
			root_copied = true
			root_marks = {}
		var cur: Variant = root
		var marks: Dictionary = root_marks
		for i: int in range(n):
			var seg: Variant = path[i]
			var key: Variant
			var next: Variant
			if cur is Array:
				var arr: Array = cur
				if not Patch.is_index(seg) or int(seg) >= arr.size():
					error = "No element %s at %s." % [str(seg), Patch._path_text(path.slice(0, i))]
					return null
				key = int(seg)
				next = arr[key]
			else:
				var obj: Dictionary = cur
				if not (seg is String) or not obj.has(seg):
					error = "No key %s at %s." % [JSON.stringify(seg), Patch._path_text(path.slice(0, i))]
					return null
				key = seg
				next = obj[seg]
			if not (next is Dictionary or next is Array):
				error = "%s is not an object or a list." % Patch._path_text(path.slice(0, i + 1))
				return null
			var child: Dictionary
			if marks.has(key):
				child = marks[key]
			else:
				next = copy(next)
				if error != "":
					return null
				cur[key] = next
				child = {}
				marks[key] = child
			cur = next
			marks = child
		last_marks = marks
		return cur

	func apply_all(ops: Variant) -> void:
		if not (ops is Array):
			error = "The patch is not a list of operations."
			return
		for raw: Variant in ops:
			if not (raw is Dictionary):
				error = "A patch operation is not an object."
				return
			var op: Dictionary = raw
			var path_v: Variant = op.get("path")
			if not (path_v is Array):
				error = "A patch path is not a list."
				return
			var path: Array = path_v
			for seg: Variant in path:
				if not (seg is String) and not Patch.is_index(seg):
					error = "A patch path segment is neither a key nor an index."
					return
			if not spend(1 + path.size()):
				return
			var kind: String = Val.as_text(op.get("op"), "")
			match kind:
				"set":
					_op_set(op, path)
				"del":
					_op_del(path)
				"splice":
					_op_splice(op, path)
				"keys":
					_op_keys(op, path)
				_:
					error = "Unknown patch operation %s." % JSON.stringify(op.get("op"))
			if error != "":
				return

	func _op_set(op: Dictionary, path: Array) -> void:
		if not op.has("value"):
			error = "A set operation has no value."
			return
		var value: Variant = op["value"]
		if path.is_empty():
			root = value
			root_copied = false
			root_marks = {}
			return
		var c: Variant = container(path, path.size() - 1)
		if error != "":
			return
		var k: Variant = path[path.size() - 1]
		if c is Array:
			var arr: Array = c
			if not Patch.is_index(k) or int(k) >= arr.size():
				error = "No element %s to set at %s." % [str(k), Patch._path_text(path)]
				return
			arr[int(k)] = value
			last_marks.erase(int(k))
		else:
			if not (k is String):
				error = "An index into an object at %s." % Patch._path_text(path)
				return
			var obj: Dictionary = c
			Patch._set_key(obj, k, value)
			last_marks.erase(k)

	func _op_del(path: Array) -> void:
		if path.is_empty():
			error = "A delete operation without a key."
			return
		var c: Variant = container(path, path.size() - 1)
		if error != "":
			return
		var k: Variant = path[path.size() - 1]
		if c is Array or not (k is String):
			error = "No key to delete at %s." % Patch._path_text(path)
			return
		var obj: Dictionary = c
		if not obj.has(k):
			error = "No key to delete at %s." % Patch._path_text(path)
			return
		obj.erase(k)
		last_marks.erase(k)

	func _op_splice(op: Dictionary, path: Array) -> void:
		var c: Variant = container(path, path.size())
		if error != "":
			return
		if not (c is Array):
			error = "%s is not a list." % Patch._path_text(path)
			return
		var arr: Array = c
		var at_v: Variant = op.get("at")
		var del_v: Variant = op.get("del")
		var add_v: Variant = op.get("add")
		if not Patch.is_index(at_v) or not Patch.is_index(del_v) or not (add_v is Array):
			error = "A splice that does not fit the list at %s." % Patch._path_text(path)
			return
		var at: int = int(at_v)
		var del: int = int(del_v)
		var add: Array = add_v
		if at > arr.size() or del > arr.size() - at:
			error = "A splice that does not fit the list at %s." % Patch._path_text(path)
			return
		# The elements after the change move unless as many are inserted as removed.
		var moved: int = 0 if del == add.size() else arr.size() - at - del
		if not spend(del + add.size() + moved):
			return
		var tail: Array = arr.slice(at + del)
		arr.resize(at)
		arr.append_array(add)
		arr.append_array(tail)
		# The markers follow their elements: removed ones go, later ones shift by the change in length.
		var shifted: Dictionary = {}
		for key: Variant in last_marks.keys():
			var idx: int = int(key)
			if idx < at:
				shifted[idx] = last_marks[key]
			elif idx >= at + del:
				shifted[idx - del + add.size()] = last_marks[key]
		last_marks.clear()
		last_marks.merge(shifted)

	func _op_keys(op: Dictionary, path: Array) -> void:
		var c: Variant = container(path, path.size())
		if error != "":
			return
		if c is Array:
			error = "%s is not an object." % Patch._path_text(path)
			return
		var obj: Dictionary = c
		var keys_v: Variant = op.get("keys")
		if not (keys_v is Array):
			error = "A key order that does not fit the object at %s." % Patch._path_text(path)
			return
		var keys: Array = keys_v
		var seen: Dictionary = {}
		var fits: bool = keys.size() == obj.size()
		if fits:
			for k: Variant in keys:
				if not (k is String) or not obj.has(k) or seen.has(k):
					fits = false
					break
				seen[k] = true
		if not fits:
			error = "A key order that does not fit the object at %s." % Patch._path_text(path)
			return
		if not spend(keys.size()):
			return
		Patch._rebuild(obj, Patch.js_order(keys), {})
