import * as T from 'three';
import { FlightSimulation, DT, clamp } from './simulation';
import { createFuselage, projectThrottleGrip, throttleAngle, throttleAtPointer, WheelWinder } from './cockpit';
import { AIRCRAFT, AircraftType } from './aircraft';
import { AIRFIELDS, Terrain } from './terrain';
import { WorldView } from './world';
import { CrashEffects } from './crash';
import { horizonMaterial, readAttitude } from './attitude';
export type FlightInfo={aircraftType:AircraftType;airfieldIndex:number;x:number;z:number;heading:number;altitude:number;crashed:boolean};

type Control = 'throttle' | 'mixture' | 'radiator' | 'yoke' | 'ignition' | 'brake';
type Gauge = { needle: T.Group; max: number; read: () => number };
export class FlightGame {
  readonly sim = new FlightSimulation();
  readonly terrain = new Terrain();
  private world: WorldView; private crashEffects: CrashEffects;
  airfieldIndex=0;
  private attitude: T.ShaderMaterial | null=null;
  paused = false;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene(); private cockpit = new T.Scene(); private aircraft = new T.Group();
  private camera = new T.PerspectiveCamera(60, 1, .025, 12000);
  private target = new T.WebGLRenderTarget(640, 360, { minFilter: T.NearestFilter, magFilter: T.NearestFilter });
  private screen = new T.Scene(); private screenCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ray = new T.Raycaster(); private pointer = new T.Vector2();
  private hits: T.Object3D[] = []; private gauges: Gauge[] = [];
  private knobs: Partial<Record<Control, T.Group>> = {}; private keys = new Set<string>();
  private dragging: { name: Control; x: number; y: number; initial: number; pitch: number; roll: number; id: number; grabOffset: T.Vector2; wheel?:WheelWinder } | null = null;
  private dragTarget = new T.Vector2();
  private hover: Control | null = null;
  private yaw = 0; private pitch = -.23; private frame = 0; private last = 0; private accumulator = 0; private reportTime = 0;
  private prevPosition = new T.Vector3(); private prevRotation = new T.Quaternion(); private look = new T.Quaternion();
  private propeller = new T.Group(); private resizeObserver: ResizeObserver;
  private labels: T.Texture[] = []; private fps = 60;
  private toolLifecycle = new AbortController();
  private audio: AudioContext | null = null; private oscillator: OscillatorNode | null = null; private gain: GainNode | null = null;
  constructor(private mount: HTMLElement, private report: (status: string, hint: string, telemetry: string, info:FlightInfo) => void) {
    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.autoClear = false; this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Flight simulator. WASD look; I ignition; B brake; X center yoke; C center view. Drag the cockpit controls with the mouse.');
    mount.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color('#abb9a4'); this.scene.fog = new T.Fog('#abb9a4', 1600, 6500);
    for (const scene of [this.scene, this.cockpit]) {
      scene.add(new T.HemisphereLight('#f4eed2', '#45513a', 2.3));
      const sun = new T.DirectionalLight('#ffe4b5', 2.7); sun.position.set(-150, 250, 60); scene.add(sun);
    }
    this.screen.add(new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: this.target.texture, depthTest: false, depthWrite: false })));
    this.sim.aircraftType=(Object.keys(AIRCRAFT) as AircraftType[])[Math.floor(Math.random()*3)];
    this.airfieldIndex=Math.floor(Math.random()*2);
    this.sim.groundHeightAt=this.terrain.heightAt;this.sim.isWaterAt=(x,z)=>this.terrain.isWater(x,z);
    this.setSpawn();this.sim.reset();
    this.world=new WorldView(this.scene,this.terrain,this.sim.scenery);
    this.crashEffects=new CrashEffects(this.scene,this.terrain.heightAt);
    this.buildAircraft(); this.cockpit.add(this.aircraft);
    this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation);
    this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(mount); this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down); canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up); canvas.addEventListener('pointercancel', this.up); canvas.addEventListener('lostpointercapture', this.up);
    window.addEventListener('keydown', this.keydown); window.addEventListener('keyup', this.keyup); window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    this.registerTools();
    this.frame = requestAnimationFrame(this.animate);
  }
  private material(color: string) { return new T.MeshLambertMaterial({ color, flatShading: true }); }
  private box(parent: T.Object3D, size: number[], position: number[], material: T.Material) {
    const mesh = new T.Mesh(new T.BoxGeometry(size[0], size[1], size[2]), material); mesh.position.set(position[0], position[1], position[2]); parent.add(mesh); return mesh;
  }
  private rod(parent: T.Object3D, start: number[], end: number[], width: number, material: T.Material) {
    const a = new T.Vector3(...start), b = new T.Vector3(...end), delta = b.clone().sub(a);
    const mesh = new T.Mesh(new T.CylinderGeometry(width, width, delta.length(), 5), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); parent.add(mesh); return mesh;
  }
  private texture(width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; draw(ctx);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.magFilter = T.NearestFilter;
    this.labels.push(texture); return texture;
  }
  private label(text: string, x: number, y: number, z: number, width = .25, parent: T.Object3D = this.aircraft) {
    const map = this.texture(256, 48, c => { c.fillStyle = '#242820'; c.fillRect(0, 0, 256, 48); c.fillStyle = '#d7d0ab'; c.font = 'bold 24px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 128, 25); });
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width * 48 / 256), new T.MeshBasicMaterial({ map })); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  private buildAircraft() {
    const spec=this.sim.spec,span=spec.span/8.8;
    const canvas = this.material(spec.canvas), olive = this.material(spec.color), timber = this.material('#70472b'), dark = this.material('#1b2420'), brass = this.material('#b2a06a');
    const wood = this.texture(64, 64, c => { c.fillStyle = '#68472d'; c.fillRect(0, 0, 64, 64); for (let i = 0; i < 32; i++) { c.fillStyle = i % 2 ? '#755436' : '#5b3f2a'; c.fillRect(0, i * 2, 64, 1); } });
    const panelMaterial = new T.MeshLambertMaterial({ map: wood });
    const fuselage=createFuselage(olive);fuselage.children[2].scale.y=spec.length;fuselage.children[2].position.z+=1.35*(spec.length-1);this.aircraft.add(fuselage);
    this.box(this.aircraft, [1.8, .06, 2.5], [0, -.7, .5], dark);
    this.box(this.aircraft, [8.5*span, .095, 1.6], [0, -.3, -1.4], canvas);
    this.box(this.aircraft, [spec.span, .10, 1.55], [0, 1.48, -1.4], canvas);
    this.box(this.aircraft, [2.5*span, .07, .85], [0, -.32, 4.1*spec.length], canvas);
    this.box(this.aircraft, [.07, 1.0, .85], [0, .1, 4.1*spec.length], olive);
    for(const x of[-spec.span*.33,spec.span*.33]){
      if(AIRFIELDS[this.airfieldIndex].team==='ALLIED')for(const [radius,color]of[[.49,'#294963'],[.33,'#e3dec1'],[.16,'#a44f39']] as const){const mark=new T.Mesh(new T.CircleGeometry(radius,20),this.material(color));mark.rotation.x=-Math.PI/2;mark.position.set(x,1.54+( .5-radius)*.008,-1.4);this.aircraft.add(mark);}
      else {this.box(this.aircraft,[.95,.012,.3],[x,1.54,-1.4],dark);this.box(this.aircraft,[.3,.014,1.1],[x,1.54,-1.4],dark);}
    }
    if(this.sim.aircraftType==='bomber'){
      const ring=new T.Mesh(new T.TorusGeometry(.42,.045,6,18),dark);ring.rotation.x=Math.PI/2;ring.position.set(0,.11,2.35);this.aircraft.add(ring);
      this.box(this.aircraft,[.32,.46,.24],[0,.24,2.35],this.material('#534735'));
      const head=new T.Mesh(new T.IcosahedronGeometry(.14,1),this.material('#9d7859'));head.position.set(0,.61,2.35);this.aircraft.add(head);
      this.rod(this.aircraft,[.22,.35,2.5],[.22,.48,3.4],.034,dark);
      for(const x of[-.32,.32])for(const z of[-.8,.2]){const bomb=new T.Mesh(new T.CylinderGeometry(.09,.12,.6,8),dark);bomb.rotation.x=Math.PI/2;bomb.position.set(x,-.75,z);this.aircraft.add(bomb);}
    }
    for (const sign of [-1, 1]) {
      this.rod(this.aircraft, [sign * .4, -.5, -1.4], [sign * .76, -.77, -1.3], .045, dark);
      const wheel = new T.Mesh(new T.CylinderGeometry(.38, .38, .12, 12), dark);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(sign * .76, -.77, -1.3); this.aircraft.add(wheel);
    }
    for (const sign of [-1, 1]) {
      this.box(this.aircraft, [.12, .6, 2.8], [sign * .98, -.24, .2], timber);
      this.rod(this.aircraft, [sign * .94, .1, 1.2], [sign * .94, .23, -.86], .07, timber);
      for (const z of [-1.95, -.85]) { this.rod(this.aircraft, [sign * 3.15*span, -.25, z], [sign * 3.15*span, 1.43, z], .035, timber); this.rod(this.aircraft, [sign * .5, .16, z], [sign * .85, 1.43, z], .025, dark); }
      this.rod(this.aircraft, [sign * .85, 1.4, -1.95], [sign * 3.15*span, -.25, -.85], .008, dark);
      this.rod(this.aircraft, [sign * .85, -.25, -1.95], [sign * 3.15*span, 1.4, -.85], .008, dark);
    }
    this.box(this.aircraft, [1.96, .77, .12], [0, -.065, -.64], panelMaterial);
    this.rod(this.aircraft, [-.98, .34, -.56], [.98, .34, -.56], .045, dark);
    this.label(`${this.sim.spec.name.toUpperCase()}`, 0, .28, -.565, .52);
    const configs: [string, string, number, () => number][] = [
      ['ALTITUDE', 'm', 2000, () => this.sim.position.y], ['AIRSPEED', 'km/h', 240, () => this.sim.indicatedAirspeed * 3.6],
      ['ENGINE', 'RPM', 2400, () => this.sim.rpm], ['COOLANT', '°C', 140, () => this.sim.temperature], ['FUEL', 'litres', this.sim.spec.fuel, () => this.sim.fuel]
    ];
    configs.forEach(([name, unit, max, read], i) => this.gauge(name, unit, max, read, (i<2?i:i+1)*.3-.75, .065, -.56));
    this.attitude=horizonMaterial();const horizon=new T.Mesh(new T.CircleGeometry(.134,40),this.attitude);horizon.position.set(-.15,.065,-.557);this.aircraft.add(horizon);
    const rim=new T.Mesh(new T.TorusGeometry(.135,.009,5,40),brass);rim.position.copy(horizon.position);rim.position.z+=.004;this.aircraft.add(rim);
    const symbol=new T.MeshBasicMaterial({color:'#ecd092'});this.box(this.aircraft,[.08,.009,.003],[-.21,.065,-.55],symbol);this.box(this.aircraft,[.08,.009,.003],[-.09,.065,-.55],symbol);this.box(this.aircraft,[.012,.027,.003],[-.15,.065,-.55],symbol);
    this.label('LEVEL',-.15,-.022,-.547,.13);
    this.label('THROTTLE', -.76, -.22, -.55, .24); this.label('MIXTURE', -.38, -.22, -.55, .24); this.label('RADIATOR', .38, -.22, -.55, .24);
    const lever = new T.Group(); lever.position.set(-.76, -.4, -.48); this.aircraft.add(lever);
    this.rod(lever, [0, 0, 0], [0, .16, .03], .018, brass); this.box(lever, [.12, .06, .055], [0, .16, .03], dark); this.knobs.throttle = lever;
    this.hit('throttle', -.76, -.34, -.39, .23, .28);
    for (const [name, x] of [['mixture', -.38], ['radiator', .38]] as const) {
      const wheel = new T.Group(); wheel.position.set(x, -.34, -.44); this.aircraft.add(wheel);
      wheel.add(new T.Mesh(new T.TorusGeometry(.068, .014, 5, 12), brass));
      this.box(wheel, [.13, .012, .018], [0, 0, 0], brass); this.box(wheel, [.012, .13, .018], [0, 0, 0], brass);
      this.knobs[name] = wheel; this.hit(name, x, -.34, -.40, .24, .22);
    }
    const yoke = new T.Group(); yoke.position.set(0, -.4, -.2); this.aircraft.add(yoke);
    this.rod(yoke, [0, -.25, -.1], [0, .12, 0], .025, dark);
    this.rod(yoke, [-.17, .15, 0], [.17, .15, 0], .024, dark);
    for (const x of [-.17, .17]) this.rod(yoke, [x, .1, 0], [x, .23, 0], .029, timber);
    this.knobs.yoke = yoke; this.hit('yoke', 0, -.27, -.12, .46, .3);
    this.label('IGNITION', .76, -.2, -.54, .25); this.label('BRAKE', .76, -.43, -.54, .22);
    for (const [name, y] of [['ignition', -.29], ['brake', -.49]] as const) {
      const button = new T.Group(); button.position.set(.76, y, -.44);
      const cap = new T.Mesh(new T.CylinderGeometry(.055, .055, .04, 12), name === 'ignition' ? brass : dark); cap.rotation.x = Math.PI / 2; button.add(cap); this.aircraft.add(button); this.knobs[name] = button;
      this.hit(name, .76, y, -.38, .2, .16);
    }
    this.propeller.position.set(0, 0, -3.52); this.box(this.propeller, [.13, 1.8, .08], [0, 0, 0], timber); this.aircraft.add(this.propeller);
  }
  private gauge(name: string, unit: string, max: number, read: () => number, x: number, y: number, z: number) {
    const radius = .134;
    const map = this.texture(256, 256, c => {
      c.fillStyle = '#151e1c'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#596051'; c.lineWidth = 7; c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke();
      const angle = (v: number) => (-225 + v / max * 270) * Math.PI / 180;
      if (unit === 'RPM' || unit === '°C') { c.strokeStyle = unit === 'RPM' ? '#7fa76e' : '#b96043'; c.lineWidth = 10; c.beginPath(); c.arc(128, 128, 104, angle(unit === 'RPM' ? 1550 : 110), angle(unit === 'RPM' ? 1950 : 140)); c.stroke(); }
      for (let i = 0; i <= 12; i++) { const a = angle(max * i / 12); c.strokeStyle = '#d0cbb2'; c.lineWidth = i % 3 === 0 ? 3 : 2; c.beginPath(); c.moveTo(128 + Math.cos(a) * 91, 128 + Math.sin(a) * 91); c.lineTo(128 + Math.cos(a) * 103, 128 + Math.sin(a) * 103); c.stroke(); if (i % 3 === 0) { c.font = '19px monospace'; c.fillStyle = '#e4dec2'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(Math.round(max * i / 12)), 128 + Math.cos(a) * 73, 128 + Math.sin(a) * 73); } }
      c.textAlign = 'center'; c.fillStyle = '#e7dcc0'; c.font = 'bold 17px monospace'; c.fillText(name, 128, 165); c.font = '17px monospace'; c.fillStyle = '#a9b09c'; c.fillText(unit, 128, 186);
    });
    const face = new T.Mesh(new T.CircleGeometry(radius, 40), new T.MeshBasicMaterial({ map })); face.position.set(x, y, z); this.aircraft.add(face);
    const rim = new T.Mesh(new T.TorusGeometry(radius, .009, 5, 40), this.material('#9a8b61')); rim.position.set(x, y, z + .002); this.aircraft.add(rim);
    const needle = new T.Group(); needle.position.set(x, y, z + .007); this.aircraft.add(needle);
    this.box(needle, [.008, radius * .67, .002], [0, radius * .26, 0], new T.MeshBasicMaterial({ color: '#e1bc77' }));
    const hub = new T.Mesh(new T.CircleGeometry(.012, 12), new T.MeshBasicMaterial({ color: '#bcaa75' })); hub.position.set(x, y, z + .012); this.aircraft.add(hub);
    this.gauges.push({ needle, max, read });
  }
  private hit(name: Control, x: number, y: number, z: number, width: number, height: number) {
    const mesh = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ visible: false, side: T.DoubleSide })); mesh.position.set(x, y, z); mesh.userData.control = name; this.aircraft.add(mesh); this.hits.push(mesh);
  }
  private pick(e: PointerEvent): Control | null {
    const r = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera); return this.ray.intersectObjects(this.hits, false)[0]?.object.userData.control ?? null;
  }
  private wheelAngle(name:'mixture'|'radiator') {
    const ray=this.ray.ray.clone().applyMatrix4(this.aircraft.matrixWorld.clone().invert());
    const point=ray.intersectPlane(new T.Plane(new T.Vector3(0,0,1),.44),new T.Vector3());
    if(!point)return null;const x=point.x-(name==='mixture'?-.38:.38),y=point.y+.34;
    return Math.hypot(x,y)<.02?null:Math.atan2(y,x);
  }
  private down = (e: PointerEvent) => {
    if (e.button !== 0 || this.paused || this.sim.crashed) return;
    this.renderer.domElement.focus(); this.startAudio(); const name = this.pick(e); if (!name) return; e.preventDefault();
    if (name === 'ignition' || name === 'brake') { this.sim.controls[name] = !this.sim.controls[name]; return; }
    const grabOffset = new T.Vector2();
    if (name === 'throttle') {
      const rect = this.renderer.domElement.getBoundingClientRect();
      projectThrottleGrip(this.sim.controls.throttle, this.aircraft.matrixWorld, this.camera, rect.width, rect.height, grabOffset);
      grabOffset.x -= e.clientX - rect.left; grabOffset.y -= e.clientY - rect.top;
    }
    this.dragging = { name, x: e.clientX, y: e.clientY, initial: name === 'yoke' ? 0 : this.sim.controls[name], pitch: this.sim.controls.pitch, roll: this.sim.controls.roll, id: e.pointerId, grabOffset, wheel:name==='mixture'||name==='radiator'?new WheelWinder(this.wheelAngle(name)):undefined };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    if (this.paused || this.sim.crashed) { this.up(); return; }
    const d = this.dragging;
    if (d) {
      const scale = Math.max(140, this.mount.clientHeight * .28);
      if (d.name === 'yoke') { this.sim.controls.roll = clamp(d.roll + (e.clientX - d.x) / scale * 2, -1, 1); this.sim.controls.pitch = clamp(d.pitch + (e.clientY - d.y) / scale * 2, -1, 1); }
      else if (d.name === 'throttle') {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.dragTarget.set(e.clientX - rect.left + d.grabOffset.x, e.clientY - rect.top + d.grabOffset.y);
        this.sim.controls.throttle = throttleAtPointer(this.dragTarget, this.aircraft.matrixWorld, this.camera, rect.width, rect.height);
      } else if (d.name === 'mixture' || d.name === 'radiator') {this.pick(e);this.sim.controls[d.name]=d.wheel!.update(this.wheelAngle(d.name),this.sim.controls[d.name]);}
    } else this.hover = this.pick(e);
    this.renderer.domElement.style.cursor = d ? 'grabbing' : this.hover ? 'grab' : 'default';
  };
  private up = () => { const d = this.dragging; this.dragging = null; if (d && this.renderer.domElement.hasPointerCapture(d.id)) this.renderer.domElement.releasePointerCapture(d.id); };
  private keydown = (e: KeyboardEvent) => {
    if (this.paused || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName))) return;
    const k = e.key.toLowerCase(); if (!'wasdicxbr'.includes(k) || k.length !== 1) return; e.preventDefault(); this.keys.add(k);
    if (e.repeat) return;
    if (k === 'i') { this.startAudio(); this.sim.controls.ignition = !this.sim.controls.ignition; }
    if (k === 'b') this.sim.controls.brake = !this.sim.controls.brake;
    if (k === 'c') { this.yaw = 0; this.pitch = -.23; }
    if (k === 'x') { this.sim.controls.pitch = 0; this.sim.controls.roll = 0; }
    if (k === 'r') this.reset();
  };
  private keyup = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private blur = () => { this.keys.clear(); this.up(); };
  private visibility = () => { this.blur(); this.last = 0; this.accumulator = 0; if (document.hidden && this.audio && this.gain) this.gain.gain.setTargetAtTime(0, this.audio.currentTime, .04); };
  private resize = () => { const w = this.mount.clientWidth, h = this.mount.clientHeight; this.renderer.setSize(w, h); this.target.setSize(Math.round(420 * w / h), 420); this.camera.aspect = w / h; this.camera.fov = w / h < 1.3 ? 75 : 60; this.camera.updateProjectionMatrix(); };
  private setSpawn(){const f=AIRFIELDS[this.airfieldIndex];this.sim.spawn.set(f.x,this.terrain.airfieldHeights[this.airfieldIndex]+1.15,f.z+400);}
  reset() { this.crashEffects.reset();this.aircraft.visible=true;this.sim.reset(); this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.yaw = 0; this.pitch = -.23; this.accumulator = 0; this.blur();this.hover=null; }
  startSortie(type:AircraftType,airfieldIndex:number){
    if(!(type in AIRCRAFT)||!Number.isInteger(airfieldIndex)||airfieldIndex<0||airfieldIndex>=AIRFIELDS.length)throw new Error('Invalid aircraft or airfield');
    this.crashEffects.reset();this.releaseAircraft();this.sim.aircraftType=type;this.airfieldIndex=airfieldIndex;this.setSpawn();this.reset();this.buildAircraft();
  }
  private releaseAircraft(){
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();this.aircraft.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.labels.forEach(t=>t.dispose());this.labels=[];this.aircraft.clear();this.gauges=[];this.hits=[];this.knobs={};this.propeller=new T.Group();this.attitude=null;
  }
  private startAudio() {
    if (!this.audio) { this.audio = new AudioContext(); this.oscillator = this.audio.createOscillator(); this.gain = this.audio.createGain(); const filter = this.audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220; this.oscillator.type = 'sawtooth'; this.oscillator.connect(filter); filter.connect(this.gain); this.gain.connect(this.audio.destination); this.gain.gain.value = 0; this.oscillator.start(); }
    void this.audio.resume();
  }
  private registerTools() {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const validateEmpty = (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); };
    const tools: Tool[] = [
      { name: 'read_flight_instruments', description: 'Read the current aircraft instruments and persistent cockpit controls.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: input => { validateEmpty(input); const s = this.sim; return { altitudeMetres: s.position.y, indicatedAirspeedKmh: s.indicatedAirspeed * 3.6, rpm: s.rpm, temperatureC: s.temperature, fuelLitres: s.fuel, stalled: s.stall, crashed: s.crashed, controls: { ...s.controls } }; } },
      { name: 'reset_training_sortie', description: 'Reset the current training flight to its initial parked aircraft with engine off. Discards the current sortie.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async input => { validateEmpty(input); this.reset(); await new Promise(requestAnimationFrame); return { status: 'parked', engine: this.sim.engine, fuelLitres: this.sim.fuel }; } }
    ];
    for (const tool of tools) try { void Promise.resolve(context.registerTool(tool, { signal: this.toolLifecycle.signal })).catch(() => {}); } catch { /* Optional browser capability; flight remains available. */ }
  }
  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.last ? Math.min((now - this.last) / 1000, .1) : 0; this.last = now;
    if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * .04;
    const active = !this.paused && !document.hidden;
    if (active) {
      this.yaw = clamp(this.yaw + ((this.keys.has('a') ? 1 : 0) - (this.keys.has('d') ? 1 : 0)) * elapsed, -2.1, 2.1);
      this.pitch = clamp(this.pitch + ((this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0)) * elapsed, -1.05, .85);
      this.accumulator += elapsed;
      while (this.accumulator >= DT) { this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.sim.step(); this.accumulator -= DT; }
    } else { this.accumulator = 0; this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.blur(); }
    this.aircraft.position.lerpVectors(this.prevPosition, this.sim.position, this.accumulator / DT); this.aircraft.quaternion.slerpQuaternions(this.prevRotation, this.sim.orientation, this.accumulator / DT);
    this.look.setFromEuler(new T.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if(!this.sim.crashed){
      this.camera.position.set(0,.68,1.3).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
    }else{
      if(!this.crashEffects.active){
        this.aircraft.position.copy(this.sim.position);this.aircraft.quaternion.copy(this.sim.orientation);this.aircraft.updateMatrixWorld(true);
        this.camera.position.set(0,.68,1.3).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
        this.crashEffects.start(this.aircraft,this.sim.impactVelocity,this.sim.impactSpeed,this.camera);this.yaw=0;this.pitch=0;this.look.identity();this.up();this.hover=null;
      }
      this.crashEffects.update(active?elapsed:0,this.camera);this.camera.quaternion.multiply(this.look);
    }
    this.camera.updateMatrixWorld();
    for (const g of this.gauges) g.needle.rotation.z = (135 - clamp(g.read() / g.max, 0, 1) * 270) * Math.PI / 180;
    if(this.attitude){const a=readAttitude(this.sim.orientation);this.attitude.uniforms.pitch.value=a.pitch;this.attitude.uniforms.roll.value=a.roll;}
    const c = this.sim.controls;
    this.knobs.throttle!.rotation.x = throttleAngle(c.throttle);
    this.knobs.mixture!.rotation.z = -c.mixture * Math.PI * 3; this.knobs.radiator!.rotation.z = -c.radiator * Math.PI * 3;
    this.knobs.yoke!.rotation.z = -c.roll * .6; this.knobs.yoke!.rotation.x = c.pitch * .45;
    this.knobs.ignition!.position.z = c.ignition ? -.47 : -.44; this.knobs.brake!.position.z = c.brake ? -.44 : -.48;
    if (active) this.propeller.rotation.z += this.sim.rpm * Math.PI / 30 * elapsed;
    this.cockpit.updateMatrixWorld(true);
    this.renderer.setRenderTarget(this.target); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null); this.renderer.clear(); this.renderer.render(this.screen, this.screenCamera); this.renderer.clearDepth(); this.renderer.render(this.cockpit, this.camera);
    if (this.audio && this.oscillator && this.gain) { this.oscillator.frequency.setTargetAtTime(22 + this.sim.rpm / 14, this.audio.currentTime, .12); this.gain.gain.setTargetAtTime(active && this.sim.engine !== 'off' && !this.sim.crashed ? .018 + c.throttle * .015 : 0, this.audio.currentTime, .12); }
    if (now - this.reportTime > 120) {
      this.reportTime = now; const s = this.sim;
      const status = s.crashed ? `CRASHED · ${s.crashCause || 'IMPACT'} · RESET SORTIE` : Math.max(Math.abs(s.position.x),Math.abs(s.position.z))>4800?'MAP EDGE · TURN BACK':s.stall ? 'STALL · LOWER THE NOSE' : s.temperature > 110 ? 'ENGINE HOT · OPEN RADIATOR' : s.grounded ? (s.engine === 'off' ? 'PARKED · ENGINE OFF' : c.brake ? 'ENGINE ' + s.engine.toUpperCase() + ' · BRAKE SET' : 'GROUND ROLL · FREE FLIGHT') : 'AIRBORNE · FREE FLIGHT';
      const control = this.dragging?.name ?? this.hover;
      const value = control === 'yoke' ? `PITCH ${Math.round(c.pitch * 100)}% · ROLL ${Math.round(c.roll * 100)}%` : control === 'ignition' ? c.ignition ? 'ON' : 'OFF' : control === 'brake' ? c.brake ? 'SET — CLICK TO RELEASE' : 'RELEASED' : control ? Math.round(c[control] * 100) + '%' : '';
      const hint = control ? `${control.toUpperCase()} · ${value}${control==='mixture'||control==='radiator'?' · WIND CLOCKWISE TO INCREASE':control==='throttle'||control==='yoke'?' · DRAG TO ADJUST':''}` : s.crashed ? 'Press R or RESET SORTIE to return to the airstrip.' : !c.ignition ? 'Click IGNITION in the cockpit to start your engine.' : c.brake && s.grounded ? 'Release BRAKE, then drag THROTTLE upward.' : s.grounded && s.airspeed*3.6 < s.spec.takeoff ? `Build speed to ${s.spec.takeoff} km/h, then gently pull the yoke toward you.` : 'WASD to look · Drag the yoke to fly · X centers the yoke';
      const attitude=readAttitude(s.orientation);
      this.report(status, hint, `${this.fps.toFixed(0)} FPS · 60 Hz physics\nALT ${s.position.y.toFixed(1)} m  IAS ${(s.indicatedAirspeed * 3.6).toFixed(1)} km/h\nAoA ${(s.alpha * 180 / Math.PI).toFixed(1)}°  V/S ${s.velocity.y.toFixed(1)} m/s\nLIFT ${s.lift.toFixed(0)} N  DRAG ${s.drag.toFixed(0)} N\nRADIATOR DRAG ${s.radiatorDrag.toFixed(0)} N\nROLL ${(attitude.roll*180/Math.PI).toFixed(0)}° PITCH ${(attitude.pitch*180/Math.PI).toFixed(0)}°\nRPM ${s.rpm.toFixed(0)}  TEMP ${s.temperature.toFixed(1)}°C\nFUEL ${s.fuel.toFixed(1)} L  ENGINE ${(s.health * 100).toFixed(0)}%\nPOS ${s.position.x.toFixed(0)}, ${s.position.z.toFixed(0)}`,{aircraftType:s.aircraftType,airfieldIndex:this.airfieldIndex,x:s.position.x,z:s.position.z,heading:-new T.Euler().setFromQuaternion(s.orientation,'YXZ').y*180/Math.PI,altitude:s.position.y,crashed:s.crashed});
    }
  };
  dispose() {
    this.crashEffects.dispose();this.world.dispose();
    this.toolLifecycle.abort();
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.blur();
    const canvas = this.renderer.domElement; canvas.removeEventListener('pointerdown', this.down); canvas.removeEventListener('pointermove', this.move); canvas.removeEventListener('pointerup', this.up); canvas.removeEventListener('pointercancel', this.up); canvas.removeEventListener('lostpointercapture', this.up);
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    for (const scene of [this.scene, this.cockpit, this.screen]) scene.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.labels.forEach(t => t.dispose()); this.target.dispose(); this.renderer.dispose(); canvas.remove(); void this.audio?.close();
  }
}
