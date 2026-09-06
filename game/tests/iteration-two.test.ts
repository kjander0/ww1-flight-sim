import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { AIRCRAFT, type AircraftType } from '../lib/flight/aircraft';
import { AIRFIELDS, Terrain, GRID_SIZE, CELL_SIZE, riverX } from '../lib/flight/terrain';
import { FlightSimulation, DT, SPEC } from '../lib/flight/simulation';
import { WheelWinder } from '../lib/flight/cockpit';
import { readAttitude } from '../lib/flight/attitude';
import { CrashEffects, debrisCount, stepBody } from '../lib/flight/crash';
import { SceneryCollisions } from '../lib/flight/collisions';
import { WorldView } from '../lib/flight/world';

test('wheels follow circles across angle wrap, ignore hub and reverse immediately at stops',()=>{
  const wheel=new WheelWinder(0);let value=0;
  for(let i=1;i<=90;i++)value=wheel.update(Math.atan2(Math.sin(-i*Math.PI/30),Math.cos(-i*Math.PI/30)),value);
  assert.ok(Math.abs(value-1)<1e-10);
  value=wheel.update(Math.PI-.1,value);assert.equal(value,1);
  value=wheel.update(Math.PI,value);assert.ok(value<1);
  assert.equal(wheel.update(null,value),value);assert.equal(wheel.update(.4,value),value);
  assert.ok(wheel.update(.6,value)<value);
});
test('level instrument measures pitch and bank independently of heading',()=>{
  for(const yaw of[0,.7,2.8]){
    const q=new T.Quaternion().setFromEuler(new T.Euler(.24,yaw,-.45,'YXZ'));
    const a=readAttitude(q);assert.ok(Math.abs(a.pitch-.24)<1e-10);assert.ok(Math.abs(a.roll+.45)<1e-10);
  }
});
test('opening radiator increases drag and slows aircraft at matched flight state',()=>{
  const planes=[0,.5,1].map(radiator=>{const s=new FlightSimulation();s.windEnabled=false;s.grounded=false;s.position.set(0,1000,0);s.velocity.set(0,0,-45);s.controls.radiator=radiator;s.temperature=100;s.step();return s;});
  assert.equal(planes[0].radiatorDrag,0);
  assert.ok(Math.abs(planes[2].radiatorDrag-2*planes[1].radiatorDrag)<1e-8);
  assert.ok(planes[2].drag>planes[0].drag+150);
  assert.ok(planes[2].velocity.length()<planes[0].velocity.length());
  assert.ok(planes[2].temperature<planes[0].temperature);
});
const terrain=new Terrain();
test('seeded 10 km terrain is repeatable and all four runway surfaces are flat',()=>{
  const other=new Terrain();assert.equal(terrain.heights.length,1025*1025);
  for(const [x,z]of[[-4999,4999],[1300,-2800],[-1600,1400],[0,0]])assert.equal(terrain.heightAt(x,z),other.heightAt(x,z));
  assert.ok(Math.max(...terrain.airfieldHeights)-Math.min(...terrain.airfieldHeights)>10);
  AIRFIELDS.forEach((f,i)=>{for(const x of[-100,0,100])for(const z of[-550,0,550])assert.equal(terrain.heightAt(f.x+x,f.z+z),terrain.airfieldHeights[i]);});
  assert.equal(terrain.isWater(riverX(1000),1000),true);
  const ix=480,iz=384,u=.7,v=.8,i=iz*GRID_SIZE+ix;
  const expected=terrain.heights[i+GRID_SIZE+1]+(terrain.heights[i+GRID_SIZE]-terrain.heights[i+GRID_SIZE+1])*(1-u)+(terrain.heights[i+1]-terrain.heights[i+GRID_SIZE+1])*(1-v);
  assert.ok(Math.abs(terrain.heightAt((ix+u)*CELL_SIZE-5000,(iz+v)*CELL_SIZE-5000)-expected)<1e-8);
});
test('every aircraft takes off from every elevated airfield and climbs clear of terrain',t=>{
  for(const type of Object.keys(AIRCRAFT) as AircraftType[])for(let i=0;i<4;i++){
    const s=new FlightSimulation(),f=AIRFIELDS[i];s.aircraftType=type;s.windEnabled=false;s.groundHeightAt=terrain.heightAt;
    s.spawn.set(f.x,terrain.airfieldHeights[i]+SPEC.groundHeight,f.z+400);s.reset();
    Object.assign(s.controls,{ignition:true,throttle:1,brake:false});let distance:number|undefined;
    for(let tick=0;tick<45/DT;tick++){s.controls.pitch=s.indicatedAirspeed*3.6>s.spec.takeoff?.36:0;s.step();if(!s.grounded&&distance===undefined)distance=s.spawn.z-s.position.z;}
    assert.equal(s.crashed,false,`${type} at ${f.name}: ${s.crashCause}`);
    assert.ok(distance!==undefined&&distance<900,`${type} ${f.name}: distance ${distance}`);
    assert.ok(s.position.y>terrain.heightAt(s.position.x,s.position.z)+20,`${type} ${f.name}: clearance ${s.position.y-terrain.heightAt(s.position.x,s.position.z)}`);
    t.diagnostic(`${type} / ${f.name}: liftoff ${distance?.toFixed(0)} m, clearance ${(s.position.y-terrain.heightAt(s.position.x,s.position.z)).toFixed(0)} m at 45 s`);
  }
});
test('each type can touch down gently on an elevated field then take off again',()=>{
  for(const type of Object.keys(AIRCRAFT) as AircraftType[]){
    const s=new FlightSimulation();s.aircraftType=type;s.reset();s.windEnabled=false;s.groundHeightAt=()=>130;
    s.position.set(1400,131.2,1400);s.grounded=false;s.velocity.set(0,-1,-30);s.orientation.setFromEuler(new T.Euler(-.05,0,0));s.controls.brake=true;
    for(let i=0;i<8/DT;i++)s.step();assert.equal(s.crashed,false,type);assert.equal(s.grounded,true);assert.ok(s.velocity.length()<.1);
    Object.assign(s.controls,{ignition:true,throttle:1,brake:false});
    for(let i=0;i<45/DT;i++){s.controls.pitch=s.indicatedAirspeed*3.6>s.spec.takeoff?.36:0;s.step();}
    assert.equal(s.crashed,false,type);assert.ok(s.position.y>151,type);
  }
});
test('terrain impacts retain impact velocity for debris and water crashes reset cleanly',()=>{
  const s=new FlightSimulation();s.groundHeightAt=()=>150;s.position.set(0,151.16,0);s.velocity.set(0,-15,-35);s.grounded=false;s.windEnabled=false;s.step();
  assert.equal(s.crashed,true);assert.ok(s.impactVelocity.length()>30);assert.ok(s.impactSpeed>20);assert.equal(s.velocity.length(),0);
  s.reset();assert.equal(s.impactSpeed,0);assert.equal(s.crashed,false);
  s.position.y=6.16;s.isWaterAt=()=>true;s.velocity.y=-2;s.step();assert.equal(s.crashCause,'WATER');
});
test('elevated scenery collides and bomber wings reach obstacles outside scout span',()=>{
  const c=new SceneryCollisions(),q=new T.Quaternion();c.addTree(0,0,1,100);
  assert.equal(c.sweep(new T.Vector3(0,10,10),new T.Vector3(0,10,-10),q,q),null);
  assert.equal(c.sweep(new T.Vector3(0,105,10),new T.Vector3(0,105,-10),q,q)?.kind,'TREE');
  const wing=new SceneryCollisions();wing.addBox('POLE',new T.Vector3(6.2,0,-5),new T.Vector3(6.3,20,-4.9));
  assert.equal(wing.sweep(new T.Vector3(0,10,0),new T.Vector3(0,10,-10),q,q),null);
  wing.setAircraftScale(14.4/8.8,1.32);assert.equal(wing.sweep(new T.Vector3(0,10,0),new T.Vector3(0,10,-10),q,q)?.kind,'POLE');
});
test('harder crashes create more pieces, throw and roll camera, settle and clean up',()=>{
  const scene=new T.Scene(),aircraft=new T.Group(),camera=new T.PerspectiveCamera(),material=new T.MeshLambertMaterial();
  aircraft.add(new T.Mesh(new T.BoxGeometry(9,.1,1.5),material),new T.Mesh(new T.BoxGeometry(1,1,6),material));aircraft.position.y=3;scene.add(aircraft);
  const fx=new CrashEffects(scene,()=>0);let previous=0;
  for(const speed of[10,30,65]){camera.position.set(0,4,1);camera.quaternion.identity();fx.start(aircraft,new T.Vector3(0,-3,-speed),speed,camera);assert.equal(fx.pieceCount,debrisCount(speed));assert.ok(fx.pieceCount>previous);previous=fx.pieceCount;
    fx.update(0,camera);assert.equal(camera.position.y,4);
    for(let i=0;i<30;i++)fx.update(DT,camera);assert.ok(camera.position.distanceTo(new T.Vector3(0,4,1))>1);assert.ok(camera.quaternion.angleTo(new T.Quaternion())>.4);
    for(let i=0;i<20/DT;i++)fx.update(DT,camera);assert.ok(Math.abs(camera.position.y-.32)<.001);
    const resting=camera.position.clone();fx.update(1,camera);assert.ok(camera.position.distanceTo(resting)<.001);
    fx.reset();assert.equal(fx.active,false);assert.equal(fx.pieceCount,0);
  }
  assert.ok(debrisCount(10000)<=96);fx.dispose();assert.equal(scene.children.length,1);
  aircraft.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});material.dispose();
});
test('detached propeller uses debris physics without throwing the pilot',()=>{
  const scene=new T.Scene(),part=new T.Group(),camera=new T.PerspectiveCamera(),material=new T.MeshLambertMaterial();
  part.add(new T.Mesh(new T.BoxGeometry(.13,1.8,.08),material));part.position.set(0,2,-3);scene.add(part);
  const fx=new CrashEffects(scene,()=>0);const before=camera.position.clone();fx.detach(part,new T.Vector3(0,0,-20),20);
  assert.equal(part.visible,false);assert.equal(fx.active,true);assert.equal(fx.pieceCount,1);fx.update(1,camera);
  assert.equal(camera.position.distanceTo(before),0);fx.reset();assert.equal(part.visible,true);fx.dispose();part.children.forEach(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});material.dispose();
});
test('debris bounces and comes to rest on elevated terrain',()=>{
  const body={position:new T.Vector3(0,100,0),velocity:new T.Vector3(20,-40,10),rotation:new T.Quaternion(),spin:new T.Vector3(2,5,3),radius:.2,asleep:false};
  for(let i=0;i<30/DT;i++)stepBody(body,DT,()=>80);
  assert.equal(body.asleep,true);assert.equal(body.position.y,80.2);assert.equal(body.velocity.length(),0);
});
test('generated world geometry matches airfield heights, covers every chunk, and leaves runway approaches clear',t=>{
  // Canvas drawing is stubbed only for headless geometry/collision checks, not visual QA.
  const context=new Proxy({}, {get:()=>()=>{}});
  const old=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context})}});
  const scene=new T.Scene(),collisions=new SceneryCollisions();let world:WorldView|undefined;
  try{
    world=new WorldView(scene,terrain,collisions);scene.updateMatrixWorld(true);
    const chunks=scene.children.filter(o=>o instanceof T.LOD) as T.LOD[];
    assert.equal(chunks.length,256);assert.ok(collisions.obstacleCount>1000);
    for(const chunk of chunks){assert.equal(chunk.levels.length,4);for(const {object}of chunk.levels){const mesh=object as T.Mesh;assert.ok(Number.isFinite(mesh.geometry.boundingSphere!.radius));}}
    const ray=new T.Raycaster(),q=new T.Quaternion();collisions.setAircraftScale(14.4/8.8,1.32);
    for(let i=0;i<AIRFIELDS.length;i++){
      const f=AIRFIELDS[i],base=terrain.airfieldHeights[i];
      ray.set(new T.Vector3(f.x,base+100,f.z),new T.Vector3(0,-1,0));
      const hits=ray.intersectObjects(chunks.map(c=>c.levels[0].object),false);assert.ok(hits.length);assert.ok(Math.abs(hits[0].point.y-base)<1e-5);
      assert.equal(collisions.sweep(new T.Vector3(f.x,base+1.15,f.z+500),new T.Vector3(f.x,base+1.15,f.z-500),q,q),null);
      for(const sign of[-1,1])assert.equal(collisions.sweep(new T.Vector3(f.x,base+30,f.z+sign*550),new T.Vector3(f.x,base+30,f.z+sign*1400),q,q),null);
      const s=new FlightSimulation();s.aircraftType='bomber';s.windEnabled=false;s.groundHeightAt=terrain.heightAt;s.spawn.set(f.x,base+1.15,f.z+400);s.reset();
      Object.assign(s.controls,{ignition:true,throttle:1,brake:false});
      for(let tick=0;tick<45/DT;tick++){const before=s.position.clone(),rotation=s.orientation.clone();s.controls.pitch=s.indicatedAirspeed*3.6>95?.36:0;s.step();assert.equal(collisions.sweep(before,s.position,rotation,s.orientation),null,`${f.name} takeoff obstacle`);}
    }
    t.diagnostic(`${chunks.length} chunks, four LODs each; ${collisions.obstacleCount} scenery collision proxies.`);
  }finally{world?.dispose();scene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
});
