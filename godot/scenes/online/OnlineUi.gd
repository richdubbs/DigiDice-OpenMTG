class_name OnlineUi
## What the online screens share (the browser's online/errors.ts, table.ts, setup.tsx and the Join screen's invite reading): errors
## in words a player can act on, a 3-4 player game's words (the lobby, the seats, the forfeit clocks), the deck as the host's server
## takes it, the box that reads an address and a join code typed in any order, and the panels: the error box, the lobby's seats, a
## game already open, and how to forward the port.

## The join codes' alphabet, Crockford base32 (packages/net wire/codes.ts).
const CODE_ALPHABET: String = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


# ---- errors -------------------------------------------------------------------------------------------------------------------

## An online error as {message, hint, details}: what went wrong and what to check. `port`: the UDP port tried or chosen (-1: unknown).
static func explain(e: Dictionary, port: int = -1) -> Dictionary:
	var where := "UDP %d" % port if port >= 0 else "the game port (UDP)"
	var message := Val.text(e, "message")
	var details: Array = Val.list(e, "details")
	match Val.text(e, "code"):
		"badCode":
			return {"message": "Wrong join code: the host did not accept it.",
				"hint": "Check the code with the host (four groups of four letters and digits). A host who leaves and hosts again gets a new code."}
		"timeout":
			return {"message": "The host did not answer in time.",
				"hint": "Check the address and the port, and that the host is still on the \"Waiting for the other player\" screen. The host's router must forward %s to the host's PC, and the host's firewall must allow OpenMTG (Node.js) on that port." % where}
		"hostNotFound":
			return {"message": "That address could not be found.",
				"hint": "%s Check the address the host gave you: an IP address such as 203.0.113.7, or a name." % message}
		"version":
			return {"message": "The two OpenMTG versions do not match.",
				"hint": "%s Both players need the same OpenMTG version: update the older one, then try again." % message}
		"rulesPack":
			return {"message": "The two rules packs do not match.", "hint": "%s Both players need the same rules pack: update the older one." % message}
		"gameFull":
			if message.to_lower().contains("seat"):
				return {"message": "That seat is taken.",
					"hint": "%s Each join code admits one player: ask the host for the code of a seat that is still open." % message}
			return {"message": "The host already has another player in this game.", "hint": "Ask the host to leave and host a new game."}
		"deckRejected":
			return {"message": "The deck was refused for this game.", "hint": message, "details": details}
		"portInUse":
			return {"message": message, "hint": "Pick another port (and forward that one on the router instead), or close the program that uses it."}
		"noCardData":
			return {"message": "Hosting needs the card data on this PC.", "hint": message}
		"busy":
			return {"message": "A game is already open on this OpenMTG server.", "hint": "Return to it, or leave it first."}
		"disconnected":
			return {"message": message if message != "" else "Lost the connection.",
				"hint": "Check that OpenMTG is still running; the game waits for a short while."}
		"closed":
			return {"message": message if message != "" else "The game is closed."}
		"stale":
			return {"message": "The game moved on before that action arrived.", "hint": "Look at the board again and choose once more."}
		"notStarted":
			return {"message": "The game starts when every seat is taken." if message.to_lower().contains("every seat") else "The game starts when the other player joins."}
		"rateLimited":
			return {"message": "Too many actions at once; wait a moment."}
		"manualRejected":
			return {"message": message if message != "" else "The host did not accept your adjustments by hand."}
	return {"message": message, "details": details}


## The error in one line (message and hint).
static func line(e: Dictionary, port: int = -1) -> String:
	var x := explain(e, port)
	var hint := Val.text(x, "hint")
	return Val.text(x, "message") + (" " + hint if hint != "" else "")


# ---- a 3-4 player game's words ---------------------------------------------------------------------------------------------------

## A 3-4 player game (the status carries the table).
static func is_table(s: Dictionary) -> bool:
	return s.has("seats") or s.has("players")


## The players seated so far (open seats have taken false).
static func seated_players(s: Dictionary) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p: Variant in Val.list(s, "players"):
		var pd := Val.as_dict(p)
		if pd.get("taken", true) != false:
			out.append(pd)
	return out


