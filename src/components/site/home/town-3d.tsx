'use client';
import { useEffect, useRef, useState } from 'react';
import { Hand, Minus, Plus, RotateCcw } from 'lucide-react';
import { EXTRA_T } from '@/lib/i18n/reviews-dict';
import { cn } from '@/lib/utils';
import { useI18n, usePlaces } from '../providers';
import { km } from '../place-map';

/**
 * Santa Teresa Gallura as a little 3D model: a rounded slab with the real streets, beaches and
 * green areas drawn on top (OpenStreetMap, prepared once in public/geo/santa-teresa.json) and
 * ~950 real building footprints that grow out of the ground, starting from the hotel — which is
 * the tallest tower, with a pulsing light. Drag to turn it, buttons to zoom.
 *
 * Performance: three.js is loaded only when the section is near the screen; frames are drawn only
 * while it is visible, at ~30 fps when it just turns by itself; one geometry for all buildings.
 */
type Geo = {
  center: { lat: number; lng: number };
  buildings: { p: number[]; h?: number; l?: number }[];
  roads: { k: number; p: number[] }[];
  beaches: number[][];
  green: number[][];
  piers: { w: number; p: number[] }[];
  land: number[][];
};

// the slab, in metres from the hotel (x east, y south)
const MIN_X = -1200;
const MAX_X = 1200;
const MIN_Y = -1150;
const MAX_Y = 750;
const W = MAX_X - MIN_X;
const D = MAX_Y - MIN_Y;
const S = 0.01; // metres → scene units
const V = 3.4; // vertical exaggeration, like a model
const RADIUS = 300;
const HOTEL_H = 64;

type Label = { el: HTMLElement; x: number; y: number; z: number; lw?: number; hotel?: boolean; arrow?: { el: HTMLElement; dx: number; dz: number } };

