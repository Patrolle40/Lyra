(() => {
const $=id=>document.getElementById(id), audio=new Audio(); let url=null, duration=0, t=0, selected=0, raf=0, dragging=false, tapSync=false, autosave=true, history=[], future=[], audioFileName='', audioFileSize=0, playerLoopTimer=null;
const DB_NAME='lyra-db', DB_STORE='audio';
let currentId=null;
let nameManual=false;
const APP_VERSION='Lyra V1-3.13-0'; // naming: small update 1.02, 1.03 ... / bigger update 2.01, 3.01 ...
function baseName(n){return String(n||'').replace(/\.[^.]+$/,'')}
const PROJ='lyra-proj-', PREV='lyra-prev-', IDX='lyra-projects', CUR='lyra-current';
function audioKey(){return currentId?'p:'+currentId:'current'}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(DB_STORE))r.result.createObjectStore(DB_STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function idbOp(mode,fn){const db=await openDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,mode);const r=fn(tx.objectStore(DB_STORE));tx.oncomplete=()=>resolve(r?r.result:undefined);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
async function saveAudioFile(file,key=audioKey()){try{await idbOp('readwrite',st=>st.put(file,key))}catch(e){toast('Audio could not be persisted.')}}
async function loadAudioFile(key=audioKey()){try{return (await idbOp('readonly',st=>st.get(key)))||null}catch(e){return null}}
async function clearAudioFile(key=audioKey()){try{await idbOp('readwrite',st=>st.delete(key))}catch(e){}}
let colors=Array.from({length:256},(_,i)=>{const h=(i*137.508+17)%360; const s=58+((i*29)%30); const l=38+((i*47)%27); return `hsl(${h.toFixed(1)} ${s}% ${l}%)`;});
// Shuffle a large, deliberately distinct palette once so colors do not repeat in sequence.
for(let i=colors.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [colors[i],colors[j]]=[colors[j],colors[i]];}
let lines=[]; let waveformData=null, waveformFileKey='', edgeDrag=null;
function colorFor(i){return colors[i%colors.length]}
function darkColor(color){return 'color-mix(in srgb, '+color+' 68%, #151515)'}
function fmt(x){const totalMs=Math.max(0,Math.round((Number(x)||0)*1000));const m=Math.floor(totalMs/60000),s=Math.floor((totalMs%60000)/1000),ms=totalMs%1000;return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(ms).padStart(3,'0')}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function snapshot(){return JSON.stringify({song:$('song').value,artist:$('artist').value,lines,audioFileName,audioFileSize,nameManual});}
function restore(s){try{let x=JSON.parse(s);$('song').value=x.song||'';nameManual=x.nameManual!==undefined?!!x.nameManual:(!!String(x.song||'').trim()&&String(x.song||'').trim()!==baseName(x.audioFileName||''));$('artist').value=x.artist||'';lines=Array.isArray(x.lines)?x.lines:[];audioFileName=x.audioFileName||'';audioFileSize=Number(x.audioFileSize)||0;selected=Math.max(0,Math.min(selected,Math.max(0,lines.length-1)));render()}catch(e){}}
function saveHistory(){let s=snapshot();if(history[history.length-1]!==s){history.push(s);if(history.length>80)history.shift();future=[]}}
function undo(){if(history.length<2)return;let current=history.pop();future.push(current);restore(history[history.length-1]);toast('Undone.')}
function redo(){if(!future.length)return;let s=future.pop();history.push(s);restore(s);toast('Redone.')}
function toast(m){$('toast').textContent=m;clearTimeout(toast._t);toast._t=setTimeout(()=>{$('toast').textContent=''},2200)}
function getIndex(){try{const a=JSON.parse(localStorage.getItem(IDX)||'[]');return Array.isArray(a)?a:[]}catch(e){return[]}}
function setIndex(a){try{localStorage.setItem(IDX,JSON.stringify(a))}catch(e){}}

async function buildWaveform(file){
  waveformData=null; waveformFileKey=file.name+'|'+file.size+'|'+file.lastModified; drawWaveform();
  try{
    const C=window.AudioContext||window.webkitAudioContext; if(!C)return;
    const ctx=new C(); const buf=await file.arrayBuffer(); const decoded=await ctx.decodeAudioData(buf.slice(0));
    const samples=decoded.getChannelData(0); const count=Math.min(1400,Math.max(280,Math.floor(decoded.duration*70)));
    const step=Math.max(1,Math.floor(samples.length/count)); waveformData=new Float32Array(count);
    for(let i=0;i<count;i++){let sum=0;const end=Math.min(samples.length,(i+1)*step);for(let j=i*step;j<end;j+=Math.max(1,Math.floor(step/32)))sum=Math.max(sum,Math.abs(samples[j]));waveformData[i]=sum;}
    const max=Math.max(...waveformData)||1;for(let i=0;i<waveformData.length;i++)waveformData[i]/=max;
    await ctx.close(); drawWaveform();
  }catch(e){waveformData=null;drawWaveform();}
}
// Shared full-width time view for waveform, lyric segments, and pointer seeking.
let lyraZoom=1,lyraPinch=null,lyraPinchConsumed=false;
const LYRA_MAX_ZOOM=24;
const lyraActivePointers=new Map();
function lyraView(){
 const dur=Math.max(0.001,duration||0.001),span=dur/lyraZoom;
 const start=Math.max(0,Math.min(dur-span,t-span/2));
 return {dur,start,end:start+span,span};
}
function lyraTimeToX(time){
 const v=lyraView();return (time-v.start)/v.span;
}
function lyraXToTime(fraction){
 const v=lyraView();return v.start+fraction*v.span;
}
function lyraRenderMiniSegments(){
 const tl=$('timeline'),wave=$('waveform').parentElement;
 for(const container of [tl,wave]){
   container.querySelectorAll('.lyraZoomContext,.lyraZoomDivider,.lyraZoomInset').forEach(e=>e.remove());
   container.classList.toggle('lyraZoomed',lyraZoom>1.001);
 }
 $('lyraZoomLevel').textContent=Math.round(lyraZoom*100)+'%';
 $('lyraZoomReset').disabled=lyraZoom<=1.001;
 if(lyraZoom<=1.001)return;
 for(const container of [tl,wave]){
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
   svg.setAttribute('class','lyraZoomDivider');svg.setAttribute('viewBox','0 0 100 100');
   svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');
   path.setAttribute('d','M 1.5 0 L 1.5 100 M 98.5 0 L 98.5 100');
   svg.appendChild(path);container.appendChild(svg);
 }
}
function drawWaveform(){
 const c=$('waveform');if(!c)return;
 const dpr=Math.min(2,window.devicePixelRatio||1),r=c.getBoundingClientRect();
 const w=Math.max(1,Math.floor(r.width*dpr)),h=Math.max(1,Math.floor(r.height*dpr));
 if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
 const x=c.getContext('2d');x.clearRect(0,0,w,h);x.fillStyle='#252a33';x.fillRect(0,0,w,h);
 const v=lyraView(),center=h/2,maxH=h*.42;
 if(waveformData){
   for(let px=0;px<w;px++){
     const f=px/w,time=lyraXToTime(f),idx=Math.floor(time/v.dur*waveformData.length);
     if(idx<0||idx>=waveformData.length)continue;
     const nextTime=lyraXToTime(Math.min(1,(px+1)/w));
     const to=Math.min(waveformData.length-1,Math.ceil(nextTime/v.dur*waveformData.length));
     let amp=waveformData[idx]||0;
     for(let k=idx+1;k<=to;k++)amp=Math.max(amp,waveformData[k]||0);
     const hh=amp*maxH;
     x.fillStyle=time<=t?'#f4f5f7':'#68707d';
     x.fillRect(px,center-hh,1,Math.max(2,hh*2));
   }
 }
 const px=lyraTimeToX(t)*w;x.fillStyle='#8ab4ff';x.fillRect(Math.max(0,px-1),0,2,h);
}
function lyraZoomSet(value){
 const z=Math.max(1,Math.min(LYRA_MAX_ZOOM,value));
 if(Math.abs(z-lyraZoom)<.001)return;
 lyraZoom=z;draw();
}
function lyraGestureDistance(){const pts=[...lyraActivePointers.values()];return Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)}
function lyraHandlePinchDown(ev){
 if(ev.pointerType!=='touch')return;
 lyraActivePointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
 if(lyraActivePointers.size===2){lyraPinch={distance:Math.max(1,lyraGestureDistance()),zoom:lyraZoom};lyraPinchConsumed=true;dragging=false;edgeDrag=null;ev.preventDefault()}
}
function lyraHandlePinchMove(ev){
 if(!lyraActivePointers.has(ev.pointerId))return;
 lyraActivePointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
 if(lyraPinch&&lyraActivePointers.size>=2){lyraZoomSet(lyraPinch.zoom*lyraGestureDistance()/lyraPinch.distance);ev.preventDefault()}
}
function lyraHandlePinchUp(ev){
 lyraActivePointers.delete(ev.pointerId);
 if(lyraActivePointers.size<2){lyraPinch=null; if(!lyraActivePointers.size)requestAnimationFrame(()=>{lyraPinchConsumed=false})}
}

function setAudioFile(f,clearProject=true,persist=true){lyraZoom=1;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(f);audio.src=url;audio.load();audioFileName=f.name||'audio';audioFileSize=Number(f.size)||0;if(!nameManual)$('song').value=baseName(f.name);$('fileInfo').textContent=f.name+' · '+(f.size/1024/1024).toFixed(2)+' MB';if(clearProject){lines=[];selected=0;t=0;duration=0;saveHistory();autoSave();}audio.onloadedmetadata=()=>{duration=Number.isFinite(audio.duration)?audio.duration:0;t=0;audio.currentTime=0;['play','back','forward'].forEach(id=>$(id).disabled=false);draw();if(clearProject){markChange();}else{render();}}; buildWaveform(f); if(persist)saveAudioFile(f);render();}
function markChange(){saveHistory();autoSave()}
function parseTTMLTime(v){
  if(v==null||v==='')return null;
  v=String(v).trim();
  let m;
  if((m=v.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)$/)))return Number(m[1])*3600+Number(m[2])*60+Number(m[3].replace(',','.'));
  if((m=v.match(/^(\d+):(\d{1,2}(?:[.,]\d+)?)$/)))return Number(m[1])*60+Number(m[2].replace(',','.'));
  if((m=v.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/))){const n=Number(m[1]);return m[2]==='ms'?n/1000:m[2]==='s'?n:m[2]==='m'?n*60:n*3600}
  const n=Number(v);return Number.isFinite(n)?n:null;
}
async function importTTML(text,opts){
 const say=m=>{toast(m);if(opts&&opts.banner)showSaveToast({ok:false,text:'✗ '+m})};
 const sayOk=m=>{toast(m);if(opts&&opts.banner)showSaveToast({info:true,text:'✓ '+m})};
 if(!audio.src&&!(opts&&opts.allowNoAudio)){say('Import TTML erst möglich, wenn zuerst ein Song geladen wurde.');return}
 let xml;try{xml=new DOMParser().parseFromString(text,'application/xml')}catch(e){say('Could not read TTML.');return}
 if(xml.querySelector('parsererror')){say('Invalid XML/TTML.');return}
 let title=xml.getElementsByTagNameNS('*','title')[0]?.textContent?.trim()||'';
 let currentSong=$('song').value.trim();
 if(!(opts&&opts.skipTitleCheck)&&title&&currentSong&&title.toLowerCase()!==currentSong.toLowerCase()){
   const ok=await askDialog('The song name of the imported lyrics does not match the current song.\n\nLyrics: '+title+'\nCurrent song: '+currentSong+'\n\nImport anyway?','Import anyway','Cancel');
   if(!ok){say('Lyrics import cancelled.');return}
 }
 let ps=Array.from(xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml','p'));if(!ps.length)ps=Array.from(xml.getElementsByTagName('p'));
 let timing=(xml.documentElement.getAttribute('itunes:timing')||'Line').toLowerCase();
 let imported=[];
 let rawP=ps.map((p,i)=>({p,i,start:parseTTMLTime(p.getAttribute('begin')),end:parseTTMLTime(p.getAttribute('end')),dur:parseTTMLTime(p.getAttribute('dur'))}));
 rawP.forEach((o,k)=>{if(o.end==null&&o.start!=null){if(o.dur!=null)o.end=o.start+o.dur;else{const nx=rawP.slice(k+1).find(x=>x.start!=null);o.end=nx?nx.start:(duration>o.start?duration:o.start+3)}}});
 rawP.forEach(({p,i,start,end})=>{
   if(start==null||end==null||end<=start)return;
   let spans=Array.from(p.getElementsByTagNameNS('http://www.w3.org/ns/ttml','span')).filter(x=>x.hasAttribute('begin')&&x.hasAttribute('end'));
   if(!spans.length)spans=Array.from(p.getElementsByTagName('span')).filter(x=>x.hasAttribute('begin')&&x.hasAttribute('end'));
   let words=[];
   spans.forEach((sp,j)=>{
     let ws=parseTTMLTime(sp.getAttribute('begin')),we=parseTTMLTime(sp.getAttribute('end'));if(ws==null||we==null||we<=ws)return;
     let prev=sp.previousSibling;let sep=(prev&&prev.nodeType===3)?String(prev.nodeValue||'').match(/\s+$/)?.[0]||'':(j?' ':'');
     words.push({text:sp.textContent, start:ws, end:we, sepBefore:sep});
   });
   let textContent=p.textContent.replace(/\s+/g,' ').trim();
   let instrumental=/^[♪♫♩♬]$/.test(textContent);
   imported.push({name:'Line '+(i+1),text:instrumental?'':textContent,start,end,type:instrumental?'instrumental':'text',words});
 });
 if(!imported.length){say('No timed lyric lines found.');return}
 lines=imported;selected=0;markChange();render();
 sayOk(imported.length+' lines imported'+(timing==='word'?' with word/span timing.':'.'));
}
function detectGaps(){if(!duration||!lines.length)return toast('Add timed lines first.');let sorted=lines.map((l,i)=>({...l,_i:i})).filter(l=>l.start!=null&&l.end!=null).sort((a,b)=>a.start-b.start);let made=0;for(let i=0;i<sorted.length-1;i++){let a=sorted[i],b=sorted[i+1],gap=b.start-a.end;if(gap>=0.35){let line={name:'Instrumental '+(++made),text:'',start:a.end,end:b.start,type:'instrumental',origin:'generated',generated:true,words:[]};lines.push(line)}}if(made){markChange();render();toast(made+' instrumental gap(s) added.')}else toast('No significant gaps found.');}
function render(){
 $('lineBtns').innerHTML='';
 if(!lines.length){
   $('name').textContent='No line selected';
   $('timing').textContent='Start: — · End: —';
   $('lyrics').value=''; $('lyrics').disabled=true;
   $('type').classList.remove('on');$('type').setAttribute('aria-pressed','false'); $('startTime').value=''; $('endTime').value='';
   $('info').textContent='Press Set Start to create the first line.';
   $('start').disabled=!audio.src; $('finish').disabled=true;
   draw(); return;
 }
 lines.forEach((l,i)=>{let b=document.createElement('button');let overlap=lines.some((o,j)=>j!==i&&o.start!=null&&o.end!=null&&l.start!=null&&l.end!=null&&l.start<o.end&&l.end>o.start);b.className='lineBtn '+(i===selected?'active ':'')+(l.type==='instrumental'?'instrumentalBtn ':'')+(overlap?'overlap':'');b.style.borderColor='#fff';b.style.color='#fff';b.style.appearance='none';b.style.background=i===selected?colorFor(i):darkColor(colorFor(i));let label=document.createElement('span');label.textContent=l.name;b.appendChild(label);b.onclick=()=>{selected=i;render()};b.ondblclick=()=>rename(i);if(searchMatches.has(i))b.classList.add('searchHit');$('lineBtns').appendChild(b)});
 let l=lines[selected];$('name').textContent=l.name;$('timing').textContent='Start: '+(l.start==null?'—':fmt(l.start))+' · End: '+(l.end==null?'—':fmt(l.end));
 $('lyrics').value=l.type==='instrumental'?'♪':l.text;$('lyrics').disabled=!(l.start!=null&&l.end!=null);$('type').classList.toggle('on',l.type==='instrumental');$('type').setAttribute('aria-pressed',String(l.type==='instrumental'));$('startTime').value=l.start==null?'':Number(l.start).toFixed(3);$('endTime').value=l.end==null?'':Number(l.end).toFixed(3);$('lyrics').placeholder=l.start==null?'Set Start first...':l.end==null?'Set End first...':'Enter lyrics...';
 const hasAudio=!!audio.src;
 $('importTTMLBtn').disabled=!hasAudio; $('start').disabled=!hasAudio||(l.start!=null&&l.end==null);$('finish').disabled=!hasAudio||l.start==null||l.end!=null;
 $('info').textContent=l.start==null?'Set Start before the lyric begins.':l.end==null?'Start saved. Set End after the lyric finishes.':'Timing complete. Enter the lyrics now.';
 draw();
}
function draw(){
 $('segments').innerHTML='';
 lines.forEach((l,i)=>{if(l.start==null||l.end==null)return;let e=document.createElement('div');e.className='seg';e.style.pointerEvents='auto';e.style.cursor='pointer';e.dataset.index=i;e.onclick=(ev)=>{ev.stopPropagation();selected=i;render()};e.onpointerdown=(ev)=>{ev.stopPropagation();let rr=e.getBoundingClientRect(),nearLeft=ev.clientX-rr.left<12,nearRight=rr.right-ev.clientX<12;if(nearLeft||nearRight){edgeDrag={i,edge:nearLeft?'start':'end'};e.setPointerCapture?.(ev.pointerId);e.style.cursor='ew-resize'}};e.onpointermove=(ev)=>{if(!edgeDrag||edgeDrag.i!==i)return;let rr=$('timeline').getBoundingClientRect(),raw=Math.max(0,Math.min(duration,lyraXToTime((ev.clientX-rr.left)/rr.width))),v=snapTime(raw),line=lines[i];if(edgeDrag.edge==='start')line.start=Math.min(v,line.end-0.01);else line.end=Math.max(v,line.start+0.01);draw()};e.onpointerup=()=>{if(edgeDrag&&edgeDrag.i===i){edgeDrag=null;markChange();render()}};e.style.left=(lyraTimeToX(l.start)*100)+'%';e.style.width=((lyraTimeToX(l.end)-lyraTimeToX(l.start))*100)+'%';e.style.background=colorFor(i);e.textContent=i+1;if(l.type==='instrumental'){e.style.background='repeating-linear-gradient(135deg,'+colorFor(i)+' 0,'+colorFor(i)+' 5px,transparent 5px,transparent 10px)';e.style.border='1px dashed '+colorFor(i)}$('segments').appendChild(e)});
 $('head').style.left=(Math.max(0,Math.min(1,lyraTimeToX(t)))*100)+'%';$('clock').value=fmt(t);drawStartMarks();
 const lv=lyraView();$('mid').textContent=fmt(lyraZoom>1?lv.start+lv.span/2:duration/2).slice(0,5);$('end').textContent=fmt(lyraZoom>1?lv.end:duration).slice(0,5);if(lyraZoom>1)$('timeline').querySelector('.tl0').textContent=fmt(lv.start).slice(0,5);else $('timeline').querySelector('.tl0').textContent='00:00';lyraRenderMiniSegments(); drawWaveform();paintTimelineFilters();renderTimelineFilterPreview();
}

// V1-3.12-0: visual filters, independent from project data and export contents.
const TIMELINE_FILTER_STORAGE='lyra-timeline-filter-v1';
const timelineFilter={manualText:true,manualInstrumental:true,generatedText:true,generatedInstrumental:true,mode:'darken'};
try{
  const saved=JSON.parse(localStorage.getItem(TIMELINE_FILTER_STORAGE)||'null');
  if(saved&&typeof saved==='object'){
    for(const k of ['manualText','manualInstrumental','generatedText','generatedInstrumental'])if(typeof saved[k]==='boolean')timelineFilter[k]=saved[k];
    // Migrate the previous flat filters if the new group settings do not exist.
    if(typeof saved.manualText!=='boolean'&&typeof saved.text==='boolean')timelineFilter.manualText=saved.text;
    if(typeof saved.manualInstrumental!=='boolean'&&typeof saved.instrumental==='boolean')timelineFilter.manualInstrumental=saved.instrumental;
    if(typeof saved.generatedText!=='boolean'&&typeof saved.generated==='boolean')timelineFilter.generatedText=saved.generated;
    if(typeof saved.generatedInstrumental!=='boolean'&&typeof saved.generated==='boolean')timelineFilter.generatedInstrumental=saved.generated;
    if(saved.mode==='hide'||saved.mode==='darken')timelineFilter.mode=saved.mode;
  }
}catch(e){}
function timelineType(line){
  const generated=line.origin==='generated'||line.generated===true||line.type==='generated';
  const instrumental=line.type==='instrumental';
  return (generated?'generated':'manual')+(instrumental?'Instrumental':'Text');
}
function timelineLineEnabled(line){return !!timelineFilter[timelineType(line)]}
function persistTimelineFilters(){
  try{localStorage.setItem(TIMELINE_FILTER_STORAGE,JSON.stringify(timelineFilter))}catch(e){}
}
function paintTimelineFilters(){
  for(const id of ['segments','filterPreviewSegments']){
    const isPreview=id==='filterPreviewSegments';
    const holder=$(id);if(!holder)continue;
    if(!isPreview&&!holder.children.length)continue;
    for(const seg of holder.children){
      const line=lines[Number(seg.dataset.index)];if(!line)continue;
      const enabled=timelineLineEnabled(line);
      seg.classList.toggle('lyraFilterDimmed',!enabled);
      // Preview never hides lines, regardless of Hide / Darken selection.
      seg.style.display=(!isPreview&&!enabled&&timelineFilter.mode==='hide')?'none':'';
    }
  }
}
function refreshTimelineFilterControls(){
  for(const [id,key] of [['filterManualText','manualText'],['filterManualInstrumental','manualInstrumental'],['filterGeneratedText','generatedText'],['filterGeneratedInstrumental','generatedInstrumental']]){
    $(id).checked=timelineFilter[key];
  }
  const n=['manualText','manualInstrumental','generatedText','generatedInstrumental'].filter(k=>timelineFilter[k]).length;
  $('timelineFilterCount').textContent=n+'/4';
  const b=$('filterModeToggle');b.dataset.mode=timelineFilter.mode;
  b.setAttribute('aria-checked',String(timelineFilter.mode==='darken'));
  $('filterHideLabel').className=timelineFilter.mode==='hide'?'modeSelected':'modeUnselected';
  $('filterDarkenLabel').className=timelineFilter.mode==='darken'?'modeSelected':'modeUnselected';
  if($('timelineFilterDialog').classList.contains('open'))renderTimelineFilterPreview();
  paintTimelineFilters();
}
let timelinePreviewSignature='';
function renderTimelineFilterPreview(){
  if(!$('timelineFilterDialog').classList.contains('open'))return;
  const total=Math.max(duration,...lines.map(l=>Number(l.end)||0),0.001);
  const signature=JSON.stringify([total,lines.map(l=>[l.start,l.end,l.name,timelineType(l)]),timelineFilter.manualText,timelineFilter.manualInstrumental,timelineFilter.generatedText,timelineFilter.generatedInstrumental]);
  if(signature===timelinePreviewSignature){updateTimelineFilterPreviewHead();return}
  timelinePreviewSignature=signature;
  const parent=$('filterPreviewSegments');parent.replaceChildren();
  let visible=0,dimmed=0;
  for(const [i,line] of lines.entries()){
    if(line.start==null||line.end==null||Number(line.end)<=Number(line.start))continue;
    const enabled=timelineLineEnabled(line);enabled?visible++:dimmed++;
    const seg=document.createElement('div');seg.className='seg'+(enabled?'':' lyraFilterDimmed');
    seg.dataset.index=i;seg.style.left=100*Number(line.start)/total+'%';
    seg.style.width=100*(Number(line.end)-Number(line.start))/total+'%';
    seg.style.background=colorFor(i);
    seg.textContent=String(i+1);
    seg.title=line.name+' · '+timelineType(line)+(enabled?'':' (dimmed)');
    if(line.type==='instrumental'){
      seg.style.background='repeating-linear-gradient(135deg,'+colorFor(i)+' 0,'+colorFor(i)+' 5px,transparent 5px,transparent 10px)';
      seg.style.border='1px dashed '+colorFor(i);
    }
    parent.appendChild(seg);
  }
  $('filterPreviewCounts').textContent=visible+' shown · '+dimmed+' dimmed';
  $('filterPreviewMid').textContent=fmt(total/2).slice(0,5);
  $('filterPreviewEnd').textContent=fmt(total).slice(0,5);
  updateTimelineFilterPreviewHead();
}
function updateTimelineFilterPreviewHead(){
  if(!$('timelineFilterDialog').classList.contains('open'))return;
  const total=Math.max(duration,...lines.map(l=>Number(l.end)||0),0.001);
  $('filterPreviewHead').style.left=Math.max(0,Math.min(100,100*t/total))+'%';
}
let timelineFilterFocusReturn=null;
function openTimelineFilterDialog(){
  timelineFilterFocusReturn=document.activeElement;
  $('timelineFilterDialog').classList.add('open');
  refreshTimelineFilterControls();
  $('timelineFilterClose').focus();
}
function closeTimelineFilterDialog(){
  $('timelineFilterDialog').classList.remove('open');
  if(timelineFilterFocusReturn?.isConnected)timelineFilterFocusReturn.focus();
}
$('timelineFilterOpen').addEventListener('click',openTimelineFilterDialog);
$('timelineFilterClose').addEventListener('click',closeTimelineFilterDialog);
$('timelineFilterDialog').addEventListener('pointerdown',e=>{if(e.target===$('timelineFilterDialog'))closeTimelineFilterDialog()});
$('timelineFilterDialog').addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.stopPropagation();closeTimelineFilterDialog();return}
  if(e.key==='Tab'){
    const focusable=Array.from($('timelineFilterDialog').querySelectorAll('button:not([disabled]),input:not([disabled])'));
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});
for(const [id,key] of [['filterManualText','manualText'],['filterManualInstrumental','manualInstrumental'],['filterGeneratedText','generatedText'],['filterGeneratedInstrumental','generatedInstrumental']]){
  $(id).addEventListener('change',e=>{
    timelineFilter[key]=e.target.checked;persistTimelineFilters();refreshTimelineFilterControls();
  });
}
$('filterModeToggle').addEventListener('click',()=>{
  timelineFilter.mode=timelineFilter.mode==='darken'?'hide':'darken';
  persistTimelineFilters();refreshTimelineFilterControls();
});
refreshTimelineFilterControls();