static func open_seats(s: Dictionary) -> int:
	if not s.has("seats"):
		return 0
	return maxi(0, int(Val.num(s, "seats")) - seated_players(s).size())


## "Waiting for 2 more players to join… The game starts when every seat is taken."
static func waiting_text(s: Dictionary) -> String:
	var n := open_seats(s)
	if n == 0:
		return "Every seat is taken: the game is starting…"
	return "Waiting for %d more %s to join… The game starts when every seat is taken." % [n, "player" if n == 1 else "players"]


## A player's name from the status (or the view's players), "Seat n" for a seat nobody has taken yet.
static func name_of(s: Dictionary, id: String, fallback: Array = []) -> String:
	if id == "":
		return "A player"
	for p: Variant in Val.list(s, "players"):
		var pd := Val.as_dict(p)
		if Val.text(pd, "id") == id:
			if Val.text(pd, "name") != "":
				return Val.text(pd, "name")
			for f: Variant in fallback:
				var fd := Val.as_dict(f)
				if Val.text(fd, "id") == id and Val.text(fd, "name") != "":
					return Val.text(fd, "name")
			if pd.has("seat"):
				return "Seat %d" % int(Val.num(pd, "seat"))
	for f: Variant in fallback:
		var fd := Val.as_dict(f)
		if Val.text(fd, "id") == id and Val.text(fd, "name") != "":
			return Val.text(fd, "name")
	return id


## "Bob", "Bob and Carol", "Bob, Carol and Dan".
static func list_names(names: Array) -> String:
	if names.size() <= 1:
		return String(names[0]) if not names.is_empty() else ""
	var head: Array[String] = []
	for i: int in names.size() - 1:
		head.append(String(names[i]))
	return "%s and %s" % [", ".join(head), String(names.back())]


## A forfeit clock as m:ss (rounded up, never below 0:00).
static func clock_text(ms: float) -> String:
	var total := maxi(0, ceili(ms / 1000.0))
	return "%d:%02d" % [total / 60, total % 60]


## "in progress", "waiting for the other player", …
static func phase_label(s: Dictionary) -> String:
	match Val.text(s, "phase"):
		"starting":
			return "starting"
		"joining":
			return "connecting to the host"
		"waiting":
			if is_table(s):
				return "waiting for every seat to be taken" if Val.text(s, "role") == "host" else "waiting in the lobby"
			return "waiting for the other player"
		"spectating":
			return "you left it; your server runs it for the others"
		"playing":
			return "in progress"
		"reconnecting":
			return "reconnecting to the host"
		"over":
			return "the game is over"
	return Val.text(s, "phase")


## Whether a game is open at the server (not idle, not closed).
static func game_open(s: Dictionary) -> bool:
	var phase := Val.text(s, "phase")
	return phase != "idle" and phase != "closed" and phase != ""


# ---- the deck and the address ----------------------------------------------------------------------------------------------------

## The deck as the host's server takes it: names and counts of the main deck and the sideboard, and the commander and companion
## sections when the deck has them.
static func online_deck(deck: Dictionary) -> Dictionary:
	var keep := func(section: String) -> Array:
		var out: Array = []
		for e: Variant in Val.list(deck, section):
			var ed := Val.as_dict(e)
			if Val.num(ed, "count") > 0:
				out.append({"name": Val.text(ed, "name"), "count": int(Val.num(ed, "count"))})
		return out
	var out := {"main": keep.call("main"), "sideboard": keep.call("sideboard")}
	var commander: Array = keep.call("commander")
	var companion: Array = keep.call("companion")
	if not commander.is_empty():
		out["commander"] = commander
	if not companion.is_empty():
		out["companion"] = companion
	return out


## A port typed by the player: a whole number from 1 to 65535.
static func port_problem(port: int) -> String:
	return "" if port >= 1 and port <= 65535 else "The port must be a whole number from 1 to 65535."


