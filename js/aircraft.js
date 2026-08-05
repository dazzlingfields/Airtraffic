/* ============================================================================
   OVERHEAD · Aircraft classification + iconography
   Pure functions exposed on window.AC. No external state.

   Top-down silhouettes graded by AIRFRAME: shape follows engine count and
   layout (twin vs quad widebody, trijet, quad-turboprop, fighter, flying wing,
   tandem rotor), and pixel size follows the type's real wingspan. Surface
   targets (ADS-B category C*) render as ground vehicles, not aircraft.

   ── v2 GEOMETRY NOTES ──────────────────────────────────────────────────────
   · Fuselages use an ogive nose (cubic) and a tapered tail cone (quadratic)
     rather than the old straight wedge, which read as a dart at small sizes.
   · Wings carry a mid-span station, so the leading edge sweeps and the
     trailing edge kinks at the root fairing (the "Yehudi" on the 737/A320
     family). A single trapezoid cannot express that and looked generic.
   · Nacelles are joined to the wing by a pylon instead of floating beside it.
   · A vertical fin sliver sits on the centreline aft, as seen from above.
   · Separation from the basemap is a stroke baked into the SVG via
     paint-order, NOT a CSS drop-shadow filter. Two filter passes across
     several hundred simultaneous divIcons was the largest per-frame
     compositing cost in the previous build.
   · Every shape is translated so its geometric centre sits on (16,16), so a
     CSS rotate() about the element centre pivots about the true centroid.
     Previously GA singles and rotorcraft orbited a point behind themselves.
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

/* ══ GEOMETRY PRIMITIVES ═════════════════════════════════════════════════════
   All shapes are authored in a 0 0 32 32 viewBox, nose toward y=0, centreline
   on x=16. Paths carry no fill or stroke of their own; the parent <g> supplies
   both. That keeps the markup small and lets makeIcon() recolour the whole
   silhouette by touching a single attribute. */

/* Fuselage: ogive nose, parallel mid-body, tapered tail cone.
     ny  nose tip y            nl  nose length (tip to full width)
     fw  half-width            ty  tail extremity y
     tw  tail cone half-width at the extremity                                */
function fuse(o){
  const fw=o.fw, ny=o.ny, nl=o.nl==null?o.fw*2.4:o.nl, ty=o.ty,
        tw=o.tw==null?Math.max(0.18,fw*0.16):o.tw;
  const ns=ny+nl;                       // full width reached here
  const ts=ty-(ty-ns)*0.26;             // tail cone begins here
  const cq=ty-(ty-ts)*0.30;             // tail cone control point
  return`M16 ${f(ny)}`+
    `C${f(16+fw*0.60)} ${f(ny+nl*0.28)} ${f(16+fw)} ${f(ny+nl*0.60)} ${f(16+fw)} ${f(ns)}`+
    `L${f(16+fw)} ${f(ts)}`+
    `Q${f(16+fw)} ${f(cq)} ${f(16+tw)} ${f(ty)}`+
    `L${f(16-tw)} ${f(ty)}`+
    `Q${f(16-fw)} ${f(cq)} ${f(16-fw)} ${f(ts)}`+
    `L${f(16-fw)} ${f(ns)}`+
    `C${f(16-fw)} ${f(ny+nl*0.60)} ${f(16-fw*0.60)} ${f(ny+nl*0.28)} 16 ${f(ny)}Z`;
}

/* One semi-span with a mid-span station.
     y0  root leading edge     rc  root chord        sp  semi-span
     tipY  tip leading edge y  tc  tip chord
     k   kink position as a fraction of semi-span
     le  fraction of total LE sweep reached at the kink. le>k gives a more
         steeply swept inboard leading edge (a glove or LERX); le==k is straight
     te  fraction of total TE sweep reached at the kink. te<k holds the inboard
         trailing edge nearly square to the fuselage before it sweeps aft,
         which is what produces the Yehudi on the 737/A320 family

   Both edges are interpolated between their own root and tip endpoints, so the
   chord shrinks monotonically root → kink → tip. The earlier version derived
   the kink trailing edge from a chord fraction, which let it fall forward of
   the root trailing edge and cut a notch into the wing.
   sgn selects the left or right side.                                        */