export function Town3D({ hotel, hint, className }: { hotel: { lat: number; lng: number; name: string }; hint: string; className?: string }) {
  const { locale } = useI18n();
  const places = usePlaces();
  const placesRef = useRef(places);
  placesRef.current = places;
  const x = EXTRA_T[locale];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const api = useRef<{ zoom: (f: number) => void; reset: () => void } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [touched, setTouched] = useState(false);

  const { lat, lng, name } = hotel;
  useEffect(() => {
    const hotel = { lat, lng, name };
    const el = wrap.current;
    if (!el) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || cleanup || disposed) return;
        io.disconnect();
        setState('loading');
        build()
          .then((c) => {
            if (disposed) c();
            else {
              cleanup = c;
              setState('ready');
            }
          })
          .catch((err) => {
            console.warn('3D map', err);
            if (!disposed) setState('error');
          });
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);

    async function build(): Promise<() => void> {
      const [THREE, { mergeGeometries }, geo] = await Promise.all([
        import('three'),
        import('three/examples/jsm/utils/BufferGeometryUtils.js'),
        fetch('/geo/santa-teresa.json').then((r) => {
          if (!r.ok) throw new Error(`geo ${r.status}`);
          return r.json() as Promise<Geo>;
        }),
      ]);
      const cv = canvas.current!;
      const box = wrap.current!;
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      // sky: deep blue up high, warm haze at the horizon (late afternoon)
      const skyTex = (() => {
        const c = document.createElement('canvas');
        c.width = 4;
        c.height = 256;
        const x2 = c.getContext('2d')!;
        const gr = x2.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, '#5f93bb');
        gr.addColorStop(0.18, '#9cc3da');
        gr.addColorStop(0.34, '#f3dcc0');
        gr.addColorStop(1, '#f3dcc0');
        x2.fillStyle = gr;
        x2.fillRect(0, 0, 4, 256);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      scene.background = skyTex;
      scene.fog = new THREE.Fog('#efdcc4', 46, 150);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 500);
      const cx = ((MIN_X + MAX_X) / 2) * S;
      const cz = ((MIN_Y + MAX_Y) / 2) * S;
      const target = new THREE.Vector3(cx * 0.4, 0, cz * 0.35);

      /* ---------- the map drawn on top of the slab ---------- */
      const TW = mobile ? 1536 : 2048;
      const TH = Math.round((TW * D) / W);
      const tc = document.createElement('canvas');
      tc.width = TW;
      tc.height = TH;
      const g = tc.getContext('2d')!;
      const k = TW / W;
      const px = (xm: number) => (xm - MIN_X) * k;
      const py = (ym: number) => (ym - MIN_Y) * k;
      const path = (flat: number[], close: boolean) => {
        g.beginPath();
        for (let i = 0; i < flat.length; i += 2) {
          const a = px(flat[i]!);
          const b = py(flat[i + 1]!);
          if (i) g.lineTo(a, b);
          else g.moveTo(a, b);
        }
        if (close) g.closePath();
      };
      const sea = g.createRadialGradient(TW * 0.5, TH * 0.15, 10, TW * 0.5, TH * 0.4, TW * 0.75);
      sea.addColorStop(0, '#a9d3dc');
      sea.addColorStop(1, '#7fb0c2');
      g.fillStyle = sea;
      g.fillRect(0, 0, TW, TH);
      // gentle wave lines on the sea
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.2;
      for (let y = 8; y < TH; y += 14) {
        g.beginPath();
        for (let xx = 0; xx <= TW; xx += 24) g.lineTo(xx, y + Math.sin(xx * 0.02 + y) * 2.2);
        g.stroke();
      }
      // shallow water along the coast, then the land
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [w, c] of [[44, 'rgba(206,236,238,0.35)'], [22, 'rgba(225,245,244,0.55)']] as const) {
        g.strokeStyle = c;
        g.lineWidth = w * k;
        for (const r of geo.land) {
          path(r, true);
          g.stroke();
        }
      }
      g.fillStyle = '#f1e7d3';
      for (const r of geo.land) {
        path(r, true);
        g.fill();
      }
      g.fillStyle = 'rgba(176,192,150,0.55)';
      for (const r of geo.green) {
        path(r, true);
        g.fill();
      }
      g.fillStyle = '#f4dfae';
      for (const r of geo.beaches) {
        path(r, true);
        g.fill();
      }
      for (const p of geo.piers) {
        g.strokeStyle = '#d9d2c3';
        g.lineWidth = p.w * k;
        path(p.p, false);
        g.stroke();
      }
      const ROAD_W = [0, 9, 7.5, 5.5, 3.6, 4.2, 1.7];
      for (const pass of ['case', 'fill'] as const) {
        for (const r of [...geo.roads].sort((a, b) => b.k - a.k)) {
          if (pass === 'case' && r.k > 4) continue;
          g.strokeStyle = pass === 'case' ? '#c8b18a' : r.k <= 2 ? '#fffaf0' : r.k >= 6 ? 'rgba(186,166,128,0.95)' : '#ffffff';
          g.lineWidth = (ROAD_W[r.k]! * 1.15 + (pass === 'case' ? 3.2 : 0)) * k;
          g.setLineDash(r.k >= 6 && pass === 'fill' ? [3 * k, 2.5 * k] : []);
          path(r.p, false);
          g.stroke();
        }
      }
      g.setLineDash([]);
      g.save();
      g.translate(TW / 2, TH / 2);
      g.scale(1, TH / TW);
      const fade = g.createRadialGradient(0, 0, TW * 0.34, 0, 0, TW * 0.5);
      fade.addColorStop(0, 'rgba(127,176,194,0)');
      fade.addColorStop(1, 'rgba(127,176,194,1)');
      g.fillStyle = fade;
      g.fillRect(-TW, -TW, TW * 2, TW * 2);
      g.restore();
      const tex = new THREE.CanvasTexture(tc);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

      /* ---------- the slab: rounded rectangle with soft edges ---------- */
      const roundRect = (x0: number, y0: number, w: number, h: number, r: number) => {
        const s = new THREE.Shape();
        s.moveTo(x0 + r, y0);
        s.lineTo(x0 + w - r, y0);
        s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
        s.lineTo(x0 + w, y0 + h - r);
        s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
        s.lineTo(x0 + r, y0 + h);
        s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
        s.lineTo(x0, y0 + r);
        s.quadraticCurveTo(x0, y0, x0 + r, y0);
        return s;
      };
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * S, D * S), new THREE.MeshLambertMaterial({ map: tex }));
      ground.geometry.rotateX(-Math.PI / 2);
      ground.position.set(cx, 0, cz);
      ground.receiveShadow = true;
      scene.add(ground);
      const ocean = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ color: '#7fb0c2' }));
      ocean.geometry.rotateX(-Math.PI / 2);
      ocean.position.set(cx, -0.012, cz);
      scene.add(ocean);

      // where the hotel really is (the data is centred on the town square)
      const M_LNG = 111320 * Math.cos((geo.center.lat * Math.PI) / 180);
      const HX = (hotel.lng - geo.center.lng) * M_LNG;
      const HY = (geo.center.lat - hotel.lat) * 111320;

      /* ---------- buildings: one geometry, growing from the hotel outwards ---------- */
      const inside = (xm: number, ym: number, pad: number) => {
        const ix = Math.max(MIN_X + RADIUS, Math.min(MAX_X - RADIUS, xm));
        const iy = Math.max(MIN_Y + RADIUS, Math.min(MAX_Y - RADIUS, ym));
        return Math.hypot(xm - ix, ym - iy) <= RADIUS - pad;
      };
      const rnd = (i: number) => {
        const s = Math.sin(i * 12.9898) * 43758.5453;
        return s - Math.floor(s);
      };
      const parts: InstanceType<typeof THREE.ExtrudeGeometry>[] = [];
      const maxDist = Math.hypot(W, D) / 2;
      const ivory = new THREE.Color('#fbf6ec');
      const warm = new THREE.Color('#efe0c8');
      const roofs = [new THREE.Color('#c98d6c'), new THREE.Color('#f7f1e6'), new THREE.Color('#e8dcc8')];
      for (let n = 0; n < geo.buildings.length; n++) {
        const b = geo.buildings[n]!;
        let sx = 0;
        let sy = 0;
        const m = b.p.length / 2;
        for (let i = 0; i < b.p.length; i += 2) {
          sx += b.p[i]!;
          sy += b.p[i + 1]!;
        }
        sx /= m;
        sy /= m;
        if (!inside(sx, sy, 40) || Math.hypot(sx - HX, sy - HY) < 30) continue;
        const h = Math.min(30, b.h ?? (b.l ? b.l * 3.2 : 6 + Math.floor(rnd(n) * 3) * 3)) * V * S;
        const shape = new THREE.Shape();
        for (let i = 0; i < b.p.length; i += 2) {
          if (i) shape.lineTo(b.p[i]! * S, -b.p[i + 1]! * S);
          else shape.moveTo(b.p[i]! * S, -b.p[i + 1]! * S);
        }
        const eg = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
        eg.rotateX(-Math.PI / 2);
        const pos = eg.attributes.position!;
        const count = pos.count;
        const delay = new Float32Array(count).fill((Math.hypot(sx - HX, sy - HY) / maxDist) * 0.75 + rnd(n + 7) * 0.08);
        const col = new Float32Array(count * 3);
        const wall = ivory.clone().lerp(warm, rnd(n + 3) * 0.7);
        const roof = roofs[Math.floor(rnd(n + 11) * 3)]!;
        const nrm = eg.attributes.normal!;
        for (let i = 0; i < count; i++) {
          const top = nrm.getY(i) > 0.5;
          const yv = pos.getY(i) / Math.max(h, 1e-6);
          const c = top ? roof : wall.clone().multiplyScalar(0.72 + 0.28 * yv); // darker at the foot (fake ambient occlusion)
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
        }
        eg.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
        eg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        eg.deleteAttribute('uv');
        parts.push(eg);
        if (parts.length % 160 === 0) await new Promise((r) => setTimeout(r, 0)); // keep scrolling smooth
      }
      const townGeo = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      const progress = { value: reduced ? 1.2 : 0 };
      const grow = (mat: InstanceType<typeof THREE.Material>) => {
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uProgress = progress;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aDelay;\nuniform float uProgress;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat kk = clamp((uProgress - aDelay) / 0.28, 0.0, 1.0);\nkk = 1.0 - pow(1.0 - kk, 3.0);\ntransformed.y *= max(kk, 0.002);');
        };
      };
      const townMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      grow(townMat);
      const town = new THREE.Mesh(townGeo, townMat);
      town.castShadow = true;
      town.receiveShadow = true;
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      grow(depthMat);
      town.customDepthMaterial = depthMat;
      scene.add(town);

      /* ---------- greenery: Mediterranean pines and scrub where the map is green or open land ---------- */
      const SW = 420;
      const SH = Math.round((SW * D) / W);
      const sc2 = document.createElement('canvas');
      sc2.width = SW;
      sc2.height = SH;
      const q = sc2.getContext('2d', { willReadFrequently: true })!;
      const ks = SW / W;
      const qpath = (flat: number[], close: boolean) => {
        q.beginPath();
        for (let i = 0; i < flat.length; i += 2) {
          const a = (flat[i]! - MIN_X) * ks;
          const b = (flat[i + 1]! - MIN_Y) * ks;
          if (i) q.lineTo(a, b);
          else q.moveTo(a, b);
        }
        if (close) q.closePath();
      };
      q.fillStyle = '#000';
      q.fillRect(0, 0, SW, SH);
      q.fillStyle = '#f00';
      for (const r of geo.land) (qpath(r, true), q.fill());
      q.fillStyle = '#0f0';
      for (const r of geo.green) (qpath(r, true), q.fill());
      q.strokeStyle = '#00f';
      q.lineWidth = 2;
      for (const r of geo.roads) (qpath(r.p, false), q.stroke());
      q.fillStyle = '#00f';
      for (const r of geo.beaches) (qpath(r, true), q.fill());
      for (const b of geo.buildings) (qpath(b.p, true), q.fill(), q.stroke());
      const pix = q.getImageData(0, 0, SW, SH).data;
      const trees: { x: number; z: number; s: number; d: number; c: number }[] = [];
      const treeCount = mobile ? 420 : 850;
      for (let n = 0; n < treeCount * 9 && trees.length < treeCount; n++) {
        const u = rnd(n * 3 + 1);
        const v = rnd(n * 7 + 2);
        const xm = MIN_X + u * W;
        const ym = MIN_Y + v * D;
        const i4 = (Math.floor(v * SH) * SW + Math.floor(u * SW)) * 4;
        const red = pix[i4]! > 128 && pix[i4 + 2]! < 128;
        const green = pix[i4 + 1]! > 128;
        if (!(green ? rnd(n + 5) < 0.9 : red ? rnd(n + 5) < 0.05 : false)) continue;
        if (Math.hypot(xm - HX, ym - HY) < 45) continue;
        // fewer trees towards the borders, where the map fades into the sea
        const edge = Math.max(Math.abs(u - 0.5) * 2, Math.abs(v - 0.5) * 2);
        if (edge > 0.82 && rnd(n + 9) < (edge - 0.82) * 6) continue;
        trees.push({ x: xm * S, z: ym * S, s: 0.75 + rnd(n + 13) * 0.6, d: (Math.hypot(xm - HX, ym - HY) / maxDist) * 0.75 + 0.1, c: rnd(n + 17) });
      }
      const treeGeo = new THREE.ConeGeometry(0.05, 0.2, 6);
      treeGeo.translate(0, 0.1, 0);
      const delays = new Float32Array(trees.length);
      const treeMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      grow(treeMat);
      const forest = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
      const m4 = new THREE.Matrix4();
      const greens = ['#6f8f52', '#7d9c5c', '#8aa866', '#5f7f47', '#94ad6c'].map((c) => new THREE.Color(c));
      trees.forEach((t, i) => {
        m4.makeScale(t.s, t.s * (0.9 + rnd(i + 3) * 0.5), t.s);
        m4.setPosition(t.x, 0, t.z);
        forest.setMatrixAt(i, m4);
        forest.setColorAt(i, greens[Math.floor(t.c * greens.length)]!);
        delays[i] = t.d;
      });
      treeGeo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delays, 1));
      forest.castShadow = true;
      const treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      grow(treeDepth);
      forest.customDepthMaterial = treeDepth;
      scene.add(forest);

      /* ---------- the hotel: a white house with a gold roof, and a map pin floating above it ---------- */
      const hotelGroup = new THREE.Group();
      const houseH = HOTEL_H * V * S * 0.62;
      const houseGeo = new THREE.ExtrudeGeometry(roundRect(-16 * S, -11 * S, 32 * S, 22 * S, 6 * S), { depth: houseH, bevelEnabled: true, bevelThickness: 1 * S, bevelSize: 1 * S, bevelSegments: 2, curveSegments: 8 });
      houseGeo.rotateX(-Math.PI / 2);
      const house = new THREE.Mesh(houseGeo, new THREE.MeshStandardMaterial({ color: '#fbf6ee', roughness: 0.7 }));
      house.castShadow = true;
      house.receiveShadow = true;
      hotelGroup.add(house);
      const roofGeo = new THREE.ExtrudeGeometry(roundRect(-17 * S, -12 * S, 34 * S, 24 * S, 7 * S), { depth: 2.2 * V * S, bevelEnabled: false, curveSegments: 8 });
      roofGeo.rotateX(-Math.PI / 2);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#b69562', roughness: 0.35, metalness: 0.45 }));
      roof.position.y = houseH;
      roof.castShadow = true;
      hotelGroup.add(roof);
      // gold outline on the ground: "this is us"
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.38, 64), new THREE.MeshBasicMaterial({ color: '#b69562', transparent: true, opacity: 0.95, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.006;
      hotelGroup.add(ring);
      // the pin: navy drop with a gold ring and an ivory centre, gently floating
      const pin = new THREE.Group();
      const navy = new THREE.MeshStandardMaterial({ color: '#10283d', roughness: 0.35, metalness: 0.2 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 20), navy);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 32), navy);
      tip.rotation.x = Math.PI;
      tip.position.y = -0.24;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.028, 12, 48), new THREE.MeshStandardMaterial({ color: '#c9a66b', roughness: 0.3, metalness: 0.7 }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12), new THREE.MeshStandardMaterial({ color: '#f8f5ee', roughness: 0.5 }));
      dot.position.z = 0.15;
      halo.rotation.x = 0;
      head.castShadow = tip.castShadow = true;
      pin.add(head, tip, halo, dot);
      const pinBase = houseH + 0.9;
      pin.position.y = pinBase;
      hotelGroup.add(pin);
      hotelGroup.scale.y = reduced ? 1 : 0.001;
      hotelGroup.position.set(HX * S, 0, HY * S);
      scene.add(hotelGroup);
      const hotelTop = pinBase + 0.32;

      /* ---------- places: pins on the model, arrows on the edge for the far ones ---------- */
      const labels: Label[] = [];
      const lbRoot = labelsRef.current!;
      lbRoot.textContent = '';
      const addLabel = (html: string, cls: string, x3: number, y3: number, z3: number, extra: Partial<Label> = {}) => {
        const el = document.createElement('div');
        el.className = cls;
        el.innerHTML = html;
        lbRoot.appendChild(el);
        const l: Label = { el, x: x3, y: y3, z: z3, ...extra };
        labels.push(l);
        return l;
      };
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      addLabel(`<span class="t3-hotel"><b>${esc(hotel.name)}</b></span>`, 't3-label', HX * S, hotelTop + 0.3, HY * S, { hotel: true });
      const pinMat = new THREE.MeshStandardMaterial({ color: '#b69562', roughness: 0.35, metalness: 0.5 });
      const stickMat = new THREE.MeshBasicMaterial({ color: '#10283d' });
      const mLng = M_LNG;
      placesRef.current.forEach((p, i) => {
        const xm = (p.lng - geo.center.lng) * mLng;
        const ym = (geo.center.lat - p.lat) * 111320;
        if (Math.hypot(xm - HX, ym - HY) < 60) return; // too close to the hotel to show apart
        const dist = km(hotel, p).toLocaleString(locale, { maximumFractionDigits: 1 });
        if (inside(xm, ym, 60)) {
          const hgt = 38 * V * S;
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, hgt, 6), stickMat);
          stick.position.set(xm * S, hgt / 2, ym * S);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), pinMat);
          head.position.set(xm * S, hgt, ym * S);
          head.castShadow = true;
          scene.add(stick, head);
          addLabel(`<span class="t3-place"><i>${i + 1}</i><b>${esc(p.name)}</b><em>${dist} km</em></span>`, 't3-label', xm * S, hgt + 0.32, ym * S);
        } else {
          // where the slab border meets the line hotel → place
          const ang = Math.atan2(ym - (MIN_Y + MAX_Y) / 2, xm - (MIN_X + MAX_X) / 2);
          const hx = (W / 2 - 70) / Math.abs(Math.cos(ang) || 1e-6);
          const hy = (D / 2 - 70) / Math.abs(Math.sin(ang) || 1e-6);
          const r = Math.min(hx, hy);
          const ex = (MIN_X + MAX_X) / 2 + Math.cos(ang) * r;
          const ey = (MIN_Y + MAX_Y) / 2 + Math.sin(ang) * r;
          const l = addLabel(`<span class="t3-edge"><i>→</i>${esc(p.name)}<em>${dist} km</em></span>`, 't3-label', ex * S, 0.35, ey * S);
          const len = Math.hypot(xm - ex, ym - ey) || 1;
          l.arrow = { el: l.el.querySelector('i')!, dx: ((xm - ex) / len) * 2, dz: ((ym - ey) / len) * 2 };
        }
      });

      /* ---------- light: late-afternoon sun ---------- */
      scene.add(new THREE.HemisphereLight('#fff7ea', '#6f8fa0', 1.35));
      const sun = new THREE.DirectionalLight('#ffe1b5', 2.3);
      sun.position.set(-10, 12, -6);
      const sunTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const x2 = c.getContext('2d')!;
        const gr = x2.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(255,248,226,1)');
        gr.addColorStop(0.16, 'rgba(255,232,180,1)');
        gr.addColorStop(0.4, 'rgba(255,205,140,0.35)');
        gr.addColorStop(1, 'rgba(255,205,140,0)');
        x2.fillStyle = gr;
        x2.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
      sunDisc.position.set(cx - 140, 24, cz - 120);
      sunDisc.scale.setScalar(34);
      scene.add(sunDisc);
      sun.castShadow = true;
      sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
      const sc = sun.shadow.camera;
      sc.left = -15;
      sc.right = 15;
      sc.top = 13;
      sc.bottom = -13;
      sc.near = 1;
      sc.far = 45;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
      scene.add(sun);

      /* ---------- camera: orbit around the town ---------- */
      const cam = { az: -0.55, pol: 1.16, dist: 40 };
      const want = { az: -0.55, pol: 1.16, dist: 40 };
      const INTRO = { az: -1.3, pol: 0.38, dist: 60 };
      if (!reduced) Object.assign(cam, INTRO);
      let fitK = 1;
      const place = () => {
        const d = cam.dist * fitK;
        camera.position.set(target.x + d * Math.sin(cam.pol) * Math.sin(cam.az), target.y + d * Math.cos(cam.pol), target.z + d * Math.sin(cam.pol) * Math.cos(cam.az));
        camera.lookAt(target);
      };
      const resize = () => {
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        // small screens: numbers only on the pins, names only for the far places
        lbRoot.classList.toggle('t3-compact', w < 520);
        labels.forEach((l) => (l.lw = 0));
        camera.aspect = w / h;
        fitK = camera.aspect < 1.15 ? 1.25 / Math.max(0.6, camera.aspect) : 1;
        camera.updateProjectionMatrix();
        dirty = true;
      };

      /* ---------- interaction ---------- */
      let dirty = true;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let idleAt = performance.now();
      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        cv.setPointerCapture(e.pointerId);
        setTouched(true);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        want.az -= dx * 0.0065;
        if (e.pointerType !== 'touch') want.pol = Math.max(0.32, Math.min(1.3, want.pol - dy * 0.004));
        idleAt = performance.now();
        dirty = true;
      };
      const onUp = (e: PointerEvent) => {
        dragging = false;
        idleAt = performance.now();
        if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      };
      cv.addEventListener('pointerdown', onDown);
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerup', onUp);
      cv.addEventListener('pointercancel', onUp);
      api.current = {
        zoom: (f) => {
          want.dist = Math.max(16, Math.min(64, want.dist * f));
          idleAt = performance.now();
          setTouched(true);
          dirty = true;
        },
        reset: () => {
          want.az = -0.55;
          want.pol = 1.16;
          want.dist = 40;
          dirty = true;
        },
      };

      /* ---------- loop: only while visible ---------- */
      let visible = true;
      let raf = 0;
      let last = performance.now();
      let frame = 0;
      const t0 = performance.now();
      const v3 = new THREE.Vector3();
      const projectLabels = () => {
        const w = box.clientWidth;
        const h = box.clientHeight;
        const placed: { x: number; y: number; w: number }[] = [];
        for (const l of labels) {
          v3.set(l.x, l.hotel ? l.y * hotelGroup.scale.y : l.y, l.z).project(camera);
          const hidden = v3.z > 1;
          let sx = ((v3.x + 1) / 2) * w;
          let sy = ((1 - v3.y) / 2) * h;
          if (l.arrow) {
            // far places stay readable at the border of the frame
            const lw = (l.lw ||= l.el.offsetWidth || 120);
            sx = Math.max(lw / 2 + 10, Math.min(w - lw / 2 - 10, sx));
            sy = Math.max(44, Math.min(h - 56, sy));
          }
          // never on top of another label (the hotel keeps its place): step down until free
          if (!l.hotel) {
            const lw2 = (l.lw ||= l.el.offsetWidth || 120);
            for (let k = 0; k < 4 && placed.some((p) => Math.abs(p.x - sx) < (p.w + lw2) / 2 + 6 && Math.abs(p.y - sy) < 30); k++) sy += 32;
          }
          placed.push({ x: sx, y: sy, w: (l.lw ||= l.el.offsetWidth || 120) });
          l.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%)`;
          l.el.style.opacity = hidden ? '0' : '';
          if (l.arrow) {
            v3.set(l.x + l.arrow.dx, l.y, l.z + l.arrow.dz).project(camera);
            const deg = (Math.atan2((1 - v3.y) / 2 * h - sy, ((v3.x + 1) / 2) * w - sx) * 180) / Math.PI;
            l.arrow.el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
          }
        }
      };
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = (now - t0) / 1000;
        let busy = dragging;
        // intro: the town grows, then the hotel rises above everything
        if (progress.value < 1.2) {
          progress.value = Math.min(1.2, progress.value + dt * 0.55);
          busy = true;
        }
        const hk = Math.max(0, Math.min(1, (progress.value - 0.55) / 0.5));
        const hs = hk < 1 ? 1 - Math.pow(1 - hk, 3) * Math.cos(hk * 5) : 1;
        if (Math.abs(hotelGroup.scale.y - Math.max(0.001, hs)) > 1e-4) {
          hotelGroup.scale.y = Math.max(0.001, hs);
          busy = true;
        }
        // turns slowly by itself when nobody touches it
        if (!dragging && !reduced && now - idleAt > 2500 && progress.value >= 1.2) want.az += dt * 0.07;
        const ease = 1 - Math.pow(0.0009, dt);
        for (const key of ['az', 'pol', 'dist'] as const) {
          const d = want[key] - cam[key];
          if (Math.abs(d) > 1e-4) {
            cam[key] += d * (progress.value < 1.2 ? ease * 0.45 : ease);
            busy = true;
          }
        }
        // the pin floats and turns slowly
        pin.position.y = pinBase + Math.sin(t * 1.8) * 0.06;
        pin.rotation.y = t * 0.6;
        // idle spin: 30 fps is plenty
        frame++;
        if (!busy && !dirty && frame % 2) return;
        dirty = false;
        place();
        renderer.render(scene, camera);
        projectLabels();
      };
      const vis = new IntersectionObserver(([e]) => {
        visible = Boolean(e?.isIntersecting);
        last = performance.now();
      });
      vis.observe(box);
      const ro = new ResizeObserver(resize);
      ro.observe(box);
      resize();
      place();
      await renderer.compileAsync(scene, camera).catch(() => renderer.compile(scene, camera));
      raf = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(raf);
        vis.disconnect();
        ro.disconnect();
        cv.removeEventListener('pointerdown', onDown);
        cv.removeEventListener('pointermove', onMove);
        cv.removeEventListener('pointerup', onUp);
        cv.removeEventListener('pointercancel', onUp);
        api.current = null;
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
          mats.forEach((mm) => mm.dispose());
        });
        tex.dispose();
        skyTex.dispose();
        sunTex.dispose();
        depthMat.dispose();
        renderer.dispose();
        lbRoot.textContent = '';
      };
    }

    return () => {
      disposed = true;
      io.disconnect();
      cleanup?.();
    };
  }, [lat, lng, name, locale]);

  return (
    <div ref={wrap} className={cn('overflow-hidden', className ?? 'relative h-full w-full')}>
      <canvas ref={canvas} className={cn('absolute inset-0 h-full w-full cursor-grab touch-pan-y transition-opacity duration-700 active:cursor-grabbing', state === 'ready' ? 'opacity-100' : 'opacity-0')} aria-label={`${x.street} · ${hotel.name}`} role="img" />
      <div ref={labelsRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
          {state === 'error' ? (
            <p className="max-w-xs text-sm text-ivory/60">{x.street}</p>
          ) : (
            <>
              <span className="relative h-24 w-40">
                <span className="absolute inset-x-0 bottom-0 h-10 rounded-[1.2rem] bg-white/[0.06] [transform:perspective(300px)_rotateX(55deg)]" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="absolute bottom-5 w-4 origin-bottom animate-[grow3d_1.6s_ease-in-out_infinite] rounded-t-sm bg-ivory/25" style={{ left: `${18 + i * 22}px`, height: `${[26, 40, 62, 34, 22][i]}px`, animationDelay: `${i * 0.12}s` }} />
                ))}
              </span>
              <p className="text-xs uppercase tracking-[0.2em] text-ivory/55">{x.loading3d}</p>
            </>
          )}
        </div>
      )}
      {state === 'ready' && (
        <div className="absolute right-3 top-3 z-[2] flex flex-col gap-1.5">
          {[
            { label: x.zoom, icon: Plus, on: () => api.current?.zoom(0.8) },
            { label: '−', icon: Minus, on: () => api.current?.zoom(1.25) },
            { label: x.reset, icon: RotateCcw, on: () => api.current?.reset() },
          ].map((c) => (
            <button key={c.label} type="button" onClick={c.on} aria-label={c.label} title={c.label} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ivory ring-1 ring-white/15 transition-colors hover:bg-ivory hover:text-navy active:scale-90">
              <c.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
      <span className={cn('pointer-events-none absolute bottom-4 left-1/2 z-[2] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-navy-3/70 px-3.5 py-2 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-ivory/85 ring-1 ring-white/10 transition-opacity duration-700', touched || state !== 'ready' ? 'opacity-0' : 'opacity-100')}>
        <Hand className="h-4 w-4 animate-[nudge_2.4s_ease-in-out_infinite]" /> {hint}
      </span>
    </div>
  );
}
