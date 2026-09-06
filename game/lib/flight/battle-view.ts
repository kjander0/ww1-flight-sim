import * as T from 'three';
import { Battle, rackPosition, type Plane } from './battle';
import { AIRCRAFT } from './aircraft';
import { CrashEffects } from './crash';

export function haloStrength(distance:number){
  if(distance<=650)return .06;
  const t=Math.min(1,(distance-650)/950);
  return .06+t*t*(3-2*t)*.54;
}

export function bombModel(){
  const group=new T.Group(),mat=new T.MeshLambertMaterial({color:'#333b30',flatShading:true});
  const body=new T.Mesh(new T.CylinderGeometry(.12,.16,.75,8),mat);body.rotation.x=Math.PI/2;group.add(body);
  const nose=new T.Mesh(new T.ConeGeometry(.12,.2,8),mat);nose.rotation.x=-Math.PI/2;nose.position.z=-.46;group.add(nose);
  for(const angle of[0,Math.PI/2]){const fin=new T.Mesh(new T.BoxGeometry(.42,.025,.25),mat);fin.position.z=.35;fin.rotation.z=angle;group.add(fin);}return group;
}
function aircraftModel(p:Plane){
  const spec=AIRCRAFT[p.sim.aircraftType],g=new T.Group(),body=new T.MeshLambertMaterial({color:spec.color,flatShading:true}),canvas=new T.MeshLambertMaterial({color:spec.canvas,flatShading:true}),dark=new T.MeshLambertMaterial({color:'#28322e'}),team=new T.MeshLambertMaterial({color:p.team==='ALLIED'?'#72b7d4':'#e56749'});
  const box=(size:number[],pos:number[],mat:T.Material)=>{const m=new T.Mesh(new T.BoxGeometry(...size as [number,number,number]),mat);m.position.set(...pos as [number,number,number]);g.add(m);return m;};
  box([1,.8,6*spec.length],[0,-.15,.1],body);for(const y of[-.3,1.48])box([spec.span,.1,1.6],[0,y,-1.4],canvas);
  box([2.5*spec.span/8.8,.08,.9],[0,-.25,4.1*spec.length],canvas);box([.09,1.15,.9],[0,.25,4.1*spec.length],team);
  for(const x of[-spec.span*.35,spec.span*.35]){box([.08,1.8,.08],[x,.6,-1.9],dark);box([.08,1.8,.08],[x,.6,-.9],dark);box([1,.025,.6],[x,1.55,-1.4],team);}
  const prop=box([.12,1.8,.07],[0,0,-3.52],dark);box([.07,.07,2.5],[.34,.5,-2],dark);
  for(const x of[-.76,.76]){const wheel=new T.Mesh(new T.CylinderGeometry(.38,.38,.12,10),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(x,-.77,-1.3);g.add(wheel);}
  if(p.sim.aircraftType==='bomber'){box([.35,.65,.35],[0,.45,2.4],dark);box([.07,.07,1.4],[.2,.65,3.1],dark);}
  const bombs:T.Group[]=[];for(let i=0;i<spec.bombs;i++){const b=bombModel();b.position.copy(rackPosition(i,spec.span));g.add(b);bombs.push(b);}return{g,prop,bombs};
}
export class BattleView {
  private halos=new Map<number,T.Mesh>();
  private root=new T.Group();private models=new Map<number,ReturnType<typeof aircraftModel>&{generation:number;effects:CrashEffects;camera:T.PerspectiveCamera}>();
  private bombMeshes=new Map<number,T.Group>();private blastMeshes=new Map<number,T.Mesh>();
  private blastGeometry=new T.IcosahedronGeometry(1,1);private blastMaterial=new T.MeshBasicMaterial({color:'#f0ae50',transparent:true,opacity:.8,depthWrite:false});
  constructor(private scene:T.Scene,private battle:Battle){scene.add(this.root);for(const p of battle.planes.slice(1)){const model=aircraftModel(p);this.root.add(model.g);this.models.set(p.id,{...model,generation:p.generation,effects:new CrashEffects(scene,battle.surface),camera:new T.PerspectiveCamera()});}}
  update(dt:number,alpha:number,camera?:T.Camera){
    for(const p of this.battle.planes.slice(1)){const m=this.models.get(p.id)!;
      let halo=this.halos.get(p.id);
      if(!halo){halo=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{color:{value:new T.Color(p.team===this.battle.playerTeam?'#35ff67':'#ff352b')},strength:{value:.06}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv; uniform vec3 color; uniform float strength; void main(){float r=length(vUv*2.0-1.0);float a=exp(-pow((r-0.72)/0.12,2.0))*strength;gl_FragColor=vec4(color,a);}'}));this.root.add(halo);this.halos.set(p.id,halo);}
      halo.visible=!p.sim.crashed&&!!camera;halo.position.lerpVectors(p.previous,p.sim.position,alpha);
      if(camera){const distance=camera.position.distanceTo(halo.position);halo.quaternion.copy(camera.quaternion);halo.scale.setScalar(Math.max(p.sim.spec.span*.58,distance*.006));(halo.material as T.ShaderMaterial).uniforms.strength.value=haloStrength(distance);}
      if(m.generation!==p.generation){m.effects.reset();m.g.visible=true;m.generation=p.generation;}
      m.g.position.lerpVectors(p.previous,p.sim.position,alpha);m.g.quaternion.slerpQuaternions(p.rotation,p.sim.orientation,alpha);
      m.prop.rotation.z+=p.sim.rpm*Math.PI/30*dt;m.bombs.forEach((b,i)=>b.visible=i>=p.sim.spec.bombs-p.sim.bombsRemaining);
      if(p.sim.crashed&&!m.effects.active){m.g.position.copy(p.sim.position);m.g.quaternion.copy(p.sim.orientation);m.camera.position.copy(p.sim.position);m.effects.start(m.g,p.sim.impactVelocity,p.sim.impactSpeed,m.camera);}
      m.effects.update(dt,m.camera);
    }
    const active=new Set(this.battle.bombs.map(b=>b.id));for(const[id,m]of this.bombMeshes)if(!active.has(id)){this.disposeObject(m);this.bombMeshes.delete(id);}
    for(const b of this.battle.bombs){let m=this.bombMeshes.get(b.id);if(!m){m=bombModel();this.root.add(m);this.bombMeshes.set(b.id,m);}m.position.lerpVectors(b.previous,b.position,alpha);m.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),b.velocity.clone().normalize());}
    const blasts=new Set(this.battle.blasts.map(b=>b.id));for(const[id,m]of this.blastMeshes)if(!blasts.has(id)){this.root.remove(m);(m.material as T.Material).dispose();this.blastMeshes.delete(id);}
    for(const b of this.battle.blasts){let m=this.blastMeshes.get(b.id);if(!m){m=new T.Mesh(this.blastGeometry,this.blastMaterial.clone());this.root.add(m);this.blastMeshes.set(b.id,m);}m.position.copy(b.position);m.position.y+=b.age*4;m.scale.setScalar(2+Math.min(b.age,1.5)*15);const mat=m.material as T.MeshBasicMaterial;mat.color.set(b.age<.35?'#ffc563':'#595950');mat.opacity=Math.max(0,.8-b.age*.16);}
  }
  private disposeObject(o:T.Object3D){const mats=new Set<T.Material>();o.traverse(c=>{if(c instanceof T.Mesh){c.geometry.dispose();for(const m of Array.isArray(c.material)?c.material:[c.material])mats.add(m);}});mats.forEach(m=>m.dispose());o.removeFromParent();}
  dispose(){for(const m of this.models.values())m.effects.dispose();this.disposeObject(this.root);this.blastGeometry.dispose();this.blastMaterial.dispose();}
}
