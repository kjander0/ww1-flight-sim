import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { createFuselage, projectThrottleGrip, throttleAtPointer } from '../lib/flight/cockpit';
import { SceneryCollisions } from '../lib/flight/collisions';
import { FlightSimulation } from '../lib/flight/simulation';

function camera(yaw = 0, pitch = -.23) {
  const c = new PerspectiveCamera(60, 16/9, .025, 12000); c.position.set(0, .68, 1.3);
  c.quaternion.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ')); c.updateMatrixWorld(); return c;
}
test('throttle grip moves upward with increasing power and tracks its projected drag path', () => {
  const c = camera(), matrix = new Matrix4();
  const idle = projectThrottleGrip(0, matrix, c, 1440, 810, new Vector2());
  const full = projectThrottleGrip(1, matrix, c, 1440, 810, new Vector2());
  assert.ok(full.y < idle.y - 15, `idle ${idle.y}, full ${full.y}`);
  for (const setting of [0, .17, .45, .73, 1]) {
    const point = projectThrottleGrip(setting, matrix, c, 1440, 810, new Vector2());
    assert.ok(Math.abs(throttleAtPointer(point, matrix, c, 1440, 810) - setting) < .0001);
  }
});
test('throttle tracks after looking sideways and clamps to reachable travel', () => {
  const c = camera(.35, -.4), matrix = new Matrix4();
  for (const setting of [.1, .5, .9]) {
    const point = projectThrottleGrip(setting, matrix, c, 1440, 810, new Vector2());
    assert.ok(Math.abs(throttleAtPointer(point, matrix, c, 1440, 810) - setting) < .0001);
  }
  const home = camera();
  const below = projectThrottleGrip(0, matrix, home, 1440, 810, new Vector2()).add(new Vector2(0, 400));
  const above = projectThrottleGrip(1, matrix, home, 1440, 810, new Vector2()).add(new Vector2(0, -400));
  assert.equal(throttleAtPointer(below, matrix, home, 1440, 810), 0);
  assert.equal(throttleAtPointer(above, matrix, home, 1440, 810), 1);
});
test('actual fuselage meshes do not obstruct the instrument faces or yoke', () => {
  const body = createFuselage(new MeshBasicMaterial()); body.updateMatrixWorld(true);
  const eye = new Vector3(0, .68, 1.3), ray = new Raycaster();
  const targets = [-.71,-.355,0,.355,.71].flatMap(x => [new Vector3(x, .065, -.56), new Vector3(x, -.06, -.56)]);
  targets.push(new Vector3(0, -.25, -.2));
  for (const target of targets) { ray.set(eye, target.clone().sub(eye).normalize()); ray.far = eye.distanceTo(target); assert.equal(ray.intersectObject(body, true).length, 0, `fuselage blocks ${target.toArray()}`); }
});
test('tree trunks and crowns collide, while flying above the crown is clear', () => {
  const world = new SceneryCollisions(); world.addTree(0, 0, 1); const q = new Quaternion();
  for (const y of [1.15, 9, 16, 20]) assert.equal(world.sweep(new Vector3(0,y,25), new Vector3(0,y,-25), q, q)?.kind, 'TREE');
  assert.equal(world.sweep(new Vector3(0,28,25), new Vector3(0,28,-25), q, q), null);
});
test('wingtip contact counts even when the fuselage misses the tree', () => {
  const world = new SceneryCollisions(); world.addTree(4.3, 0, 1); const q = new Quaternion();
  assert.equal(world.sweep(new Vector3(0,1.15,15), new Vector3(0,1.15,-15), q, q)?.kind, 'TREE');
});
test('hangar walls and sloping roof collide without a phantom roof above the ridge', () => {
  const world = new SceneryCollisions(); world.addHangar(0, 0); const q = new Quaternion();
  for (const y of [2, 12, 18]) assert.equal(world.sweep(new Vector3(0,y,40), new Vector3(0,y,-40), q, q)?.kind, 'HANGAR');
  assert.equal(world.sweep(new Vector3(0,23,40), new Vector3(0,23,-40), q, q), null);
});
test('swept collision prevents tunnelling, stops the aircraft, and reset retains scenery', () => {
  const s = new FlightSimulation(); s.windEnabled = false; s.grounded = false; s.position.set(0,10,0); s.velocity.set(0,0,-600);
  s.scenery.addBox('TOWER', new Vector3(-20,0,-5.1), new Vector3(20,20,-5)); s.step();
  assert.equal(s.crashed, true); assert.equal(s.crashCause, 'TOWER'); assert.ok(s.position.z > -5); assert.equal(s.velocity.length(), 0); assert.equal(s.engine, 'off');
  s.reset(); assert.equal(s.crashed, false); assert.equal(s.crashCause, ''); assert.equal(s.scenery.obstacleCount, 1);
});
test('spatial buckets include obstacles across cell boundaries and negative coordinates', () => {
  const world = new SceneryCollisions(); world.addTree(-64, -64, 1); const q = new Quaternion();
  assert.equal(world.sweep(new Vector3(-64,8,-30), new Vector3(-64,8,-100), q, q)?.kind, 'TREE');
  assert.equal(world.sweep(new Vector3(100,8,-30), new Vector3(100,8,-100), q, q), null);
});