function splitLine(){const l=lines[selected];if(!l||l.start==null||l.end==null)return toast('Select a completed line first.');let cut=snapTime(t);if(cut<=l.start+0.01||cut>=l.end-0.01)return toast('Place the playhead inside the line to split it.');let ratio=(cut-l.start)/(l.end-l.start),firstText=l.type==='text'?(l.text||''):'',parts=firstText?firstText.split(/\s+/):['',''];let cutIndex=Math.max(1,Math.min(parts.length-1,Math.round(parts.length*ratio)));let a=parts.slice(0,cutIndex).join(' '),b=parts.slice(cutIndex).join(' ');let first={...l,end:cut,text:a};let second={...l,name:l.name+' (2)',start:cut,text:b};lines.splice(selected,1,first,second);selected+=1;markChange();render();toast('Line split.')}
function mergeLine(){if(selected>=lines.length-1)return toast('Select a line with a following line.');let a=lines[selected],b=lines[selected+1];if(a.end==null||b.start==null)return toast('Both lines need timing first.');let merged={...a,end:Math.max(a.end,b.end??a.end),text:a.type==='text'&&b.type==='text'?[a.text,b.text].filter(Boolean).join(' '):a.text,type:a.type==='instrumental'&&b.type==='instrumental'?'instrumental':'text'};lines.splice(selected,2,merged);markChange();render();toast('Lines merged.')}
function shiftAll(){let v=prompt('Shift all timings by seconds (e.g. 0.5 or -0.5):','0.5');if(v===null)return;let delta=Number(v);if(!Number.isFinite(delta))return toast('Invalid shift.');let min=0,max=duration;for(const l of lines){if(l.start!=null&&l.end!=null){min=Math.max(min,l.start+delta);max=Math.min(max,l.end+delta)}}if(lines.some(l=>l.start!=null&&l.end!=null&&(l.start+delta<0||l.end+delta>duration)))return toast('Shift would move a line outside the song.');lines.forEach(l=>{if(l.start!=null)l.start=snapTime(l.start+delta);if(l.end!=null)l.end=snapTime(l.end+delta)});markChange();render();toast('All timings shifted.')}
function moveLine(dir){let ni=selected+dir;if(ni<0||ni>=lines.length)return;[lines[selected],lines[ni]]=[lines[ni],lines[selected]];selected=ni;markChange();render()}
let searchHighlightTimer=null,searchMatches=new Set();
function clearSearchHighlights(){clearTimeout(searchHighlightTimer);searchHighlightTimer=null;searchMatches.clear();document.querySelectorAll('.lineBtn.searchHit').forEach(b=>b.classList.remove('searchHit'))}
function searchLines(){
  clearSearchHighlights();
  const q=$('lineSearch').value.trim().toLocaleLowerCase();
  if(!q)return;
  lines.forEach((l,i)=>{if((l.name+' '+(l.text||'')).toLocaleLowerCase().includes(q))searchMatches.add(i)});
  if(!searchMatches.size){toast('No matching lines found.');return}
  document.querySelectorAll('#lineBtns .lineBtn').forEach((b,i)=>b.classList.toggle('searchHit',searchMatches.has(i)));
  toast(searchMatches.size+' matching line(s).');
  searchHighlightTimer=setTimeout(clearSearchHighlights,3000);
}
function rename(i){let v=prompt('Line name:',lines[i].name);if(v&&v.trim()){lines[i].name=v.trim();markChange();render()}}
function addLine(){lines.push({name:'Line '+(lines.length+1),text:'',start:null,end:null,type:'text',words:[]});selected=lines.length-1;markChange();render()}
$('rename').onclick=()=>rename(selected);$('add').onclick=addLine;
$('delete').onclick=()=>{if(lines.length===1){$('toast').textContent='At least one line must remain.';return}lines.splice(selected,1);selected=Math.max(0,Math.min(selected,lines.length-1));markChange();render()};
$('type').onclick=()=>{const l=lines[selected]; if(!l)return; const next=l.type==='instrumental'?'text':'instrumental'; if(next==='instrumental'){l._savedText=l.text==='♪'?'':l.text; l.text='♪';} else {l.text=l._savedText??''; delete l._savedText;} l.type=next; markChange(); render()};
$('apply').onclick=()=>{let a=snapTime(Number($('startTime').value)),b=snapTime(Number($('endTime').value));if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||b>duration){$('toast').textContent='Enter valid times: 0 ≤ Start < End ≤ song duration.';return}lines[selected].start=a;lines[selected].end=b;markChange();render()};
$('lyrics').oninput=e=>{if(lines[selected].type==='text'){lines[selected].text=e.target.value;autoSave();}};
$('start').onclick=()=>{if(!audio.src)return;lines.push({name:'Line '+(lines.length+1),text:'',start:snapTime(t),end:null,type:'text',words:[]});selected=lines.length-1;markChange();render()};
$('finish').onclick=()=>{if(!lines.length||lines[selected]?.start==null)return;if(t<=lines[selected].start){$('info').textContent='End must be after Start.';return}lines[selected].end=snapTime(t);if(lines[selected].end<=lines[selected].start){$('info').textContent='End must be after Start.';return}markChange();render();$('lyrics').focus()};
$('play').onclick=()=>{if(!audio.src)return;if(audio.paused){setSpeed($('speed').value==='other'?$('customSpeed').value:$('speed').value);audio.play().catch(()=>{});}else{audio.pause();cancelAnimationFrame(raf);}render();};
$('back').onclick=()=>{if(!audio.src)return;t=Math.max(0,t-5);audio.currentTime=t;draw()};
$('forward').onclick=()=>{if(!audio.src)return;t=Math.min(duration,t+5);audio.currentTime=t;draw()};
function snapTime(v){const step=Number($('snap')?.value||0);return step>0?Math.round(v/step)*step:v}
function clampTime(v){return Math.max(0,Math.min(duration,Number(v)||0))}
function parseTime(v){v=String(v).trim().replace(',','.');if(v.includes(':')){let parts=v.split(':');let sec=Number(parts.pop());let min=Number(parts.pop()||0);return min*60+sec}return Number(v)}
$('clock').addEventListener('change',()=>{let v=parseTime($('clock').value);if(!Number.isFinite(v)){draw();return}t=clampTime(snapTime(v));if(audio.src)audio.currentTime=t;draw()});
function setSpeed(v){v=Math.max(0.1,Math.min(3,Number(v)||1));audio.playbackRate=v;$('customSpeed').value=v;$('speedSlider').value=v;$('info').textContent='Playback speed: '+v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'×'}
$('speed').onchange=()=>{if($('speed').value==='other'){$('customSpeedWrap').style.display='inline-flex';setSpeed($('customSpeed').value)}else{$('customSpeedWrap').style.display='none';setSpeed($('speed').value)}if(audio.src&&!audio.paused)audio.play().catch(()=>{})};
$('customSpeed').oninput=e=>setSpeed(e.target.value);$('speedSlider').oninput=e=>setSpeed(e.target.value);
audio.ontimeupdate=()=>{t=audio.currentTime;draw();updatePlayerLyrics();$('play').textContent=audio.paused?'▶ Play':'⏸ Pause'};
audio.onplay=()=>{$('play').textContent='⏸ Pause';render()};
audio.onpause=()=>{$('play').textContent='▶ Play';render()};
function playerStartWithDelay(){
  if(!document.body.classList.contains('player-mode')||!audio.src)return;
  clearTimeout(playerLoopTimer);
  const normalVolume=audio.volume;
  audio.volume=0;
  audio.currentTime=0;
  t=0;
  draw();
  updatePlayerLyrics();
  audio.play().then(()=>{
    playerLoopTimer=setTimeout(()=>{
      if(!document.body.classList.contains('player-mode'))return;
      audio.volume=normalVolume;
    },2000);
  }).catch(()=>{
    audio.volume=normalVolume;
    toast('Player konnte nicht automatisch gestartet werden. Bitte erneut drücken.');
  });
}
audio.onended=()=>{cancelAnimationFrame(raf);draw();updatePlayerLyrics();if(document.body.classList.contains('player-mode'))playerStartWithDelay()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('player-mode')){setPlayerMode(false);return}if(e.target.matches('input,textarea,select'))return;if(e.code==='Space'){e.preventDefault();$('play').click()}if(e.key==='ArrowLeft')$('back').click();if(e.key==='ArrowRight')$('forward').click()});
// V1 - 3.10: full-song scrollable lyric panel, multiple simultaneous vocals,
// optional expansion, and a 2-second idle return in compact mode.
// The first active line in editor order is the lead; following active lines
// are shown smaller, without adding background/lead metadata to the project.
const PLAYER_LYRICS_IDLE_MS=2000;
let playerLyricsExpanded=false;
let playerLyricsBrowsing=false;
let playerLyricsReturnTimer=null;
let playerLyricsFocusIndex=null;
function playerText(l){if(!l)return '';return l.type==='instrumental'?'♪':(l.text||l.name||'');}
// Compact Player: show at most five complete lyric rows, starting with the
// currently sung line. Use measured row heights rather than a fixed blank area.
// The full song remains scrollable inside this compact window.
function playerLyricsFitCompact(){
  if(!document.body.classList.contains('player-mode')||playerLyricsExpanded)return;
  const viewport=$('playerLyrics');
  const rows=Array.from(viewport.querySelectorAll('.playerLyricRow'));
  const focus=viewport.querySelector('.playerLyricRow.is-lead')||
    viewport.querySelector('.playerLyricRow.is-next')||
    viewport.querySelector('.playerLyricRow.is-past:last-child');
  const start=Math.max(0,focus?rows.indexOf(focus):0);
  const style=getComputedStyle(viewport);
  const gap=parseFloat(style.rowGap)||0;
  const padding=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
  const maxHeight=Math.max(120,Math.min(window.innerHeight*.48,420));
  let height=padding,shown=0;
  for(let i=start;i<rows.length&&shown<5;i++){
    const addition=rows[i].getBoundingClientRect().height+(shown?gap:0);
    // Keep the last line fully visible whenever the screen has room.
    if(shown>=2&&height+addition>maxHeight)break;
    height+=addition;
    shown++;
  }
  // No lyrics / short songs should have no large empty panel below the text.
  viewport.style.height=Math.ceil(Math.min(Math.max(height,42),maxHeight))+'px';
}
function playerLyricsScrollToCurrent(behavior='smooth'){
  if(!document.body.classList.contains('player-mode')||playerLyricsExpanded)return;
  const viewport=$('playerLyrics');
  const row=viewport.querySelector('.playerLyricRow.is-lead')||
    viewport.querySelector('.playerLyricRow.is-next')||
    viewport.querySelector('.playerLyricRow.is-past:last-child');
  if(!row)return;
  // Align the lead line near the top. This keeps the last preview line
  // just above the bottom edge instead of leaving a large unused gap.
  const pad=parseFloat(getComputedStyle(viewport).paddingTop)||0;
  const top=row.getBoundingClientRect().top-viewport.getBoundingClientRect().top+
    viewport.scrollTop-pad;
  viewport.scrollTo({top:Math.max(0,top),behavior});
}
function playerLyricsMarkBrowsing(){
  if(!document.body.classList.contains('player-mode')||playerLyricsExpanded)return;
  playerLyricsBrowsing=true;
  clearTimeout(playerLyricsReturnTimer);
  playerLyricsReturnTimer=setTimeout(()=>{
    playerLyricsBrowsing=false;
    playerLyricsScrollToCurrent('smooth');
  },PLAYER_LYRICS_IDLE_MS);
}
function playerLyricsStopBrowsing(){
  clearTimeout(playerLyricsReturnTimer);
  playerLyricsReturnTimer=null;
  playerLyricsBrowsing=false;
}
function playerLyricsSetExpanded(expanded){
  playerLyricsExpanded=!!expanded;
  $('playerLyricsBox').classList.toggle('is-expanded',playerLyricsExpanded);
  // The page itself is the scroll container in Expanded mode. Explicitly
  // switch the root scroll behavior as well: Android WebViews/PWAs otherwise
  // sometimes keep trapping touch gestures in the former inner scroll pane.
  document.documentElement.classList.toggle('lyra-player-page-scroll',playerLyricsExpanded);
  const button=$('playerLyricsExpand');
  button.textContent=playerLyricsExpanded?'⤡ Collapse':'⛶ Expand';
  button.setAttribute('aria-expanded',String(playerLyricsExpanded));
  button.title=playerLyricsExpanded?'Collapse lyrics':'Expand lyrics to browse the full song';
  playerLyricsStopBrowsing();
  const viewport=$('playerLyrics');
  if(playerLyricsExpanded){
    // Undo compact-mode's measured height. The whole song participates in
    // normal document layout; there is no separately scrolling lyrics pane.
    viewport.style.removeProperty('height');
    viewport.scrollTop=0;
  }else{
    requestAnimationFrame(()=>{
      playerLyricsFitCompact();
      playerLyricsScrollToCurrent('auto');
      // When leaving a long expanded view, bring the player back on screen.
      $('playerLyricsBox').scrollIntoView({block:'nearest',behavior:'auto'});
    });
  }
}
$('playerLyricsExpand').addEventListener('click',()=>playerLyricsSetExpanded(!playerLyricsExpanded));
window.addEventListener('resize',()=>{
  if(document.body.classList.contains('player-mode')&&!playerLyricsExpanded){
    requestAnimationFrame(()=>{playerLyricsFitCompact();if(!playerLyricsBrowsing)playerLyricsScrollToCurrent('auto')});
  }
});
const lyricsViewport=$('playerLyrics');
lyricsViewport.addEventListener('wheel',playerLyricsMarkBrowsing,{passive:true});
lyricsViewport.addEventListener('touchmove',playerLyricsMarkBrowsing,{passive:true});
lyricsViewport.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'||e.pointerType==='pen')playerLyricsMarkBrowsing();
});
lyricsViewport.addEventListener('pointerup',e=>{
  if(e.pointerType==='touch'||e.pointerType==='pen'||e.pointerType==='mouse'){
    if(playerLyricsBrowsing)playerLyricsMarkBrowsing();
  }
});
lyricsViewport.addEventListener('touchend',()=>{
  if(playerLyricsBrowsing)playerLyricsMarkBrowsing();
},{passive:true});
lyricsViewport.addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))
    playerLyricsMarkBrowsing();
});
function updatePlayerLyrics(){
  if(!document.body.classList.contains('player-mode'))return;
  const root=$('playerLyrics');
  if(!root)return;
  // Store every lyric in editor order so either panel size can browse the song.
  const entries=lines.map((line,index)=>({line,index})).filter(({line})=>
    playerText(line).trim().length>0);
  const signature=entries.map(({line,index})=>
    index+'|'+line.type+'|'+(line.text||'')+'|'+(line.name||'')+'|'+line.start+'|'+line.end+
    '|'+(Array.isArray(line.words)?line.words.length:0)).join('\n');
  if(root._lyricsSignature!==signature){
    root._lyricsSignature=signature;
    root.replaceChildren(...entries.map(({index})=>{
      const row=document.createElement('div');
      row.className='playerLyricRow';
      row.dataset.lineIndex=String(index);
      row.style.setProperty('--lyra-scale','.25');
      return row;
    }));
    playerLyricsFocusIndex=null;
  }
  const isTimed=line=>Number.isFinite(line.start)&&Number.isFinite(line.end)&&line.end>line.start;
  const active=entries.filter(({line})=>isTimed(line)&&t>=line.start&&t<line.end);
  const upcoming=entries.filter(({line})=>Number.isFinite(line.start)&&line.start>t)
    .sort((a,b)=>a.line.start-b.line.start||a.index-b.index);
  const leadIndex=active.length?active[0].index:null;
  const nextIndex=upcoming.length?upcoming[0].index:null;
  const positions=new Map();
  active.forEach(({index},i)=>positions.set(index,i));
  upcoming.forEach(({index},i)=>positions.set(index,i+(active.length||1)));
  const sizes=[1,.75,.5,.25];
  for(const row of root.children){
    const index=Number(row.dataset.lineIndex);
    const line=lines[index];
    if(!line)continue;
    const activePosition=active.findIndex(x=>x.index===index);
    const isActive=activePosition>=0;
    const isNext=index===nextIndex;
    const past=isTimed(line)&&line.end<=t;
    const upcomingRow=Number.isFinite(line.start)&&line.start>t;
    row.classList.toggle('is-lead',index===leadIndex);
    row.classList.toggle('is-active',isActive);
    row.classList.toggle('is-next',isNext);
    row.classList.toggle('is-upcoming',upcomingRow);
    row.classList.toggle('is-past',past);
    row.classList.toggle('is-untimed',!isTimed(line));
    row.style.setProperty('--lyra-scale',String(sizes[Math.min(positions.get(index)??3,3)]));
    if(isActive&&wbw.on&&line.type!=='instrumental'&&Array.isArray(line.words)&&
      line.words.some(w=>w.start!=null&&w.end!=null)){
      renderPlayerWords(row,line);
    }else{
      row._wsig=null;
      const label=playerText(line);
      if(row.textContent!==label)row.textContent=label;
    }
  }
  const focusIndex=leadIndex??nextIndex;
  if(focusIndex!==playerLyricsFocusIndex){
    playerLyricsFocusIndex=focusIndex;
    if(!playerLyricsExpanded){
      requestAnimationFrame(()=>{
        playerLyricsFitCompact();
        if(!playerLyricsBrowsing)playerLyricsScrollToCurrent('smooth');
      });
    }
  }
}
function updatePlayerHeader(){
  const name=($('song').value||audioFileName||'Untitled Song').trim()||'Untitled Song';
  $('playerSong').textContent=name;
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'♪';
  $('playerArt').textContent=initials;
}
$('song').addEventListener('input',updatePlayerHeader);

