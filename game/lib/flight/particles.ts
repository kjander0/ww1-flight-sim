import * as T from 'three';
import type { EffectEvent, Plane } from './battle';

type Particle={position:T.Vector3;velocity:T.Vector3;color:T.Color;age:number;life:number;size:number;drag:number;gravity:number};
const MAX_PARTICLES=1800;

/** Shared, pooled point-particle renderer for smoke, impacts, debris and blasts. */
export class ParticleEffects {
  private particles:Particle[]=[];
  private geometry=new T.BufferGeometry();
  private positions=new Float32Array(MAX_PARTICLES*3);private colors=new Float32Array(MAX_PARTICLES*3);private sizes=new Float32Array(MAX_PARTICLES);
  private points:T.Points;
  private smokeClock=new Map<number,number>();
  private dustClock=new Map<number,number>();
  private fuelClock=new Map<number,number>();
  constructor(private scene:T.Scene,private ground:(x:number,z:number)=>number,private random:()=>number=Math.random,private isWater:(x:number,z:number)=>boolean=()=>false){
    this.geometry.setAttribute('position',new T.BufferAttribute(this.positions,3));
    this.geometry.setAttribute('color',new T.BufferAttribute(this.colors,3));
    this.geometry.setAttribute('size',new T.BufferAttribute(this.sizes,1));
    const material=new T.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,blending:T.NormalBlending,
      vertexShader:'attribute float size; varying vec3 vColor; void main(){vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(280.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv;}',
      fragmentShader:'varying vec3 vColor; void main(){vec2 p=gl_PointCoord-.5; float d=length(p); if(d>.5)discard; float a=smoothstep(.5,.12,d); gl_FragColor=vec4(vColor,a*.82);}'});
    this.points=new T.Points(this.geometry,material);this.points.frustumCulled=false;scene.add(this.points);
  }
  emit(event:EffectEvent){
    const water=this.isWater(event.position.x,event.position.z)&&event.position.y<=this.ground(event.position.x,event.position.z)+1;
    if(event.kind==='muzzle'){
      const forward=event.velocity.clone().normalize();
      this.burst(event.position,forward.multiplyScalar(7),'#fff2a6',4,.7,.09,.32);
      this.smoke(event.position,'#b7b2a3',1,.22,.45);
    }else if(event.kind==='hit'){
      if(water){this.splash(event.position,7,.65);return;}
      const earth=event.position.y<=this.ground(event.position.x,event.position.z)+.3;
      this.burst(event.position,event.velocity.clone().normalize().multiplyScalar(-8),earth?'#b89a68':'#ffd27a',earth?9:6,.18,.55,earth?1.4:.65);
      if(earth)this.smoke(event.position,'#766f60',3,.45,1.1);
    }else if(event.kind==='damage'){
      this.burst(event.position,event.velocity.clone().multiplyScalar(.12),'#4b4034',10,.3,1.8,1.1);
      this.smoke(event.position,'#77736a',4,.55,1.5);
    }else if(event.kind==='crash'){
      if(water||event.cause==='WATER'){this.splash(event.position,42,2.2);return;}
      const grounded=event.position.y<=this.ground(event.position.x,event.position.z)+2;
      this.burst(event.position,event.velocity.clone().multiplyScalar(.18),grounded?'#c1a16d':'#7b6851',Math.round(18+event.intensity*18),1.2,1.5,1.4);
      this.smoke(event.position,'#3d3e39',Math.round(8+event.intensity*10),1.1,3.4);
      if(event.cause==='PROP STRIKE'||event.cause==='AIRFRAME FAILURE')this.burst(event.position,event.velocity.clone().multiplyScalar(.1),'#ffc45a',16,2.4,.65,.5);
    }else if(water){
      this.splash(event.position,58,3.2);
      this.smoke(event.position,'#d5ddd4',16,1.6,2.4);
    }else{
      this.burst(event.position,new T.Vector3(0,8,0),'#ffb64e',34,1.2,1.1,3.4);
      this.smoke(event.position,'#4a4943',28,2.2,4.5);
      this.burst(event.position,new T.Vector3(0,12,0),'#3c342b',20,1.8,3.2,1.7);
    }
  }
  emitCockpitDamage(camera:T.Camera,carrierVelocity:T.Vector3){
    camera.updateMatrixWorld();
    const forward=camera.getWorldDirection(new T.Vector3()),right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    for(let i=0;i<30;i++){
      const position=camera.position.clone().addScaledVector(forward,.45+this.random()*.55).addScaledVector(right,(this.random()-.5)*.7).addScaledVector(up,(this.random()-.5)*.42);
      const velocity=carrierVelocity.clone().addScaledVector(forward,-4-this.random()*8).addScaledVector(right,(this.random()-.5)*7).addScaledVector(up,(this.random()-.35)*5);
      const color=new T.Color(i%5===0?'#ffd37a':i%3===0?'#9b9a8c':'#6e4d31');
      this.add(position,velocity,color,.025+this.random()*.045,.18+this.random()*.24,.8,1.5);
    }
  }
  update(dt:number,planes:Plane[]){
    for(const plane of planes){
      const s=plane.sim;if(s.crashed)continue;
      if(s.grounded&&s.groundSpeed>4){
        const rate=T.MathUtils.clamp((s.groundSpeed-4)/15,0,1)*9,dust=(this.dustClock.get(plane.id)??0)+dt*rate,count=Math.floor(dust);this.dustClock.set(plane.id,dust-count);
        for(let i=0;i<count;i++){const pos=new T.Vector3((this.random()-.5)*s.spec.span*.22,-.72,1.3+this.random()).applyQuaternion(s.orientation).add(s.position);pos.y=Math.max(pos.y,this.ground(pos.x,pos.z)+.12);this.add(pos,s.velocity.clone().multiplyScalar(.08).add(new T.Vector3((this.random()-.5)*1.4,.6+this.random(),(this.random()-.5)*1.4)),new T.Color('#a99a73'),.45+this.random()*.55,.8+this.random()*.7,.8,-.08);}
      }
      if(s.fuelLeaks>0&&s.fuel>0){
        const rate=10*s.fuelLeaks,clock=(this.fuelClock.get(plane.id)??0)+dt*rate,count=Math.floor(clock);this.fuelClock.set(plane.id,clock-count);
        for(let i=0;i<count;i++){
          const leak=(i+Math.floor(this.random()*s.fuelLeaks))%s.fuelLeaks,x=(leak-(s.fuelLeaks-1)/2)*Math.min(1.1,s.spec.span*.08);
          const pos=new T.Vector3(x,-.22,2.2+.25*(leak%3)).applyQuaternion(s.orientation).add(s.position),trail=new T.Vector3(0,-.25,5+this.random()*3).applyQuaternion(s.orientation);
          this.add(pos,s.velocity.clone().multiplyScalar(.58).add(trail).add(new T.Vector3((this.random()-.5)*.7,(this.random()-.5)*.5,(this.random()-.5)*.7)),new T.Color(i%3===0?'#e8d9a7':'#c7d8c7'),.14+this.random()*.11,.65+this.random()*.55,.18,1.1);
        }
      }
      const damage=Math.max(1-s.health,1-s.airframeHealth),badMix=s.engine==='off'?0:Math.max(0,.62-s.mixtureEfficiency);
      if(damage>=.08||badMix>=.08){
        const rate=2+damage*20+badMix*18,clock=(this.smokeClock.get(plane.id)??0)+dt*rate;
        const count=Math.floor(clock);this.smokeClock.set(plane.id,clock-count);
        const engineXs=s.aircraftType==='bomber'?[-s.spec.span*.18,s.spec.span*.18]:[0];
        for(let i=0;i<count;i++)for(const x of engineXs){
          const pos=new T.Vector3(x,s.aircraftType==='bomber'?.38:.05,-2.05).applyQuaternion(s.orientation).add(s.position);
          const darkness=T.MathUtils.clamp(damage*.95+badMix*.5,0,1),color=new T.Color('#aaa79b').lerp(new T.Color('#202322'),darkness);
          this.add(pos,s.velocity.clone().multiplyScalar(.7).add(new T.Vector3((this.random()-.5)*.8,.65+this.random()*1.2,(this.random()-.5)*.8)),color,.65+damage*1.7,1.7+damage*2.3,.23,-.12);
          if(damage>.58&&this.random()<damage*.16)this.add(pos,s.velocity.clone().multiplyScalar(.55).add(new T.Vector3((this.random()-.5)*2,1+this.random()*2,(this.random()-.5)*2)),new T.Color('#ff9b42'),.16+this.random()*.14,.35+this.random()*.35,.5,3.5);
        }
      }
    }
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.age+=dt;if(p.age>=p.life){this.particles.splice(i,1);continue;}p.velocity.multiplyScalar(Math.exp(-p.drag*dt));p.velocity.y-=p.gravity*dt;p.position.addScaledVector(p.velocity,dt);const floor=this.ground(p.position.x,p.position.z);if(p.position.y<floor){p.position.y=floor;p.velocity.y=Math.abs(p.velocity.y)*.12;p.velocity.multiplyScalar(.65);}}
    const count=Math.min(this.particles.length,MAX_PARTICLES);for(let i=0;i<count;i++){const p=this.particles[i],fade=1-p.age/p.life,ii=i*3;this.positions[ii]=p.position.x;this.positions[ii+1]=p.position.y;this.positions[ii+2]=p.position.z;this.colors[ii]=p.color.r*fade;this.colors[ii+1]=p.color.g*fade;this.colors[ii+2]=p.color.b*fade;this.sizes[i]=p.size*(1+p.age/p.life*.9);}
    this.geometry.setDrawRange(0,count);(this.geometry.attributes.position as T.BufferAttribute).needsUpdate=true;(this.geometry.attributes.color as T.BufferAttribute).needsUpdate=true;(this.geometry.attributes.size as T.BufferAttribute).needsUpdate=true;
  }
  reset(){this.particles.length=0;this.smokeClock.clear();this.dustClock.clear();this.fuelClock.clear();this.geometry.setDrawRange(0,0);}
  dispose(){this.points.removeFromParent();this.geometry.dispose();(this.points.material as T.Material).dispose();}
  private burst(position:T.Vector3,base:T.Vector3,color:string,count:number,speed:number,life:number,size:number){for(let i=0;i<count;i++){const velocity=base.clone().add(new T.Vector3(this.random()-.5,this.random()*.8-.15,this.random()-.5).normalize().multiplyScalar(speed*(.35+this.random())));this.add(position,velocity,new T.Color(color),size*(.65+this.random()*.7),life*(.7+this.random()*.6),.5,7);}}
  private smoke(position:T.Vector3,color:string,count:number,size:number,life:number){for(let i=0;i<count;i++)this.add(position,new T.Vector3((this.random()-.5)*2,1+this.random()*3,(this.random()-.5)*2),new T.Color(color),size*(.7+this.random()),life*(.75+this.random()*.5),.35,-.15);}
  private splash(position:T.Vector3,count:number,size:number){for(let i=0;i<count;i++){const velocity=new T.Vector3((this.random()-.5)*7,4+this.random()*12,(this.random()-.5)*7);this.add(position,velocity,new T.Color(i%4===0?'#f3f1db':'#a7c2bc'),size*(.3+this.random()*.7),.7+this.random()*1.2,.18,8.5);}}
  private add(position:T.Vector3,velocity:T.Vector3,color:T.Color,size:number,life:number,drag:number,gravity:number){if(this.particles.length>=MAX_PARTICLES)this.particles.shift();this.particles.push({position:position.clone(),velocity,color,age:0,life,size,drag,gravity});}
}
