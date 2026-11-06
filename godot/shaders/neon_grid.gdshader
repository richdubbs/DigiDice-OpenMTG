// The Neon Grid backdrop: a floor of perspective grid lines drifting toward a horizon glow.
// Two colours come from the theme (Settings / NeonTheme): `neon` for the near lines, `neon2` for the horizon and far lines.
// Cheap on purpose: one fwidth per pixel, no textures, no loops. Drawn on a full-screen ColorRect (scenes/Backdrop.tscn).
shader_type canvas_item;

uniform vec4 neon : source_color = vec4(0.121569, 0.721569, 1.0, 1.0);
uniform vec4 neon2 : source_color = vec4(0.960784, 0.0, 0.960784, 1.0);
uniform vec4 base_color : source_color = vec4(0.0196, 0.0431, 0.0941, 1.0);
// Where the horizon sits, as a fraction of the height from the top.
uniform float horizon : hint_range(0.1, 0.9) = 0.42;
// Grid cells per screen width at the bottom edge.
uniform float cells = 9.0;
// How far the grid has drifted toward the viewer, in cells (Backdrop.scroll_now(): 0.35 cells a second, the same on every
// screen, so the floor does not jump between screens and Home's light cycles stay on its lines).
uniform float scroll = 0.0;
// Screen width over height (set by Backdrop.gd).
uniform float aspect = 1.7778;
uniform float strength : hint_range(0.0, 1.0) = 0.8;

void fragment() {
	vec2 uv = UV;
	float d = uv.y - horizon;
	vec3 col = base_color.rgb;
	// The sky: dark at the top, warming toward the horizon in the second colour.
	float sky = clamp(1.0 + d / horizon, 0.0, 1.0);
	col += neon2.rgb * 0.10 * sky * sky;
	if (d > 0.0) {
		// The floor: depth grows toward the horizon (1 / distance below it).
		float floor_h = 1.0 - horizon;
		float depth = floor_h / max(d, 0.0015);
		vec2 world = vec2((uv.x - 0.5) * aspect * 0.5625 * cells * depth, depth * cells * 0.35 + scroll);
		vec2 w = max(fwidth(world), vec2(1e-4));
		vec2 g = abs(fract(world - 0.5) - 0.5) / w;
		float line = 1.0 - min(min(g.x, g.y), 1.0);
		// Lines fade into the haze near the horizon and get the second colour far away.
		float near = clamp(d / floor_h, 0.0, 1.0);
		float fade = smoothstep(0.0, 0.35, near);
		vec3 lc = mix(neon2.rgb, neon.rgb, smoothstep(0.05, 0.6, near));
		col = mix(col, lc, line * fade * strength);
		col += lc * line * fade * 0.25 * strength;
	}
	// The horizon glow.
	float glow = exp(-abs(d) * 28.0);
	col += neon2.rgb * glow * 0.55 * strength;
	col += neon.rgb * exp(-abs(d) * 90.0) * 0.35 * strength;
	// A soft vignette.
	vec2 c = uv - 0.5;
	col *= 1.0 - dot(c, c) * 0.55;
	COLOR = vec4(col, 1.0);
}