function semiWing(o,sgn){
  const k=o.k==null?0.32:o.k, le=o.le==null?k*1.18:o.le, te=o.te==null?k*0.34:o.te;
  const xk=16+sgn*o.sp*k, xt=16+sgn*o.sp;
  const ytLE=o.tipY, yrTE=o.y0+o.rc, ytTE=ytLE+o.tc;
  const ykLE=o.y0+(ytLE-o.y0)*le;
  const ykTE=yrTE+(ytTE-yrTE)*te;
  const xr=xt-sgn*0.30;                  // slight tip chord inset
  return`M16 ${f(o.y0)}L${f(xk)} ${f(ykLE)}L${f(xt)} ${f(ytLE)}`+
    `Q${f(xt+sgn*0.20)} ${f((ytLE+ytTE)/2)} ${f(xr)} ${f(ytTE)}`+
    `L${f(xk)} ${f(ykTE)}L16 ${f(yrTE)}Z`;
}
const wingPair=o=>semiWing(o,-1)+semiWing(o,1);

/* Vertical fin, seen edge-on from above: a narrow blade on the centreline. */
function fin(o){
  const w=o.w==null?0.42:o.w;
  return`M16 ${f(o.y0)}L${f(16+w)} ${f(o.y0+o.h*0.55)}L${f(16+w*0.7)} ${f(o.y0+o.h)}`+
    `L${f(16-w*0.7)} ${f(o.y0+o.h)}L${f(16-w)} ${f(o.y0+o.h*0.55)}Z`;
}

/* Wing leading-edge y at a given distance from the centreline. Nacelle and
   propeller stations are derived from this rather than hand-authored, so a
   pylon can never float ahead of the wing it is supposed to hang from. */
function leAt(o,dx){
  const sp=o.ws, k=o.wk==null?0.32:o.wk, le=o.wle==null?k*1.18:o.wle;
  const fr=Math.min(1,Math.abs(dx)/sp);
  const ykLE=o.wy+(o.wtipy-o.wy)*le;
  return fr<=k ? o.wy+(ykLE-o.wy)*(fr/k)
               : ykLE+(o.wtipy-ykLE)*((fr-k)/(1-k));
}

/* Podded nacelle plus the pylon joining it to the structure.
     dx  station from centreline    w  half-width    h  length
     yLE leading-edge y at that station (supplied by plane())
     side  true for rear-fuselage mounts, which take a horizontal stub pylon
           to the fuselage side instead of a vertical one to the wing        */
function nacellePair(e){
  const w=e.w, h=e.h, r=w*0.9;
  const y=e.side ? e.y : e.yLE-h*0.62;      // wing pods protrude ahead of the LE
  let s='';
  for(const sgn of[-1,1]){
    const x=16+sgn*e.dx;
    s+=`<path d="M${f(x-w)} ${f(y+r)}Q${f(x-w)} ${f(y)} ${f(x)} ${f(y)}`+
       `Q${f(x+w)} ${f(y)} ${f(x+w)} ${f(y+r)}L${f(x+w)} ${f(y+h-r*0.7)}`+
       `Q${f(x+w)} ${f(y+h)} ${f(x)} ${f(y+h)}Q${f(x-w)} ${f(y+h)} ${f(x-w)} ${f(y+h-r*0.7)}Z"/>`;
    if(e.side){
      // horizontal stub from the fuselage flank to the nacelle
      const xi=16+sgn*(e.fw||1.2), xo=x-sgn*w*0.4;
      s+=`<path d="M${f(xi)} ${f(y+h*0.24)}L${f(xo)} ${f(y+h*0.30)}`+
         `L${f(xo)} ${f(y+h*0.62)}L${f(xi)} ${f(y+h*0.58)}Z"/>`;
    }else{
      // vertical pylon from the nacelle back onto the wing leading edge
      const py=e.yLE+0.35;
      s+=`<path d="M${f(x-w*0.30)} ${f(y+h*0.45)}L${f(x+w*0.30)} ${f(y+h*0.45)}`+
         `L${f(x+w*0.20)} ${f(py)}L${f(x-w*0.20)} ${f(py)}Z"/>`;
    }
  }
  return s;
}

