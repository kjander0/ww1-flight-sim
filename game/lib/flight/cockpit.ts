import { BoxGeometry, Camera, CylinderGeometry, Group, Material, Matrix4, Mesh, Vector2, Vector3 } from 'three';

export function createFuselage(material: Material) {
  const body = new Group();
  // Leave the cockpit hollow between the instrument bulkhead and the pilot's back.
  const front = new Mesh(new BoxGeometry(1.05, .7, 2.22), material);
  front.position.set(0, -.27, -1.84); body.add(front);
  const nose = new Mesh(new CylinderGeometry(.38, .48, .75, 8), material);
  nose.rotation.x = Math.PI / 2; nose.position.set(0, -.03, -3.1); body.add(nose);
  const rear = new Mesh(new CylinderGeometry(.12, .49, 2.7, 6), material);
  rear.rotation.x = Math.PI / 2; rear.position.set(0, -.4, 3.1); body.add(rear);
  return body;
}

export const throttleAngle = (setting: number) => 1 - Math.max(0, Math.min(1, setting)) * 1.5;
export const THROTTLE_BASE_Y = -.36;
const grip = new Vector3();
/** Position of the actual grip, including perspective and the current head/aircraft pose. */
export function projectThrottleGrip(setting: number, aircraftMatrix: Matrix4, camera: Camera, width: number, height: number, out: Vector2) {
  const a = throttleAngle(setting);
  grip.set(-.76, THROTTLE_BASE_Y + Math.cos(a) * .16 - Math.sin(a) * .03, -.48 + Math.sin(a) * .16 + Math.cos(a) * .03);
  grip.applyMatrix4(aircraftMatrix).project(camera);
  return out.set((grip.x + 1) * width / 2, (1 - grip.y) * height / 2);
}
const candidate = new Vector2();
/** Find the closest reachable screen position, with no fixed pixels-to-throttle gain. */
export function throttleAtPointer(pointer: Vector2, aircraftMatrix: Matrix4, camera: Camera, width: number, height: number) {
  const distance = (v: number) => projectThrottleGrip(v, aircraftMatrix, camera, width, height, candidate).distanceToSquared(pointer);
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i <= 32; i++) { const d = distance(i / 32); if (d < bestDistance) { best = i / 32; bestDistance = d; } }
  let lo = Math.max(0, best - 1 / 32), hi = Math.min(1, best + 1 / 32);
  for (let i = 0; i < 18; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (distance(a) < distance(b)) hi = b; else lo = a; }
  const refined = (lo + hi) / 2;
  return distance(refined) < bestDistance ? refined : best;
}

/** Relative angular dragging: no jump on grab, across +/-pi, or after crossing the hub. */
export class WheelWinder {
  constructor(private previous: number | null) {}
  update(angle: number | null, value: number) {
    if (angle === null || this.previous === null) { this.previous = angle; return value; }
    const delta = Math.atan2(Math.sin(angle-this.previous), Math.cos(angle-this.previous)); this.previous = angle;
    return Math.max(0, Math.min(1, value-delta/(3*Math.PI)));
  }
}