function setPlayerMode(on){
  if(on)wbw.stopAt=null;
  if(on&&!audio.src){toast('Import a song first.');return;}
  clearTimeout(playerLoopTimer);
  if(on){
    audio.pause();
    audio.volume=0;
    document.body.classList.add('player-mode');
    $('playerLyricsBox').setAttribute('aria-hidden','false');
    playerLyricsSetExpanded(false);
    $('playerLyrics')._lyricsSignature=null;
    updatePlayerHeader();
    t=0;
    audio.currentTime=0;
    draw();
    updatePlayerLyrics();
    audio.play().then(()=>{
      playerLoopTimer=setTimeout(()=>{
        if(document.body.classList.contains('player-mode'))audio.volume=1;
      },2000);
    }).catch(()=>{
      audio.volume=1;
      toast('Player konnte nicht automatisch gestartet werden. Bitte erneut drücken.');
    });
    $('playerExit').focus();
  }else{
    audio.pause();
    audio.volume=1;
    document.body.classList.remove('player-mode');
    $('playerLyricsBox').setAttribute('aria-hidden','true');
    playerLyricsStopBrowsing();
    playerLyricsExpanded=false;
    document.documentElement.classList.remove('lyra-player-page-scroll');
    $('playerLyricsBox').classList.remove('is-expanded');
    render();
  }
}
$('playerMode').onclick=()=>setPlayerMode(true);$('playerExit').onclick=()=>setPlayerMode(false);$('file').onchange=e=>{let f=e.target.files?.[0];if(!f)return; $('fileInfo').textContent=f.name; setAudioFile(f,!(lines.length&&!audio.src)); autoSave(); updateFileSummary();};
function setFromPointer(ev){let r=$('timeline').getBoundingClientRect();let x=Math.max(0,Math.min(r.width,ev.clientX-r.left));t=snapTime(lyraXToTime(x/r.width));t=clampTime(t);if(audio.src)audio.currentTime=t;draw()}
$('head').addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;dragging=true;$('head').setPointerCapture(e.pointerId)});
$('head').addEventListener('pointermove',e=>{if(dragging)setFromPointer(e)});
$('head').addEventListener('pointerup',()=>dragging=false);
$('head').addEventListener('pointercancel',()=>dragging=false);
$('timeline').addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||lyraPinchConsumed)return;if(e.target!==$('head'))setFromPointer(e)});
$('waveform').addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||lyraPinchConsumed)return;setFromPointer({clientX:e.clientX});});
$('lyraZoomReset').addEventListener('click',()=>lyraZoomSet(1));
for(const el of [$('timeline'),$('waveform').parentElement]){el.addEventListener('pointerdown',lyraHandlePinchDown,{capture:true});el.addEventListener('pointermove',lyraHandlePinchMove,{capture:true});el.addEventListener('pointerup',lyraHandlePinchUp,{capture:true});el.addEventListener('pointercancel',lyraHandlePinchUp,{capture:true});el.addEventListener('pointerleave',e=>{if(e.pointerType==='touch')return;lyraHandlePinchUp(e)},{capture:true});el.addEventListener('pointerup',e=>{if(e.pointerType==='touch'&&!lyraPinchConsumed&&!lyraActivePointers.size){setFromPointer(e)}},{capture:false})}

// Player Mode remains seekable in both editor modes.
function nudgeSelectedLine(direction){
 const l=lines[selected];if(!l||l.start==null||l.end==null)return toast('Select a timed line first.');
 const step=Number($('lineNudgeStep').value)||0.05;
 const delta=direction*step;
 if(l.start+delta<0||duration>0&&l.end+delta>duration+0.00001)return toast('Line cannot move beyond song boundaries.');
 l.start=Math.round((l.start+delta)*1000)/1000;
 l.end=Math.round((l.end+delta)*1000)/1000;
 if(Array.isArray(l.words))l.words.forEach(w=>{if(w.start!=null)w.start=Math.round((w.start+delta)*1000)/1000;if(w.end!=null)w.end=Math.round((w.end+delta)*1000)/1000});
 markChange();render();
}
$('lineNudgeL').onclick=()=>nudgeSelectedLine(-1);
$('lineNudgeR').onclick=()=>nudgeSelectedLine(1);
$('splitLine').onclick=splitLine;$('mergeLine').onclick=mergeLine;$('moveUp').onclick=()=>moveLine(-1);$('moveDown').onclick=()=>moveLine(1);$('shiftAll').onclick=shiftAll;$('lineSearch').addEventListener('change',searchLines);$('lineSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchLines()});
$('undo').onclick=undo;$('redo').onclick=redo;
$('autosaveBtn').onclick=()=>{autosave=!autosave;$('autosaveBtn').textContent='Autosave: '+(autosave?'On':'Off');if(autosave)autoSave()};
$('importTTMLBtn').onclick=()=>$('importTTML').click();
$('importTTML').onchange=e=>{let f=e.target.files?.[0];if(!f)return;let r=new FileReader();r.onload=()=>importTTML(String(r.result||''));r.readAsText(f);e.target.value=''};
$('detectGaps').onclick=detectGaps;
$('tapSync').onclick=()=>{tapSync=!tapSync;$('tapSync').classList.toggle('tapMode',tapSync);$('tapSync').textContent=tapSync?'⚡ Tap-to-Sync: On':'⚡ Tap-to-Sync';toast(tapSync?'Tap timeline to create the next line start/end automatically.':'Tap-to-Sync off.')};
$('timeline').addEventListener('pointerdown',e=>{if(!tapSync||e.target===$('head')||e.pointerType==='touch'&&lyraPinchConsumed)return;setFromPointer(e);if(!audio.src||!duration)return;if(!lines.length||lines[selected]?.end!=null){lines.push({name:'Line '+(lines.length+1),text:'',start:t,end:null,type:'text'});selected=lines.length-1}else if(lines[selected].start==null){lines[selected].start=t}else if(lines[selected].end==null&&t>lines[selected].start){lines[selected].end=t}markChange();render();});
window.addEventListener('resize',drawWaveform);

function safeBaseName(title){return (String(title||'Untitled Song').replace(/\.(ttml|xml|lrc|srt|vtt|ass|yrc)$/i,'').replace(/[^a-z0-9äöüß _-]/gi,'_').trim()||'Untitled Song')}
function exportAlert(message){
  $('exportAlertText').textContent=message;
  $('exportAlert').classList.add('open');
  $('exportAlertOk').focus();
}
$('exportAlertOk').onclick=()=>$('exportAlert').classList.remove('open');
let pendingExport=null;
function directDownload(blob,filename){
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(u);a.remove()},30000);
  showSaveToast({info:true,text:'Downloaded '+filename+'. If it is missing in Files, use Share / Save to device on the next export.'});
}
function downloadText(content,filename,mime){
  const blob=new Blob([content],{type:mime+';charset=utf-8'});
  pendingExport={blob,filename,mime};
  $('exportSaveName').textContent=filename;
  let shareAvailable=false;
  try{shareAvailable=typeof navigator.canShare==='function'&&typeof File==='function'&&navigator.canShare({files:[new File([blob],filename,{type:mime})]})}catch(e){shareAvailable=false}
  $('exportShare').style.display=shareAvailable?'':'none';
  $('exportSaveDialog').classList.add('open');
}
$('exportSaveCancel').onclick=()=>$('exportSaveDialog').classList.remove('open');
$('exportDownload').onclick=()=>{
  if(!pendingExport)return;
  $('exportSaveDialog').classList.remove('open');
  directDownload(pendingExport.blob,pendingExport.filename);
};
$('exportShare').onclick=async()=>{
  if(!pendingExport)return;
  const {blob,filename,mime}=pendingExport;
  try{
    await navigator.share({files:[new File([blob],filename,{type:mime})],title:filename});
    $('exportSaveDialog').classList.remove('open');
  }catch(e){if(e.name!=='AbortError')exportAlert('Sharing failed. Try Download instead.');}
};
function timedLines(){return lines.filter(l=>Number.isFinite(Number(l.start))&&Number.isFinite(Number(l.end))&&l.start!=null&&l.end!=null&&Number(l.end)>Number(l.start)).sort((a,b)=>Number(a.start)-Number(b.start)||Number(a.end)-Number(b.end))}

function wordTimedLines(){return timedLines().filter(l=>l.type==='instrumental'||(Array.isArray(l.words)&&l.words.length&&l.words.every(w=>Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end))&&w.start!=null&&w.end!=null&&Number(w.end)>Number(w.start))))}

function lrcTime(sec){let n=Math.max(0,Math.round((Number(sec)||0)*100));let m=Math.floor(n/6000),s=Math.floor(n%6000/100),cs=n%100;return '['+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0')+']'}

function assTime(sec){let n=Math.max(0,Math.round((Number(sec)||0)*100));let h=Math.floor(n/360000),m=Math.floor(n%360000/6000),s=Math.floor(n%6000/100),cs=n%100;return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0')}

function srtTime(sec){let n=Math.max(0,Math.round((Number(sec)||0)*1000));let h=Math.floor(n/3600000),m=Math.floor(n%3600000/60000),s=Math.floor(n%60000/1000),ms=n%1000;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+','+String(ms).padStart(3,'0')}

function vttTime(sec){return srtTime(sec).replace(',','.')}

function xmlWordSpans(l){return (l.words||[]).map((w,i)=>esc(w.sepBefore??(i?' ':''))+`<span begin="${fmt(w.start)}" end="${fmt(w.end)}">${esc(w.text)}</span>`).join('')}

function buildTTML(wordMode=false){
 let title=$('song').value.trim()||'Untitled Song',artist=$('artist').value.trim(),ls=timedLines(),hasWords=wordTimedLines().length>0&&wordTimedLines().length===ls.length;
 let mode=wordMode&&hasWords?'Word':'Line';
 let body=ls.map(l=>{
   if(mode==='Word'&&l.words?.length)return `            <p begin="${fmt(l.start)}" end="${fmt(l.end)}">${xmlWordSpans(l)}</p>`;
   let content=l.type==='instrumental'?'♪':l.text.trim();if(!content)return '';
   return `            <p begin="${fmt(l.start)}" end="${fmt(l.end)}">${esc(content)}</p>`;
 }).filter(Boolean).join('\n');
 return `<?xml version="1.0" encoding="UTF-8"?>\n\n<tt xmlns="http://www.w3.org/ns/ttml"\n    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"\n    xmlns:itunes="http://itunes.apple.com/lyric-ttml-extensions"\n    xml:lang="en"\n    itunes:timing="${mode}">\n    <head><metadata><ttm:title>${esc(title)}</ttm:title><ttm:agent type="person">${esc(artist)}</ttm:agent></metadata></head>\n    <body><div>\n${body}\n    </div></body>\n</tt>`;
}
function buildLRC(){let title=$('song').value.trim()||'Untitled Song',artist=$('artist').value.trim();return `[ti:${title}]\n[ar:${artist}]\n[re:Lyra]\n\n`+timedLines().map(l=>lrcTime(l.start)+(l.type==='instrumental'?'♪':l.text.trim())).join('\n')+'\n'}
function buildEnhancedLRC(){return timedLines().map(l=>{let base=lrcTime(l.start);if(!l.words?.length)return base+(l.type==='instrumental'?'♪':l.text.trim());return base+l.words.map((w,i)=>(w.sepBefore??(i?' ':''))+`<${lrcTime(w.start).slice(1,-1)}>${w.text}`).join('')}).join('\n')+'\n'}

function buildYRC(){let out=[];for(const l of timedLines()){let ms=s=>Math.round(s*1000);let line='['+ms(l.start)+','+Math.max(1,ms(l.end-l.start))+']';if(l.type==='instrumental'){out.push(line+'♪');continue}for(const [i,w] of l.words.entries()){line+=(w.sepBefore??(i?' ':''))+'('+ms(w.start)+','+Math.max(1,ms(w.end-w.start))+',0)'+w.text}out.push(line)}return out.join('\n')+'\n'}

function buildQRC(){let out=[];for(const l of timedLines()){let ms=s=>Math.round(s*1000);let line='['+ms(l.start)+','+Math.max(1,ms(l.end-l.start))+']';if(l.type==='instrumental'){out.push(line+'♪');continue}for(const [i,w] of l.words.entries()){line+=(w.sepBefore??(i?' ':''))+w.text+'('+ms(w.start)+','+Math.max(1,ms(w.end-w.start))+')'}out.push(line)}return out.join('\n')+'\n'}

function buildLYS(){let out=[];for(const l of timedLines()){let ms=s=>Math.round(s*1000);let line='[0]';if(l.type==='instrumental'){out.push(line+'♪');continue}for(const [i,w] of l.words.entries()){line+=(w.sepBefore??(i?' ':''))+w.text+'('+ms(w.start)+','+Math.max(1,ms(w.end-w.start))+')'}out.push(line)}return out.join('\n')+'\n'}

function buildLYL(){return '[type:LyricifyLines]\n\n'+timedLines().map(l=>'['+Math.round(l.start*1000)+','+Math.round(l.end*1000)+']'+(l.type==='instrumental'?'♪':l.text.trim())).join('\n')+'\n'}
function buildSRT(){return timedLines().map((l,i)=>(i+1)+'\n'+srtTime(l.start)+' --> '+srtTime(l.end)+'\n'+(l.type==='instrumental'?'♪':l.text.trim())+'\n').join('\n')}
function buildVTT(){return 'WEBVTT\n\n'+timedLines().map((l,i)=>'line-'+(i+1)+'\n'+vttTime(l.start)+' --> '+vttTime(l.end)+'\n'+(l.type==='instrumental'?'♪':l.text.trim())+'\n').join('\n')}
function assEsc(s){return String(s).replace(/\\/g,'\\\\').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/\r?\n/g,'\\N')}

function buildASS(){let title=$('song').value.trim()||'Untitled Song',artist=$('artist').value.trim();let h='[Script Info]\nScriptType: v4.00+\nTitle: '+title.replace(/[\r\n]/g,' ')+'\nOriginal Script: '+artist.replace(/[\r\n]/g,' ')+'\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';return h+timedLines().map(l=>{let text;if(l.words?.length&&l.type!=='instrumental'){let pos=Number(l.start);text=l.words.map((w,i)=>{let gap=Math.max(0,Math.round((Number(w.start)-pos)*100));let prefix=gap?'{\\k'+gap+'}':'';let dur=Math.max(1,Math.round((Number(w.end)-Number(w.start))*100));pos=Number(w.end);return prefix+'{\\k'+dur+'}'+assEsc(w.sepBefore??(i?' ':''))+assEsc(w.text)}).join('');}else{text=assEsc(l.type==='instrumental'?'♪':l.text.trim());}return 'Dialogue: 0,'+assTime(l.start)+','+assTime(l.end)+',Default,,0,0,0,,'+text}).join('\n')+'\n'}
function doExport(format){
 updateExportAvailability();
 const exportButton=document.querySelector('[data-export-format="'+format+'"]');
 if(!exportButton||exportButton.hidden||exportButton.disabled)return toast('This format is not available for the current lyrics.');
 if(['ttml-word','elrc','yrc','qrc','lys'].includes(format)&&!areAllWordsAssigned()){exportAlert('Please assign every word before using this word-level export.');return;}
 normalizeInstrumentals();
 let title=$('song').value.trim()||'Untitled Song',base=safeBaseName(title),text='',ext='',mime='text/plain';
 if(format==='ttml'){text=buildTTML(false);ext='ttml';mime='application/ttml+xml'}
 else if(format==='ttml-word'){if(!areAllWordsAssigned()){toast('TTML Word braucht Timing-Spans/Wörter.');return}text=buildTTML(true);ext='ttml';mime='application/ttml+xml'}
 else if(format==='lrc'){text=buildLRC();ext='lrc';mime='text/plain'}
 else if(format==='elrc'){if(!areAllWordsAssigned()){toast('Enhanced LRC braucht Wort-Timing.');return}text=buildEnhancedLRC();ext='lrc';mime='text/plain'}
 else if(format==='yrc'){if(!areAllWordsAssigned()){toast('YRC braucht Wort-Timing.');return}text=buildYRC();ext='yrc';mime='text/plain'}
 else if(format==='qrc'){if(!areAllWordsAssigned()){toast('QRC braucht Wort-Timing.');return}text=buildQRC();ext='qrc';mime='text/plain'}
 else if(format==='lys'){if(!areAllWordsAssigned()){toast('LYS braucht Wort-Timing.');return}text=buildLYS();ext='lys';mime='text/plain'}
 else if(format==='lyl'){text=buildLYL();ext='lyl';mime='text/plain'}
 else if(format==='srt'){text=buildSRT();ext='srt';mime='application/x-subrip'}
 else if(format==='vtt'){text=buildVTT();ext='vtt';mime='text/vtt'}
 else if(format==='ass'){text=buildASS();ext='ass';mime='text/x-ass'}
 else return;
 downloadText(text,base+'.'+ext,mime);$('exportMenu').classList.remove('open');
}
function areAllWordsAssigned(){
  normalizeInstrumentals();
  const lines=timedLines();
  return lines.length>0&&lines.every(l=>l.type==='instrumental'||(
    Array.isArray(l.words)&&l.words.length>0&&
    l.words.every(w=>w.start!=null&&w.end!=null&&Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end))&&Number(w.end)>Number(w.start))&&
    l.text.trim().split(/\s+/).filter(Boolean).length===l.words.length
  ));
}
$('export').onclick=()=>{
  const opening=!$('exportMenu').classList.contains('open');
  updateExportAvailability();
  
  if(opening&&!document.querySelector('#exportMenu [data-export-format]:not([hidden])')){
    exportAlert('Add at least one timed lyric line before exporting.');return;
  }
  $('exportMenu').classList.toggle('open');
};
document.querySelectorAll('[data-export-format]').forEach(b=>b.onclick=()=>doExport(b.dataset.exportFormat));
function updateExportAvailability(){
  normalizeInstrumentals();
  const hasLines=timedLines().length>0;
  const wordOnly=new Set(['ttml-word','yrc','qrc','lys','elrc']);
  const wordMode=document.body.classList.contains('mode-word');
  document.querySelectorAll('[data-export-format]').forEach(b=>{
    const isWordFormat=wordOnly.has(b.dataset.exportFormat);
    // Keep word formats visible in Word-by-Word mode; the Export button
    // explains missing word assignments instead of silently hiding formats.
    const available=hasLines&&(!isWordFormat||wordMode);
    b.hidden=!available;b.disabled=!available;
  });
  document.querySelectorAll('#exportMenu .exportGroup').forEach(g=>{
    let next=g.nextElementSibling,visible=false;
    while(next&&!next.classList.contains('exportGroup')){
      if(next.matches('[data-export-format]')&&!next.hidden)visible=true;
      next=next.nextElementSibling;
    }
    g.hidden=!visible;
  });
}
function getSkipAmount(){let raw=$('skipAmount').value.trim().replace(',','.');if(raw==='')return null;let n=Number(raw);if(!Number.isFinite(n))return null;return Math.max(0,Math.min(999,n));}
function updateSkipButtons(){let raw=$('skipAmount').value.trim();$('back').textContent='↶ -'+(raw===''?'':raw)+'s';$('forward').textContent='↷ +'+(raw===''?'':raw)+'s'}
$('skipAmount').addEventListener('input',()=>{let raw=$('skipAmount').value.replace(/[^0-9.,]/g,'');$('skipAmount').value=raw;updateSkipButtons()});
$('skipAmount').addEventListener('blur',()=>{let d=getSkipAmount();if(d!==null)$('skipAmount').value=String(d).replace(/\.0$/,'');updateSkipButtons()});
$('back').onclick=()=>{if(!audio.src)return;let d=getSkipAmount();if(d===null)return;t=Math.max(0,t-d);audio.currentTime=t;draw()};
$('forward').onclick=()=>{if(!audio.src)return;let d=getSkipAmount();if(d===null)return;t=Math.min(duration,t+d);audio.currentTime=t;draw()};