/* Turboprop nacelle: streamlined pod with a spinner and a faint blade arc. */
function propPair(p){
  let s='';
  for(const sgn of[-1,1]){
    const x=16+sgn*p.dx;
    // p.y is supplied by plane(), set just ahead of the wing leading edge
    s+=`<circle cx="${f(x)}" cy="${f(p.y)}" r="${f(p.r)}" fill="none" stroke-width="0.55" opacity=".42"/>`;
    s+=`<path d="M${f(x-p.n)} ${f(p.y+p.n*0.7)}Q${f(x-p.n)} ${f(p.y-p.n*0.4)} ${f(x)} ${f(p.y-p.n*0.6)}`+
       `Q${f(x+p.n)} ${f(p.y-p.n*0.4)} ${f(x+p.n)} ${f(p.y+p.n*0.7)}L${f(x+p.n*0.8)} ${f(p.y+p.h)}`+
       `L${f(x-p.n*0.8)} ${f(p.y+p.h)}Z"/>`;
  }
  return s;
}

/* Fixed-wing assembly. Returns path soup; makeIcon wraps it in a styled <g>. */
function plane(o){
  let s=`<path d="${fuse(o)}"/>`;
  s+=`<path d="${wingPair({y0:o.wy,rc:o.wrt,sp:o.ws,tipY:o.wtipy,tc:o.wtw,k:o.wk,le:o.wle,te:o.wte})}"/>`;
  s+=`<path d="${wingPair({y0:o.sy,rc:o.srt||1.2,sp:o.ss,tipY:o.sty,tc:o.stw||0.9,k:0.42,le:0.46,te:0.30})}"/>`;
  if(o.fin!==false)s+=`<path d="${fin({y0:o.sy-(o.finL||3.2),h:o.finL||3.2,w:o.finW})}"/>`;
  if(o.eng)for(const e of o.eng)s+=nacellePair(Object.assign({},e,{yLE:leAt(o,e.dx),fw:o.fw}));
  if(o.ceng){                            // centreline engine (trijet)
    const c=o.ceng;
    s+=`<path d="M${f(16-c.w)} ${f(c.y+c.w)}Q${f(16-c.w)} ${f(c.y)} 16 ${f(c.y)}`+
       `Q${f(16+c.w)} ${f(c.y)} ${f(16+c.w)} ${f(c.y+c.w)}L${f(16+c.w)} ${f(c.y+c.h)}`+
       `L${f(16-c.w)} ${f(c.y+c.h)}Z"/>`;
  }
  if(o.prop)for(const p of o.prop)s+=propPair(Object.assign({},p,{y:leAt(o,p.dx)-(p.lead==null?1.05:p.lead)}));
  if(o.spinner)s+=`<circle cx="16" cy="${f(o.spinner.y)}" r="${f(o.spinner.r)}" fill="none" stroke-width="0.6" opacity=".45"/>`+
    `<circle cx="16" cy="${f(o.spinner.y)}" r="0.55"/>`;
  return s;
}

