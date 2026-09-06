import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3, PerspectiveCamera, Quaternion } from 'three';
import { BRAKE_DECELERATION, FlightSimulation, DT, SPEC, coefficients, optimalMixture } from '../lib/flight/simulation';
import { BRAKE_SHAKE_RPM, PILOT_HEIGHT, brakeButtonPose, bombButtonAction, cockingJamKick, explosionLevel, gunBarrelAppearance, movePilotLateral, overspeedShakeAmount, resolveMouseControl } from '../lib/flight/game';
import { AIRCRAFT } from '../lib/flight/aircraft';

function run(s: FlightSimulation, seconds: number, control?: (s: FlightSimulation) => void) {
  for (let i = 0; i < Math.round(seconds / DT); i++) { control?.(s); s.step(); }
}
test('an existing mouse-hand binding wins while the other button is held',()=>{
  assert.equal(resolveMouseControl('yoke','trigger',true),'trigger');
  assert.equal(resolveMouseControl('yoke','trigger',false),'yoke');
  assert.equal(resolveMouseControl('trigger',null,true),'trigger');
});
test('pilot can slide laterally within cockpit limits',()=>{
  assert.equal(movePilotLateral(0,-1,.5),-.24);assert.equal(movePilotLateral(0,1,.5),.24);assert.equal(movePilotLateral(.3,1,1),.38);assert.equal(movePilotLateral(-.3,-1,1),-.38);
});
test('covered bomb release requires one click to open before it can release',()=>{
  assert.equal(bombButtonAction(false),'open');assert.equal(bombButtonAction(true),'release');
});
test('distant explosions attenuate continuously to silence',()=>{
  assert.equal(explosionLevel(0),1);assert.equal(explosionLevel(1000),.5);assert.equal(explosionLevel(2000),0);assert.equal(explosionLevel(8000),0);
});
function airborne() { const s = new FlightSimulation(); s.windEnabled = false; s.position.set(0, 500, 0); s.velocity.set(0, 0, -40); s.grounded = false; return s; }
test('brake holds an unpowered aircraft but full engine power can overcome it', () => {
  const s = new FlightSimulation(); run(s, 60); assert.equal(s.position.y, SPEC.groundHeight); assert.ok(s.position.distanceTo(new Vector3(0, SPEC.groundHeight, 330)) < .1);
  s.controls.ignition = true; s.controls.throttle = 1; run(s, 10); assert.ok(s.rpm > 1500); assert.ok(s.groundSpeed > .5); assert.equal(s.crashed, false);
});
test('brake control presses inward and shakes only when set above warning RPM',()=>{
  const released=brakeButtonPose(false,BRAKE_SHAKE_RPM+100,20),set=brakeButtonPose(true,0,20),warning=brakeButtonPose(true,BRAKE_SHAKE_RPM+100,20);
  assert.ok(set.z<released.z);assert.equal(set.x,.76);assert.equal(set.y,-.45);assert.ok(warning.x!==set.x||warning.y!==set.y);assert.ok(BRAKE_DECELERATION<5.5);
});
test('a gun jam drives a brief oscillating cocking-handle kick',()=>{
  assert.equal(cockingJamKick(0),0);assert.equal(cockingJamKick(1),0);
  assert.notEqual(cockingJamKick(.9),0);assert.ok(Math.abs(cockingJamKick(.4))<.4);
  assert.equal(cockingJamKick(-1),0);assert.equal(cockingJamKick(2),0);
});
test('each aircraft has a distinct progressive overspeed shake threshold',()=>{
  assert.deepEqual([AIRCRAFT.scout.overspeed,AIRCRAFT.fighter.overspeed,AIRCRAFT.bomber.overspeed],[210,250,190]);
  for(const spec of Object.values(AIRCRAFT)){
    assert.equal(overspeedShakeAmount(spec.overspeed-1,spec.overspeed),0);
    assert.equal(overspeedShakeAmount(spec.overspeed,spec.overspeed),0);
    assert.ok(overspeedShakeAmount(spec.overspeed+50,spec.overspeed)>overspeedShakeAmount(spec.overspeed+20,spec.overspeed));
  }
  assert.equal(overspeedShakeAmount(400,200),1.5);
});
test('each aircraft suffers airframe breakup at twice its overspeed threshold',()=>{
  for(const type of Object.keys(AIRCRAFT) as (keyof typeof AIRCRAFT)[]){
    const safe=new FlightSimulation();safe.aircraftType=type;safe.windEnabled=false;safe.position.set(0,1000,0);safe.velocity.set(0,0,-(safe.spec.overspeed*2-.1)/3.6/Math.sqrt(Math.exp(-1000/8500)));safe.grounded=false;safe.step();
    assert.equal(safe.crashed,false,`${type} broke below critical speed`);
    const critical=new FlightSimulation();critical.aircraftType=type;critical.windEnabled=false;critical.position.set(0,1000,0);critical.velocity.set(0,0,-critical.spec.overspeed*2/3.6/Math.sqrt(Math.exp(-1000/8500)));critical.grounded=false;critical.step();
    assert.equal(critical.criticalSpeedKmh,critical.spec.overspeed*2);assert.equal(critical.crashed,true);assert.equal(critical.crashCause,'AIRFRAME FAILURE');assert.ok(critical.impactSpeed>0);
  }
});
test('sustained bad mixture damages a running engine',()=>{
  const s=airborne();s.controls.ignition=true;s.controls.throttle=.7;s.controls.mixture=.4;s.engine='running';s.rpm=1600;const health=s.health;run(s,4);assert.ok(s.mixtureEfficiency<.55);assert.ok(s.health<health);
});
test('fuel tanks are halved and running fuel burn is doubled',()=>{
  const s=new FlightSimulation();assert.equal(s.spec.fuel,55);assert.equal(s.fuel,55);s.aircraftType='fighter';s.reset();assert.equal(s.fuel,62.5);s.aircraftType='bomber';s.reset();assert.equal(s.fuel,105);
  s.aircraftType='scout';s.reset();s.position.set(0,500,0);s.velocity.set(0,0,-40);s.grounded=false;s.controls.ignition=true;s.controls.throttle=1;s.controls.mixture=optimalMixture(500);s.engine='running';const fuel=s.fuel;run(s,1);assert.ok(Math.abs((fuel-s.fuel)-.0154)<1e-6);
});
test('takeoff from a standing start before the runway end, followed by a stable climb', t => {
  const s = new FlightSimulation(); s.windEnabled = false; s.controls.ignition = true; s.controls.throttle = 1; s.controls.brake = false;
  let liftoffDistance: number | undefined;
  run(s, 45, s => { s.controls.pitch = s.airspeed > 23 ? .36 : 0; if (!s.grounded && liftoffDistance === undefined) liftoffDistance = 330 - s.position.z; });
  assert.equal(s.crashed, false); assert.ok(s.position.y > 20, `altitude ${s.position.y}, IAS ${s.airspeed}, alpha ${s.alpha}`);
  assert.ok(liftoffDistance !== undefined && liftoffDistance < 770, `liftoff distance ${liftoffDistance}`);
  t.diagnostic(`Liftoff after ${liftoffDistance?.toFixed(0)} m; altitude ${s.position.y.toFixed(0)} m after 45 s.`);
});
test('lift curve transitions smoothly into separated flow beyond critical angle', () => {
  assert.ok(coefficients(.28).cl > coefficients(.5).cl);
  assert.ok(coefficients(.5).cd > coefficients(.28).cd);
  assert.ok(coefficients(.3).cd < coefficients(.5).cd);
  const s = airborne(); s.orientation.setFromEuler(new Euler(.4, 0, 0)); s.step(); assert.equal(s.stall, true); assert.ok(s.airspeed > 35);
});
test('scout can complete a clean loop from 240 km/h IAS', () => {
  const s=new FlightSimulation(),altitude=2000;
  s.windEnabled=false;s.position.set(0,altitude,0);
  s.velocity.set(0,0,-240/3.6/Math.sqrt(Math.exp(-altitude/8500)));s.grounded=false;
  Object.assign(s.controls,{ignition:true,throttle:1,pitch:.5,radiator:0,mixture:optimalMixture(altitude)});
  s.engine='running';s.rpm=1850;
  let rotation=0,maxAlpha=0,minSpeed=Infinity;
  for(let i=0;i<20/DT&&rotation<Math.PI*2;i++){
    s.step();rotation+=s.rates.x*DT;maxAlpha=Math.max(maxAlpha,Math.abs(s.alpha));minSpeed=Math.min(minSpeed,s.airspeed);
  }
  assert.ok(rotation>=Math.PI*2,`rotation ${rotation*180/Math.PI}°`);
  assert.ok(maxAlpha<SPEC.stallAngle,`AoA ${maxAlpha*180/Math.PI}°`);
  assert.ok(minSpeed*3.6>75,`minimum speed ${minSpeed*3.6} km/h`);
  assert.ok(Math.abs(s.position.y-altitude)<100,`exit altitude ${s.position.y}`);
});
test('holding full aft elevator after energy decays still produces an accelerated stall', () => {
  const s=airborne();s.velocity.set(0,0,-180/3.6);s.controls.pitch=1;
  let stalled=false;run(s,5,s=>{stalled||=s.stall;});
  assert.equal(stalled,true);assert.ok(s.airspeed<35);
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
  assert.equal(optimalMixture(-100),.85);assert.equal(optimalMixture(0),.85);assert.equal(optimalMixture(1000),.575);assert.equal(optimalMixture(2000),.3);assert.equal(optimalMixture(3000),.3);
  const good = new FlightSimulation(), bad = new FlightSimulation();
  for (const s of [good, bad]) { s.controls.ignition = true; s.controls.throttle = 1; }
  bad.controls.mixture = .6; run(good, 20); run(bad, 20); assert.ok(good.rpm > bad.rpm * 1.4);
});
test('radiator affects temperature gradually, and overheating damages the engine', () => {
  const closed = new FlightSimulation(), open = new FlightSimulation();
  for (const s of [closed, open]) { s.temperature = 100; s.controls.ignition = true; s.controls.throttle = 1; }
  closed.controls.radiator = 0; open.controls.radiator = 1;
  open.step(); assert.ok(Math.abs(open.temperature - 100) < .1);
  run(closed, 120); run(open, 120); assert.ok(closed.temperature > open.temperature + 15); assert.ok(open.temperature<110);assert.ok(closed.health < open.health);
});
test('gun barrel progresses from cold metal to a bright orange-red glow',()=>{
  const cold=gunBarrelAppearance(0),warm=gunBarrelAppearance(.6),hot=gunBarrelAppearance(1);
  assert.deepEqual(cold.emissive,[0,0,0]);assert.ok(warm.emissive[0]>0);assert.ok(hot.emissive[0]>hot.emissive[1]);assert.ok(hot.emissive[1]>hot.emissive[2]);assert.ok(hot.intensity>warm.intensity);
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
  const camera = new PerspectiveCamera(60, 16 / 9, .025, 12000); camera.position.set(0, PILOT_HEIGHT, 1.3);
  camera.quaternion.copy(new Quaternion().setFromEuler(new Euler(-.23, 0, 0, 'YXZ'))); camera.updateMatrixWorld();
  for (const [x, y, z] of [[-.76,-.34,-.39],[-.38,-.34,-.4],[.38,-.34,-.4],[0,-.27,-.12],[.76,-.29,-.38],[.76,-.49,-.38]]) {
    const p = new Vector3(x,y,z).project(camera); assert.ok(Math.abs(p.x) < .95 && Math.abs(p.y) < .90, `control ${x},${y},${z} projects to ${p.x},${p.y}`);
  }
});