// Ribbon behavior: nothing open initially; clicking active tab closes it.
document.querySelectorAll('.ribbonTab').forEach(tab=>tab.addEventListener('click',()=>{let id=tab.dataset.panel,was=tab.classList.contains('active');$('exportMenu').classList.remove('open');document.querySelectorAll('.ribbonTab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.ribbonPanel').forEach(x=>x.classList.remove('open'));if(!was){tab.classList.add('active');$(id).classList.add('open')}}));
function hexToRgb(h){h=String(h).replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255]}
function rgbToHex(c){return '#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}
function mixRgb(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t)}
function rgbToHsl(c){const[r,g,b]=c.map(v=>v/255),mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h*=60}return[h,s,l]}
function hslToRgb(h,s,l){h=(((h%360)+360)%360)/360;const f=(p,q,t)=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p};if(s===0)return[l*255,l*255,l*255];const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;return[f(p,q,h+1/3)*255,f(p,q,h)*255,f(p,q,h-1/3)*255]}
function lumOf(c){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])}
let appMode='dark';
function applyAppearance(){
  const text=$('appearanceTextColor')?.value||'#fff3ea',accent=$('appearanceAccentColor')?.value||'#ff4d8d';
  const A=hexToRgb(accent),dark=appMode==='dark';
  // dark mode: accent -> darker shade of itself (e.g. purple to black); light mode: accent -> neighbouring hue (e.g. purple to magenta)
  let A2;
  if(dark)A2=mixRgb(A,[0,0,0],.68);else{const hsl=rgbToHsl(A);A2=hsl[1]<.025?A.slice():hslToRgb(hsl[0]+32,Math.min(1,hsl[1]*1.05),hsl[2])}
  const T2=dark?mixRgb(A,[255,255,255],.45):A2;
  const ink=((lumOf(A)+lumOf(A2))/2)>.38?'#1a1020':'#ffffff';
  const nearWhite=A.every(v=>v>=245);
  const rgb=A.map(Math.round).join(',');
  const r=document.documentElement;
  r.dataset.mode=appMode;
  r.dataset.whiteAccent=nearWhite?'true':'false';
  [['--text',text],['--accent',accent],['--important',accent],['--accent2',nearWhite?accent:rgbToHex(A2)],['--accentText2',rgbToHex(T2)],['--ink',ink],['--glow','rgba('+rgb+',.45)'],['--glow2','rgba('+rgb+',.12)']].forEach(kv=>r.style.setProperty(kv[0],kv[1]));
  const modeSwitch=$('appearanceModeSwitch');if(modeSwitch){modeSwitch.classList.toggle('on',!dark);modeSwitch.setAttribute('aria-checked',String(!dark));modeSwitch.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');}
  try{localStorage.setItem('lyra-appearance',JSON.stringify({text,accent,mode:appMode}))}catch(e){}
}
(function(){
  try{if(localStorage.getItem('lyra-theme')!=='sunset-3'){localStorage.removeItem('lyra-appearance');localStorage.setItem('lyra-theme','sunset-3')}}catch(e){}
  try{const a=JSON.parse(localStorage.getItem('lyra-appearance')||'null');if(a&&a.mode==='light')appMode='light';if(a&&a.text&&$('appearanceTextColor'))$('appearanceTextColor').value=a.text;if(a&&a.accent&&$('appearanceAccentColor'))$('appearanceAccentColor').value=a.accent}catch(e){}
  applyAppearance();
})();
$('appearanceTextColor').addEventListener('input',applyAppearance);$('appearanceAccentColor').addEventListener('input',applyAppearance);
$('appearanceResetAccent').onclick=()=>{$('appearanceAccentColor').value='#ff4d8d';applyAppearance()};
$('appearanceModeSwitch').onclick=()=>{appMode=appMode==='dark'?'light':'dark';$('appearanceTextColor').value=appMode==='light'?'#231942':'#fff3ea';applyAppearance()};
$('fileToggle').onclick=()=>{if(!audio.src){toast('Import a song first.');return}let box=$('filebox'),panel=document.querySelector('.audioPanel'),collapsed=panel.classList.toggle('collapsed');box.classList.toggle('collapsed',collapsed);$('fileToggle').textContent=collapsed?'Expand':'Collapse';updateFileSummary()};
function updateFileSummary(){
  let f=$('file').files?.[0];
  let fname=audioFileName||f?.name||'';
  let bytes=f?.size||audioFileSize||0;
  let size=bytes?((bytes/1024/1024).toFixed(2)+' MB'):'';
  let len=duration?fmt(duration).replace(/\.\d+$/,''):'';
  let song=($('song').value||'').trim()||'Untitled Song';
  let parts=[fname?song+' ('+fname+')':'No file selected.'];
  if(fname){if(len)parts.push(len);if(size)parts.push(size)}
  $('fileSummary').textContent=parts.join(' · ');
  if(f)$('fileInfo').textContent=f.name; else if(audioFileName)$('fileInfo').textContent=audioFileName;
  let has=!!audio.src;
  $('fileToggle').disabled=!has;
  if(!has&&$('filebox').classList.contains('collapsed')){$('filebox').classList.remove('collapsed');document.querySelector('.audioPanel').classList.remove('collapsed');$('fileToggle').textContent='Collapse'}
}
$('fileToggle').addEventListener('click',updateFileSummary);audio.addEventListener('loadedmetadata',updateFileSummary);
$('lyraDiscord').onclick=()=>window.open('https://discord.gg/KdvbuPZkCw','_blank','noopener');
// Lyra Import Protocol v1: shared browser-side interface for future native app adapters.
// Local File/Blob is required; a private file in Stash cannot be read by a web page alone.
const REGISTRY_KEY='lyra-registry-local-v1';
const DEFAULT_REGISTRY=[{id:'stash',code:'LYR-7K9P2X',name:'Stash',icon:'S',description:'Music library · integration planned',packageId:'',visibility:'public',installed:'unknown',certified:false,links:[{label:'Discord Server',url:'https://discord.gg/vcbjEby5PC'},{label:'GitHub',url:'https://github.com/rawnaldclark/Stash'}]}];
let COMPATIBLE_APPS=[];
function loadRegistry(){try{const v=JSON.parse(localStorage.getItem(REGISTRY_KEY));COMPATIBLE_APPS=Array.isArray(v)?v:structuredClone(DEFAULT_REGISTRY)}catch(e){COMPATIBLE_APPS=JSON.parse(JSON.stringify(DEFAULT_REGISTRY))}}
function saveRegistry(){try{localStorage.setItem(REGISTRY_KEY,JSON.stringify(COMPATIBLE_APPS))}catch(e){alert('Cannot save local registry: '+e.message)}}
loadRegistry();
let registryOffline=false,registryFilter='all',registryEditing=null;
function registryCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;do{const b=new Uint8Array(8);crypto.getRandomValues(b);code='LYR-'+Array.from(b,x=>alphabet[x%alphabet.length]).join('')}while(COMPATIBLE_APPS.some(a=>a.code===code));return code}
function registrySafeUrl(u){try{const x=new URL(u);return x.protocol==='https:'?x.href:null}catch(e){return null}}
function registryMotionMs(){const n=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyra-motion'));return Number.isFinite(n)?n:240}
function registryFadeIn(el){if(!el||el.hidden||!registryMotionMs())return;el.animate([{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:registryMotionMs(),easing:'ease-out'})}
function registryFadeOutSnapshot(el){
 if(!el||el.hidden||!registryMotionMs())return;
 const parent=$('appList');if(!parent)return;
 const rect=el.getBoundingClientRect(),base=parent.getBoundingClientRect();
 const ghost=el.cloneNode(true);ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));
 Object.assign(ghost.style,{position:'absolute',left:(rect.left-base.left+parent.scrollLeft)+'px',top:(rect.top-base.top+parent.scrollTop)+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',pointerEvents:'none',zIndex:'15',overflow:'hidden'});
 const oldPosition=getComputedStyle(parent).position;if(oldPosition==='static')parent.style.position='relative';parent.append(ghost);
 const a=ghost.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-7px)'}],{duration:registryMotionMs()*1.15,easing:'ease-in',fill:'forwards'});
 a.onfinish=a.oncancel=()=>ghost.remove();
}
let registrySwitchToken=0;
function registryWait(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)))}
async function registrySetOffline(v){
 v=!!v;if(v===registryOffline)return;
 const token=++registrySwitchToken;
 const list=$('appList'),online=$('registryOnlineContent'),offline=$('registryOfflineHint');
 const outgoing=registryOffline?offline:online;
 const ms=registryMotionMs();
 // Switch indicator updates immediately; content waits for its exit to finish.
 registryOffline=v;
 $('registryOfflineToggle').classList.toggle('isOffline',v);
 $('registryOfflineToggle').setAttribute('aria-checked',String(!v));
 $('registryOnlineLabel').classList.toggle('registryNetworkInactive',v);
 $('registryOfflineLabel').classList.toggle('registryNetworkInactive',!v);
 if(ms&&outgoing&&!outgoing.hidden){
  const anim=outgoing.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-8px)'}],{duration:ms*1.15,easing:'ease-in',fill:'forwards'});
  try{await anim.finished}catch(e){}
  if(token!==registrySwitchToken){anim.cancel();return}
  anim.cancel();
 }
 if(token!==registrySwitchToken)return;
 const oldHeight=list.getBoundingClientRect().height;
 const importArea=$('registryImportFoldContent');
 if(importArea)importArea.hidden=v?false:$('registryFilterSection').classList.contains('collapsed');
 const foldWrap=$('registryAnimatedFold');if(foldWrap)foldWrap.classList.toggle('registryOfflineMode',v);
 online.hidden=v;$('registryFilterSection').hidden=v;offline.hidden=!v;
 $('registryModeLabel').textContent=v?'Offline · native picker only':'Local directory · server not configured';
 if(!v)renderCompatibleResults(true);
 const newHeight=list.getBoundingClientRect().height;
 if(ms&&Math.abs(oldHeight-newHeight)>2){
  const anim=list.animate([{height:oldHeight+'px'},{height:newHeight+'px'}],{duration:ms,easing:'cubic-bezier(.22,1,.36,1)'});
  try{await anim.finished}catch(e){}
  if(token!==registrySwitchToken){anim.cancel();return}
  anim.cancel();
 }
 if(token!==registrySwitchToken)return;
 registryFadeIn(v?offline:online);
}
function registryToggleFilters(){
 if(registryOffline)return;
 const section=$('registryFilterSection'),filters=$('registryFilters'),importArea=$('registryImportFoldContent'),fold=$('registryFilterFold');
 if(!section||!filters||!importArea||!fold)return;
 const closing=!section.classList.contains('collapsed');
 const ms=registryMotionMs();
 // Cancel any previous fold animation and always restore a clean layout.
 if(registryToggleFilters.animation){registryToggleFilters.animation.cancel();registryToggleFilters.animation=null}
 filters.style.removeProperty('display');filters.style.removeProperty('opacity');
 importArea.style.removeProperty('display');importArea.style.removeProperty('opacity');
 const oldH=section.offsetHeight+importArea.offsetHeight;
 section.classList.toggle('collapsed',closing);importArea.hidden=closing;
 fold.textContent=closing?'⌄':'⌃';fold.setAttribute('aria-expanded',String(!closing));
 fold.setAttribute('aria-label',closing?'Expand filters and import':'Collapse filters and import');fold.title=fold.getAttribute('aria-label');
 const newH=section.offsetHeight+importArea.offsetHeight;
 const wrap=$('registryAnimatedFold');
 if(wrap&&ms&&Math.abs(oldH-newH)>2){
  const a=wrap.animate([{height:oldH+'px',opacity:closing?1:.7},{height:newH+'px',opacity:1}],{duration:ms*(closing?1.15:1),easing:'cubic-bezier(.22,1,.36,1)'});
  registryToggleFilters.animation=a;a.onfinish=a.oncancel=()=>{if(registryToggleFilters.animation===a)registryToggleFilters.animation=null};
 }
}

