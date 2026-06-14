/* ============================================================================
   OVERHEAD · Aircraft classification + iconography
   Pure functions exposed on window.AC. No external state.
   Top-down silhouettes graded by airframe size & type. Surface targets
   (ADS-B category C*) render as ground vehicles, not aircraft.
   ========================================================================== */
(function(){
'use strict';

const pickN=(...vv)=>{for(const v of vv){const n=Number(v);if(!isNaN(n)&&isFinite(n))return n;}return null;};
const f=n=>(+n).toFixed(2);

/* ── TYPE CLASSIFICATION ─────────────────────────────────────────────────── */
function classifyAC(raw){
  const cat=String(raw?.category||'').toUpperCase().trim();
  const t=String(raw?.t||raw?.type||'').toUpperCase().replace(/[-\s]/g,'');

  /* Surface targets — ADS-B emitter categories C0..C2 */
  if(cat==='C1')return'vehicle-emg';                 // surface emergency vehicle
  if(cat==='C2'||cat==='C0')return'vehicle';         // surface service vehicle
  if(/^(GRND|GND|VEHI|VEH|SURF|TUG|TOW)$/.test(t))return'vehicle';

  if(cat==='A7')return'heli';
  if(cat==='B1')return'glider';
  if(cat==='B4')return'ultralight';

  if(!t)return'def';

  if(
    /^EC[0-9]/.test(t)||
    /^AS3[0-9]{2}$/.test(t)||/^AS5[0-9]{2}$/.test(t)||
    /^H1[0-9]{2}$/.test(t)||
    /^R(22|44|66)$/.test(t)||
    /^S(61|70|76|92)$/.test(t)||
    /^UH[0-9]{1,2}[A-Z]?$/.test(t)||/^HH[0-9]{1,2}$/.test(t)||
    /^SH[0-9]{1,2}$/.test(t)||
    /^AW[0-9]{3}$/.test(t)||/^A(109|119|129|139|169|189)$/.test(t)||
    /^B0[4-9]$/.test(t)||/^B4[0-9]$/.test(t)||/^B47$/.test(t)||
    /^(B212|B214|B222|B230|B430|B429|B412|B427)$/.test(t)||
    /^CH[34567][0-9]$/.test(t)||
    /^MH[0-9]{1,2}$/.test(t)||/^AH[0-9]{1,2}[A-Z]?$/.test(t)||
    /^OH[0-9]{2}$/.test(t)||/^HX[0-9]/.test(t)||
    /^NH90$/.test(t)||/^VH60$/.test(t)||
    /^MD[5-9][0-9]{2}$/.test(t)||
    /^MI[0-9]{1,2}[A-Z]?$/.test(t)||/^KA[0-9]{2}$/.test(t)||
    /^KMAX$/.test(t)||/^HELI$/.test(t)||/^GYRO$/.test(t)||/^ROTO$/.test(t)
  )return'heli';

  if(/^(B74[2-9S]|B748|B77[23LW]|B77X|B78[789X]|A33[02-9]|A340|A34[259]|A35[06K]|A38[0-9F]|MD11|DC10|L101)/.test(t))return'wide';
  if(/^(B73[5-9GHIJ]|B38M|B39M|A31[89]|A32[012FMNO]|A318|A319|A320|A321|MD8[0-9]|MD9[012]|DC9|B712|B722|B752|B753|E19[05]|BCS[123]|CS[13])/.test(t))return'narrow';
  if(/^(C25[0-9ABCM]|C5[126][0-9]|C56X|C650|C68[0A]|C700|C750|GL[456-9]|GLEX|G[23456][0-9]{2}|G280|G700|GALX|LJ[0-9]{2}|FA[2-9][0-9]|FA7X|FA8X|F2TH|PC24|CL[36][0-9]|CL60|H25[0-9ABC]|E50P|E55P|PRM1|SBRL|WW[234][0-9]|ASTR|HA4T|GAL[FX])/.test(t))return'bizjet';
  if(/^(CRJ[1279X]|E1[34][0-9]|E145|E170|E175|ERJ|AT[457][0-9]|AT7[56])/.test(t))return'regional';
  if(/^(DH8[ABCD]|DHC[678]|Q[234][0-9]|SF3[24]|SB20|BE[23][0-9]|PC12|PC[67]|C212|BN2|JS[34][0-9]|L410|AN[0-9]{1,2}|DO[0-9]{2}|TP14|CN[23][0-9]|PAC7|KODE)/.test(t))return'turboprop';
  if(/^(BE5[5-9]|BE58|BE76|PA[23][134]|PA44|C30[2-9]|C31[0-9]|C33[0-9]|C34[02]|C40[2-9]|C41[0-9]|C42[015]|V35|TW[0-9])/.test(t))return'piston-twin';
  if(/^(C1[5-9][0-9]|C172|C150|C152|C162|C177|C180|C182|C185|PA18|PA22|PA24|PA28|P28[ABT]|DA20|DA40|SR20|SR22|RV[3-9]|RV10|CTLS|CT2K|DIMO|JABI|MOSE)/.test(t))return'piston-single';
  if(/^(ASK|ASG|ASH|ASW|LS[0-9]|SZD|DG[0-9]{2}|PIK|DISC|NIMB|VENT|PW[56]|K8|K13|K21|GLAS|BLAN)/.test(t))return'glider';
  if(/^(ULAC|ULTR|MOTO|FOUR|JABIRU|EURO|IKARUS|SSEA|A22)/.test(t))return'ultralight';
  if(/^(F1[5-8][A-Z]?|F22|F35[ABC]?|B52|B2[A]?|B21|C130|C17A|C5M|P8[A]?|KC[13][0-9]|A10|E3[TF]|U2|SR71|AV8|HARR|VIPA|HAWK|TICO|ALPH)/.test(t))return'military';

  return'def';
}

/* ── CATEGORY METADATA ───────────────────────────────────────────────────── */
function acCategory(kind){
  const M={
    wide:           {label:'HEAVY JET',  cls:'cat-heavy',      chip:'HEAVY'},
    narrow:         {label:'AIRLINER',   cls:'cat-airline',    chip:'AIRLINE'},
    bizjet:         {label:'BIZJET',     cls:'cat-bizjet',     chip:'BIZJET'},
    regional:       {label:'REGIONAL',   cls:'cat-airline',    chip:'AIRLINE'},
    turboprop:      {label:'TURBOPROP',  cls:'cat-ga',         chip:'GA'},
    'piston-single':{label:'GA · SINGLE',cls:'cat-ga',         chip:'GA'},
    'piston-twin':  {label:'GA · TWIN',  cls:'cat-ga',         chip:'GA'},
    heli:           {label:'HELICOPTER', cls:'cat-rotorcraft', chip:'ROTOR'},
    military:       {label:'MILITARY',   cls:'cat-military',   chip:'MILITARY'},
    glider:         {label:'GLIDER',     cls:'cat-unknown',    chip:'OTHER'},
    ultralight:     {label:'ULTRALIGHT', cls:'cat-ga',         chip:'GA'},
    'vehicle':      {label:'GROUND VEHICLE',   cls:'cat-ground',chip:'GROUND'},
    'vehicle-emg':  {label:'EMERGENCY VEHICLE',cls:'cat-ground',chip:'GROUND'},
    def:            {label:'AIRCRAFT',   cls:'cat-unknown',    chip:'OTHER'},
  };
  return M[kind]||M.def;
}
/* Filter chip keys, in display order */
const CHIPS=['HEAVY','AIRLINE','BIZJET','GA','ROTOR','MILITARY','GROUND','OTHER'];

/* ── SILHOUETTE BUILDER (viewBox 0 0 32 32, nose toward y=0) ──────────────── */
/* Cleaner, more literal top-down airframes graded by size. Parameters:
   fw  fuselage half-width      nl  pointed-nose length
   ny  nose tip y               ty  tail y (rounded)
   wy  wing root y   wrt wing root chord   ws wing half-span
   wtipy wing-tip y (sweep)     wtw wing-tip chord
   sy  stab root y  srt chord   ss stab half-span  sty stab-tip y  stw tip chord
   eng [{dx,w,y,h}] nacelle pairs   prop [{dx,y,r}] turning discs
   nose {y,r} tractor-prop disc                                              */
function wing(c,rootY,rootChord,span,tipY,tipChord){
  const tw=tipChord==null?1.4:tipChord;
  return`<path fill="${c}" d="M16 ${f(rootY)} `+
    `L${f(16-span)} ${f(tipY)} L${f(16-span+0.9)} ${f(tipY+tw)} `+
    `L16 ${f(rootY+rootChord)} `+
    `L${f(16+span-0.9)} ${f(tipY+tw)} L${f(16+span)} ${f(tipY)} Z"/>`;
}
function plane(c,o){
  const fw=o.fw, sh=o.ny+(o.nl==null?fw*2.4:o.nl);   // shoulder where full width starts
  // fuselage: pointed nose → parallel body → rounded tail
  let s=`<path fill="${c}" d="M16 ${f(o.ny)} `+
    `L${f(16+fw)} ${f(sh)} L${f(16+fw)} ${f(o.ty-fw)} `+
    `Q${f(16+fw)} ${f(o.ty)} 16 ${f(o.ty)} `+
    `Q${f(16-fw)} ${f(o.ty)} ${f(16-fw)} ${f(o.ty-fw)} `+
    `L${f(16-fw)} ${f(sh)} Z"/>`;
  s+=wing(c,o.wy,o.wrt,o.ws,o.wtipy,o.wtw);
  s+=wing(c,o.sy,o.srt||1.2,o.ss,o.sty,o.stw||0.9);
  if(o.eng)for(const e of o.eng){
    s+=`<rect x="${f(16-e.dx-e.w)}" y="${f(e.y)}" width="${f(e.w*2)}" height="${f(e.h)}" rx="${f(e.w*0.8)}" fill="${c}"/>`;
    s+=`<rect x="${f(16+e.dx-e.w)}" y="${f(e.y)}" width="${f(e.w*2)}" height="${f(e.h)}" rx="${f(e.w*0.8)}" fill="${c}"/>`;
  }
  if(o.prop)for(const p of o.prop){
    s+=`<circle cx="${f(16-p.dx)}" cy="${f(p.y)}" r="${f(p.r)}" fill="none" stroke="${c}" stroke-width="0.9" opacity=".75"/>`;
    s+=`<circle cx="${f(16+p.dx)}" cy="${f(p.y)}" r="${f(p.r)}" fill="none" stroke="${c}" stroke-width="0.9" opacity=".75"/>`;
  }
  if(o.nose)s+=`<circle cx="16" cy="${f(o.nose.y)}" r="${f(o.nose.r)}" fill="none" stroke="${c}" stroke-width="1" opacity=".8"/>`;
  return s;
}

const SHAPES={
  // widebody: long body, long swept wings, two nacelles per side (4 engines read)
  wide:c=>plane(c,{fw:2.1,ny:3,nl:5,ty:29,wy:12,ws:13.5,wtipy:19,wrt:5.4,wtw:2,sy:25,ss:5.6,sty:29,srt:1.7,stw:1.2,
    eng:[{dx:4.6,w:1.25,y:15,h:3.6},{dx:8.4,w:1.1,y:16.6,h:3.2}]}),
  // narrowbody airliner: one nacelle per side
  narrow:c=>plane(c,{fw:1.7,ny:3.8,nl:4.4,ty:28,wy:13,ws:10.5,wtipy:19,wrt:4.6,wtw:1.5,sy:24.4,ss:4.6,sty:28,srt:1.4,
    eng:[{dx:4.2,w:1.05,y:16,h:3.2}]}),
  regional:c=>plane(c,{fw:1.5,ny:4.6,nl:4,ty:27,wy:14,ws:9,wtipy:18.6,wrt:3.9,wtw:1.3,sy:23.8,ss:4.2,sty:27,srt:1.3,
    eng:[{dx:3.5,w:0.92,y:16.6,h:2.8}]}),
  // bizjet: slim body, rear-mounted nacelles by the tail, T-tail
  bizjet:c=>plane(c,{fw:1.25,ny:4.4,nl:4.2,ty:26.5,wy:14.6,ws:7.8,wtipy:19,wrt:3.2,wtw:1.1,sy:24.6,ss:4.2,sty:27,srt:1.2,
    eng:[{dx:2.5,w:0.85,y:22,h:2.6}]}),
  // turboprop: wing-mounted prop discs, straight-ish wings
  turboprop:c=>plane(c,{fw:1.6,ny:4.8,nl:4.2,ty:27,wy:13.4,ws:10,wtipy:15.4,wrt:3.8,wtw:1.4,sy:24,ss:4.4,sty:27,srt:1.3,
    prop:[{dx:5.6,y:12.6,r:2.4}]}),
  'piston-twin':c=>plane(c,{fw:1.35,ny:6,nl:3.4,ty:26.5,wy:14,ws:9,wtipy:15.4,wrt:3.2,wtw:1.1,sy:24,ss:4,sty:26.5,srt:1.1,
    prop:[{dx:5,y:12.6,r:2}]}),
  'piston-single':c=>plane(c,{fw:1.3,ny:8.5,nl:2.6,ty:27,wy:14.6,ws:8.5,wtipy:15.4,wrt:2.8,wtw:1,sy:24.6,ss:3.8,sty:27,srt:1,
    nose:{y:8.2,r:2.3}}),
  // glider: very long, slender, high-aspect wings, no powerplant
  glider:c=>plane(c,{fw:0.9,ny:5.5,nl:3.2,ty:26.5,wy:15.4,ws:14.2,wtipy:16.6,wrt:1.8,wtw:0.7,sy:24,ss:4,sty:26.5,srt:0.9,stw:0.7}),
  ultralight:c=>plane(c,{fw:1.05,ny:8.5,nl:2.2,ty:25.5,wy:13.6,ws:8,wtipy:14,wrt:2.2,wtw:0.9,sy:23,ss:3.2,sty:25.5,srt:0.9,
    nose:{y:8.4,r:1.8}}),
  def:c=>plane(c,{fw:1.5,ny:4.6,nl:4,ty:27.5,wy:13.4,ws:9.5,wtipy:18,wrt:4,wtw:1.4,sy:24,ss:4.3,sty:27.5,srt:1.3}),
  // military jet: sharp arrowhead with twin tail
  military:c=>`<path fill="${c}" d="M16 2.5 L17.8 11 L18.4 14 L30 19.5 L30 21.2 L18.6 18.4 L18.2 25 L20.6 29.5 L20.6 30.6 L16 28.8 L11.4 30.6 L11.4 29.5 L13.8 25 L13.4 18.4 L2 21.2 L2 19.5 L13.6 14 L14.2 11 Z"/>`,
  // helicopter: faint rotor disc, two-blade rotor, fuselage pod + tail boom
  heli:c=>`<circle cx="16" cy="13.5" r="9.2" fill="none" stroke="${c}" stroke-width="0.7" opacity=".28"/>`+
    `<line x1="6.8" y1="13.5" x2="25.2" y2="13.5" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>`+
    `<line x1="16" y1="4.3" x2="16" y2="22.7" stroke="${c}" stroke-width="1.7" stroke-linecap="round" opacity=".5"/>`+
    `<ellipse cx="16" cy="14.5" rx="2.7" ry="4.6" fill="${c}"/>`+
    `<rect x="15.35" y="18.5" width="1.3" height="8" rx="0.6" fill="${c}" opacity=".9"/>`+
    `<line x1="12.8" y1="26" x2="19.2" y2="26" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  // ground vehicle: top-down car/truck — body, windshield band, roof
  vehicle:c=>`<rect x="11.3" y="8.5" width="9.4" height="15" rx="2.4" fill="${c}"/>`+
    `<rect x="12.8" y="10" width="6.4" height="3" rx="1" fill="#0b1220" opacity=".55"/>`+
    `<rect x="12.6" y="13.6" width="6.8" height="5" rx="1" fill="#0b1220" opacity=".32"/>`+
    `<rect x="12.8" y="19.4" width="6.4" height="2.6" rx="1" fill="#0b1220" opacity=".5"/>`,
  // emergency vehicle: same body with a light bar / beacon
  'vehicle-emg':c=>`<rect x="11.3" y="8.5" width="9.4" height="15" rx="2.4" fill="${c}"/>`+
    `<rect x="12.6" y="14" width="6.8" height="5" rx="1" fill="#0b1220" opacity=".32"/>`+
    `<rect x="12.8" y="20" width="6.4" height="2.4" rx="1" fill="#0b1220" opacity=".5"/>`+
    `<rect x="12.4" y="10" width="7.2" height="2.4" rx="1.2" fill="#ffffff" opacity=".95"/>`,
};

/* Pixel size per airframe — bigger frame ⇒ bigger glyph */
const ISIZES={wide:40,narrow:31,regional:27,bizjet:24,turboprop:27,'piston-twin':22,'piston-single':19,
  heli:25,military:27,glider:32,ultralight:17,vehicle:17,'vehicle-emg':18,def:26};

/* ── ALTITUDE COLOUR BANDS ───────────────────────────────────────────────── */
const ALT_BANDS=[
  {max:0,     col:'#94a3b8',label:'GROUND'},
  {max:3000,  col:'#cf9a4a',label:'<3K'},
  {max:12000, col:'#c9ad57',label:'3\u201312K'},
  {max:25000, col:'#57a386',label:'12\u201325K'},
  {max:36000, col:'#5594b5',label:'25\u201336K'},
  {max:Infinity,col:'#8d83b3',label:'36K+'},
];
function altColor(a,gnd){
  if(gnd||a===0)return'#94a3b8';
  if(a==null)return'#57a386';
  for(const b of ALT_BANDS)if(a<b.max||b.max===Infinity)return b.col;
  return'#8d83b3';
}
function iconColor(raw){
  const a=pickN(raw?.alt_baro,raw?.altitude,raw?.alt);
  const gnd=raw?.on_ground===true||raw?.gnd===true||String(raw?.alt_baro||'').toLowerCase()==='ground';
  return altColor(a,gnd);
}

/* ── ICON FACTORY (needs Leaflet L) ──────────────────────────────────────── */
function makeIcon(item,sel){
  const raw=item.raw||{};
  const kind=classifyAC(raw);
  const isVeh=kind==='vehicle'||kind==='vehicle-emg';
  const track=pickN(raw.track,raw.mag_heading,raw.true_heading)||0;
  let color;
  if(sel)color='#f5a623';
  else if(kind==='vehicle-emg')color='#e84848';
  else if(kind==='vehicle')color='#9aa7bd';
  else color=iconColor(raw);
  // halo keeps the glyph legible over dark, light and satellite tiles
  const halo=sel
    ? 'filter:drop-shadow(0 0 4px rgba(245,166,35,.95)) drop-shadow(0 0 1px rgba(0,0,0,.85));'
    : 'filter:drop-shadow(0 0 1.4px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.25));';
  const sz=ISIZES[kind]||26;
  const body=(SHAPES[kind]||SHAPES.def)(color);
  // vehicles are not "flying" — keep them upright-ish but still oriented to heading
  const h=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sz}" height="${sz}" style="transform:rotate(${track}deg);display:block;${halo}">${body}</svg>`;
  return L.divIcon({html:h,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-(sz/2+5)]});
}

function isVehicle(raw){const k=classifyAC(raw||{});return k==='vehicle'||k==='vehicle-emg';}

window.AC={classifyAC,acCategory,CHIPS,SHAPES,ISIZES,ALT_BANDS,altColor,iconColor,makeIcon,isVehicle};
})();
