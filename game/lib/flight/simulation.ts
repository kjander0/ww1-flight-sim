import { Vector3, Quaternion, Euler } from 'three';
import { SceneryCollisions } from './collisions';
import { AIRCRAFT, AircraftType } from './aircraft';
export const DT = 1 / 60;
export const BRAKE_DECELERATION = 3.3;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const SPEC = { dryMass: 675, wingArea: 25, fuel: 55, stallAngle: .28, groundHeight: 1.15, maxRpm: 1900 };
export const MIXTURE_MANAGEMENT_ALTITUDE = 2000;
export const RADIATOR_DRAG_COEFFICIENT = .014;
export const PITCH_TRIM_ALPHA = .015;
export const ELEVATOR_ALPHA_RANGE = .30;
export const elevatorForceAuthority = (dynamicPressure: number) => clamp(950 / Math.max(dynamicPressure, 1), .35, 1);
export const pitchInputForAlpha = (alpha: number, dynamicPressure: number) =>
  clamp((alpha - PITCH_TRIM_ALPHA) / (ELEVATOR_ALPHA_RANGE * elevatorForceAuthority(dynamicPressure)), -1, 1);
export function coefficients(alpha: number) {
  const attachedCl = .24 + 4.7 * alpha;
  // Keep the attached-flow polar through the critical angle, then blend into
  // a broadside/flat-plate approximation. The old curve added Cd 0.5 over
  // only nine degrees, which consumed a loop's energy almost instantly.
  const blend = clamp((Math.abs(alpha) - SPEC.stallAngle) / .22, 0, 1);
  const separatedCl = Math.sin(2 * alpha) * .72;
  const cl = attachedCl * (1 - blend) + separatedCl * blend;
  const attachedCd = .043 + .072 * attachedCl * attachedCl;
  const separatedCd = .12 + 1.12 * Math.sin(alpha) ** 2;
  return { cl, cd: attachedCd * (1 - blend) + separatedCd * blend };
}
export function optimalMixture(altitude: number) {
  const climb=clamp(Math.max(0, altitude) / MIXTURE_MANAGEMENT_ALTITUDE,0,1);
  if(climb===0)return .85;
  if(climb===1)return .3;
  return .85-.55*climb;
}
export class FlightSimulation {
  readonly scenery = new SceneryCollisions();
  aircraftType: AircraftType = 'scout';
  bombsRemaining = 0;
  airframeHealth = 1;
  get spec() { return AIRCRAFT[this.aircraftType]; }
  spawn = new Vector3(0, SPEC.groundHeight, 330);
  groundHeightAt: (x:number,z:number)=>number = () => 0;
  isWaterAt: (x:number,z:number)=>boolean = () => false;
  impactVelocity = new Vector3(); impactSpeed = 0; radiatorDrag = 0;
  groundSpeed = 0; lateralSpeed = 0; groundLoad = 0; propClearance = Infinity;
  dynamicPressure = 0; loadFactor = 0; effectiveElevator = 0;
  crashCause = '';
  position = new Vector3(0, SPEC.groundHeight, 330);
  velocity = new Vector3(); orientation = new Quaternion(); rates = new Vector3();
  controls = { throttle: 0, mixture: .85, radiator: .5, pitch: 0, roll: 0, ignition: false, brake: true };
  fuel: number = SPEC.fuel; temperature = 15; health = 1; rpm = 0; time = 0;
  alpha = 0; airspeed = 0; lift = 0; drag = 0; thrust = 0;
  grounded = true; crashed = false; stall = false;
  engine: 'off' | 'starting' | 'running' | 'seized' = 'off';
  windEnabled = true; wind = new Vector3(); mixtureEfficiency = 1;
  private air = new Vector3(); private local = new Vector3(); private forward = new Vector3();
  private right = new Vector3(); private up = new Vector3(); private liftDirection = new Vector3();
  private acceleration = new Vector3(); private inverse = new Quaternion(); private rotation = new Quaternion();
  private angles = new Euler(0, 0, 0, 'YXZ'); private cranking = 0;
  private previousPosition = new Vector3(); private previousOrientation = new Quaternion();
  private groundNormal = new Vector3(0,1,0);
  private propTip = new Vector3(); private skidTime = 0;
  get mass() { return this.spec.dryMass + this.fuel * .72 + this.bombsRemaining * 30; }
  get indicatedAirspeed() { return this.airspeed * Math.sqrt(Math.exp(-Math.max(0, this.position.y) / 8500)); }
  get criticalSpeedKmh() { return this.spec.overspeed * 2; }
  reset() {
    this.position.copy(this.spawn); this.velocity.set(0, 0, 0); this.orientation.identity(); this.rates.set(0, 0, 0);
    this.bombsRemaining=this.spec.bombs;this.airframeHealth=1;
    Object.assign(this.controls, { throttle: 0, mixture: .85, radiator: .5, pitch: 0, roll: 0, ignition: false, brake: true });
    this.fuel = this.spec.fuel; this.temperature = 15; this.health = 1; this.rpm = 0; this.time = 0; this.alpha = 0;
    this.airspeed = 0; this.lift = 0; this.drag = 0; this.thrust = 0; this.grounded = true; this.crashed = false;
    this.stall = false; this.engine = 'off'; this.cranking = 0; this.crashCause = '';
    this.impactSpeed = 0; this.impactVelocity.set(0,0,0); this.radiatorDrag = 0;
    this.groundSpeed = 0; this.lateralSpeed = 0; this.groundLoad = 0; this.propClearance = Infinity; this.skidTime = 0;
    this.dynamicPressure = 0; this.loadFactor = 0; this.effectiveElevator = 0;
    this.scenery.setAircraftScale(this.spec.span/8.8, this.spec.length);
  }
  crash(cause:string, speed=this.velocity.length()) {
    if(this.crashed)return;
    this.impactVelocity.copy(this.velocity); this.impactSpeed=speed;
    this.crashed=true; this.crashCause=cause; this.engine='off'; this.controls.ignition=false;
    this.velocity.set(0,0,0);this.rates.set(0,0,0);this.rpm=0;this.health=0;this.airframeHealth=0;this.thrust=0;
  }
  damage(amount:number){if(this.crashed||amount<=0)return;this.airframeHealth=Math.max(0,this.airframeHealth-amount);this.health=Math.max(0,this.health-amount*.15);if(this.airframeHealth<=0)this.crash('SHOT DOWN');}
  step(dt = DT) {
    if (this.crashed) return;
    this.previousPosition.copy(this.position); this.previousOrientation.copy(this.orientation);
    this.time += dt;
    const c = this.controls;
    if (this.windEnabled) this.wind.set(2 + .35 * Math.sin(this.time * .15), .15 * Math.sin(this.time * .27) * clamp(this.position.y / 40, 0, 1), .25 * Math.sin(this.time * .09));
    else this.wind.set(0, 0, 0);
    this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    this.right.set(1, 0, 0).applyQuaternion(this.orientation);
    this.up.set(0, 1, 0).applyQuaternion(this.orientation);
    this.air.copy(this.velocity).sub(this.wind); this.airspeed = this.air.length();
    if(this.indicatedAirspeed*3.6>=this.criticalSpeedKmh){this.crash('AIRFRAME FAILURE',this.velocity.length());return;}
    this.inverse.copy(this.orientation).invert(); this.local.copy(this.air).applyQuaternion(this.inverse);
    this.alpha = this.airspeed > 3 ? Math.atan2(-this.local.y, -this.local.z) : 0;
    const absoluteAlpha = Math.abs(this.alpha);
    this.stall = !this.grounded && (this.stall ? absoluteAlpha > .22 : absoluteAlpha > SPEC.stallAngle);
    const density = 1.225 * Math.exp(-Math.max(this.position.y, 0) / 8500);
    const mixtureError = (c.mixture - optimalMixture(this.position.y)) / .30;
    this.mixtureEfficiency = Math.exp(-mixtureError * mixtureError * 2);
    if (this.health <= 0) this.engine = 'seized';
    else if (!c.ignition || this.fuel <= 0) { this.engine = 'off'; this.cranking = 0; }
    else if (this.engine === 'off' && this.mixtureEfficiency > .2) { this.engine = 'starting'; this.cranking = 0; }
    if (this.engine === 'starting') { this.cranking += dt; if (this.cranking > 1.4) this.engine = 'running'; }
    const omega = this.rpm * Math.PI / 30;
    const running = this.engine === 'running';
    const engineTorque = running ? (65*this.spec.torque/470 + this.spec.torque * c.throttle) * this.mixtureEfficiency * this.health * (density / 1.225) : this.engine === 'starting' ? 55 : 0;
    const propTorque = .0145 * this.spec.torque/470 * omega * omega / (1 + this.airspeed / 150);
    this.rpm = clamp(this.rpm + (engineTorque - propTorque - omega * .055) / 6 * dt * 30 / Math.PI, 0, 2450);
    if (running && this.mixtureEfficiency < .08) this.engine = 'off';
    this.thrust = (running ? this.spec.thrust : 0) * (this.rpm / 1850) ** 2 / (1 + (this.airspeed / 45) ** 2);
    if (running) this.fuel = Math.max(0, this.fuel - 2 * (.0007 + c.throttle * .007) * this.spec.torque/470 * dt);
    const heating = running ? .16 + c.throttle * .56 + (1 - this.mixtureEfficiency) * .2 : 0;
    const cooling = (this.temperature - 15) * (.0015 + c.radiator * (.0065 + this.airspeed * .0003));
    this.temperature = Math.max(15, this.temperature + (heating - cooling) * dt);
    if (this.temperature > 110) this.health = Math.max(0, this.health - (this.temperature - 110) * .00008 * dt);
    if (this.rpm > 2100) this.health = Math.max(0, this.health - .001 * dt);
    // Prolonged rich/lean running fouls plugs, washes cylinders, or drives a
    // damaging lean burn. A small error is harmless; gross mismanagement is not.
    if (running && this.mixtureEfficiency < .55)
      this.health = Math.max(0, this.health - (.55 - this.mixtureEfficiency) * .006 * dt);
    const aero = coefficients(this.alpha); const q = .5 * density * this.airspeed * this.airspeed;
    this.dynamicPressure = q;
    this.lift = q * this.spec.wingArea * aero.cl;
    this.loadFactor = this.lift / Math.max(1, this.mass * 9.81);
    this.radiatorDrag = q * this.spec.wingArea * c.radiator * RADIATOR_DRAG_COEFFICIENT;
    this.drag = q * this.spec.wingArea * (aero.cd + this.spec.drag-.043) + this.radiatorDrag;
    this.liftDirection.crossVectors(this.right, this.air).normalize();
    this.acceleration.copy(this.forward).multiplyScalar(this.thrust / this.mass);
    this.acceleration.addScaledVector(this.liftDirection, this.lift / this.mass);
    if (this.airspeed > .01) this.acceleration.addScaledVector(this.air, -this.drag / this.mass / this.airspeed);
    this.acceleration.addScaledVector(this.right, -this.local.x * Math.min(1.2, this.airspeed * .03));
    this.acceleration.y -= 9.81;
    this.angles.setFromQuaternion(this.orientation, 'YXZ');
    const authority = clamp((q + this.thrust * .015) / 430, 0, 4);
    // A cable-operated elevator becomes heavy in a fast dive: available pilot
    // force limits deflection, rather than an artificial g or pitch-rate cap.
    const pilotForceAuthority = elevatorForceAuthority(q);
    this.effectiveElevator = c.pitch * pilotForceAuthority;
    const targetAlpha = PITCH_TRIM_ALPHA + this.effectiveElevator * ELEVATOR_ALPHA_RANGE;
    const pitchAcceleration = (targetAlpha - this.alpha) * 5.2 * authority * this.spec.agility
      - this.rates.x * (.9 + authority * .42);
    this.rates.x += pitchAcceleration * dt;
    this.rates.z += (-c.roll * 1.6 * authority * this.spec.agility - this.rates.z * 3.3) * dt;
    const coordinatedYaw = clamp(this.right.y * 9.81 / Math.max(this.airspeed, 16), -.65, .65);
    this.rates.y += (coordinatedYaw - this.rates.y) * Math.min(1, dt * 3);
    if (this.grounded) {
      const x=this.position.x,z=this.position.z;
      this.groundNormal.set(this.groundHeightAt(x-2,z)-this.groundHeightAt(x+2,z),4,this.groundHeightAt(x,z-2)-this.groundHeightAt(x,z+2)).normalize();
      const groundPitch=Math.atan2(-(this.groundNormal.x*this.forward.x+this.groundNormal.z*this.forward.z),this.groundNormal.y);
      const groundRoll=Math.atan2(-(this.groundNormal.x*this.right.x+this.groundNormal.z*this.right.z),this.groundNormal.y);
      this.groundSpeed=Math.hypot(this.velocity.x,this.velocity.z);
      this.lateralSpeed=this.velocity.dot(this.right);
      // A steerable tail skid is useful at taxi speed, but it cannot make a
      // narrow-track taildragger corner like a car. At speed the tyres first
      // scrub, then the undercarriage trips into a ground loop.
      const steerAuthority=clamp(this.groundSpeed/10,0,1) * (.34-.18*clamp((this.groundSpeed-12)/24,0,1));
      const steerTarget=-c.roll*steerAuthority;
      this.rates.y+=(steerTarget-this.rates.y)*Math.min(1,dt*7);
      const lateralDemand=Math.abs(steerTarget*this.groundSpeed);
      this.groundLoad=Math.hypot(lateralDemand,Math.abs(this.lateralSpeed)*1.6);
      const overloaded=this.groundSpeed>20 && this.groundLoad>3.8;
      this.skidTime=overloaded?this.skidTime+dt*Math.min(2,this.groundLoad/3.8):Math.max(0,this.skidTime-dt*2.5);
      const trip=clamp(this.skidTime/.38,0,1);
      this.rates.z = -(this.angles.z-groundRoll) * (6-trip*4) + Math.sign(c.roll||this.lateralSpeed)*trip*.75;
      const groundPitchError=this.angles.x-groundPitch;
      if (this.airspeed < 16) this.rates.x = -groundPitchError * 5;
      // At taxi speed the gear holds the normal three-point attitude. Once
      // airflow builds, forward elevator can lift the tail and pivot the
      // aircraft around its main wheels. Ground support still pushes back,
      // so the nose settles at a load-dependent angle unless the prop hits.
      else if (groundPitchError < 0) {
        const tailLift=clamp(-c.pitch,0,1)*clamp((this.groundSpeed-12)/18,0,1)*.75;
        this.rates.x = Math.max(this.rates.x, -groundPitchError * 5-tailLift);
      }
      this.rates.x = clamp(this.rates.x, -.12, .18);
      if (groundPitchError > .22 && this.rates.x > 0) this.rates.x = 0;
      if(this.skidTime>.38){this.crash('GROUND LOOP',Math.sqrt(this.groundSpeed*this.groundSpeed+this.groundLoad*this.groundLoad));return;}
    }
    this.rotation.setFromEuler(this.angles.set(this.rates.x * dt, this.rates.y * dt, this.rates.z * dt, 'YXZ'));
    this.orientation.multiply(this.rotation).normalize(); this.velocity.addScaledVector(this.acceleration, dt);
    if (this.grounded) {
      const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
      // Strong enough for a landing rollout, but full power can drag the
      // wheels so a forgotten brake no longer pins the aircraft in place.
      const friction = (c.brake ? BRAKE_DECELERATION : .18) * dt;
      if (horizontal > 0) { const scale = Math.max(0, horizontal - friction) / horizontal; this.velocity.x *= scale; this.velocity.z *= scale; }
      // Tyre scrub turns some sideways motion into heat, rather than silently
      // rotating the velocity vector with the fuselage.
      const side=this.velocity.dot(this.right),sideGrip=Math.min(Math.abs(side),3.2*dt);
      this.velocity.addScaledVector(this.right,-Math.sign(side)*sideGrip);
    }
    this.position.addScaledVector(this.velocity, dt);
    const obstacle = this.scenery.sweep(this.previousPosition, this.position, this.previousOrientation, this.orientation);
    if (obstacle) {
      this.position.lerpVectors(this.previousPosition, this.position, Math.max(0, obstacle.time - .0001));
      this.rotation.copy(this.orientation); this.orientation.slerpQuaternions(this.previousOrientation, this.rotation, obstacle.time);
      this.crash(obstacle.kind,this.velocity.length());
      return;
    }
    const x=this.position.x,z=this.position.z,water=this.isWaterAt(x,z);
    const ground=(water?5:this.groundHeightAt(x,z))+SPEC.groundHeight;
    if (this.position.y < ground) {
      this.angles.setFromQuaternion(this.orientation, 'YXZ');
      this.groundNormal.set(this.groundHeightAt(x-2,z)-this.groundHeightAt(x+2,z),4,this.groundHeightAt(x,z-2)-this.groundHeightAt(x,z+2)).normalize();
      const descent=this.velocity.dot(this.groundNormal);
      const touchdownLimit=3.6-.9*clamp((Math.hypot(this.velocity.x,this.velocity.z)-25)/20,0,1);
      if(water || (!this.grounded && (descent < -touchdownLimit || Math.abs(this.angles.z)>.38 || this.angles.x<-.2))) this.crash(water?'WATER':'HARD LANDING',Math.sqrt(descent*descent+this.velocity.lengthSq()*.2));
      this.position.y=ground;this.velocity.addScaledVector(this.groundNormal,Math.max(0,-this.velocity.dot(this.groundNormal)));this.grounded=true;
    } else if (this.position.y > ground + .08) this.grounded = false;
    if(this.grounded&&!this.crashed){
      // The visible blade is 0.9 m long. A small allowance represents blade
      // flex and tyre/suspension travel before a definite strike is registered.
      this.propClearance=Infinity;
      const engines=this.aircraftType==='bomber'?[-this.spec.span*.18,this.spec.span*.18]:[0];
      for(const x of engines)for(const sign of[-1,1]){
        this.propTip.set(x,(this.aircraftType==='bomber'?.38:0)+sign*(this.aircraftType==='bomber'?.9:.78),this.aircraftType==='bomber'?-2.82:-3.52*this.spec.length).applyQuaternion(this.orientation).add(this.position);
        this.propClearance=Math.min(this.propClearance,this.propTip.y-this.groundHeightAt(this.propTip.x,this.propTip.z));
      }
      if(this.propClearance<=0 && (this.rpm>120 || this.groundSpeed>4))this.crash('PROP STRIKE',Math.max(this.groundSpeed,this.rpm/30));
    }else this.propClearance=Infinity;
  }
}
