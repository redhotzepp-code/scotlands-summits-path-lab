/* Scotland's Summits - static OSM route-data prototype.
   Intentionally makes ZERO Overpass requests during map use. */
const sourceGeoJSON='data/paths.geojson';
const manifestURL='data/manifest.json';
const points={
  chlamain:{center:[-3.779635,56.860974],zoom:12.8},
  tarf:{center:[-3.76274,56.88902],zoom:12.8},
  blair:{center:[-3.8585,56.766],zoom:12.8}
};
const CATEGORIES=['foot','estate','cycle','service'];
const BASE='https://tiles.openfreemap.org/styles/liberty';
const MAX_SCALE_BAR_PX=125;
// MapLibre metric scale uses rounded values; this is the Highland latitude
// threshold for the 125px control to first display a 1km bar.
function minZoomForOneKm(lat=57){
  return Math.log2(156543.03392804097*Math.cos(lat*Math.PI/180)*MAX_SCALE_BAR_PX/2000);
}
const showAt=minZoomForOneKm();
let map=null;let manifest=null;
function status(head,detail,warning=false){
  document.getElementById('statusHeading').textContent=head;
  document.getElementById('statusDetail').textContent=detail;
  document.getElementById('dataStatus').classList.toggle('warning',warning);
}
function tellScale(){
  if(!map)return;
  const zoom=map.getZoom();
  const label=zoom<showAt?'Paths hidden until the 1 km scale':'All paths eligible · detail increases on zoom';
  document.getElementById('zoomBox').textContent=label;
}
function addLayerSet(kind,stroke,casing,dashes){
  const filter=['==',['get','class'],kind];
  const below=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
  map.addLayer({id:`route-${kind}-casing`,type:'line',source:'verified-routes',minzoom:showAt,
    filter,layout:{'line-cap':'round','line-join':'round'},paint:{
      'line-color':casing,'line-opacity':.83,
      'line-width':['interpolate',['linear'],['zoom'],showAt,1.4,14,2.7,16,4.2]}},below);
  map.addLayer({id:`route-${kind}`,type:'line',source:'verified-routes',minzoom:showAt,
    filter,layout:{'line-cap':'round','line-join':'round'},paint:{
      'line-color':stroke,'line-opacity':['interpolate',['linear'],['zoom'],showAt,.84,14,1],
      'line-width':['interpolate',['linear'],['zoom'],showAt,.9,14,1.6,16,2.5],
      'line-dasharray':dashes}},below);
}
function updateVisibility(){
  for(const box of document.querySelectorAll('[data-kind]')){
    const kind=box.dataset.kind;
    for(const id of [`route-${kind}`,`route-${kind}-casing`]){
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',box.checked?'visible':'none');
    }
  }
  if(map.getLayer('shade'))map.setLayoutProperty('shade','visibility',document.getElementById('shadeToggle').checked?'visible':'none');
}
async function loadVerifiedData(){
  try{
    const [metaResp,geoResp]=await Promise.all([fetch(manifestURL,{cache:'no-store'}),fetch(sourceGeoJSON,{cache:'no-store'})]);
    if(!metaResp.ok||!geoResp.ok)throw new Error(`Static data fetch failed: ${metaResp.status} / ${geoResp.status}`);
    const meta=await metaResp.json(),geo=await geoResp.json();
    if(meta.status!=='ready'||geo.type!=='FeatureCollection'||!geo.features.length||meta.routes!==geo.features.length)
      throw new Error('No verified route dataset has been built. GitHub Action must complete before field testing.');
    manifest=meta;
    if(!map.getSource('verified-routes'))throw new Error('Map has not initialized route layers');
    map.getSource('verified-routes').setData(geo);
    const counts=meta.classes||{};
    const countText=CATEGORIES.map(c=>`${c}: ${counts[c]||0}`).join(' · ');
    status(`${meta.routes} mapped path segments ready`,
      `Real OSM data, prepared ${meta.date_utc.slice(0,10)}. ${countText}. No live path-data requests.`);
    document.getElementById('dataReport').textContent=[
      `Data: ${meta.status}`,
      `Segments: ${meta.routes}`,
      `Walking paths: ${counts.foot||0}`,
      `Estate tracks: ${counts.estate||0}`,
      `Cycleways: ${counts.cycle||0}`,
      `Service tracks: ${counts.service||0}`,
      `Built: ${meta.date_utc}`,
      `Source: ${meta.source}`,
      'All mapped path classes display from the same 1 km threshold.',
      'Unmapped routes and ground hazards may still exist.'
    ].join('\n');
  }catch(e){
    status('Verified path data not yet installed',e.message,true);
    document.getElementById('dataReport').textContent='NOT READY: '+e.message+'\nNo invented path geometry is being shown.';
  }
}
function init(){
  if(!window.maplibregl){status('MapLibre unavailable','Connect to the internet to load the map renderer.',true);return;}
  map=new maplibregl.Map({container:'map',style:BASE,center:points.chlamain.center,
    zoom:points.chlamain.zoom,maxZoom:18,minZoom:9,
    maxBounds:[[-4.2,56.62],[-3.38,57.16]],
    renderWorldCopies:false,dragRotate:false,pitchWithRotate:false,touchPitch:false,
    fadeDuration:0,attributionControl:true});
  if(map.touchZoomRotate?.disableRotation)map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.ScaleControl({maxWidth:MAX_SCALE_BAR_PX,unit:'metric'}),'bottom-right');
  map.on('zoom',tellScale);
  map.on('load',()=>{
    // Keep a single MapLibre map instead of the two-canvas comparison used in
    // the older browser lab. No repeated route-source workers or geometry scans.
    const firstLabel=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
    try{
      map.addSource('dem',{type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
        encoding:'terrarium',tileSize:512,maxzoom:12});
      map.addLayer({id:'shade',type:'hillshade',source:'dem',
        paint:{'hillshade-exaggeration':.4,'hillshade-shadow-color':'#524d39',
          'hillshade-highlight-color':'#fffdf2'}},firstLabel);
    }catch(e){console.warn('Hillshade unavailable; routes remain readable',e);}
    map.addSource('verified-routes',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    addLayerSet('foot','#564b42','#f8f3e5',[3,2]);
    addLayerSet('estate','#68573e','#faf0d7',[5,2]);
    addLayerSet('cycle','#217b7c','#f5fbf5',[3,1.5]);
    addLayerSet('service','#8a7864','#f8f3e5',[6,3]);
    for(const kind of CATEGORIES){
      map.on('click',`route-${kind}`,e=>{
        const f=e.features?.[0];if(!f)return;
        const props=f.properties||{};
        const node=document.createElement('div');
        const strong=document.createElement('strong');strong.textContent=props.name||props.highway||'Mapped route';node.append(strong);
        const detail=document.createElement('span');
        detail.textContent=`${props.highway||kind} · Surface: ${props.surface||'not recorded'} · Access: ${props.access_info==='restricted'?'restriction recorded':'not verified'}`;
        node.append(detail);
        new maplibregl.Popup({closeButton:true}).setLngLat(e.lngLat).setDOMContent(node).addTo(map);
      });
      map.on('mouseenter',`route-${kind}`,()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave',`route-${kind}`,()=>map.getCanvas().style.cursor='');
    }
    updateVisibility();tellScale();loadVerifiedData();
  });
  map.on('error', e=>{
    // A missing DEM/background tile is not a route-data failure.
    console.warn('Map resource warning:',e.error?.message||e);
  });
  document.querySelectorAll('.place').forEach(button=>button.addEventListener('click',()=>{
    const p=points[button.dataset.place];if(!p)return;
    document.querySelectorAll('.place').forEach(b=>b.classList.toggle('active',b===button));
    map.jumpTo({center:p.center,zoom:p.zoom});
  }));
  document.querySelectorAll('[data-kind]').forEach(el=>el.addEventListener('change',updateVisibility));
  document.getElementById('shadeToggle').addEventListener('change',updateVisibility);
  const panel=document.getElementById('panel'), toggle=document.getElementById('layersBtn');
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));});
  document.getElementById('closeBtn').addEventListener('click',()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');});
}
window.addEventListener('load',init,{once:true});