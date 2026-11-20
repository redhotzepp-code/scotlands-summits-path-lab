/* Standalone Map Lab. Does not modify the Scotland's Summits Android application. */
const points = {
  chlamain: {
    name: 'Càrn a’ Chlamain',
    sub: '964 m · app display',
    lat: 56.860974,
    lng: -3.779635,
    zoom: 12.9,
  },
  tarf: {
    name: 'Tarf Hotel',
    sub: 'Bothy · reference waypoint',
    lat: 56.88902,
    lng: -3.76274,
    zoom: 12.9,
  },
  meagaidh: {
    name: 'Creag Meagaidh',
    sub: '1128 m · summit',
    lat: 56.95,
    lng: -4.6,
    zoom: 12.7,
  },
  glenmore: {
    name: 'Glenmore Forest',
    sub: 'Woodland pattern test area',
    lat: 57.164,
    lng: -3.690,
    zoom: 13.2,
  },
};
const defaults = {
  interval: 10,
  major: 50,
  demZoom: 12,
  shade: 40,
  strength: 65,
  palette: 'dark',
  contoursOn: true,
  labelsOn: true,
  shadeOn: true,
  namesOn: true,
  bogOn: true,
  forestOn: true,
  bogSize: 58,
  forestSize: 90,
  woodBoundsOn: true,
  rocksOn: true,
  cliffsOn: true,
  waterwaysOn: true,
  spotHeightsOn: true,
  waterfallsOn: true,
  moreNamesOn: true,
  footpathsOn: true,
  cyclewaysOn: true,
  tracksOn: true,
  serviceTracksOn: true,
  lochNamesOn: true,
};
const $ = id => document.getElementById(id);
const DEM = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const BASE = 'https://tiles.openfreemap.org/styles/liberty';
const controlIDs = Object.keys(defaults);
let settings = { ...defaults },
  area = 'chlamain',
  mode = 'compare',
  ref = null,
  lab = null,
  refReady = false,
  labReady = false,
  refDem = null,
  labDem = null,
  markers = [],
  generation = 0,
  updateTimer = null,
  fallingBack = false,
  visibleError = '',
  cameraBusy = false,
  lastCameraSync = 0,
  experimentVectorSource = null,
  nameRequest = null,
  lastNameCentre = null,
  lastNameTime = 0,
  namesCache = new Map(),
  nameTimer = null,
  contourTimer = null,
  lastContourSignature = '',
  pathFetchTimer = null,
  pathFetchBusy = false,
  pathLoadedArea = null,
  pathRetryAt = 0,
  pathResults = new Map(),
  pathDetailCount = 0;
// R6: DoBIH hill 3055, Meall Tionail by Càrn a’ Chlamain.
// A complete Scottish names dataset remains future work.
const verifiedHills=[{name:'Meall Tionail',lat:56.87677,lng:-3.77407,ele:803,id:3055}];
const ml = window.maplibregl;
const mc = window.mlcontour;
function diagnostic(h, d, warning = false) {
  $('diagHead').textContent = h;
  $('diagDetail').textContent = d;
  $('mapStatus').textContent = h;
  $('mapStatus').classList.toggle('warn', warning);
}
function setFallback(message) {
  $('mapFallback').hidden = false;
  $('fallbackInfo').textContent = message;
  diagnostic('Map could not start', message, true);
}
function reload() {
  window.location.reload();
}
function getCentre() {
  return points[area];
}
function syncControls() {
  for (const id of controlIDs) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[id];
    else el.value = String(settings[id]);
  }
  $('shadeOut').textContent = settings.shade + '%';
  $('strengthOut').textContent = settings.strength + '%';
  $('bogSizeOut').textContent = settings.bogSize + '%';
  $('forestSizeOut').textContent = settings.forestSize + '%';
}
function readControl(e) {
  const id = e.target.id;
  settings[id] =
    e.target.type === 'checkbox'
      ? e.target.checked
      : typeof defaults[id] === 'number'
        ? Number(e.target.value)
        : e.target.value;
  syncControls();
  if (['interval', 'major', 'demZoom'].includes(id)) {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(buildExperiment, 300);
  } else updatePaint();
}
function thresholds(minor, major, base) {
  if (base)
    return {
      10: [50, 200],
      11: [20, 100],
      12: [10, 100],
      13: [10, 100],
      14: [10, 50],
      15: [10, 50],
    };
  const v = {};
  for (let z = 10; z <= 16; z++)
    v[z] = [
      z === 10 ? Math.max(50, minor) : z === 11 ? Math.max(20, minor) : minor,
      z === 10 ? Math.max(200, major) : z === 11 ? Math.max(100, major) : major,
    ];
  return v;
}
function colour() {
  return (
    { warm: '#a47655', dark: '#584e46', copper: '#ad653d' }[settings.palette] ||
    '#a47655'
  );
}

/* RC18.118 R4: fine cartographic patterns tied to REAL landcover polygons.
   The icons are deliberately small and are NOT inferred from a DEM. */
