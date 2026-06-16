/* ============================================================================
   OVERHEAD · main application
   Depends on: Leaflet (global L), window.AC (aircraft.js), window.AIRPORTS.
   ========================================================================== */
(function(){
'use strict';
const AC=window.AC, AIRPORTS=window.AIRPORTS||[];

/* ── CONFIG ──────────────────────────────────────────────────────────────── */
const API='https://api.airplanes.live';
const DB='https://api.adsbdb.com/v0';
const WX_API='https://api.rainviewer.com/public/weather-maps.json';
const OPENAIP_TILES='https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png'; // worldwide aero chart (airspace/airways/navaids); needs free apiKey
const KEY_STORE='overhead.openaip.key';
const METAR_API='https://metar.vatsim.net';  // raw METAR, CORS-enabled (ACAO *), no key
const USER_RANGE=150;        // NM, initial nearby query radius
const REFRESH_MS=8000;       // live poll interval (nominal, healthy)
const PAN_DEBOUNCE=900;
const MAX_HIST=30;           // trail points kept per aircraft
const MIN_REFETCH_NM=40;     // pan distance before refetching view
const STORE='overhead.settings.v2';
/* ── resilient data layer tunables ───────────────────────────────────────── */
const FETCH_TIMEOUT=12000;   // ms before a hung request aborts
const POLL_MAX=120000;       // ms, backoff ceiling
const STALE_MS=24000;        // no good poll for this long => STALE (~3 cycles)
const OFFLINE_MS=90000;      // => OFFLINE
const RATE_FLOOR_MS=30000;   // min wait after an HTTP 429
const METAR_TTL=300000;      // 5 min cache per field
const MAX_ENRICH=2;          // adsbdb route look-ups started per poll (divert detect)

/* ── STATE ───────────────────────────────────────────────────────────────── */
const S={
  map:null,user:null,
  basePane:null,baseLayer:null,
  ringLayer:null,trailLayer:null,airportLayer:null,procLayer:null,planeLayer:null,userLayer:null,approachLayer:null,aeroLayer:null,
  nearby:[],nearbyFiltered:[],
  allAC:new Map(),histories:new Map(),
  selectedKey:null,selectedInfo:null,
  didInitialFit:false,refreshTimer:null,panTimer:null,countTimer:null,
  panLat:null,panLon:null,lastUpdate:0,
  base:'dark',                // dark|light|sat|terrain
  theme:'auto',               // auto|dark|light
  units:'imperial',           // imperial|metric
  follow:false,
  openaipKey:'388e7444c5966dcb282adac4bef1a843',aeroOpacity:0.9,
  overlays:{trails:true,rings:true,airports:true,labels:false,weather:false,aero:false,proc:false},
  wx:{frames:[],host:'',idx:0,layers:{},playing:false,timer:null,opacity:0.6},
  metar:new Map(),            // ICAO -> {ts,raw,parsed,ok,pending?}
  disruptLayer:null,disruptions:[],aptIndex:null,
};
/* network health for the resilient poll loop */
const NET={fails:0,lastOk:0,nextAt:0,backoffUntil:0,rateLimited:false,polling:false};
/* bumped on every data merge to invalidate the per-poll flight-phase cache */
let PHASE_EPOCH=0;

/* ── FILTERS ─────────────────────────────────────────────────────────────── */
const F={q:'',cats:new Set(AC.CHIPS),altMin:0,altMax:45000,
  airborneOnly:false,militaryOnly:false,emergencyOnly:false};

/* ── UTILS ───────────────────────────────────────────────────────────────── */
const el=id=>document.getElementById(id);
const norm=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'');
const keyFor=ac=>norm(ac.reg||ac.r||ac.callsign||ac.flight||ac.hex||'');
const pickN=(...vv)=>{for(const v of vv){const n=Number(v);if(!isNaN(n)&&isFinite(n))return n;}return null;};
const R2D=Math.PI/180,D2R=180/Math.PI;
function hav(la1,lo1,la2,lo2){
  const d=(la2-la1)*R2D,e=(lo2-lo1)*R2D;
  return 2*6371*Math.asin(Math.sqrt(Math.sin(d/2)**2+Math.cos(la1*R2D)*Math.cos(la2*R2D)*Math.sin(e/2)**2));
}
const nmBtw=(a,b)=>hav(a[0],a[1],b[0],b[1])/1.852;
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function bearing(la1,lo1,la2,lo2){
  const y=Math.sin((lo2-lo1)*R2D)*Math.cos(la2*R2D);
  const x=Math.cos(la1*R2D)*Math.sin(la2*R2D)-Math.sin(la1*R2D)*Math.cos(la2*R2D)*Math.cos((lo2-lo1)*R2D);
  return (Math.atan2(y,x)*D2R+360)%360;
}
const compass=deg=>DIRS[Math.round(((deg%360)+360)%360/22.5)%16];
function destPoint(lat,lon,brgDeg,distNm){      // project a point along a bearing (NM)
  const Rk=6371,d=(distNm*1.852)/Rk,b=brgDeg*R2D,la1=lat*R2D,lo1=lon*R2D;
  const la2=Math.asin(Math.sin(la1)*Math.cos(d)+Math.cos(la1)*Math.sin(d)*Math.cos(b));
  const lo2=lo1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(la1),Math.cos(d)-Math.sin(la1)*Math.sin(la2));
  return [la2*D2R,(((lo2*D2R)+540)%360)-180];
}

/* ── FORMATTERS (unit aware) ─────────────────────────────────────────────── */
/* units: imperial (ft/kt/NM) · metric (m/km·h/km) · hybrid (ft/kt/km) */
const M=()=>S.units==='metric';                                  // alt / speed / climb
const Mdist=()=>S.units==='metric'||S.units==='hybrid';          // distance only
const altRaw=ac=>ac?.alt_baro??ac?.altitude??ac?.alt;
function fmtAlt(ac){
  const v=altRaw(ac);
  if(v==null||v==='')return'\u2014';
  if(String(v).toLowerCase()==='ground')return'GND';
  const n=Number(v);if(isNaN(n))return String(v);
  return M()?`${Math.round(n*0.3048).toLocaleString()} m`:`${n.toLocaleString()} ft`;
}
function fmtSpd(ac){
  const v=pickN(ac?.gs,ac?.speed,ac?.ground_speed);if(v==null)return'\u2014';
  return M()?`${Math.round(v*1.852)} km/h`:`${Math.round(v)} kt`;
}
function fmtDist(nm){
  if(nm==null||!isFinite(nm))return'\u2014';
  return Mdist()?`${(nm*1.852).toFixed(1)}\u202fkm`:`${nm.toFixed(1)}\u202fNM`;
}
const fmtCoords=(la,lo)=>la==null||lo==null?'\u2014':`${la.toFixed(4)}, ${lo.toFixed(4)}`;
function fmtAgo(v){
  if(v==null||v==='')return'\u2014';const n=Number(v);if(isNaN(n))return String(v);
  if(n<60)return`${Math.round(n)}s ago`;if(n<3600)return`${Math.round(n/60)}m ago`;return`${Math.round(n/3600)}h ago`;
}
function fmtTrack(ac){
  const t=pickN(ac?.track,ac?.mag_heading,ac?.true_heading);if(t==null)return'\u2014';
  const d=((t%360)+360)%360;return`${Math.round(d)}\u00b0 ${compass(d)}`;
}
function fmtClimb(ac){
  const r=pickN(ac?.baro_rate,ac?.geom_rate,ac?.vertical_rate);
  if(r==null)return'\u2014';if(Math.abs(r)<64)return'LVL';
  const up=r>0;const arr=up?'\u2191':'\u2193';
  return M()?`${arr} ${Math.abs(r*0.00508).toFixed(1)} m/s`:`${arr} ${Math.abs(Math.round(r)).toLocaleString()} fpm`;
}
function isAirborne(ac){
  if(!ac)return false;
  if(ac.on_ground===true||ac.gnd===true)return false;
  if(String(ac.alt_baro||'').toLowerCase()==='ground')return false;
  const a=pickN(ac.alt_baro,ac.altitude,ac.alt);return a!=null&&a>0;
}
function altNumeric(ac){
  const v=altRaw(ac);
  if(v==null||v==='')return null;
  if(String(v).toLowerCase()==='ground')return 0;
  const n=Number(v);return isNaN(n)?null:n;
}

/* ── SQUAWK DECODER ──────────────────────────────────────────────────────── */
const SQ={7500:'\u26a0 HIJACK',7600:'RADIO FAIL',7700:'\u26a0 EMERGENCY',7777:'MIL INTERCEPT',1200:'VFR',2000:'IFR'};
function sqInfo(raw){
  const s=String(raw||'').trim();if(!s||s==='0000')return null;
  const code=parseInt(s);
  return{code:s,label:SQ[code]||null,alert:s==='7500'||s==='7700'||s==='7600'};
}
const isEmergency=raw=>{const s=String(raw?.squawk||'');return s==='7500'||s==='7600'||s==='7700';};

/* ── AIRPORT-RELATIVE FLIGHT PHASE / APPROACH ────────────────────────────── */
function nearestAirport(lat,lon){
  let best=null,bestKm=Infinity;
  const dlonMax=2/Math.max(0.2,Math.cos(lat*R2D));   // ~2° lat window, widened by longitude
  for(const a of AIRPORTS){
    if(Math.abs(a.lat-lat)>2||Math.abs(a.lon-lon)>dlonMax)continue;  // cheap reject before haversine
    const km=hav(lat,lon,a.lat,a.lon);
    if(km<bestKm){bestKm=km;best=a;}
  }
  return best?{apt:best,distNm:bestKm/1.852}:null;
}
/* Resolve an airport record from an ICAO or IATA code (lazy index, rebuilt if
   the airport dataset grows after async load). */
function aptByCode(code){
  if(!code)return null;
  const c=String(code).trim().toUpperCase();
  if(!c)return null;
  if(!S.aptIndex||S.aptIndex._n!==AIRPORTS.length){
    const idx=new Map();idx._n=AIRPORTS.length;
    for(const a of AIRPORTS){if(a.ic)idx.set(a.ic,a);if(a.ia&&!idx.has(a.ia))idx.set(a.ia,a);}
    S.aptIndex=idx;
  }
  return S.aptIndex.get(c)||null;
}
const angDiff=(a,b)=>{let d=Math.abs((((a-b)%360)+360)%360);return d>180?360-d:d;};
function rwyFromTrack(t){               // fallback: runway number from ground track
  if(t==null)return null;
  let n=Math.round((((t%360)+360)%360)/10);
  if(n===0)n=36;
  return String(n).padStart(2,'0');
}
function rwyForApt(apt,trk){            // prefer the real runway end aligned with track
  if(trk==null)return null;
  const rwys=apt&&window.RWY&&window.RWY[apt.ic];
  if(rwys&&rwys.length){
    let best=null,bd=999;
    for(const rw of rwys)for(const e of[rw.le,rw.he]){const d=angDiff(trk,e[3]);if(d<bd){bd=d;best=e[0];}}
    if(best!=null&&bd<60)return best;
  }
  return rwyFromTrack(trk);
}
/* Vertical speed, smoothed: trust the ADS-B baro/geom rate when present, else
   derive a trend from the altitude trail so a single bad sample can't flip the
   phase. Returns fpm or null. */
