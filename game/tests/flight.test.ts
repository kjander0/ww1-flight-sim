import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3, PerspectiveCamera, Quaternion } from 'three';
import { FlightSimulation, DT, SPEC, coefficients, optimalMixture } from '../lib/flight/simulation';

function run(s: FlightSimulation, seconds: number, control?: (s: FlightSimulation) => void) {
  for (let i = 0; i < Math.round(seconds / DT); i++) { control?.(s); s.step(); }
}
function airborne() { const s = new FlightSimulation(); s.windEnabled = false; s.position.set(0, 500, 0); s.velocity.set(0, 0, -40); s.grounded = false; return s; }
test('parked aircraft stays on its gear, engine off and full throttle with brake set', () => {
  const s = new FlightSimulation(); run(s, 60); assert.equal(s.position.y, SPEC.groundHeight); assert.ok(s.position.distanceTo(new Vector3(0, SPEC.groundHeight, 330)) < .1);
  s.controls.ignition = true; s.controls.throttle = 1; run(s, 30); assert.ok(s.rpm > 1500); assert.ok(s.velocity.length() < .1); assert.equal(s.crashed, false);
});
test('takeoff from a standing start before the runway end, followed by a stable climb', t => {
  const s = new FlightSimulation(); s.windEnabled = false; s.controls.ignition = true; s.controls.throttle = 1; s.controls.brake = false;
  let liftoffDistance: number | undefined;
  run(s, 45, s => { s.controls.pitch = s.airspeed > 23 ? .36 : 0; if (!s.grounded && liftoffDistance === undefined) liftoffDistance = 330 - s.position.z; });
  assert.equal(s.crashed, false); assert.ok(s.position.y > 20, `altitude ${s.position.y}, IAS ${s.airspeed}, alpha ${s.alpha}`);
  assert.ok(liftoffDistance !== undefined && liftoffDistance < 770, `liftoff distance ${liftoffDistance}`);
  t.diagnostic(`Liftoff after ${liftoffDistance?.toFixed(0)} m; altitude ${s.position.y.toFixed(0)} m after 45 s.`);
});
test('lift curve loses lift and gains drag beyond critical angle', () => {
  assert.ok(coefficients(.24).cl > coefficients(.42).cl * 2);
  assert.ok(coefficients(.42).cd > coefficients(.24).cd * 2);
  const s = airborne(); s.orientation.setFromEuler(new Euler(.4, 0, 0)); s.step(); assert.equal(s.stall, true); assert.ok(s.airspeed > 35);
});
test('power-off aircraft cannot gain mechanical energy in still air', () => {
  const s = airborne(); const energy = () => 9.81 * s.position.y + s.velocity.lengthSq() / 2;
  const before = energy(); run(s, 10); assert.ok(energy() < before); assert.ok(!s.crashed);
});
test('lowering nose recovers from an accelerated stall', () => {
  const s = airborne(); s.orientation.setFromEuler(new Euler(.43, 0, 0)); s.controls.pitch = -.4; run(s, 4);
  assert.equal(s.stall, false); assert.ok(Math.abs(s.alpha) < SPEC.stallAngle); assert.ok(s.airspeed > 20);
});
test('mixture optimum follows altitude and poor mixture reduces RPM', () => {
  assert.ok(optimalMixture(3000) < optimalMixture(0));
  const good = new FlightSimulation(), bad = new FlightSimulation();
  for (const s of [good, bad]) { s.controls.ignition = true; s.controls.throttle = 1; }
  bad.controls.mixture = .6; run(good, 20); run(bad, 20); assert.ok(good.rpm > bad.rpm * 1.4);
});
test('radiator affects temperature gradually, and overheating damages the engine', () => {
  const closed = new FlightSimulation(), open = new FlightSimulation();
  for (const s of [closed, open]) { s.temperature = 100; s.controls.ignition = true; s.controls.throttle = 1; }
  closed.controls.radiator = 0; open.controls.radiator = 1;
  open.step(); assert.ok(Math.abs(open.temperature - 100) < .1);
  run(closed, 120); run(open, 120); assert.ok(closed.temperature > open.temperature + 15); assert.ok(closed.health < open.health);
});
test('wind changes air-relative speed without changing ground velocity instantly', () => {
  const s = airborne(); s.velocity.set(30, 0, 0); s.windEnabled = true; s.step(); assert.ok(s.airspeed < 30); assert.ok(s.airspeed > 26);
});
test('gentle touchdown rolls out; hard impact is a crash', () => {
  const good = airborne(); good.position.y = 1.2; good.velocity.set(0, -1, -25); run(good, .2); assert.equal(good.crashed, false);
  const bad = airborne(); bad.position.y = 1.2; bad.velocity.set(0, -7, -25); run(bad, .2); assert.equal(bad.crashed, true);
});
test('sharp high-speed ground steering overloads the narrow landing gear', () => {
  const s = new FlightSimulation(); s.windEnabled=false; s.controls.brake=false; s.velocity.set(0,0,-35); s.controls.roll=1;
  run(s,1); assert.equal(s.crashed,true); assert.equal(s.crashCause,'GROUND LOOP'); assert.ok(s.impactSpeed>30);
});
test('small high-speed runway corrections remain controllable', () => {
  const s = new FlightSimulation(); s.windEnabled=false; s.controls.brake=false; s.velocity.set(0,0,-35); s.controls.roll=.25;
  run(s,1); assert.equal(s.crashed,false); assert.equal(s.grounded,true); assert.ok(s.groundLoad<3.8);
});
test('a running propeller breaks when a nose-low aircraft touches the ground', () => {
  const s = new FlightSimulation(); s.windEnabled=false; s.controls.brake=false; s.position.y=SPEC.groundHeight;
  s.orientation.setFromEuler(new Euler(-.14,0,0)); s.velocity.set(0,0,-8); s.rpm=900; s.engine='running'; s.step();
  assert.equal(s.crashed,true); assert.equal(s.crashCause,'PROP STRIKE'); assert.ok(s.propClearance<=0);
});
test('full forward elevator at takeoff speed lifts the tail into a prop strike', () => {
  const s = new FlightSimulation(); s.windEnabled=false; s.controls.brake=false; s.controls.pitch=-1;
  s.velocity.set(0,0,-30); s.rpm=1500; s.engine='running'; run(s,2);
  assert.equal(s.crashed,true); assert.equal(s.crashCause,'PROP STRIKE');
  const pitch=new Euler().setFromQuaternion(s.orientation,'YXZ').x;
  assert.ok(pitch<-.08,`pitch ${pitch}`);
});
test('a nose-low field landing can rotate for another takeoff at 120 km/h', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const s = airborne(); s.position.set(1400, 1.2, 1700);
    s.orientation.setFromEuler(new Euler(-.08, heading, 0, 'YXZ'));
    s.velocity.set(-Math.sin(heading) * 34, -1.2, -Math.cos(heading) * 34);
    s.controls.brake = false; s.controls.ignition = true; s.controls.throttle = 1;
    run(s, .15);
    assert.equal(s.grounded, true); assert.equal(s.crashed, false);
    s.controls.pitch = .25;
    run(s, 5);
    assert.equal(s.crashed, false);
    assert.ok(s.position.y > SPEC.groundHeight + 2, `heading ${heading}: altitude ${s.position.y}, speed ${s.airspeed * 3.6}, pitch ${new Euler().setFromQuaternion(s.orientation, 'YXZ').x}`);
  }
});
test('land, brake to a stop in a field, and take off again without resetting', () => {
  const s = airborne(); s.position.set(-1600, 1.2, 1400);
  s.orientation.setFromEuler(new Euler(-.08, .7, 0, 'YXZ'));
  s.velocity.set(-Math.sin(.7) * 25, -1, -Math.cos(.7) * 25);
  s.controls.brake = true; run(s, 8);
  assert.equal(s.crashed, false); assert.equal(s.grounded, true); assert.ok(s.velocity.length() < .1);
  s.controls.brake = false; s.controls.ignition = true; s.controls.throttle = 1;
  run(s, 40, s => { s.controls.pitch = s.airspeed > 23 ? .36 : 0; });
  assert.equal(s.crashed, false); assert.equal(s.grounded, false); assert.ok(s.position.y > 20);
});
test('fixed ticks give the same state regardless of render frame grouping', () => {
  function simulate(fps: number) { const s = airborne(); s.controls.pitch = .1; let acc = 0; for (let frame = 0; frame < fps * 10; frame++) { acc += 1 / fps; while (acc + 1e-10 >= DT) { s.step(); acc -= DT; } } return s; }
  const a = simulate(30), b = simulate(144); assert.ok(a.position.distanceTo(b.position) < 1e-6); assert.ok(a.orientation.angleTo(b.orientation) < 1e-6);
});
test('bank input produces a coordinated turn, with energy cost at idle', () => {
  const s = airborne(); s.controls.roll = .35; s.controls.pitch = .18;
  run(s, 3); s.controls.roll = 0; run(s, 3);
  const forward = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
  assert.ok(forward.x > .1, `right turn forward component ${forward.x}`); assert.ok(s.airspeed < 40);
});
test('all cockpit control centers project inside the visible desktop viewport', () => {
  const camera = new PerspectiveCamera(60, 16 / 9, .025, 12000); camera.position.set(0, .68, 1.3);
  camera.quaternion.copy(new Quaternion().setFromEuler(new Euler(-.23, 0, 0, 'YXZ'))); camera.updateMatrixWorld();
  for (const [x, y, z] of [[-.76,-.34,-.39],[-.38,-.34,-.4],[.38,-.34,-.4],[0,-.27,-.12],[.76,-.29,-.38],[.76,-.49,-.38]]) {
    const p = new Vector3(x,y,z).project(camera); assert.ok(Math.abs(p.x) < .95 && Math.abs(p.y) < .90, `control ${x},${y},${z} projects to ${p.x},${p.y}`);
  }
});