function groundPattern(kind, percentage) {
  const tile = document.createElement('canvas');
  tile.width = 64;
  tile.height = 64;
  const ctx = tile.getContext('2d');
  const size = percentage / 100;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'bog') {
    ctx.strokeStyle = 'rgba(31,106,111,0.72)';
    ctx.lineWidth = 1.5;
    // Two 5-pixel-long reed-and-water symbols per 32-pixel map tile.
    for (const [x, y] of [[17, 18], [47, 48]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size, size);
      ctx.beginPath();
      ctx.moveTo(-8, 3);
      ctx.lineTo(-2, 3);
      ctx.moveTo(2, 3);
      ctx.lineTo(8, 3);
      ctx.moveTo(-4, -2);
      ctx.lineTo(-1, 1);
      ctx.lineTo(1, -5);
      ctx.moveTo(3, -3);
      ctx.lineTo(5, 0);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.strokeStyle = 'rgba(43,94,56,0.82)';
    ctx.lineWidth = 1.7;
    for (const [x, y] of [[16, 18], [47, 48]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size, size);
      // An understated 7-pixel-high conifer symbol (at pixelRatio 2).
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-6, -2);
      ctx.lineTo(6, -2);
      ctx.moveTo(0, -7);
      ctx.lineTo(-8, 3);
      ctx.lineTo(8, 3);
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }
  return ctx.getImageData(0, 0, 64, 64);
}
function addGroundPatterns(map, source, beforeId) {
  const baseLayers = map.getStyle().layers || [];
  // Hide the oversized Liberty wetland pattern, but retain its background fill.
  for (const layer of baseLayers) {
    const layerId = String(layer.id || '').toLowerCase();
    const pattern = String(layer.paint?.['fill-pattern'] || '').toLowerCase();
    const wetlandGraphic = /wetland|marsh|bog/.test(layerId + ' ' + pattern);
    if (wetlandGraphic && (layer.type === 'symbol' || !!layer.paint?.['fill-pattern'])) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
  map.addImage('ss-bog-pattern', groundPattern('bog', settings.bogSize), {pixelRatio: 2});
  map.addImage('ss-forest-pattern', groundPattern('forest', settings.forestSize), {pixelRatio: 2});
  const bogTypes = ['wetland','bog','marsh','swamp','wet_meadow','reedbed','saltmarsh','string_bog'];
  const treeTypes = ['forest','wood'];
  map.addLayer({
    id:'ss-bog-glyphs',type:'fill',source,'source-layer':'landcover',minzoom:10.5,
    filter:['any',['==',['get','class'],'wetland'],['in',['get','subclass'],['literal',bogTypes]]],
    paint:{'fill-pattern':'ss-bog-pattern','fill-opacity':0.92}
  },beforeId);
  map.addLayer({
    id:'ss-forest-glyphs',type:'fill',source,'source-layer':'landcover',minzoom:10.5,
    filter:['any',['==',['get','class'],'wood'],['in',['get','subclass'],['literal',treeTypes]]],
    paint:{'fill-pattern':'ss-forest-pattern','fill-opacity':0.9}
  },beforeId);
  // Terrain contour strokes and elevations must remain ABOVE ground symbols.
  map.moveLayer('ss-lines',beforeId);
  map.moveLayer('ss-labels');
}


/* R5: geology/woodland strokes ONLY on OSM features present in the tiles.
   Does not infer missing cliffs from hillshade or copy OS Explorer content. */
function rockTexture(type) {
  // R5.1: sparse, transparent cartographic rock marks. An actual OSM rock or
  // scree polygon controls WHERE symbols appear; its edge is never drawn.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = type === 'scree' ? 'rgba(87,83,77,.73)' : 'rgba(78,76,72,.77)';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Staggered locations reduce the visual grid. No brown coloured backing.
  const positions = [[12,21],[82,13],[49,55],[111,69],[18,107],[76,112]];
  for (const [x,y] of positions) {
    ctx.save();
    ctx.translate(x,y);
    if (type === 'scree') {
      // Loose stone: a few tiny irregular shapes, similar to rock fragments.
      ctx.beginPath();
      ctx.moveTo(-3,2);ctx.lineTo(-1,-2);ctx.lineTo(3,0);ctx.lineTo(1,3);
      ctx.closePath();ctx.stroke();
      ctx.beginPath();
      ctx.arc(5,-3,1.15,0,Math.PI*2);
      ctx.fill();
    } else {
      // Bare bedrock: understated broken rocky lines, not filled triangles.
      ctx.beginPath();
      ctx.moveTo(-5,3);ctx.lineTo(-2,-3);ctx.lineTo(2,-4);
      ctx.moveTo(-2,0);ctx.lineTo(4,2);
      ctx.stroke();
    }
    ctx.restore();
  }
  return ctx.getImageData(0,0,128,128);
}
function hideBaseRockPolygons(map) {
  // Liberty can have its own rock-only landcover fills. Switch off ONLY those;
  // keep forest, bog, hydrology and all ordinary terrain layers untouched.
  for (const layer of map.getStyle().layers || []) {
    if (layer.type !== 'fill' || layer['source-layer'] !== 'landcover') continue;
    if (/rock|scree|bare/i.test(String(layer.id)) &&
        !/forest|wood|wetland|bog/i.test(String(layer.id))) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }
}

/* R7.6: ONE path visibility rule — all mapped routes become eligible when
   the scale bar reaches roughly 1 km. More source geometry becomes available
   and strokes become clearer as the map zooms in. No major/minor division. */
function firstVisibleAtScale(metres) {
  const lat=57*Math.PI/180, maxBarWidth=125;
  return Math.log2(156543.03392804097*Math.cos(lat)*maxBarWidth/(metres*2));
}
const ACCESS_ZOOM=firstVisibleAtScale(1000);
function addAccessPaths(map,source,beforeId){
  const path=['==',['get','class'],'path'];
  const foot=['all',path,['!=',['get','subclass'],'cycleway']];
  const cycle=['all',path,['==',['get','subclass'],'cycleway']];
  const track=['==',['get','class'],'track'];
  const service=['==',['get','class'],'service'];
  const specs=[
    ['ss-footpaths',foot,'#55463b',1.65,[3,2],.98],
    ['ss-cycleways',cycle,'#287e78',1.85,[3,1.5],.97],
    // Double line: dark exterior edges then narrower pale interior.
    ['ss-estate-casing',track,'#51473a',4.4,null,.96],
    ['ss-estate-tracks',track,'#f2ead6',2.2,null,.98],
    ['ss-service-casing',service,'#65523e',3.55,null,.89],
    ['ss-service-tracks',service,'#f4eddc',1.65,null,.96]
  ];
  // Hide original Liberty path layers to avoid drawing them before the 1km
  // threshold or duplicating styled routes in the experimental map.
  for(const layer of map.getStyle().layers||[]){
    if(layer.type!=='line'||layer.source!==source||
       layer['source-layer']!=='transportation')continue;
    if(/^ss-/.test(layer.id))continue;
    if(/path|foot|cycle|bridle|track/i.test(layer.id)){
      map.setLayoutProperty(layer.id,'visibility','none');
    }
  }
  for(const [id,filter,color,width,dashes,opacity] of specs){
    const paint={
      'line-color':color,'line-opacity':opacity,
      'line-width':['interpolate',['linear'],['zoom'],ACCESS_ZOOM,width*.78,14,width,17,width*1.23]
    };
    if(dashes)paint['line-dasharray']=dashes;
    map.addLayer({id,type:'line',source,'source-layer':'transportation',
      minzoom:ACCESS_ZOOM,filter,
      layout:{'line-cap':'round','line-join':'round'},paint},beforeId);
  }
  map.addLayer({id:'ss-ford-crossings',type:'line',source,
    'source-layer':'transportation',minzoom:ACCESS_ZOOM,
    filter:['==',['get','brunnel'],'ford'],
    paint:{'line-color':'#a15f36','line-width':2.1,
      'line-dasharray':[1.5,1.5]}},beforeId);
}

/* R7.5: detailed paths independent of low-zoom OpenMapTiles generalisation.
   One bounded OSM geometry lookup per area, after map settles; never scan
   contour features, never update the map's camera, never poll on animation. */

/* R8: The River Tilt GIS extract is created by GitHub Actions.
   Path data uses static files hosted alongside this map, never Overpass. */
const STATIC_PATH_FILE='./data/paths.geojson';
const STATIC_PATH_MANIFEST='./data/manifest.json';
let staticPathEntry=null,staticPathPending=null;
function reportPaths(message,warning=false,short){
  const el=$('pathStatus');
  if(el){el.textContent=message;el.style.color=warning?'#ffc99d':'#c7e5ce';}
  const indicator=$('pathMapStatus');
  if(indicator){
    indicator.textContent=short||(warning?'River Tilt paths unavailable':'Loading River Tilt paths');
    indicator.title=message;
    indicator.style.borderColor=warning?'#b78b55':'#6b9d76';
  }
}
function addDetailedPathSource(map){
  map.addSource('ss-detailed-path-data',{
    type:'geojson',data:{type:'FeatureCollection',features:[]}
  });
  const lines=[
    // Fine, single broken line for walking and cycling routes.
    ['ss-detailed-foot','foot','#51463c',1.65,[3,2],.97],
    ['ss-detailed-cycle','cycle','#287e78',1.75,[3,1.5],.96],
    // Genuine twin edges: draw the darker outside first, pale centre second.
    ['ss-detailed-estate-border','estate','#514439',4.45,null,.96],
    ['ss-detailed-estate','estate','#f3ecd9',2.15,null,.99],
    ['ss-detailed-service-border','service','#65523e',3.55,null,.89],
    ['ss-detailed-service','service','#f3ecd9',1.7,null,.96]
  ];
  const before=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
  for(const [id,kind,color,width,dash,opacity] of lines){
    const paint={
      'line-color':color,
      'line-opacity':opacity,
      'line-width':['interpolate',['linear'],['zoom'],
        ACCESS_ZOOM,width*.76,14,width,17,width*1.18]
    };
    if(dash)paint['line-dasharray']=dash;
    map.addLayer({id,type:'line',source:'ss-detailed-path-data',
      minzoom:ACCESS_ZOOM,
      filter:['==',['get','class'],kind],
      layout:{'line-cap':'round','line-join':'round'},paint},before);
  }
}
function applyPathGeoJSON(map,entry){
  if(map!==lab)return;
  const source=map.getSource('ss-detailed-path-data');
  if(!source)return;
  source.setData(entry.data);
  pathDetailCount=entry.data.features.length;
  const c=entry.counts;
  reportPaths('Static River Tilt dataset loaded: '+pathDetailCount+
    ' real mapped paths ('+c.foot+' walking, '+c.estate+
    ' estate, '+c.cycle+' cycling, '+c.service+
    ' service). No live path requests. Coverage is regional.',
    false,'River Tilt · '+pathDetailCount+' paths');
}
function scheduleDetailedPaths(){
  // Existing move-end hook retained for compatibility, no per-move fetch.
  if(labReady&&lab&&!staticPathEntry)fetchDetailedPaths();
}
async function fetchDetailedPaths(force=false){
  if(!lab||!labReady)return;
  if(staticPathEntry&&!force){
    if(pathDetailCount!==staticPathEntry.data.features.length)
      applyPathGeoJSON(lab,staticPathEntry);
    return;
  }
  if(staticPathPending)return staticPathPending;
  reportPaths('Loading local River Tilt geometry…',false,'River Tilt · loading…');
  const map=lab;
  staticPathPending=(async()=>{
    const [dataResponse,manifestResponse]=await Promise.all([
      fetch(STATIC_PATH_FILE,{cache:force?'reload':'default'}),
      fetch(STATIC_PATH_MANIFEST,{cache:force?'reload':'default'})
    ]);
    if(!dataResponse.ok||!manifestResponse.ok)
      throw Error('Static route files missing: '+dataResponse.status+'/'+manifestResponse.status);
    const [data,manifest]=await Promise.all([dataResponse.json(),manifestResponse.json()]);
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||
       manifest?.status!=='ready'||!Number.isInteger(manifest.routes)||
       manifest.routes<10||data.features.length!==manifest.routes)
      throw Error('Static path data failed route-count validation');
    const c=manifest.classes||{};
    const entry={data,counts:{
      foot:Number(c.foot)||0,estate:Number(c.estate)||0,
      cycle:Number(c.cycle)||0,service:Number(c.service)||0
    }};
    staticPathEntry=entry;
    if(map===lab)applyPathGeoJSON(map,entry);
    return entry;
  })();
  try{await staticPathPending;}
  catch(e){
    reportPaths('Static routes unavailable: '+String(e.message)+
      '. Terrain remains visible; unmapped paths are not evidence of safe ground.',
      true,'River Tilt · data error');
  }finally{staticPathPending=null;}
}
function addNamedWater(map,source){
  map.addLayer({id:'ss-loch-names',type:'symbol',source,
    'source-layer':'water_name',minzoom:10.8,filter:['has','name'],
    layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],
      'text-size':['interpolate',['linear'],['zoom'],10.8,10.5,14,12],
      'text-max-width':14,'text-padding':8,'text-allow-overlap':false},
    paint:{'text-color':'#287ca0','text-opacity':.88,
      'text-halo-color':'#f6f9f3','text-halo-width':.9}});
  // Only if the vector data actually includes a named waterfall POI.
  map.addLayer({id:'ss-waterfall-tile-names',type:'symbol',source,
    'source-layer':'poi',minzoom:12.5,
    filter:['all',['has','name'],['any',
      ['==',['get','class'],'waterfall'],
      ['==',['get','subclass'],'waterfall']]],
    layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],
      'text-size':11,'text-padding':7},
    paint:{'text-color':'#17769a','text-halo-color':'#fffaf3','text-halo-width':1}});
  map.moveLayer('ss-loch-names');
  map.moveLayer('ss-waterfall-tile-names');
}
function addR5Terrain(map,source,beforeId) {
  const land='landcover';
  const wood=['==',['get','class'],'wood'];
  const rock=['==',['get','class'],'rock'];
  const bare=['==',['get','subclass'],'bare_rock'];
  const scree=['==',['get','subclass'],'scree'];
  map.addLayer({id:'ss-wood-extent',type:'fill',source,'source-layer':land,minzoom:10.5,filter:wood,
    paint:{'fill-color':'#9ab781','fill-opacity':.18}},beforeId);
  map.addLayer({id:'ss-wood-boundary',type:'line',source,'source-layer':land,minzoom:11,filter:wood,
    paint:{'line-color':'#507342','line-opacity':.85,'line-width':['interpolate',['linear'],['zoom'],11,.65,14,1.4,17,1.8]}},beforeId);
  // Hide any rock-specific filled basemap polygons, avoiding the big tan blocks.
  hideBaseRockPolygons(map);
  map.addImage('ss-rock-pattern',rockTexture('bare'),{pixelRatio:2});
  map.addImage('ss-scree-pattern',rockTexture('scree'),{pixelRatio:2});
  map.addLayer({id:'ss-rock-marks',type:'fill',source,'source-layer':land,minzoom:12,
    filter:['all',rock,bare],
    paint:{'fill-pattern':'ss-rock-pattern','fill-opacity':.87}},beforeId);
  map.addLayer({id:'ss-scree-marks',type:'fill',source,'source-layer':land,minzoom:12,
    filter:['all',rock,scree],
    paint:{'fill-pattern':'ss-scree-pattern','fill-opacity':.87}},beforeId);
  // No ss-rock-fill, ss-scree-fill or ss-rock-boundary: symbols only.
  // mountain_peak includes named summits; cliff lines may not exist at all.
  map.addLayer({id:'ss-cliff-traces',type:'line',source,'source-layer':'mountain_peak',
    minzoom:12,filter:['==',['get','class'],'cliff'],
    paint:{'line-color':'#302b24','line-width':['interpolate',['linear'],['zoom'],12,1,16,2.3]}},beforeId);
  map.addLayer({id:'ss-water-detail',type:'line',source,'source-layer':'waterway',
    minzoom:11,filter:['in',['get','class'],['literal',['river','stream','brook']]],
    paint:{'line-color':'#438bae','line-opacity':.85,'line-width':['interpolate',['linear'],['zoom'],11,.6,14,1.2,17,1.7]}},beforeId);
  map.addLayer({id:'ss-water-intermittent',type:'line',source,'source-layer':'waterway',minzoom:13,
    filter:['all',['in',['get','class'],['literal',['river','stream','brook']]],['==',['get','intermittent'],1]],
    paint:{'line-color':'#fff9ef','line-width':1,'line-dasharray':[2,3]}},beforeId);
  map.addLayer({id:'ss-spot-elevations',type:'symbol',source,'source-layer':'mountain_peak',
    minzoom:13.5,filter:['all',['has','ele'],['!',['has','name']]],
    layout:{'text-field':['concat',['to-string',['get','ele']],' m'],'text-font':['Noto Sans Regular'],
      'text-size':10,'text-padding':4},
    paint:{'text-color':'#4d4234','text-halo-color':'#fff9eb','text-halo-width':1.4}});
}
function inspectCoverage() {
  if(!labReady||!experimentVectorSource){$('inspection').textContent='Map data not loaded yet';return}
  const query=(layer)=>lab.querySourceFeatures(experimentVectorSource,{sourceLayer:layer});
  const land=query('landcover'),peak=query('mountain_peak'),water=query('waterway');
  const count=(features,fn)=>features.filter(fn).length;
  const report=[
    'Loaded vector tile inspection (features may repeat across tile edges):',
    'Woodland polygons: '+count(land,f=>f.properties?.class==='wood'),
    'Wetland polygons: '+count(land,f=>f.properties?.class==='wetland'),
    'Rock polygons: '+count(land,f=>f.properties?.class==='rock'),
    'Scree polygons: '+count(land,f=>f.properties?.subclass==='scree'),
    'Cliff line features: '+count(peak,f=>f.properties?.class==='cliff'),
    'Peak elevations: '+count(peak,f=>f.properties?.ele!=null),
    'Watercourse features: '+count(water,f=>['stream','river','brook'].includes(f.properties?.class)),
    'Paths: '+count(query('transportation'),f=>f.properties?.class==='path'),
    'Estate tracks: '+count(query('transportation'),f=>f.properties?.class==='track'),
    'Cycleways: '+count(query('transportation'),f=>f.properties?.subclass==='cycleway'),
    'Named waterbodies: '+count(query('water_name'),f=>Boolean(f.properties?.name)),
    'IMPORTANT: A zero means missing from currently loaded tiles, NOT absent from the real landscape.',
    'Source: OpenMapTiles / OpenStreetMap. OS Explorer data is not included.'
  ];
  $('inspection').textContent=report.join('\n');
}