function smoothVs(item,rawVs){
  if(rawVs!=null)return rawVs;
  const pts=S.histories.get(item.key);
  if(pts&&pts.length>=2){
    const a=pts[pts.length-1],b=pts[Math.max(0,pts.length-4)];
    const dtMin=(a.ts-b.ts)/60000;
    if(dtMin>0.05&&a.alt!=null&&b.alt!=null)return(a.alt-b.alt)/dtMin;
  }
  return null;
}
/* Raw phase from the current sample. Approach/departure gates now use height
   ABOVE FIELD (alt − field elevation) instead of MSL, which fixes mis-calls at
   high-elevation airports. Returns {phase,label,cls,apt,distNm,runway,fromDir,vs,toward}.
   cls ∈ app|dep|gnd|des|crz|enr drives badge colour. */
function computePhase(item){
  const raw=item.raw||{};
  const lat=pickN(raw.lat,raw.latitude,item.lat),lon=pickN(raw.lon,raw.longitude,item.lon);
  const alt=altNumeric(raw);
  const vs=smoothVs(item,pickN(raw.baro_rate,raw.geom_rate,raw.vertical_rate));
  const trk=pickN(raw.track,raw.mag_heading,raw.true_heading);
  const gnd=raw.on_ground===true||raw.gnd===true||String(raw.alt_baro||'').toLowerCase()==='ground'||alt===0;
  const na=(lat!=null&&lon!=null)?nearestAirport(lat,lon):null;
  const out={phase:'\u2014',label:'',cls:'enr',apt:na?.apt||null,distNm:na?.distNm??null,runway:null,fromDir:null,vs,toward:false};
  if(AC.isVehicle(raw)){out.phase='SURFACE';out.cls='gnd';out.label=na&&na.distNm<4?`At ${na.apt.ia}`:'';return out;}
  if(!na){out.phase=(alt!=null&&alt>20000)?'CRUISE':'EN ROUTE';out.cls=alt!=null&&alt>20000?'crz':'enr';return out;}
  const d=na.distNm;
  const fieldEl=na.apt.el!=null?na.apt.el:0;
  const agl=alt!=null?Math.max(0,alt-fieldEl):null;        // height above the field, ft
  const brgAptToAc=bearing(na.apt.lat,na.apt.lon,lat,lon);  // where the aircraft sits, from field
  const brgAcToApt=bearing(lat,lon,na.apt.lat,na.apt.lon);  // heading that points at the field
  const toward=trk!=null&&angDiff(trk,brgAcToApt)<50;
  const away  =trk!=null&&angDiff(trk,brgAcToApt)>130;
  out.fromDir=compass(brgAptToAc);out.toward=toward;
  const CLIMB=300,SINK=-250;                                // vertical-speed deadband, fpm
  if(gnd){out.phase='ON GROUND';out.cls='gnd';out.label=d<4?na.apt.ia:'';return out;}
  if(vs!=null&&vs>CLIMB&&agl!=null&&agl<13000&&d<35&&away){
    out.phase='DEPARTURE';out.cls='dep';out.label=`climb-out · ${na.apt.ia}`;out.runway=rwyForApt(na.apt,trk);return out;
  }
  if(vs!=null&&vs<SINK&&d<40&&agl!=null&&agl<13000&&toward){
    if(agl<2500&&d<8)out.phase='FINAL APPROACH';
    else if(agl<6000&&d<18)out.phase='APPROACH';
    else out.phase='ARRIVAL';
    out.cls='app';out.label=na.apt.ia;out.runway=rwyForApt(na.apt,trk);return out;
  }
  if(vs!=null&&vs<-300&&alt!=null&&alt>12000){out.phase='DESCENT';out.cls='des';return out;}
  if(vs!=null&&vs>CLIMB&&alt!=null&&alt<18000){out.phase='CLIMB';out.cls='dep';return out;}
  if(alt!=null&&alt>=20000){out.phase='CRUISE';out.cls='crz';return out;}
  if(d<25){out.phase='OVERFLIGHT';out.cls='enr';out.label=`near ${na.apt.ia}`;return out;}
  out.phase='EN ROUTE';out.cls='enr';return out;
}
/* Memoized + damped phase. The result is cached per poll (PHASE_EPOCH bumps on
   every data merge) so the O(airports) nearest-airport scan runs once per
   aircraft per frame instead of once per consumer. Transitions into or out of
   the approach/departure classes must persist PHASE_DWELL polls before they are
   accepted, which stops boundary flicker from strobing the badge and the
   diversion flag. Phase carry-over lives on the item (see mergeAircraft). */
const PHASE_DWELL=2;
function flightPhase(item){
  if(item._phStamp===PHASE_EPOCH&&item._ph)return item._ph;
  const raw=computePhase(item);
  const prev=item._ph;
  let acc=raw;
  if(prev){
    const guarded=(raw.cls==='app'||raw.cls==='dep'||prev.cls==='app'||prev.cls==='dep');
    if(raw.cls!==prev.cls&&guarded){
      if(item._phCand===raw.phase)item._phCandN=(item._phCandN||0)+1;
      else{item._phCand=raw.phase;item._phCandN=1;}
      if(item._phCandN<PHASE_DWELL)acc=Object.assign({},prev,{vs:raw.vs,distNm:raw.distNm!=null?raw.distNm:prev.distNm});
      else{acc=raw;item._phCand=null;item._phCandN=0;}
    }else{acc=raw;item._phCand=null;item._phCandN=0;}
  }
  item._ph=acc;item._phStamp=PHASE_EPOCH;
  return acc;
}
function phaseHtml(item){
  const p=flightPhase(item);
  const bits=[];
  if(p.apt&&(p.cls==='app'||p.cls==='dep'||(p.label&&p.cls==='gnd')))
    bits.push(p.cls==='dep'?`out of ${p.apt.ia}`:p.cls==='gnd'?(p.label?`${p.label}`:''):`${p.apt.ia}`);
  if(p.runway)bits.push(`RWY&nbsp;${p.runway}`);
  if(p.cls==='app'&&p.fromDir)bits.push(`from ${p.fromDir}`);
  const sub=bits.filter(Boolean).join(' &middot; ');
  return`<span class="phase ph-${p.cls}">${p.phase}</span>${sub?`<span class="phase-sub">${sub}</span>`:''}`;
}
/* Aircraft currently working a given airport (inbound / departing / on field) */
function airportTraffic(a){
  const inbound=[],departing=[],ground=[];
  for(const it of S.allAC.values()){
    if(it.lat==null)continue;
    const p=flightPhase(it);
    if(p.apt!==a)continue;
    if(p.cls==='app')inbound.push({it,p});
    else if(p.cls==='dep')departing.push({it,p});
    else if(p.cls==='gnd'&&p.label)ground.push({it,p});
  }
  inbound.sort((x,y)=>(x.p.distNm)-(y.p.distNm));
  departing.sort((x,y)=>(x.p.distNm)-(y.p.distNm));
  return{inbound,departing,ground};
}

/* ── FILTER PREDICATE ────────────────────────────────────────────────────── */
function passesFilter(item){
  const raw=item.raw||{};
  const kind=AC.classifyAC(raw);
  const chip=AC.acCategory(kind).chip;
  if(!F.cats.has(chip))return false;
  if(F.militaryOnly&&chip!=='MILITARY')return false;
  if(F.emergencyOnly&&!isEmergency(raw))return false;
  if(F.airborneOnly&&!isAirborne(raw))return false;
  const a=altNumeric(raw);
  if(a!=null&&(a<F.altMin||a>F.altMax))return false;
  if(F.q){
    const q=F.q.toUpperCase();
    const hay=`${item.reg||''} ${item.hex||''} ${item.callsign||''} ${norm(raw.flight)}`;
    if(!hay.includes(q))return false;
  }
  return true;
}

/* ── STATUS ──────────────────────────────────────────────────────────────── */
function setStatus(txt,tone='live'){
  el('sText').textContent=txt.toUpperCase();
  el('sDot').className='sd'+(tone==='warn'?' warn':tone==='bad'?' bad':'');
  el('sPill').style.color=tone==='live'?'var(--G)':tone==='warn'?'var(--A)':'var(--R)';
}
function tickCountdown(){
  const now=Date.now();
  const age=NET.lastOk?Math.round((now-NET.lastOk)/1000):null;
  setTxt('stAge',age==null?'\u2014':age+'s');
  const ae=el('stAge');if(ae)ae.style.color=(NET.lastOk&&(now-NET.lastOk)>STALE_MS)?'var(--R)':'';
  if(S.user){
    const left=Math.max(0,Math.round((NET.nextAt-now)/1000));
    el('updPill').textContent=(NET.fails>0?'RETRY ':'SYNC ')+left+'s';
  }
  updateNetUI();
}
/* Single authority for steady-state connection status across pill, map badge. */
function updateNetUI(){
  if(!NET.lastOk&&!NET.fails)return;             // still locating / first poll in flight
  const now=Date.now(),age=NET.lastOk?now-NET.lastOk:Infinity;
  let tone,txt,stale=false;
  if(NET.rateLimited){tone='bad';txt='RATE LIMITED';stale=true;}
  else if(age>OFFLINE_MS){tone='bad';txt='OFFLINE';stale=true;}
  else if(NET.fails>0){tone='warn';txt='RECONNECTING';stale=true;}
  else if(age>STALE_MS){tone='warn';txt='STALE DATA';stale=true;}
  else{const n=S.nearbyFiltered.length;tone=n?'live':'warn';txt=n?`${n} NEARBY`:'NO TRAFFIC NEARBY';}
  setStatus(txt,tone);
  const acft=`${S.allAC.size} ACFT`;
  setTxt('trafficCount',stale?`${txt} \u00b7 ${acft}`:acft);
  const bd=document.querySelector('.map-badge .sd');
  if(bd)bd.className='sd'+(tone==='bad'?' bad':tone==='warn'?' warn':'');
}