const SHAPES={
  /* widebody quad — long body, cranked wing, two nacelles per side */
  wide4:()=>plane({fw:1.95,ny:2.6,nl:4.6,ty:29.2,wy:12.2,ws:13.6,wtipy:19.4,wrt:5.6,wtw:1.5,
    wk:0.3,wle:0.38,wte:0.07,sy:25.4,ss:4.9,sty:28.6,srt:1.55,stw:1,finL:3.6,finW:0.5,
    eng:[{dx:4.6,w:1.15,h:3.7},{dx:8.4,w:1.0,h:3.2}]}),
  /* widebody twin — long body, one large nacelle per side */
  wide2:()=>plane({fw:1.9,ny:2.8,nl:4.6,ty:29,wy:12.4,ws:13.1,wtipy:19.2,wrt:5.4,wtw:1.45,
    wk:0.3,wle:0.37,wte:0.07,sy:25.2,ss:4.7,sty:28.4,srt:1.5,stw:1,finL:3.5,finW:0.5,
    eng:[{dx:5.0,w:1.28,h:4.1}]}),
  /* trijet — two wing nacelles plus a centreline engine at the tail */
  tri:()=>plane({fw:1.85,ny:3.0,nl:4.4,ty:28.8,wy:12.8,ws:12.1,wtipy:18.8,wrt:5.0,wtw:1.35,
    wk:0.3,wle:0.37,wte:0.08,sy:24.9,ss:4.4,sty:28.0,srt:1.4,stw:0.95,finL:3.4,
    eng:[{dx:4.7,w:1.15,h:3.7}],ceng:{w:1.0,y:22.6,h:3.6}}),
  /* narrowbody — pronounced trailing-edge kink at the root fairing */
  narrow:()=>plane({fw:1.6,ny:3.4,nl:4.0,ty:28.2,wy:13.2,ws:10.6,wtipy:19.4,wrt:4.8,wtw:1.15,
    wk:0.28,wle:0.4,wte:0.06,sy:24.6,ss:4.0,sty:27.5,srt:1.3,stw:0.9,finL:3.2,
    eng:[{dx:4.2,w:1.0,h:3.3}]}),
  regional:()=>plane({fw:1.42,ny:4.2,nl:3.6,ty:27.2,wy:14.1,ws:9.0,wtipy:18.9,wrt:4.1,wtw:1,
    wk:0.3,wle:0.36,wte:0.09,sy:23.9,ss:3.7,sty:26.6,srt:1.2,stw:0.85,finL:3,
    eng:[{dx:3.5,w:0.88,h:2.9}]}),
  /* bizjet — slim body, rear-mounted nacelles, T-tail */
  bizjet:()=>plane({fw:1.18,ny:4.0,nl:3.8,ty:26.8,wy:14.7,ws:7.9,wtipy:19.4,wrt:3.3,wtw:0.85,
    wk:0.3,wle:0.36,wte:0.09,sy:25.0,ss:4.3,sty:26.6,srt:1.2,stw:0.8,finL:3.4,finW:0.46,
    eng:[{dx:2.15,w:0.80,y:20.9,h:3.0,side:true}]}),
  /* twin turboprop — straighter high wing, prop discs on the leading edge */
  turboprop:()=>plane({fw:1.52,ny:4.4,nl:3.8,ty:27.2,wy:13.6,ws:10.1,wtipy:15.6,wrt:3.9,wtw:1.2,
    wk:0.45,wle:0.45,wte:0.45,sy:24.1,ss:4.4,sty:26.9,srt:1.35,stw:0.9,finL:3,
    prop:[{dx:5.5,r:2.35,n:0.62,h:1.9}]}),
  /* quad turboprop — long straight high wing, four discs (C-130 etc) */
  turboprop4:()=>plane({fw:1.68,ny:4.0,nl:4.0,ty:28.0,wy:12.9,ws:12.7,wtipy:15.0,wrt:3.7,wtw:1.15,
    wk:0.46,wle:0.46,wte:0.46,sy:24.3,ss:5.0,sty:27.7,srt:1.45,stw:0.95,finL:3.4,
    prop:[{dx:3.3,r:1.95,n:0.55,h:1.7},{dx:7.1,r:2.1,n:0.58,h:1.8}]}),
  /* four-engine military jet — AWACS / tanker / strategic transport */
  'mil-heavy':()=>plane({fw:1.88,ny:3.0,nl:4.4,ty:28.8,wy:12.6,ws:12.9,wtipy:17.9,wrt:5.0,wtw:1.3,
    wk:0.31,wle:0.38,wte:0.08,sy:24.8,ss:4.5,sty:28.2,srt:1.4,stw:0.95,finL:3.5,
    eng:[{dx:4.4,w:1.08,h:3.5},{dx:8.0,w:0.98,h:3.1}]}),
  'piston-twin':()=>plane({fw:1.28,ny:5.6,nl:3.0,ty:26.6,wy:14.2,ws:9.1,wtipy:15.6,wrt:3.3,wtw:0.95,
    wk:0.46,wle:0.46,wte:0.46,sy:24.1,ss:4.0,sty:26.4,srt:1.15,stw:0.8,finL:2.8,
    prop:[{dx:5.0,r:1.95,n:0.52,h:1.6}]}),
  'piston-single':()=>plane({fw:1.22,ny:7.9,nl:2.4,ty:27.0,wy:14.6,ws:8.6,wtipy:15.6,wrt:2.9,wtw:0.9,
    wk:0.48,wle:0.48,wte:0.48,sy:24.6,ss:3.8,sty:26.8,srt:1.05,stw:0.75,finL:2.8,
    spinner:{y:8.0,r:2.25}}),
  glider:()=>plane({fw:0.82,ny:5.2,nl:2.8,ty:26.6,wy:15.4,ws:14.3,wtipy:16.6,wrt:1.9,wtw:0.55,
    wk:0.5,wle:0.5,wte:0.5,sy:24.1,ss:4.0,sty:26.4,srt:0.95,stw:0.65,finL:2.6,finW:0.34}),
  ultralight:()=>plane({fw:0.98,ny:8.0,nl:2.0,ty:25.6,wy:13.6,ws:8.1,wtipy:14.1,wrt:2.3,wtw:0.8,
    wk:0.5,wle:0.5,wte:0.5,sy:23.1,ss:3.2,sty:25.4,srt:0.95,stw:0.7,finL:2.4,
    spinner:{y:8.1,r:1.75}}),
  def:()=>plane({fw:1.45,ny:4.2,nl:3.8,ty:27.6,wy:13.6,ws:9.6,wtipy:18.2,wrt:4.2,wtw:1.15,
    sy:24.1,ss:4.3,sty:27.4,srt:1.3,stw:0.9,finL:3}),

  /* fighter — chined forebody, blended arrowhead, canted twin tails */
  fighter:()=>`<path d="M16 2.2C16.9 4.6 17.5 7.6 17.7 10.4L18.3 14.2`+
    `L29.6 19.3Q30.3 19.6 30.3 20.4L30.3 21.5L18.6 18.6L18.3 24.6L20.9 29.6`+
    `L20.9 30.7L16 28.7L11.1 30.7L11.1 29.6L13.7 24.6L13.4 18.6L1.7 21.5`+
    `L1.7 20.4Q1.7 19.6 2.4 19.3L13.7 14.2L14.3 10.4C14.5 7.6 15.1 4.6 16 2.2Z"/>`+
    `<path d="M14.6 21.4L13.2 27.6L12.4 27.4L13.6 21.3Z"/>`+
    `<path d="M17.4 21.4L18.8 27.6L19.6 27.4L18.4 21.3Z"/>`,
  /* flying wing — shallow chevron with the sawtooth trailing edge (B-2) */
  'flying-wing':()=>`<path d="M16 5.2L30.6 20.4Q31 20.8 30.9 21.4L30.7 22.4`+
    `L22.4 20.4L19.1 23.6L16 21.7L12.9 23.6L9.6 20.4L1.3 22.4L1.1 21.4`+
    `Q1 20.8 1.4 20.4Z"/>`,
  /* helicopter — rotor disc, two-blade rotor, pod fuselage, boom, tail rotor */
  heli:()=>`<circle cx="16" cy="13.4" r="9.3" fill="none" stroke-width="0.5" opacity=".22"/>`+
    `<path d="M15.3 13.4 6.6 12.9 6.6 13.9 15.3 14.4Z"/>`+
    `<path d="M16.7 13.4 25.4 12.9 25.4 13.9 16.7 14.4Z"/>`+
    `<path d="M16 12.7 15.5 4.2 16.5 4.2Z" opacity=".55"/>`+
    `<path d="M16 14.1 15.5 22.6 16.5 22.6Z" opacity=".55"/>`+
    `<path d="M16 9.4Q18.7 9.4 18.7 14.2Q18.7 19.2 16 19.2Q13.3 19.2 13.3 14.2Q13.3 9.4 16 9.4Z"/>`+
    `<path d="M15.28 18.4 16.72 18.4 16.42 26.2 15.58 26.2Z"/>`+
    `<path d="M13.1 25.4 18.9 25.4 18.9 26.4 13.1 26.4Z"/>`+
    `<circle cx="16" cy="26.9" r="1.5" fill="none" stroke-width="0.45" opacity=".38"/>`,
  /* tandem-rotor helicopter — overlapping discs fore and aft (Chinook) */
  'heli-tandem':()=>`<circle cx="16" cy="9.1" r="7.5" fill="none" stroke-width="0.5" opacity=".2"/>`+
    `<circle cx="16" cy="22.3" r="7.5" fill="none" stroke-width="0.5" opacity=".2"/>`+
    `<path d="M16 5.6Q18.9 5.6 18.9 11.5L18.9 21.4Q18.9 26.4 16 26.4Q13.1 26.4 13.1 21.4L13.1 11.5Q13.1 5.6 16 5.6Z"/>`+
    `<path d="M8.6 8.6 23.4 8.6 23.4 9.6 8.6 9.6Z"/>`+
    `<path d="M8.6 21.8 23.4 21.8 23.4 22.8 8.6 22.8Z"/>`,
  /* ground vehicle — top-down body with glazing bands */
  vehicle:()=>`<path d="M16 8.2Q20.7 8.2 20.7 12.4L20.7 19.6Q20.7 23.8 16 23.8Q11.3 23.8 11.3 19.6L11.3 12.4Q11.3 8.2 16 8.2Z"/>`+
    `<path d="M12.9 10.2 19.1 10.2 19.1 12.9 12.9 12.9Z" fill="#0b1220" opacity=".5" stroke="none"/>`+
    `<path d="M12.7 13.7 19.3 13.7 19.3 18.6 12.7 18.6Z" fill="#0b1220" opacity=".3" stroke="none"/>`+
    `<path d="M12.9 19.5 19.1 19.5 19.1 21.9 12.9 21.9Z" fill="#0b1220" opacity=".46" stroke="none"/>`,
  'vehicle-emg':()=>`<path d="M16 8.2Q20.7 8.2 20.7 12.4L20.7 19.6Q20.7 23.8 16 23.8Q11.3 23.8 11.3 19.6L11.3 12.4Q11.3 8.2 16 8.2Z"/>`+
    `<path d="M12.7 14.1 19.3 14.1 19.3 19.0 12.7 19.0Z" fill="#0b1220" opacity=".3" stroke="none"/>`+
    `<path d="M12.9 19.9 19.1 19.9 19.1 22.2 12.9 22.2Z" fill="#0b1220" opacity=".46" stroke="none"/>`+
    `<rect x="12.3" y="9.9" width="7.4" height="2.5" rx="1.2" fill="#ffffff" opacity=".92" stroke="none"/>`,
};