## The port of an address ("ip:port", "[v6]:port", "name:port", or none: the default); -1 when it cannot be read.
static func address_port(address: String) -> int:
	var a := address.strip_edges()
	var m := RegEx.create_from_string("^\\[[^\\]]*\\](?::(\\d+))?$").search(a)
	if m == null:
		m = RegEx.create_from_string("^[^:\\s]*(?::(\\d+))?$").search(a)
	if m == null:
		return -1
	return Online.DEFAULT_PORT if m.get_string(1) == "" else int(m.get_string(1))


static func address_problem(address: String) -> String:
	var a := address.strip_edges()
	if a == "":
		return "Enter the host's address."
	var port := address_port(a)
	if port == -1:
		return "Write the address as ip:port, for example 203.0.113.7:47620 ([2001:db8::7]:47620 for IPv6)."
	if port < 1 or port > 65535:
		return "The port must be a whole number from 1 to 65535."
	return ""


## A typed join code in canonical form (case, spaces and dashes ignored, O read as 0, I and L as 1), or "".
static func canonical_code(input: String) -> String:
	var s := input.to_upper().replace(" ", "").replace("-", "").replace("\t", "").replace("O", "0").replace("I", "1").replace("L", "1")
	if s.length() != 16:
		return ""
	for ch: String in s:
		if not CODE_ALPHABET.contains(ch):
			return ""
	return s


## What the Join box holds: the host's address and the join code, typed or pasted together in any order, with words such as "IP:"
## or "code" around them. {"address": String ("" none), "code": "XXXX-XXXX-XXXX-XXXX" ("" none)}.
static func read_invite(text: String) -> Dictionary:
	var words: Array[String] = []
	for w: String in RegEx.create_from_string("[\\s,;]+").sub(text, " ", true).split(" ", false):
		words.append(w)
	var address_like := RegEx.create_from_string("[.:\\[\\]]")
	var strict_group := RegEx.create_from_string("^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}$")
	var used := {}
	var code := ""
	for strict: bool in [true, false]:
		for n: int in range(1, 5):
			if code != "":
				break
			for i: int in range(0, words.size() - n + 1):
				if code != "":
					break
				var run := words.slice(i, i + n)
				var skip := false
				for w: String in run:
					if address_like.search(w) != null:
						skip = true
				if not skip and strict and n > 1:
					for w: String in run:
						if strict_group.search(w) == null:
							skip = true
				if skip:
					continue
				code = canonical_code("".join(run))
				if code != "":
					for k: int in range(i, i + n):
						used[k] = true
	var rest: Array[String] = []
	for i: int in words.size():
		if not used.has(i) and not words[i].ends_with(":"):
			rest.append(words[i])
	var candidates: Array[String] = []
	for w: String in rest:
		if address_like.search(w) != null:
			candidates.append(w)
	var address := ""
	for w: String in candidates:
		if address_problem(w) == "":
			address = w
			break
	if address == "" and not candidates.is_empty():
		address = candidates[0]
	var port := ""
	for w: String in rest:
		if RegEx.create_from_string("^\\d{1,5}$").search(w) != null:
			port = w
			break
	if address != "" and port != "" and RegEx.create_from_string("(^[^:]*|\\]):\\d+$").search(address) == null:
		address = "%s:%s" % [address, port]
	var grouped := ""
	if code != "":
		grouped = "%s-%s-%s-%s" % [code.substr(0, 4), code.substr(4, 4), code.substr(8, 4), code.substr(12, 4)]
	return {"address": address, "code": grouped}


## Why the Join box cannot be joined with yet, or "".
static func invite_problem(text: String, invite: Dictionary) -> String:
	if text.strip_edges() == "":
		return "Enter the host's address and the join code."
	if Val.text(invite, "address") == "":
		return "Add the host's address to the box: their IP address and port, like 203.0.113.7:47620."
	var bad := address_problem(Val.text(invite, "address"))
	if bad != "":
		return bad
	if Val.text(invite, "code") == "":
		return "Add the join code the host gave you (16 letters and digits, like XXXX-XXXX-XXXX-XXXX)."
	return ""


# ---- panels -----------------------------------------------------------------------------------------------------------------------

