import * as T from 'three';
import { Battle, rackPosition, type ParkedPlane, type Team } from './battle';
import { AIRCRAFT, type AircraftType } from './aircraft';
import { CrashEffects } from './crash';
import { ParticleEffects } from './particles';

export function haloStrength(distance:number){
  if(distance<=650)return .06;
  const t=Math.min(1,(distance-650)/950);
  return .06+t*t*(3-2*t)*.54;
}

export function pointRearGunner(mount:T.Object3D,gunner:T.Object3D,direction:T.Vector3,amount=1){
  const aim=direction.clone().normalize(),target=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),aim);
  mount.quaternion.slerp(target,amount);
  const look=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.atan2(aim.x,aim.z));
  gunner.quaternion.slerp(look,Math.min(1,amount*.72));
}

export function bombModel(){
  const group=new T.Group(),mat=new T.MeshLambertMaterial({color:'#333b30',flatShading:true});
  const body=new T.Mesh(new T.CylinderGeometry(.12,.16,.75,8),mat);body.rotation.x=Math.PI/2;group.add(body);
  const nose=new T.Mesh(new T.ConeGeometry(.12,.2,8),mat);nose.rotation.x=-Math.PI/2;nose.position.z=-.46;group.add(nose);
  for(const angle of[0,Math.PI/2]){const fin=new T.Mesh(new T.BoxGeometry(.42,.025,.25),mat);fin.position.z=.35;fin.rotation.z=angle;group.add(fin);}return group;
}
function aircraftModel(type:AircraftType,side:Team,carryBombs=true){
  const spec=AIRCRAFT[type],g=new T.Group(),body=new T.MeshLambertMaterial({color:spec.color,flatShading:true}),canvas=new T.MeshLambertMaterial({color:spec.canvas,flatShading:true}),dark=new T.MeshLambertMaterial({color:'#28322e'}),team=new T.MeshLambertMaterial({color:side==='ALLIED'?'#72b7d4':'#e56749'});
  const rearMount=new T.Group(),rearGunner=new T.Group();
  const box=(size:number[],pos:number[],mat:T.Material)=>{const m=new T.Mesh(new T.BoxGeometry(...size as [number,number,number]),mat);m.position.set(...pos as [number,number,number]);g.add(m);return m;};
  box([1,.8,6*spec.length],[0,-.15,.1],body);for(const y of[-.3,1.48])box([spec.span,.1,1.6],[0,y,-1.4],canvas);
  box([2.5*spec.span/8.8,.08,.9],[0,-.25,4.1*spec.length],canvas);box([.09,1.15,.9],[0,.25,4.1*spec.length],team);
  for(const x of[-spec.span*.35,spec.span*.35]){box([.08,1.8,.08],[x,.6,-1.9],dark);box([.08,1.8,.08],[x,.6,-.9],dark);box([1,.025,.6],[x,1.55,-1.4],team);}
  const prop=new T.Group();g.add(prop);
  if(type==='bomber')for(const x of[-spec.span*.18,spec.span*.18]){
    const nacelle=box([.7,.58,1.7],[x,.38,-1.75],body);nacelle.rotation.x=.02;
    const spinner=new T.Group();spinner.position.set(x,.38,-2.65);prop.add(spinner);spinner.add(box([.11,1.8,.07],[0,0,0],dark));
  }else {const spinner=new T.Group();spinner.position.set(0,0,-3.52);prop.add(spinner);spinner.add(box([.12,1.8,.07],[0,0,0],dark));}
  box([.07,.07,2.5],[.34,.5,-2],dark);
  for(const x of[-.76,.76]){const wheel=new T.Mesh(new T.CylinderGeometry(.38,.38,.12,10),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(x,-.77,-1.3);g.add(wheel);}
  if(type==='bomber'){
    const ring=new T.Mesh(new T.TorusGeometry(.42,.045,6,18),dark);ring.rotation.x=Math.PI/2;ring.position.set(0,.11,2.35);g.add(ring);
    rearGunner.position.set(0,.27,2.35);g.add(rearGunner);
    const torso=new T.Mesh(new T.BoxGeometry(.36,.48,.3),new T.MeshLambertMaterial({color:'#534735',flatShading:true}));torso.position.set(0,.15,.08);rearGunner.add(torso);
    const head=new T.Mesh(new T.IcosahedronGeometry(.14,1),new T.MeshLambertMaterial({color:'#9d7859',flatShading:true}));head.position.set(0,.43,.15);rearGunner.add(head);
    rearMount.position.set(.22,.48,2.45);g.add(rearMount);
    const barrel=new T.Mesh(new T.CylinderGeometry(.034,.034,1.05,5),dark);barrel.rotation.x=Math.PI/2;barrel.position.z=.525;rearMount.add(barrel);
    const receiver=new T.Mesh(new T.BoxGeometry(.13,.12,.28),dark);receiver.position.z=.08;rearMount.add(receiver);
  }
  const bombs:T.Group[]=[];if(carryBombs)for(let i=0;i<spec.bombs;i++){const b=bombModel();b.position.copy(rackPosition(i,spec.span));g.add(b);bombs.push(b);}return{g,prop,bombs,rearMount,rearGunner};
}
function parkedWreck(target:ParkedPlane){
  const g=new T.Group(),spec=AIRCRAFT[target.type],charred=new T.MeshLambertMaterial({color:'#292b26',flatShading:true}),canvas=new T.MeshLambertMaterial({color:'#51483a',flatShading:true});
  const box=(size:number[],pos:number[],mat:T.Material,rotation=0)=>{const m=new T.Mesh(new T.BoxGeometry(...size as [number,number,number]),mat);m.position.set(...pos as [number,number,number]);m.rotation.y=rotation;g.add(m);};
  box([.75,.28,4.1*spec.length],[0,-.82,.2],charred,.12);box([spec.span*.72,.07,1.05],[.35,-.7,-1.25],canvas,-.08);box([spec.span*.28,.06,.7],[-1.8,-.64,2.2],charred,.22);return g;
}
export class BattleView {
  private halos=new Map<number,T.Mesh>();
  private root=new T.Group();private models=new Map<number,ReturnType<typeof aircraftModel>&{generation:number;effects:CrashEffects;camera:T.PerspectiveCamera}>();private parkedModels=new Map<string,{intact:T.Group;wreck:T.Group}>();
  private bombMeshes=new Map<number,T.Group>();private blastMeshes=new Map<number,T.Mesh>();
  private blastGeometry=new T.IcosahedronGeometry(1,1);private blastMaterial=new T.MeshBasicMaterial({color:'#f0ae50',transparent:true,opacity:.8,depthWrite:false});
  private particles:ParticleEffects;
  constructor(private scene:T.Scene,private battle:Battle){scene.add(this.root);this.particles=new ParticleEffects(scene,battle.surface,Math.random,(x,z)=>battle.terrain.isWater(x,z));for(const p of battle.planes.slice(1)){const model=aircraftModel(p.sim.aircraftType,p.team);this.root.add(model.g);this.models.set(p.id,{...model,generation:p.generation,effects:new CrashEffects(scene,battle.surface),camera:new T.PerspectiveCamera()});}for(const target of battle.parkedPlanes){const model=aircraftModel(target.type,target.team,false),wreck=parkedWreck(target);model.g.position.copy(target.position);model.g.quaternion.copy(target.rotation);wreck.position.copy(target.position);wreck.quaternion.copy(target.rotation);wreck.visible=false;this.root.add(model.g,wreck);this.parkedModels.set(target.id,{intact:model.g,wreck});}}
  update(dt:number,alpha:number,camera?:T.Camera){
    let playerHits=0;for(const event of this.battle.consumeEffects()){this.particles.emit(event);if(event.kind==='damage'&&event.targetId===0){playerHits++;if(camera)this.particles.emitCockpitDamage(camera,this.battle.planes[0].sim.velocity);}}this.particles.update(dt,this.battle.planes);
    for(const target of this.battle.parkedPlanes){const model=this.parkedModels.get(target.id)!;model.intact.visible=!target.destroyed;model.wreck.visible=target.destroyed;}
    for(const p of this.battle.planes.slice(1)){const m=this.models.get(p.id)!;
      let halo=this.halos.get(p.id);
      if(!halo){halo=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{color:{value:new T.Color(p.team===this.battle.playerTeam?'#35ff67':'#ff352b')},strength:{value:.06}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv; uniform vec3 color; uniform float strength; void main(){float r=length(vUv*2.0-1.0);float a=exp(-pow((r-0.72)/0.12,2.0))*strength;gl_FragColor=vec4(color,a);}'}));this.root.add(halo);this.halos.set(p.id,halo);}
      halo.visible=!p.sim.crashed&&!!camera;halo.position.lerpVectors(p.previous,p.sim.position,alpha);
      const haloUniforms=(halo.material as T.ShaderMaterial).uniforms;
      haloUniforms.color.value.set(p.team===this.battle.playerTeam?'#35ff67':'#ff352b');
      if(camera){const distance=camera.position.distanceTo(halo.position);halo.quaternion.copy(camera.quaternion);halo.scale.setScalar(Math.max(p.sim.spec.span*.58,distance*.006));haloUniforms.strength.value=haloStrength(distance);}
      if(m.generation!==p.generation){m.effects.reset();m.g.visible=true;m.generation=p.generation;}
      m.g.position.lerpVectors(p.previous,p.sim.position,alpha);m.g.quaternion.slerpQuaternions(p.rotation,p.sim.orientation,alpha);
      if(p.sim.aircraftType==='bomber')pointRearGunner(m.rearMount,m.rearGunner,p.rearAim,Math.min(1,dt*7));
      for(const spinner of m.prop.children)spinner.rotation.z+=p.sim.rpm*Math.PI/30*dt;m.bombs.forEach((b,i)=>b.visible=i>=p.sim.spec.bombs-p.sim.bombsRemaining);
      if(p.sim.crashed&&!m.effects.active){m.g.position.copy(p.sim.position);m.g.quaternion.copy(p.sim.orientation);m.camera.position.copy(p.sim.position);m.effects.start(m.g,p.sim.impactVelocity,p.sim.impactSpeed,m.camera);}
      m.effects.update(dt,m.camera);
    }
    const active=new Set(this.battle.bombs.map(b=>b.id));for(const[id,m]of this.bombMeshes)if(!active.has(id)){this.disposeObject(m);this.bombMeshes.delete(id);}
    for(const b of this.battle.bombs){let m=this.bombMeshes.get(b.id);if(!m){m=bombModel();this.root.add(m);this.bombMeshes.set(b.id,m);}m.position.lerpVectors(b.previous,b.position,alpha);m.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),b.velocity.clone().normalize());}
    const blasts=new Set(this.battle.blasts.map(b=>b.id));for(const[id,m]of this.blastMeshes)if(!blasts.has(id)){this.root.remove(m);(m.material as T.Material).dispose();this.blastMeshes.delete(id);}
    for(const b of this.battle.blasts){let m=this.blastMeshes.get(b.id);if(!m){m=new T.Mesh(this.blastGeometry,this.blastMaterial.clone());this.root.add(m);this.blastMeshes.set(b.id,m);}m.position.copy(b.position);m.position.y+=b.age*4;m.scale.setScalar(2+Math.min(b.age,1.5)*15);const mat=m.material as T.MeshBasicMaterial;mat.color.set(b.age<.35?'#ffc563':'#595950');mat.opacity=Math.max(0,.8-b.age*.16);}
    return playerHits;
  }
  private disposeObject(o:T.Object3D){const mats=new Set<T.Material>();o.traverse(c=>{if(c instanceof T.Mesh){c.geometry.dispose();for(const m of Array.isArray(c.material)?c.material:[c.material])mats.add(m);}});mats.forEach(m=>m.dispose());o.removeFromParent();}
  dispose(){for(const m of this.models.values())m.effects.dispose();this.particles.dispose();this.disposeObject(this.root);this.blastGeometry.dispose();this.blastMaterial.dispose();}
}