/* Vertical extents of the authored geometry, used to centre each silhouette on
   (16,16) before rotation. Held as a table rather than measured at runtime so
   the icon factory stays allocation-free on the hot path. */
const EXTENT={
  wide4:[2.6,29.2], wide2:[2.8,29.0], tri:[3.0,28.8], narrow:[3.4,28.2],
  regional:[4.2,27.2], bizjet:[4.0,26.8], turboprop:[4.4,27.2], turboprop4:[4.0,28.0],
  'mil-heavy':[3.0,28.8], 'piston-twin':[5.6,26.6], 'piston-single':[5.8,27.0],
  glider:[5.2,26.6], ultralight:[6.3,25.6], def:[4.2,27.6],
  fighter:[2.2,30.7], 'flying-wing':[5.2,23.6], heli:[4.1,28.4], 'heli-tandem':[1.6,29.8],
  vehicle:[8.2,23.8], 'vehicle-emg':[8.2,23.8],
};
function centreOffset(kind){
  const e=EXTENT[kind]||EXTENT.def;
  return 16-(e[0]+e[1])/2;
}

/* Half-width of the drawn geometry (wing semi-span for fixed wing, rotor or
   body half-width otherwise). Paired with EXTENT to work out how much of the
   32x32 box each silhouette actually fills. */
