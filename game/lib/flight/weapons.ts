import * as T from 'three';

export const MUZZLE_VELOCITY = 650;
export const RATE_OF_FIRE = 10.5;
export const PROJECTILE_LIFE = 4.5;
export const AMMO_CAPACITY = 500;

export type Projectile = {
  position: T.Vector3;
  previous: T.Vector3;
  velocity: T.Vector3;
  age: number;
  tracer: boolean;
};

export type ProjectileImpact = { position: T.Vector3; velocity: T.Vector3; tracer: boolean };

export type GunStep = {
  muzzle: T.Vector3;
  direction: T.Vector3;
  aircraftVelocity: T.Vector3;
  groundHeightAt: (x: number, z: number) => number;
  // Earliest swept world hit, normalized along this tick's segment.
  sweep?: (from:T.Vector3,to:T.Vector3)=>number|null;
};

/** A water-cooled, rifle-calibre aircraft gun with a manually cleared action. */
export class MachineGun {
  cocked = false;
  jammed = false;
  trigger = false;
  heat = 0;
  roundsFired = 0;
  roundsRemaining = AMMO_CAPACITY;
  projectiles: Projectile[] = [];
  impacts: ProjectileImpact[] = [];
  private cycle = 0;

  constructor(private random: () => number = Math.random) {}

  cock() {
    this.cocked = true;
    this.jammed = false;
    this.cycle = 0;
  }

  reset() {
    this.cocked = false;
    this.jammed = false;
    this.trigger = false;
    this.heat = 0;
    this.roundsFired = 0;
    this.roundsRemaining = AMMO_CAPACITY;
    this.cycle = 0;
    this.projectiles.length = 0;
    this.impacts.length = 0;
  }

  /** Particle effects can drain these events without coupling visuals to ballistics. */
  consumeImpacts() { return this.impacts.splice(0); }

  step(dt: number, state: GunStep) {
    this.heat = Math.max(0, this.heat - dt * .026);
    if (this.trigger && this.cocked && !this.jammed && this.roundsRemaining > 0) {
      this.cycle += dt;
      const interval = 1 / RATE_OF_FIRE;
      while (this.cycle >= interval && this.cocked && !this.jammed && this.roundsRemaining > 0) {
        this.cycle -= interval;
        this.fire(state);
      }
    } else this.cycle = Math.min(this.cycle, 1 / RATE_OF_FIRE);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.previous.copy(p.position);
      // G1-like simplified drag: deceleration grows with velocity squared.
      const speed = p.velocity.length();
      if (speed > 0) p.velocity.addScaledVector(p.velocity, -Math.min(.22, speed * .00028 * dt));
      p.velocity.y -= 9.81 * dt;
      p.position.addScaledVector(p.velocity, dt);
      p.age += dt;
      const contact=state.sweep?.(p.previous,p.position);
      if(contact!==undefined&&contact!==null){p.position.lerpVectors(p.previous,p.position,contact);this.impacts.push({position:p.position.clone(),velocity:p.velocity.clone(),tracer:p.tracer});if(this.impacts.length>64)this.impacts.shift();this.projectiles.splice(i,1);continue;}
      const ground = state.groundHeightAt(p.position.x, p.position.z);
      if (p.position.y <= ground) {
        p.position.y = ground;
        this.impacts.push({ position: p.position.clone(), velocity: p.velocity.clone(), tracer: p.tracer });
        if (this.impacts.length > 64) this.impacts.shift();
        this.projectiles.splice(i, 1);
      } else if (p.age > PROJECTILE_LIFE) this.projectiles.splice(i, 1);
    }
  }

  private fire(state: GunStep) {
    const hot = this.heat * this.heat;
    const spread = .0014 + hot * .013;
    const direction = state.direction.clone().normalize();
    const helper = Math.abs(direction.y) < .9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
    const right = new T.Vector3().crossVectors(direction, helper).normalize();
    const up = new T.Vector3().crossVectors(right, direction).normalize();
    direction.addScaledVector(right, (this.random() - .5) * spread * 2);
    direction.addScaledVector(up, (this.random() - .5) * spread * 2).normalize();
    const position = state.muzzle.clone();
    this.projectiles.push({
      position,
      previous: position.clone(),
      velocity: direction.multiplyScalar(MUZZLE_VELOCITY).add(state.aircraftVelocity),
      age: 0,
      tracer: this.roundsFired % 4 === 0,
    });
    this.roundsFired++;
    this.roundsRemaining--;
    this.heat = Math.min(1, this.heat + .017);
    // A cool, serviced gun is dependable; sustained fire rapidly becomes risky.
    if (this.random() < .00025 + this.heat ** 3 * .023) {
      this.jammed = true;
      this.cocked = false;
      this.trigger = false;
    }
  }
}