const externalAudioExt=new Set(['mp3','wav','flac','m4a','aac','ogg','oga','opus','webm','mp4','aiff','aif']);
const importProviders=new Map();
let compatibleSelected=null,externalImportBusy=false;
const detectedNativeApps=new Map();
let nativeDiscoveryPromise=null;
async function refreshNativeApps(){
 const bridge=getLyraAndroidBridge();
 if(!bridge){detectedNativeApps.clear();return [];}
 try{
  const result=await bridge.getInstalledApps();
  const apps=Array.isArray(result?.apps)?result.apps:[];
  detectedNativeApps.clear();
  for(const app of apps){if(app?.packageName)detectedNativeApps.set(app.packageName,app);}
  return apps;
 }catch(error){detectedNativeApps.clear();throw error;}
}
function startNativeDiscovery(){
 if(!getLyraAndroidBridge())return Promise.resolve([]);
 nativeDiscoveryPromise=refreshNativeApps().then(apps=>{
  if(!compatibleSelected)renderCompatibleResults(true);
  else showCompatibleDetails(compatibleSelected);
  return apps;
 }).catch(()=>[]);
 return nativeDiscoveryPromise;
}
function compatibleApp(id){return COMPATIBLE_APPS.find(app=>app.id===id)||null}
function showCompatibleList(){
  compatibleSelected=null;
  $('appList').hidden=false;$('appDetails').hidden=true;
  $('compatibleTitle').textContent='Compatible Apps';
  $('registryAddTop').hidden=false;$('registrySettingsTop').hidden=!lyraCan('entries.edit');
  renderCompatibleResults();
}
function renderCompatibleResults(immediate=false){
  const q=$('compatibleSearch').value.trim().toLocaleLowerCase();
  const matches=COMPATIBLE_APPS.filter(app=>{
    const codeMatch=!!q&&app.code?.toLowerCase()===q;
    const publicMatch=app.visibility==='public'&&(!q||app.name.toLowerCase().includes(q));
    if(!(app.visibility!=='private'&&(codeMatch||publicMatch)))return false;
    if(registryFilter==='certified'&&!app.certified)return false;
    if(registryFilter==='unverified'&&app.certified)return false;
    if(registryFilter==='installed'&&!(getLyraAndroidBridge()?detectedNativeApps.has(app.packageId):app.installed==='yes'))return false;
    if(registryFilter==='notinstalled'&&!(getLyraAndroidBridge()?!detectedNativeApps.has(app.packageId):app.installed==='no'))return false;
    return true;
  });
  const host=$('compatibleResults');
  // Complete exit before removing old app cards; then animate the container resize.
  const token=++renderCompatibleResults.token;
  const ms=registryMotionMs();
  if(!immediate&&ms&&host.childElementCount){
    host.getAnimations().forEach(a=>a.cancel());
    const exit=host.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-6px)'}],{duration:ms*1.15,easing:'ease-in',fill:'forwards'});
    exit.finished.then(()=>{
      if(token!==renderCompatibleResults.token)return;
      exit.cancel();renderCompatibleResultsCommit(matches,token);
    }).catch(()=>{});
    return;
  }
  renderCompatibleResultsCommit(matches,token);
}
renderCompatibleResults.token=0;
function renderCompatibleResultsCommit(matches,token){
  if(token!==renderCompatibleResults.token)return;
  const host=$('compatibleResults');
  const before=host.getBoundingClientRect().height;
  host.replaceChildren();$('compatibleEmpty').hidden=matches.length>0;

  matches.forEach(app=>{
    const option=document.createElement('button');option.type='button';option.className='appOption';
    const icon=document.createElement('span');icon.className='appIcon';
    if(registrySafeUrl(app.iconUrl)){const img=document.createElement('img');img.className='registryIconImg';img.alt='';img.src=app.iconUrl;img.onerror=()=>{icon.replaceChildren(document.createTextNode((app.name||'?')[0]))};icon.append(img)}else icon.textContent=(app.name||'?')[0];
    const desc=document.createElement('span');desc.className='appDesc';const title=document.createElement('b');title.textContent=app.name;
    const status=document.createElement('small');status.textContent=app.certified?'✓ Lyra Verified (local test label)':app.description||'Not certified';if(app.certified)status.className='registryCertified';
    const sub=document.createElement('small');sub.textContent=app.code+' · '+(getLyraAndroidBridge()?(detectedNativeApps.has(app.packageId)?'Installed · supported':'App not found / unsupported'):(app.installed==='yes'?'Installed (manual)':app.installed==='no'?'Not installed (manual)':'Installation unknown'));
    desc.append(title,status,sub);const tag=document.createElement('span');tag.className='compatibleTag';tag.textContent=importProviders.has(app.id)?'Ready':'Planned';
    option.append(icon,desc,tag);option.onclick=()=>showCompatibleDetails(app.id);host.append(option);
  });
  const after=host.getBoundingClientRect().height;
  const ms=registryMotionMs();
  if(ms&&Math.abs(before-after)>2){
    host.animate([{height:before+'px'},{height:after+'px'}],{duration:ms,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  if(ms)registryFadeIn(host);
}
function showCompatibleDetails(appId){
  const app=compatibleApp(appId);if(!app)return;
  compatibleSelected=app.id;
  $('appList').hidden=true;$('appDetails').hidden=false;
  $('compatibleTitle').textContent=app.name;
  $('registryEditApp').hidden=!lyraCan('entries.edit');$('registryCertifyApp').hidden=!lyraCan('certifications.manage');
  $('registryAddTop').hidden=true;$('registrySettingsTop').hidden=true;
  $('compatibleAppName').textContent=app.name;
  $('compatibleAppIcon').textContent=(app.name||'?')[0];
  $('registryDetailMeta').textContent=(app.description||'')+' · '+app.code+' · '+app.visibility+' · '+(app.packageId||'Package not set');
  $('registryCertDetails').textContent=app.certified?'✓ Lyra Verified (local prototype) · version '+(app.certVersion||'unspecified')+' · '+(app.certDate||'')+' · '+(app.certNotes||'No notes'):'Not verified · no completed security assessment';
  $('compatibleAppStatus').textContent=getLyraAndroidBridge()?(detectedNativeApps.has(app.packageId)?'Installed · Lyra import supported':'App not found / unsupported'):(importProviders.has(app.id)?'Import available':'Integration planned');
  const links=$('compatibleAppLinks');links.replaceChildren();
  if((app.links||[]).length){
    app.links.forEach(link=>{
      const btn=document.createElement('button');btn.type='button';btn.className='linkOption';
      btn.textContent=link.label;
      btn.onclick=()=>{const url=registrySafeUrl(link.url);if(url)window.open(url,'_blank','noopener,noreferrer')};btn.disabled=!registrySafeUrl(link.url);
      links.append(btn);
    });
  }else{
    const info=document.createElement('p');info.className='muted';info.textContent='No official links configured yet.';
    links.append(info);
  }
  $('compatibleImportHint').textContent=getLyraAndroidBridge()?'Lyra checks the package ID and import protocol before opening the app.':importProviders.has(app.id)
    ?'Choose a song in '+app.name+'. You can then import into a new or the current Lyra project.'
    :'Direct import requires an adapter in '+app.name+' and a native Lyra app. The browser demo can import a local file.';
}
function showCompatibleImportNotice(app){
  $('compatibleImportNoticeText').textContent=
    'Opening '+app.name+' and choosing a song is not available in the browser version yet. '+
    'Once '+app.name+' supports Lyra Import Protocol v1 and Lyra has a native bridge, this button can launch the song picker.\n\n'+
    'You can already test the shared import pipeline with a local audio file.';
  $('compatibleImportNotice').classList.add('open');
}
function askImportDestination(songTitle){
  // Intentional user choice; neither file arrival nor selection silently overwrites lyrics/audio.
  return new Promise(resolve=>{
    const modal=$('importDestination');
    const currentAvailable=!!currentId&&!document.body.classList.contains('view-gallery')&&!!localStorage.getItem(PROJ+currentId);
    $('importDestinationSummary').textContent='Selected audio: '+songTitle;
    $('importDestinationCurrent').disabled=!currentAvailable;
    $('importDestinationWarning').textContent=currentAvailable
      ?'Current Project replaces its audio while keeping all your lyrics and timing. Existing audio will be replaced.'
      :'Open a Lyra project first to import into the current project.';
    let done=false;
    const finish=choice=>{
      if(done)return;done=true;
      modal.classList.remove('open');
      $('importDestinationNew').onclick=null;
      $('importDestinationCurrent').onclick=null;
      $('importDestinationCancel').onclick=null;
      modal.removeEventListener('click',onBackdrop);
      document.removeEventListener('keydown',onKey);
      resolve(choice);
    };
    const onBackdrop=e=>{if(e.target===modal)finish('cancel')};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish('cancel')}};
    $('importDestinationNew').onclick=()=>finish('new');
    $('importDestinationCurrent').onclick=()=>{if(currentAvailable)finish('current')};
    $('importDestinationCancel').onclick=()=>finish('cancel');
    modal.addEventListener('click',onBackdrop);
    document.addEventListener('keydown',onKey);
    modal.classList.add('open');
    $('importDestinationNew').focus();
  });
}
async function receiveExternalSong(payload){
  if(externalImportBusy)throw new Error('Another song import is already running.');
  if(!payload||typeof payload!=='object')throw new TypeError('Song metadata and an audio File are required.');
  const blob=payload.audioFile||payload.file;
  if(!(blob instanceof Blob))throw new TypeError('audioFile must be a File or Blob. Native adapters must provide a readable local file.');
  const rawName=String(payload.fileName||blob.name||'imported-audio.mp3').replace(/[\\/]/g,'_');
  const fileName=rawName.slice(0,180)||'imported-audio.mp3';
  const ext=(fileName.split('.').pop()||'').toLowerCase();
  if(!externalAudioExt.has(ext)||!blob.size)throw new TypeError('Select a supported non-empty audio file (MP3, FLAC, WAV, M4A, OGG, etc.).');
  if(blob.type&&(blob.type.startsWith('image/')||blob.type.startsWith('video/')||blob.type==='text/html'||blob.type.includes('zip'))){
    throw new TypeError('This is not a supported audio file.');
  }
  const file=blob instanceof File&&blob.name===fileName?blob:new File([blob],fileName,{type:blob.type||'application/octet-stream'});
  const title=String(payload.title||baseName(fileName)).trim().slice(0,180)||baseName(fileName);
  const artist=String(payload.artist||'').trim().slice(0,180);
  externalImportBusy=true;
  let id=null,choice='cancel';
  try{
    // Hide the informational popup first, then show the project destination chooser.
    $('compatibleImportNotice').classList.remove('open');
    choice=await askImportDestination(title);
    if(choice==='cancel')return {ok:false,reason:'cancelled'};
    flushAutosave();audio.pause();
    if(choice==='current'){
      // One audio file per project. Preserve existing lyrics and all existing word timings.
      if(!currentId||document.body.classList.contains('view-gallery'))throw new Error('No active Lyra project.');
      id=currentId;
      const previousAudio=await loadAudioFile('p:'+id);
      await idbOp('readwrite',store=>store.put(file,'p:'+id));
      try{
        // setAudioFile's normal persistence is skipped: IndexedDB write already succeeded.
        setAudioFile(file,false,false);
        if(!$('song').value.trim()){$('song').value=title;nameManual=true}
        if(!$('artist').value.trim()&&artist)$('artist').value=artist;
        markChange();
        if(!doSave('manual',true))throw new Error('Could not save project metadata');
        updateFileSummary();
      }catch(error){
        if(previousAudio)await idbOp('readwrite',st=>st.put(previousAudio,'p:'+id));
        else await clearAudioFile('p:'+id);
        // Restore the pre-import editor state (if possible).
        const saved=localStorage.getItem(PROJ+id);
        if(saved)restore(saved);
        if(previousAudio)setAudioFile(previousAudio,false,false);
        throw error;
      }
      $('stashChooser').classList.remove('open');
      showSaveToast({info:true,text:'Audio imported into current project. Lyrics kept.'});
      return {ok:true,projectId:id,destination:'current'};
    }
    id=newId();
    // Save audio first so an IndexedDB/quota error cannot create an orphaned project.
    await idbOp('readwrite',store=>store.put(file,'p:'+id));
    const project={song:title,artist,lines:[],audioFileName:fileName,audioFileSize:file.size,nameManual:true};
    const now=Date.now();
    try{
      localStorage.setItem(PROJ+id,JSON.stringify(project));
      if(!localStorage.getItem(PROJ+id))throw new Error('Project storage unavailable');
      const idx=getIndex();idx.push({id,song:title,artist,audioFileName:fileName,audioFileSize:file.size,duration:0,total:0,timed:0,created:now,modified:now});setIndex(idx);
    }catch(err){await clearAudioFile('p:'+id);throw err}
    $('stashChooser').classList.remove('open');
    await enterEditor(id);
    doSave('manual',true);
    showSaveToast({info:true,text:'Imported '+title+' as a new Lyra project.'});
    return {ok:true,projectId:id,destination:'new'};
  }catch(err){
    if(choice==='new'&&id&&!localStorage.getItem(PROJ+id))await clearAudioFile('p:'+id);
    throw err;
  }finally{externalImportBusy=false}
}
// Provider adapters register when the APK's native layer loads. No server/API key is needed.
window.LyraImport=Object.freeze({
  protocol:'lyra-import-v1',version:1,
  receiveSong:receiveExternalSong,
  registerProvider(appId,chooseSong){
    if(typeof chooseSong!=='function')throw new TypeError('Provider handler must be a function.');
    if(!compatibleApp(appId))throw new Error('Unregistered app: '+appId);
    importProviders.set(appId,chooseSong);renderCompatibleResults();
    if(compatibleSelected===appId)showCompatibleDetails(appId);
  },
  unregisterProvider(appId){importProviders.delete(appId);renderCompatibleResults();if(compatibleSelected===appId)showCompatibleDetails(appId)},
  async requestSong(appId){
    if(!compatibleApp(appId))throw new Error('Unknown app: '+appId);
    const chooseSong=importProviders.get(appId);
    if(!chooseSong)return {ok:false,reason:'not-connected'};
    const song=await chooseSong({appId,protocol:'lyra-import-v1',version:1});
    if(!song)return {ok:false,reason:'cancelled'};
    return receiveExternalSong(song);
  }
});
// Lyra local role management v1 (prototype; local passwords are not secure credentials).
const LYRA_ROLES_KEY='lyra-local-roles-v1';
const LYRA_REQUESTS_KEY='lyra-local-ownership-requests-v1';
const LYRA_RIGHTS=[
 ['requests.view','Requests · View',0],['requests.decide','Requests · Accept / Decline',1],
 ['entries.edit','Entries · Edit',0],['entries.approve','Entries · Approve / Reject',1],
 ['certifications.manage','Manage Certifications',0],
 ['roles.view','Roles · View',0],['roles.manage','Roles · Manage',1]
];
const LYRA_DEFAULT_ROLES=[{id:'admin',name:'Admin',password:'Admin123',rights:['*']},
 {id:'tester',name:'Tester',password:'Tester123',rights:['requests.view','entries.edit']}];
function lyraRoleRead(){try{const v=JSON.parse(localStorage.getItem(LYRA_ROLES_KEY));if(Array.isArray(v)){const list=v.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string'&&typeof x.password==='string'&&Array.isArray(x.rights));if(list.some(x=>x.id==='admin'))return list;}}catch(e){}return structuredClone(LYRA_DEFAULT_ROLES)}
let lyraRoles=lyraRoleRead();
// Admin is immutable in its effective permissions, including after migrated local settings.
function lyraStoreRoles(){localStorage.setItem(LYRA_ROLES_KEY,JSON.stringify(lyraRoles))}
let lyraSessionRoleId=null; // Intentionally not saved: reset on WebView/app startup.
function lyraRole(){return lyraRoles.find(r=>r.id===lyraSessionRoleId)||null}
function lyraCan(permission){const r=lyraRole();return !!r&&(r.id==='admin'||r.rights.includes(permission))}
function lyraGuard(permission){if(lyraCan(permission))return true;alert('Permission denied. Unlock the required role under Extra → Admin.');return false}
function lyraRefreshAdmin(){
 const r=lyraRole();$('adminLogin').hidden=!!r;$('adminDashboard').hidden=!r;
 $('adminCurrentRole').textContent=r?'Logged in as '+r.name+' · local session':'';
 $('registrySettingsTop').hidden=!lyraCan('entries.edit');
 $('registryEditApp').hidden=!lyraCan('entries.edit');$('registryCertifyApp').hidden=!lyraCan('certifications.manage');
 $('adminManageEntries').hidden=!lyraCan('entries.edit');$('adminManageCerts').hidden=!lyraCan('certifications.manage');
 $('adminManageRequests').hidden=!lyraCan('requests.view');$('adminManageRoles').hidden=!lyraCan('roles.view');
 if(!lyraCan('roles.view'))$('adminRolePanel').hidden=true;
 if(!lyraCan('requests.view'))$('adminRequestsPanel').hidden=true;
 ['registrySettingsTop','registryEditApp','registryCertifyApp'].forEach(id=>$(id).classList.add('lyraAdminTool'));
 $('adminEntry').textContent=r?'🛡 Admin · '+r.name:'🛡 Admin';
}
$('adminEntry').onclick=()=>{$('adminModal').classList.add('open');lyraRefreshAdmin()};
$('adminClose').onclick=()=>$('adminModal').classList.remove('open');
$('adminLoginPassword').onkeydown=e=>{if(e.key==='Enter')$('adminUnlock').click()};
$('adminUnlock').onclick=()=>{
 const pw=$('adminLoginPassword').value;
 const r=lyraRoles.find(x=>x.password===pw);
 if(!r){$('adminLoginFeedback').textContent='Incorrect password.';return}
 lyraSessionRoleId=r.id;$('adminLoginPassword').value='';$('adminLoginFeedback').textContent='';lyraRefreshAdmin();
};
$('adminLogOut').onclick=()=>{lyraSessionRoleId=null;['adminRolePanel','adminRequestsPanel','adminOwnPasswordPanel'].forEach(id=>$(id).hidden=true);lyraRefreshAdmin()};
$('adminShowPassword').onclick=()=>{$('adminOwnPasswordPanel').hidden=!$('adminOwnPasswordPanel').hidden};
$('adminChangePassword').onclick=()=>{
 const r=lyraRole();if(!r)return;
 const old=$('adminOldPassword').value, next=$('adminNewPassword').value;
 if(old!==r.password){$('adminPasswordFeedback').textContent='Current password is incorrect.';return}
 if(next.length<6){$('adminPasswordFeedback').textContent='New password must have at least 6 characters.';return}
 if(lyraRoles.some(x=>x!==r&&x.password===next)){$('adminPasswordFeedback').textContent='This password is already used by another role.';return}
 r.password=next;lyraStoreRoles();$('adminOldPassword').value='';$('adminNewPassword').value='';$('adminPasswordFeedback').textContent='Password changed locally.';
};
function lyraRenderRoleEditor(){
 if(!lyraCan('roles.view'))return;
 const select=$('adminRoleSelect'),prior=select.value;select.replaceChildren();
 lyraRoles.forEach(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name;select.append(o)});
 if(lyraCan('roles.manage')){const option=document.createElement('option');option.value='__create__';option.textContent='＋ Create a role…';select.append(option)}
 select.value=(prior==='__create__'&&lyraCan('roles.manage'))?'__create__':lyraRoles.some(r=>r.id===prior)?prior:(lyraSessionRoleId||'admin');
 lyraLoadSelectedRole();
}
function lyraLoadSelectedRole(){
 const creating=$('adminRoleSelect').value==='__create__'&&lyraCan('roles.manage');
 $('adminRoleEditPanel').hidden=creating;$('adminRoleCreatePanel').hidden=!creating;
 if(creating){$('adminRoleFeedback').textContent='Enter a name and password to create a new role.';return}
 const r=lyraRoles.find(x=>x.id===$('adminRoleSelect').value);if(!r)return;
 const isAdmin=r.id==='admin',canEdit=lyraCan('roles.manage')&&!isAdmin;
 $('adminRoleName').value=r.name;$('adminRoleName').disabled=!canEdit;
 $('adminRolePassword').value='';$('adminRolePassword').disabled=!canEdit;
 $('adminRoleDelete').disabled=!canEdit;$('adminRoleSave').disabled=!canEdit;
 $('adminRoleCreate').disabled=!lyraCan('roles.manage');$('adminRoleNewName').disabled=!lyraCan('roles.manage');$('adminRoleNewPassword').disabled=!lyraCan('roles.manage');
 const box=$('adminRoleRights');box.replaceChildren();
 let group=null,sub=null;
 const names={'requests.view':'Requests','entries.edit':'Entries','certifications.manage':'Certifications','roles.view':'Role management'};
 LYRA_RIGHTS.forEach(([id,label,depth])=>{
  if(!depth){
   group=document.createElement('section');group.className='lyraPermissionGroup';
   const heading=document.createElement('div');heading.className='lyraPermissionGroupTitle';heading.textContent=names[id]||label;group.append(heading);box.append(group);
   sub=document.createElement('div');sub.className='lyraPermissionSub';
  }
  const line=document.createElement('label');line.className='lyraPermissionRow';
  const chk=document.createElement('input');chk.type='checkbox';chk.value=id;chk.checked=isAdmin||r.rights.includes(id);chk.disabled=!canEdit;
  const labelText=document.createElement('span');labelText.textContent=label.includes(' · ')?label.split(' · ').slice(1).join(' · '):label;
  line.append(chk,labelText);
  if(depth){if(group&&!sub.isConnected)group.append(sub);(group?sub:box).append(line)}else group.append(line);
 });
 $('adminRoleFeedback').textContent=isAdmin?'The Admin role cannot be deleted or managed by other roles. Change its password under Change My Password.':'';
}
$('adminRoleSelect').onchange=lyraLoadSelectedRole;
$('adminManageRoles').onclick=()=>{if(!lyraGuard('roles.view'))return;$('adminRolePanel').hidden=!$('adminRolePanel').hidden;if(!$('adminRolePanel').hidden)lyraRenderRoleEditor()};
$('adminRoleSave').onclick=()=>{
 if(!lyraGuard('roles.manage'))return;
 const r=lyraRoles.find(x=>x.id===$('adminRoleSelect').value);if(!r||r.id==='admin')return;
 const name=$('adminRoleName').value.trim(),pw=$('adminRolePassword').value;
 if(!name){$('adminRoleFeedback').textContent='Role name is required.';return}
 if(lyraRoles.some(x=>x!==r&&x.name.toLowerCase()===name.toLowerCase())){$('adminRoleFeedback').textContent='Role name already exists.';return}
 if(pw&&pw.length<6){$('adminRoleFeedback').textContent='Password must have at least 6 characters.';return}
 if(pw&&lyraRoles.some(x=>x!==r&&x.password===pw)){$('adminRoleFeedback').textContent='Password already used by another role.';return}
 r.name=name;if(pw)r.password=pw;r.rights=[...$('adminRoleRights').querySelectorAll('input:checked')].map(x=>x.value);
 lyraStoreRoles();lyraRefreshAdmin();lyraRenderRoleEditor();$('adminRoleFeedback').textContent='Role updated locally.';
};
$('adminRoleDelete').onclick=()=>{
 if(!lyraGuard('roles.manage'))return;const id=$('adminRoleSelect').value;
 if(id==='admin'){alert('The Admin role cannot be deleted.');return}
 if(id===lyraSessionRoleId){alert('You cannot delete your current role.');return}
 if(!confirm('Delete this role?'))return;
 lyraRoles=lyraRoles.filter(x=>x.id!==id);lyraStoreRoles();lyraRenderRoleEditor();
};
$('adminRoleCreate').onclick=()=>{
 if(!lyraGuard('roles.manage'))return;
 const name=$('adminRoleNewName').value.trim(),pw=$('adminRoleNewPassword').value;
 if(!name||pw.length<6){$('adminRoleFeedback').textContent='Enter a name and a password of at least 6 characters.';return}
 if(lyraRoles.some(x=>x.name.toLowerCase()===name.toLowerCase()||x.password===pw)){$('adminRoleFeedback').textContent='Role name or password already exists.';return}
 const id='role-'+crypto.randomUUID();lyraRoles.push({id,name,password:pw,rights:[]});lyraStoreRoles();
 $('adminRoleNewName').value='';$('adminRoleNewPassword').value='';lyraRenderRoleEditor();$('adminRoleSelect').value=id;lyraLoadSelectedRole();$('adminRoleFeedback').textContent='Role created. Choose its permissions and save.';
};
function lyraGetRequests(){try{const x=JSON.parse(localStorage.getItem(LYRA_REQUESTS_KEY));return Array.isArray(x)?x:[]}catch(e){return []}}
function lyraStoreRequests(x){localStorage.setItem(LYRA_REQUESTS_KEY,JSON.stringify(x))}
function lyraRenderRequests(){
 const box=$('adminRequestsList');box.replaceChildren();const requests=lyraGetRequests();
 if(!requests.length){box.textContent='No local ownership requests.';return}
 requests.forEach(q=>{const row=document.createElement('div');const label=document.createElement('p');label.textContent=q.packageId+' · '+q.reason+' · '+q.status;row.append(label);
 if(q.status==='pending'&&lyraCan('requests.decide'))['Accept','Decline'].forEach(action=>{const b=document.createElement('button');b.type='button';b.textContent=action;b.onclick=()=>{if(!lyraGuard('requests.decide'))return;q.status=action.toLowerCase();lyraStoreRequests(requests);lyraRenderRequests()};row.append(b)});box.append(row)})
}
$('adminManageRequests').onclick=()=>{if(!lyraGuard('requests.view'))return;$('adminRequestsPanel').hidden=!$('adminRequestsPanel').hidden;if(!$('adminRequestsPanel').hidden)lyraRenderRequests()};
$('adminManageEntries').onclick=()=>{if(!lyraGuard('entries.edit'))return;$('adminModal').classList.remove('open');$('stashChooser').classList.add('open');showCompatibleList();openRegManager()};
$('adminManageCerts').onclick=()=>{if(!lyraGuard('certifications.manage'))return;$('adminModal').classList.remove('open');$('stashChooser').classList.add('open');showCompatibleList();openRegManager();$('regFeedback').textContent='Choose an app, then open its Certificate button from the app details.'};
lyraRefreshAdmin();

// Local-only developer/admin directory. No authentication or remote certification yet.
// Bind directly where registrySetOffline is defined; no late observer dependency.
$('registryOfflineToggle').onclick=(event)=>{event.preventDefault();registrySetOffline(!registryOffline)};
$('registryOnlineLabel').onclick=()=>registrySetOffline(false);
$('registryOfflineLabel').onclick=()=>registrySetOffline(true);
$('registryFilterFold').onclick=(e)=>{e.preventDefault();registryToggleFilters()};
// Filter fold is controlled by the animated handler below.
$('registryFilters').querySelectorAll('[data-filter]').forEach(btn=>btn.onclick=()=>{registryFilter=registryFilter===btn.dataset.filter?'all':btn.dataset.filter;$('registryFilters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.filter===registryFilter));renderCompatibleResults()});
function regAddLink(label='',url=''){
 const row=document.createElement('div');row.className='regLinkRow';const a=document.createElement('input');a.placeholder='Link label';a.value=label;const b=document.createElement('input');b.placeholder='https://...';b.value=url;const del=document.createElement('button');del.type='button';del.textContent='×';del.onclick=()=>row.remove();row.append(a,b,del);$('regLinks').append(row);
}
function openRegEditor(id=null){
 if(id&&!lyraGuard('entries.edit'))return;
 registryEditing=id;const select=$('regExisting');select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='+ New app';select.append(blank);COMPATIBLE_APPS.forEach(x=>{const opt=document.createElement('option');opt.value=x.id;opt.textContent=x.name+' · '+x.code+' · '+x.visibility;select.append(opt)});select.value=id||'';const app=id?compatibleApp(id):null;$('registryEditorTitle').textContent=app?'Edit App · '+app.code:'Register App';
 $('regName').value=app?.name||'';$('regPackage').value=app?.packageId||'';$('regDescription').value=app?.description||'';$('regIcon').value=app?.iconUrl||'';$('regVisibility').value=app?.visibility||'private';$('regInstalled').value=app?.installed||'unknown';
 $('regLinks').replaceChildren();(app?.links||[]).forEach(l=>regAddLink(l.label,l.url));$('regDelete').hidden=!app;$('regFeedback').textContent='';$('regConflict').hidden=true;$('regConnectionFeedback').textContent='';$('regExistingWrap').hidden=true;$('registryEditor').classList.add('open');
}
function openRegManager(){if(!lyraGuard('entries.edit'))return;openRegEditor();$('regExistingWrap').hidden=false;$('registryEditorTitle').textContent='⚙ Manage Apps · Admin';$('regFeedback').textContent='Select an existing app to edit, or create a new one.'}
$('regExisting').onchange=e=>openRegEditor(e.target.value||null);$('registryAddTop').onclick=()=>openRegEditor(null);$('registrySettingsTop').onclick=()=>{if(lyraGuard('entries.edit'))openRegManager()};$('registryEditApp').onclick=()=>{if(lyraGuard('entries.edit'))openRegEditor(compatibleSelected)};
$('registryEditorClose').onclick=()=>$('registryEditor').classList.remove('open');$('regAddLink').onclick=()=>regAddLink();
$('regSave').onclick=()=>{
 if(registryEditing&&!lyraGuard('entries.edit'))return;

 const name=$('regName').value.trim(),pkg=$('regPackage').value.trim();if(!name){$('regFeedback').textContent='App name is required.';return}
 if(pkg&&!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)+$/.test(pkg)){$('regFeedback').textContent='Invalid Android package ID.';return}
 if(pkg&&COMPATIBLE_APPS.some(a=>a.id!==registryEditing&&a.packageId===pkg)){$('regFeedback').textContent='Package ID already registered. You may request ownership.';$('regConflict').hidden=false;return} $('regConflict').hidden=true;
 const links=[];for(const row of $('regLinks').children){const [label,url]=row.querySelectorAll('input');if(!label.value.trim()&&!url.value.trim())continue;if(!label.value.trim()||!registrySafeUrl(url.value.trim())){$('regFeedback').textContent='Each link needs a label and a valid HTTPS URL.';return}links.push({label:label.value.trim().slice(0,60),url:url.value.trim()})}
 const iconUrl=$('regIcon').value.trim();if(iconUrl&&!registrySafeUrl(iconUrl)){$('regFeedback').textContent='Icon must be a valid HTTPS URL.';return}
 let app=registryEditing?compatibleApp(registryEditing):null;
 if(!app){const code=registryCode();app={id:code.toLowerCase(),code,certified:false};COMPATIBLE_APPS.push(app)}
 Object.assign(app,{name,packageId:pkg,description:$('regDescription').value.trim(),iconUrl,visibility:$('regVisibility').value,installed:$('regInstalled').value,links});saveRegistry();$('registryEditor').classList.remove('open');showCompatibleList();
};
$('regDelete').onclick=()=>{if(!lyraGuard('entries.edit'))return;const app=compatibleApp(registryEditing);if(!app||!confirm('Delete '+app.name+' from this local directory?'))return;COMPATIBLE_APPS=COMPATIBLE_APPS.filter(x=>x!==app);saveRegistry();$('registryEditor').classList.remove('open');showCompatibleList()};

$('regRequestOwnership').onclick=()=>{
 const pkg=$('regPackage').value.trim();if(!pkg||!COMPATIBLE_APPS.some(a=>a.packageId===pkg))return;
 const reason=prompt('Why should you own or update this entry?');if(!reason?.trim())return;
 const requests=lyraGetRequests();requests.push({id:crypto.randomUUID(),packageId:pkg,reason:reason.trim().slice(0,1000),status:'pending',createdAt:new Date().toISOString()});lyraStoreRequests(requests);
 $('regFeedback').textContent='Ownership request saved on this device. It has not been sent to the Lyra developer.';
};
$('regPickPackage').onclick=async()=>{
 const bridge=getLyraAndroidBridge();if(!bridge){$('regConnectionFeedback').textContent='Installed app selection is available only in the Android APK.';return}
 try{const apps=await refreshNativeApps();if(!apps.length){$('regConnectionFeedback').textContent='No compatible installed apps found.';return}
 const choices=apps.map((x,i)=>(i+1)+'. '+(x.name||x.packageName)+' ('+x.packageName+')').join('\n');
 const choice=prompt('Choose an installed compatible app by number:\n'+choices);if(choice===null)return;
 const idx=Number(choice)-1;if(!Number.isInteger(idx)||idx<0||idx>=apps.length){$('regConnectionFeedback').textContent='Invalid selection.';return}
 $('regPackage').value=apps[idx].packageName;$('regConnectionFeedback').textContent='Selected '+(apps[idx].name||apps[idx].packageName);
 }catch(e){$('regConnectionFeedback').textContent='Cannot load installed apps: '+(e.message||String(e))}
};
$('regTestPackage').onclick=async()=>{
 const pkg=$('regPackage').value.trim();if(!pkg){$('regConnectionFeedback').textContent='Enter a package ID first.';return}
 const bridge=getLyraAndroidBridge();if(!bridge){$('regConnectionFeedback').textContent='Connection testing requires the Android APK.';return}
 $('regConnectionFeedback').textContent='Checking Lyra Import support…';
 try{const res=await bridge.getAppStatus({packageName:pkg});
 if(res?.supported){$('regConnectionFeedback').textContent='Lyra Import supported (Android protocol detected). A real audio import must be tested separately.'}
 else{$('regConnectionFeedback').replaceChildren(document.createTextNode('Import not supported. '));const link=document.createElement('a');link.href='https://github.com/search?q=com.lyra.app.action.PICK_SONG&type=code';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Find protocol examples';$('regConnectionFeedback').append(link)}
 }catch(e){$('regConnectionFeedback').textContent='Connection check failed: '+(e.message||String(e))}
};

const REG_CERT_FIELDS=['Identity','Import','Permissions','Malware','Manual'];
function openRegCertificate(appId){if(!lyraGuard('certifications.manage'))return;const app=compatibleApp(appId);if(!app)return;compatibleSelected=app.id;
 $('regCertAppName').value=app.name+' · '+app.code;
 $('regCertVersion').value=app.certVersion||'';$('regCertNotes').value=app.certNotes||'';
 $('regCertScan').value=app.certScan||'';$('regCertReviewer').value=app.certReviewer||'';
 REG_CERT_FIELDS.forEach(k=>{$('regCert'+k).checked=!!(app.certChecks&&app.certChecks[k])});
 $('regCertCheck').checked=false;$('regCertFeedback').textContent='';$('registryCertification').classList.add('open');
}
$('registryCertifyApp').onclick=()=>openRegCertificate(compatibleSelected);
$('regCertClose').onclick=()=>$('registryCertification').classList.remove('open');
$('regCertSave').onclick=()=>{if(!lyraGuard('certifications.manage'))return;const app=compatibleApp(compatibleSelected);if(!app)return;
 const checks=Object.fromEntries(REG_CERT_FIELDS.map(k=>[k,$('regCert'+k).checked]));
 if(!$('regCertVersion').value.trim()||!$('regCertCheck').checked||!Object.values(checks).every(Boolean)){
  $('regCertFeedback').textContent='Complete all five checks, specify the reviewed version, and confirm the review before issuing Lyra Verified.';return;
 }
 Object.assign(app,{certified:true,certVersion:$('regCertVersion').value.trim(),certNotes:$('regCertNotes').value.trim(),certScan:$('regCertScan').value.trim(),certReviewer:$('regCertReviewer').value.trim(),certChecks:checks,certDate:new Date().toISOString().slice(0,10)});
 saveRegistry();$('registryCertification').classList.remove('open');showCompatibleDetails(app.id);
};
$('regCertRevoke').onclick=()=>{if(!lyraGuard('certifications.manage'))return;const app=compatibleApp(compatibleSelected);if(!app)return;app.certified=false;app.certDate='';saveRegistry();$('registryCertification').classList.remove('open');showCompatibleDetails(app.id)};
const nativePicker=$('nativeAppPicker');
// Capacitor exposes Java @CapacitorPlugin(name="LyraNativeImport") here.
function getLyraAndroidBridge(){
 return window.Capacitor?.Plugins?.LyraNativeImport || null;
}
function nativePickerMessage(message){
 const box=document.createElement('div');box.className='nativePickerEmpty';box.textContent=message;
 $('nativePickerList').replaceChildren(box);
}
async function nativeSongToFile(song){
 if(!song?.uri)throw new Error('The other app did not return an audio URI.');
 const capacitor=window.Capacitor;
 if(typeof capacitor?.convertFileSrc!=='function')throw new Error('Capacitor file bridge is unavailable.');
 // Native Java plugin has already copied the granted content:// URI into Lyra cache.
 const webUrl=capacitor.convertFileSrc(song.uri);
 const response=await fetch(webUrl);
 if(!response.ok)throw new Error('Cannot read imported audio ('+response.status+').');
 const blob=await response.blob();
 if(!blob.size)throw new Error('The imported audio file is empty.');
 const fileName=String(song.fileName||'imported-audio.mp3').replace(/[\\/]/g,'_');
 const file=new File([blob],fileName,{type:song.mimeType||blob.type||'audio/mpeg'});
 return {audioFile:file,fileName,title:song.title||undefined,artist:song.artist||''};
}
async function openNativePicker(){
 $('nativePickerHelp').hidden=true;
 $('nativePickerHelpButton').textContent="Can't see your app? ▾";
 nativePicker.classList.add('open');
 const bridge=getLyraAndroidBridge();
 if(!bridge){nativePickerMessage('Native Android import is only available in the Lyra APK with LyraImportPlugin installed.');return;}
 nativePickerMessage('Searching for compatible installed apps…');
 try{
  const apps=await refreshNativeApps();
  if(!nativePicker.classList.contains('open'))return;
  if(!apps.length){nativePickerMessage('No compatible apps found');return;}
  const list=$('nativePickerList');list.replaceChildren();
  for(const app of apps){
   if(!app||typeof app.packageName!=='string'||!app.packageName)continue;
   const btn=document.createElement('button');btn.type='button';btn.className='nativePickerApp';
   const span=document.createElement('span');const name=document.createElement('b');name.textContent=app.name||app.packageName;
   const pkg=document.createElement('small');pkg.textContent=app.packageName;
   span.append(name,pkg);btn.append(span);
   btn.onclick=async()=>{
    btn.disabled=true;
    try{
     const song=await bridge.pickSong({packageName:app.packageName});
     if(song?.cancelled)return;
     const payload=await nativeSongToFile(song);
     nativePicker.classList.remove('open');
     await window.LyraImport.receiveSong(payload);
    }catch(error){
     nativePicker.classList.add('open');
     $('nativePickerApkStatus').textContent='Import failed: '+(error?.message||String(error));
    }finally{btn.disabled=false;}
   };
   list.append(btn);
  }
 }catch(error){nativePickerMessage('Cannot search installed apps: '+(error?.message||String(error)));}
}
$('registryNativeImport').onclick=openNativePicker;
$('nativePickerClose').onclick=()=>nativePicker.classList.remove('open');
nativePicker.addEventListener('click',e=>{if(e.target===nativePicker)nativePicker.classList.remove('open')});
$('nativePickerHelpButton').onclick=()=>{const help=$('nativePickerHelp');help.hidden=!help.hidden;$('nativePickerHelpButton').textContent=help.hidden?"Can't see your app? ▾":"Can't see your app? ▴"};
$('nativePickerApk').onchange=e=>{
 const file=e.target.files?.[0];
 if(!file){$('nativePickerApkStatus').textContent='No APK selected.';return}
 if(!/\.apk$/i.test(file.name)){$('nativePickerApkStatus').textContent='Please select an .apk file.';e.target.value='';return}
 $('nativePickerApkStatus').textContent='Selected: '+file.name+' ('+(file.size/1024/1024).toFixed(2)+' MB)\nAPK inspection / registration requires a future native or server component. Nothing has been uploaded.';
};
$('nativePickerClearApk').onclick=()=>{$('nativePickerApk').value='';$('nativePickerApkStatus').textContent='No APK selected.'};

$('compatibleApps').onclick=()=>{
  $('compatibleSearch').value='';showCompatibleList();
  $('stashChooser').classList.add('open');
  startNativeDiscovery();
};
$('compatibleSearch').addEventListener('input',renderCompatibleResults);
$('backApps').onclick=showCompatibleList;
$('closeStashChooser').onclick=()=>$('stashChooser').classList.remove('open');
$('stashChooser').addEventListener('click',e=>{if(e.target===$('stashChooser'))$('stashChooser').classList.remove('open')});
$('compatibleImport').onclick=async()=>{
  const app=compatibleApp(compatibleSelected);if(!app)return;
  const btn=$('compatibleImport');btn.disabled=true;
  try{
    const bridge=getLyraAndroidBridge();
    if(bridge){
      if(!app.packageId){await askDialog('App nicht gefunden: Keine Paket-ID für diesen Eintrag hinterlegt.','OK','Close');return;}
      const status=await bridge.getAppStatus({packageName:app.packageId});
      if(!status?.supported){await askDialog('App nicht gefunden oder unterstützt das Lyra-Import-Protokoll nicht.','OK','Close');return;}
      const song=await bridge.pickSong({packageName:app.packageId});
      if(song?.cancelled)return;
      const payload=await nativeSongToFile(song);
      $('stashChooser').classList.remove('open');
      await window.LyraImport.receiveSong(payload);
      return;
    }
    if(!importProviders.has(app.id)){showCompatibleImportNotice(app);return;}
    const result=await window.LyraImport.requestSong(app.id);
    if(!result.ok&&result.reason!=='cancelled')showCompatibleImportNotice(app);
  }catch(e){await askDialog('Song import failed: '+e.message,'OK','Close')}
  finally{btn.disabled=false}
};
$('compatibleNoticeClose').onclick=()=>$('compatibleImportNotice').classList.remove('open');
$('compatibleImportNotice').addEventListener('click',e=>{if(e.target===$('compatibleImportNotice'))$('compatibleImportNotice').classList.remove('open')});
$('compatibleTestAudio').onclick=()=>$('compatibleTestFile').click();
$('compatibleTestFile').onchange=async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{await window.LyraImport.receiveSong({audioFile:file,title:baseName(file.name),artist:''})}
  catch(err){await askDialog('Could not import audio: '+err.message,'OK','Close')}
};
$('supportMe').onclick=()=>toast('Support Me wird später mit der Ko-fi-Seite verbunden.');

['play','pause','back','forward','start'].forEach(id=>{let el=$(id);if(el)el.disabled=true});
if(!history.length)history.push(snapshot());
render();

// ---- UI Fix additions ----
function drawStartMarks(){
  const host=$('startMarks');
  if(!host)return;
  host.innerHTML='';
  if(document.body.classList.contains('player-mode'))return;
  lines.forEach(l=>{
    if(l.start==null||l.end!=null)return;
    const m=document.createElement('div');
    m.className='startMark';
    m.style.left=(Math.max(0,Math.min(1,lyraTimeToX(l.start)))*100)+'%';
    host.appendChild(m);
  });
}
function jumpToTyped(){
  const el=$('jumpTime'),raw=el.value.trim();
  if(!raw)return;
  if(!audio.src){toast('Import a song first.');return}
  const v=parseTime(raw);
  if(!Number.isFinite(v)||v<0){toast('Invalid time. Example: 1:23.5 or 83');return}
  if(v>duration){toast('That is after the end of the song ('+fmt(duration)+').');return}
  t=clampTime(v);audio.currentTime=t;draw();
  el.value='';el.blur();
}
$('jumpGo').onclick=jumpToTyped;
$('jumpTime').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();jumpToTyped()}});
$('song').addEventListener('input',updateFileSummary);
$('song').addEventListener('input',autoSave);
$('artist').addEventListener('input',autoSave);
window.addEventListener('resize',()=>{try{draw()}catch(e){}});
updateFileSummary();
// ---- Gallery ----
const LANG=(navigator.language||'en').toLowerCase().startsWith('de')?'de':'en';
const TX={
  en:{galTitle:'Your songs',galSub:'Pick a song to keep editing, or start a new one.',newSong:'＋ New song',empty:'No songs yet. Tap “New song” to start.',open:'Open',dup:'Duplicate',del:'Delete',untitled:'Untitled Song',noAudio:'No audio yet',lines:(t,n)=>n?t+' of '+n+' lines timed':'No lines yet',edited:'Edited',resume:'You did not close a project. Do you want to keep working on it?',yes:'Yes, continue',no:'No, show songs',delAsk:n=>'Delete “'+n+'” permanently?',delYes:'Delete',cancel:'Cancel',copy:'copy',closeAsk:'Save before closing? Changes since the last save (manual or autosave) will be lost if you do not save.',saved:'Saved.',kind_autosave:'Autosave',kind_manual:'Manual save',kind_close:'Save on close',saveOk:(k,t)=>'✓ '+k+' saved · '+t,saveSame:(k,t)=>'✓ '+k+': nothing changed · '+t,saveFail:k=>'✗ '+k+' failed – could not write to storage',revert:'Revert',reverted:t=>'Reverted to the save from '+t,noRevert:'Nothing to revert.',ls_link:'Last save',ls_title:'Last save',ls_none:'There is no save for this song yet.',ls_saved:'Saved',ls_type:'Type',ls_song:'Song',ls_artist:'Artist',ls_audio:'Audio',ls_lines:'Lines',ls_unsaved:'Changes since then',yes2:'Yes',no2:'No',ls_readonly:'Preview only – cannot be edited here.',close:'Close',lastEdited:'Last edited – tap to continue',save:'Save',dontSave:'Don\'t save'},
  de:{galTitle:'Deine Songs',galSub:'Wähle einen Song zum Weiterbearbeiten oder starte einen neuen.',newSong:'＋ Neuer Song',empty:'Noch keine Songs. Tippe auf „Neuer Song“.',open:'Öffnen',dup:'Duplizieren',del:'Löschen',untitled:'Unbenannter Song',noAudio:'Noch kein Audio',lines:(t,n)=>n?t+' von '+n+' Zeilen getimt':'Noch keine Zeilen',edited:'Bearbeitet',resume:'Du hast ein Projekt nicht geschlossen. Willst du daran weiterarbeiten?',yes:'Ja, weiter',no:'Nein, zur Galerie',delAsk:n=>'„'+n+'“ endgültig löschen?',delYes:'Löschen',cancel:'Abbrechen',copy:'Kopie',closeAsk:'Vor dem Schließen speichern? Änderungen seit dem letzten Speichern (manuell oder Autosave) gehen sonst verloren.',saved:'Gespeichert.',kind_autosave:'Autosave',kind_manual:'Manuelles Speichern',kind_close:'Speichern beim Schließen',saveOk:(k,t)=>'✓ '+k+' erfolgreich · '+t,saveSame:(k,t)=>'✓ '+k+': keine Änderungen · '+t,saveFail:k=>'✗ '+k+' fehlgeschlagen – Speicher nicht beschreibbar',revert:'Rückgängig',reverted:t=>'Zurückgesetzt auf den Stand von '+t,noRevert:'Nichts zum Zurücksetzen.',ls_link:'Letzter Save',ls_title:'Letzter Save',ls_none:'Für diesen Song gibt es noch keinen Save.',ls_saved:'Gespeichert',ls_type:'Art',ls_song:'Song',ls_artist:'Artist',ls_audio:'Audio',ls_lines:'Zeilen',ls_unsaved:'Änderungen seitdem',yes2:'Ja',no2:'Nein',ls_readonly:'Nur Vorschau – hier nicht bearbeitbar.',close:'Schließen',lastEdited:'Zuletzt bearbeitet – tippen zum Weiterarbeiten',save:'Speichern',dontSave:'Nicht speichern'}
};
const tr=k=>TX[LANG][k];
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function fmtShort(x){x=Math.round(Number(x)||0);return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0')}
function askDialog(text,yes,no){
  return new Promise(res=>{
    $('askText').textContent=text;$('askYes').textContent=yes;$('askNo').textContent=no;
    const d=$('askDialog');
    const done=v=>{d.classList.remove('open');$('askYes').onclick=null;$('askNo').onclick=null;res(v)};
    $('askYes').onclick=()=>done(true);$('askNo').onclick=()=>done(false);
    d.classList.add('open');
  });
}
function showView(v){
  document.body.classList.toggle('view-gallery',v==='gallery');
  document.querySelectorAll('.ribbonTab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.ribbonPanel').forEach(x=>x.classList.remove('open'));
  $('exportMenu').classList.remove('open');
  if(v==='gallery')renderGallery();
}
function mkBtn(label,fn,cls){const b=document.createElement('button');b.type='button';b.textContent=label;if(cls)b.className=cls;b.onclick=e=>{e.stopPropagation();fn()};return b}
function renderGallery(){
  $('galTitle').textContent=tr('galTitle');$('galSub').textContent=tr('galSub');$('newSong').textContent=tr('newSong');$('galleryEmpty').textContent=tr('empty');
  const list=$('galleryList');list.innerHTML='';
  const idx=getIndex().slice().sort((a,b)=>(b.modified||0)-(a.modified||0));
  $('galleryEmpty').style.display=idx.length?'none':'block';
  idx.forEach(p=>{
    const card=document.createElement('div');card.className='songCard';
    const main=document.createElement('button');main.type='button';main.className='songMain';
    const title=document.createElement('div');title.className='songTitle';title.textContent=(p.song||'').trim()||tr('untitled');
    const sub=document.createElement('div');sub.className='muted';sub.textContent=[(p.artist||'').trim(),p.audioFileName||tr('noAudio')].filter(Boolean).join(' · ');
    const bits=[];if(p.duration)bits.push(fmtShort(p.duration));if(p.audioFileSize)bits.push((p.audioFileSize/1024/1024).toFixed(2)+' MB');bits.push(tr('lines')(p.timed||0,p.total||0));
    const meta=document.createElement('div');meta.className='muted';meta.textContent=bits.join(' · ');
    const bar=document.createElement('div');bar.className='songBar';const fill=document.createElement('div');fill.style.width=(p.total?Math.round(100*(p.timed||0)/p.total):0)+'%';bar.appendChild(fill);
    const when=document.createElement('div');when.className='muted';when.textContent=tr('edited')+' '+new Date(p.modified||Date.now()).toLocaleString(LANG==='de'?'de-DE':'en-US',{dateStyle:'medium',timeStyle:'short'});
    main.append(title,sub,meta,bar,when);main.onclick=()=>enterEditor(p.id);
    const row=document.createElement('div');row.className='songActions';
    row.append(mkBtn(tr('open'),()=>enterEditor(p.id),'primary'),mkBtn(tr('dup'),()=>duplicateSong(p.id)),mkBtn(tr('del'),()=>deleteSong(p.id)));
    card.append(main,row);list.appendChild(card);
  });
  const lp=$('lastProject');
  if(idx.length){
    const p=idx[0];
    lp.style.display='';
    lp.querySelector('.lpLabel').textContent=tr('lastEdited');
    lp.querySelector('.lpTitle').textContent=(p.song||'').trim()||tr('untitled');
    lp.querySelector('.lpMeta').textContent=[(p.artist||'').trim(),tr('lines')(p.timed||0,p.total||0),new Date(p.modified||Date.now()).toLocaleString(LANG==='de'?'de-DE':'en-US',{dateStyle:'medium',timeStyle:'short'})].filter(Boolean).join(' · ');
    lp.onclick=()=>enterEditor(p.id);
  }else{lp.style.display='none';lp.onclick=null}
}
async function enterEditor(id){
  const raw=localStorage.getItem(PROJ+id);
  if(!raw){toast('Song not found.');renderGallery();return}
  currentId=id;try{localStorage.setItem(CUR,id)}catch(e){}
  history=[raw];future=[];selected=0;restore(raw);
  showView('editor');
  const file=await loadAudioFile();
  if(file){
    setAudioFile(file,false);
    audio.addEventListener('loadedmetadata',()=>{const idx=getIndex(),m=idx.find(p=>p.id===id);if(m&&duration){m.duration=duration;setIndex(idx)}updateFileSummary()},{once:true});
  }
  updateFileSummary();
  try{if(localStorage.getItem('lyra-mode-'+id)==='word')setMode('word')}catch(e){}
}
function newSong(){
  const id=newId();
  try{localStorage.setItem(PROJ+id,JSON.stringify({song:'',artist:'',lines:[],audioFileName:'',audioFileSize:0}))}catch(e){}
  const idx=getIndex();idx.push({id,song:'',artist:'',audioFileName:'',audioFileSize:0,duration:0,total:0,timed:0,created:Date.now(),modified:Date.now()});setIndex(idx);
  enterEditor(id);
}
async function duplicateSong(id){
  const raw=localStorage.getItem(PROJ+id);if(!raw)return;
  const nid=newId(),x=JSON.parse(raw);
  x.song=((x.song||'').trim()||tr('untitled'))+' ('+tr('copy')+')';
  localStorage.setItem(PROJ+nid,JSON.stringify(x));
  const idx=getIndex(),m=idx.find(p=>p.id===id)||{};
  idx.push({...m,id:nid,song:x.song,created:Date.now(),modified:Date.now()});setIndex(idx);
  const f=await loadAudioFile('p:'+id);if(f)await saveAudioFile(f,'p:'+nid);
  renderGallery();
}
async function deleteSong(id){
  const p=getIndex().find(x=>x.id===id),name=((p&&p.song)||'').trim()||tr('untitled');
  if(!await askDialog(tr('delAsk')(name),tr('delYes'),tr('cancel')))return;
  setIndex(getIndex().filter(x=>x.id!==id));
  try{localStorage.removeItem(PROJ+id);localStorage.removeItem(PREV+id)}catch(e){}
  await clearAudioFile('p:'+id);
  renderGallery();
}
$('newSong').onclick=newSong;
async function migrateOld(){
  try{
    if(localStorage.getItem(IDX)!==null)return;
    const old=localStorage.getItem('lyra-autosave');
    if(!old){setIndex([]);return}
    const x=JSON.parse(old),ls=Array.isArray(x.lines)?x.lines:[];
    if(!(ls.length||x.audioFileName||(x.song||'').trim())){setIndex([]);return}
    const id=newId();
    localStorage.setItem(PROJ+id,old);
    setIndex([{id,song:x.song||'',artist:x.artist||'',audioFileName:x.audioFileName||'',audioFileSize:x.audioFileSize||0,duration:0,total:ls.length,timed:ls.filter(l=>l.start!=null&&l.end!=null).length,created:Date.now(),modified:Date.now()}]);
    const f=await loadAudioFile('current');
    if(f){await saveAudioFile(f,'p:'+id);await clearAudioFile('current')}
    localStorage.removeItem('lyra-autosave');
  }catch(e){}
}
// ---- Save feedback, last save preview, revert, close flow ----
function fmtDateTime(ts){return new Date(ts||Date.now()).toLocaleString(LANG==='de'?'de-DE':'en-US',{dateStyle:'medium',timeStyle:'medium'})}
function fmtClock(ts){return new Date(ts||Date.now()).toLocaleTimeString(LANG==='de'?'de-DE':'en-US')}
let saveToastTimer=null,saveTimer=null;
function showSaveToast(o){
  const el=$('saveToast');
  el.classList.remove('ok','fail','info');
  el.classList.add(o.ok===false?'fail':(o.info?'info':'ok'));
  $('saveToastText').textContent=o.text;
  $('saveToastRevert').textContent=tr('revert');
  $('saveToastRevert').style.display=o.canRevert?'':'none';
  el.classList.add('show');
  clearTimeout(saveToastTimer);
  saveToastTimer=setTimeout(()=>el.classList.remove('show'),o.ok===false?9000:6500);
}
$('saveToastClose').onclick=()=>$('saveToast').classList.remove('show');
$('saveToastRevert').onclick=()=>{$('saveToast').classList.remove('show');revertLastSave()};

function doSave(kind,silent){
  if(!currentId)return false;
  const kl=tr('kind_'+kind);
  try{
    const snap=snapshot(),x=JSON.parse(snap),idx=getIndex();
    let m=idx.find(p=>p.id===currentId);
    if(!m){m={id:currentId,created:Date.now()};idx.push(m)}
    const old=localStorage.getItem(PROJ+currentId);
    const unchanged=old===snap;
    if(!unchanged){
      if(old)localStorage.setItem(PREV+currentId,JSON.stringify({snap:old,at:m.savedAt||m.modified||Date.now(),kind:m.savedKind||'autosave'}));
      localStorage.setItem(PROJ+currentId,snap);
      if(localStorage.getItem(PROJ+currentId)!==snap)throw new Error('verify failed');
    }
    m.song=x.song;m.artist=x.artist;m.audioFileName=x.audioFileName;m.audioFileSize=x.audioFileSize;
    if(duration)m.duration=duration;
    m.total=x.lines.length;m.timed=x.lines.filter(l=>l.start!=null&&l.end!=null).length;
    if(!unchanged||kind!=='autosave'){m.savedAt=Date.now();m.savedKind=kind}
    if(!unchanged)m.modified=Date.now();
    setIndex(idx);
    if(!silent&&!(unchanged&&kind==='autosave')){
      const t=fmtClock(m.savedAt);
      showSaveToast({ok:true,text:unchanged?tr('saveSame')(kl,t):tr('saveOk')(kl,t),canRevert:!unchanged&&!!old});
    }
    return true;
  }catch(e){
    if(!silent)showSaveToast({ok:false,text:tr('saveFail')(kl)});
    return false;
  }
}
function saveProject(){return doSave('manual')}
function autoSave(){
  if(!autosave||!currentId)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;doSave('autosave')},1200);
}
function flushAutosave(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;doSave('autosave',true)}}
function cancelAutosave(){clearTimeout(saveTimer);saveTimer=null}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushAutosave()});
window.addEventListener('pagehide',flushAutosave);

