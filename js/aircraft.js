/* ============================================================================
   OVERHEAD · Aircraft classification + iconography
   Pure functions exposed on window.AC. No external state.
   ========================================================================== */
(function(){
'use strict';

const pickN=(...vv)=>{for(const v of vv){const n=Number(v);if(!isNaN(n)&&isFinite(n))return n;}return null;};

/* ── TYPE CLASSIFICATION ─────────────────────────────────────────────────── */
function classifyAC(raw){
  const cat=String(raw?.category||'').toUpperCase().trim();
  const t=String(raw?.t||raw?.type||'').toUpperCase().replace(/[-\s]/g,'');

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
    wide:           {label:'HEAVY',      cls:'cat-heavy',      chip:'HEAVY'},
    narrow:         {label:'AIRLINE',    cls:'cat-airline',    chip:'AIRLINE'},
    bizjet:         {label:'BIZJET',     cls:'cat-bizjet',     chip:'BIZJET'},
    regional:       {label:'REGIONAL',   cls:'cat-airline',    chip:'AIRLINE'},
    turboprop:      {label:'TURBOPROP',  cls:'cat-ga',         chip:'GA'},
    'piston-single':{label:'GA SINGLE',  cls:'cat-ga',         chip:'GA'},
    'piston-twin':  {label:'GA TWIN',    cls:'cat-ga',         chip:'GA'},
    heli:           {label:'HELICOPTER', cls:'cat-rotorcraft', chip:'ROTOR'},
    military:       {label:'MILITARY',   cls:'cat-military',   chip:'MILITARY'},
    glider:         {label:'GLIDER',     cls:'cat-unknown',    chip:'OTHER'},
    ultralight:     {label:'ULTRALIGHT', cls:'cat-ga',         chip:'GA'},
    def:            {label:'AIRCRAFT',   cls:'cat-unknown',    chip:'OTHER'},
  };
  return M[kind]||M.def;
}
/* Filter chip keys, in display order */
const CHIPS=['HEAVY','AIRLINE','BIZJET','GA','ROTOR','MILITARY','OTHER'];

/* ── SVG SILHOUETTES (viewBox 0 0 32 32, nose up) ────────────────────────── */
const SHAPES={
  wide:c=>`<ellipse cx="16" cy="15.5" rx="3" ry="13" fill="${c}"/><path fill="${c}" d="M13,9 L1.5,16 L1.5,17.5 L12,16 L12.5,22.5 L10,24 L10,25.5 L16,24.5 L22,25.5 L22,24 L19.5,22.5 L20,16 L30.5,17.5 L30.5,16 L19,9 Z"/><ellipse cx="4.5" cy="16.5" rx="2.1" ry=".95" fill="${c}" opacity=".55"/><ellipse cx="9.5" cy="16.2" rx="1.8" ry=".85" fill="${c}" opacity=".55"/><ellipse cx="22.5" cy="16.2" rx="1.8" ry=".85" fill="${c}" opacity=".55"/><ellipse cx="27.5" cy="16.5" rx="2.1" ry=".95" fill="${c}" opacity=".55"/><path fill="${c}" d="M13.5,25 L11,27.5 L11,29 L16,28 L21,29 L21,27.5 L18.5,25 Z"/>`,
  narrow:c=>`<ellipse cx="16" cy="15.5" rx="2.3" ry="12" fill="${c}"/><path fill="${c}" d="M13.8,10 L3,16 L3,17.5 L13.5,16.5 L14,22.5 L11.5,24 L11.5,25.5 L16,24.5 L20.5,25.5 L20.5,24 L18,22.5 L18.5,16.5 L29,17.5 L29,16 L18.2,10 Z"/><ellipse cx="6.5" cy="16.8" rx="2" ry=".95" fill="${c}" opacity=".6"/><ellipse cx="25.5" cy="16.8" rx="2" ry=".95" fill="${c}" opacity=".6"/><path fill="${c}" d="M13.5,26 L11.5,28 L11.5,29.5 L16,28.5 L20.5,29.5 L20.5,28 L18.5,26 Z"/>`,
  bizjet:c=>`<ellipse cx="16" cy="15.5" rx="1.7" ry="11.5" fill="${c}"/><path fill="${c}" d="M14.5,9.5 L5,15.5 L5,17 L14.5,16 L15,21.5 L13,23 L13,24.5 L16,24 L19,24.5 L19,23 L17,21.5 L17.5,16 L27,17 L27,15.5 L17.5,9.5 Z"/><ellipse cx="13.5" cy="23.5" rx="1.6" ry=".75" fill="${c}" opacity=".7"/><ellipse cx="18.5" cy="23.5" rx="1.6" ry=".75" fill="${c}" opacity=".7"/><path fill="${c}" d="M11.5,25 L9.5,27.5 L9.5,29 L16,27.5 L22.5,29 L22.5,27.5 L20.5,25 Z"/>`,
  regional:c=>`<ellipse cx="16" cy="15.5" rx="2" ry="10.5" fill="${c}"/><path fill="${c}" d="M14,10.5 L3.5,16 L3.5,17.5 L13.8,16.8 L14.2,22 L11.5,23.5 L11.5,25 L16,24.5 L20.5,25 L20.5,23.5 L17.8,22 L18.2,16.8 L28.5,17.5 L28.5,16 L18,10.5 Z"/><ellipse cx="7" cy="17" rx="1.9" ry=".9" fill="${c}" opacity=".6"/><ellipse cx="25" cy="17" rx="1.9" ry=".9" fill="${c}" opacity=".6"/><path fill="${c}" d="M13.5,25 L11.5,27.5 L11.5,29 L16,28 L20.5,29 L20.5,27.5 L18.5,25 Z"/>`,
  turboprop:c=>`<ellipse cx="16" cy="16" rx="2" ry="11.5" fill="${c}"/><path fill="${c}" d="M14,11 L4,15 L4,17 L14,16 L14.5,22.5 L12,24 L12,25.5 L16,25 L20,25.5 L20,24 L17.5,22.5 L18,16 L28,17 L28,15 L18,11 Z"/><ellipse cx="6" cy="16" rx="2.6" ry="1.4" fill="${c}"/><ellipse cx="26" cy="16" rx="2.6" ry="1.4" fill="${c}"/><ellipse cx="6" cy="12.5" rx="4.2" ry="1.1" fill="none" stroke="${c}" stroke-width="1.3" opacity=".6"/><ellipse cx="26" cy="12.5" rx="4.2" ry="1.1" fill="none" stroke="${c}" stroke-width="1.3" opacity=".6"/><path fill="${c}" d="M13.5,25.5 L11.5,27.5 L11.5,29 L16,28 L20.5,29 L20.5,27.5 L18.5,25.5 Z"/>`,
  'piston-single':c=>`<ellipse cx="16" cy="5" rx="4.8" ry="1.2" fill="none" stroke="${c}" stroke-width="1.3" opacity=".75"/><ellipse cx="16" cy="17.5" rx="1.9" ry="11.5" fill="${c}"/><path fill="${c}" d="M14.5,14 L4,16.5 L4,18 L14.5,17 L17.5,17 L28,18 L28,16.5 L17.5,14 Z"/><path fill="${c}" d="M14,26.5 L11.5,28.5 L11.5,30 L16,29 L20.5,30 L20.5,28.5 L18,26.5 Z"/>`,
  'piston-twin':c=>`<ellipse cx="16" cy="17" rx="1.9" ry="11" fill="${c}"/><path fill="${c}" d="M14.5,13 L5,15.5 L5,17.5 L14.5,16.5 L17.5,16.5 L27,17.5 L27,15.5 L17.5,13 Z"/><ellipse cx="7.5" cy="16.5" rx="2.4" ry="1.4" fill="${c}"/><ellipse cx="24.5" cy="16.5" rx="2.4" ry="1.4" fill="${c}"/><ellipse cx="7.5" cy="13" rx="3.5" ry="1.1" fill="none" stroke="${c}" stroke-width="1.2" opacity=".7"/><ellipse cx="24.5" cy="13" rx="3.5" ry="1.1" fill="none" stroke="${c}" stroke-width="1.2" opacity=".7"/><path fill="${c}" d="M14,25.5 L11.5,27.5 L11.5,29 L16,28 L20.5,29 L20.5,27.5 L18,25.5 Z"/>`,
  heli:c=>`<circle cx="16" cy="13.5" r="10.5" fill="none" stroke="${c}" stroke-width=".9" opacity=".28"/><line x1="4" y1="13.5" x2="28" y2="13.5" stroke="${c}" stroke-width="2.3" stroke-linecap="round"/><line x1="16" y1="3" x2="16" y2="24" stroke="${c}" stroke-width="2.3" stroke-linecap="round" opacity=".6"/><circle cx="16" cy="13.5" r="1.5" fill="${c}"/><ellipse cx="16" cy="18.5" rx="3.5" ry="5.5" fill="${c}"/><rect x="15.2" y="23.5" width="1.6" height="5" rx=".8" fill="${c}" opacity=".8"/><line x1="12" y1="28" x2="20" y2="28" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>`,
  military:c=>`<path fill="${c}" d="M16,2 L19.5,12 L30,18 L26,21.5 L20,19 L19.5,29.5 L16,31 L12.5,29.5 L12,19 L6,21.5 L2,18 L12.5,12 Z"/>`,
  glider:c=>`<ellipse cx="16" cy="16.5" rx="1.2" ry="9.5" fill="${c}"/><path fill="${c}" d="M14.8,14 L1,16.5 L1,17.5 L14.8,16.5 L17.2,16.5 L31,17.5 L31,16.5 L17.2,14 Z"/><path fill="${c}" d="M14.5,23 L13,25.5 L15,26.5 L17,26.5 L19,25.5 L17.5,23 Z"/>`,
  ultralight:c=>`<ellipse cx="16" cy="5.5" rx="3.5" ry=".95" fill="none" stroke="${c}" stroke-width="1.1" opacity=".7"/><ellipse cx="16" cy="17" rx="1.4" ry="10" fill="${c}"/><path fill="${c}" d="M14.5,14.5 L5.5,16.5 L5.5,17.5 L14.5,16.5 L17.5,16.5 L26.5,17.5 L26.5,16.5 L17.5,14.5 Z"/><path fill="${c}" d="M14.5,24.5 L12.5,26.5 L12.5,27.5 L16,26.5 L19.5,27.5 L19.5,26.5 L17.5,24.5 Z"/>`,
  def:c=>`<ellipse cx="16" cy="15.5" rx="2.2" ry="12" fill="${c}"/><path fill="${c}" d="M13.8,10 L3,16 L3,17.5 L13.5,16.5 L14,22.5 L11.5,24 L11.5,25.5 L16,24.5 L20.5,25.5 L20.5,24 L18,22.5 L18.5,16.5 L29,17.5 L29,16 L18.2,10 Z"/><path fill="${c}" d="M13.5,26 L11.5,28 L11.5,29.5 L16,28.5 L20.5,29.5 L20.5,28 L18.5,26 Z"/>`,
};

const ISIZES={wide:40,narrow:34,bizjet:26,regional:28,turboprop:26,'piston-single':20,'piston-twin':22,heli:28,military:26,glider:34,ultralight:19,def:32};

/* ── ALTITUDE COLOUR BANDS ───────────────────────────────────────────────── */
const ALT_BANDS=[
  {max:0,     col:'#6b7280',label:'GROUND'},
  {max:3000,  col:'#e8a020',label:'<3K'},
  {max:12000, col:'#fbbf24',label:'3\u201312K'},
  {max:25000, col:'#1ec878',label:'12\u201325K'},
  {max:36000, col:'#22b4f0',label:'25\u201336K'},
  {max:Infinity,col:'#a78bfa',label:'36K+'},
];
function altColor(a,gnd){
  if(gnd||a===0)return'#6b7280';
  if(a==null)return'#1ec878';
  for(const b of ALT_BANDS)if(a<b.max||b.max===Infinity)return b.col;
  return'#a78bfa';
}
function iconColor(raw){
  const a=pickN(raw?.alt_baro,raw?.altitude,raw?.alt);
  const gnd=raw?.on_ground===true||raw?.gnd===true||String(raw?.alt_baro||'').toLowerCase()==='ground';
  return altColor(a,gnd);
}

/* ── ICON FACTORY (needs Leaflet L) ──────────────────────────────────────── */
function makeIcon(item,sel){
  const kind=classifyAC(item.raw||{});
  const track=pickN(item.raw?.track,item.raw?.mag_heading,item.raw?.true_heading)||0;
  const color=sel?'#e8a020':iconColor(item.raw||{});
  const glow=sel?'filter:drop-shadow(0 0 6px rgba(232,160,32,.95))':'';
  const sz=ISIZES[kind]||30;
  const body=(SHAPES[kind]||SHAPES.def)(color);
  const h=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sz}" height="${sz}" style="transform:rotate(${track}deg);display:block;${glow}">${body}</svg>`;
  return L.divIcon({html:h,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],popupAnchor:[0,-(sz/2+5)]});
}

window.AC={classifyAC,acCategory,CHIPS,SHAPES,ISIZES,ALT_BANDS,altColor,iconColor,makeIcon};
})();
