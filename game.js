'use strict';
// Hungry Pixel Snakes – game logic and drawing. Levels live in levels.js.

// ================= SETUP =================
const MAXB = 5, NPOLE = 5, NCOL = 5;
const DIRS = [[0,-1],[-1,0],[1,0],[0,1]];
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const store = {
  get(k,d){ try{ const v = localStorage.getItem('hps.'+k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem('hps.'+k, JSON.stringify(v)); }catch(e){} }
};
let cleared = store.get('cleared', []);
let muted = store.get('mute', false);

let RUN = 0, LI, L, W, H, G, eaten, eatAt, resv, total, eatenN, eggs, snakes, poles, parts, game, sid = 0, now = 0;
let cw, ch, dpr, S, ox, oy, dockY, dockH, eggTop, rowH, colW, slotW, slot0, holeP, poleP = [];

// ================= SOUND (made with WebAudio, no files) =================
let AC = null, lastBite = 0;
function beep(f0, f1, dur, type, vol, delay=0){
  if (muted) return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30,f1), t+dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t+dur+0.03);
  }catch(e){}
}
const SFX = {
  bite(){ if (now-lastBite < 0.05) return; lastBite = now; beep(600+Math.random()*250, 950, .07, 'square', .03); },
  hatch(){ beep(260,520,.12,'triangle',.09); beep(700,950,.06,'square',.03,.05); },
  pole(){ beep(330,250,.18,'triangle',.08); },
  hole(){ beep(520,90,.4,'sine',.1); },
  deny(){ beep(150,110,.12,'sawtooth',.05); },
  win(){ [523,659,784,1047].forEach((f,i)=>beep(f,f,.2,'triangle',.09,i*.12)); },
  lose(){ [392,330,262].forEach((f,i)=>beep(f,f*.97,.28,'triangle',.09,i*.2)); },
};

// ================= LEVEL + EGGS =================
function loadLevel(i){
  LI = (i + LEVELS.length) % LEVELS.length; store.set('level', LI);
  RUN++; L = LEVELS[LI]; H = L.art.length; W = Math.max(...L.art.map(r=>r.length));
  const first = Object.keys(L.pal)[0];
  G = new Array(W*H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const ch = L.art[y][x]; G[y*W+x] = (ch && L.pal[ch]) ? ch : first; }
  eaten = new Uint8Array(W*H); eatAt = new Float64Array(W*H); resv = new Uint8Array(W*H);
  total = W*H; eatenN = 0; snakes = []; poles = Array(NPOLE).fill(null); parts = []; game = 'play';
  eggs = makeEggs();
  layout(); hideOv(); updHud();
}

// Order in which a snake of colour `key`, entering from the bottom, could reach its cells
// (eating its own colour opens the way). Used only to generate eggs.
function reachOrder(key, simE){
  const seen = new Uint8Array(W*(H+1)), q = [], out = [];
  for (let x=0;x<W;x++){ seen[H*W+x]=1; q.push(H*W+x); }
  for (let qi=0; qi<q.length; qi++){
    const k=q[qi], x=k%W, y=(k/W)|0;
    for (const [dx,dy] of DIRS){
      const nx=x+dx, ny=y+dy; if (nx<0||nx>=W||ny<0||ny>H) continue;
      const nk=ny*W+nx; if (seen[nk]) continue;
      if (ny<H && !simE[nk]){ if (G[nk]!==key) continue; out.push(nk); }
      seen[nk]=1; q.push(nk);
    }
  }
  return out;
}
function makeEggs(){
  const rem = {}; for (const k of G) rem[k] = (rem[k]||0)+1;
  const simE = new Uint8Array(W*H), seq = [];
  let left = W*H;
  const rnd = (a,b) => a + Math.floor(Math.random()*(b-a+1));
  while (left > 0){
    const cand = [];
    for (const key in rem) if (rem[key]>0){ const o = reachOrder(key, simE); if (o.length) cand.push({key,o}); }
    if (!cand.length) break; // should not happen
    let sum = 0; for (const c of cand) sum += c.o.length;
    let pick = Math.random()*sum, c = cand[0];
    for (const cc of cand){ pick -= cc.o.length; if (pick <= 0){ c = cc; break; } }
    const R = rem[c.key], r = c.o.length;
    let n = Math.min(rnd(L.minC, L.maxC), R, r);
    const rest = R - n;
    if (rest > 0 && rest < Math.ceil(L.minC/2) && R <= r) n = R; // avoid tiny leftovers
    for (let i=0;i<n;i++) simE[c.o[i]] = 1;
    rem[c.key] -= n; left -= n; seq.push({key:c.key, n});
  }
  const cols = Array.from({length:NCOL}, ()=>[]);
  seq.forEach((e,i) => cols[i % NCOL].push(e));
  return cols;
}