function revertLastSave(){
  if(!currentId)return;
  let prev=null;
  try{prev=JSON.parse(localStorage.getItem(PREV+currentId)||'null')}catch(e){}
  if(!prev||!prev.snap){showSaveToast({info:true,text:tr('noRevert')});return}
  cancelAutosave();
  try{
    const x=JSON.parse(prev.snap);
    if(!x.audioFileName&&audioFileName){x.audioFileName=audioFileName;x.audioFileSize=audioFileSize}
    const snap=JSON.stringify(x);
    localStorage.setItem(PROJ+currentId,snap);
    localStorage.removeItem(PREV+currentId);
    const idx=getIndex(),m=idx.find(p=>p.id===currentId);
    if(m){
      m.song=x.song;m.artist=x.artist;m.audioFileName=x.audioFileName;m.audioFileSize=x.audioFileSize;
      m.total=x.lines.length;m.timed=x.lines.filter(l=>l.start!=null&&l.end!=null).length;
      m.savedAt=prev.at;m.savedKind=prev.kind;m.modified=Date.now();
      setIndex(idx);
    }
    history=[snap];future=[];selected=0;restore(snap);updateFileSummary();
    showSaveToast({info:true,text:tr('reverted')(fmtClock(prev.at))});
  }catch(e){showSaveToast({ok:false,text:tr('saveFail')(tr('kind_manual'))})}
}

