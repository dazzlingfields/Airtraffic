/* ============================================================================
   OVERHEAD · Aircraft classification + iconography
   Pure functions exposed on window.AC. No external state.
   Top-down silhouettes graded by AIRFRAME: shape follows engine count and
   layout (twin vs quad widebody, trijet, quad-turboprop, fighter, flying wing,
   tandem rotor), and pixel size follows the type's real wingspan. Surface
   targets (ADS-B category C*) render as ground vehicles, not aircraft.
   ========================================================================== */
(function(){
'use strict';

const pickN=(...vv)=>{for(const v of vv){const n=Number(v);if(!isNaN(n)&&isFinite(n))return n;}return null;};
const f=n=>(+n).toFixed(2);

/* ── TYPE CLASSIFICATION ─────────────────────────────────────────────────────
   Returns an airframe "kind" that drives both the silhouette and the category.
   Order matters: military and engine-count-specific families are tested before
   the generic airliner buckets so a C-17 or A340 is not mistaken for a twin. */
function classifyAC(raw){
  const cat=String(raw?.category||'').toUpperCase().trim();
  const t=String(raw?.t||raw?.type||'').toUpperCase().replace(/[-\s]/g,'');

  /* Surface targets — ADS-B emitter categories C0..C2 */
  if(cat==='C1')return'vehicle-emg';
  if(cat==='C2'||cat==='C0')return'vehicle';
  if(/^(GRND|GND|VEHI|VEH|SURF|TUG|TOW)$/.test(t))return'vehicle';

  if(cat==='A7'&&!t)return'heli';
  if(cat==='B1'&&!t)return'glider';
  if(cat==='B4'&&!t)return'ultralight';

  if(!t)return cat==='A7'?'heli':cat==='B1'?'glider':'def';

  /* Rotorcraft (tandem first, then single main rotor) */
  if(/^CH4[67]/.test(t))return'heli-tandem';              // CH-46/47 Chinook
  if(
    /^EC[0-9]/.test(t)||/^AS3[0-9]{2}$/.test(t)||/^AS5[0-9]{2}$/.test(t)||
    /^H1[0-9]{2}$/.test(t)||/^R(22|44|66)$/.test(t)||/^S(61|70|76|92)$/.test(t)||
    /^UH[0-9]{1,2}[A-Z]?$/.test(t)||/^HH[0-9]{1,2}$/.test(t)||/^SH[0-9]{1,2}$/.test(t)||
    /^AW[0-9]{3}$/.test(t)||/^A(109|119|129|139|169|189)$/.test(t)||
    /^B0[4-9]$/.test(t)||/^B4[0-9]$/.test(t)||/^B47$/.test(t)||
    /^(B212|B214|B222|B230|B430|B429|B412|B427)$/.test(t)||/^CH[357][0-9]$/.test(t)||
    /^MH[0-9]{1,2}$/.test(t)||/^OH[0-9]{2}$/.test(t)||/^HX[0-9]/.test(t)||
    /^NH90$/.test(t)||/^VH60$/.test(t)||/^MD[5-9][0-9]{2}$/.test(t)||
    /^MI[0-9]{1,2}[A-Z]?$/.test(t)||/^KA[0-9]{2}$/.test(t)||
    /^KMAX$/.test(t)||/^HELI$/.test(t)||/^GYRO$/.test(t)||/^ROTO$/.test(t)
  )return'heli';

  /* Military — fast jets, flying wings, then 4-engine heavies */
  if(/^(F1[4-8][A-Z]?|FA18|F22|F35[ABC]?|F5[A-Z]?|F4[A-Z]?|F104|EUFI|TYEU|TYPH|RFAL|GRIP|GR[0-9]|MIG[0-9]{1,2}|MG[0-9]{2}|SU[0-9]{2}|J1[05]|J20|JF17|A10[A-Z]?|AV8[AB]?|HARR|HAWK|ALPH|T38|T6[A-Z]?|MIR2|M2K|TORN|VIPA|TICO)$/.test(t))return'fighter';
  if(/^(B2A?|B21|RQ170|X47)$/.test(t))return'flying-wing';
  if(/^(C17A?|B52[A-Z]?|E3[A-Z]{0,2}|E8[A-Z]?|K35[A-Z]?|KC135|R135|RC135|B70[0-9]|VC25|C5[AM]?)$/.test(t))return'mil-heavy';

  /* Quad turboprops (military transport, maritime patrol, freighters) */
  if(/^(C130|L100|C30J|AN12|L188|P3[A-Z]?|A400|TP10|E2[A-Z])$/.test(t))return'turboprop4';

  /* Widebody quads · trijets · widebody twins */
  if(/^(B74[0-9SX]?|A38[0-9F]?|A34[02359]|AN124|A124|IL96)/.test(t))return'wide4';
  if(/^(MD11|DC10|L101)/.test(t))return'tri';
  if(/^(B76[0-9]|B77[0-9LWX]?|B78[0-9X]?|A30[0-9B]?|A310|A33[0-9]|A35[0-9K]?|IL86|A3ST)/.test(t))return'wide2';

  /* Narrowbody airliners */
  if(/^(B73[5-9GHIJ]|B38M|B39M|B70[0-9]|B72[0-9]|B75[23]|A31[89]|A318|A319|A320|A321|A32[0-9NMO]|A19N|A20N|A21N|MD8[0-9]|MD9[012]|DC9|B712|B717|E19[05]|E195|E29[05]|BCS[123]|CS[13]|A220|P8[A-Z]?)/.test(t))return'narrow';

  /* Business jets (rear-mounted engines, T-tail) */
  if(/^(C25[0-9ABCM]|C5[0-9]{2}|C56X|C650|C68[0A]|C700|C750|GL[4-7][0-9]?|GLEX|GLF[3-6]|G[23][0-9]{2}|G280|G[5-7]00|GALX|LJ[0-9]{2}|FA[0-9][0-9]|FA7X|FA8X|F2TH|PC24|CL[36][0-9]|CL60|H25[0-9ABC]|E50P|E55P|PRM1|SBRL|WW[234][0-9]|ASTR|HA4T|BE40|BE4[0-9])/.test(t))return'bizjet';

  /* Regional jets */
  if(/^(CRJ[1279X]?|E1[34][0-9]|E145|E170|E175|E27[05]|ERJ|RJ[0-9]{2})/.test(t))return'regional';

  /* Twin turboprops */
  if(/^(DH8[ABCD]|DHC[678]|Q[234][0-9]|SF3[24]|SB20|BE[23][0-9]|B190|PC12|PC[67]|C212|BN2|JS[34][0-9]|L410|AT[457][0-9]|AT7[56]|DO[0-9]{2}|TP14|CN[23][0-9]|C295|PAC7|KODE|D328)/.test(t))return'turboprop';

  /* Piston twins / singles, gliders, ultralights */
  if(/^(BE5[5-9]|BE58|BE76|PA[23][134]|PA44|C30[2-9]|C31[0-9]|C33[0-9]|C34[02]|C40[2-9]|C41[0-9]|C42[015]|V35|TW[0-9])/.test(t))return'piston-twin';
  if(/^(C1[5-9][0-9]|C172|C150|C152|C162|C177|C180|C182|C185|PA18|PA22|PA24|PA28|P28[ABT]|DA20|DA40|SR20|SR22|RV[3-9]|RV10|CTLS|CT2K|DIMO|JABI|MOSE)/.test(t))return'piston-single';
  if(/^(ASK|ASG|ASH|ASW|LS[0-9]|SZD|DG[0-9]{2}|PIK|DISC|NIMB|VENT|PW[56]|K8|K13|K21|GLAS|BLAN)/.test(t))return'glider';
  if(/^(ULAC|ULTR|MOTO|FOUR|JABIRU|EURO|IKARUS|SSEA|A22)/.test(t))return'ultralight';

  return'def';
}

/* ── CATEGORY METADATA ───────────────────────────────────────────────────── */
function acCategory(kind){
  const M={
    wide4:          {label:'WIDEBODY · QUAD', cls:'cat-heavy',      chip:'HEAVY'},
    wide2:          {label:'WIDEBODY · TWIN', cls:'cat-heavy',      chip:'HEAVY'},
    tri:            {label:'TRIJET',          cls:'cat-heavy',      chip:'HEAVY'},
    narrow:         {label:'AIRLINER',        cls:'cat-airline',    chip:'AIRLINE'},
    regional:       {label:'REGIONAL',        cls:'cat-airline',    chip:'AIRLINE'},
    turboprop:      {label:'TURBOPROP',       cls:'cat-ga',         chip:'GA'},
    turboprop4:     {label:'MIL TRANSPORT',   cls:'cat-military',   chip:'MILITARY'},
    bizjet:         {label:'BIZJET',          cls:'cat-bizjet',     chip:'BIZJET'},
    'piston-single':{label:'GA · SINGLE',     cls:'cat-ga',         chip:'GA'},
    'piston-twin':  {label:'GA · TWIN',       cls:'cat-ga',         chip:'GA'},
    heli:           {label:'HELICOPTER',      cls:'cat-rotorcraft', chip:'ROTOR'},
    'heli-tandem':  {label:'HELI · TANDEM',   cls:'cat-rotorcraft', chip:'ROTOR'},
    fighter:        {label:'FIGHTER',         cls:'cat-military',   chip:'MILITARY'},
    'flying-wing':  {label:'FLYING WING',     cls:'cat-military',   chip:'MILITARY'},
    'mil-heavy':    {label:'MIL HEAVY',       cls:'cat-military',   chip:'MILITARY'},
    glider:         {label:'GLIDER',          cls:'cat-unknown',    chip:'OTHER'},
    ultralight:     {label:'ULTRALIGHT',      cls:'cat-ga',         chip:'GA'},
    'vehicle':      {label:'GROUND VEHICLE',  cls:'cat-ground',     chip:'GROUND'},
    'vehicle-emg':  {label:'EMERGENCY VEHICLE',cls:'cat-ground',    chip:'GROUND'},
    def:            {label:'AIRCRAFT',        cls:'cat-unknown',    chip:'OTHER'},
  };
  return M[kind]||M.def;
}
/* Filter chip keys, in display order */
const CHIPS=['HEAVY','AIRLINE','BIZJET','GA','ROTOR','MILITARY','GROUND','OTHER'];

/* ── SILHOUETTE BUILDER (viewBox 0 0 32 32, nose toward y=0) ──────────────── */
function wing(c,rootY,rootChord,span,tipY,tipChord){
  const tw=tipChord==null?1.4:tipChord;
  return`<path fill="${c}" d="M16 ${f(rootY)} `+
    `L${f(16-span)} ${f(tipY)} L${f(16-span+0.9)} ${f(tipY+tw)} `+
    `L16 ${f(rootY+rootChord)} `+
    `L${f(16+span-0.9)} ${f(tipY+tw)} L${f(16+span)} ${f(tipY)} Z"/>`;
}
function plane(c,o){
  const fw=o.fw, sh=o.ny+(o.nl==null?fw*2.4:o.nl);
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
  if(o.ceng)s+=`<rect x="${f(16-o.ceng.w)}" y="${f(o.ceng.y)}" width="${f(o.ceng.w*2)}" height="${f(o.ceng.h)}" rx="${f(o.ceng.w*0.8)}" fill="${c}"/>`;
  if(o.prop)for(const p of o.prop){
    s+=`<circle cx="${f(16-p.dx)}" cy="${f(p.y)}" r="${f(p.r)}" fill="none" stroke="${c}" stroke-width="0.9" opacity=".75"/>`;
    s+=`<circle cx="${f(16+p.dx)}" cy="${f(p.y)}" r="${f(p.r)}" fill="none" stroke="${c}" stroke-width="0.9" opacity=".75"/>`;
  }
  if(o.nose)s+=`<circle cx="16" cy="${f(o.nose.y)}" r="${f(o.nose.r)}" fill="none" stroke="${c}" stroke-width="1" opacity=".8"/>`;
  return s;
}

const SHAPES={
  /* widebody quad — long body, long swept wings, two nacelles per side (4 engines) */
  wide4:c=>plane(c,{fw:2.1,ny:3,nl:5,ty:29,wy:12,ws:13.5,wtipy:19,wrt:5.4,wtw:2,sy:25,ss:5.6,sty:29,srt:1.7,stw:1.2,
    eng:[{dx:4.6,w:1.25,y:15,h:3.6},{dx:8.4,w:1.1,y:16.6,h:3.2}]}),
  /* widebody twin — long body, one big nacelle per side */
  wide2:c=>plane(c,{fw:2.0,ny:3.2,nl:5,ty:29,wy:12.2,ws:13,wtipy:18.8,wrt:5.2,wtw:1.9,sy:25,ss:5.4,sty:29,srt:1.6,stw:1.2,
    eng:[{dx:5.0,w:1.35,y:15.2,h:4}]}),
  /* trijet — two wing nacelles + a centreline engine at the tail */
  tri:c=>plane(c,{fw:1.95,ny:3.4,nl:4.8,ty:28.6,wy:12.6,ws:12,wtipy:18.4,wrt:4.9,wtw:1.8,sy:24.8,ss:5,sty:28.6,srt:1.5,
    eng:[{dx:4.7,w:1.2,y:15.6,h:3.6}],ceng:{w:1.05,y:22.6,h:3.4}}),
  /* narrowbody airliner — one nacelle per side */
  narrow:c=>plane(c,{fw:1.7,ny:3.8,nl:4.4,ty:28,wy:13,ws:10.5,wtipy:19,wrt:4.6,wtw:1.5,sy:24.4,ss:4.6,sty:28,srt:1.4,
    eng:[{dx:4.2,w:1.05,y:16,h:3.2}]}),
  regional:c=>plane(c,{fw:1.5,ny:4.6,nl:4,ty:27,wy:14,ws:9,wtipy:18.6,wrt:3.9,wtw:1.3,sy:23.8,ss:4.2,sty:27,srt:1.3,
    eng:[{dx:3.5,w:0.92,y:16.6,h:2.8}]}),
  /* bizjet — slim body, rear-mounted nacelles, T-tail */
  bizjet:c=>plane(c,{fw:1.25,ny:4.4,nl:4.2,ty:26.5,wy:14.6,ws:7.8,wtipy:19,wrt:3.2,wtw:1.1,sy:24.6,ss:4.2,sty:27,srt:1.2,
    eng:[{dx:2.5,w:0.85,y:22,h:2.6}]}),
  /* twin turboprop — wing-mounted prop discs, straighter wings */
  turboprop:c=>plane(c,{fw:1.6,ny:4.8,nl:4.2,ty:27,wy:13.4,ws:10,wtipy:15.4,wrt:3.8,wtw:1.4,sy:24,ss:4.4,sty:27,srt:1.3,
    prop:[{dx:5.6,y:12.6,r:2.4}]}),
  /* quad turboprop — four prop discs, long straight high wing (C-130 etc) */
  turboprop4:c=>plane(c,{fw:1.75,ny:4.4,nl:4.4,ty:27.8,wy:12.8,ws:12.6,wtipy:14.8,wrt:3.6,wtw:1.3,sy:24.2,ss:5,sty:27.8,srt:1.4,
    prop:[{dx:3.3,y:11.4,r:2},{dx:7.1,y:11.9,r:2.2}]}),
  /* military 4-engine jet heavy — AWACS / tanker / strategic transport */
  'mil-heavy':c=>plane(c,{fw:1.95,ny:3.4,nl:4.6,ty:28.6,wy:12.5,ws:12.8,wtipy:17.6,wrt:4.8,wtw:1.7,sy:24.6,ss:5,sty:28.6,srt:1.5,
    eng:[{dx:4.4,w:1.15,y:15.2,h:3.4},{dx:8.0,w:1.05,y:16.6,h:3}]}),
  'piston-twin':c=>plane(c,{fw:1.35,ny:6,nl:3.4,ty:26.5,wy:14,ws:9,wtipy:15.4,wrt:3.2,wtw:1.1,sy:24,ss:4,sty:26.5,srt:1.1,
    prop:[{dx:5,y:12.6,r:2}]}),
  'piston-single':c=>plane(c,{fw:1.3,ny:8.5,nl:2.6,ty:27,wy:14.6,ws:8.5,wtipy:15.4,wrt:2.8,wtw:1,sy:24.6,ss:3.8,sty:27,srt:1,
    nose:{y:8.2,r:2.3}}),
  glider:c=>plane(c,{fw:0.9,ny:5.5,nl:3.2,ty:26.5,wy:15.4,ws:14.2,wtipy:16.6,wrt:1.8,wtw:0.7,sy:24,ss:4,sty:26.5,srt:0.9,stw:0.7}),
  ultralight:c=>plane(c,{fw:1.05,ny:8.5,nl:2.2,ty:25.5,wy:13.6,ws:8,wtipy:14,wrt:2.2,wtw:0.9,sy:23,ss:3.2,sty:25.5,srt:0.9,
    nose:{y:8.4,r:1.8}}),
  def:c=>plane(c,{fw:1.5,ny:4.6,nl:4,ty:27.5,wy:13.4,ws:9.5,wtipy:18,wrt:4,wtw:1.4,sy:24,ss:4.3,sty:27.5,srt:1.3}),
  /* fighter — sharp arrowhead with twin tail */
  fighter:c=>`<path fill="${c}" d="M16 2.5 L17.8 11 L18.4 14 L30 19.5 L30 21.2 L18.6 18.4 L18.2 25 L20.6 29.5 L20.6 30.6 L16 28.8 L11.4 30.6 L11.4 29.5 L13.8 25 L13.4 18.4 L2 21.2 L2 19.5 L13.6 14 L14.2 11 Z"/>`,
  /* flying wing — broad shallow chevron with a sawtooth trailing edge (B-2) */
  'flying-wing':c=>`<path fill="${c}" d="M16 5.5 L30.5 20.5 L30.5 22 L22.2 20.2 L19 23.4 L16 21.6 L13 23.4 L9.8 20.2 L1.5 22 L1.5 20.5 Z"/>`,
  /* helicopter — faint rotor disc, two-blade rotor, fuselage pod + tail boom */
  heli:c=>`<circle cx="16" cy="13.5" r="9.2" fill="none" stroke="${c}" stroke-width="0.7" opacity=".28"/>`+
    `<line x1="6.8" y1="13.5" x2="25.2" y2="13.5" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>`+
    `<line x1="16" y1="4.3" x2="16" y2="22.7" stroke="${c}" stroke-width="1.7" stroke-linecap="round" opacity=".5"/>`+
    `<ellipse cx="16" cy="14.5" rx="2.7" ry="4.6" fill="${c}"/>`+
    `<rect x="15.35" y="18.5" width="1.3" height="8" rx="0.6" fill="${c}" opacity=".9"/>`+
    `<line x1="12.8" y1="26" x2="19.2" y2="26" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  /* tandem-rotor helicopter — two overlapping rotor discs fore & aft (Chinook) */
  'heli-tandem':c=>`<circle cx="16" cy="9" r="7.6" fill="none" stroke="${c}" stroke-width="0.7" opacity=".26"/>`+
    `<circle cx="16" cy="22.4" r="7.6" fill="none" stroke="${c}" stroke-width="0.7" opacity=".26"/>`+
    `<rect x="13.4" y="6.5" width="5.2" height="19" rx="2.2" fill="${c}"/>`+
    `<line x1="8.6" y1="9" x2="23.4" y2="9" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`+
    `<line x1="8.6" y1="22.4" x2="23.4" y2="22.4" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  /* ground vehicle — top-down body, windshield band, roof */
  vehicle:c=>`<rect x="11.3" y="8.5" width="9.4" height="15" rx="2.4" fill="${c}"/>`+
    `<rect x="12.8" y="10" width="6.4" height="3" rx="1" fill="#0b1220" opacity=".55"/>`+
    `<rect x="12.6" y="13.6" width="6.8" height="5" rx="1" fill="#0b1220" opacity=".32"/>`+
    `<rect x="12.8" y="19.4" width="6.4" height="2.6" rx="1" fill="#0b1220" opacity=".5"/>`,
  'vehicle-emg':c=>`<rect x="11.3" y="8.5" width="9.4" height="15" rx="2.4" fill="${c}"/>`+
    `<rect x="12.6" y="14" width="6.8" height="5" rx="1" fill="#0b1220" opacity=".32"/>`+
    `<rect x="12.8" y="20" width="6.4" height="2.4" rx="1" fill="#0b1220" opacity=".5"/>`+
    `<rect x="12.4" y="10" width="7.2" height="2.4" rx="1.2" fill="#ffffff" opacity=".95"/>`,
};

/* Fallback pixel size per kind when the type's wingspan is unknown */
const ISIZES={wide4:42,wide2:40,tri:38,narrow:30,regional:26,bizjet:23,turboprop:27,turboprop4:34,
  'mil-heavy':40,'piston-twin':22,'piston-single':19,heli:24,'heli-tandem':28,fighter:24,
  'flying-wing':34,glider:30,ultralight:17,vehicle:17,'vehicle-emg':18,def:26};

/* ── REAL WINGSPAN (m) BY TYPE FAMILY — drives marker size ───────────────────
   Approximate published wingspans, most-specific patterns first. */
const SPAN=[
  [/^A38/,79.8],[/^AN124|^A124/,73.3],[/^C5[AM]?$/,67.9],[/^B74/,64.4],
  [/^A35/,64.8],[/^B77/,64.8],[/^A34/,63.4],[/^B78/,60.1],[/^A33/,60.3],[/^IL96/,60.1],
  [/^B52/,56.4],[/^B2A?$/,52.4],[/^C17A?$/,51.8],[/^MD11/,51.7],[/^DC10/,50.4],[/^L101/,47.3],
  [/^B76/,47.6],[/^E3|^E8|^K35|^KC135|^R135|^RC135|^VC25|^B70/,44.4],[/^A30|^A310|^A3ST/,44.8],
  [/^C130|^L100|^C30J|^A400/,40.4],[/^AN12/,38],
  [/^B75/,38.0],[/^P8/,35.8],[/^B73|^B38M|^B39M/,35.8],
  [/^A31[89]|^A318|^A319|^A320|^A321|^A32|^A19N|^A2[019]N/,35.8],[/^BCS|^CS[13]|^A220|^A22/,35.1],
  [/^P3/,30.4],[/^MD8|^MD9|^B71|^B72|^DC9/,32.9],
  [/^E19|^E29/,28.7],[/^DH8D|^Q4/,28.4],[/^AT[457]/,27.1],[/^E17|^E27/,26],[/^DH8|^Q[23]|^DHC[78]/,25.9],
  [/^C212|^CN2|^C295|^D328/,25.3],[/^CRJ/,23.2],[/^SF3|^SB20/,21],[/^E14|^ERJ|^E145|^RJ/,20.0],
  [/^GLEX|^GL[567]|^GLF[3-6]/,28.5],[/^G280|^GALX|^G[23]00/,18.9],
  [/^BE19|^B190|^BE2|^BE3/,17.6],[/^PC12/,16.2],[/^E2[A-Z]/,24.6],[/^P3[A-Z]?/,30.4],
  [/^F22/,13.6],[/^F18|^FA18/,13.6],[/^F15/,13.1],[/^F4/,11.7],[/^EUFI|^TYPH|^TYEU|^RFAL/,10.9],
  [/^F35/,10.7],[/^F16/,10],[/^GRIP/,8.4],[/^A10/,17.5],[/^AV8|^HARR/,9.25],[/^HAWK|^ALPH|^T38|^T6/,9.4],
  [/^MIG|^MG[0-9]|^SU[0-9]|^J1[05]|^J20/,14],
  [/^CH4[67]/,18.3],[/^MI[0-9]/,21.3],[/^S92|^S70|^UH60|^VH60|^S61|^CH5|^CH3/,18.9],
  [/^EC[0-9]|^H1[0-9]|^R22|^R44|^R66|^B0[4-9]|^B47|^AS3|^A109|^A119|^A139|^AW1|^S76|^MD5|^MD9/,11],
  [/^AS[KGHW]|^LS[0-9]|^DG[0-9]|^DISC|^NIMB|^VENT|^SZD|^PIK/,18],
  [/^C5[0-9]{2}|^C56X|^C68|^C700|^C750|^C25|^LJ|^FA[0-9]|^F2TH|^PC24|^H25|^E50P|^E55P|^PRM1|^BE40|^CL[36]/,15.8],
  [/^BE5|^PA3|^PA4|^C31|^C33|^C34|^C40|^C41|^C42|^V35|^TW/,12],
  [/^C17[2-9]|^C15[0-9]|^C162|^C18|^P28|^PA28|^PA18|^PA2[24]|^SR2|^DA40|^DA20|^RV[0-9]|^C177/,11],
];
function airframeSpan(t){if(!t)return null;for(const[re,m]of SPAN)if(re.test(t))return m;return null;}
const MINSZ={fighter:21,heli:22,'heli-tandem':24,glider:26,ultralight:16,vehicle:16,'vehicle-emg':17,bizjet:20};
function iconSize(kind,t){
  const span=airframeSpan(String(t||'').toUpperCase().replace(/[-\s]/g,''));
  if(span!=null)return Math.min(46,Math.max(MINSZ[kind]||17,Math.round(13+span*0.42)));
  return ISIZES[kind]||26;
}

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
  const t=raw.t||raw.type||'';
  const track=pickN(raw.track,raw.mag_heading,raw.true_heading)||0;
  let color;
  if(sel)color='#ffb14a';
  else if(kind==='vehicle-emg')color='#e84848';
  else if(kind==='vehicle')color='#9aa7bd';
  else color=iconColor(raw);
  const halo=sel
    ? 'filter:drop-shadow(0 0 4px rgba(255,177,74,.95)) drop-shadow(0 0 1px rgba(0,0,0,.85));'
    : 'filter:drop-shadow(0 0 1.4px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.25));';
  const sz=iconSize(kind,t);
  const body=(SHAPES[kind]||SHAPES.def)(color);
  const h=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sz}" height="${sz}" style="transform:rotate(${track}deg);display:block;${halo}">${body}</svg>`;
  return L.divIcon({html:h,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-(sz/2+5)]});
}

function isVehicle(raw){const k=classifyAC(raw||{});return k==='vehicle'||k==='vehicle-emg';}

window.AC={classifyAC,acCategory,CHIPS,SHAPES,ISIZES,SPAN,airframeSpan,iconSize,ALT_BANDS,altColor,iconColor,makeIcon,isVehicle};
})();
