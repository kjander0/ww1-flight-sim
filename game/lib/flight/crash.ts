import * as T from 'three';
export const debrisCount = (speed: number) => 12 + Math.round(Math.min(1, Math.max(0,speed)/70)**1.25 * 84);
type Body = { position: T.Vector3; velocity: T.Vector3; rotation: T.Quaternion; spin: T.Vector3; radius: number; asleep: boolean };
const increment = new T.Quaternion(), angles = new T.Euler();
export function stepBody(body: Body, dt: number, ground: (x:number,z:number)=>number) {
  if (body.asleep) return;
  body.velocity.y -= 9.81*dt; body.velocity.multiplyScalar(Math.exp(-.12*dt)); body.position.addScaledVector(body.velocity,dt);
  increment.setFromEuler(angles.set(body.spin.x*dt,body.spin.y*dt,body.spin.z*dt)); body.rotation.multiply(increment).normalize();
  const floor = ground(body.position.x,body.position.z)+body.radius;
  if (body.position.y<floor) {
    body.position.y=floor; body.velocity.y=Math.abs(body.velocity.y)*.2;
    body.velocity.x*=.65; body.velocity.z*=.65; body.spin.multiplyScalar(.58);
    if (body.velocity.length()<.8 && body.spin.length()<.5) { body.velocity.set(0,0,0); body.spin.set(0,0,0); body.asleep=true; }
  }
}
export class CrashEffects {
  private group = new T.Group(); private bodies: { mesh:T.Mesh; body:Body }[]=[];
  private pilot: Body | null=null; private elapsed=0; private detachedParts:T.Object3D[]=[];
  constructor(private scene:T.Scene, private ground:(x:number,z:number)=>number) { scene.add(this.group); }
  get active() { return this.pilot!==null||this.bodies.length>0; }
  get pieceCount() { return this.bodies.length; }
  start(aircraft:T.Group, impactVelocity:T.Vector3, speed:number, camera:T.PerspectiveCamera) {
    this.reset(); aircraft.updateMatrixWorld(true); let seed=7931;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
    type Fragment={size:T.Vector3; center:T.Vector3; rotation:T.Quaternion; material:T.Material};
    let fragments:Fragment[]=[];
    aircraft.traverse(o=>{
      if (!(o instanceof T.Mesh) || Array.isArray(o.material) || !o.material.visible || !(o.material instanceof T.MeshLambertMaterial)) return;
      o.geometry.computeBoundingBox(); const box=o.geometry.boundingBox!; const size=box.getSize(new T.Vector3()).multiply(o.getWorldScale(new T.Vector3()));
      if(size.x*size.y*size.z<.015)return;
      fragments.push({size,center:o.localToWorld(box.getCenter(new T.Vector3())),rotation:o.getWorldQuaternion(new T.Quaternion()),material:o.material});
    });
    fragments.sort((a,b)=>b.size.x*b.size.y*b.size.z-a.size.x*a.size.y*a.size.z); fragments=fragments.slice(0,Math.min(10,fragments.length));
    const target=debrisCount(speed);
    while(fragments.length && fragments.length<target) {
      fragments.sort((a,b)=>b.size.x*b.size.y*b.size.z-a.size.x*a.size.y*a.size.z);
      const f=fragments.shift()!, axis=f.size.x>f.size.y&&f.size.x>f.size.z?'x':f.size.y>f.size.z?'y':'z';
      const size=f.size.clone();size[axis]*=.5;
      for(const sign of[-1,1]) {const offset=new T.Vector3();offset[axis]=sign*size[axis]/2;offset.applyQuaternion(f.rotation);fragments.push({size:size.clone(),center:f.center.clone().add(offset),rotation:f.rotation.clone(),material:f.material});}
    }
    for(const f of fragments) {
      const mesh=new T.Mesh(new T.BoxGeometry(f.size.x*.94,f.size.y*.94,f.size.z*.94),f.material);this.group.add(mesh);
      const kick=new T.Vector3(random()-.5,random()*.9,random()-.5).multiplyScalar(3+speed*.27);
      const body:Body={position:f.center.clone(),velocity:impactVelocity.clone().multiplyScalar(.2+random()*.45).add(kick),rotation:f.rotation.clone(),spin:new T.Vector3(random()-.5,random()-.5,random()-.5).multiplyScalar(3+speed*.2),radius:Math.max(.06,Math.min(.6,f.size.length()*.22)),asleep:false};
      mesh.position.copy(body.position);mesh.quaternion.copy(body.rotation);this.bodies.push({mesh,body});
    }
    const right=new T.Vector3(1,0,0).applyQuaternion(aircraft.quaternion);
    this.pilot={position:camera.position.clone(),velocity:impactVelocity.clone().multiplyScalar(.4).addScaledVector(right,3+speed*.06).add(new T.Vector3(0,4+speed*.055,0)),rotation:camera.quaternion.clone(),spin:new T.Vector3(.7,-.35,2.3+speed*.025),radius:.32,asleep:false};
    aircraft.visible=false;
  }
  detach(part:T.Object3D, impactVelocity:T.Vector3, speed:number) {
    this.reset();part.updateMatrixWorld(true);
    part.traverse(o=>{
      if(!(o instanceof T.Mesh)||Array.isArray(o.material)||!o.material.visible)return;
      o.geometry.computeBoundingBox();const box=o.geometry.boundingBox!;
      const size=box.getSize(new T.Vector3()).multiply(o.getWorldScale(new T.Vector3()));
      const mesh=new T.Mesh(new T.BoxGeometry(size.x,size.y,size.z),o.material);this.group.add(mesh);
      const body:Body={position:o.localToWorld(box.getCenter(new T.Vector3())),velocity:impactVelocity.clone().multiplyScalar(.35).add(new T.Vector3(1.8,2.5,-1.2)),rotation:o.getWorldQuaternion(new T.Quaternion()),spin:new T.Vector3(7,2,11+speed*.08),radius:Math.max(.06,Math.min(.45,size.length()*.18)),asleep:false};
      mesh.position.copy(body.position);mesh.quaternion.copy(body.rotation);this.bodies.push({mesh,body});
    });
    part.visible=false;this.detachedParts.push(part);
  }
  update(dt:number,camera:T.PerspectiveCamera) {
    if(!this.active)return;
    const count=Math.max(1,Math.ceil(dt/(1/60))),step=dt/count;
    for(let i=0;i<count;i++) { this.elapsed+=step; for(const {body}of this.bodies)stepBody(body,step,this.ground);if(this.pilot){this.pilot.spin.multiplyScalar(Math.exp(-step*.6));stepBody(this.pilot,step,this.ground);} }
    for(const {mesh,body}of this.bodies){mesh.position.copy(body.position);mesh.quaternion.copy(body.rotation);}
    if(this.pilot){camera.position.copy(this.pilot.position);camera.quaternion.copy(this.pilot.rotation);}
  }
  reset(){for(const {mesh}of this.bodies){mesh.geometry.dispose();this.group.remove(mesh);}for(const part of this.detachedParts)part.visible=true;this.bodies=[];this.detachedParts=[];this.pilot=null;this.elapsed=0;}
  dispose(){this.reset();this.scene.remove(this.group);}
}
