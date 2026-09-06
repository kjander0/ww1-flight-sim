import * as T from 'three';
import { AIRFIELDS, CELL_SIZE, GRID_SIZE, Terrain, riverX } from './terrain';
import { SceneryCollisions } from './collisions';
import type { Building } from './battle';

export class WorldView {
  private targets=new Map<string,{intact:T.Group;rubble:T.Mesh}>();
  updateBuildings(buildings:Building[]){for(const b of buildings){const view=this.targets.get(b.id);if(view){view.intact.visible=!b.destroyed;view.rubble.visible=b.destroyed;}}}
  private target(id:string,intact:T.Group,size:number[]){const rubble=this.box(intact.parent!,[size[0],1.5,size[1]],[intact.position.x,.75,intact.position.z],this.material('#393b32'));rubble.visible=false;this.targets.set(id,{intact,rubble});}
  private materials: T.Material[]=[]; private textures:T.Texture[]=[];
  private grass = new T.MeshLambertMaterial({vertexColors:true,flatShading:true});
  constructor(private scene:T.Scene,readonly terrain:Terrain,private collisions:SceneryCollisions) {
    this.materials.push(this.grass);this.buildTerrain();this.buildAirfields();this.buildScenery();
  }
  private material(color:string){const m=new T.MeshLambertMaterial({color,flatShading:true});this.materials.push(m);return m;}
  private box(parent:T.Object3D,size:number[],position:number[],mat:T.Material){const m=new T.Mesh(new T.BoxGeometry(...size as [number,number,number]),mat);m.position.set(...position as [number,number,number]);parent.add(m);return m;}
  private buildTerrain(){
    for(let z=0;z<16;z++)for(let x=0;x<16;x++){
      const lod=new T.LOD();lod.position.set(x*625-4687.5,0,z*625-4687.5);
      for(const [stride,distance] of [[1,0],[2,950],[4,1900],[8,3600]])lod.addLevel(new T.Mesh(this.chunk(x,z,stride),this.grass),distance);
      this.scene.add(lod);
    }
    const vertices:number[]=[],indices:number[]=[];
    for(let i=0;i<=500;i++){const z=i*20-5000,x=riverX(z);vertices.push(x-33,5,z,x+33,5,z);if(i<500){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
    const river=new T.BufferGeometry();river.setAttribute('position',new T.Float32BufferAttribute(vertices,3));river.setIndex(indices);river.computeVertexNormals();
    this.scene.add(new T.Mesh(river,this.material('#547e7b')));
  }
  private chunk(cx:number,cz:number,stride:number){
    const segments=64/stride,positions:number[]=[],colors:number[]=[],indices:number[]=[];
    const palette=['#78844b','#8b9257','#9c9667','#708347','#a5a16e','#879452'].map(c=>new T.Color(c));
    for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++){
      const gx=cx*64+x*stride,gz=cz*64+z*stride,wx=gx*CELL_SIZE-5000,wz=gz*CELL_SIZE-5000;
      const h=this.terrain.heights[gz*GRID_SIZE+gx];positions.push(x*stride*CELL_SIZE-312.5,h,z*stride*CELL_SIZE-312.5);
      const field=Math.abs((Math.floor((wx+5000)/310)*13+Math.floor((wz+5000)/270)*7)%palette.length),c=palette[field];
      const shade=.91+Math.min(.16,h/1100);colors.push(c.r*shade,c.g*shade,c.b*shade);
    }
    for(let z=0;z<segments;z++)for(let x=0;x<segments;x++){const a=z*(segments+1)+x,b=a+1,c=a+segments+1,d=c+1;indices.push(a,c,b,b,c,d);}
    // Vertical skirts hide cracks where neighboring chunks use different LODs.
    const edge:number[]=[];for(let x=0;x<=segments;x++)edge.push(x);for(let z=1;z<=segments;z++)edge.push(z*(segments+1)+segments);for(let x=segments-1;x>=0;x--)edge.push(segments*(segments+1)+x);for(let z=segments-1;z>0;z--)edge.push(z*(segments+1));
    const bottomStart=positions.length/3;
    for(const i of edge){positions.push(positions[i*3],positions[i*3+1]-30,positions[i*3+2]);colors.push(colors[i*3],colors[i*3+1],colors[i*3+2]);}
    for(let k=0;k<edge.length;k++){const n=(k+1)%edge.length;indices.push(edge[k],bottomStart+k,edge[n],edge[n],bottomStart+k,bottomStart+n);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  }
  private buildAirfields(){
    const runway=this.material('#a09a76'),chalk=this.material('#ddd1a4'),timber=this.material('#685a41'),roof=this.material('#424e43'),door=this.material('#202c25');
    AIRFIELDS.forEach((field,index)=>{
      const base=this.terrain.airfieldHeights[index],group=new T.Group();group.position.set(field.x,base,field.z);this.scene.add(group);
      this.box(group,[65,.08,1060],[0,.06,0],runway);
      for(let z=-480;z<=480;z+=45)this.box(group,[1.2,.02,12],[0,.11,z],chalk);
      for(const z of[-500,500])for(const x of[-26,-17,-8,8,17,26])this.box(group,[3,.02,14],[x,.11,z],chalk);
      for(let i=0;i<3;i++){
        const hangar=new T.Group();hangar.position.set(-105,0,240-i*78);group.add(hangar);
        this.box(hangar,[32,11,35],[0,5.5,0],timber);const top=new T.Mesh(new T.CylinderGeometry(0,23,8,4),roof);top.rotation.y=Math.PI/4;top.scale.z=1.1;top.position.y=15;hangar.add(top);
        this.box(hangar,[.15,8.5,25],[16.1,4.25,0],door);
        this.collisions.addHangar(field.x-105,field.z+240-i*78,base);
        this.target(`${index}-${i}`,hangar,[32,35]);
      }
      const tower=new T.Group();tower.position.set(-95,0,-140);group.add(tower);
      for(const x of[-4,4])for(const z of[-4,4])this.box(tower,[.6,17,.6],[x,8.5,z],timber);
      this.box(tower,[11,4,10],[0,17,0],roof);this.box(tower,[11.2,1.5,10.2],[0,17.8,0],this.material('#55716b'));this.box(tower,[13,.6,12],[0,20,0],timber);
      this.collisions.addBox('TOWER',new T.Vector3(field.x-101.5,base,field.z-146),new T.Vector3(field.x-88.5,base+20.3,field.z-134));
      this.target(`${index}-3`,tower,[13,12]);
      this.box(group,[.3,13,.3],[49,6.5,220],timber);this.collisions.addBox('WINDSOCK POLE',new T.Vector3(field.x+48.85,base,field.z+219.85),new T.Vector3(field.x+49.15,base+13,field.z+220.15));
      const sock=new T.Mesh(new T.CylinderGeometry(.65,.25,4,6),this.material('#bd754a'));sock.rotation.z=Math.PI/2;sock.position.set(51,12.6,220);group.add(sock);
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle=field.team==='ALLIED'?'#293f46':'#603f34';ctx.fillRect(0,0,512,128);ctx.fillStyle='#e6dab4';ctx.font='bold 40px monospace';ctx.textAlign='center';ctx.fillText(field.name,256,58);ctx.font='23px monospace';ctx.fillText(`${field.team}  ·  ${base} m`,256,97);
      const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;this.textures.push(map);const signMaterial=new T.MeshBasicMaterial({map,side:T.DoubleSide});this.materials.push(signMaterial);
      const sign=new T.Mesh(new T.PlaneGeometry(24,6),signMaterial);sign.position.set(-105,13,280);group.add(sign);
    });
  }
  private buildScenery(){
    let seed=this.terrain.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=64;const c=canvas.getContext('2d')!;
    c.fillStyle='#594c33';c.fillRect(14,37,4,27);c.fillStyle='#3c553a';c.beginPath();c.moveTo(16,1);c.lineTo(2,29);c.lineTo(8,29);c.lineTo(0,48);c.lineTo(32,48);c.lineTo(24,29);c.lineTo(30,29);c.closePath();c.fill();c.fillStyle='#566b3f';c.beginPath();c.moveTo(16,2);c.lineTo(5,27);c.lineTo(17,24);c.lineTo(11,44);c.lineTo(22,42);c.closePath();c.fill();
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.magFilter=T.NearestFilter;this.textures.push(map);
    const treeMaterial=new T.MeshLambertMaterial({map,alphaTest:.5,side:T.DoubleSide});this.materials.push(treeMaterial);const geometry=new T.PlaneGeometry(11,22),buckets=new Map<string,{x:number;y:number;z:number;scale:number}[]>();
    for(let i=0;i<6500;i++){
      const x=(random()-.5)*9800,z=(random()-.5)*9800;
      const approach=AIRFIELDS.some(f=>Math.abs(x-f.x)<100&&Math.abs(z-f.z)<1500);
      if(approach||this.terrain.nearAirfield(x,z,45)||Math.abs(x-riverX(z))<80||Math.sin(x/260)*Math.cos(z/320)<-.35)continue;
      const scale=.65+random()*.9,y=this.terrain.heightAt(x,z),key=`${Math.floor(x/625)},${Math.floor(z/625)}`;
      const list=buckets.get(key)??[];list.push({x,y,z,scale});buckets.set(key,list);this.collisions.addTree(x,z,scale,y);
    }
    const transform=new T.Object3D();
    for(const list of buckets.values()){
      const trees=new T.InstancedMesh(geometry,treeMaterial,list.length*2);list.forEach((p,i)=>{for(let k=0;k<2;k++){transform.position.set(p.x,p.y+11*p.scale,p.z);transform.scale.setScalar(p.scale);transform.rotation.set(0,k*Math.PI/2,0);transform.updateMatrix();trees.setMatrixAt(i*2+k,transform.matrix);}});trees.computeBoundingSphere();this.scene.add(trees);
    }
    const walls=this.material('#a39a7a'),roof=this.material('#6a5447');
    for(const [vx,vz]of[[-1400,-1000],[-1600,1100],[1500,-700],[1750,1550],[-3700,400],[3700,700]]){
      for(let i=0;i<10;i++){const x=vx+(i%5)*24,z=vz+Math.floor(i/5)*38,y=this.terrain.heightAt(x,z);this.box(this.scene,[12,8,16],[x,y+4,z],walls);const top=new T.Mesh(new T.CylinderGeometry(0,11,5,4),roof);top.rotation.y=Math.PI/4;top.scale.z=1.25;top.position.set(x,y+10.5,z);this.scene.add(top);this.collisions.addBox('BUILDING',new T.Vector3(x-6,y,z-8),new T.Vector3(x+6,y+11,z+8));}
      const f=AIRFIELDS.reduce((best,f)=>Math.hypot(f.x-vx,f.z-vz)<Math.hypot(best.x-vx,best.z-vz)?f:best);
      const pos:number[]=[],idx:number[]=[];for(let i=0;i<=80;i++){const x=vx+(f.x-140-vx)*i/80,z=vz+(f.z-vz)*i/80;for(const dx of[-3,3])pos.push(x+dx,this.terrain.heightAt(x+dx,z)+.1,z);if(i<80){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();this.scene.add(new T.Mesh(g,this.material('#b4a481')));
    }
    const cloud=this.material('#dedcc2');for(let i=0;i<24;i++){const mesh=new T.Mesh(new T.IcosahedronGeometry(1,0),cloud);mesh.position.set((random()-.5)*10000,1200+random()*900,(random()-.5)*10000);mesh.scale.set(260+random()*350,45+random()*70,170);this.scene.add(mesh);}
  }
  dispose(){this.textures.forEach(t=>t.dispose());this.materials.forEach(m=>m.dispose());}
}