// ================= GRID HELPERS =================
// Row H is the walkable margin just below the picture.
function emp(x,y){ if (x<0||x>=W||y<0||y>H) return false; if (y===H) return true; return eaten[y*W+x]===1; }
function marginStarts(fromX){
  const a = []; for (let x=0;x<W;x++) a.push([x,H]);
  if (fromX != null) a.sort((p,q)=>Math.abs(p[0]-fromX)-Math.abs(q[0]-fromX));
  return a;
}
// BFS through empty cells to the nearest uneaten, unreserved cell of colour `key`.
// Returns the path [[x,y]...] from a start cell to that cell, or null.
function findTarget(starts, key){
  const N = W*(H+1), prev = new Int32Array(N).fill(-2), q = [];
  for (const [x,y] of starts){ const k=y*W+x; if (prev[k]===-2 && emp(x,y)){ prev[k]=-1; q.push(k); } }
  for (let qi=0; qi<q.length; qi++){
    const k=q[qi], x=k%W, y=(k/W)|0;
    for (const [dx,dy] of DIRS){
      const nx=x+dx, ny=y+dy; if (nx<0||nx>=W||ny<0||ny>H) continue;
      const nk=ny*W+nx;
      if (ny<H && !eaten[nk]){
        if (G[nk]===key && !resv[nk]){
          const path=[[nx,ny]]; let c=k;
          while (c!==-1){ path.push([c%W,(c/W)|0]); c=prev[c]; }
          return path.reverse();
        }
        continue;
      }
      if (prev[nk]===-2){ prev[nk]=k; q.push(nk); }
    }
  }
  return null;
}
// BFS through empty cells to the nearest margin cell.
function findExit(sx, sy){
  const N = W*(H+1), prev = new Int32Array(N).fill(-2), q=[sy*W+sx];
  prev[q[0]] = -1;
  for (let qi=0; qi<q.length; qi++){
    const k=q[qi], x=k%W, y=(k/W)|0;
    if (y===H){ const p=[]; let c=k; while(c!==-1){ p.push([c%W,(c/W)|0]); c=prev[c]; } return p.reverse(); }
    for (const [dx,dy] of DIRS){
      const nx=x+dx, ny=y+dy; if (!emp(nx,ny)) continue;
      const nk=ny*W+nx; if (prev[nk]===-2){ prev[nk]=k; q.push(nk); }
    }
  }
  return [[sx,sy]];
}

// ================= SNAKES =================
// States: seek (crawling to a cell), wait (another same-colour snake may open a way),
// exit (leaving to a pole or the hole), pole (coiled on a pole), sink (dropping into the hole).
const ACTIVE = new Set(['seek','wait','exit']);
const onBoard = () => snakes.filter(s=>ACTIVE.has(s.state)).length;

function mkSnake(key, n, px, py){
  const [x,y] = toU(px,py);
  return { id:++sid, key, color:L.pal[key], n, ate:0, state:'new', wp:[], hx:x, hy:y, trail:[[x,y]],
           cx:-1, cy:-1, target:-1, pole:-1, len:1.6, shown:0.2, waitT:0, shake:0, dead:false };
}
function sameSeeker(s){ return snakes.some(o => o!==s && o.key===s.key && o.state==='seek' && o.target>=0); }

