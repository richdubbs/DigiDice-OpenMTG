/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1 "The camera follows the mouse"): the camera's math and rig with a fake clock: the limits (yaw ±14°, pitch
 * 24-46°, zoom 0.8-1.6x), the dead zone in the middle third, the critically damped ease of about 250 ms that never overshoots, holding still while
 * dragging / animating / a zoom is open, reduced motion, zoom around the pointer, recentre, F, the compact-face threshold and the measured fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  CAMERA_LIMITS, COMPACT_BELOW, CameraRig, FULL_ABOVE, PERF_SAMPLES, REST_PITCH, REST_POSE, SETTLE_MS, cameraHeld, cameraPerfMode, cameraTransforms, clampPose,
  deadZone, followOffsets, nextCompact, projectPoint, projectRect, projectedWidth, springStep, tableGeometry,
} from '../../src/board/table/camera';

/** Runs the rig on a fake 60 Hz clock for `ms`; returns the poses frame by frame. */
function run(rig: CameraRig, ms: number, held = false) {
  const poses = [];
  for (let t = 0; t < ms; t += 16) {
    rig.step(16, held);
    poses.push({ ...rig.pose });
  }
  return poses;
}

describe('the limits (5.1)', () => {
  it('clamps yaw to ±14°, pitch to 24-46°, zoom to 0.8-1.6x', () => {
    expect(clampPose({ yaw: 40, pitch: 90, zoom: 5, panX: 3, panY: -3 })).toEqual({ yaw: 14, pitch: 46, zoom: 1.6, panX: CAMERA_LIMITS.panX, panY: -CAMERA_LIMITS.panY });
    expect(clampPose({ yaw: -40, pitch: 0, zoom: 0.1, panX: 0, panY: 0 })).toMatchObject({ yaw: -14, pitch: 24, zoom: 0.8 });
  });

  it('the middle third of the table is a dead zone; the edges reach the full turn', () => {
    expect(deadZone(0)).toBe(0);
    expect(deadZone(0.33)).toBe(0);
    expect(deadZone(-1 / 3)).toBe(0);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
    expect(deadZone(2 / 3)).toBeCloseTo(0.5);
    expect(deadZone(Number.NaN)).toBe(0);
  });

  it('the pointer at the corners asks for the limits: right turns right, up looks across (24°), down looks at the near side (46°)', () => {
    const up = followOffsets(1, -1);
    expect(REST_PITCH + up.pitch).toBe(CAMERA_LIMITS.pitchMin);
    expect(up.yaw).toBe(CAMERA_LIMITS.yaw);
    expect(up.panX).toBeLessThan(0);
    expect(up.panY).toBeGreaterThan(0);
    const down = followOffsets(-1, 1);
    expect(REST_PITCH + down.pitch).toBe(CAMERA_LIMITS.pitchMax);
    expect(down.yaw).toBe(-CAMERA_LIMITS.yaw);
    expect(followOffsets(0.2, -0.3)).toEqual({ yaw: 0, pitch: 0, panX: -0, panY: -0 });
  });
});

describe('the ease: critically damped, about 250 ms, never overshoots', () => {
  it('a spring step never crosses its target, even from a fast start', () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 100; i++) {
      [x, v] = springStep(x, v, 10, 0.016);
      expect(x).toBeLessThanOrEqual(10);
    }
    [x, v] = springStep(0, 5000, 10, 0.05);
    expect(x).toBeLessThanOrEqual(10);
  });

  it('the rig reaches the pointer target within 2% in about 250 ms and stays there, without passing it', () => {
    const rig = new CameraRig();
    rig.pointer(1, 0);
    const poses = run(rig, 600);
    const target = CAMERA_LIMITS.yaw;
    expect(Math.max(...poses.map((p) => p.yaw))).toBeLessThanOrEqual(target);
    const settledAt = poses.findIndex((p) => Math.abs(p.yaw - target) <= target * 0.02) * 16;
    expect(settledAt).toBeGreaterThan(SETTLE_MS * 0.6);
    expect(settledAt).toBeLessThanOrEqual(SETTLE_MS * 1.2);
    expect(rig.settled()).toBe(true);
    expect(rig.pose.yaw).toBe(target);
  });

  it('within the dead zone the camera stays exactly where it is', () => {
    const rig = new CameraRig();
    rig.pointer(0.3, -0.3);
    run(rig, 300);
    expect(rig.pose).toEqual(REST_POSE);
  });
});

describe('holding still (5.1): dragging, an animation, a zoom open', () => {
  it('cameraHeld is any of the three', () => {
    expect(cameraHeld({ dragging: false, animating: false, zoomOpen: false })).toBe(false);
    expect(cameraHeld({ dragging: true, animating: false, zoomOpen: false })).toBe(true);
    expect(cameraHeld({ dragging: false, animating: true, zoomOpen: false })).toBe(true);
    expect(cameraHeld({ dragging: false, animating: false, zoomOpen: true })).toBe(true);
  });

  it('a held rig does not move, and moves on once released', () => {
    const rig = new CameraRig();
    rig.pointer(-1, 1);
    run(rig, 64);
    const at = { ...rig.pose };
    run(rig, 500, true);
    expect(rig.pose).toEqual(at);
    run(rig, 600);
    expect(rig.pose.yaw).toBe(-14);
    expect(rig.pose.pitch).toBe(46);
  });
});

