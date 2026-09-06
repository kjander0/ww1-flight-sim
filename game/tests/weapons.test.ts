import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { AMMO_CAPACITY, MachineGun, RATE_OF_FIRE } from '../lib/flight/weapons';

const state = {
  muzzle: new T.Vector3(0, 100, 0),
  direction: new T.Vector3(0, 0, -1),
  aircraftVelocity: new T.Vector3(10, 0, -40),
  groundHeightAt: () => 0,
};

void test('gun must be cocked and fires at its cyclic rate while held', () => {
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

void test('gun has a 250-round belt and cannot fire beyond it', () => {
  assert.equal(AMMO_CAPACITY, 250);
  const gun = new MachineGun(() => .5); gun.cock(); gun.trigger = true;
  gun.roundsRemaining = 2;
  gun.step(1, state);
  assert.equal(gun.roundsFired, 2);
  assert.equal(gun.roundsRemaining, 0);
  gun.step(1, state);
  assert.equal(gun.roundsFired, 2);
  gun.reset();
  assert.equal(gun.roundsRemaining, AMMO_CAPACITY);
});
