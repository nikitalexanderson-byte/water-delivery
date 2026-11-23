/* Shared, local renderer. The host supplies only the routes its signed-in user may read. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const colors=['#16766c','#3865ba','#a55423','#7754a9','#926719','#337f99'];
  const darkColors=['#126a60','#3259ac','#974c1b','#704e9d','#805809','#286e89'];
  const hasPoint=p=>p && Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  let data=null,map,layers,mode,chosenMode=null,sceneKey='',focusKey='',currentBounds=[],pins=new Map(),tileError=false;
  let positionLayers,pickerLayers,streetTiles,roadLayers,roadBounds=[],roadKey='',followExtent=true;
  const roadAttribution='Маршруты © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  let creditedRoads=false;
  // Extent of the bundled regional overview, independent of the configured depot.
  const overviewBounds=[[55.34,37.15],[55.93,37.96]];
  const actionKeys=['geo','scheme'];
  const txt=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
  function fit(){
    if(data.picker && hasPoint(data.picked)){
      map.setView([data.picked.lat,data.picked.lon],16,{animate:false});
    }else if(currentBounds.length||roadBounds.length){
      map.fitBounds(L.latLngBounds([...currentBounds,...roadBounds]),{padding:[36,32],maxZoom:mode==='geo'?16:2,animate:false});
    }else if(mode==='geo'){
      if(hasPoint(data.location))centreLocation();
      else map.fitBounds(overviewBounds,{padding:[8,8],animate:false});
    }
  }
  function centreLocation(){
    const {lat,lon,accuracy}=data.location;
    const location=L.latLng(lat,lon);
    if(Number.isFinite(accuracy)&&accuracy>40){
      map.fitBounds(location.toBounds(accuracy*2),{padding:[22,22],maxZoom:17,animate:false});
    }else map.setView(location,17,{animate:false});
  }
  function drawLocation(){
    positionLayers.clearLayers();
    if(mode!=='geo'||!hasPoint(data.location))return;
    const {lat,lon,accuracy}=data.location, point=[lat,lon];
    if(Number.isFinite(accuracy)&&accuracy>0){
      L.circle(point,{radius:accuracy,interactive:false,color:'#146dc6',weight:1,fillOpacity:.11}).addTo(positionLayers);
    }
    const title='Моё местоположение'+(Number.isFinite(accuracy)?' · точность '+Math.round(accuracy)+' м':'');
    L.marker(point,{title,alt:title,zIndexOffset:220,icon:L.divIcon({className:'location-pin',iconSize:[18,18],iconAnchor:[9,9]})})
      .bindTooltip(()=>txt('span',title)).addTo(positionLayers);
  }
  function drawPicked(){
    pickerLayers.clearLayers();
    if(!data.picker||!hasPoint(data.picked))return;
    L.marker([data.picked.lat,data.picked.lon],{title:'Точка доставки',alt:'Точка доставки',
      icon:L.divIcon({className:'picked-pin',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(pickerLayers);
  }
  function pick(locationOnMap){
    if(!data?.picker||window.parent===window)return;
    const {lat,lng}=locationOnMap.wrap();
    window.parent.postMessage({type:'farvater:pick',lat,lon:lng},location.origin);
  }
  function popup(trip,stop){
    const root=document.createElement('div');
    const detail=txt('p','');
    detail.append(txt('strong',stop.water+' бут.','measure'),' · '+stop.name);
    root.append(txt('p',trip.label+' · точка '+stop.position,'route-caption'),txt('strong',stop.address),detail);
    if(stop.phone && /^[+0-9 ()-]+$/.test(stop.phone)){
      const link=txt('a',stop.phone);link.href='tel:'+stop.phone.replace(/[^+0-9]/g,'');root.append(link);
    }
    return root;
  }
  function line(points,color,emphasis,roadId){
    if(points.length<2)return;
    const pane={interactive:false,smoothFactor:1};
    const weight=emphasis?5:3;
    const group=roadId==null?layers:roadLayers;
    L.polyline(points,{...pane,color:data.theme==='dark'?'#152630':'white',weight:weight+3,opacity:.9}).addTo(group);
    const path=L.polyline(points,{...pane,color,weight,opacity:emphasis ? 0.96 : 0.72,
      className:roadId==null?'schematic-line':'road-line'}).addTo(group);
    if(roadId!=null)path.getElement().dataset.tripId=String(roadId);
  }
  function drawRoads(){
    roadLayers.clearLayers();roadBounds=[];
    if(mode!=='geo')return;
    const palette=data.theme==='dark'?darkColors:colors;
    const ordered=data.trips.map((trip,i)=>({trip,i})).sort((a,b)=>Number(a.trip.id===data.activeTripId)-Number(b.trip.id===data.activeTripId));
    for(const {trip,i} of ordered){
      const result=data.roads?.[trip.id];
      if(result?.status!=='ready'||result.geometry?.type!=='LineString')continue;
      const coords=result.geometry.coordinates;
      if(!Array.isArray(coords)||coords.length<2||!coords.every(pair=>Array.isArray(pair)&&hasPoint({lon:pair[0],lat:pair[1]})))continue;
      const path=coords.map(([lon,lat])=>[lat,lon]);
      const bounds=L.latLngBounds(path);
      roadBounds.push(bounds.getSouthWest(),bounds.getNorthEast());
      line(path,palette[Math.abs(trip.colorIndex??i)%palette.length],data.trips.length===1||trip.id===data.activeTripId,trip.id);
    }
    if(creditedRoads!==Boolean(roadBounds.length)){
      creditedRoads=Boolean(roadBounds.length);
      if(creditedRoads)map.attributionControl.addAttribution(roadAttribution);
      else map.attributionControl.removeAttribution(roadAttribution);
    }
  }
  function pin(point,trip,stop,color,emphasis){
    const label=trip.label+', точка '+stop.position+', '+stop.address;
    const marker=L.marker(point,{title:label,alt:label,riseOnHover:true,zIndexOffset:emphasis?150:0,
      icon:L.divIcon({className:'stop-icon',iconSize:[32,32],iconAnchor:[16,16],html:txt('span',String(stop.position))})}).addTo(layers);
    marker.getElement().style.backgroundColor=color;
    marker.bindPopup(()=>popup(trip,stop),{maxWidth:250});
    marker.on('click',()=>{
      if(window.parent!==window)window.parent.postMessage({type:'farvater:stop',tripId:trip.id,id:stop.id},location.origin);
    });
    pins.set(String(stop.id),marker);
  }
  function showBase(point){
    const label=data.base?.label||'Производственная база';
    L.marker(point,{title:label,alt:label,zIndexOffset:100,icon:L.divIcon({className:'base-icon',iconSize:[42,29],
      iconAnchor:[21,15],html:txt('span','База')})}).bindPopup(()=>txt('strong',label)).addTo(layers);
    currentBounds.push(point);
  }
  function drawTrips(){
    currentBounds=[];pins=new Map();layers.clearLayers();
    const trips=data.trips;
    const base=mode==='geo'?(hasPoint(data.base)?[data.base.lat,data.base.lon]:null):[0,0];
    // Paint the active trip last so an overlapping line remains discernible.
    const ordered=[...trips.entries()].sort(([,a],[,b])=>Number(a.id===data.activeTripId)-Number(b.id===data.activeTripId));
    for(const [i,trip] of ordered){
      const emphasis=trips.length===1||trip.id===data.activeTripId;
      const palette=data.theme==='dark'?darkColors:colors;
      const color=palette[Math.abs(trip.colorIndex??i)%palette.length];
      const segment=mode==='scheme'?[base]:[];
      const row=(trips.length-1-2*i)*43;
      for(const [j,stop] of trip.stops.entries()){
        const point=mode==='geo'?(hasPoint(stop)?[stop.lat,stop.lon]:null):[row,75+62*j];
        if(!point)continue;
        currentBounds.push(point);pin(point,trip,stop,color,emphasis);
        if(mode==='scheme')segment.push(point);
      }
      if(mode==='scheme'&&trip.stops.length){
        const end=segment.at(-1);
        segment.push([end[0]-23,end[1]+20],[row-23,26]);currentBounds.push(segment[segment.length-2]);
        segment.push(base);
        line(segment,color,emphasis);
      }
    }
    if(base && (trips.length||mode==='geo'))showBase(base);
  }
  function backdrop(){
    if(mode!=='geo')return;
    const dark=data.theme==='dark';
    if(window.FarvaterOverview){
      const styles={urban:{color:dark?'#263d49':'#e4eae5',fillOpacity:1,weight:0},
        roads:{color:dark?'#526067':'#c8c7b5',weight:1.5,opacity:.9},
        rivers:{color:dark?'#397583':'#92bfc8',weight:3,opacity:.9}};
      map.createPane('overview').style.zIndex=180;
      for(const kind of ['urban','rivers','roads']){
        L.geoJSON(window.FarvaterOverview[kind],{pane:'overview',interactive:false,style:styles[kind]}).addTo(map);
      }
    }
    if(data.tilesEnabled){
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,referrerPolicy:'strict-origin-when-cross-origin',
        attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'});
      // An unavailable tile reveals the local vector layer beneath it. Other tiles keep loading.
      tiles.on('loading',()=>{tileError=false;caption();});
      tiles.on('tileerror',()=>{tileError=true;caption();});
      streetTiles=tiles.addTo(map);
    }
  }
  function caption(){
    if(!data)return;
    const stops=data.trips.flatMap(t=>t.stops),unknown=stops.filter(s=>!hasPoint(s)).length;
    const notes=[];
    if(data.picker)notes.push('Нажмите на карту в месте доставки или переместите карту и выберите её центр');
    else if(mode==='scheme'){
      notes.push('Схема последовательности · без масштаба');
      const selected=stops.find(s=>s.id===data.focusedStopId);
      if(selected&&!hasPoint(selected))notes.push('у выбранной точки нет координат');
    }
    else{
      if(stops.length)notes.push(data.trips.some(t=>data.roads?.[t.id]?.status==='ready')?'Автомобильный маршрут · без текущих пробок':'Остановки рейсов');
      else if(!hasPoint(data.location)&&!hasPoint(data.base))notes.push('Обзор Московского региона');
      if(!hasPoint(data.base))notes.push('координаты базы не заданы');
      if(unknown)notes.push('без координат: '+unknown);
    }
    if(mode==='geo'&&(!data.tilesEnabled||tileError)){
      if(tileError)notes.push('часть уличной карты не загрузилась');
      notes.push('локальная подложка Московского региона · Natural Earth');
    }
    $('retry').hidden=!tileError;
    $('caption').textContent=notes.join(' · ');
  }
  function mount(next){
    if(map)map.remove();
    mode=next;tileError=false;streetTiles=null;roadBounds=[];roadKey='';creditedRoads=false;
    map=L.map('canvas',{crs:next==='geo'?L.CRS.EPSG3857:L.CRS.Simple,zoomControl:false,attributionControl:next==='geo',
      minZoom:next==='geo'?1:-6,maxZoom:next==='geo'?19:4,zoomSnap:.25,zoomDelta:1,preferCanvas:false,
      scrollWheelZoom:true,worldCopyJump:false});
    if(map.attributionControl)map.attributionControl.setPrefix(false);
    L.control.zoom({position:'bottomright',zoomInTitle:'Приблизить',zoomOutTitle:'Отдалить'}).addTo(map);
    roadLayers=L.layerGroup().addTo(map);layers=L.layerGroup().addTo(map);
    positionLayers=L.layerGroup().addTo(map);pickerLayers=L.layerGroup().addTo(map);
    map.on('click',e=>pick(e.latlng));
  }
  function render(next,force=false){
    if(!next || !Array.isArray(next.trips))return;
    const prev=data;data=next;
    document.documentElement.dataset.theme=data.theme;
    const stops=data.trips.flatMap(t=>t.stops);
    const focus=String(next.focusedStopId??'');
    const selectionChanged=focus!==focusKey||next.focusRequest!==prev?.focusRequest;
    if(!force && focus && selectionChanged && !hasPoint(stops.find(s=>String(s.id)===focus)))chosenMode='scheme';
    const locate=hasPoint(next.location)&&(!hasPoint(prev?.location)||next.locationRequest!==prev?.locationRequest);
    if(locate)chosenMode='geo';
    const desired=next.picker||!stops.length?'geo':chosenMode||'geo';
    $('scheme').disabled=!stops.length;
    $('modes').hidden=Boolean(data.picker);
    $('pick-centre').hidden=!data.picker;
    $('fit').hidden=Boolean(data.picker);
    for(const key of actionKeys)$(key).setAttribute('aria-pressed',String(key===desired));
    const recreated=!map||mode!==desired||prev?.theme!==next.theme||prev?.tilesEnabled!==next.tilesEnabled;
    if(recreated)mount(desired);
    // The caption can wrap on a phone and changes the height available to Leaflet.
    caption();
    map.invalidateSize({pan:false});
    const key=JSON.stringify([data.trips,data.base,mode]);
    const geometryChanged=recreated||key!==sceneKey;
    const redraw=geometryChanged||prev?.activeTripId!==next.activeTripId||force;
    if(redraw){
      // Leaflet prepares its panes and marker positions once the view has a centre.
      if(recreated){
        mode==='geo'?map.fitBounds(overviewBounds,{animate:false}):map.setView([0,0],0);
      }
      drawTrips();sceneKey=key;
    }
    const nextRoadKey=mode==='geo'?JSON.stringify(data.trips.map(t=>data.roads?.[t.id]?.geometry??null)):'';
    const roadsChanged=roadKey!==nextRoadKey;
    if(roadsChanged||redraw){drawRoads();roadKey=nextRoadKey;}
    if(geometryChanged||force){followExtent=true;fit();}
    else if(roadsChanged&&followExtent&&!focus)fit();
    if(recreated)backdrop();
    if(recreated||locate||prev?.location!==next.location)drawLocation();
    if(recreated||prev?.picked!==next.picked)drawPicked();
    if(data.picker&&hasPoint(data.picked)&&next.pickRequest!==prev?.pickRequest){
      map.setView([data.picked.lat,data.picked.lon],17,{animate:false});
    }
    if(focus && (selectionChanged||redraw)){
      const marker=pins.get(focus);
      if(marker){map.panTo(marker.getLatLng(),{animate:false});marker.openPopup();}
    }
    if(locate){followExtent=false;centreLocation();}
    focusKey=focus;
  }
  for(const key of actionKeys)$(key).onclick=()=>{chosenMode=key;render(data,true);};
  for(const event of ['pointerdown','wheel','keydown'])$('canvas').addEventListener(event,()=>{followExtent=false;},{passive:true});
  $('fit').onclick=()=>{followExtent=true;map?.closePopup();fit();};
  $('pick-centre').onclick=()=>pick(map.getCenter());
  $('retry').onclick=()=>streetTiles?.redraw();
  window.addEventListener('online',()=>{if(tileError)streetTiles?.redraw();});
  new ResizeObserver(()=>{if(map)map.invalidateSize({pan:false});}).observe($('canvas'));
  window.FarvaterMap={render};
})();