describe('reduced motion, F, Home, zoom', () => {
  it('reduced motion: a static camera, the pointer ignored, changes applied without easing', () => {
    const rig = new CameraRig();
    rig.setReduced(true);
    rig.pointer(1, 1);
    expect(rig.step(16)).toBe(false);
    expect(rig.pose).toEqual(REST_POSE);
    rig.panBy(0.05, 0);
    expect(rig.pose.panX).toBeCloseTo(0.05);
    rig.zoomAt(1.2, tableGeometry(1000, 600));
    expect(rig.pose.zoom).toBeCloseTo(1.2);
  });

  it('F turns following off and on; off, the camera goes back to the seat framing', () => {
    const rig = new CameraRig();
    rig.pointer(1, 0);
    run(rig, 400);
    expect(rig.toggleFollow()).toBe(false);
    rig.pointer(1, 0);
    run(rig, 600);
    expect(rig.pose.yaw).toBe(0);
    expect(rig.toggleFollow()).toBe(true);
  });

  it('zoom stays within 0.8x-1.6x and Home recentres', () => {
    const g = tableGeometry(1000, 600);
    const rig = new CameraRig();
    for (let i = 0; i < 20; i++) rig.zoomAt(1.25, g);
    expect(rig.target().zoom).toBe(1.6);
    for (let i = 0; i < 40; i++) rig.zoomAt(0.8, g);
    expect(rig.target().zoom).toBe(0.8);
    rig.panBy(0.1, 0.1);
    rig.recentre();
    expect(rig.target()).toEqual(REST_POSE);
  });

  it('the wheel zooms around the pointer: the table point under it stays under it', () => {
    const g = tableGeometry(1000, 600);
    const rig = new CameraRig();
    rig.setReduced(true);
    const plane = { x: 180, y: -90 };
    const before = projectPoint(rig.pose, g, plane.x, plane.y);
    rig.zoomAt(1.3, g, { x: before.x, y: before.y });
    const after = projectPoint(rig.pose, g, plane.x, plane.y);
    expect(rig.pose.zoom).toBeCloseTo(1.3);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });
});

describe('projection, framing and compact faces', () => {
  it('at rest the whole table fits the scene', () => {
    for (const [w, h] of [[960, 560], [1640, 820], [700, 420]] as const) {
      const g = tableGeometry(w, h);
      const r = projectRect(REST_POSE, g, { x: -g.planeW / 2, y: -g.planeH / 2, w: g.planeW, h: g.planeH });
      expect(r.left).toBeGreaterThanOrEqual(-w / 2 - 0.5);
      expect(r.right).toBeLessThanOrEqual(w / 2 + 0.5);
      expect(r.top).toBeGreaterThanOrEqual(-h / 2 - 0.5);
      expect(r.bottom).toBeLessThanOrEqual(h / 2 + 0.5);
    }
  });

  it('a card across the table is drawn smaller than the same card near the viewer (perspective)', () => {
    const g = tableGeometry(960, 560);
    const far = projectedWidth(REST_POSE, g, 0, -g.planeH / 4, 80);
    const near = projectedWidth(REST_POSE, g, 0, g.planeH / 4, 80);
    expect(far).toBeLessThan(near);
    // looking across (pitch down to 24°) makes the far side larger
    expect(projectedWidth({ ...REST_POSE, pitch: 24 }, g, 0, -g.planeH / 4, 80)).toBeGreaterThan(far);
  });

  it('compact below about 70 px, full again above 78 (no flicker between)', () => {
    expect(nextCompact(false, COMPACT_BELOW - 1)).toBe(true);
    expect(nextCompact(false, COMPACT_BELOW + 1)).toBe(false);
    expect(nextCompact(true, (COMPACT_BELOW + FULL_ABOVE) / 2)).toBe(true);
    expect(nextCompact(true, FULL_ABOVE + 1)).toBe(false);
    expect(nextCompact(true, 0)).toBe(true);
  });

  it('the transforms: a 2D pan on the scene, the camera on the plane', () => {
    const g = tableGeometry(1000, 600);
    const t = cameraTransforms({ yaw: 5, pitch: 30, zoom: 1.2, panX: 0.1, panY: 0 }, g);
    expect(t.scene).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
    expect(t.camera).toMatch(/^scale\([\d.]+\) rotateX\(30\.000deg\) rotateZ\(5\.000deg\)$/);
  });
});

describe('the measured fallback (5.1 "Performance")', () => {
  it('full at 60 fps, every other frame below 45, following off below 30; nothing decided before enough frames', () => {
    expect(cameraPerfMode(Array(PERF_SAMPLES - 1).fill(100))).toBe('full');
    expect(cameraPerfMode(Array(PERF_SAMPLES).fill(16.7))).toBe('full');
    expect(cameraPerfMode(Array(PERF_SAMPLES).fill(28))).toBe('half');
    expect(cameraPerfMode(Array(PERF_SAMPLES).fill(40))).toBe('off');
  });
});