function showLastSave(){
  let raw=null;
  try{raw=currentId?localStorage.getItem(PROJ+currentId):null}catch(e){}
  const body=$('lsBody');body.innerHTML='';
  $('lsTitle').textContent=tr('ls_title');
  $('lsClose').textContent=tr('close');
  const add=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=txt;body.appendChild(e);return e};
  if(!raw){add('div','muted',tr('ls_none'))}
  else{
    let x={};try{x=JSON.parse(raw)}catch(e){}
    const ls=Array.isArray(x.lines)?x.lines:[],timed=ls.filter(l=>l.start!=null&&l.end!=null),m=getIndex().find(p=>p.id===currentId)||{};
    const rows=[
      [tr('ls_saved'),fmtDateTime(m.savedAt||m.modified)],
      [tr('ls_type'),m.savedKind?tr('kind_'+m.savedKind):'—'],
      [tr('ls_song'),(x.song||'').trim()||tr('untitled')],
      [tr('ls_artist'),(x.artist||'').trim()||'—'],
      [tr('ls_audio'),x.audioFileName?x.audioFileName+(x.audioFileSize?' · '+(x.audioFileSize/1048576).toFixed(2)+' MB':''):tr('noAudio')],
      [tr('ls_lines'),tr('lines')(timed.length,ls.length)],
      [tr('ls_unsaved'),snapshot()!==raw?tr('yes2'):tr('no2')]
    ];
    rows.forEach(([k,v])=>{const r=add('div','lsRow','');const b=document.createElement('b');b.textContent=k+': ';const s=document.createElement('span');s.textContent=v;r.append(b,s)});
    add('div','muted lsNote',tr('ls_readonly'));
    const maxEnd=Math.max(m.duration||0,...timed.map(l=>l.end),0.001);
    const strip=add('div','lsStrip','');
    timed.forEach(l=>{const s=document.createElement('div');s.className='lsSeg';s.style.left=(100*l.start/maxEnd)+'%';s.style.width=Math.max(0.6,100*(l.end-l.start)/maxEnd)+'%';strip.appendChild(s)});
    const list=add('div','lsLines','');
    ls.forEach((l,i)=>{
      const r=document.createElement('div');r.className='lsLine';
      const t=(l.start!=null&&l.end!=null)?fmt(l.start)+' → '+fmt(l.end):'—';
      const txt=l.type==='instrumental'?'♪':((l.text||'').trim()||'…');
      const a=document.createElement('span');a.className='muted';a.textContent=(i+1)+'. '+t;
      const b=document.createElement('div');b.textContent=txt;
      r.append(a,b);list.appendChild(r);
    });
  }
  $('lastSaveDialog').classList.add('open');
}
$('lsClose').onclick=()=>$('lastSaveDialog').classList.remove('open');

function askThree(text,yes,no,cancel){
  return new Promise(res=>{
    $('askText').textContent=text;$('askYes').textContent=yes;$('askNo').textContent=no;$('askCancel').textContent=cancel;
    $('askCancel').style.display='';
    $('askLast').textContent=tr('ls_link');$('askLast').style.display='';$('askLast').onclick=showLastSave;
    const d=$('askDialog');
    const done=v=>{d.classList.remove('open');$('lastSaveDialog').classList.remove('open');$('askCancel').style.display='none';$('askLast').style.display='none';$('askYes').onclick=null;$('askNo').onclick=null;$('askCancel').onclick=null;$('askLast').onclick=null;res(v)};
    $('askYes').onclick=()=>done('yes');$('askNo').onclick=()=>done('no');$('askCancel').onclick=()=>done('cancel');
    d.classList.add('open');
  });
}
let closing=false;
async function closeFlow(){
  if(!currentId||closing)return;
  closing=true;
  try{
    document.querySelectorAll('.ribbonTab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.ribbonPanel').forEach(x=>x.classList.remove('open'));
    $('exportMenu').classList.remove('open');
    const r=await askThree(tr('closeAsk'),tr('save'),tr('dontSave'),tr('cancel'));
    if(r==='cancel')return;
    try{audio.pause()}catch(e){}
    if(r==='yes'){
      cancelAutosave();
      if(!doSave('close'))return;
    }else{
      // Do not save: keep the state of the last manual save or autosave.
      cancelAutosave();
      const m=getIndex().find(p=>p.id===currentId);
      if(m&&!m.audioFileName&&!m.total){
        setIndex(getIndex().filter(p=>p.id!==currentId));
        try{localStorage.removeItem(PROJ+currentId);localStorage.removeItem(PREV+currentId)}catch(e){}
        await clearAudioFile();
      }
    }
    try{localStorage.removeItem(CUR)}catch(e){}
    location.reload();
  }finally{closing=false}
}
$('closeSong').onclick=closeFlow;
$('toGallery').onclick=closeFlow;
$('saveSong').onclick=()=>{if(currentId){cancelAutosave();doSave('manual')}};

// ================= Word by Word mode =================
const wbw={on:false,i:null,word:0,raf:0,stopAt:null,hold:null,sig:null,timeOpen:false};
const WBW_MIN=0.04;
const r3=x=>Math.round(x*1000)/1000;
function wTokens(text){return String(text||'').trim().split(/\s+/).filter(Boolean)}
function wordLabel(w,k){return (w&&w.text)?w.text:'…'+(k+1)}
function ensureWords(l){
  if(l.scratch){
    if(!Array.isArray(l.words))l.words=[];
    l.text=l.words.map(w=>w.text||'').join(' ').trim();
    return false;
  }
  const tk=wTokens(l.text),old=Array.isArray(l.words)?l.words:[];
  if(old.length===tk.length&&old.every((w,i)=>w.text===tk[i]))return false;
  l.words=tk.map((tx,i)=>{const o=old[i],same=o&&o.text===tx;return{text:tx,start:same?o.start:null,end:same?o.end:null,sepBefore:i?' ':''}});
  return true;
}
function finalizeScratch(l){
  if(l.scratch&&Array.isArray(l.words)&&l.words.length&&l.words.every(w=>String(w.text||'').trim()!==''))delete l.scratch;
}
function normalizeInstrumentals(){
  let ch=false;
  lines.forEach(l=>{
    if(l.type==='instrumental'&&l.start!=null&&l.end!=null&&l.end>l.start){
      const w=l.words&&l.words[0];
      if(!(l.words&&l.words.length===1&&w.start===l.start&&w.end===l.end)){l.words=[{text:'♪',start:l.start,end:l.end,sepBefore:''}];ch=true}
    }
  });
  return ch;
}
function rangeOf(l){return l.free?[0,Math.max(duration,0.001)]:[l.start,l.end]}
function wbwClamp(l,x){const r=rangeOf(l);return Math.max(r[0],Math.min(r[1],x))}
function wbwVisible(){
  const out=[];
  lines.forEach((l,i)=>{if(l.type==='instrumental')return;if(l.free||(l.start!=null&&l.end!=null&&l.end>l.start))out.push(i)});
  return out;
}
function syncFree(l){
  const ws=l.words.filter(w=>w.start!=null&&w.end!=null);
  if(!ws.length){l.start=null;l.end=null;return}
  l.start=Math.min(...ws.map(w=>w.start));l.end=Math.max(...ws.map(w=>w.end));
}

function wbwAttach(cell){cell.insertBefore($('wbwClockBox'),cell.firstChild);cell.appendChild($('wbwEditor'))}
function wbwDetach(){const h=$('wbwHolder');h.appendChild($('wbwClockBox'));h.appendChild($('wbwEditor'))}
// ----- cells -----
function wbwCellEl(i){return $('wordCells').querySelector('.wCell[data-i="'+i+'"]')}
function wbwBuildCell(i){
  const cell=document.createElement('div');cell.className='wCell';cell.dataset.i=i;
  const tl=document.createElement('button');tl.type='button';tl.className='wTl';
  tl.innerHTML='<span class="wTitle"></span><span class="wRange"></span><span class="wTrack"><span class="wLine"></span><span class="wBlocks"></span><span class="wHead"></span></span>';
  tl.onclick=()=>wbwActivate(i);
  cell.appendChild(tl);
  return cell;
}
function wbwBlock(blocks,text,title,s,e,a,span,sel,drag){
  const el=document.createElement('span');
  el.className='wBlock'+(sel?' sel':'');
  el.style.left=(100*(s-a)/span)+'%';
  el.style.width=Math.max(0.8,100*(e-s)/span)+'%';
  el.textContent=text;el.title=title;
  blocks.appendChild(el);
  if(drag)wbwAttachDrag(el,drag.i,drag.k);
}
function wbwRefreshCell(i){
  const l=lines[i],cell=wbwCellEl(i);
  if(!l||!cell)return;
  ensureWords(l);
  cell.style.setProperty('--c',colorFor(i));
  const r=rangeOf(l),a=r[0],b=r[1],span=Math.max(b-a,0.001);
  const placed=l.words.filter(w=>w.start!=null&&w.end!=null).length;
  cell.querySelector('.wTitle').textContent=l.name+(l.scratch?'  ·  '+l.words.length+' words':(l.words.length?'  ·  '+placed+'/'+l.words.length+' words':'  ·  no lyrics yet'));
  cell.querySelector('.wRange').textContent=l.free?'full song':fmt(a).slice(0,8)+' – '+fmt(b).slice(0,8);
  const blocks=cell.querySelector('.wBlocks');blocks.innerHTML='';
  l.words.forEach((w,k)=>{
    let s=w.start,e=w.end;
    if(wbw.hold&&wbw.hold.i===i&&wbw.hold.k===k&&!wbw.hold.isNew){s=wbw.hold.start;e=Math.max(s+WBW_MIN,audio.currentTime)}
    if(s==null||e==null)return;
    wbwBlock(blocks,wordLabel(w,k),wordLabel(w,k)+'  '+fmt(s)+' → '+fmt(e),s,e,a,span,wbw.i===i&&wbw.word===k,wbw.i===i?{i,k}:null);
  });
  if(wbw.hold&&wbw.hold.i===i&&wbw.hold.isNew){
    const s=wbw.hold.start,e=Math.max(s+WBW_MIN,audio.currentTime);
    wbwBlock(blocks,'…','new word',s,e,a,span,true);
  }
  cell.classList.toggle('active',wbw.i===i);
}
function wbwClose(){
  if(wbw.i!=null&&lines[wbw.i])finalizeScratch(lines[wbw.i]);
  wbw.i=null;wbw.hold=null;
  wbwDetach();
}
function renderWord(){
  if(!wbw.on)return;
  lines.forEach((l,i)=>{if(i!==wbw.i)finalizeScratch(l)});
  const wrap=$('wordCells'),vis=wbwVisible(),sig=vis.join(',');
  $('wordEmpty').style.display=vis.length||lines.some(l=>l.free)?'none':'block';
  const scratchMode=(lines.length===0||lines.some(l=>l.free));
  $('wbwScratch').style.display=scratchMode?'block':'none';
  $('wbwScratchHint').style.display=lines.length?'none':'block';
  $('wbwMore').style.display=scratchMode?'none':'block';
  if(wbw.i!=null&&!vis.includes(wbw.i))wbwClose();
  if(sig!==wbw.sig){
    wbwDetach();
    wrap.innerHTML='';
    vis.forEach(i=>wrap.appendChild(wbwBuildCell(i)));
    wbw.sig=sig;
    if(wbw.i!=null){const c=wbwCellEl(wbw.i);if(c)wbwAttach(c)}
  }
  vis.forEach(wbwRefreshCell);
  wbwRefreshEditor();
  wbwUpdateHead();
}
function wbwActivate(i){
  const l=lines[i];
  if(!l)return;
  if(wbw.i===i){wbwClose();renderWord();return}
  if(!audio.paused)audio.pause();
  if(wbw.i!=null&&lines[wbw.i])finalizeScratch(lines[wbw.i]);
  wbw.hold=null;
  ensureWords(l);
  if(!l.words.length&&!l.scratch){toast('This line has no lyrics yet. Add them in Line by Line first.');return}
  wbw.i=i;
  const first=l.words.findIndex(w=>w.start==null||w.end==null);
  wbw.word=first<0?(l.scratch?l.words.length:0):first;
  const a=rangeOf(l)[0];t=a;audio.currentTime=a;
  const c=wbwCellEl(i);
  if(c)wbwAttach(c);
  renderWord();draw();
  if(c&&c.scrollIntoView)c.scrollIntoView({block:'nearest',behavior:'smooth'});
}

// ----- editor UI -----
function wbwRefreshEditor(){
  if(wbw.i==null){wbwDetach();return}
  const l=lines[wbw.i];if(!l)return;
  const box=$('wbwWords');box.innerHTML='';
  const nextUnplaced=l.scratch?-1:l.words.findIndex(w=>w.start==null||w.end==null);
  l.words.forEach((w,k)=>{
    const b=document.createElement('button');b.type='button';
    b.className='wChip'+(w.start!=null&&w.end!=null?' placed':'')+(k===wbw.word?' sel':'')+(k===nextUnplaced?' next':'');
    b.textContent=wordLabel(w,k);
    b.onclick=()=>{wbw.word=k;if(w.start!=null&&!wbw.hold&&audio.paused){t=w.start;audio.currentTime=t}renderWord();draw()};
    box.appendChild(b);
  });
  if(l.scratch){
    const b=document.createElement('button');b.type='button';
    b.className='wChip newChip'+(wbw.word>=l.words.length?' sel':'');
    b.textContent='＋ new word';
    b.onclick=()=>{wbw.word=l.words.length;renderWord()};
    box.appendChild(b);
  }
  const cur=l.words[wbw.word];
  $('wbwNext').textContent=cur?wordLabel(cur,wbw.word):(l.scratch?'new word '+(l.words.length+1):'');
  const showType=!!l.scratch&&l.words.length>0&&audio.paused&&!wbw.hold;
  $('wbwTypeBox').style.display=showType?'flex':'none';
  if(showType){
    const k=Math.min(wbw.word,l.words.length-1);
    $('wbwTypeLbl').textContent='Type word '+(k+1)+' of '+l.words.length;
    if(document.activeElement!==$('wbwType'))$('wbwType').value=l.words[k].text||'';
  }
  $('wbwPlace').classList.toggle('holding',!!wbw.hold);
  $('wbwPlay').textContent=audio.paused?'▶ Play':'⏸ Pause';
}
function wbwUpdateHead(){
  if(!wbw.on||wbw.i==null)return;
  const l=lines[wbw.i],cell=wbwCellEl(wbw.i);
  if(!l||!cell)return;
  const r=rangeOf(l),p=(t-r[0])/Math.max(r[1]-r[0],0.001),h=cell.querySelector('.wHead');
  h.style.display=(p>=0&&p<=1)?'block':'none';
  h.style.left=(Math.max(0,Math.min(1,p))*100)+'%';
  if($('wbwNow'))$('wbwNow').textContent=fmt(t);
  $('wbwPlay').textContent=audio.paused?'▶ Play':'⏸ Pause';
}

// ----- scratch: type the words one by one -----
function wbwTypeNext(){
  const l=lines[wbw.i];if(!l)return;
  saveHistory();
  if(wbw.word<l.words.length-1){
    wbw.word++;renderWord();
    $('wbwType').value=l.words[wbw.word].text||'';
    $('wbwType').focus();
  }else{renderWord();toast('All words typed.')}
}
$('wbwType').addEventListener('input',()=>{
  const l=lines[wbw.i];if(!l||!l.scratch||!l.words.length)return;
  const k=Math.min(wbw.word,l.words.length-1);
  const raw=$('wbwType').value,hadSpace=/\s/.test(raw),v=raw.replace(/\s+/g,'');
  $('wbwType').value=v;
  l.words[k].text=v;
  l.text=l.words.map(w=>w.text||'').join(' ').trim();
  autoSave();
  if(hadSpace&&v){wbwTypeNext()}else{wbwRefreshCell(wbw.i);wbwRefreshEditor()}
});
$('wbwType').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();wbwTypeNext()}});
$('wbwType').addEventListener('blur',()=>saveHistory());
$('wbwTypeNext').onclick=wbwTypeNext;
$('wbwAddLine').onclick=()=>{
  lines.push({name:'Line '+(lines.length+1),text:'',start:null,end:null,type:'text',words:[],free:true,scratch:true,manualPlaced:true});
  selected=lines.length-1;markChange();render();
  wbwActivate(lines.length-1);
};

// ----- playback (stops at the end of the selected line) -----
function wbwTick(){
  wbw.raf=0;
  if(!wbw.on||audio.paused)return;
  const ct=audio.currentTime;
  if(wbw.stopAt!=null&&ct>=wbw.stopAt-0.005){
    audio.pause();audio.currentTime=wbw.stopAt;t=wbw.stopAt;
    if(wbw.hold)wbwRelease(true);
    draw();renderWord();
    return;
  }
  t=ct;draw();
  if(wbw.hold&&wbw.i!=null)wbwRefreshCell(wbw.i);
  wbw.raf=requestAnimationFrame(wbwTick);
}
function wbwPlayToggle(){
  if(wbw.i==null)return;
  if(!audio.src){toast('Load a song first.');return}
  const l=lines[wbw.i];if(!l)return;
  if(!audio.paused){audio.pause();return}
  const r=rangeOf(l);
  if(t<r[0]-0.01||t>=r[1]-0.05){t=r[0];audio.currentTime=r[0]}
  wbw.stopAt=l.free?null:r[1];
  audio.play().catch(()=>{});
  if(!wbw.raf)wbw.raf=requestAnimationFrame(wbwTick);
}
audio.addEventListener('play',()=>{if(wbw.on&&!wbw.raf)wbw.raf=requestAnimationFrame(wbwTick)});
audio.addEventListener('pause',()=>{if(wbw.on){if(wbw.hold)wbwRelease();wbwRefreshEditor()}});
function wbwJump(dir){
  if(wbw.i==null||!audio.src)return;
  const l=lines[wbw.i],d=Math.abs(Number(String($('wbwSkip').value).replace(',','.')))||2,r=rangeOf(l);
  t=Math.max(r[0],Math.min(r[1],t+dir*d));audio.currentTime=t;draw();
}