/* R8.1: Native hill names with a smaller measured OSM elevation underneath.
   The absence of an ele tag must never be filled with an invented height. */
function hillNameAndHeight(){
  return ['format',['get','name'],{'font-scale':1},
    ['case',['has','ele'],
      ['concat','\n',['to-string',['get','ele']],' m'],''],
    {'font-scale':.8,'text-color':'#60584f'}];
}
function addStaticHillLabels(map){
  map.addSource('ss-region-hills',{type:'geojson',data:{
    type:'FeatureCollection',features:[]
  }});
  map.addLayer({id:'ss-region-hill-labels',type:'symbol',
    source:'ss-region-hills',minzoom:11,
    filter:['has','name'],
    layout:{
      'text-field':hillNameAndHeight(),
      'text-font':['Noto Sans Regular'],
      'text-size':['interpolate',['linear'],['zoom'],11,11,13,12.5,16,13.5],
      'text-max-width':12,'text-line-height':1.22,
      'text-allow-overlap':false,'text-padding':7
    },
    paint:{'text-color':'#3c3a34','text-halo-color':'#fffaf0','text-halo-width':1.2}});
  map.moveLayer('ss-region-hill-labels');
}
let hillsPending=null,hillsData=null;
async function loadStaticHills(){
  if(!lab||!labReady)return;
  if(hillsData){
    lab.getSource('ss-region-hills')?.setData(hillsData);
    return;
  }
  if(hillsPending)return hillsPending;
  hillsPending=(async()=>{
    const response=await fetch('./data/hills.geojson');
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))
      throw Error('Invalid named-hill dataset');
    hillsData=data;
    lab?.getSource('ss-region-hills')?.setData(data);
    const withElevation=data.features.filter(f=>Number.isFinite(f.properties?.ele)).length;
    const status=$('hillStatus');
    if(status)status.textContent='River Tilt: '+data.features.length+
      ' named hill/peak points, '+withElevation+
      ' with recorded elevations. Height is shown below the name when available.';
  })();
  try{await hillsPending;}catch(error){
    const status=$('hillStatus');
    if(status)status.textContent='Additional hill names unavailable: '+error.message+
      '. Vector-tile peak names and recorded elevations remain available.';
  }finally{hillsPending=null;}
}
function addR6NameLayers(map,vectorSource) {
  map.addSource('ss-verified-hills',{type:'geojson',data:{
    type:'FeatureCollection',features:verifiedHills.map(h=>({
      type:'Feature',properties:{name:h.name,ele:h.ele,id:h.id},
      geometry:{type:'Point',coordinates:[h.lng,h.lat]}
    }))
  }});
  map.addLayer({id:'ss-verified-hill-label',type:'symbol',source:'ss-verified-hills',
    minzoom:11.5,layout:{
      'text-field':hillNameAndHeight(),'text-font':['Noto Sans Regular'],
      'text-size':['interpolate',['linear'],['zoom'],11.5,11,13,13,15,14],
      'text-allow-overlap':false,'text-max-width':12,'text-padding':6
    },paint:{'text-color':'#30322d','text-halo-color':'#fff8ed','text-halo-width':2}});
  map.addLayer({id:'ss-locality-labels',type:'symbol',source:vectorSource,
    'source-layer':'place',minzoom:12,
    filter:['all',['==',['get','class'],'locality'],['has','name']],
    layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],
      'text-size':11.5,'text-allow-overlap':false,'text-padding':6},
    paint:{'text-color':'#3f3b34','text-halo-color':'#fffaf0','text-halo-width':1.6}});
  for(const key of ['ss-burnnames','ss-peaknames','ss-locality-labels','ss-verified-hill-label']){
    if(map.getLayer(key))map.moveLayer(key);
  }
}