function setPath(s, path, fromOutside){
  const [gx,gy] = path[path.length-1], k = gy*W+gx;
  resv[k] = 1; s.target = k; s.state = 'seek';
  s.wp = (fromOutside ? path : path.slice(1)).map(([x,y]) => ({x, y, g:1}));
  s.wp[s.wp.length-1].a = 'eat';
}
// Snake is outside the board (fresh from an egg or on a pole): enter from the bottom edge.
function tryEnter(s){
  const sx = Math.round(Math.max(0, Math.min(W-1, s.hx)));
  s.cx = -1; s.cy = -1; s.trail = [[s.hx, s.hy]];
  const p = findTarget(marginStarts(sx), s.key);
  if (p){ setPath(s, p, true); return true; }
  if (sameSeeker(s)){ s.state='seek'; s.wp=[{x:sx, y:H, g:1, a:'wait'}]; return true; }
  return false;
}
function goPole(s){
  const i = poles.indexOf(null);
  if (i < 0){ s.state='wait'; s.waitT=1e9; lose('full'); return; }
  poles[i] = s; s.pole = i; goOut(s, 'pole');
}
function goOut(s, kind){
  const wp = [];
  if (s.cx >= 0){
    const e = findExit(s.cx, s.cy);
    for (const [x,y] of e.slice(1)) wp.push({x, y, g:1});
    const last = e[e.length-1]; wp.push({x:last[0], y:H+0.9});
  }
  const P = kind==='hole' ? holeP : poleTop(s.pole);
  const [ux,uy] = toU(P.x, P.y); wp.push({x:ux, y:uy, a:kind});
  s.wp = wp; s.state = 'exit'; s.target = -1;
}
function plan(s){
  if (s.n <= 0){ goOut(s, 'hole'); return; }
  const p = findTarget([[s.cx, s.cy]], s.key);
  if (p){ setPath(s, p, false); return; }
  if (sameSeeker(s)){ s.state='wait'; s.waitT=0.25; return; }
  goPole(s);
}
function arrive(s, w){
  if (w.g){ s.cx = w.x; s.cy = w.y; }
  if (w.a === 'eat'){
    const k = w.y*W + w.x;
    eaten[k] = 1; eatAt[k] = now; resv[k] = 0; eatenN++;
    s.n--; s.ate++; s.target = -1;
    const [px,py] = toPx(w.x, w.y); burst(px, py, L.pal[G[k]], 6, false); SFX.bite();
    if (eatenN === total) win();
    plan(s);
  } else if (w.a === 'wait'){ s.state='wait'; s.waitT=0.25; }
  else if (w.a === 'pole'){ s.state='pole'; s.trail=[]; SFX.pole(); }
  else if (w.a === 'hole'){ s.state='sink'; SFX.hole(); }
}

function hatch(c){
  if (game !== 'play') return;
  const col = eggs[c]; if (!col.length) return;
  if (onBoard() >= MAXB){ flashCnt(); SFX.deny(); return; }
  const e = col.shift(), P = eggPos(c, 0);
  burst(P.x, P.y, '#fff6e8', 10, true); burst(P.x, P.y, L.pal[e.key], 8, true); SFX.hatch();
  const s = mkSnake(e.key, e.n, P.x, P.y); snakes.push(s);
  if (!tryEnter(s)) goPole(s);
}
function tapPole(i){
  const s = poles[i]; if (!s || s.state!=='pole' || game!=='play') return;
  if (onBoard() >= MAXB){ flashCnt(); SFX.deny(); return; }
  const P = poleTop(i); [s.hx, s.hy] = toU(P.x, P.y);
  if (tryEnter(s)){ poles[i] = null; s.pole = -1; SFX.hatch(); }
  else { s.state='pole'; s.trail=[]; s.shake = 0.45; SFX.deny(); }
}

