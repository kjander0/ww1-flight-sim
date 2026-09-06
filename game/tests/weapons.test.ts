import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { AMMO_CAPACITY, gunJamChance, HEAT_COOLING_RATE, HEAT_PER_ROUND, JAM_BASE_CHANCE, JAM_HEAT_CHANCE, MachineGun, MUZZLE_VELOCITY, RATE_OF_FIRE, REAR_AMMO_CAPACITY } from '../lib/flight/weapons';

const state = {
  muzzle: new T.Vector3(0, 100, 0),
  direction: new T.Vector3(0, 0, -1),
  aircraftVelocity: new T.Vector3(10, 0, -40),
  groundHeightAt: () => 0,
};

void test('gun must be cocked and fires at its cyclic rate while held', () => {
  assert.equal(MUZZLE_VELOCITY, 620);
  assert.equal(RATE_OF_FIRE*60,600);
  const gun = new MachineGun(() => .5);
  gun.trigger = true;
  gun.step(1, state);
  assert.equal(gun.roundsFired, 0);
  gun.cock();
  gun.step(1, state);
  assert.equal(gun.roundsFired, Math.floor(RATE_OF_FIRE));
  assert.ok(gun.projectiles[0].velocity.x > 0);
  assert.ok(gun.projectiles[0].velocity.z < -450);
  assert.equal(gun.projectiles[0].tracer, true);
  assert.equal(gun.projectiles[1].tracer, false);
  assert.equal(gun.projectiles[2].tracer, false);
  assert.equal(gun.projectiles[3].tracer, true);
});

void test('heat increases dispersion and jams require cocking again', () => {
  const values = [.5, .5, 0, .9, .1, 0]; let i = 0;
  const gun = new MachineGun(() => values[i++ % values.length]);
  gun.cock(); gun.heat = 1; gun.trigger = true;
  gun.step(.1, state);
  assert.equal(gun.jammed, true);
  assert.equal(gun.cocked, false);
  assert.equal(gun.trigger, false);
  gun.cock();
  assert.equal(gun.jammed, false);
  assert.equal(gun.cocked, true);
});

void test('jam odds are tripled across the heat range',()=>{
  assert.equal(JAM_BASE_CHANCE,.00075);assert.equal(JAM_HEAT_CHANCE,.069);
  assert.equal(gunJamChance(0),.00075);
  assert.ok(Math.abs(gunJamChance(1)-.06975)<1e-12);
  assert.ok(Math.abs(gunJamChance(.5)-.009375)<1e-12);
});

void test('gun heat builds and cools at the doubled rates',()=>{
  assert.equal(HEAT_PER_ROUND,.034);assert.equal(HEAT_COOLING_RATE,.052);
  const gun=new MachineGun(()=>.5);gun.cock();gun.trigger=true;gun.step(.1,state);assert.ok(Math.abs(gun.heat-HEAT_PER_ROUND)<1e-12);
  gun.trigger=false;gun.heat=1;gun.step(1,state);assert.ok(Math.abs(gun.heat-(1-HEAT_COOLING_RATE))<1e-12);
});

void test('projectiles inherit aircraft motion, fall, slow, and stop at terrain', () => {
  const gun = new MachineGun(() => .5); gun.cock(); gun.trigger = true;
  gun.step(.1, state); gun.trigger = false;
  const p = gun.projectiles[0], initialSpeed = p.velocity.length(), initialY = p.position.y;
  gun.step(.5, state);
  assert.ok(p.position.y < initialY);
  assert.ok(p.velocity.length() < initialSpeed);
  gun.step(2, { ...state, groundHeightAt: () => 200 });
  assert.equal(gun.projectiles.length, 0);
  assert.equal(gun.impacts.length, 1);
  assert.equal(gun.consumeImpacts().length, 1);
  assert.equal(gun.impacts.length, 0);
});

void test('forward guns have 100-round belts while rear guns retain 250 rounds', () => {
  assert.equal(AMMO_CAPACITY, 100);
  assert.equal(REAR_AMMO_CAPACITY,250);
  const gun = new MachineGun(() => .5); gun.cock(); gun.trigger = true;
  gun.roundsRemaining = 2;
  gun.step(1, state);
  assert.equal(gun.roundsFired, 2);
  assert.equal(gun.roundsRemaining, 0);
  gun.step(1, state);
  assert.equal(gun.roundsFired, 2);
  gun.reset();
  assert.equal(gun.roundsRemaining, AMMO_CAPACITY);
  const rear=new MachineGun(()=>.5,MUZZLE_VELOCITY,REAR_AMMO_CAPACITY);rear.roundsRemaining=1;rear.reset();assert.equal(rear.roundsRemaining,REAR_AMMO_CAPACITY);
});