/* ── BASE MAP TILES ──────────────────────────────────────────────────────── */
const BASES={
  dark:{url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',sub:'abcd',max:19},
  light:{url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',sub:'abcd',max:19},
  sat:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',sub:'',max:19},
  terrain:{url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',sub:'abc',max:17},
};
function setBase(name){
  if(!BASES[name]||!S.map)return;
  S.base=name;
  if(S.baseLayer)S.map.removeLayer(S.baseLayer);
  const b=BASES[name];
  S.baseLayer=L.tileLayer(b.url,{maxZoom:19,maxNativeZoom:b.max,subdomains:b.sub,pane:'basePane'}).addTo(S.map);
  document.querySelectorAll('[data-base]').forEach(x=>x.classList.toggle('on',x.dataset.base===name));
  saveSettings();
}

/* ── AERO CHART (OpenAIP · key-optional) ─────────────────────────────────── */
function ensureAeroLayer(){
  if(S.aeroLayer||!S.openaipKey||!S.map)return S.aeroLayer;
  S.aeroLayer=L.tileLayer(OPENAIP_TILES+'?apiKey='+encodeURIComponent(S.openaipKey),
    {minZoom:4,maxNativeZoom:14,maxZoom:19,opacity:S.aeroOpacity,pane:'aeroPane',crossOrigin:true,
     attribution:'\u00a9 openAIP'});
  return S.aeroLayer;
}
function toggleAero(on){
  if(on){
    if(!S.openaipKey){                       // no key yet — reveal the prompt, stay off
      S.overlays.aero=false;
      if(el('aeroKeyWrap'))el('aeroKeyWrap').style.display='block';
      if(el('aeroOpRow'))el('aeroOpRow').style.display='none';
      syncOverlayButtons();return;
    }
    S.overlays.aero=true;
    if(el('aeroKeyWrap'))el('aeroKeyWrap').style.display='none';
    if(el('aeroOpRow'))el('aeroOpRow').style.display='flex';
    const lyr=ensureAeroLayer();
    if(lyr&&!S.map.hasLayer(lyr))lyr.addTo(S.map);
  }else{
    S.overlays.aero=false;
    if(el('aeroOpRow'))el('aeroOpRow').style.display='none';
    if(S.aeroLayer&&S.map.hasLayer(S.aeroLayer))S.map.removeLayer(S.aeroLayer);
  }
  saveSettings();
}
function applyAeroKey(k){
  k=String(k||'').trim();if(!k)return;
  S.openaipKey=k;
  try{localStorage.setItem(KEY_STORE,k);}catch(_){}
  if(S.aeroLayer){if(S.map.hasLayer(S.aeroLayer))S.map.removeLayer(S.aeroLayer);S.aeroLayer=null;}
  toggleAero(true);syncOverlayButtons();
}

/* ── MAP STATUS BAR ──────────────────────────────────────────────────────── */
function setTxt(id,v){const e=el(id);if(e)e.textContent=v;}
function updateMapStatus(){
  if(!S.map)return;
  const c=S.map.getCenter();
  setTxt('stCoord',`${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`);
  setTxt('stZoom','Z'+S.map.getZoom());
  setTxt('stCount',S.allAC.size+' ACFT');
}

/* ── MAP SETUP ───────────────────────────────────────────────────────────── */
function ensureMap(){
  if(S.map)return;
  S.map=L.map('map',{zoomControl:false,attributionControl:false}).setView([-37.0,174.8],7);
  L.control.zoom({position:'bottomright'}).addTo(S.map);
  S.basePane=S.map.createPane('basePane');S.basePane.style.zIndex=100;
  S.map.createPane('aeroPane');S.map.getPane('aeroPane').style.zIndex=150;
  S.ringLayer=L.layerGroup().addTo(S.map);
  S.approachLayer=L.layerGroup().addTo(S.map);
  S.trailLayer=L.layerGroup().addTo(S.map);
  S.airportLayer=L.layerGroup().addTo(S.map);
  S.procLayer=L.layerGroup().addTo(S.map);
  S.planeLayer=L.layerGroup().addTo(S.map);
  S.disruptLayer=L.layerGroup().addTo(S.map);
  S.userLayer=L.layerGroup().addTo(S.map);
  setBase(S.base);
  S.map.on('popupopen',onPopupOpen);
  S.map.on('moveend',()=>{
    clearTimeout(S.panTimer);
    updateMapStatus();
    if(S.overlays.proc)renderProcedures();
    S.panTimer=setTimeout(()=>{fetchForView();if(S.overlays.airports)renderAirports();},PAN_DEBOUNCE);
  });
  S.map.on('move',updateMapStatus);
  L.control.attribution({prefix:false,position:'bottomright'})
    .addAttribution('© OpenStreetMap, CARTO, Esri · airplanes.live · adsbdb · RainViewer · OurAirports · METAR via VATSIM').addTo(S.map);
}

/* ── RANGE RINGS ─────────────────────────────────────────────────────────── */
function drawRings(){
  S.ringLayer.clearLayers();
  if(!S.overlays.rings||!S.user)return;
  [50,100,150].forEach(nm=>{
    L.circle([S.user.lat,S.user.lon],{radius:nm*1852,color:'var(--C)',opacity:.22,fill:false,weight:1,dashArray:'3 7'}).addTo(S.ringLayer);
    L.marker([S.user.lat+(nm*1852)/111320,S.user.lon],{
      icon:L.divIcon({className:'ring-lbl',html:`${Mdist()?Math.round(nm*1.852)+'km':nm+'NM'}`,iconSize:[44,14],iconAnchor:[22,7]}),
      interactive:false}).addTo(S.ringLayer);
  });
}

/* ── AIRPORTS OVERLAY ────────────────────────────────────────────────────── */
function airportPopup(a){
  const{inbound,departing,ground}=airportTraffic(a);
  const line=({it,p})=>{
    const reg=it.reg||it.hex||'Aircraft';
    const cs=norm(it.raw?.flight||it.callsign);
    const extra=p.runway?` RWY ${p.runway}`:'';
    const from=p.cls==='app'&&p.fromDir?` · from ${p.fromDir}`:'';
    return`<button class="apt-ac" onclick="window.__sel('${it.key}')"><span>${reg}${cs?' · '+cs:''}</span><span class="apt-ac-r">${p.phase}${extra}${from} · ${fmtDist(p.distNm)}</span></button>`;
  };
  let h=`<div class="pp-reg" style="color:var(--C)">${a.ia?a.ia+' &middot; ':''}${a.ic}</div>
    <div class="pp-row"><b>${a.n}</b>${a.c?'<br>'+a.c:''}${a.el!=null?` &middot; elev ${Mdist()?Math.round(a.el*0.3048)+' m':a.el.toLocaleString()+' ft'}`:''}</div>
    <div class="apt-stats">
      <span class="apt-stat"><b>${inbound.length}</b> inbound</span>
      <span class="apt-stat"><b>${departing.length}</b> departing</span>
      <span class="apt-stat"><b>${ground.length}</b> on field</span>
    </div>`;
  // live weather (METAR) — lazy, cache-aware
  if(/^[A-Z0-9]{4}$/.test(String(a.ic||''))){
    const c=S.metar.get(a.ic);
    const ready=c&&c.ok!=null&&!c.pending;
    h+=`<div class="apt-h">WEATHER</div><div class="apt-wx" data-icao="${a.ic}"${ready?' data-loaded="1"':''}>${ready?metarHtml(c):'<span class="wx-load">loading METAR\u2026</span>'}</div>`;
  }
  // runways
  const rwys=window.RWY&&window.RWY[a.ic];
  if(rwys&&rwys.length){
    const rl=rwys.slice(0,5).map(rw=>{
      const len=rw.len?(Mdist()?`${Math.round(rw.len*0.3048).toLocaleString()} m`:`${rw.len.toLocaleString()} ft`):'';
      return `<div class="apt-rwy"><span>RWY ${rw.le[0]}/${rw.he[0]}</span><span class="apt-ac-r">${[len,rw.sf].filter(Boolean).join(' · ')}</span></div>`;
    }).join('');
    h+=`<div class="apt-h">RUNWAYS</div>${rl}`;
  }
  // frequencies
  const fq=window.FREQ&&window.FREQ[a.ic];
  if(fq&&fq.length){
    const seen={},parts=[];
    for(const[ty,m]of fq){if(seen[ty])continue;seen[ty]=1;parts.push(`<span class="apt-freq"><b>${ty}</b> ${m.toFixed(3)}</span>`);}
    h+=`<div class="apt-h">FREQUENCIES</div><div class="apt-freqs">${parts.slice(0,8).join('')}</div>`;
  }
  if(inbound.length)h+=`<div class="apt-h ph-app">ON APPROACH</div>${inbound.slice(0,4).map(line).join('')}`;
  if(departing.length)h+=`<div class="apt-h ph-dep">DEPARTING</div>${departing.slice(0,3).map(line).join('')}`;
  if(!inbound.length&&!departing.length)h+=`<div class="apt-none">No arrivals or departures detected in range.</div>`;
  return h;
}
function renderAirports(){
  S.airportLayer.clearLayers();
  if(!S.overlays.airports||!S.map)return;
  const b=S.map.getBounds().pad(0.25);
  const z=S.map.getZoom();
  for(const a of AIRPORTS){
    if(!b.contains([a.lat,a.lon]))continue;
    // density by class: large always, medium z>=6, small z>=9
    if(a.t==='M'&&z<6)continue;
    if(a.t==='S'&&z<9)continue;
    if(!a.big&&a.t!=='M'&&a.t!=='S'&&z<7)continue;
    const{inbound,departing}=airportTraffic(a);
    const active=inbound.length>0;
    const r=a.big?5.5:a.t==='M'?4:3.2;
    const lbl=a.ia||a.ic;
    L.circleMarker([a.lat,a.lon],{
      radius:r,color:active?'#e8a020':'#9fb6d8',weight:active?2:1.4,
      fillColor:active?'#3a2c0e':'#15233c',fillOpacity:.92,
    }).addTo(S.airportLayer)
      .bindTooltip(`${lbl}${inbound.length?' \u2193'+inbound.length:''}`,{permanent:z>=8,direction:'right',offset:[6,0],className:'apt-tip'})
      .bindPopup(airportPopup(a),{maxWidth:280,className:'apt-popup'});
  }
}

/* ── ARRIVAL / DEPARTURE PROCEDURES ──────────────────────────────────────────
   Built from real runway geometry (window.RWY: thresholds + true headings):
   the runway, extended final-approach centrelines (~9 NM), FAF markers and
   real runway-end labels. A schematic of approach/departure paths, NOT charted
   SID/STAR/IAP plates. */
function renderProcedures(){
  if(!S.procLayer)return;
  S.procLayer.clearLayers();
  if(!S.overlays.proc||!S.map||!window.RWY)return;
  const z=S.map.getZoom();
  if(z<8)return;
  const b=S.map.getBounds().pad(0.2);
  const FINAL_NM=9,FAF_NM=5;
  for(const a of AIRPORTS){
    const rwys=window.RWY[a.ic];
    if(!rwys||!rwys.length||!b.contains([a.lat,a.lon]))continue;
    for(const rw of rwys){
      const le=rw.le,he=rw.he;
      const half=rw.len?(rw.len/6076)/2:0.4;      // ft → NM, half-length
      let leThr=(le[1]!=null)?[le[1],le[2]]:destPoint(a.lat,a.lon,(le[3]+180)%360,half);
      let heThr=(he[1]!=null)?[he[1],he[2]]:destPoint(a.lat,a.lon,le[3],half);
      // runway itself
      L.polyline([leThr,heThr],{pane:'overlayPane',color:'#cfd8e6',weight:2,opacity:.6}).addTo(S.procLayer);
      // one final per landing direction (extends behind each threshold)
      [[leThr,le[3],le[0]],[heThr,he[3],he[0]]].forEach(([thr,hdg,ident])=>{
        const out=(hdg+180)%360;                   // final approach lies behind the threshold
        const tip=destPoint(thr[0],thr[1],out,FINAL_NM);
        L.polyline([thr,tip],{pane:'overlayPane',color:'#d99a3a',weight:1.3,opacity:.5,dashArray:'5 6'}).addTo(S.procLayer);
        const faf=destPoint(thr[0],thr[1],out,FAF_NM);
        L.circleMarker(faf,{pane:'overlayPane',radius:2.3,color:'#d99a3a',weight:1,opacity:.75,fillColor:'#d99a3a',fillOpacity:.5}).addTo(S.procLayer);
        L.marker(tip,{pane:'overlayPane',interactive:false,
          icon:L.divIcon({className:'proc-lbl',html:`RWY ${ident}`,iconSize:[46,13],iconAnchor:[23,6.5]})}).addTo(S.procLayer);
      });
    }
  }
}

/* ── WEATHER RADAR ───────────────────────────────────────────────────────── */
async function initWeather(){
  if(S.wx.frames.length)return true;
  try{
    const r=await fetch(WX_API);const j=await r.json();
    S.wx.host=j.host;S.wx.frames=(j.radar?.past||[]).concat(j.radar?.nowcast||[]);
    S.wx.idx=Math.max(0,(j.radar?.past||[]).length-1);
    return S.wx.frames.length>0;
  }catch(_){return false;}
}
function wxLayer(i){
  if(S.wx.layers[i])return S.wx.layers[i];
  const f=S.wx.frames[i];if(!f)return null;
  const lyr=L.tileLayer(`${S.wx.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
    {opacity:0,maxNativeZoom:7,maxZoom:19,zIndex:200});
  S.wx.layers[i]=lyr;return lyr;
}
function showWxFrame(i){
  const frames=S.wx.frames;if(!frames.length)return;
  i=((i%frames.length)+frames.length)%frames.length;
  Object.entries(S.wx.layers).forEach(([k,l])=>{if(+k!==i)l.setOpacity(0);});
  const lyr=wxLayer(i);if(!lyr)return;
  if(!S.map.hasLayer(lyr))lyr.addTo(S.map);
  lyr.setOpacity(S.wx.opacity);
  S.wx.idx=i;
  const t=new Date(frames[i].time*1000);
  el('wxTime').textContent=t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const past=S.wx.frames.findIndex(f=>f.time===frames[i].time);
  el('wxTime').dataset.now=(i===frames.length-1)?'1':'0';
}
function wxStop(){S.wx.playing=false;clearInterval(S.wx.timer);el('wxPlay').textContent='\u25b6';}
function wxPlay(){
  if(S.wx.playing){wxStop();return;}
  S.wx.playing=true;el('wxPlay').textContent='\u2759\u2759';
  S.wx.timer=setInterval(()=>showWxFrame(S.wx.idx+1),700);
}
async function toggleWeather(on){
  S.overlays.weather=on;
  if(on){
    el('wxCtl').style.display='flex';
    setStatus('WX RADAR\u2026','warn');
    const ok=await initWeather();
    if(!ok){el('wxTime').textContent='unavailable';setStatus('WX UNAVAILABLE','warn');return;}
    showWxFrame(S.wx.idx);
    setStatus(S.nearbyFiltered.length?`${S.nearbyFiltered.length} NEARBY`:'NO TRAFFIC NEARBY',S.nearbyFiltered.length?'live':'warn');
  }else{
    el('wxCtl').style.display='none';wxStop();
    Object.values(S.wx.layers).forEach(l=>S.map.removeLayer(l));
  }
  saveSettings();
}

/* ── TRAIL COLOUR ────────────────────────────────────────────────────────── */
function trailCol(spd,alt){
  const sp=isFinite(Number(spd))?Math.max(0,Math.min(1,Number(spd)/520)):.3;
  const ap=isFinite(Number(alt))?Math.max(0,Math.min(1,Number(alt)/42000)):.3;
  return`hsl(${(10+sp*200).toFixed(0)} 82% ${(30+ap*24).toFixed(0)}%)`;
}

/* ── FETCH ───────────────────────────────────────────────────────────────── */
/* Timeout-guarded JSON fetch. Throws Error with .status set on HTTP failure,
   .timeout=true on abort, so callers can distinguish 429 / network / hang. */
async function fetchJSON(url,opts){
  const o=(opts&&typeof opts==='object')?opts:{};
  const timeout=o.timeout||FETCH_TIMEOUT;
  const ctrl=new AbortController();
  let timedOut=false;
  const to=setTimeout(()=>{timedOut=true;ctrl.abort();},timeout);
  try{
    const r=await fetch(url,{signal:ctrl.signal,mode:'cors'});
    if(!r.ok){const e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    return await r.json();
  }catch(e){
    if(timedOut){const te=new Error('timeout');te.timeout=true;throw te;}
    throw e;
  }finally{clearTimeout(to);}
}
async function fetchAcInfo(item){
  const reg=item.reg||item.hex||item.key;
  const cs=norm(item.callsign||item.raw?.flight||item.raw?.callsign);
  const urls=[];
  if(reg)urls.push(`${DB}/aircraft/${encodeURIComponent(reg)}`);
  if(cs)urls.push(`${DB}/callsign/${encodeURIComponent(cs)}`);
  let meta=null,route=null;
  for(const url of urls){
    try{
      const p=await fetchJSON(url);const rsp=p?.response||p;
      if(rsp?.aircraft&&!meta)meta=rsp.aircraft;
      if(rsp?.flightroute&&!route)route=rsp.flightroute;
      if(!meta&&(rsp?.type||rsp?.icao_type))meta=rsp;
    }catch(_){}
  }
  return{meta,route};
}

/* ── MERGE + HISTORY ─────────────────────────────────────────────────────── */
function mergeAircraft(aircraft,isUserQuery){
  const now=Date.now();
  for(const ac of aircraft){
    const lat=pickN(ac.lat,ac.latitude),lon=pickN(ac.lon,ac.longitude);
    if(lat==null||lon==null)continue;
    const key=keyFor({reg:ac.r||ac.reg,callsign:ac.flight||ac.callsign,hex:ac.hex});
    const prev=S.allAC.get(key)||{};
    const distKm=S.user?hav(S.user.lat,S.user.lon,lat,lon):9999;
    const item={
      key,lat,lon,distKm,distNm:distKm/1.852,
      bearing:S.user?bearing(S.user.lat,S.user.lon,lat,lon):null,
      reg:norm(ac.r||ac.reg),hex:norm(ac.hex),callsign:norm(ac.flight||ac.callsign),
      firstSeen:prev.firstSeen||now,raw:ac,live:ac,
      meta:prev.meta||null,route:prev.route||null,routeTried:prev.routeTried||false,
      _ph:prev._ph||null,_phCand:prev._phCand||null,_phCandN:prev._phCandN||0,
    };
    S.allAC.set(key,item);addHist(item);
  }
  PHASE_EPOCH++;                                  // new data: recompute phases this frame
  if(isUserQuery&&S.user){
    S.nearby=Array.from(S.allAC.values()).filter(i=>i.distKm<USER_RANGE*1.852).sort((a,b)=>a.distKm-b.distKm);
  }
  S.nearbyFiltered=S.nearby.filter(passesFilter);
}
function addHist(item){
  if(!item.key)return;
  const list=S.histories.get(item.key)||[];
  const pt={lat:item.lat,lon:item.lon,ts:Date.now(),
    speed:pickN(item.raw?.gs,item.raw?.speed,item.raw?.ground_speed)??0,
    alt:pickN(item.raw?.alt_baro,item.raw?.altitude,item.raw?.alt)??0};
  const last=list[list.length-1];
  if(!last||hav(last.lat,last.lon,pt.lat,pt.lon)>0.2){
    list.push(pt);if(list.length>MAX_HIST)list.shift();S.histories.set(item.key,list);
  }
}

/* ── ROUTE ───────────────────────────────────────────────────────────────── */
function routeProg(route,live){
  const o=route?.origin,d=route?.destination;
  const lat=pickN(live?.lat,live?.latitude),lon=pickN(live?.lon,live?.longitude);
  const oLat=pickN(o?.latitude,o?.lat),oLon=pickN(o?.longitude,o?.lon);
  const dLat=pickN(d?.latitude,d?.lat),dLon=pickN(d?.longitude,d?.lon);
  if([oLat,oLon,dLat,dLon,lat,lon].some(v=>v==null))return null;
  const totalNm=nmBtw([oLat,oLon],[dLat,dLon]);if(totalNm<10)return null;
  const doneNm=nmBtw([oLat,oLon],[lat,lon]);
  const remainNm=Math.max(0,totalNm-doneNm);
  const pct=Math.round(Math.max(0,Math.min(100,doneNm/totalNm*100)));
  const gs=pickN(live?.gs,live?.speed,live?.ground_speed);
  const eta=(gs&&gs>30)?new Date(Date.now()+(remainNm/gs)*3600*1000):null;
  return{pct,totalNm,doneNm,remainNm,eta};
}
const fmtETA=eta=>eta?eta.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):null;
function routeHtml(route,live){
  if(!route)return`<div class="rnone">No route data available</div>`;
  const o=route.origin,d=route.destination;
  const oC=o?(o.iata_code||o.icao_code||'?'):'?';
  const dC=d?(d.iata_code||d.icao_code||'?'):'?';
  const prog=routeProg(route,live);const pct=prog?.pct??0;
  const left=prog?`${fmtDist(prog.doneNm)} flown`:'En\u00a0route';
  const right=prog?.eta?`ETA\u00a0${fmtETA(prog.eta)}`:prog?`${fmtDist(prog.remainNm)} left`:'\u2014';
  return`<div class="raps">
    <div class="rap"><div class="rap-c">${oC}</div><div class="rap-n">${o?.name||'\u2014'}</div></div>
    <div class="rarr"><div class="rpct">${prog?pct+'%':''}</div>
      <svg width="14" height="9" viewBox="0 0 14 9" fill="none"><path d="M0 4.5H11M7.5 1.5L11 4.5L7.5 7.5" stroke="var(--mu2)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="rap" style="text-align:right"><div class="rap-c">${dC}</div><div class="rap-n">${d?.name||'\u2014'}</div></div>
  </div>
  <div class="pbar"><div class="pfil" style="width:${pct}%"></div></div>
  <div class="pmeta"><span>${left}</span><span>${right}</span></div>`;
}

/* ── METAR (VATSIM relay · CORS-enabled · key-less) ──────────────────────────
   aviationweather.gov has no CORS headers, so a static site can't read it from
   the browser. metar.vatsim.net relays real-world METARs with ACAO:* and needs
   no key. We fetch raw text lazily (on airport popup open), cache per field. */
function parseMetar(raw){
  if(!raw)return null;
  let toks=raw.replace(/=$/,'').trim().split(/\s+/);
  if(/^(METAR|SPECI)$/.test(toks[0]))toks.shift();
  const station=toks.shift()||'';
  const p={station,windDir:null,windSpd:null,windGust:null,vrb:false,
    visM:null,visSm:null,cavok:false,wx:[],clouds:[],ceilingFt:Infinity,
    tempC:null,dewC:null,qnhHpa:null,qnhInHg:null};
  // recombine "1 1/2SM" fraction visibility
  for(let i=0;i<toks.length-1;i++){
    if(/^\d$/.test(toks[i])&&/^\d\/\dSM$/.test(toks[i+1])){toks[i]=toks[i]+' '+toks[i+1];toks.splice(i+1,1);}
  }
  const wxRe=/^(\+|-|VC)?((MI|PR|BC|DR|BL|SH|TS|FZ|RA|DZ|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|PY|PO|SQ|FC|SS|DS)){1,3}$/;
  for(const t of toks){
    let m;
    if((m=t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))){
      const f=m[4]==='MPS'?1.94384:1;
      p.vrb=m[1]==='VRB';p.windDir=p.vrb?null:+m[1];
      p.windSpd=Math.round(+m[2]*f);if(m[3])p.windGust=Math.round(+m[3]*f);continue;
    }
    if(t==='CAVOK'){p.cavok=true;p.visM=9999;continue;}
    if(/^\d{4}$/.test(t)&&p.visM==null){p.visM=+t;continue;}
    if((m=t.match(/^(M|P)?(\d+(?: \d\/\d)?|\d\/\d)SM$/))){
      let v=m[2];let val;
      if(v.includes(' ')){const[a,b]=v.split(' ');const[n,d]=b.split('/');val=+a+(+n/+d);}
      else if(v.includes('/')){const[n,d]=v.split('/');val=+n/+d;}
      else val=+v;
      if(m[1]==='M')val=Math.max(0,val-0.01);    // M = less than
      p.visSm=val;continue;                       // P = greater than: value is the floor
    }
    if((m=t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/))){
      const base=+m[2]*100;p.clouds.push({cover:m[1],baseFt:base,type:m[3]||''});
      if((m[1]==='BKN'||m[1]==='OVC'||m[1]==='VV')&&base<p.ceilingFt)p.ceilingFt=base;continue;
    }
    if(/^(SKC|CLR|NSC|NCD)$/.test(t))continue;
    if((m=t.match(/^(M?\d{2})\/(M?\d{2})$/))){
      const c=s=>s.startsWith('M')?-(+s.slice(1)):+s;p.tempC=c(m[1]);p.dewC=c(m[2]);continue;
    }
    if((m=t.match(/^Q(\d{3,4})$/))){p.qnhHpa=+m[1];continue;}
    if((m=t.match(/^A(\d{4})$/))){p.qnhInHg=+m[1]/100;continue;}
    if(wxRe.test(t)&&t!=='NSW')p.wx.push(t);
  }
  if(p.qnhHpa==null&&p.qnhInHg!=null)p.qnhHpa=Math.round(p.qnhInHg*33.8639);
  if(p.qnhInHg==null&&p.qnhHpa!=null)p.qnhInHg=+(p.qnhHpa/33.8639).toFixed(2);
  p.cat=metarCategory(p);
  return p;
}
function metarCategory(p){
  let sm=p.visSm;
  if(sm==null&&p.visM!=null)sm=p.visM>=9999?10:p.visM/1609.34;
  if(p.cavok)sm=10;
  const ceil=p.ceilingFt;
  if((ceil<500)||(sm!=null&&sm<1))return'LIFR';
  if((ceil<1000)||(sm!=null&&sm<3))return'IFR';
  if((ceil<=3000)||(sm!=null&&sm<=5))return'MVFR';
  return'VFR';
}
const WX_WORDS={RA:'rain',SN:'snow',DZ:'drizzle',SH:'showers',TS:'thunderstorm',
  FG:'fog',BR:'mist',HZ:'haze',FU:'smoke',GR:'hail',GS:'small hail',FZ:'freezing',
  BL:'blowing',SQ:'squall',FC:'funnel cloud',SS:'sandstorm',DS:'duststorm',PL:'ice pellets'};
function wxDecode(code){
  let s=code.replace(/^(\+|-|VC)/,m=>m==='+'?'heavy ':m==='-'?'light ':'nearby ');
  return s.replace(/MI|PR|BC|DR|BL|SH|TS|FZ|RA|DZ|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|VA|PY|PO|SQ|FC|SS|DS/g,m=>WX_WORDS[m]||m);
}
function getMetar(icao){
  icao=String(icao||'').toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(icao))return Promise.resolve(null);
  const c=S.metar.get(icao);
  if(c&&c.pending)return c.pending;
  if(c&&c.ok!=null&&Date.now()-c.ts<METAR_TTL)return Promise.resolve(c);
  const pending=(async()=>{
    try{
      const ctrl=new AbortController();const to=setTimeout(()=>ctrl.abort(),10000);
      let txt;
      try{const r=await fetch(`${METAR_API}/${icao}`,{signal:ctrl.signal});if(!r.ok)throw 0;txt=await r.text();}
      finally{clearTimeout(to);}
      txt=String(txt||'').trim();
      if(!txt||txt.length<5||/no metar/i.test(txt))throw 0;
      const raw=txt.split('\n')[0].trim();
      const rec={ts:Date.now(),raw,parsed:parseMetar(raw),ok:true};
      S.metar.set(icao,rec);return rec;
    }catch(_){const rec={ts:Date.now(),raw:null,parsed:null,ok:false};S.metar.set(icao,rec);return rec;}
  })();
  S.metar.set(icao,{ts:Date.now(),pending});
  return pending;
}
function metarHtml(rec){
  if(!rec||!rec.ok||!rec.parsed)return`<span class="wx-load">METAR unavailable for this field.</span>`;
  const p=rec.parsed;
  const cat=p.cat||'VFR';
  const wind=p.vrb?`VRB ${p.windSpd}kt`
    :(p.windSpd===0?'Calm':`${String(p.windDir).padStart(3,'0')}\u00b0 ${p.windSpd}kt${p.windGust?` G${p.windGust}`:''}`);
  let vis='\u2014';
  if(p.cavok)vis='CAVOK';
  else if(p.visM!=null)vis=p.visM>=9999?'10\u202fkm+':Mdist()?`${(p.visM/1000).toFixed(1)}\u202fkm`:`${(p.visM/1609.34).toFixed(1)}\u202fsm`;
  else if(p.visSm!=null)vis=Mdist()?`${(p.visSm*1.609).toFixed(1)}\u202fkm`:`${p.visSm}\u202fsm`;
  const ceil=isFinite(p.ceilingFt)?(Mdist()?`${Math.round(p.ceilingFt*0.3048)}\u202fm`:`${p.ceilingFt.toLocaleString()}\u202fft`):'none';
  const wxTxt=p.wx.length?p.wx.map(wxDecode).join(', '):'';
  const td=(p.tempC!=null)?`${p.tempC}\u00b0/${p.dewC}\u00b0C`:'\u2014';
  const qnh=p.qnhHpa!=null?`${p.qnhHpa} hPa`:(p.qnhInHg!=null?`${p.qnhInHg.toFixed(2)} inHg`:'\u2014');
  const low=(cat==='IFR'||cat==='LIFR');
  return`<div class="wx-line"><span class="wx-cat wx-${cat.toLowerCase()}">${cat}</span>
    <span class="wx-rows">
      <span><b>Wind</b> ${wind}</span><span><b>Vis</b> ${vis}</span>
      <span><b>Ceil</b> ${ceil}</span><span><b>Temp</b> ${td}</span><span><b>QNH</b> ${qnh}</span>
      ${wxTxt?`<span><b>Wx</b> ${wxTxt}</span>`:''}
    </span></div>
    ${low?`<div class="wx-note">Low conditions (${cat}) \u2014 holds and diversions possible.</div>`:''}
    <div class="wx-raw">${rec.raw}</div>`;
}
function onPopupOpen(e){
  const root=e.popup&&e.popup.getElement&&e.popup.getElement();
  if(!root)return;
  const slot=root.querySelector('.apt-wx[data-icao]');
  if(!slot||slot.dataset.loaded==='1')return;
  const icao=slot.dataset.icao;
  getMetar(icao).then(rec=>{
    if(!document.body.contains(slot))return;
    slot.dataset.loaded='1';slot.innerHTML=metarHtml(rec);
  });
}

/* ── DISRUPTIONS · diversions · holding · emergencies ─────────────────────────
   Client-side anomaly detection over tracked traffic. Diversion needs adsbdb
   route metadata (origin/destination); holding is derived from trail geometry.
   All heuristic and clearly labelled — situational awareness, not truth. */
function loiterMetric(key){
  const pts=S.histories.get(key);
  if(!pts||pts.length<6)return null;
  const seg=pts.slice(-10);
  let path=0;
  for(let i=1;i<seg.length;i++)path+=hav(seg[i-1].lat,seg[i-1].lon,seg[i].lat,seg[i].lon);
  if(path<2)return null;                          // km travelled too small to judge
  const net=hav(seg[0].lat,seg[0].lon,seg[seg.length-1].lat,seg[seg.length-1].lon);
  return{ratio:net>0.1?path/net:99,pathKm:path};
}
function detectDisruptions(force){
  if(!force&&S._disTs&&Date.now()-S._disTs<300)return S.disruptions;
  const out=[];
  for(const it of S.allAC.values()){
    if(it.lat==null)continue;
    const raw=it.raw||{};
    if(isEmergency(raw)){
      const sq=sqInfo(raw.squawk);
      out.push({it,kind:'EMG',sev:3,reason:sq?.label||'EMERGENCY',detail:`squawk ${sq?.code||''}`.trim()});
      continue;
    }
    if(!isAirborne(raw))continue;
    const ph=flightPhase(it);
    // diversion / return to origin (requires route)
    const route=it.route;
    if(route&&ph.cls==='app'&&ph.apt){
      const destC=route.destination?.icao_code||route.destination?.iata_code;
      const origC=route.origin?.icao_code||route.origin?.iata_code;
      const dest=aptByCode(destC),orig=aptByCode(origC);
      const landingIc=ph.apt.ic;
      const destIc=dest?.ic||String(route.destination?.icao_code||'').toUpperCase();
      if(destIc&&landingIc&&landingIc!==destIc){
        const sameArea=dest&&nmBtw([ph.apt.lat,ph.apt.lon],[dest.lat,dest.lon])<25;
        if(!sameArea){
          const isReturn=orig&&orig.ic===landingIc;
          out.push({it,kind:isReturn?'RTN':'DIV',sev:2,
            reason:isReturn?'RETURN TO ORIGIN':'LIKELY DIVERSION',
            detail:`${ph.phase} ${ph.apt.ia||ph.apt.ic} \u00b7 filed ${route.destination?.iata_code||destIc}`});
          continue;
        }
      }
    }
    // holding / circling (trail geometry)
    const lo=loiterMetric(it.key);
    const gs=pickN(raw.gs,raw.speed,raw.ground_speed)||0;
    const alt=altNumeric(raw);
    if(lo&&lo.ratio>2.6&&lo.pathKm>6&&gs>60&&alt!=null&&alt>1500){
      out.push({it,kind:'HOLD',sev:1,reason:'HOLDING / CIRCLING',detail:ph.apt?`near ${ph.apt.ia||ph.apt.ic}`:'orbiting'});
    }
  }
  out.sort((a,b)=>b.sev-a.sev||((a.it.distNm||9e9)-(b.it.distNm||9e9)));
  S._disTs=Date.now();S.disruptions=out;return out;
}
function renderDisruptions(){
  const box=el('disList');if(!box)return;
  const list=detectDisruptions(true);
  const cnt=el('disCount');
  if(cnt){cnt.textContent=String(list.length);cnt.classList.toggle('hot',list.some(d=>d.sev>=3));}
  if(!list.length){box.innerHTML='<div class="empty">No diversions, holds or emergencies detected.</div>';return;}
  box.innerHTML='';
  const badge={EMG:'dis-emg',DIV:'dis-div',RTN:'dis-div',HOLD:'dis-hold'};
  const tag={EMG:'EMERGENCY',DIV:'DIVERT',RTN:'RETURN',HOLD:'HOLD'};
  list.slice(0,8).forEach(d=>{
    const it=d.it;const cs=norm(it.raw?.flight||it.callsign);
    const b=document.createElement('button');
    b.className=`nb-btn dis-btn${it.key===S.selectedKey?' active':''}`;
    b.innerHTML=`<div class="nb-l">
        <div class="nb-reg">${it.reg||it.hex||'Aircraft'}<span class="dis-tag ${badge[d.kind]}">${tag[d.kind]}</span></div>
        <div class="nb-meta">${d.reason}${cs?' \u00b7 '+cs:''}</div>
        <div class="dis-detail">${d.detail||''}</div>
      </div>
      <div class="nb-r"><div class="nb-dist">${fmtDist(it.distNm)}</div></div>`;
    b.onclick=()=>selectAircraft(it.key);
    box.appendChild(b);
  });
}
/* Opportunistically pull route data for approach-phase traffic that lacks it,
   so diversions can be detected. Throttled hard to respect adsbdb. */
function enrichApproaches(){
  let n=0;
  for(const it of S.nearby){
    if(n>=MAX_ENRICH)break;
    if(it.route||it.routeTried||!isAirborne(it.raw))continue;
    const ph=flightPhase(it);
    if(ph.cls!=='app'&&ph.phase!=='DESCENT')continue;
    it.routeTried=true;n++;
    fetchAcInfo(it).then(({meta,route})=>{
      if(meta&&!it.meta)it.meta=meta;
      if(route){it.route=route;renderDisruptions();}
    }).catch(()=>{});
  }
}

/* ── ALTITUDE TAPE (signature element) ───────────────────────────────────── */
function altTape(raw){
  const a=altNumeric(raw);const max=45000;
  const frac=a==null?0:Math.max(0,Math.min(1,a/max));
  const y=100-frac*100;
  const bands=AC.ALT_BANDS;
  const stops=[0,3000,12000,25000,36000,45000];
  let grad='';
  for(let i=0;i<bands.length;i++){
    const lo=i===0?0:stops[i],hi=stops[i+1]||max;
    grad+=`<rect x="0" y="${(100-hi/max*100).toFixed(1)}" width="6" height="${((hi-lo)/max*100).toFixed(1)}" fill="${bands[Math.min(i,bands.length-1)].col}" opacity=".55"/>`;
  }
  const lab=a==null?'\u2014':(a===0?'GND':fmtAlt(raw));
  return`<div class="tape" title="Altitude band">
    <svg viewBox="0 0 30 100" preserveAspectRatio="none" width="30" height="100">
      ${grad}
      <line x1="0" y1="${y.toFixed(1)}" x2="30" y2="${y.toFixed(1)}" stroke="var(--A)" stroke-width="1.4"/>
      <polygon points="6,${y.toFixed(1)} 13,${(y-3).toFixed(1)} 13,${(y+3).toFixed(1)}" fill="var(--A)"/>
    </svg>
    <div class="tape-lab">${lab}</div>
  </div>`;
}

/* ── POPUP ───────────────────────────────────────────────────────────────── */
function buildPopup(item){
  const kind=AC.classifyAC(item.raw||{});const{label,cls}=AC.acCategory(kind);
  const type=item.raw?.t||item.raw?.type||item.meta?.icao_type||'\u2014';
  const cs=norm(item.raw?.flight||item.raw?.callsign||item.callsign);
  const sq=sqInfo(item.raw?.squawk);
  const sqH=sq?` &middot; <b style="color:${sq.alert?'var(--R)':'var(--A)'}">${sq.code}${sq.label?` (${sq.label})`:''}</b>`:'';
  return`<div class="pp-reg">${item.reg||item.hex||'Aircraft'}</div>
<div class="pp-cat"><span class="cat ${cls}">${label}</span></div>
<div class="pp-row"><b>${cs||'No callsign'}</b>${sqH}<br>
${type}${item.distNm!=null?' \u00b7 '+fmtDist(item.distNm):''}<br>
${fmtAlt(item.raw)} &middot; ${fmtSpd(item.raw)}<br>${fmtTrack(item.raw)}</div>
<button class="pp-btn" onclick="window.__sel('${item.key}');this.closest('.leaflet-popup')?.remove()">INSPECT \u2192</button>`;
}

/* ── PLANE LAYER ─────────────────────────────────────────────────────────── */
function renderPlaneLayer(){
  if(!S.map)return;
  if(!S.markers)S.markers=new Map();
  const seen=new Set();
  for(const item of S.allAC.values()){
    if(item.lat==null||item.lon==null)continue;
    if(!passesFilter(item))continue;
    seen.add(item.key);
    const sel=item.key===S.selectedKey;
    const raw=item.raw||{};
    const track=pickN(raw.track,raw.mag_heading,raw.true_heading)||0;
    const kind=AC.classifyAC(raw);
    const altB=Math.round((altNumeric(raw)||0)/1000);          // altitude colour bucket
    const sig=`${kind}|${altB}|${Math.round(track/2)*2}|${sel?1:0}`;
    let rec=S.markers.get(item.key);
    if(!rec){
      const m=L.marker([item.lat,item.lon],{icon:AC.makeIcon(item,sel)});
      m._item=item;
      m.bindPopup(()=>buildPopup(m._item));
      m.on('click',()=>selectAircraft(m._item.key));
      m.addTo(S.planeLayer);
      rec={m,sig,lbl:null};
      S.markers.set(item.key,rec);
    }else{
      rec.m._item=item;
      rec.m.setLatLng([item.lat,item.lon]);
      if(rec.sig!==sig){rec.m.setIcon(AC.makeIcon(item,sel));rec.sig=sig;}
    }
    // labels (only re-bind when text/visibility changes)
    const want=S.overlays.labels?(item.callsign||item.reg||item.hex||''):'';
    if(want!==rec.lbl){
      if(rec.m.getTooltip())rec.m.unbindTooltip();
      if(want)rec.m.bindTooltip(want,{permanent:true,direction:'top',offset:[0,-8],className:'plane-lbl'});
      rec.lbl=want;
    }
  }
  for(const[key,rec]of S.markers){
    if(!seen.has(key)){S.planeLayer.removeLayer(rec.m);S.markers.delete(key);}
  }
}

/* ── FULL MAP RENDER ─────────────────────────────────────────────────────── */
function renderMap(){
  ensureMap();
  S.userLayer.clearLayers();S.trailLayer.clearLayers();
  if(S.user){
    L.marker([S.user.lat,S.user.lon],{icon:L.divIcon({html:'<div class="user-mark"><span class="user-ping"></span><span class="user-core"></span></div>',className:'',iconSize:[44,44],iconAnchor:[22,22]})})
      .addTo(S.userLayer).bindPopup(`<div class="pp-reg">\u{1F4CD} YOUR POSITION</div><div class="pp-row">${fmtCoords(S.user.lat,S.user.lon)}</div>`);
  }
  if(S.overlays.trails){
    for(const[key,pts]of S.histories.entries()){
      if(pts.length<2)continue;
      const item=S.allAC.get(key);if(item&&!passesFilter(item))continue;
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1],b=pts[i];
        L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{
          color:trailCol((a.speed+b.speed)/2,(a.alt+b.alt)/2),
          weight:key===S.selectedKey?3.5:2,opacity:key===S.selectedKey?.92:.5,lineCap:'round',lineJoin:'round',
        }).addTo(S.trailLayer);
      }
    }
  }
  drawRings();renderAirports();renderProcedures();renderPlaneLayer();
  // approach/departure vector for the selected aircraft
  S.approachLayer.clearLayers();
  const selItem=S.selectedKey?S.allAC.get(S.selectedKey):null;
  if(selItem&&selItem.lat!=null){
    L.marker([selItem.lat,selItem.lon],{interactive:false,pane:'overlayPane',
      icon:L.divIcon({className:'',html:'<div class="sel-ping"></div>',iconSize:[46,46],iconAnchor:[23,23]})})
      .addTo(S.approachLayer);
    const p=flightPhase(selItem);
    if((p.cls==='app'||p.cls==='dep')&&p.apt){
      const col=p.cls==='app'?'#d99a3a':'#6f8190';
      L.polyline([[selItem.lat,selItem.lon],[p.apt.lat,p.apt.lon]],
        {color:col,weight:1.6,opacity:.8,dashArray:'4 6'}).addTo(S.approachLayer);
      L.circleMarker([p.apt.lat,p.apt.lon],{radius:4,color:col,weight:2,fillColor:col,fillOpacity:.5})
        .addTo(S.approachLayer)
        .bindTooltip(`${p.phase} · ${p.apt.ia}${p.runway?' RWY '+p.runway:''}`,{permanent:false,direction:'top',className:'apt-tip'});
    }
  }
  // disruption markers (emergencies / diversions / holds)
  if(S.disruptLayer){
    S.disruptLayer.clearLayers();
    for(const d of detectDisruptions().slice(0,12)){
      const it=d.it;if(it.lat==null)continue;
      const col=d.sev>=3?'#ef4b4b':d.sev>=2?'#f0a830':'#e8a020';
      L.marker([it.lat,it.lon],{interactive:false,pane:'overlayPane',
        icon:L.divIcon({className:'',html:`<div class="dis-ring" style="border-color:${col}"></div>`,iconSize:[34,34],iconAnchor:[17,17]})})
        .addTo(S.disruptLayer);
    }
  }
  const bounds=[];
  if(S.user)bounds.push([S.user.lat,S.user.lon]);
  S.nearbyFiltered.forEach(i=>bounds.push([i.lat,i.lon]));
  if(!S.didInitialFit&&bounds.length>=2){S.map.fitBounds(bounds,{padding:[36,36],maxZoom:10});S.didInitialFit=true;}
  else if(!S.didInitialFit&&bounds.length===1){S.map.setView(bounds[0],10);S.didInitialFit=true;}
  setTimeout(()=>S.map.invalidateSize(),80);
}

/* ── PRIMARY TARGET (flight strip · renders the selected aircraft) ────────── */
function makePrimaryHtml(item){
  if(!item)return'<div class="empty">No returns match the current filters.</div>';
  const meta=item.meta||{},live=item.live||item.raw||{},route=item.route||null;
  const photo=meta.url_photo_thumbnail||meta.url_photo||'';
  const reg=meta.registration||item.reg||item.hex||'\u2014';
  const cs=norm(live.flight||live.callsign||item.callsign);
  const type=meta.icao_type||meta.type||live.t||live.type||'';
  const owner=meta.registered_owner||'';
  const hex=meta.mode_s||item.hex||'';
  const sq=sqInfo(live.squawk||item.raw?.squawk);
  const air=isAirborne(live);
  const{label,cls}=AC.acCategory(AC.classifyAC(live));
  const ph=flightPhase(item);
  const dist=item.distNm!=null?fmtDist(item.distNm):'';
  const dir=item.bearing!=null?`${compass(item.bearing)} of you`:'';
  const metrics=[
    ['ALT',fmtAlt(live),air?'live':''],['G/S',fmtSpd(live),''],['TRK',fmtTrack(live),''],
    ['V/S',fmtClimb(live),''],['DIST',dist||'\u2014',''],['BRG',item.bearing!=null?`${Math.round(item.bearing)}\u00b0 ${compass(item.bearing)}`:'\u2014',''],
  ];
  const idents=[
    type?['TYPE',type,'']:null,
    meta.manufacturer?['MFR',meta.manufacturer,'']:null,
    owner?['OPERATOR',owner,'']:null,
    hex?['MODE S',hex,'']:null,
    sq?['SQUAWK',`${sq.code}${sq.label?' \u00b7 '+sq.label:''}`,(sq.alert?'red':'')]:null,
    ph.apt?['FIELD',`${ph.apt.ia||ph.apt.ic} \u00b7 ${fmtDist(ph.distNm)}`,'']:null,
    (ph.runway&&(ph.cls==='app'||ph.cls==='dep'))?['RWY (est)',ph.runway,'']:null,
    ['POSITION',fmtCoords(pickN(live.lat,live.latitude),pickN(live.lon,live.longitude)),''],
    ['UPDATED',fmtAgo(live.seen??live.seen_pos),''],
  ].filter(Boolean);
  const links=hex?`<div class="ext-links">
    <a href="https://globe.adsbexchange.com/?icao=${hex.toLowerCase()}" target="_blank" rel="noopener">ADSB Exchange \u2197</a>
    <a href="https://flightaware.com/live/flight/${encodeURIComponent(cs||reg)}" target="_blank" rel="noopener">FlightAware \u2197</a></div>`:'';
  return`<div class="pt-head">
    <div class="ac-photo">${photo?`<img src="${photo}" alt="">`:'NO IMAGE'}</div>
    <div class="pt-id">
      <div class="reg-big">${reg}</div>
      <div class="pt-meta">${[dist,dir].filter(Boolean).join(' \u00b7 ')||'\u00a0'}</div>
      <div class="tag-row">
        <span class="cat ${cls}">${label}</span>
        ${cs?`<span class="tag cyn">${cs}</span>`:''}
        ${sq?`<span class="tag ${sq.alert?'red':'amb'}">${sq.code}${sq.label?` \u00b7 ${sq.label}`:''}</span>`:''}
      </div>
    </div>
  </div>
  <div class="phase-row">${phaseHtml(item)}</div>
  <div class="smini">
    ${metrics.map(([k,v,c])=>`<div class="sm"><div class="k">${k}</div><div class="v ${c||''}">${v||'\u2014'}</div></div>`).join('')}
  </div>
  <div class="idlist">
    ${idents.map(([k,v,c])=>`<div class="idrow"><span class="idk">${k}</span><span class="idv ${c||''}">${v||'\u2014'}</span></div>`).join('')}
  </div>
  ${route?`<div class="rbox" style="margin-top:10px"><div class="rbox-h">FLIGHT ROUTE</div>${routeHtml(route,live)}</div>`:''}
  ${links}`;
}

/* ── NEAREST QUICK-STRIP ─────────────────────────────────────────────────────
   When the primary card is showing something you clicked, the nearest aircraft
   collapses to this slim strip so it stays one tap away. */
function makeNearBar(item){
  if(!item)return'';
  const ph=flightPhase(item);
  const cs=norm(item.raw?.flight||item.callsign);
  return`<span class="nbar-l">
      <span class="nbar-tag">NEAREST</span>
      <span class="nbar-reg">${item.reg||item.hex||'Aircraft'}</span>
      ${cs?`<span class="nbar-cs">${cs}</span>`:''}
      <span class="phase ph-${ph.cls}">${ph.phase}</span>
    </span>
    <span class="nbar-r">${fmtDist(item.distNm)}${item.bearing!=null?' \u00b7 '+compass(item.bearing):''}&nbsp;\u203a</span>`;
}
/* The primary card always renders the SELECTED aircraft, which defaults to the
   nearest on open. Selecting a different aircraft promotes it here and drops the
   nearest into the quick-strip. */
function renderPrimary(){
  const nearest=S.nearbyFiltered[0]||null;
  const nearestKey=nearest?nearest.key:null;
  if(!S.selectedKey||!S.allAC.has(S.selectedKey))S.selectedKey=nearestKey;
  S.selectedInfo=S.selectedKey?S.allAC.get(S.selectedKey)||null:null;
  const sel=S.selectedInfo;
  const isNear=!!(sel&&nearestKey&&sel.key===nearestKey);
  el('primaryBody').innerHTML=sel?makePrimaryHtml(sel):'<div class="empty">No active returns match the current filters.</div>';
  setTxt('primaryEyebrow',isNear?'PRIMARY \u00b7 NEAREST':'PRIMARY \u00b7 SELECTED');
  setTxt('selPill',sel?(sel.reg||sel.hex||'AIRCRAFT'):'NONE');
  const bar=el('nearBar');
  if(bar){
    if(nearest&&nearestKey!==S.selectedKey){
      bar.style.display='flex';bar.innerHTML=makeNearBar(nearest);bar.onclick=()=>selectAircraft(nearestKey);
    }else bar.style.display='none';
  }
}

/* ── NEARBY LIST ─────────────────────────────────────────────────────────── */
function renderNearbyList(){
  const box=el('nbList');
  const list=S.nearbyFiltered;
  if(!list.length){box.innerHTML='<div class="empty">No returns in range match the filters.</div>';return;}
  box.innerHTML='';
  list.slice(0,18).forEach(item=>{
    const cs=norm(item.raw?.flight||item.callsign);
    const sq=sqInfo(item.raw?.squawk);
    const type=item.raw?.t||item.raw?.type||'';
    const{label,cls}=AC.acCategory(AC.classifyAC(item.raw||{}));
    const ph=flightPhase(item);
    const phTag=(ph.cls==='app'||ph.cls==='dep')?`<span class="nb-ph ph-${ph.cls}">${ph.cls==='app'?'APP':'DEP'} ${ph.apt?ph.apt.ia:''}${ph.runway?'/'+ph.runway:''}</span>`:'';
    const btn=document.createElement('button');
    btn.className=`nb-btn${item.key===S.selectedKey?' active':''}`;
    btn.innerHTML=`<div class="nb-l">
      <div class="nb-reg">${item.reg||item.hex||'Aircraft'}</div>
      <div class="nb-meta">${cs||'\u2014'} \u00b7 ${type||'?'}${sq&&sq.alert?` <span class="nb-sq">\u00b7 ${sq.code}</span>`:''}</div>
      ${phTag}
    </div>
    <div class="nb-r">
      <div class="nb-dist">${fmtDist(item.distNm)}</div>
      <span class="cat ${cls}" style="font-size:8px;padding:1px 5px">${label}</span>
    </div>`;
    btn.onclick=()=>selectAircraft(item.key);
    box.appendChild(btn);
  });
}

/* ── FIELD STATS ─────────────────────────────────────────────────────────── */
function renderStats(){
  const shown=Array.from(S.allAC.values()).filter(passesFilter);
  const byChip={};AC.CHIPS.forEach(c=>byChip[c]=0);
  const bands=AC.ALT_BANDS.map(()=>0);
  let emerg=0,airb=0;
  let closest=null,highest=null,fastest=null;
  for(const it of shown){
    const raw=it.raw||{};
    byChip[AC.acCategory(AC.classifyAC(raw)).chip]++;
    if(isEmergency(raw))emerg++;
    if(isAirborne(raw))airb++;
    const a=altNumeric(raw);
    const gnd=raw.on_ground===true||a===0;
    for(let i=0;i<AC.ALT_BANDS.length;i++){
      const b=AC.ALT_BANDS[i];
      if((gnd&&i===0)||(a!=null&&a>0&&a<b.max)){bands[i]++;break;}
      if(a!=null&&b.max===Infinity){bands[i]++;break;}
    }
    if(it.distNm!=null&&(!closest||it.distNm<closest.distNm))closest=it;
    if(a!=null&&(!highest||a>(altNumeric(highest.raw)||0)))highest=it;
    const gs=pickN(raw.gs,raw.speed,raw.ground_speed);
    if(gs!=null&&(!fastest||gs>(pickN(fastest.raw.gs,fastest.raw.speed,fastest.raw.ground_speed)||0)))fastest=it;
  }
  const maxChip=Math.max(1,...Object.values(byChip));
  const maxBand=Math.max(1,...bands);
  el('statTracked').textContent=S.allAC.size;
  el('statShown').textContent=shown.length;
  el('statNearby').textContent=S.nearbyFiltered.length;
  el('statAir').textContent=airb;

  el('catBars').innerHTML=AC.CHIPS.map(c=>{
    const n=byChip[c];const w=(n/maxChip*100).toFixed(0);
    const clsMap={HEAVY:'--ch',AIRLINE:'--ca',BIZJET:'--cb',GA:'--cg',ROTOR:'--cr',MILITARY:'--cm',GROUND:'--cgr',OTHER:'--cx'};
    return`<div class="bar-row"><span class="bar-k">${c}</span>
      <span class="bar-t"><span class="bar-f" style="width:${w}%;background:var(${clsMap[c]})"></span></span>
      <span class="bar-v">${n}</span></div>`;
  }).join('');

  el('altBars').innerHTML=AC.ALT_BANDS.map((b,i)=>{
    const n=bands[i];const w=(n/maxBand*100).toFixed(0);
    return`<div class="bar-row"><span class="bar-k" style="color:${b.col}">${b.label}</span>
      <span class="bar-t"><span class="bar-f" style="width:${w}%;background:${b.col}"></span></span>
      <span class="bar-v">${n}</span></div>`;
  }).join('');

  const sup=(it,val)=>it?`<b>${it.reg||it.hex||'?'}</b> · ${val}`:'\u2014';
  el('supClosest').innerHTML=sup(closest,closest?fmtDist(closest.distNm):'');
  el('supHighest').innerHTML=sup(highest,highest?fmtAlt(highest.raw):'');
  el('supFastest').innerHTML=sup(fastest,fastest?fmtSpd(fastest.raw):'');
  el('statEmerg').textContent=emerg;
  el('statEmerg').classList.toggle('hot',emerg>0);
}

/* ── EMERGENCY BANNER ────────────────────────────────────────────────────── */
function renderEmergency(){
  const hits=Array.from(S.allAC.values()).filter(i=>isEmergency(i.raw)).sort((a,b)=>(a.distNm||9e9)-(b.distNm||9e9));
  const bar=el('emgBanner');
  if(!hits.length){bar.style.display='none';return;}
  const h=hits[0];const sq=sqInfo(h.raw?.squawk);
  bar.style.display='flex';
  bar.innerHTML=`<span class="emg-dot"></span>
    <span class="emg-txt"><b>${sq?.label||'EMERGENCY'}</b> · ${h.reg||h.hex||'Aircraft'} squawking ${sq?.code} · ${fmtDist(h.distNm)} ${h.bearing!=null?compass(h.bearing):''}${hits.length>1?` · +${hits.length-1} more`:''}</span>
    <button class="emg-btn" onclick="window.__sel('${h.key}')">LOCATE \u2192</button>`;
}

/* ── RENDER ALL ──────────────────────────────────────────────────────────── */
function renderAll(){
  S.nearbyFiltered=S.nearby.filter(passesFilter);
  renderPrimary();
  renderNearbyList();renderStats();renderEmergency();renderDisruptions();renderPlaneLayer();
  if(S.overlays.trails)renderMap();
}

/* ── LOAD ────────────────────────────────────────────────────────────────── */
async function loadNearby(){
  if(!S.user)return;
  const pl=await fetchJSON(`${API}/v2/point/${S.user.lat}/${S.user.lon}/${USER_RANGE}`);
  mergeAircraft(pl?.ac||pl?.aircraft||[],true);
  S.lastUpdate=Date.now();
  if(!S.selectedKey||!S.allAC.has(S.selectedKey))S.selectedKey=S.nearbyFiltered[0]?.key||null;
  S.selectedInfo=S.selectedKey?S.allAC.get(S.selectedKey)||null:null;
  renderMap();renderAll();
  updateMapStatus();
  if(S.follow&&S.map){const t=(S.selectedKey&&S.allAC.get(S.selectedKey))||S.nearbyFiltered[0];if(t&&t.lat!=null)S.map.panTo([t.lat,t.lon],{animate:true});}
  const nearest=S.nearbyFiltered[0];
  if(nearest&&!nearest.meta&&!nearest.route){
    fetchAcInfo(nearest).then(({meta,route})=>{
      if(meta)nearest.meta=meta;if(route)nearest.route=route;nearest.live=nearest.raw;
      S.allAC.set(nearest.key,nearest);renderAll();
    }).catch(()=>{});
  }
}
/* Resilient self-scheduling poll loop: exponential backoff + jitter on failure,
   longer floor on HTTP 429, immediate reset on manual SYNC. Never overlaps. */
function scheduleNext(delay){
  clearTimeout(S.refreshTimer);
  NET.nextAt=Date.now()+delay;
  S.refreshTimer=setTimeout(()=>poll(false),delay);
}
async function poll(manual){
  if(!S.user)return;
  if(NET.polling){if(manual)scheduleNext(0);return;}
  if(manual){NET.fails=0;NET.rateLimited=false;NET.backoffUntil=0;setStatus('SYNC\u2026','warn');}
  NET.polling=true;
  try{
    await loadNearby();
    NET.fails=0;NET.lastOk=Date.now();NET.rateLimited=false;NET.backoffUntil=0;
    updateNetUI();enrichApproaches();
    scheduleNext(REFRESH_MS);
  }catch(e){
    NET.fails++;
    NET.rateLimited=!!(e&&e.status===429);
    let base=REFRESH_MS*Math.pow(2,Math.min(NET.fails,5));   // 16s,32s,64s,128s,256s → capped
    if(NET.rateLimited)base=Math.max(base,RATE_FLOOR_MS);
    const delay=Math.round(Math.min(base,POLL_MAX)*(0.85+Math.random()*0.3));   // ±15% jitter
    NET.backoffUntil=Date.now()+delay;
    updateNetUI();
    scheduleNext(delay);
  }finally{NET.polling=false;}
}
async function fetchForView(){
  if(!S.map)return;
  if(Date.now()<NET.backoffUntil)return;                     // don't pile on while backing off
  const c=S.map.getCenter();
  if(S.panLat!=null&&hav(c.lat,c.lng,S.panLat,S.panLon)/1.852<MIN_REFETCH_NM)return;
  S.panLat=c.lat;S.panLon=c.lng;
  const b=S.map.getBounds(),ne=b.getNorthEast();
  const radiusNm=Math.min(Math.ceil(hav(c.lat,c.lng,ne.lat,ne.lng)/1.852)+10,250);
  try{
    const pl=await fetchJSON(`${API}/v2/point/${c.lat}/${c.lng}/${radiusNm}`);
    mergeAircraft(pl?.ac||pl?.aircraft||[],false);
    renderPlaneLayer();renderStats();renderEmergency();renderDisruptions();
    updateMapStatus();updateNetUI();
  }catch(_){}
}

/* ── SELECT ──────────────────────────────────────────────────────────────── */
async function selectAircraft(key){
  const item=S.allAC.get(key);if(!item)return;
  S.selectedKey=key;S.selectedInfo=item;
  renderPrimary();
  try{el('primaryCard').scrollIntoView({block:'nearest',behavior:'smooth'});}catch(_){}
  renderNearbyList();renderPlaneLayer();
  if(S.map)renderMap();
  if(S.map&&item.lat!=null)S.map.panTo([item.lat,item.lon],{animate:true});
  try{
    const{meta,route}=await fetchAcInfo(item);
    if(S.selectedKey!==key)return;
    if(meta)item.meta=meta;if(route)item.route=route;item.live=item.raw;
    S.selectedInfo=item;S.allAC.set(key,item);
    renderPrimary();renderNearbyList();renderPlaneLayer();
  }catch(_){}
}
window.__sel=selectAircraft;

/* ── SETTINGS PERSIST ────────────────────────────────────────────────────── */
function saveSettings(){
  try{localStorage.setItem(STORE,JSON.stringify({
    base:S.base,theme:S.theme,units:S.units,follow:S.follow,overlays:S.overlays,
    wxOpacity:S.wx.opacity,aeroOpacity:S.aeroOpacity,
    F:{q:F.q,cats:[...F.cats],altMin:F.altMin,altMax:F.altMax,airborneOnly:F.airborneOnly,militaryOnly:F.militaryOnly,emergencyOnly:F.emergencyOnly},
  }));}catch(_){}
}
function loadSettings(){
  try{
    const d=JSON.parse(localStorage.getItem(STORE)||'{}');
    if(d.base)S.base=d.base;if(d.theme)S.theme=d.theme;if(d.units)S.units=d.units;
    if(typeof d.follow==='boolean')S.follow=d.follow;
    if(d.overlays)Object.assign(S.overlays,d.overlays);
    if(typeof d.wxOpacity==='number')S.wx.opacity=d.wxOpacity;
    if(typeof d.aeroOpacity==='number')S.aeroOpacity=d.aeroOpacity;
    try{S.openaipKey=localStorage.getItem(KEY_STORE)||S.openaipKey;}catch(_){}
    if(d.F){F.q=d.F.q||'';F.cats=new Set(d.F.cats||AC.CHIPS);
      F.altMin=d.F.altMin??0;F.altMax=d.F.altMax??45000;
      F.airborneOnly=!!d.F.airborneOnly;F.militaryOnly=!!d.F.militaryOnly;F.emergencyOnly=!!d.F.emergencyOnly;}
  }catch(_){}
}

/* ── THEME ───────────────────────────────────────────────────────────────── */
function applyTheme(){
  const sys=window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
  const t=S.theme==='auto'?sys:S.theme;
  document.documentElement.dataset.theme=t;
  el('themeBtn').textContent=S.theme==='auto'?'THEME · AUTO':(t==='dark'?'THEME · DARK':'THEME · LIGHT');
}

/* ── UI WIRING ───────────────────────────────────────────────────────────── */
function syncOverlayButtons(){
  document.querySelectorAll('[data-ov]').forEach(b=>b.classList.toggle('on',!!S.overlays[b.dataset.ov]));
}
function syncFilterUI(){
  el('fSearch').value=F.q;
  document.querySelectorAll('[data-chip]').forEach(b=>b.classList.toggle('on',F.cats.has(b.dataset.chip)));
  el('fAltMin').value=F.altMin;el('fAltMax').value=F.altMax;
  el('fAltMinV').textContent=(F.altMin/1000)+'k';el('fAltMaxV').textContent=(F.altMax>=45000?'45k+':F.altMax/1000+'k');
  el('fAir').classList.toggle('on',F.airborneOnly);
  el('fMil').classList.toggle('on',F.militaryOnly);
  el('fEmg').classList.toggle('on',F.emergencyOnly);
}
function wireUI(){
  // base map
  document.querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{setBase(b.dataset.base);});
  // overlays
  document.querySelectorAll('[data-ov]').forEach(b=>b.onclick=async()=>{
    const k=b.dataset.ov;
    if(k==='weather'){await toggleWeather(!S.overlays.weather);syncOverlayButtons();return;}
    if(k==='aero'){toggleAero(!S.overlays.aero);syncOverlayButtons();return;}
    S.overlays[k]=!S.overlays[k];syncOverlayButtons();saveSettings();renderMap();
  });
  // aero chart key + opacity
  if(el('aeroKeySave'))el('aeroKeySave').onclick=()=>applyAeroKey(el('aeroKeyInput').value);
  if(el('aeroKeyInput'))el('aeroKeyInput').onkeydown=e=>{if(e.key==='Enter')applyAeroKey(e.target.value);};
  if(el('aeroOp'))el('aeroOp').oninput=e=>{S.aeroOpacity=+e.target.value/100;if(S.aeroLayer)S.aeroLayer.setOpacity(S.aeroOpacity);saveSettings();};
  // weather controls
  el('wxPlay').onclick=wxPlay;
  el('wxPrev').onclick=()=>{wxStop();showWxFrame(S.wx.idx-1);};
  el('wxNext').onclick=()=>{wxStop();showWxFrame(S.wx.idx+1);};
  el('wxOp').oninput=e=>{S.wx.opacity=+e.target.value/100;const l=S.wx.layers[S.wx.idx];if(l)l.setOpacity(S.wx.opacity);saveSettings();};
  // filters
  el('fSearch').oninput=e=>{F.q=e.target.value.trim();saveSettings();renderAll();};
  document.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{
    const c=b.dataset.chip;if(F.cats.has(c))F.cats.delete(c);else F.cats.add(c);
    syncFilterUI();saveSettings();renderAll();
  });
  const altApply=()=>{F.altMin=Math.min(+el('fAltMin').value,+el('fAltMax').value);F.altMax=Math.max(+el('fAltMin').value,+el('fAltMax').value);syncFilterUI();saveSettings();renderAll();};
  el('fAltMin').oninput=altApply;el('fAltMax').oninput=altApply;
  el('fAir').onclick=()=>{F.airborneOnly=!F.airborneOnly;syncFilterUI();saveSettings();renderAll();};
  el('fMil').onclick=()=>{F.militaryOnly=!F.militaryOnly;syncFilterUI();saveSettings();renderAll();};
  el('fEmg').onclick=()=>{F.emergencyOnly=!F.emergencyOnly;syncFilterUI();saveSettings();renderAll();};
  el('fReset').onclick=()=>{F.q='';F.cats=new Set(AC.CHIPS);F.altMin=0;F.altMax=45000;F.airborneOnly=F.militaryOnly=F.emergencyOnly=false;syncFilterUI();saveSettings();renderAll();};
  // units / theme / follow
  el('unitBtn').onclick=()=>{S.units=S.units==='imperial'?'metric':S.units==='metric'?'hybrid':'imperial';el('unitBtn').textContent='UNITS · '+S.units.toUpperCase();saveSettings();renderAll();syncFilterUI();drawRings();};
  el('themeBtn').onclick=()=>{S.theme=S.theme==='auto'?'dark':S.theme==='dark'?'light':'auto';applyTheme();saveSettings();};
  el('followBtn').onclick=()=>{S.follow=!S.follow;el('followBtn').classList.toggle('on',S.follow);el('followBtn').textContent=S.follow?'FOLLOW · ON':'FOLLOW · OFF';saveSettings();if(S.follow){const t=(S.selectedKey&&S.allAC.get(S.selectedKey))||S.nearbyFiltered[0];if(t&&t.lat!=null)S.map.panTo([t.lat,t.lon]);}};
  if(el('recenterBtn'))el('recenterBtn').onclick=()=>{if(S.user&&S.map)S.map.setView([S.user.lat,S.user.lon],Math.max(S.map.getZoom(),10),{animate:true});};
  el('refreshBtn').onclick=()=>poll(true);
  // collapsibles
  document.querySelectorAll('[data-collapse]').forEach(h=>h.onclick=()=>{
    const card=h.closest('.card');card.classList.toggle('collapsed');
  });
}

/* ── GEOLOCATION ─────────────────────────────────────────────────────────── */
function locateUser(){
  if(!navigator.geolocation){setStatus('GEO UNAVAILABLE','bad');el('primaryBody').innerHTML='<div class="empty">Geolocation isn\u2019t supported by this browser.</div>';return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
    S.user={lat:pos.coords.latitude,lon:pos.coords.longitude};
    setStatus('SYNC\u2026','warn');
    ensureMap();S.map.setView([S.user.lat,S.user.lon],10);
    poll(true);
    if(!S.countTimer)S.countTimer=setInterval(tickCountdown,1000);
  },()=>{
    setStatus('LOCATION DENIED','bad');
    el('primaryBody').innerHTML='<div class="empty">Location access denied. Enable location for this site, then use SYNC to retry.</div>';
    ensureMap();
  },{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}

/* ── AIRPORT DATASET (async, OurAirports-derived) ────────────────────────── */
async function loadAirportData(){
  try{
    const get=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json();};
    const [a,rw,fq]=await Promise.all([
      get('data/airports.json'),get('data/runways.json'),get('data/freq.json')]);
    AIRPORTS.length=0;for(const x of a)AIRPORTS.push(x);
    window.RWY=rw;window.FREQ=fq;
    if(S.map){
      if(S.overlays.airports)renderAirports();
      if(S.overlays.proc)renderProcedures();
    }
    renderAll();
  }catch(e){console.warn('Overhead: airport dataset failed to load \u2014 overlays will be limited.',e);}
}

/* ── INIT ────────────────────────────────────────────────────────────────── */
function init(){
  loadSettings();applyTheme();
  if(window.matchMedia){const mq=window.matchMedia('(prefers-color-scheme: dark)');
    const h=()=>{if(S.theme==='auto')applyTheme();};
    mq.addEventListener?mq.addEventListener('change',h):mq.addListener(h);}
  el('unitBtn').textContent='UNITS · '+S.units.toUpperCase();
  el('followBtn').textContent=S.follow?'FOLLOW · ON':'FOLLOW · OFF';
  el('followBtn').classList.toggle('on',S.follow);
  ensureMap();wireUI();syncOverlayButtons();syncFilterUI();
  if(el('aeroOp'))el('aeroOp').value=Math.round(S.aeroOpacity*100);
  if(el('aeroKeyInput')&&S.openaipKey)el('aeroKeyInput').value=S.openaipKey;
  if(S.overlays.weather)toggleWeather(true);
  if(S.overlays.aero){if(S.openaipKey)toggleAero(true);else{S.overlays.aero=false;syncOverlayButtons();}}
  updateMapStatus();
  renderAll();
  loadAirportData();
  setStatus('LOCATING\u2026','warn');locateUser();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