// ================= WIN / LOSE =================
function win(){
  if (game !== 'play') return; game = 'win';
  const name = L.name; if (!cleared.includes(name)){ cleared.push(name); store.set('cleared', cleared); }
  const run = RUN;
  setTimeout(()=>{ if (run !== RUN) return; SFX.win(); showOv('เก่งมาก! 🎉', 'กินภาพ "'+L.name+'" หมดแล้ว', 'เล่นอีกครั้ง', ()=>loadLevel(LI), 'ด่านต่อไป ▶', ()=>loadLevel(LI+1)); updHud(); }, 700);
}
function lose(why){
  if (game !== 'play') return; game = 'lose';
  const msg = why==='full' ? 'เสาเต็มทั้ง 5 ต้นแล้ว งูไม่มีที่พัก' : 'ไม่มีงูตัวไหนไปต่อได้แล้ว';
  const run = RUN;
  setTimeout(()=>{ if (run !== RUN) return; SFX.lose(); showOv('โอ๊ะ! แพ้แล้ว', msg, null, null, 'ลองใหม่ ↻', ()=>loadLevel(LI)); }, 800);
}
function checkStuck(){
  if (game!=='play' || eatenN>=total) return;
  if (eggs.some(c=>c.length) || snakes.some(s=>ACTIVE.has(s.state))) return;
  const ms = marginStarts();
  if (!poles.some(s => s && findTarget(ms, s.key))) lose('stuck');
}

// ================= UPDATE =================
function update(dt){
  for (const s of snakes){
    if (s.shake > 0) s.shake -= dt;
    if (s.state === 'sink'){ s.shown -= dt*8; if (s.shown <= 0) s.dead = true; continue; }
    s.len = Math.min(1.6 + 0.45*s.ate, 9);
    s.shown += (s.len - s.shown) * Math.min(1, dt*5);
    if (s.state === 'wait'){ s.waitT -= dt; if (s.waitT <= 0) plan(s); }
    let t = dt;
    while (t > 1e-6 && s.wp.length && (s.state==='seek' || s.state==='exit')){
      const w = s.wp[0], dx = w.x-s.hx, dy = w.y-s.hy, dist = Math.hypot(dx,dy);
      const sp = (s.hy > H+0.05 || w.y > H+0.05) ? 13 : 7;
      const need = dist / sp;
      if (need <= t){ s.hx=w.x; s.hy=w.y; s.trail.push([w.x,w.y]); s.wp.shift(); t -= need; arrive(s, w); }
      else { s.hx += dx/dist*sp*t; s.hy += dy/dist*sp*t; t = 0; }
    }
    // forget trail points far behind the tail
    let acc = 0, px = s.hx, py = s.hy;
    for (let i = s.trail.length-1; i >= 0; i--){
      acc += Math.hypot(px - s.trail[i][0], py - s.trail[i][1]); px = s.trail[i][0]; py = s.trail[i][1];
      if (acc > s.len + 1){ s.trail.splice(0, i); break; }
    }
  }
  snakes = snakes.filter(s => !s.dead);
  for (const p of parts){ p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 600*dt; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  checkStuck();
}

// ================= LAYOUT =================
function layout(){
  const r = cv.getBoundingClientRect();
  cw = Math.max(200, r.width); ch = Math.max(300, r.height); dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(cw*dpr); cv.height = Math.round(ch*dpr);
  if (!W) return;
  const eggH = Math.min(200, Math.max(130, ch*0.25));
  dockH = Math.max(62, Math.min(92, ch*0.11));
  const availH = ch - eggH - dockH - 14;
  S = Math.floor(Math.min((cw-20)/W, availH/(H+1)));
  ox = Math.round((cw - W*S)/2);
  oy = Math.max(8, Math.round((availH - (H+1)*S)/2) + 6);
  dockY = oy + (H+1)*S + 6;
  slotW = Math.min(76, (cw-12)/6); slot0 = (cw - 6*slotW)/2;
  holeP = {x: slot0 + slotW*0.5, y: dockY + dockH*0.5};
  poleP = []; for (let i=0;i<NPOLE;i++) poleP.push({x: slot0 + slotW*(i+1.5), y: dockY + dockH*0.5});
  eggTop = dockY + dockH + 4; colW = (cw-8)/NCOL; rowH = (ch - eggTop - 4)/3;
}
const toPx = (x,y) => [ox + (x+0.5)*S, oy + (y+0.5)*S];
const toU = (px,py) => [(px-ox)/S - 0.5, (py-oy)/S - 0.5];
const poleTop = i => ({x: poleP[i].x, y: poleP[i].y - dockH*0.18});
const eggPos = (c,r) => ({x: 4 + colW*(c+0.5), y: eggTop + rowH*(r+0.5)});

// ================= DRAW =================
function shade(hex, f){
  const n = parseInt(hex.slice(1),16); let r=n>>16, g=(n>>8)&255, b=n&255;
  if (f < 0){ r*=1+f; g*=1+f; b*=1+f; } else { r+=(255-r)*f; g+=(255-g)*f; b+=(255-b)*f; }
  return 'rgb('+(r|0)+','+(g|0)+','+(b|0)+')';
}
function rrect(x,y,w,h,r){ ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x,y,w,h,r) : ctx.rect(x,y,w,h); }
function label(txt, x, y, size){
  ctx.font = '600 '+size+'px '+FONT;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  ctx.lineWidth = Math.max(3, size*0.28); ctx.strokeStyle='rgba(20,12,35,.85)'; ctx.strokeText(txt, x, y+1);
  ctx.fillStyle='#fff'; ctx.fillText(txt, x, y+1);
}
const FONT = "'Mitr',system-ui,sans-serif";

