extends Node
## The errors this app caught, for a bug report (the browser client's bugs/errors.ts): the engine's and the scripts' errors as Godot
## reports them, newest last, at most KEEP. Godot reports them from any thread, so the list is guarded.

const KEEP: int = 50

var _list: Array[Dictionary] = []
var _lock := Mutex.new()


func _init() -> void:
	OS.add_logger(Catcher.new(self))


## The errors caught so far: {message, stack?, time}.
func recent() -> Array[Dictionary]:
	_lock.lock()
	var out := _list.duplicate(true)
	_lock.unlock()
	return out


func add(message: String, stack: String) -> void:
	var e := {"message": message.strip_edges().left(1000), "time": Time.get_datetime_string_from_system(true) + "Z"}
	if stack != "":
		e["stack"] = stack.left(4000)
	_lock.lock()
	_list.append(e)
	if _list.size() > KEEP:
		_list.remove_at(0)
	_lock.unlock()


class Catcher:
	extends Logger

	var _to: WeakRef = null

	func _init(to: Node) -> void:
		_to = weakref(to)

	func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, _error_type: int,
			script_backtraces: Array[ScriptBacktrace]) -> void:
		var to: Node = _to.get_ref()
		if to == null:
			return
		var stack := ""
		for b: ScriptBacktrace in script_backtraces:
			stack += b.format()
		to.call("add", rationale if rationale != "" else code, stack if stack != "" else "%s (%s:%d)" % [function, file, line])