const HALFW={
  wide4:13.6, wide2:13.1, tri:12.1, narrow:10.6, regional:9.0, bizjet:7.9,
  turboprop:10.1, turboprop4:12.7, 'mil-heavy':12.9, 'piston-twin':9.1,
  'piston-single':8.6, glider:14.3, ultralight:8.1, def:9.6,
  fighter:14.3, 'flying-wing':14.9, heli:9.4, 'heli-tandem':7.5,
  vehicle:4.7, 'vehicle-emg':4.7,
};
/* Uniform scale that grows each silhouette to fill ~95% of the viewBox in its
   dominant dimension. Without this a 30px marker drew a 20px aeroplane, since
   most shapes only spanned 60-75% of the box. Because iconSize() already
   derives the box from real wingspan, filling the box keeps drawn span
   proportional to true span across types. Capped so stubby shapes (vehicles,
   tandem rotors) do not balloon. */
const FIT={};
for(const k of Object.keys(HALFW)){
  const e=EXTENT[k]||EXTENT.def;
  const halfH=(e[1]-e[0])/2;
  FIT[k]=Math.min(1.60,+(15.2/Math.max(HALFW[k],halfH)).toFixed(3));
}
function fitScale(kind){return FIT[kind]||FIT.def||1;}

/* Combined centring + fit transform for a silhouette group. */
function shapeTransform(kind){
  const k=fitScale(kind), dy=centreOffset(kind);
  return`translate(16 16) scale(${k}) translate(-16 ${f(-16+dy)})`;
}

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

