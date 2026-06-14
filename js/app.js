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
const USER_RANGE=150;        // NM, initial nearby query radius
const REFRESH_MS=8000;       // live poll interval
const PAN_DEBOUNCE=900;
const MAX_HIST=30;           // trail points kept per aircraft
const MIN_REFETCH_NM=40;     // pan distance before refetching view
const STORE='overhead.settings.v2';

/* ── STATE ───────────────────────────────────────────────────────────────── */
const S={
  map:null,user:null,
  basePane:null,baseLayer:null,
  ringLayer:null,trailLayer:null,airportLayer:null,planeLayer:null,userLayer:null,approachLayer:null,aeroLayer:null,
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
  overlays:{trails:true,rings:true,airports:true,labels:false,weather:false,aero:false},
  wx:{frames:[],host:'',idx:0,layers:{},playing:false,timer:null,opacity:0.6},
};

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

/* ── FORMATTERS (unit aware) ─────────────────────────────────────────────── */
const M=()=>S.units==='metric';
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
  return M()?`${(nm*1.852).toFixed(1)}\u202fkm`:`${nm.toFixed(1)}\u202fNM`;
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
  for(const a of AIRPORTS){
    const km=hav(lat,lon,a.lat,a.lon);
    if(km<bestKm){bestKm=km;best=a;}
  }
  return best?{apt:best,distNm:bestKm/1.852}:null;
}
const angDiff=(a,b)=>{let d=Math.abs((((a-b)%360)+360)%360);return d>180?360-d:d;};
function rwyFromTrack(t){               // landing/dep runway aligns with ground track
  if(t==null)return null;
  let n=Math.round((((t%360)+360)%360)/10);
  if(n===0)n=36;
  return String(n).padStart(2,'0');
}
/* Returns {phase,label,cls,apt,distNm,runway,fromDir,vs,toward}.
   cls ∈ app|dep|gnd|des|crz|enr — drives badge colour. */
function flightPhase(item){
  const raw=item.raw||{};
  const lat=pickN(raw.lat,raw.latitude,item.lat),lon=pickN(raw.lon,raw.longitude,item.lon);
  const alt=altNumeric(raw);
  const vs=pickN(raw.baro_rate,raw.geom_rate,raw.vertical_rate);
  const trk=pickN(raw.track,raw.mag_heading,raw.true_heading);
  const gnd=raw.on_ground===true||raw.gnd===true||String(raw.alt_baro||'').toLowerCase()==='ground'||alt===0;
  const na=(lat!=null&&lon!=null)?nearestAirport(lat,lon):null;
  const out={phase:'\u2014',label:'',cls:'enr',apt:na?.apt||null,distNm:na?.distNm??null,runway:null,fromDir:null,vs,toward:false};
  if(AC.isVehicle(raw)){out.phase='SURFACE';out.cls='gnd';out.label=na&&na.distNm<4?`At ${na.apt.ia}`:'';return out;}
  if(!na){out.phase=(alt!=null&&alt>20000)?'CRUISE':'EN ROUTE';out.cls=alt!=null&&alt>20000?'crz':'enr';return out;}
  const d=na.distNm;
  const brgAptToAc=bearing(na.apt.lat,na.apt.lon,lat,lon);  // where the aircraft sits, from field
  const brgAcToApt=bearing(lat,lon,na.apt.lat,na.apt.lon);  // heading that points at the field
  const toward=trk!=null&&angDiff(trk,brgAcToApt)<55;
  const away  =trk!=null&&angDiff(trk,brgAcToApt)>125;
  out.fromDir=compass(brgAptToAc);out.toward=toward;
  if(gnd){out.phase='ON GROUND';out.cls='gnd';out.label=d<4?na.apt.ia:'';return out;}
  if(vs!=null&&vs>400&&alt<13000&&d<35&&away){
    out.phase='DEPARTURE';out.cls='dep';out.label=`climb-out · ${na.apt.ia}`;out.runway=rwyFromTrack(trk);return out;
  }
  if(vs!=null&&vs<-250&&d<40&&alt!=null&&alt<13000&&toward){
    if(alt<2500&&d<8)out.phase='FINAL APPROACH';
    else if(alt<6000&&d<18)out.phase='APPROACH';
    else out.phase='ARRIVAL';
    out.cls='app';out.label=na.apt.ia;out.runway=rwyFromTrack(trk);return out;
  }
  if(vs!=null&&vs<-300&&alt!=null&&alt>12000){out.phase='DESCENT';out.cls='des';return out;}
  if(vs!=null&&vs>400&&alt!=null&&alt<18000){out.phase='CLIMB';out.cls='dep';return out;}
  if(alt!=null&&alt>=20000){out.phase='CRUISE';out.cls='crz';return out;}
  if(d<25){out.phase='OVERFLIGHT';out.cls='enr';out.label=`near ${na.apt.ia}`;return out;}
  out.phase='EN ROUTE';out.cls='enr';return out;
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
  if(!S.lastUpdate)return;
  const since=Math.round((Date.now()-S.lastUpdate)/1000);
  const s=Math.max(0,Math.round((REFRESH_MS-(Date.now()-S.lastUpdate))/1000));
  el('updPill').textContent=`SYNC ${s}s`;
  setTxt('stAge',since+'s');
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
  S.planeLayer=L.layerGroup().addTo(S.map);
  S.userLayer=L.layerGroup().addTo(S.map);
  setBase(S.base);
  S.map.on('moveend',()=>{
    clearTimeout(S.panTimer);
    updateMapStatus();
    S.panTimer=setTimeout(()=>{fetchForView();if(S.overlays.airports)renderAirports();},PAN_DEBOUNCE);
  });
  S.map.on('move',updateMapStatus);
  L.control.attribution({prefix:false,position:'bottomright'})
    .addAttribution('© OpenStreetMap, CARTO, Esri · airplanes.live · adsbdb · RainViewer').addTo(S.map);
}

