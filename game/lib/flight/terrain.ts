import { Vector3 } from 'three';
export const MAP_SIZE = 10000, GRID_SIZE = 1025, CELL_SIZE = MAP_SIZE / (GRID_SIZE - 1);
export const AIRFIELDS = [
  { id: 'montfaucon', name: 'MONTFAUCON', team: 'ALLIED', x: -2800, z: -2300 },
  { id: 'beaumont', name: 'BEAUMONT', team: 'ALLIED', x: -2800, z: 2300 },
  { id: 'adler', name: 'ADLER FELD', team: 'CENTRAL', x: 2800, z: -2300 },
  { id: 'falken', name: 'FALKENHOF', team: 'CENTRAL', x: 2800, z: 2300 },
] as const;
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function hash(x: number, z: number, seed: number) { let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; }
function noise(x: number, z: number, seed: number) { const ix = Math.floor(x), iz = Math.floor(z), a = smooth(x - ix), b = smooth(z - iz); return (hash(ix,iz,seed)*(1-a)+hash(ix+1,iz,seed)*a)*(1-b)+(hash(ix,iz+1,seed)*(1-a)+hash(ix+1,iz+1,seed)*a)*b; }
export const riverX = (z: number) => 190 * Math.sin(z / 740) + 90 * Math.sin(z / 310);
export class Terrain {
  readonly heights = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly airfieldHeights: number[];
  constructor(readonly seed = 1741) {
    this.airfieldHeights = AIRFIELDS.map(f => Math.round(this.base(f.x, f.z)));
    for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) {
      const wx = x * CELL_SIZE - 5000, wz = z * CELL_SIZE - 5000;
      let height = this.base(wx, wz);
      for (let i = 0; i < AIRFIELDS.length; i++) {
        const f = AIRFIELDS[i], edge = Math.max((Math.abs(wx-f.x)-185)/190, (Math.abs(wz-f.z)-680)/220);
        if (edge < 1) height += (this.airfieldHeights[i]-height)*(1-smooth(edge));
      }
      this.heights[z * GRID_SIZE + x] = height;
    }
  }
  private base(x: number, z: number) {
    const broad = 20 + noise(x/1500,z/1500,this.seed)*155 + noise(x/520,z/520,this.seed+1)*34 + noise(x/160,z/160,this.seed+2)*6;
    return 2 + (broad-2)*smooth((Math.abs(x-riverX(z))-35)/270);
  }
  /** Same diagonal and interpolation as each full-detail rendered grid quad. */
  heightAt = (x: number, z: number) => {
    const gx = Math.max(0,Math.min(GRID_SIZE-1.000001,(x+5000)/CELL_SIZE)), gz = Math.max(0,Math.min(GRID_SIZE-1.000001,(z+5000)/CELL_SIZE));
    const ix = Math.floor(gx), iz = Math.floor(gz), u = gx-ix, v = gz-iz, i = iz*GRID_SIZE+ix;
    const a=this.heights[i], b=this.heights[i+1], c=this.heights[i+GRID_SIZE], d=this.heights[i+GRID_SIZE+1];
    return u+v <= 1 ? a+(b-a)*u+(c-a)*v : d+(c-d)*(1-u)+(b-d)*(1-v);
  };
  normalAt(x: number, z: number, out = new Vector3()) { return out.set(this.heightAt(x-2,z)-this.heightAt(x+2,z),4,this.heightAt(x,z-2)-this.heightAt(x,z+2)).normalize(); }
  nearAirfield(x: number, z: number, margin = 0) { return AIRFIELDS.some(f => Math.abs(x-f.x)<190+margin && Math.abs(z-f.z)<690+margin); }
  isWater(x: number, z: number) { return Math.abs(x-riverX(z)) < 33 && this.heightAt(x,z)<5; }
}