/* ── ALTITUDE COLOUR BANDS ───────────────────────────────────────────────────
   Reworked onto the Apple system palette so the map ramp reads as one family
   with the rest of the UI: grey → yellow → green → teal → blue → purple.
   Selection is systemOrange and watchlist is systemPink, both outside the ramp
   so neither can be confused with an altitude band. */
const ALT_BANDS=[
  {max:0,     col:'#98989D',label:'GROUND'},
  {max:3000,  col:'#FFD60A',label:'<3K'},
  {max:12000, col:'#30D158',label:'3\u201312K'},
  {max:25000, col:'#64D2FF',label:'12\u201325K'},
  {max:36000, col:'#0A84FF',label:'25\u201336K'},
  {max:Infinity,col:'#BF5AF2',label:'36K+'},
];
const SEL_COL='#FF9F0A', WATCH_COL='#FF375F';
function altColor(a,gnd){
  if(gnd||a===0)return'#98989D';
  if(a==null)return'#30D158';
  for(const b of ALT_BANDS)if(a<b.max||b.max===Infinity)return b.col;
  return'#BF5AF2';
}
function iconColor(raw){
  const a=pickN(raw?.alt_baro,raw?.altitude,raw?.alt);
  const gnd=raw?.on_ground===true||raw?.gnd===true||String(raw?.alt_baro||'').toLowerCase()==='ground';
  return altColor(a,gnd);
}

/* ── ICON FACTORY (needs Leaflet L) ──────────────────────────────────────────
   Separation from the basemap comes from a stroke drawn beneath the fill via
   paint-order, not from CSS filters. Only the selected aircraft and watchlist
   matches carry a filter, and there are at most a handful of those on screen. */
function makeIcon(item,sel,watch){
  const raw=item.raw||{};
  const kind=classifyAC(raw);
  const t=raw.t||raw.type||'';
  const track=pickN(raw.track,raw.mag_heading,raw.true_heading)||0;
  let color;
  if(sel)color=SEL_COL;
  else if(watch)color=WATCH_COL;
  else if(kind==='vehicle-emg')color='#FF453A';
  else if(kind==='vehicle')color='#98989D';
  else color=iconColor(raw);

  const glow=sel?'filter:drop-shadow(0 0 5px rgba(255,159,10,.9));'
    :watch?'filter:drop-shadow(0 0 5px rgba(255,55,95,.85));':'';
  const sz=iconSize(kind,t);
  const body=(SHAPES[kind]||SHAPES.def)();
  const h=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sz}" height="${sz}" `+
    `style="transform:rotate(${track}deg);display:block;${glow}">`+
    `<g transform="${shapeTransform(kind)}" fill="${color}" stroke="rgba(0,0,0,.55)" `+
    `stroke-width="${f(0.85/fitScale(kind))}" stroke-linejoin="round" paint-order="stroke fill">${body}</g></svg>`;
  return L.divIcon({html:h,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-(sz/2+5)]});
}

/* Standalone silhouette for panel use (watchlist rows, flight strip). No
   Leaflet dependency, inherits currentColor unless a colour is supplied. */
function iconMarkup(item,px,color,track){
  const raw=item.raw||{};
  const kind=classifyAC(raw);
  const body=(SHAPES[kind]||SHAPES.def)();
  const rot=track==null?'':`transform:rotate(${track}deg);`;
  return`<svg viewBox="0 0 32 32" width="${px}" height="${px}" aria-hidden="true" style="display:block;${rot}">`+
    `<g transform="${shapeTransform(kind)}" fill="${color||'currentColor'}">${body}</g></svg>`;
}

function isVehicle(raw){const k=classifyAC(raw||{});return k==='vehicle'||k==='vehicle-emg';}

window.AC={classifyAC,acCategory,CHIPS,SHAPES,ISIZES,SPAN,airframeSpan,iconSize,
  ALT_BANDS,altColor,iconColor,makeIcon,iconMarkup,isVehicle,centreOffset,fitScale,shapeTransform,
  SEL_COL,WATCH_COL};
})();