// ----- place word (press = start, hold = while sung, release = end) -----
function wbwPress(){
  if(!wbw.on||wbw.i==null||wbw.hold)return;
  const l=lines[wbw.i];if(!l)return;
  if(audio.paused){toast('Press Play first, then hold Place Word while the word is sung.');return}
  const k=wbw.word,isNew=!l.words[k];
  if(isNew&&!l.scratch)return;
  let s=wbwClamp(l,audio.currentTime);
  const prev=l.words[(isNew?l.words.length:k)-1];
  if(prev&&prev.end!=null&&prev.end>s&&prev.end-s<0.5)s=prev.end;
  wbw.hold={i:wbw.i,k:isNew?l.words.length:k,start:s,isNew};
  $('wbwPlace').classList.add('holding');
}
function wbwRelease(auto){
  const h=wbw.hold;
  if(!h)return;
  wbw.hold=null;
  $('wbwPlace').classList.remove('holding');
  const l=lines[h.i];if(!l)return;
  if(!h.isNew&&!l.words[h.k])return;
  const b=rangeOf(l)[1];
  let end=wbwClamp(l,auto&&wbw.stopAt!=null?wbw.stopAt:audio.currentTime),start=h.start;
  if(end<start+WBW_MIN)end=start+WBW_MIN;
  if(end>b){end=b;start=Math.min(start,b-WBW_MIN)}
  if(h.isNew){
    l.words.push({text:'',start:r3(Math.max(0,start)),end:r3(end),sepBefore:l.words.length?' ':''});
  }else{
    const w=l.words[h.k];
    w.start=r3(Math.max(0,start));w.end=r3(end);
  }
  if(l.free)syncFree(l);
  markChange();
  wbw.word=l.scratch?Math.min(l.words.length,h.k+1):Math.min(l.words.length-1,h.k+1);
  renderWord();
}
(function(){
  const b=$('wbwPlace');
  b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId)}catch(x){}wbwPress()});
  const up=e=>{e.preventDefault();wbwRelease()};
  b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);
  b.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{
    if(!wbw.on||wbw.i==null||e.repeat||e.code!=='Space')return;
    const tag=(document.activeElement&&document.activeElement.tagName)||'';
    if(/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag))return;
    if($('askDialog').classList.contains('open')||$('modeDialog').classList.contains('open'))return;
    e.preventDefault();wbwPress();
  });
  document.addEventListener('keyup',e=>{if(wbw.on&&e.code==='Space'&&wbw.hold){e.preventDefault();wbwRelease()}});
})();

// ----- other editor buttons -----
$('wbwPlay').onclick=wbwPlayToggle;
$('wbwUndo').onclick=()=>undo();
$('wbwRedo').onclick=()=>redo();
$('wbwBack').onclick=()=>wbwJump(-1);
$('wbwFwd').onclick=()=>wbwJump(1);
$('wbwSkip').addEventListener('input',()=>{$('wbwSkip').value=$('wbwSkip').value.replace(/[^0-9.,]/g,'');wbwStepLabels()});
$('wbwSpeed').onchange=()=>{
  if($('wbwSpeed').value==='other'){$('wbwCustom').style.display='inline-block';setSpeed($('wbwCustom').value)}
  else{$('wbwCustom').style.display='none';setSpeed($('wbwSpeed').value)}
};
$('wbwCustom').oninput=e=>setSpeed(e.target.value);
function wbwJumpTyped(){
  const el=$('wbwJumpTime'),raw=el.value.trim();
  if(!raw||wbw.i==null)return;
  const v=parseTime(raw),l=lines[wbw.i];
  if(!l)return;
  if(!Number.isFinite(v)||v<0){toast('Invalid time. Example: 1:23.5 or 83');return}
  const r=rangeOf(l);
  if(v<r[0]-0.0005||v>r[1]+0.0005){toast('That time is outside this line ('+fmt(r[0])+' – '+fmt(r[1])+').');return}
  t=v;audio.currentTime=v;draw();
  el.value='';el.blur();
}
$('wbwJumpGo').onclick=wbwJumpTyped;
$('wbwJumpTime').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();wbwJumpTyped()}});

// ----- mode switching + dialog -----
function closeRibbonPanels(){
  document.querySelectorAll('.ribbonTab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.ribbonPanel').forEach(x=>x.classList.remove('open'));
  $('exportMenu').classList.remove('open');
}
function setMode(m,persist){
  const w=(m==='word');
  if(w===wbw.on)return;
  if(!audio.paused)audio.pause();
  if(wbw.hold)wbwRelease();
  wbw.on=w;
  document.body.classList.toggle('mode-word',w);
  document.querySelectorAll('.modeBtn').forEach(b=>b.classList.toggle('active',b.dataset.mode===(w?'word':'line')));
  if(currentId&&persist!==false){try{localStorage.setItem('lyra-mode-'+currentId,w?'word':'line')}catch(e){}}
  if(w){
    if(normalizeInstrumentals())markChange();
    wbw.i=null;wbw.hold=null;wbw.sig=null;
    renderWord();
  }else{
    wbwClose();
    lines.forEach(finalizeScratch);
    render();
  }
  draw();
}
const __render=render;
render=function(){__render();if(wbw.on)renderWord()};
const __draw=draw;
draw=function(){__draw();if(wbw.on)wbwUpdateHead()};
function openModeDialog(){$('modeDialog').classList.add('open')}
function closeModeDialog(){$('modeDialog').classList.remove('open')}
$('modeClose').onclick=closeModeDialog;
$('modeCurrent').onclick=()=>{closeModeDialog();setMode('word')};
$('modeScratch').onclick=async()=>{
  closeModeDialog();
  if(lines.length&&!await askDialog('Start from scratch? This removes all current lines of this song (you can still undo).','Start from scratch','Cancel'))return;
  lines=[];selected=0;markChange();render();setMode('word');
};
function wbwPickImport(){$('wbwImportFile').value='';$('wbwImportFile').click()}
$('modeImport').onclick=()=>{closeModeDialog();wbwPickImport()};
$('wbwImportBtn').onclick=wbwPickImport;
$('wbwImportFile').onchange=async e=>{
  const f=e.target.files&&e.target.files[0];
  if(!f)return;
  showSaveToast({info:true,text:'Reading '+f.name+'…'});
  let text='';
  try{text=await f.text()}catch(x){showSaveToast({ok:false,text:'✗ Could not read '+f.name});return}
  text=text.replace(/^\uFEFF/,'');
  const before=lines;
  if(/^\s*</.test(text)){
    await importTTML(text,{skipTitleCheck:true,allowNoAudio:true,banner:true});
  }else{
    const imp=parseLRC(text);
    if(!imp.length){showSaveToast({ok:false,text:'✗ No time stamps found in '+f.name+'. Time your lines in Line by Line first, or use Start from Scratch.'});return}
    lines=imp;selected=0;markChange();render();
    showSaveToast({info:true,text:'✓ '+imp.length+' lines imported. Undo goes back.'});
  }
  if(lines===before)return;
  if(wbw.on){wbwClose();wbw.sig=null;renderWord()}else setMode('word');
};
$('wbwMore').onclick=()=>{
  if(wbw.hold)wbwRelease();
  if(!audio.paused)audio.pause();
  lines.forEach(finalizeScratch);
  cancelAutosave();
  doSave('manual');
  setMode('line',false);
  window.scrollTo({top:0,behavior:'smooth'});
};
document.querySelectorAll('.modeBtn').forEach(btn=>btn.addEventListener('click',e=>{
  const m=btn.dataset.mode;
  closeRibbonPanels();
  if(m==='line'){setMode('line');return}
  if(m==='word'){openModeDialog();return}
  toast('Letter by Letter kommt später.');
}));

// ----- song name follows the audio file name unless typed manually -----
$('song').addEventListener('input',()=>{nameManual=$('song').value.trim()!==''});
$('song').addEventListener('change',()=>{if(!$('song').value.trim()&&audioFileName){nameManual=false;$('song').value=baseName(audioFileName);updateFileSummary();autoSave()}});

// ---- universal lyrics import (all export formats) ----
function cueTime(x){const m=String(x).trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3])+Number('0.'+m[4]):null}
function assTimeToS(x){const m=String(x).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.](\d+)$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number('0.'+m[4]):null}
function mkLine(n,text,start,end,words){
  const plain=String(text||'').replace(/\s+/g,' ').trim();
  const ins=/^[♪♫♩♬]$/.test(plain);
  const l={name:'Line '+n,text:ins?'':plain,start:r3(start),end:r3(end),type:ins?'instrumental':'text',words:[]};
  if(!ins&&words&&words.length){
    l.words=words.filter(w=>w.text).map((w,i)=>({text:w.text,start:r3(w.start),end:r3(Math.max(w.end,w.start+WBW_MIN)),sepBefore:w.sepBefore!==undefined?w.sepBefore:(i?' ':'')}));
    if(!l.text)l.text=l.words.map(w=>w.text).join(' ');
  }
  return l;
}
function finishLines(arr){return arr.filter(l=>l.end>l.start).map((l,i)=>{l.name='Line '+(i+1);return l})}
function parseCues(text){
  const out=[];
  String(text).replace(/^\uFEFF/,'').split(/\r?\n\s*\r?\n/).forEach(block=>{
    const ls=block.split(/\r?\n/),k=ls.findIndex(x=>x.includes('-->'));
    if(k<0)return;
    const parts=ls[k].split('-->');
    const s=cueTime(parts[0].trim().split(/\s+/)[0]),e=cueTime((parts[1]||'').trim().split(/\s+/)[0]);
    if(s==null||e==null)return;
    out.push(mkLine(out.length+1,ls.slice(k+1).join(' ').replace(/<[^>]+>/g,''),s,e));
  });
  return finishLines(out);
}
function parseASS(text){
  const out=[];
  String(text).split(/\r?\n/).forEach(row=>{
    if(!/^Dialogue:/i.test(row))return;
    const f=row.replace(/^Dialogue:\s*/i,'').split(',');
    if(f.length<10)return;
    const s=assTimeToS(f[1]),e=assTimeToS(f[2]);
    if(s==null||e==null)return;
    const txt=f.slice(9).join(',');
    if(/\{\\k[fo]?\d+\}/.test(txt)){
      const words=[];let cur=s;
      for(const m of txt.matchAll(/\{\\k[fo]?(\d+)\}([^{]*)/g)){
        const d=Number(m[1])/100,wt=m[2].replace(/\\N|\\n/g,' ').trim();
        if(wt)words.push({text:wt,start:cur,end:cur+d});
        cur+=d;
      }
      out.push(mkLine(out.length+1,words.map(w=>w.text).join(' '),s,e,words));
    }else out.push(mkLine(out.length+1,txt.replace(/\{[^}]*\}/g,'').replace(/\\N|\\n/g,' '),s,e));
  });
  return finishLines(out);
}
function parseWordFormat(text,kind){
  const out=[];
  String(text).split(/\r?\n/).forEach(row=>{
    let m,s=0,e=0,rest,words=[];
    if(kind==='lys'){m=row.match(/^\[\d+\](.*)$/);if(!m)return;rest=m[1]}
    else{m=row.match(/^\[(\d+),(\d+)\](.*)$/);if(!m)return;s=Number(m[1])/1000;e=s+Number(m[2])/1000;rest=m[3]}
    if(kind==='yrc'){
      for(const w of rest.matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)){const ws=Number(w[1])/1000;words.push({text:w[3].trim(),start:ws,end:ws+Number(w[2])/1000})}
    }else{
      for(const w of rest.matchAll(/([^()]*?)\((\d+),(\d+)\)/g)){const ws=Number(w[2])/1000;words.push({text:w[1].trim(),start:ws,end:ws+Number(w[3])/1000})}
    }
    words=words.filter(w=>w.text);
    if(!words.length)return;
    if(kind==='lys'){s=words[0].start;e=words[words.length-1].end}
    out.push(mkLine(out.length+1,words.map(w=>w.text).join(' '),s,e,words));
  });
  return finishLines(out);
}
function parseLYL(text){
  const out=[];
  String(text).split(/\r?\n/).forEach(row=>{
    const m=row.match(/^\[(\d+),(\d+)\](.*)$/);
    if(m)out.push(mkLine(out.length+1,m[3],Number(m[1])/1000,Number(m[2])/1000));
  });
  return finishLines(out);
}
function parseLRC(text){
  const raw=[];
  String(text).replace(/^\uFEFF/,'').split(/\r?\n/).forEach(row=>{
    const m=row.match(/^\s*((?:\[\d+:\d{2}(?:[.:]\d+)?\]\s*)+)(.*)$/);
    if(!m)return;
    [...m[1].matchAll(/\[(\d+):(\d{2})(?:[.:](\d+))?\]/g)].forEach(x=>raw.push({start:Number(x[1])*60+Number(x[2])+(x[3]?Number('0.'+x[3]):0),body:m[2]}));
  });
  raw.sort((a,b)=>a.start-b.start);
  const out=[];
  raw.forEach((o,i)=>{
    const plain=o.body.replace(/<\d+:\d{2}(?:[.:]\d+)?>/g,'').replace(/\s+/g,' ').trim();
    if(!plain)return;
    const next=raw[i+1],end=next?next.start:(duration>o.start?duration:o.start+3);
    if(end<=o.start)return;
    let words=null;
    if(/<\d+:\d{2}(?:[.:]\d+)?>/.test(o.body)){
      const ws=[...o.body.matchAll(/<(\d+):(\d{2}(?:[.:]\d+)?)>([^<]*)/g)].map(x=>({text:x[3].trim(),start:Number(x[1])*60+Number(String(x[2]).replace(':','.'))}));
      ws.forEach((w,k)=>{w.end=k<ws.length-1?ws[k+1].start:end});
      words=ws.filter(w=>w.text);
    }
    out.push(mkLine(out.length+1,plain,o.start,end,words));
  });
  return out;
}
function parseAnyLyrics(text){
  const t0=String(text).replace(/^\uFEFF/,'');
  const head=t0.split(/\r?\n/).filter(r=>r.trim()).slice(0,12).join('\n');
  if(/^\s*WEBVTT/.test(t0))return parseCues(t0);
  if(/\[Script Info\]/i.test(t0)||/^Dialogue:/mi.test(t0))return parseASS(t0);
  if(/-->/.test(head))return parseCues(t0);
  if(/^\[\d+,\d+\]\(\d+,\d+,\d+\)/m.test(t0))return parseWordFormat(t0,'yrc');
  if(/^\[\d+,\d+\][^\[\n]*\(\d+,\d+\)/m.test(t0))return parseWordFormat(t0,'qrc');
  if(/^\[\d+\][^\[\n]*\(\d+,\d+\)/m.test(t0))return parseWordFormat(t0,'lys');
  if(/^\[type:LyricifyLines\]/mi.test(t0)||/^\[\d+,\d+\][^(\n]*$/m.test(t0))return parseLYL(t0);
  if(/\[\d+:\d{2}/.test(t0))return parseLRC(t0);
  return null;
}
async function importLyricsText(text,name,opts){
  opts=opts||{};
  text=String(text||'').replace(/^\uFEFF/,'');
  const before=lines;
  if(/^\s*</.test(text)){
    await importTTML(text,{skipTitleCheck:!!opts.toWord,allowNoAudio:true,banner:true});
  }else{
    let imp=null;
    try{imp=parseAnyLyrics(text)}catch(e){imp=null}
    if(!imp||!imp.length){showSaveToast({ok:false,text:'✗ Could not read lyrics from '+name+'. Supported: TTML, LRC, Enhanced LRC, SRT, VTT, ASS, YRC, QRC, LYS, LYL. Plain text without time stamps cannot be used here.'});return false}
    lines=imp;selected=0;markChange();render();
    showSaveToast({info:true,text:'✓ '+imp.length+' lines imported'+(imp.some(l=>l.words&&l.words.length)?' (with word timing)':'')+'. Undo goes back.'});
  }
  if(lines===before)return false;
  if(opts.toWord&&!wbw.on)setMode('word');
  else if(wbw.on){wbwClose();wbw.sig=null;renderWord()}
  return true;
}
// Android file pickers may classify .lrc/.ttml as plain text or XML.
// The accept filter above offers both extensions and text MIME types; validation here
// prevents images, videos, archives and HTML from being imported if a picker shows them.
const LYRA_IMPORT_EXTENSIONS=new Set(['ttml','lrc','srt','vtt','ass','yrc','qrc','lys','lyl','elrc','txt']);
async function importLyricsFile(f,opts){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(!LYRA_IMPORT_EXTENSIONS.has(ext)){
    await askDialog('Unsupported file type. Please choose a lyrics file (TTML, LRC, SRT, VTT, ASS, YRC, QRC, LYS, LYL or TXT).','OK','Close');
    return false;
  }
  showSaveToast({info:true,text:'Reading '+f.name+'…'});
  let text='';
  try{text=await f.text()}catch(x){showSaveToast({ok:false,text:'✗ Could not read '+f.name});return false}
  return importLyricsText(text,f.name,opts);
}
$('wbwImportFile').onchange=e=>{const f=e.target.files&&e.target.files[0];if(f)importLyricsFile(f,{toWord:true});e.target.value=''};
$('importTTML').onchange=e=>{const f=e.target.files&&e.target.files[0];if(f)importLyricsFile(f,{toWord:false});e.target.value=''};
function openPaste(){$('pasteText').value='';$('pasteDialog').classList.add('open');setTimeout(()=>$('pasteText').focus(),50)}
$('wbwPasteBtn').onclick=openPaste;
$('modePaste').onclick=()=>{closeModeDialog();openPaste()};
$('pasteClose').onclick=()=>$('pasteDialog').classList.remove('open');
$('pasteGo').onclick=async()=>{
  const txt=$('pasteText').value;
  $('pasteDialog').classList.remove('open');
  if(!txt.trim()){toast('Nothing to import.');return}
  await importLyricsText(txt,'pasted text',{toWord:true});
};

// ---- move words / lines (drag or buttons) ----
function wbwAttachDrag(el,i,k){
  el.classList.add('movable');
  el.addEventListener('click',e=>e.stopPropagation());
  el.addEventListener('pointerdown',e=>{
    const l=lines[i],w=l&&l.words[k];
    if(!w||w.start==null||w.end==null||wbw.hold)return;
    e.preventDefault();e.stopPropagation();
    const track=el.closest('.wTrack'),W=Math.max(1,track.getBoundingClientRect().width),r=rangeOf(l),span=Math.max(r[1]-r[0],0.001);
    const x0=e.clientX,s0=w.start,dur=w.end-w.start;
    let moved=false;
    try{el.setPointerCapture(e.pointerId)}catch(x){}
    wbw.word=k;
    const mv=ev=>{
      const dx=ev.clientX-x0;
      if(Math.abs(dx)>3)moved=true;
      if(!moved)return;
      const ns=Math.max(r[0],Math.min(r[1]-dur,s0+dx/W*span));
      w.start=r3(ns);w.end=r3(ns+dur);
      el.style.left=(100*(w.start-r[0])/span)+'%';
    };
    const up=()=>{
      el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);
      if(moved){if(l.free)syncFree(l);markChange()}
      renderWord();
    };
    el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  });
}
function wbwNudge(kind,dir){
  if(wbw.i==null)return;
  const l=lines[wbw.i];if(!l)return;
  const d=dir*(Number($('wbwNudge').value)||0.05);
  if(kind==='word'){
    const w=l.words[wbw.word];
    if(!w||w.start==null||w.end==null){toast('Place this word first.');return}
    const r=rangeOf(l);
    let s=w.start+d,e=w.end+d;
    if(s<r[0]){e+=r[0]-s;s=r[0]}
    if(e>r[1]){s-=e-r[1];e=r[1]}
    w.start=r3(s);w.end=r3(e);
    if(l.free)syncFree(l);
    if(audio.paused){t=w.start;audio.currentTime=t}
  }else{
    if(l.free){
      const ws=l.words.filter(w=>w.start!=null&&w.end!=null);
      if(!ws.length){toast('Place words first.');return}
      const lo=Math.min(...ws.map(w=>w.start)),hi=Math.max(...ws.map(w=>w.end));
      const ds=Math.max(-lo,Math.min((duration||hi)-hi,d));
      ws.forEach(w=>{w.start=r3(w.start+ds);w.end=r3(w.end+ds)});
      syncFree(l);
    }else{
      const ds=Math.max(-l.start,Math.min(duration>0?duration-l.end:d,d));
      l.start=r3(l.start+ds);l.end=r3(l.end+ds);
      l.words.forEach(w=>{if(w.start!=null)w.start=r3(w.start+ds);if(w.end!=null)w.end=r3(w.end+ds)});
    }
    if(audio.paused){t=rangeOf(l)[0];audio.currentTime=t}
  }
  markChange();renderWord();draw();
}
$('wbwWordL').onclick=()=>wbwNudge('word',-1);
$('wbwWordR').onclick=()=>wbwNudge('word',1);

function wbwStepLabels(){const d=String($('wbwSkip').value).replace(',','.')||'2';$('wbwBack').textContent='↶ '+d+'s';$('wbwFwd').textContent=d+'s ↷'}
wbwStepLabels();

// ---- player: word by word display ----
function renderPlayerWords(el,l){
  const idx=lines.indexOf(l),sig=idx+'|'+l.words.map(w=>w.text).join(' ');
  if(el._wsig!==sig){
    el._wsig=sig;el.textContent='';el.style.setProperty('--pc',colorFor(idx));
    l.words.forEach((w,k)=>{
      if(k)el.appendChild(document.createTextNode(w.sepBefore!=null&&w.sepBefore!==''?w.sepBefore:' '));
      const sp=document.createElement('span');sp.className='pw';sp.textContent=w.text;el.appendChild(sp);
    });
  }
  const sp=el.querySelectorAll('.pw');
  l.words.forEach((w,k)=>{
    let p=0;
    if(w.start!=null&&w.end!=null)p=t>=w.end?100:(t<=w.start?0:100*(t-w.start)/Math.max(w.end-w.start,0.001));
    if(sp[k])sp[k].classList.toggle('highlighted',t>=w.start&&t<w.end);
  });
}

(async function initGallery(){
  await migrateOld();
  let cur=null;try{cur=localStorage.getItem(CUR)}catch(e){}
  showView('gallery');
  if(cur&&localStorage.getItem(PROJ+cur)){
    const p=getIndex().find(x=>x.id===cur),nm=((p&&p.song)||'').trim();
    const yes=await askDialog(tr('resume')+(nm?'\n“'+nm+'”':''),tr('yes'),tr('no'));
    if(yes)await enterEditor(cur);
    else{try{localStorage.removeItem(CUR)}catch(e){}}
  }else if(cur){try{localStorage.removeItem(CUR)}catch(e){}}
})();

})();