/* ── RANGE RINGS ─────────────────────────────────────────────────────────── */
function drawRings(){
  S.ringLayer.clearLayers();
  if(!S.overlays.rings||!S.user)return;
  [50,100,150].forEach(nm=>{
    L.circle([S.user.lat,S.user.lon],{radius:nm*1852,color:'var(--C)',opacity:.22,fill:false,weight:1,dashArray:'3 7'}).addTo(S.ringLayer);
    L.marker([S.user.lat+(nm*1852)/111320,S.user.lon],{
      icon:L.divIcon({className:'ring-lbl',html:`${M()?Math.round(nm*1.852)+'km':nm+'NM'}`,iconSize:[44,14],iconAnchor:[22,7]}),
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
  let h=`<div class="pp-reg" style="color:var(--C)">${a.ia} &middot; ${a.ic}</div>
    <div class="pp-row"><b>${a.n}</b><br>${a.c}</div>
    <div class="apt-stats">
      <span class="apt-stat"><b>${inbound.length}</b> inbound</span>
      <span class="apt-stat"><b>${departing.length}</b> departing</span>
      <span class="apt-stat"><b>${ground.length}</b> on field</span>
    </div>`;
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
    if(!a.big&&z<7)continue;                 // hide minor fields when zoomed out
    const{inbound,departing}=airportTraffic(a);
    const active=inbound.length>0;
    const r=a.big?5.5:3.6;
    L.circleMarker([a.lat,a.lon],{
      radius:r,color:active?'#e8a020':'#9fb6d8',weight:active?2:1.4,
      fillColor:active?'#3a2c0e':'#15233c',fillOpacity:.92,
    }).addTo(S.airportLayer)
      .bindTooltip(`${a.ia}${inbound.length?' \u2193'+inbound.length:''}`,{permanent:z>=8,direction:'right',offset:[6,0],className:'apt-tip'})
      .bindPopup(airportPopup(a),{maxWidth:280,className:'apt-popup'});
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
async function fetchJSON(url,sig){
  const r=await fetch(url,{signal:sig,mode:'cors'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();
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
      meta:prev.meta||null,route:prev.route||null,
    };
    S.allAC.set(key,item);addHist(item);
  }
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
  S.planeLayer.clearLayers();
  for(const item of S.allAC.values()){
    if(item.lat==null||item.lon==null)continue;
    if(!passesFilter(item))continue;
    const m=L.marker([item.lat,item.lon],{icon:AC.makeIcon(item,item.key===S.selectedKey)})
      .addTo(S.planeLayer).bindPopup(buildPopup(item));
    if(S.overlays.labels){
      const lbl=item.callsign||item.reg||item.hex||'';
      if(lbl)m.bindTooltip(lbl,{permanent:true,direction:'top',offset:[0,-8],className:'plane-lbl'});
    }
    m.on('click',()=>selectAircraft(item.key));
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
  drawRings();renderAirports();renderPlaneLayer();
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
  const bounds=[];
  if(S.user)bounds.push([S.user.lat,S.user.lon]);
  S.nearbyFiltered.forEach(i=>bounds.push([i.lat,i.lon]));
  if(!S.didInitialFit&&bounds.length>=2){S.map.fitBounds(bounds,{padding:[36,36],maxZoom:10});S.didInitialFit=true;}
  else if(!S.didInitialFit&&bounds.length===1){S.map.setView(bounds[0],10);S.didInitialFit=true;}
  setTimeout(()=>S.map.invalidateSize(),80);
}

/* ── NEAREST PRIMARY TARGET ──────────────────────────────────────────────── */
function makeNearestHtml(item){
  if(!item)return'<div class="empty">No returns match the current filters.</div>';
  const meta=item.meta||{},live=item.live||item.raw||{},route=item.route||null;
  const photo=meta.url_photo_thumbnail||meta.url_photo||'';
  const reg=meta.registration||item.reg||item.hex||'\u2014';
  const cs=norm(live.flight||live.callsign||item.callsign);
  const type=meta.icao_type||meta.type||live.t||live.type||'';
  const owner=meta.registered_owner||'';
  const sq=sqInfo(live.squawk||item.raw?.squawk);
  const air=isAirborne(live);
  const{label,cls}=AC.acCategory(AC.classifyAC(live));
  const dirTxt=item.bearing!=null?`${compass(item.bearing)} of you`:'';
  return`<div class="nc-ey">PRIMARY TARGET &middot; NEAREST &middot; ${fmtDist(item.distNm)}${dirTxt?' &middot; '+dirTxt:''}</div>
<div class="phase-row">${phaseHtml(item)}</div>
<div class="nc-body">
  <div class="ac-photo">${photo?`<img src="${photo}" alt="">`:'NO PHOTO'}</div>
  <div class="nc-main">
    <div class="reg-big">${reg}</div>
    <div class="tag-row">
      <span class="cat ${cls}">${label}</span>
      ${cs?`<span class="tag cyn">${cs}</span>`:''}
      ${type?`<span class="tag">${type}</span>`:''}
      ${sq?`<span class="tag ${sq.alert?'red':'amb'}">${sq.code}${sq.label?` &middot; ${sq.label}`:''}</span>`:''}
      ${owner?`<span class="tag">${owner}</span>`:''}
    </div>
    <div class="smini">
      <div class="sm"><div class="k">ALT</div><div class="v ${air?'live':''}">${fmtAlt(live)}</div></div>
      <div class="sm"><div class="k">G/S</div><div class="v">${fmtSpd(live)}</div></div>
      <div class="sm"><div class="k">TRK</div><div class="v">${fmtTrack(live)}</div></div>
      <div class="sm"><div class="k">V/S</div><div class="v">${fmtClimb(live)}</div></div>
      <div class="sm"><div class="k">BRG</div><div class="v">${item.bearing!=null?Math.round(item.bearing)+'\u00b0 '+compass(item.bearing):'\u2014'}</div></div>
      <div class="sm"><div class="k">UPDT</div><div class="v">${fmtAgo(live.seen??live.seen_pos)}</div></div>
    </div>
  </div>
  <div class="route-col"><div class="rbox">
    <div class="rbox-h">FLIGHT ROUTE</div>${routeHtml(route,live)}
  </div></div>
</div>`;
}

/* ── SELECTED CARD (compact) ─────────────────────────────────────────────── */
function makeSelectedHtml(item){
  if(!item)return'<div class="empty">Tap any aircraft on the map or in the traffic list to inspect.</div>';
  const meta=item.meta||{},live=item.live||item.raw||{},route=item.route||null;
  const photo=meta.url_photo_thumbnail||meta.url_photo||'';
  const reg=meta.registration||item.reg||item.hex||'\u2014';
  const cs=norm(live.flight||live.callsign||item.callsign);
  const sq=sqInfo(live.squawk||item.raw?.squawk);
  const air=isAirborne(live);
  const hex=meta.mode_s||item.hex||'';
  const ph=flightPhase(item);
  const type=meta.icao_type||meta.type||live.t||live.type||'\u2014';
  const metrics=[
    ['ALT',fmtAlt(live),air?'live':''],
    ['G/S',fmtSpd(live),''],
    ['TRK',fmtTrack(live),''],
    ['V/S',fmtClimb(live),''],
    ['DIST',fmtDist(item.distNm),''],
    ['BRG',item.bearing!=null?`${Math.round(item.bearing)}\u00b0 ${compass(item.bearing)}`:'\u2014',''],
  ];
  const idents=[
    ['TYPE',type,''],
    meta.manufacturer?['MFR',meta.manufacturer,'']:null,
    meta.registered_owner?['OPERATOR',meta.registered_owner,'']:null,
    hex?['ICAO',hex,'']:null,
    sq?['SQUAWK',`${sq.code}${sq.label?' \u00b7 '+sq.label:''}`,(sq.alert?'red':'')]:null,
    ph.apt?['FIELD',`${ph.apt.ia} \u00b7 ${fmtDist(ph.distNm)}`,'']:null,
    (ph.runway&&(ph.cls==='app'||ph.cls==='dep'))?['RWY (est)',ph.runway,'']:null,
    ['POSITION',fmtCoords(pickN(live.lat,live.latitude),pickN(live.lon,live.longitude)),''],
    ['UPDATED',fmtAgo(live.seen??live.seen_pos),''],
  ].filter(Boolean);
  const links=hex?`<div class="ext-links">
    <a href="https://globe.adsbexchange.com/?icao=${hex.toLowerCase()}" target="_blank" rel="noopener">ADSB Exchange \u2197</a>
    <a href="https://flightaware.com/live/flight/${encodeURIComponent(cs||reg)}" target="_blank" rel="noopener">FlightAware \u2197</a>
  </div>`:'';
  return`${photo?`<div class="sph"><img src="${photo}" alt=""></div>`:''}
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
  if(!S.selectedKey||!S.allAC.has(S.selectedKey))S.selectedKey=S.nearbyFiltered[0]?.key||null;
  S.selectedInfo=S.selectedKey?S.allAC.get(S.selectedKey)||null:null;
  el('nearestCard').innerHTML=S.nearbyFiltered.length?makeNearestHtml(S.nearbyFiltered[0]):'<div class="empty">No active returns match the current filters.</div>';
  el('selCard').innerHTML=makeSelectedHtml(S.selectedInfo);
  el('selPill').textContent=S.selectedInfo?(S.selectedInfo.reg||S.selectedInfo.hex||'AIRCRAFT'):'NONE';
  renderNearbyList();renderStats();renderEmergency();renderPlaneLayer();
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
  el('trafficCount').textContent=`${S.allAC.size} ACFT`;updateMapStatus();
  setStatus(S.nearbyFiltered.length?`${S.nearbyFiltered.length} NEARBY`:'NO TRAFFIC NEARBY',S.nearbyFiltered.length?'live':'warn');
  if(S.follow&&S.map){const t=(S.selectedKey&&S.allAC.get(S.selectedKey))||S.nearbyFiltered[0];if(t&&t.lat!=null)S.map.panTo([t.lat,t.lon],{animate:true});}
  const nearest=S.nearbyFiltered[0];
  if(nearest&&!nearest.meta&&!nearest.route){
    fetchAcInfo(nearest).then(({meta,route})=>{
      if(meta)nearest.meta=meta;if(route)nearest.route=route;nearest.live=nearest.raw;
      S.allAC.set(nearest.key,nearest);renderAll();
    }).catch(()=>{});
  }
}
async function fetchForView(){
  if(!S.map)return;
  const c=S.map.getCenter();
  if(S.panLat!=null&&hav(c.lat,c.lng,S.panLat,S.panLon)/1.852<MIN_REFETCH_NM)return;
  S.panLat=c.lat;S.panLon=c.lng;
  const b=S.map.getBounds(),ne=b.getNorthEast();
  const radiusNm=Math.min(Math.ceil(hav(c.lat,c.lng,ne.lat,ne.lng)/1.852)+10,250);
  try{
    const pl=await fetchJSON(`${API}/v2/point/${c.lat}/${c.lng}/${radiusNm}`);
    mergeAircraft(pl?.ac||pl?.aircraft||[],false);
    renderPlaneLayer();renderStats();renderEmergency();
    el('trafficCount').textContent=`${S.allAC.size} ACFT`;updateMapStatus();
  }catch(_){}
}

/* ── SELECT ──────────────────────────────────────────────────────────────── */
async function selectAircraft(key){
  const item=S.allAC.get(key);if(!item)return;
  S.selectedKey=key;S.selectedInfo=item;
  el('selCard').innerHTML=makeSelectedHtml(item);
  el('selPill').textContent=item.reg||item.hex||'AIRCRAFT';
  try{el('selCard').closest('.card').scrollIntoView({block:'nearest',behavior:'smooth'});}catch(_){}
  renderNearbyList();renderPlaneLayer();
  if(S.map)renderMap();
  if(S.map&&item.lat!=null)S.map.panTo([item.lat,item.lon],{animate:true});
  try{
    const{meta,route}=await fetchAcInfo(item);
    if(S.selectedKey!==key)return;
    if(meta)item.meta=meta;if(route)item.route=route;item.live=item.raw;
    S.selectedInfo=item;S.allAC.set(key,item);
    if(S.nearbyFiltered[0]?.key===key)el('nearestCard').innerHTML=makeNearestHtml(item);
    el('selCard').innerHTML=makeSelectedHtml(item);renderNearbyList();renderPlaneLayer();
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
  el('unitBtn').onclick=()=>{S.units=M()?'imperial':'metric';el('unitBtn').textContent='UNITS · '+(M()?'METRIC':'IMPERIAL');saveSettings();renderAll();syncFilterUI();drawRings();};
  el('themeBtn').onclick=()=>{S.theme=S.theme==='auto'?'dark':S.theme==='dark'?'light':'auto';applyTheme();saveSettings();};
  el('followBtn').onclick=()=>{S.follow=!S.follow;el('followBtn').classList.toggle('on',S.follow);el('followBtn').textContent=S.follow?'FOLLOW · ON':'FOLLOW · OFF';saveSettings();if(S.follow){const t=(S.selectedKey&&S.allAC.get(S.selectedKey))||S.nearbyFiltered[0];if(t&&t.lat!=null)S.map.panTo([t.lat,t.lon]);}};
  if(el('recenterBtn'))el('recenterBtn').onclick=()=>{if(S.user&&S.map)S.map.setView([S.user.lat,S.user.lon],Math.max(S.map.getZoom(),10),{animate:true});};
  el('refreshBtn').onclick=()=>{setStatus('SYNC\u2026','warn');loadNearby().catch(()=>setStatus('SYNC FAILED','bad'));};
  // collapsibles
  document.querySelectorAll('[data-collapse]').forEach(h=>h.onclick=()=>{
    const card=h.closest('.card');card.classList.toggle('collapsed');
  });
}

/* ── GEOLOCATION ─────────────────────────────────────────────────────────── */
function locateUser(){
  if(!navigator.geolocation){setStatus('GEO UNAVAILABLE','bad');el('nearestCard').innerHTML='<div class="empty">Geolocation isn\u2019t supported by this browser.</div>';return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
    S.user={lat:pos.coords.latitude,lon:pos.coords.longitude};
    setStatus('SYNC\u2026','warn');
    ensureMap();S.map.setView([S.user.lat,S.user.lon],10);
    try{
      await loadNearby();
      if(!S.refreshTimer)S.refreshTimer=setInterval(()=>loadNearby().catch(()=>setStatus('SYNC FAILED','bad')),REFRESH_MS);
      if(!S.countTimer)S.countTimer=setInterval(tickCountdown,1000);
    }catch(e){setStatus('LOAD FAILED','bad');}
  },()=>{
    setStatus('LOCATION DENIED','bad');
    el('nearestCard').innerHTML='<div class="empty">Location access denied. Enable location for this site, then use SYNC to retry.</div>';
    ensureMap();
  },{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}

/* ── INIT ────────────────────────────────────────────────────────────────── */
function init(){
  loadSettings();applyTheme();
  if(window.matchMedia){const mq=window.matchMedia('(prefers-color-scheme: dark)');
    const h=()=>{if(S.theme==='auto')applyTheme();};
    mq.addEventListener?mq.addEventListener('change',h):mq.addListener(h);}
  el('unitBtn').textContent='UNITS · '+(M()?'METRIC':'IMPERIAL');
  el('followBtn').textContent=S.follow?'FOLLOW · ON':'FOLLOW · OFF';
  el('followBtn').classList.toggle('on',S.follow);
  ensureMap();wireUI();syncOverlayButtons();syncFilterUI();
  if(el('aeroOp'))el('aeroOp').value=Math.round(S.aeroOpacity*100);
  if(el('aeroKeyInput')&&S.openaipKey)el('aeroKeyInput').value=S.openaipKey;
  if(S.overlays.weather)toggleWeather(true);
  if(S.overlays.aero){if(S.openaipKey)toggleAero(true);else{S.overlays.aero=false;syncOverlayButtons();}}
  updateMapStatus();
  renderAll();
  setStatus('LOCATING\u2026','warn');locateUser();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