## An error in a box: its message in bold, what to do, the details listed (ui.error).
static func error_box(x: Dictionary) -> Control:
	var p := _box(NeonTheme.colors()[1])
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	p.add_child(col)
	var head := Hud.text(Val.text(x, "message"), 15, Hud.TEXT)
	head.add_theme_font_override("font", Hud.bold_font())
	col.add_child(head)
	if Val.text(x, "hint") != "":
		col.add_child(Hud.text(Val.text(x, "hint"), 14))
	for d: Variant in Val.list(x, "details"):
		col.add_child(Hud.text("• %s" % String(d), 13))
	Sound.cue("ui.error")
	return p


static func _box(edge: Color) -> PanelContainer:
	var p := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(edge, 0.08)
	s.set_border_width_all(1)
	s.border_color = Color(edge, 0.7)
	s.set_corner_radius_all(8)
	s.set_content_margin_all(12)
	p.add_theme_stylebox_override("panel", s)
	return p


## Who sits at the table in the lobby: each seat, its player or "open", and a link that is down.
static func lobby_seats(s: Dictionary) -> Control:
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	var players := Val.list(s, "players")
	var seats := int(Val.num(s, "seats", players.size()))
	var me := Val.text(s, "me")
	for seat: int in range(1, seats + 1):
		var who := {}
		for p: Variant in players:
			var pd := Val.as_dict(p)
			if int(Val.num(pd, "seat")) == seat and pd.get("taken", true) != false:
				who = pd
		var text := "open"
		if not who.is_empty():
			var id := Val.text(who, "id")
			text = Val.text(who, "name")
			if id == me:
				text += " (you, the host)" if seat == 1 else " (you)"
			elif seat == 1:
				text += " (the host)"
			if not Val.flag(who, "connected"):
				text += " (link down)"
		var row := HBoxContainer.new()
		var b := Hud.text("Seat %d" % seat, 14, Hud.TEXT)
		b.add_theme_font_override("font", Hud.bold_font())
		b.autowrap_mode = TextServer.AUTOWRAP_OFF
		row.add_child(b)
		var t := Hud.text(text, 14, Hud.MUTED if who.is_empty() else Hud.TEXT)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(t)
		col.add_child(row)
	return col


## How a host makes the game reachable: forward the UDP port, find the public address, allow the firewall. OpenMTG never asks an
## IP-lookup service by itself.
static func port_help(port: int, players: int = 2) -> Control:
	var many := players > 2
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	var head := Hud.kicker("How the other players reach you (port forwarding)" if many else "How the other player reaches you (port forwarding)")
	col.add_child(head)
	var steps := [
		"1. Forward UDP port %d on your router to this PC. Open your router's settings page (often http://192.168.0.1 or http://192.168.1.1; the address is on the router's label), find \"Port forwarding\" (also called \"Virtual server\" or \"NAT\"), and add a rule: protocol UDP, external port %d, internal port %d, to this PC's local address (shown by ipconfig in a Command Prompt as \"IPv4 Address\", for example 192.168.1.23)." % [port, port, port],
		"2. Find your public IP address. Your router's status page shows it as the WAN or Internet address; a web search for \"what is my IP\" shows it too. OpenMTG does not look it up by itself. %s that address with the port, for example 203.0.113.7:%d, and %s." % [
			"Give each other player" if many else "Give the other player", port, "the join code of their own seat" if many else "the join code"],
		"3. Allow OpenMTG through the Windows firewall. The first time you host, Windows may ask whether Node.js may use the network: choose Allow (private networks are enough at home). If you closed that window, allow Node.js for UDP port %d under Windows Security, Firewall & network protection, Allow an app through firewall." % port,
	]
	for s: String in steps:
		col.add_child(Hud.text(s, 13))
	col.add_child(Hud.text("Only the player who hosts needs this; the players who join need nothing forwarded. Every message is encrypted with a key that comes from the join code of that player's seat, and nothing without a code gets in. When you stop hosting, the port closes again (you can remove the router rule too)." if many else "Only the player who hosts needs this; the player who joins needs nothing forwarded. Every message is encrypted with a key that comes from the join code, and nothing without the code gets in. When you stop hosting, the port closes again (you can remove the router rule too).", 13))
	return col