function draw(){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle = '#1d1830'; ctx.fillRect(0,0,cw,ch);
  // board frame
  ctx.fillStyle = '#120d20'; rrect(ox-6, oy-6, W*S+12, (H+1)*S+12, 12); ctx.fill();
  // cells
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const k=y*W+x, X=ox+x*S, Y=oy+y*S;
    if (eaten[k]){
      ctx.fillStyle = (x+y)&1 ? '#2a2240' : '#2f2746'; ctx.fillRect(X, Y, S, S);
      const t = now - eatAt[k];
      if (t < 0.2){ const z = S*(1-t/0.2); ctx.fillStyle = L.pal[G[k]]; ctx.fillRect(X+(S-z)/2, Y+(S-z)/2, z, z); }
    } else {
      ctx.fillStyle = L.pal[G[k]]; ctx.fillRect(X, Y, S+0.5, S+0.5);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(X, Y, S, Math.max(2,S*0.13));
      ctx.fillStyle = 'rgba(0,0,0,.13)'; ctx.fillRect(X, Y+S-Math.max(2,S*0.13), S, Math.max(2,S*0.13));
      if (resv[k]){ ctx.strokeStyle = 'rgba(255,255,255,'+(0.45+0.4*Math.sin(now*12))+')'; ctx.lineWidth=2; ctx.strokeRect(X+2,Y+2,S-4,S-4); }
    }
  }
  // margin (the strip snakes walk along)
  const MY = oy + H*S;
  ctx.fillStyle = '#3b3157'; ctx.fillRect(ox, MY, W*S, S);
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  for (let x=0;x<W;x++){ const cx=ox+(x+0.5)*S, cy=MY+S*0.5, a=S*0.15; ctx.beginPath(); ctx.moveTo(cx-a,cy+a*0.5); ctx.lineTo(cx,cy-a*0.5); ctx.lineTo(cx+a,cy+a*0.5); ctx.fill(); }

  // dock: hole + poles
  ctx.fillStyle = '#251e3a'; rrect(slot0-4, dockY, slotW*6+8, dockH, 14); ctx.fill();
  const hr = Math.min(slotW*0.4, dockH*0.38);
  ctx.fillStyle = '#5a4630'; ctx.beginPath(); ctx.ellipse(holeP.x, holeP.y+4, hr+4, hr*0.62+3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#07040d'; ctx.beginPath(); ctx.ellipse(holeP.x, holeP.y+4, hr, hr*0.62, 0, 0, 7); ctx.fill();
  for (let i=0;i<NPOLE;i++){
    const P = poleP[i], top = P.y - dockH*0.36, bot = P.y + dockH*0.36;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(P.x, bot, slotW*0.28, 4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#c08a4e'; rrect(P.x-3.5, top, 7, bot-top, 3); ctx.fill();
    ctx.fillStyle = '#e2b179'; ctx.beginPath(); ctx.arc(P.x, top, 5.5, 0, 7); ctx.fill();
  }

  // eggs
  const full = onBoard() >= MAXB;
  for (let c=0;c<NCOL;c++){
    const col = eggs[c];
    for (let r=Math.min(2, col.length-1); r>=0; r--){
      const P = eggPos(c, r), e = col[r];
      const front = r===0;
      const bob = front ? Math.sin(now*3 + c)*1.6 : 0;
      drawEgg(P.x, P.y + bob, Math.min(colW*0.3, rowH*0.36)*(front?1:0.8), L.pal[e.key], e.n, front ? (full ? 0.5 : 1) : 0.45);
    }
    if (col.length > 3){ const P = eggPos(c,2); ctx.globalAlpha=.8; label('+'+(col.length-3), P.x + colW*0.3, P.y + rowH*0.3, 12); ctx.globalAlpha=1; }
  }

  // snakes on poles, then moving snakes
  for (const s of snakes) if (s.state==='pole') drawCoil(s);
  for (const s of snakes) if (s.state!=='pole') drawSnake(s);

  // particles
  for (const p of parts){ ctx.globalAlpha = Math.max(0, Math.min(1, p.life*2.5)); ctx.fillStyle = p.color; ctx.fillRect(p.x-p.size/2, p.y-p.size/2, p.size, p.size); }
  ctx.globalAlpha = 1;
}
function drawEgg(x, y, rx, color, n, alpha){
  const ry = rx*1.28;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y+ry*0.95, rx*0.8, rx*0.2, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = shade(color, -0.45); ctx.stroke();
  ctx.fillStyle = shade(color, 0.35);
  ctx.beginPath(); ctx.arc(x-rx*0.45, y-ry*0.15, rx*0.16, 0, 7); ctx.arc(x+rx*0.5, y+ry*0.35, rx*0.12, 0, 7); ctx.arc(x+rx*0.2, y-ry*0.6, rx*0.1, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(x-rx*0.35, y-ry*0.5, rx*0.18, ry*0.12, -0.6, 0, 7); ctx.fill();
  label(String(n), x, y+ry*0.08, Math.max(13, rx*0.85));
  ctx.globalAlpha = 1;
}
function bodyPoints(s, len){
  const pts = [toPx(s.hx, s.hy)]; let acc = 0, px = s.hx, py = s.hy;
  for (let i = s.trail.length-1; i >= 0 && acc < len; i--){
    const [x,y] = s.trail[i], d = Math.hypot(x-px, y-py);
    if (d < 1e-6) continue;
    if (acc + d >= len){ const f = (len-acc)/d; pts.push(toPx(px+(x-px)*f, py+(y-py)*f)); acc = len; break; }
    acc += d; pts.push(toPx(x,y)); px = x; py = y;
  }
  return pts;
}
function drawSnake(s){
  const len = Math.max(0, s.shown), pts = bodyPoints(s, len);
  const T = Math.max(9, Math.min(24, S*0.62)), dark = shade(s.color, -0.5);
  if (pts.length > 1){
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineWidth = T+4; ctx.strokeStyle = dark; ctx.stroke();
    ctx.lineWidth = T; ctx.strokeStyle = s.color; ctx.stroke();
    ctx.lineWidth = T*0.28; ctx.strokeStyle = shade(s.color, 0.4); ctx.setLineDash([T*0.35, T*0.55]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (s.state === 'sink' && len < 0.5) return;
  const [hx, hy] = pts[0];
  let dx = 0, dy = -1;
  if (pts.length > 1){ const q = pts[1]; const d = Math.hypot(hx-q[0], hy-q[1]) || 1; dx = (hx-q[0])/d; dy = (hy-q[1])/d; }
  const R = T*0.72;
  ctx.fillStyle = s.color; ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(hx, hy, R, 0, 7); ctx.fill(); ctx.stroke();
  // eyes at the front of the head
  for (const sgn of [-1, 1]){
    const ex = hx + dx*R*0.55 - dy*R*0.5*sgn, ey = hy + dy*R*0.55 + dx*R*0.5*sgn;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, R*0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1226'; ctx.beginPath(); ctx.arc(ex+dx*R*0.1, ey+dy*R*0.1, R*0.15, 0, 7); ctx.fill();
  }
  label(String(s.n), hx - dx*R*0.15, hy - dy*R*0.15, Math.max(11, R*0.95));
}
function drawCoil(s){
  const P = poleP[s.pole], jig = s.shake > 0 ? Math.sin(now*60)*4 : 0, x = P.x + jig;
  const T = Math.max(8, Math.min(14, S*0.45)), rx = Math.min(slotW*0.34, 22), dark = shade(s.color, -0.5);
  for (let j=0;j<3;j++){
    const y = P.y + dockH*0.24 - j*dockH*0.17;
    ctx.beginPath(); ctx.ellipse(x, y, rx, T*0.55, 0, 0, 7);
    ctx.lineWidth = T+3; ctx.strokeStyle = dark; ctx.stroke();
    ctx.lineWidth = T; ctx.strokeStyle = s.color; ctx.stroke();
  }
  const hy = P.y - dockH*0.3, R = T*0.95;
  ctx.fillStyle = s.color; ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, hy, R, 0, 7); ctx.fill(); ctx.stroke();
  label(String(s.n), x, hy, Math.max(11, R*1.05));
}
function burst(x, y, color, count, big){
  for (let i=0;i<count;i++){
    const a = Math.random()*Math.PI*2, v = (big?180:90) + Math.random()*(big?200:110);
    parts.push({x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v - (big?160:60), life:0.4+Math.random()*0.35, color, size: big ? 4+Math.random()*4 : 2+Math.random()*3});
  }
}

// ================= HUD / OVERLAY =================
let lastCnt = '';
function updHud(){
  $('lname').textContent = 'ด่าน '+(LI+1)+' · '+L.name;
  $('lstat').textContent = cleared.includes(L.name) ? '✓ ผ่านแล้ว' : 'ยังไม่ผ่าน';
  $('mute').textContent = muted ? '🔇' : '🔊';
}
function hudTick(){
  const n = onBoard(), txt = '🐍 '+n+'/'+MAXB;
  if (txt !== lastCnt){ $('cnt').textContent = txt; lastCnt = txt; $('cnt').classList.toggle('full', n >= MAXB); }
}
function flashCnt(){ const el = $('cnt'); el.style.background = '#e8425a'; setTimeout(()=>el.style.background='', 250); }
function showOv(t, p, bTxt, bFn, aTxt, aFn){
  $('ovT').textContent = t; $('ovP').textContent = p;
  $('ovA').textContent = aTxt; $('ovA').onclick = aFn;
  $('ovB').hidden = !bTxt; if (bTxt){ $('ovB').textContent = bTxt; $('ovB').onclick = bFn; }
  $('ov').hidden = false;
}
function hideOv(){ $('ov').hidden = true; }

// ================= INPUT =================
cv.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  if (y >= eggTop - 4){ const c = Math.floor((x-4)/colW); if (c>=0 && c<NCOL) hatch(c); return; }
  if (y >= dockY && y <= dockY + dockH + 4){
    for (let i=0;i<NPOLE;i++) if (Math.abs(x - poleP[i].x) < slotW/2) tapPole(i);
  }
});
$('prev').onclick = () => loadLevel(LI-1);
$('next').onclick = () => loadLevel(LI+1);
$('restart').onclick = () => loadLevel(LI);
$('mute').onclick = () => { muted = !muted; store.set('mute', muted); updHud(); };
window.addEventListener('resize', layout);

// ================= LOOP =================
let last = performance.now();
function frame(t){
  const dt = Math.min(0.05, (t-last)/1000); last = t; now += dt;
  update(dt); draw(); hudTick();
  requestAnimationFrame(frame);
}
loadLevel(store.get('level', 0) || 0);
requestAnimationFrame(frame);