/* R7 - supplementary geographical names and measured contour heights.
   Sources: OSM and DEM respectively, never invented navigational hazards. */
const osmEndpoint='https://overpass.private.coffee/api/interpreter';
const collection=features=>({type:'FeatureCollection',features});
function positionOf(e){
  const v=e.type==='node'?e:e.center;
  return v&&Number.isFinite(v.lat)&&Number.isFinite(v.lon)?[v.lon,v.lat]:null;
}
function overpassQuery(lat,lng){
  const around='(around:4500,'+lat.toFixed(5)+','+lng.toFixed(5)+')';
  return '[out:json][timeout:18];('+
    'nwr'+around+'["natural"~"^(peak|hill|ridge|valley|saddle)$"]["name"];'+
    'nwr'+around+'["natural"="waterfall"];'+
    'nwr'+around+'["waterway"~"^(waterfall|rapids)$"];'+
    'way'+around+'["waterway"~"^(stream|river)$"]["name"];'+
    'nwr'+around+'["place"="locality"]["name"];'+
    ');out center;';
}
function addGroundInformationLayers(map){
  map.addSource('ss-osm-details',{type:'geojson',data:collection([])});
  // Native contour labels remain in ss-labels. No second dynamic GeoJSON
  // source/overlay is created, avoiding two redraw pipelines per map move.
  map.addLayer({id:'ss-osm-hill-names',type:'symbol',
    source:'ss-osm-details',minzoom:11.5,
    filter:['==',['get','kind'],'hill'],
    layout:{'text-field':hillNameAndHeight(),'text-font':['Noto Sans Regular'],
      'text-size':12,'text-padding':6,'text-max-width':14},
    paint:{'text-color':'#34332d','text-halo-color':'#fff8ed','text-halo-width':1.8}});
  map.addLayer({id:'ss-osm-burn-names',type:'symbol',
    source:'ss-osm-details',minzoom:12,
    filter:['==',['get','kind'],'waterway'],
    layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],
      'text-size':11,'text-padding':6,'text-max-width':12},
    paint:{'text-color':'#227ba0','text-halo-color':'#fff9ec','text-halo-width':1.7}});
  map.addLayer({id:'ss-waterfall-circle',type:'circle',
    source:'ss-osm-details',minzoom:12,
    filter:['==',['get','kind'],'waterfall'],
    paint:{'circle-radius':5,'circle-color':'#fffdf5',
      'circle-stroke-color':'#2581a8','circle-stroke-width':2.1}});
  map.addLayer({id:'ss-waterfall-name',type:'symbol',
    source:'ss-osm-details',minzoom:12,
    filter:['==',['get','kind'],'waterfall'],
    layout:{'text-field':['get','name'],
      'text-anchor':'left','text-offset':[0.9,0],
      'text-font':['Noto Sans Regular'],'text-size':12,
      'text-padding':6,'text-max-width':12},
    paint:{'text-color':'#166b90','text-halo-color':'#fffaf0','text-halo-width':2}});
  // Labels must have draw priority over shaded terrain.
  for(const id of ['ss-contour-tag-labels','ss-osm-hill-names','ss-osm-burn-names','ss-waterfall-circle','ss-waterfall-name']) {
    if(map.getLayer(id))map.moveLayer(id);
  }
  // Source callbacks intentionally omitted: tile streaming should not
  // cause expensive JavaScript map scans or trigger extra rerenders.
}
// Update heavy contour labels AFTER the user's gesture. Data changes never
// pan/zoom the camera and are not computed continuously during a touch drag.
// R7.2 mobile stability: use MapLibre's native 'ss-labels' symbol layer.
// Scanning every contour vertex, projecting it and calling GeoJSON setData
// caused expensive repeat work on Android after tiles finished loading.
function queueContourLabels(map){
  if(map!==lab)return;
  const el=$('contourStatus');
  if(el)el.textContent='Contour heights: native line labels (50 m index). Extra background scanning disabled.';
}
function osmStatus(message){
  const e=$('osmStatus');if(e)e.textContent=message;
}
function scheduleNames(){
  // Extra OSM/Overpass names are opt-in only: never fetch during map motion.
  // The base vector tiles still provide their normal hill and stream names.
}
async function loadNames(){
  if(!lab||!labReady||!ref||ref.getZoom()<11.1)return;
  const map=lab,c=ref.getCenter(),centre={lat:c.lat,lng:c.lng};
  const delta=lastNameCentre ? Math.hypot((centre.lat-lastNameCentre.lat)*111200,
    (centre.lng-lastNameCentre.lng)*111200*Math.cos(centre.lat*Math.PI/180)) : Infinity;
  if(delta<2700)return;
  if(Date.now()-lastNameTime<18000)return;
  const cacheKey=centre.lat.toFixed(2)+':'+centre.lng.toFixed(2);
  if(namesCache.has(cacheKey)){
    lastNameCentre=centre;
    map.getSource('ss-osm-details')?.setData(namesCache.get(cacheKey));
    osmStatus('Nearby hill names, rivers and waterfalls loaded from cached OpenStreetMap features.');
    return;
  }
  if(nameRequest)nameRequest.abort();
  const controller=new AbortController();
  nameRequest=controller;
  lastNameTime=Date.now();
  osmStatus('Checking OpenStreetMap for local hills, burns and waterfalls…');
  const abortTimer=setTimeout(()=>controller.abort(),16000);
  try{
    const body=new URLSearchParams({data:overpassQuery(centre.lat,centre.lng)});
    const response=await fetch(osmEndpoint,{method:'POST',body,signal:controller.signal});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.elements))throw new Error('Unexpected response');
    if(map!==lab||controller.signal.aborted)return;
    const feats=[],seen=new Set();const counts={hill:0,waterway:0,waterfall:0};
    for(const item of data.elements){
      const point=positionOf(item),tag=item.tags||{};
      if(!point||seen.has(item.type+':'+item.id))continue;
      seen.add(item.type+':'+item.id);
      let kind=null;
      if(tag.natural==='waterfall'||['waterfall','rapids'].includes(tag.waterway))kind='waterfall';
      else if(['river','stream'].includes(tag.waterway))kind='waterway';
      else if(['peak','hill','ridge','valley','saddle'].includes(tag.natural)||
              tag.place==='locality')kind='hill';
      if(!kind)continue;
      const name=tag.name||(kind==='waterfall'?(tag.waterway==='rapids'?'Rapids':'Waterfall'):null);
      if(!name)continue;
      counts[kind]++;
      const properties={name,kind,osm:item.type+':'+item.id};
      if(kind==='hill'){
        const elevation=Number(tag.ele);
        if(tag.ele!=null&&Number.isFinite(elevation)&&elevation>0&&elevation<2000)
          properties.ele=Math.round(elevation);
      }
      feats.push({type:'Feature',properties,
        geometry:{type:'Point',coordinates:point}});
    }
    const fc=collection(feats);
    namesCache.set(cacheKey,fc);
    lastNameCentre=centre;
    map.getSource('ss-osm-details')?.setData(fc);
    updatePaint();
    osmStatus('OpenStreetMap: '+counts.hill+' hills/landforms, '+counts.waterway+
      ' named water segments, '+counts.waterfall+' waterfalls/rapids found here.');
  }catch(err){
    if(controller.signal.aborted||map!==lab)return;
    lastNameTime=Date.now()+45000;
    osmStatus('Extra names temporarily unavailable ('+String(err.message)+
      '). Existing map labels remain; missing features do not imply safe terrain.');
  }finally{clearTimeout(abortTimer);}
}
function newDEM(maxzoom) {
  if (!mc) return null;
  const dem = new mc.DemSource({
    url: DEM,
    encoding: 'terrarium',
    maxzoom,
    worker: true,
    cacheSize: 75,
    timeoutMs: 13000,
  });
  dem.setupMaplibre(ml);
  return dem;
}
function addStyle(map, reference) {
  const conf = reference
    ? { ...defaults, demZoom: 11, shade: 42, strength: 100, palette: 'warm' }
    : settings;
  const dem = reference ? refDem : labDem;
  for (const layer of map.getStyle().layers || []) {
    try {
      if (layer.type === 'background')
        map.setPaintProperty(layer.id, 'background-color', '#eeeade');
    } catch (e) {}
  }
  if (!dem) {
    diagnostic(
      'Basemap loaded; terrain unavailable',
      'Contour library did not load. Check network access to external scripts.',
      true
    );
    return;
  }
  const firstSymbol = map.getStyle().layers.find(x => x.type === 'symbol')?.id;
  map.addSource('ss-dem', {
    type: 'raster-dem',
    tiles: [dem.sharedDemProtocolUrl],
    encoding: 'terrarium',
    tileSize: 512,
    maxzoom: conf.demZoom,
  });
  map.addLayer(
    {
      id: 'ss-hillshade',
      type: 'hillshade',
      source: 'ss-dem',
      paint: {
        'hillshade-shadow-color': '#524d39',
        'hillshade-highlight-color': '#fffdf2',
        'hillshade-exaggeration': conf.shade / 100,
      },
    },
    firstSymbol
  );
  map.addSource('ss-contours', {
    type: 'vector',
    tiles: [
      dem.contourProtocolUrl({
        thresholds: thresholds(conf.interval, conf.major, reference),
        contourLayer: 'contours',
        elevationKey: 'ele',
        levelKey: 'level',
        extent: 4096,
        buffer: 1,
      }),
    ],
    maxzoom: 16,
  });
  map.addLayer(
    {
      id: 'ss-lines',
      type: 'line',
      source: 'ss-contours',
      'source-layer': 'contours',
      minzoom: 9.5,
      paint: {
        'line-color': reference ? '#b46d43' : colour(),
        'line-opacity': reference
          ? 0.68
          : Math.min(1, conf.strength / 145 + 0.18),
        'line-width': [
          'match',
          ['get', 'level'],
          1,
          reference ? 1.05 : conf.strength / 80,
          reference ? 0.48 : conf.strength / 150,
        ],
      },
    },
    firstSymbol
  );
  // Subordinate intermediate heights; MapLibre suppresses those whose
  // text collides on tightly spaced contours. No per-frame JS computations.
  if (!reference) {
    map.addLayer({
      id:'ss-intermediate-heights',type:'symbol',source:'ss-contours',
      'source-layer':'contours',minzoom:13.6,
      filter:['all',['==',['get','level'],0],
        ['==',['%', ['to-number',['get','ele'],0],20],0]],
      layout:{
        'symbol-placement':'line','symbol-spacing':490,
        'text-field':['to-string',['get','ele']],
        'text-font':['Noto Sans Regular'],
        'text-size':['interpolate',['linear'],['zoom'],13.6,9,16,10.5],
        'text-rotation-alignment':'map',
        'text-max-angle':30,'text-padding':17,
        'text-allow-overlap':false
      },
      paint:{'text-color':'#78716a','text-opacity':.63,
        'text-halo-color':'#fcfaf3','text-halo-width':.45}
    });
  }
  // 50 metre index contours remain readable, but thin and subtle.
  map.addLayer({
    id:'ss-labels',type:'symbol',source:'ss-contours',
    'source-layer':'contours',minzoom:10.5,
    filter:['>', ['get','level'],0],
    layout:{
      'symbol-placement':'line','symbol-spacing':350,
      'text-field':['to-string',['get','ele']],
      'text-font':['Noto Sans Regular'],
      'text-size':['interpolate',['linear'],['zoom'],10.5,10,14,11.4,16,12],
      'text-rotation-alignment':'map','text-max-angle':38,
      'text-padding':12,'text-allow-overlap':false
    },
    paint:{
      'text-color':reference?'#966a55':'#61564d',
      'text-opacity':.78,
      'text-halo-color':'#faf8f0',
      'text-halo-width':.65
    }
  });
  map.moveLayer('ss-labels');
  if (!reference) {
    const source = Object.entries(map.getStyle().sources || {}).find(
      ([name, s]) => s.type === 'vector' && name !== 'ss-contours'
    )?.[0];
    if (source) {
      experimentVectorSource = source;
      // The base mountain labels can mask the elevation line in our own
      // formatted names. Use one consistent topographic hill-label layer.
      for(const layer of map.getStyle().layers||[]){
        if(layer.type==='symbol'&&layer.source===source&&
           layer['source-layer']==='mountain_peak'&&!layer.id.startsWith('ss-'))
          map.setLayoutProperty(layer.id,'visibility','none');
      }
      addGroundPatterns(map, source, firstSymbol);
      addR5Terrain(map, source, firstSymbol);
      addAccessPaths(map,source,firstSymbol);
      addDetailedPathSource(map);
      for (const spec of [
        {
          id: 'ss-burnnames',
          layer: 'waterway',
          placement: 'line',
          zoom: 12,
          color: '#26709b',
        },
        {
          id: 'ss-peaknames',
          layer: 'mountain_peak',
          placement: 'point',
          zoom: 11,
          color: '#67523b',
        },
      ]) {
        map.addLayer(
          {
            id: spec.id,
            type: 'symbol',
            source,
            'source-layer': spec.layer,
            minzoom: spec.zoom,
            filter: ['has', 'name'],
            layout: {
              'symbol-placement': spec.placement,
              'text-field': spec.id==='ss-peaknames'?hillNameAndHeight():['get','name'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 11,
              'text-padding': 5,
            },
            paint: {
              'text-color': spec.color,
              'text-halo-color': '#fffff3',
              'text-halo-width': 1.4,
            },
          },
          firstSymbol
        );
      }
    }
    if(source)addR6NameLayers(map,source);
    if(source)addNamedWater(map,source);
    if(source)addGroundInformationLayers(map);
    addStaticHillLabels(map);
    updatePaint();
  }
}
function updatePaint() {
  if (!lab || !labReady) return;
  const patch = [
    ['ss-hillshade', settings.shadeOn],
    ['ss-lines', settings.contoursOn],
    ['ss-labels', settings.contoursOn && settings.labelsOn],
    ['ss-intermediate-heights', settings.contoursOn && settings.labelsOn],
    ['ss-burnnames', settings.namesOn],
    ['ss-peaknames', settings.namesOn],
    ['ss-verified-hill-label', settings.namesOn],
    ['ss-locality-labels', settings.namesOn],
    ['ss-region-hill-labels',settings.namesOn],
    ['ss-osm-hill-names', settings.namesOn && settings.moreNamesOn],
    ['ss-osm-burn-names', settings.namesOn && settings.moreNamesOn],
    ['ss-loch-names',settings.namesOn&&settings.lochNamesOn],
    ['ss-waterfall-tile-names',settings.waterfallsOn],
    ['ss-waterfall-circle', settings.waterfallsOn],
    ['ss-waterfall-name', settings.waterfallsOn],
    ['ss-contour-tag-labels', settings.contoursOn && settings.labelsOn],
    ['ss-bog-glyphs', settings.bogOn],
    ['ss-forest-glyphs', settings.forestOn],
    ['ss-wood-extent', settings.woodBoundsOn],
    ['ss-wood-boundary', settings.woodBoundsOn],
    ['ss-rock-marks', settings.rocksOn],
    ['ss-scree-marks', settings.rocksOn],
    ['ss-cliff-traces', settings.cliffsOn],
    ['ss-water-detail', settings.waterwaysOn],
    ['ss-water-intermittent', settings.waterwaysOn],
    ['ss-footpath-casing',settings.footpathsOn],
    ['ss-footpaths',settings.footpathsOn],
    ['ss-cycle-casing',settings.cyclewaysOn],
    ['ss-cycleways',settings.cyclewaysOn],
    ['ss-estate-casing',settings.tracksOn],
    ['ss-estate-tracks',settings.tracksOn],
    ['ss-service-casing',settings.serviceTracksOn],
    ['ss-service-tracks',settings.serviceTracksOn],
    ['ss-ford-crossings',settings.footpathsOn||settings.tracksOn],
    ['ss-detailed-foot-border',settings.footpathsOn],
    ['ss-detailed-foot',settings.footpathsOn],
    ['ss-detailed-cycle-border',settings.cyclewaysOn],
    ['ss-detailed-cycle',settings.cyclewaysOn],
    ['ss-detailed-estate-border',settings.tracksOn],
    ['ss-detailed-estate',settings.tracksOn],
    ['ss-detailed-service-border',settings.serviceTracksOn],
    ['ss-detailed-service',settings.serviceTracksOn],
    ['ss-spot-elevations', settings.spotHeightsOn],
  ];
  for (const [id, on] of patch)
    if (lab.getLayer(id))
      lab.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (lab.hasImage('ss-bog-pattern')) lab.updateImage('ss-bog-pattern', groundPattern('bog', settings.bogSize));
  if (lab.hasImage('ss-forest-pattern')) lab.updateImage('ss-forest-pattern', groundPattern('forest', settings.forestSize));
  if (lab.getLayer('ss-hillshade'))
    lab.setPaintProperty(
      'ss-hillshade',
      'hillshade-exaggeration',
      settings.shade / 100
    );
  if (lab.getLayer('ss-lines')) {
    lab.setPaintProperty('ss-lines', 'line-color', colour());
    lab.setPaintProperty('ss-lines', 'line-width', [
      'match',
      ['get', 'level'],
      1,
      settings.strength / 80,
      settings.strength / 150,
    ]);
    lab.setPaintProperty(
      'ss-lines',
      'line-opacity',
      Math.min(1, settings.strength / 145 + 0.18)
    );
  }
}
function pin(map) {
  const p = getCentre(),
    element = document.createElement('div');
  element.className = 'pin';
  element.innerHTML =
    '<span class="triangle">▲</span><span class="pinLabel"></span>';
  element.querySelector('.pinLabel').textContent = p.name;
  const sub = document.createElement('small');
  sub.textContent = p.sub;
  element.querySelector('.pinLabel').appendChild(sub);
  markers.push(
    new ml.Marker({ element, anchor: 'left' })
      .setLngLat([p.lng, p.lat])
      .addTo(map)
  );
}
function replacePins() {
  for (const m of markers) m.remove();
  markers = [];
  if (ref) pin(ref);
  if (lab) pin(lab);
}
function setMode(m) {
  mode = m;
  const split =
    m === 'reference' ? 100 : m === 'experiment' ? 0 : Number($('split').value);
  $('testMap').style.clipPath = 'inset(0 0 0 ' + split + '%)';
  $('splitbar').style.left = split + '%';
  $('split').hidden = m !== 'compare';
  $('splitbar').hidden = m !== 'compare';
  for (const [id, key] of [
    ['modeCompare', 'compare'],
    ['modeReference', 'reference'],
    ['modeExperiment', 'experiment'],
  ])
    $(id).classList.toggle('active', m === key);
}
// R7.1: one interactive map owns gestures. The experiment only follows that
// camera; throttling prevents two WebGL renderers fighting for mobile frames.
function syncCamera(final = false) {
  if (!ref || !lab) return;
  const now = Date.now();
  if (!final && (cameraBusy || now - lastCameraSync < 85)) return;
  lastCameraSync = now;
  const update = () => {
    try {
      if (!ref || !lab) return;
      const c = ref.getCenter();
      const t = lab.getCenter();
      const z = ref.getZoom();
      if (Math.abs(c.lng - t.lng) < 0.0000002 &&
          Math.abs(c.lat - t.lat) < 0.0000002 &&
          Math.abs(z - lab.getZoom()) < 0.0001 &&
          Math.abs(ref.getBearing() - lab.getBearing()) < 0.01 &&
          Math.abs(ref.getPitch() - lab.getPitch()) < 0.01) return;
      lab.jumpTo({
        center: [c.lng, c.lat],
        zoom: z,
        bearing: ref.getBearing(),
        pitch: ref.getPitch(),
      });
    } catch (e) {
      // A map may have been replaced while its frame was pending.
    } finally {
      cameraBusy = false;
    }
  };
  if (final) {
    update();
  } else {
    cameraBusy = true;
    requestAnimationFrame(update);
  }
}
function checkReady() {
  if (refReady && labReady)
    diagnostic(
      'Maps loaded ✓',
      'Both maps are loaded. Experiment DEM z' +
        settings.demZoom +
        '. These are online datasets, not the Android offline archive.'
    );
}
function handleError(kind, map, event) {
  const message = String(event?.error?.message || 'Unknown map source error');
  if (kind === 'experiment' && map !== lab) return;
  if (
    kind === 'experiment' &&
    settings.demZoom > 12 &&
    !fallingBack &&
    /404/.test(message) &&
    /mapterhorn|terrain|\d+\/\d+\/\d+/.test(message)
  ) {
    fallingBack = true;
    settings.demZoom = 12;
    syncControls();
    diagnostic(
      'Terrain z13 unavailable',
      'Automatically falling back to zoom 12.',
      true
    );
    setTimeout(() => {
      fallingBack = false;
      buildExperiment();
    }, 250);
    return;
  }
  visibleError = message;
  diagnostic('Map resource warning', message.slice(0, 170), true);
}
function createMap(kind) {
  const reference = kind === 'reference',
    p = getCentre(),
    current = ref?.getCenter();
  const map = new ml.Map({
    container: reference ? 'refMap' : 'testMap',
    style: BASE,
    center: current ? [current.lng, current.lat] : [p.lng, p.lat],
    zoom: ref ? ref.getZoom() : p.zoom,
    minZoom: 4,
    maxZoom: 18,
    maxBounds: [
      [-8.9, 54.45],
      [-0.35, 61],
    ],
    interactive: reference,
    attributionControl: false,
    renderWorldCopies: false,
    fadeDuration: 0,
    reduceMotion: true,
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
    // Use supported MapLibre drag-pan defaults. Zero linearity may produce
    // unstable gesture handling on mobile Chromium.
    dragPan: reference,
  });
  if (reference) {
    ref = map;
    map.addControl(
      new ml.ScaleControl({ maxWidth: 125, unit: 'metric' }),
      'bottom-right'
    );
    if (map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') {
      map.touchZoomRotate.disableRotation();
    }
    map.on('move', () => syncCamera(false));
    map.on('moveend', () => {
      syncCamera(true);
      queueContourLabels(lab);
      scheduleDetailedPaths();
    });
  } else lab = map;
  map.on('error', e => handleError(kind, map, e));
  map.once('load', () => {
    if (!reference && lab !== map) return;
    try {
      addStyle(map, reference);
      if (reference) refReady = true;
      else {
        labReady = true;
        updatePaint();
      }
      replacePins();
      checkReady();
      if(!reference){queueContourLabels(map);scheduleDetailedPaths();loadStaticHills();}
    } catch (e) {
      diagnostic('Map style error', String(e.message), true);
      visibleError = String(e.message);
    }
  });
  return map;
}
function buildExperiment() {
  if (!ref) return;
  ++generation;
  labReady = false;
  if (lab) {
    lab.remove();
    lab = null;
  }
  experimentVectorSource = null;
  clearTimeout(pathFetchTimer);
  pathLoadedArea=null;
  lastContourSignature='';
  if(nameRequest)nameRequest.abort();
  lastNameCentre=null;
  diagnostic(
    'Rebuilding experiment…',
    'Updating terrain sampling and contour intervals.'
  );
  labDem = newDEM(settings.demZoom);
  createMap('experiment');
}
function jump() {
  area = $('location').value;
  const p = getCentre();
  // Explicit place selection is the only automatic camera relocation.
  // Never animate across mountains after a location change.
  if (ref) ref.jumpTo({ center: [p.lng, p.lat], zoom: p.zoom });
  replacePins();
  diagnostic(
    'Selected ' + p.name,
    'Test geography changed. Both maps are synchronised.'
  );
}
function inspect() {
  if (!labReady) {
    $('inspection').textContent =
      'Map not ready: source inspection requires loaded vector tiles.';
    return;
  }
  const feats = lab
    .queryRenderedFeatures()
    .filter(f => f.source !== 'ss-contours');
  const names = [
    ...new Set(feats.map(f => f.properties?.name).filter(Boolean)),
  ];
  $('inspection').textContent =
    'Visible features: ' +
    feats.length +
    ' · Named features: ' +
    names.length +
    '\n' +
    (names.slice(0, 18).join(' · ') ||
      'No names visible at this zoom. This does not prove absent source data.');
}
function exportSettings() {
  const data = {
    version: 'RC18.118 Map Lab R8.1',
    location: area,
    experiment: settings,
    reference: 'RC18.117 contour thresholds / DEM z11 style parameters',
    warning:
      'Browser uses OpenFreeMap and Mapterhorn, not verified Android downloaded tiles',
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'ScotlandsSummits_MapLab_R8_1_settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function copyTestURL() {
  const url = new URL(location.href);
  url.searchParams.set('area', area);
  for (const [key, val] of Object.entries(settings))
    url.searchParams.set(key, String(val));
  navigator.clipboard
    .writeText(url.href)
    .then(() => {
      $('inspection').textContent =
        'Copied test URL including all map settings.';
    })
    .catch(() => {
      $('inspection').textContent =
        'Copy unavailable. Settings can be saved using Export settings.';
    });
}
function openPanel(show) {
  const p = $('controls'),
    value = show === undefined ? !p.classList.contains('open') : show;
  p.classList.toggle('open', value);
  $('controlsToggle').setAttribute('aria-expanded', String(value));
}
function init() {
  syncControls();
  setMode('compare');
  for (const id of controlIDs) $(id).addEventListener('input', readControl);
  $('split').addEventListener('input', () => setMode('compare'));
  $('modeCompare').onclick = () => setMode('compare');
  $('modeReference').onclick = () => setMode('reference');
  $('modeExperiment').onclick = () => setMode('experiment');
  $('location').onchange = jump;
  $('controlsToggle').onclick = () => openPanel();
  $('controlsClose').onclick = () => openPanel(false);
  $('inspect').onclick = inspectCoverage;
  $('fetchPaths').onclick=()=>fetchDetailedPaths(true);
  $('fetchNames').onclick = () => {
    lastNameTime = 0;
    lastNameCentre = null;
    loadNames();
  };
  $('export').onclick = exportSettings;
  $('copy').onclick = copyTestURL;
  $('guidance').onclick = () => {
    $('inspection').textContent =
      'This HTML is an online development tool. It requires HTTPS and an internet connection; genuine offline terrain remains in the Android pack. Never use this prototype for navigation.';
  };
  $('reset').onclick = () => {
    settings = { ...defaults };
    syncControls();
    area = 'chlamain';
    $('location').value = area;
    setMode('compare');
    jump();
    buildExperiment();
  };
  $('retry').onclick = reload;
  try {
    const query = new URLSearchParams(location.search);
    if (points[query.get('area')]) {
      area = query.get('area');
      $('location').value = area;
    }
    for (const id of controlIDs)
      if (query.has(id)) {
        const v = query.get(id);
        if (typeof defaults[id] === 'boolean') settings[id] = v === 'true';
        else if (typeof defaults[id] === 'number')
          settings[id] = Number(v) || defaults[id];
        else if (id === 'palette' && ['warm', 'dark', 'copper'].includes(v))
          settings[id] = v;
      }
    syncControls();
  } catch (e) {}
  if (!ml) {
    setFallback(
      'The MapLibre JavaScript library did not load. Check your internet connection and reload the HTTPS page.'
    );
    return;
  }
  diagnostic(
    'Loading map services…',
    'OpenFreeMap vector tiles and Mapterhorn elevation are loading.'
  );
  try {
    refDem = newDEM(11);
    labDem = newDEM(settings.demZoom);
    createMap('reference');
    createMap('experiment');
  } catch (e) {
    setFallback(String(e.message));
  }
  setTimeout(() => {
    if (!refReady && !labReady && !visibleError)
      setFallback(
        'The map did not finish loading. Reload the HTTPS page and check internet access to map tile providers.'
      );
  }, 16000);
}
window.addEventListener('load', init, { once: true });
