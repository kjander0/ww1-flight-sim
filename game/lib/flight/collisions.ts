import { Box3, Plane, Quaternion, Vector3 } from 'three';

type Obstacle = { kind: string; bounds: Box3; center?: Vector3; radius?: number; planes?: Plane[] };
type Part = { center: Vector3; radius: number };
type Tree = { x: number; z: number; base: number; top: number };
export type SceneryHit = { kind: string; time: number };

// Overlapping spheres represent the nose, fuselage, both wings and tail, not just the camera.
const PARTS: Part[] = [];
for (let z = -3.25; z <= 4.15; z += .55) PARTS.push({ center: new Vector3(0, -.2, z), radius: z > 2 ? .27 : .52 });
for (const y of [-.3, 1.48]) for (let x = -4.1; x <= 4.15; x += .45) {
  for (const z of [-1.9, -1.25, -.8]) PARTS.push({ center: new Vector3(x, y, z), radius: .25 });
}
for (const x of [-1, -.5, .5, 1]) PARTS.push({ center: new Vector3(x, -.32, 4.1), radius: .3 });
PARTS.push({ center: new Vector3(0, .4, 4.1), radius: .32 });

/** Slab test for a swept sphere against a box. Returns the first contact fraction. */
function boxTime(start: Vector3, end: Vector3, box: Box3, radius: number) {
  let enter = 0, exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = end[axis] - start[axis], min = box.min[axis] - radius, max = box.max[axis] + radius;
    if (Math.abs(delta) < 1e-10) { if (start[axis] < min || start[axis] > max) return null; }
    else { const a = (min - start[axis]) / delta, b = (max - start[axis]) / delta; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); if (enter > exit) return null; }
  }
  return enter;
}
function sphereTime(start: Vector3, end: Vector3, center: Vector3, radius: number) {
  const x = start.x - center.x, y = start.y - center.y, z = start.z - center.z;
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const c = x*x + y*y + z*z - radius*radius;
  if (c <= 0) return 0;
  const a = dx*dx + dy*dy + dz*dz, b = x*dx + y*dy + z*dz;
  const discriminant = b*b - a*c;
  if (a < 1e-12 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
function convexTime(start: Vector3, end: Vector3, planes: Plane[], radius: number) {
  let enter = 0, exit = 1;
  for (const plane of planes) {
    const a = plane.distanceToPoint(start) - radius, b = plane.distanceToPoint(end) - radius;
    if (a > 0 && b > 0) return null;
    if (a > 0) enter = Math.max(enter, a / (a - b));
    else if (b > 0) exit = Math.min(exit, a / (a - b));
    if (enter > exit) return null;
  }
  return enter;
}

/** Static scenery, bucketed by 64 m ground cells; only nearby obstacles are tested. */
export class SceneryCollisions {
  isEnabled: (kind:string,bounds:Box3)=>boolean=()=>true;
  private grid = new Map<string, Obstacle[]>();
  private trees: Tree[] = [];
  private nearby = new Set<Obstacle>();
  private start = new Vector3(); private end = new Vector3();
  private poseStart = new Vector3(); private poseEnd = new Vector3();
  private rotStart = new Quaternion(); private rotEnd = new Quaternion();
  obstacleCount = 0;
  private spanScale=1; private lengthScale=1;
  setAircraftScale(span:number,length:number){this.spanScale=span;this.lengthScale=length;}
  addBox(kind: string, min: Vector3, max: Vector3) { this.add({ kind, bounds: new Box3(min, max) }); }
  private add(o: Obstacle) {
    this.obstacleCount++;
    for (let x = Math.floor(o.bounds.min.x / 64); x <= Math.floor(o.bounds.max.x / 64); x++) for (let z = Math.floor(o.bounds.min.z / 64); z <= Math.floor(o.bounds.max.z / 64); z++) {
      const key = `${x},${z}`; const bucket = this.grid.get(key); if (bucket) bucket.push(o); else this.grid.set(key, [o]);
    }
  }
  private sphere(kind: string, center: Vector3, radius: number) {
    this.add({ kind, center, radius, bounds: new Box3(center.clone().addScalar(-radius), center.clone().addScalar(radius)) });
  }
  addTree(x: number, z: number, scale: number, base=0) {
    this.trees.push({ x, z, base, top: base + 20 * scale });
    this.addBox('TREE', new Vector3(x - .35 * scale, base, z - .35 * scale), new Vector3(x + .35 * scale, base+9 * scale, z + .35 * scale));
    for (const [height, radius] of [[9.5, 4.2], [16, 3], [20, 1.7]]) this.sphere('TREE', new Vector3(x, base+height * scale, z), radius * scale);
  }
  isBetweenTrees(position: Vector3, rotation: Quaternion, halfSpan: number) {
    const forward = new Vector3(0, 0, -1).applyQuaternion(rotation); forward.y = 0;
    const right = new Vector3(1, 0, 0).applyQuaternion(rotation); right.y = 0;
    if (forward.lengthSq() < .25 || right.lengthSq() < .25) return false;
    forward.normalize(); right.normalize();
    const maxGap = (halfSpan * 2 + 18) * 1.1;
    const maxClearance = maxGap / 2 - halfSpan;
    let left: { along: number; side: number } | null = null;
    let rightTree: { along: number; side: number } | null = null;
    for (const tree of this.trees) {
      const dx = tree.x - position.x, dz = tree.z - position.z;
      const along = dx * forward.x + dz * forward.z;
      const side = dx * right.x + dz * right.z;
      const clearance = Math.abs(side) - halfSpan;
      if (Math.abs(along) > 10 || clearance < 1 || clearance > maxClearance || position.y <= tree.base + 1 || position.y + 1.7 >= tree.top) continue;
      const candidate = { along, side };
      if (side < 0 && (!left || Math.abs(along) < Math.abs(left.along))) left = candidate;
      if (side > 0 && (!rightTree || Math.abs(along) < Math.abs(rightTree.along))) rightTree = candidate;
    }
    return !!left && !!rightTree && Math.abs(left.along - rightTree.along) <= 13.2 && rightTree.side - left.side <= maxGap;
  }
  addHangar(x: number, z: number, base=0) {
    this.addBox('HANGAR', new Vector3(x - 16.2, base, z - 17.5), new Vector3(x + 16.2, base+11, z + 17.5));
    // Match the actual four-sided sloping roof instead of filling its whole bounding box.
    const halfX = 23 / Math.sqrt(2), halfZ = halfX * 1.1;
    const planes = [new Plane(new Vector3(0, -1, 0), base+11)];
    for (const sign of [-1, 1]) {
      planes.push(new Plane(new Vector3(sign / halfX, 1 / 8, 0), -(base+19) / 8 - sign * x / halfX).normalize());
      planes.push(new Plane(new Vector3(0, 1 / 8, sign / halfZ), -(base+19) / 8 - sign * z / halfZ).normalize());
    }
    this.add({ kind: 'HANGAR', planes, bounds: new Box3(new Vector3(x-halfX, base+11, z-halfZ), new Vector3(x+halfX, base+19, z+halfZ)) });
  }
  sweep(from: Vector3, to: Vector3, oldRotation: Quaternion, newRotation: Quaternion): SceneryHit | null {
    this.nearby.clear();
    const reach=6*Math.max(this.spanScale,this.lengthScale);
    for (let x = Math.floor((Math.min(from.x, to.x) - reach) / 64); x <= Math.floor((Math.max(from.x, to.x) + reach) / 64); x++) for (let z = Math.floor((Math.min(from.z, to.z) - reach) / 64); z <= Math.floor((Math.max(from.z, to.z) + reach) / 64); z++) {
      const bucket = this.grid.get(`${x},${z}`); if (bucket) for (const o of bucket) this.nearby.add(o);
    }
    if (!this.nearby.size) return null;
    // Break rotation into <=0.03 rad arcs. Linear sweeps then bound wingtip arc error to <1 mm.
    const steps = Math.max(1, Math.ceil(oldRotation.angleTo(newRotation) / .03));
    let hit: SceneryHit | null = null;
    for (let step = 0; step < steps; step++) {
      this.poseStart.lerpVectors(from, to, step / steps); this.poseEnd.lerpVectors(from, to, (step + 1) / steps);
      this.rotStart.slerpQuaternions(oldRotation, newRotation, step / steps); this.rotEnd.slerpQuaternions(oldRotation, newRotation, (step + 1) / steps);
      for (const part of PARTS) {
        const z=part.center.z>1.5?part.center.z*this.lengthScale:part.center.z;
        const radius=part.radius*(part.center.x!==0?this.spanScale:part.center.z>1.5?this.lengthScale:1)+.001;
        this.start.set(part.center.x*this.spanScale,part.center.y,z).applyQuaternion(this.rotStart).add(this.poseStart); this.end.set(part.center.x*this.spanScale,part.center.y,z).applyQuaternion(this.rotEnd).add(this.poseEnd);
        for (const o of this.nearby) {
          if(!this.isEnabled(o.kind,o.bounds))continue;
          const coarse = boxTime(this.start, this.end, o.bounds, radius); if (coarse === null) continue;
          const time = o.center ? sphereTime(this.start, this.end, o.center, o.radius! + radius) : o.planes ? convexTime(this.start, this.end, o.planes, radius) : coarse;
          if (time !== null) { const t = (step + time) / steps; if (!hit || t < hit.time) hit = { kind: o.kind, time: t }; }
        }
      }
      if (hit) break;
    }
    return hit;
  }
}
