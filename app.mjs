const $=id=>document.getElementById(id);
let worker,config,state,snapshot,originalBytes,fileName,readyResolve,workerReady,pending=new Map(),sequence=0,activeTab='edit',selected=new Set(),anchor=null,candidate=-1,candidateList=[],busy=false,recovering=false,timer=null,dirty=false,displayView=null,fitMode=true,zoom=1,dragState=null,selectionEpoch=0,viewWidth=1,undoToken=null;
const key=(t,s)=>`${t}:${s}`,pairs=set=>[...set].map(v=>{const[t,s]=v.split(':');return[t,+s]});
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
let startupTimer=null,startupStarted=0,startupPrevious=null,startupRecord=true;
const startupStorageKey='hoboshinyakun.startupSeconds.py314';
function startupTick(){
  const elapsed=(performance.now()-startupStarted)/1000;$('startupElapsed').textContent='経過 '+Math.floor(elapsed)+'秒';
  if(startupPrevious!==null){const left=Math.ceil(startupPrevious-elapsed);$('startupEstimate').textContent=left>0?'目安：残り約'+left+'秒（前回 '+Math.ceil(startupPrevious)+'秒）':'前回より時間がかかっています。準備を続けています';}
}
function beginStartup(){
  clearInterval(startupTimer);startupStarted=performance.now();startupPrevious=null;startupRecord=!state;
  try{const value=Number(localStorage.getItem(startupStorageKey));if(Number.isFinite(value)&&value>0&&value<3600)startupPrevious=value;}catch{}
  $('startupPanel').dataset.state='loading';$('startupProgress').value=0;$('startupSteps').textContent='0 / 4段階完了';$('startupStage').textContent='実行部品を読み込んでいます';$('startupEstimate').textContent='初回のため所要時間を計測しています';startupTick();startupTimer=setInterval(startupTick,250);
}
function finishStartup(success){
  clearInterval(startupTimer);startupTick();const seconds=(performance.now()-startupStarted)/1000;$('startupPanel').dataset.state=success?'ready':'error';
  if(success){$('startupProgress').value=4;$('startupSteps').textContent='4 / 4段階完了';$('startupStage').textContent='準備できました';$('startupElapsed').textContent=seconds.toFixed(1)+'秒で起動しました';$('startupEstimate').textContent='Excelを選んで始められます';if(startupRecord)try{localStorage.setItem(startupStorageKey,String(seconds));}catch{}}
  else{$('startupStage').textContent='読み込みが止まりました';$('startupEstimate').textContent='通信環境を確認して再読み込みしてください';}
}
function startWorker(){
  beginStartup();
  workerReady=new Promise(r=>readyResolve=r);worker=new Worker('./worker.mjs?v=20260920-savefix1',{type:'module'});
  worker.onmessage=({data:m})=>{
    if(m.type==='startup'){$('startupProgress').value=m.completed;$('startupSteps').textContent=m.completed+' / 4段階完了';$('startupStage').textContent=m.text;status(m.text+'…');return;}
    if(m.type==='status'){status(m.text);return;}
    if(m.type==='ready'){finishStartup(true);config=m.data;readyResolve();$('runtime').textContent='ブラウザー内で実行';$('open2').disabled=busy;status('準備できました。Excelを読み込んでください。');return;}
    if(m.type==='progress'){if(m.data.solutions!==undefined)$('solutions').textContent=m.data.solutions;return;}
    if(m.type==='fatal'){finishStartup(false);status('起動できませんでした。通信環境を確認してページを再読み込みしてください。\n'+m.error,true);return;}
    const job=pending.get(m.id);if(!job)return;pending.delete(m.id);m.error?job.reject(new Error(m.error)):job.resolve(m);
  };
  worker.onerror=e=>{finishStartup(false);status('実行部品を読み込めませんでした。ページを再読み込みしてください。'+e.message,true);};
}
async function rpc(command,args={},bytes){await workerReady;const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,command,args,bytes});});}
function setBusy(on){busy=on;$('workspace').inert=on;$('toolbar').inert=on;document.body.classList.toggle('busy',on);$('open2').disabled=on||!config;}
async function run(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){status(e.message,true);}finally{setBusy(false);}}
function update(data){if(data.undo_token)undoToken=data.undo_token;if(data.snapshot){snapshot=data.snapshot;candidateList=[];candidate=-1;$('count').textContent='0';$('candidates').replaceChildren();$('candidates').disabled=$('candidateList').disabled=$('apply').disabled=true;$('candidateSummary').textContent='';}if(data.view){state=data.view;displayView=state;render();}}
function render(view=displayView||state){
  if(!view)return;displayView=view;$('welcome').hidden=true;$('workspace').hidden=false;document.body.classList.add('loaded');if($('status').parentElement!==$('information'))$('information').append($('status'));$('filename').textContent=view.title||fileName;
  const original=activeTab==='result'&&$('originalView').checked,onlyChanged=activeTab==='result'&&$('onlyChanged').checked;
  const marked=field=>new Set(view[field].map(([t,s])=>key(t,s))),absent=marked('absent'),fixed=marked('fixed'),changed=marked('changed'),study=marked('study'),violations=marked('violations');
  const changedTeachers=new Set(view.changed.map(([t])=>t));const teachers=view.teachers.filter(t=>!onlyChanged||changedTeachers.has(t.id));
  const table=$('grid');table.replaceChildren();const head=document.createElement('thead'),days=document.createElement('tr'),corner=document.createElement('th');corner.className='teacher';corner.textContent='先生';days.append(corner);
  config.slots.forEach((s,i)=>{const th=document.createElement('th');th.textContent=s;if([0,6,12,18,23].includes(i))th.className='dayStart';days.append(th);});head.append(days);table.append(head);
  const body=document.createElement('tbody');let prev;
  teachers.forEach((teacher,row)=>{const tr=document.createElement('tr');if(teacher.grade!==prev&&teacher.grade!=='未設定')tr.className='gradeStart';prev=teacher.grade;const th=document.createElement('th');th.className='teacher';th.textContent=teacher.name;tr.append(th);
    (original?teacher.original:teacher.cells).forEach((value,s)=>{const cell=document.createElement('td'),k=key(teacher.id,s),label=value.replace(/^!/,''),span=document.createElement('span');cell.dataset.key=k;cell.dataset.teacher=teacher.id;cell.dataset.row=row;cell.dataset.slot=s;span.textContent=label;span.dataset.label=label;cell.append(span);cell.title=teacher.name+' '+config.slots[s]+' '+(label||'空き');cell.setAttribute('aria-label',cell.title);
      if(value==='/')cell.classList.add('blocked');if(!original){if(absent.has(k))cell.classList.add('absent');if(fixed.has(k)&&value!=='/')cell.classList.add('fixed');if(changed.has(k))cell.classList.add('changed');if(study.has(k))cell.classList.add('study');if(violations.has(k))cell.classList.add('violation');}if(selected.has(k))cell.classList.add('selected');if([0,6,12,18,23].includes(s))cell.classList.add('dayStart');tr.append(cell);
    });body.append(tr);});table.append(body);$('undo').disabled=!state.undo;renderSettings();requestAnimationFrame(layoutGrid);
}
function layoutGrid(){
  const wrap=$('tableWrap'),table=$('grid');if(!state||wrap.clientHeight<1)return;wrap.style.overflow=fitMode?'hidden':'auto';
  const rows=table.tBodies[0]?.rows.length||1,width=wrap.clientWidth,height=wrap.clientHeight,header=28;
  let cw,ch;if(fitMode){ch=Math.max(1,Math.min(144,Math.floor((height-header-6)/rows*64)/64));cw=Math.max(1,(width-104)/29);zoom=ch/48;viewWidth=cw/(112*zoom);wrap.scrollTop=wrap.scrollLeft=0;}else{ch=48*zoom;cw=112*zoom*viewWidth;}
  table.style.width=(100+29*cw)+'px';table.style.setProperty('--row-height',ch+'px');table.style.setProperty('--cell-font',Math.max(5,Math.min(16,ch*.68,cw/4.3))+'px');table.style.setProperty('--name-font',Math.max(5,Math.min(16,ch*.7))+'px');table.classList.toggle('twoLines',!fitMode&&ch>=34);$('zoomLabel').textContent=Math.round(zoom*100)+'%';
  table.querySelectorAll('td>span').forEach(span=>{
    span.style.transform='translate(-50%,-50%)';
    span.textContent=!fitMode&&ch>=34?span.dataset.label.replace(' ','\n'):span.dataset.label.replace(' ','');
    const cell=span.parentElement,rect=span.getBoundingClientRect();
    const sx=Math.min(1,Math.max(1,cell.clientWidth-6)/Math.max(1,rect.width));
    const sy=Math.min(1,Math.max(1,cell.clientHeight-4)/Math.max(1,rect.height));
    span.style.transform=`translate(-50%,-50%) scale(${sx},${sy})`;
  });
}
function paintSelection(){document.querySelectorAll('#grid td').forEach(c=>c.classList.toggle('selected',selected.has(c.dataset.key)));}
async function describeSelection(cell){
  const epoch=++selectionEpoch;if(!cell||!selected.size){$('selectionInfo').textContent='';return;}
  if(selected.size>1){$('selectionInfo').textContent=selected.size+'コマを選択中';return;}
  const t=cell.dataset.teacher,s=+cell.dataset.slot,teacher=displayView.teachers.find(x=>x.id===t),original=activeTab==='result'&&$('originalView').checked;
  const text=teacher.name+' '+config.slots[s]+'　'+((original?teacher.original:teacher.cells)[s].replace(/^!/,'')||'空き');$('selectionInfo').textContent=text;
  if(original)return;
  try{const {data}=await rpc('detail',{cell:[t,s],candidate:activeTab==='result'&&candidateList.length?candidate:null});if(epoch===selectionEpoch)$('selectionInfo').textContent=text+(data.reasons.length?'（'+data.reasons.join('・')+'）':'');}catch(e){status(e.message,true);}
}
function chooseRange(first,last,base=new Set()){
  selected=new Set(base);const rows=$('grid').tBodies[0].rows;
  for(let r=Math.min(first.row,last.row);r<=Math.max(first.row,last.row);r++)for(let s=Math.min(first.s,last.s);s<=Math.max(first.s,last.s);s++)selected.add(rows[r].cells[s+1].dataset.key);
  paintSelection();
}
function renderSettings(){
  const panel=$('settings');panel.replaceChildren();const title=document.createElement('h2');title.textContent='時間割変更の条件';panel.append(title);
  const defaultsOff=new Set(['same_day_only','movement_same_grade','allow_unavailable_edit','support_fixed','initial_training_fixed','foreign_fixed']);
  const limits={science_limit:[['science','上限']],music_limit:[['music','上限']],art_limit:[['art','上限']],pe_limit:[['pe1','1年'],['pe2','2年'],['pe3','3年']]};
  function section(title){const h=document.createElement('h3');h.textContent=title;panel.append(h);const box=document.createElement('div');box.className='checkgroup';panel.append(box);return box;}
  function select(value,onchange,label){const s=document.createElement('select');s.setAttribute('aria-label',label);for(let i=1;i<=5;i++){const o=new Option(i,i);s.add(o);}s.value=value;s.onchange=onchange;return s;}
  function checkbox(box,key,label,checked,change){const line=document.createElement('div');line.className='checkline';const l=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.dataset.rule=key;input.onchange=change;l.append(input,document.createTextNode(' '+label));line.append(l);box.append(line);return line;}
  for(const [title,filter] of [['固定する授業・予定',k=>k.endsWith('_fixed')],['同時授業数の制限',k=>k in limits],['その他の条件',k=>!k.endsWith('_fixed')&&!(k in limits)]]){
    const box=section(title);const keys=Object.keys(config.rules).filter(filter).sort((a,b)=>Number(defaultsOff.has(a))-Number(defaultsOff.has(b)));
    for(const k of keys){const line=checkbox(box,k,config.rules[k],state.conditions[k],()=>changeConditions());if(limits[k])for(const [lk,label] of limits[k]){const span=document.createElement('span');span.textContent=label;line.append(span);const s=select(state.room_limits[lk],()=>changeConditions(),config.rules[k]+' '+label);s.dataset.limit=lk;line.append(s);}}
  }
  const box=section('自習対応の条件');checkbox(box,'studySame','同じ学年の先生にお願いする',state.study_settings.same_grade,()=>changeConditions());
  const line=checkbox(box,'studyLimit','先生1人の自習対応数を制限（1週間）',state.study_settings.limit_enabled,()=>changeConditions());const s=select(state.study_settings.max_count,()=>changeConditions(),'自習対応の上限');s.id='studyMax';line.append(s,document.createTextNode('コマまで'));
}
async function changeConditions(){
  const conditions={...state.conditions};for(const input of document.querySelectorAll('[data-rule]'))if(input.dataset.rule in conditions)conditions[input.dataset.rule]=input.checked;
  const room_limits={...state.room_limits};for(const input of document.querySelectorAll('[data-limit]'))room_limits[input.dataset.limit]=+input.value;
  const study_settings={same_grade:document.querySelector('[data-rule=studySame]').checked,limit_enabled:document.querySelector('[data-rule=studyLimit]').checked,max_count:+$('studyMax').value};
  if(conditions.allow_unavailable_edit&&!state.conditions.allow_unavailable_edit&&!await message('勤務不可の編集','勤務不可の斜線を削除したり、授業を入れ替えたりできるようになります。許可しますか？',true)){renderSettings();return;}
  await run(async()=>{const {data}=await rpc('conditions',{conditions,room_limits,study_settings});update(data);dirty=true;status('条件を変更しました。');});
}
function switchTab(name){activeTab=name;hideMenu();document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===name));$('settings').hidden=name!=='settings';$('gridPanel').hidden=name==='settings';$('candidateBar').hidden=name!=='result';$('resultControls').hidden=name!=='result';$('editInfo').hidden=name==='result';$('toolbar').hidden=false;document.querySelector('.viewtools').hidden=name==='settings';selected.clear();$('selectionInfo').textContent='';if(name==='result'&&candidateList.length){preview();}else{displayView=state;if(state)render();}}
function message(title,text,confirm=false){$('messageTitle').textContent=title;$('messageText').textContent=text;$('messageCancel').hidden=!confirm;$('messageDialog').showModal();return new Promise(resolve=>{const close=v=>{$('messageDialog').close();resolve(v);};$('messageOK').onclick=()=>close(true);$('messageCancel').onclick=()=>close(false);$('messageDialog').oncancel=()=>resolve(false);});}
async function edit(action){hideMenu();if(action==='lesson'){openLesson();return;}if(!selected.size){status('変更するコマを選んでください。');return;}await run(async()=>{const args={action,cells:pairs(selected)};let {data}=await rpc('edit',args);if(data.confirm){if(!await message('合同授業の変更',data.confirm,true))return;({data}=await rpc('edit',{...args,confirmed:true}));}update(data);dirty=true;status('条件を変更しました。');});}
async function preview(){candidate=+$('candidates').value;await run(async()=>{const {data}=await rpc('preview',{index:candidate});displayView=data.view;render(data.view);const c=candidateList[candidate];$('candidateSummary').textContent=`変更 ${c.changed}コマ ／ 関わる先生 ${c.teachers}人`;});}
async function search(mode){
  $('timeDialog').close();if(busy)return;setBusy(true);hideMenu();candidateList=[];$('apply').disabled=$('candidateList').disabled=$('candidates').disabled=true;$('candidates').replaceChildren();$('count').textContent='0';const seconds={quick:30,standard:120,careful:300}[mode],start=performance.now();$('solutions').textContent='0';$('progress').value=0;$('progressDialog').showModal();
  timer=setInterval(()=>{const elapsed=(performance.now()-start)/1000;$('progress').value=Math.min(100,elapsed/seconds*100);$('elapsed').textContent=`${Math.floor(elapsed)}秒 ／ 最大${seconds}秒`;},150);
  try{const {data}=await rpc('search',{mode});candidateList=data.candidates;$('count').textContent=candidateList.length;$('candidates').replaceChildren(...candidateList.map((c,i)=>new Option(`案${i+1}：${c.changed}コマ・${c.teachers}人`,i)));status(`${data.seconds.toFixed(1)}秒で ${data.solutions}件。上位${candidateList.length}件を表示します。`);if(!candidateList.length)await message('解決案が見つかりませんでした',[...data.issues,...data.diagnostics].slice(0,7).join('\n')||'検索時間を長くするか、空き指定・固定条件を確認してください。');}
  catch(e){if(e.message!=='cancelled')status(e.message,true);}
  finally{clearInterval(timer);$('progressDialog').close();if(!recovering)setBusy(false);}
  if(candidateList.length){$('candidates').disabled=$('candidateList').disabled=$('apply').disabled=false;switchTab('result');}
}
async function cancelSearch(){
  if(!busy)return;recovering=true;worker.terminate();for(const job of pending.values())job.reject(new Error('cancelled'));pending.clear();clearInterval(timer);$('progressDialog').close();startWorker();await workerReady;await rpc('restore',{snapshot,undo_token:undoToken},originalBytes);recovering=false;setBusy(false);status('中止しました。検索前の時間割と条件を保持しています。');
}
$('openBottom').onclick=$('open2').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;if(dirty&&!await message('Excelを読み込む','未保存の変更を破棄して別のExcelを読み込みますか？',true))return;await run(async()=>{const bytes=await file.arrayBuffer();const {data}=await rpc('load',{name:file.name},bytes);originalBytes=bytes;fileName=file.name;selected.clear();update(data);dirty=false;switchTab('edit');status(`${state.teachers.length}人の時間割を読み込みました。`);});$('file').value='';};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>edit(b.dataset.action));
$('undo').onclick=()=>run(async()=>{update((await rpc('undo')).data);dirty=true;status('1つ前に戻しました。');});
$('search').onclick=()=>run(async()=>{const {data}=await rpc('preflight');if(data.errors.length){await message('授業数が一致しません','原本と比べて授業数に不足または過多があります。\n\n'+data.errors.join('\n'));return;}if(!data.pending){await message('条件登録','現在の条件で移動が必要な授業はありません。直接入力した変更は「保存」で残せます。');return;}$('timeDialog').showModal();});$('closeTime').onclick=()=>$('timeDialog').close();document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>search(b.dataset.mode));
$('cancel').onclick=cancelSearch;$('progressDialog').oncancel=e=>{e.preventDefault();cancelSearch();};$('candidates').onchange=preview;
$('apply').onclick=()=>run(async()=>{if(!candidateList.length)return;update((await rpc('apply',{index:+$('candidates').value})).data);dirty=true;switchTab('result');status('変更案を確定しました。Excelに保存してください。');});
$('saveBottom').onclick=()=>{if(candidateList.length){message('確定してから保存','変更候補を確定するか、条件を変更して候補を取り消してから保存してください。');return;}$('saveName').value=fileName.replace(/\.xlsx$/i,'')+'_変更.xlsx';$('saveDialog').showModal();};$('saveCancel').onclick=()=>$('saveDialog').close();
$('saveOK').onclick=()=>{let name=$('saveName').value.trim();if(!name)return;if(!/\.xlsx$/i.test(name))name+='.xlsx';$('saveDialog').close();run(async()=>{status('Excelを作成しています…');const answer=await rpc('export');const url=URL.createObjectURL(new Blob([answer.file],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);dirty=false;status('Excelを作成しました。ブラウザーのダウンロード先を確認してください。');});};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  try{Promise.resolve(document.modelContext.registerTool({
    name:'get_timetable_status',title:'時間割の状態を確認',
    description:'現在の読み込み・検索・未保存状態と、候補の件数を確認します。時間割は変更しません。',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('引数は空のオブジェクトにしてください。');return {loaded:!!state,teachers:state?.teachers.length||0,absent:state?.absent.length||0,candidates:candidateList.length,busy,unsaved:dirty};}
  },{signal:lifecycle.signal})).catch(()=>{});}catch{}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
startWorker();

function hideMenu(){$('contextMenu').hidden=true;}
const wrap=$('tableWrap');
function cellPoint(cell){return {row:+cell.dataset.row,s:+cell.dataset.slot};}
wrap.addEventListener('pointerdown',e=>{
  if(busy||e.button!==0)return;const cell=e.target.closest('td');if(!cell)return;hideMenu();wrap.focus();e.preventDefault();
  if(activeTab==='result'){dragState={pan:true,x:e.clientX,y:e.clientY,left:wrap.scrollLeft,top:wrap.scrollTop,cell};return;}
  const point=cellPoint(cell),base=e.ctrlKey||e.metaKey?new Set(selected):new Set();
  if(e.shiftKey&&anchor){chooseRange(anchor,point,base);}else{selected=new Set(base);selected.has(cell.dataset.key)?selected.delete(cell.dataset.key):selected.add(cell.dataset.key);anchor=point;paintSelection();}
  dragState={start:e.shiftKey&&anchor?anchor:point,base,x:e.clientX,y:e.clientY,cell,moved:false};describeSelection(cell);
});
document.addEventListener('pointermove',e=>{
  if(!dragState||busy)return;if(dragState.pan){wrap.scrollLeft=dragState.left+dragState.x-e.clientX;wrap.scrollTop=dragState.top+dragState.y-e.clientY;return;}
  const rect=wrap.getBoundingClientRect();if(e.clientY<rect.top+15)wrap.scrollTop-=15;if(e.clientY>rect.bottom-15)wrap.scrollTop+=15;if(e.clientX<rect.left+110)wrap.scrollLeft-=15;if(e.clientX>rect.right-15)wrap.scrollLeft+=15;
  const cell=document.elementFromPoint(Math.min(rect.right-2,Math.max(rect.left+101,e.clientX)),Math.min(rect.bottom-2,Math.max(rect.top+29,e.clientY)))?.closest('#grid td');if(!cell)return;
  const point=cellPoint(cell);if(point.row!==dragState.start.row||point.s!==dragState.start.s||dragState.moved){dragState.moved=true;chooseRange(dragState.start,point,dragState.base);describeSelection(cell);}
});
document.addEventListener('pointerup',e=>{if(dragState?.pan&&Math.abs(e.clientX-dragState.x)+Math.abs(e.clientY-dragState.y)<4){selected=new Set([dragState.cell.dataset.key]);paintSelection();describeSelection(dragState.cell);}dragState=null;});
window.addEventListener('blur',()=>{dragState=null;hideMenu();});
wrap.addEventListener('contextmenu',async e=>{
  const cell=e.target.closest('td');if(!cell)return;e.preventDefault();if(busy||activeTab!=='edit')return;
  if(!selected.has(cell.dataset.key)){selected=new Set([cell.dataset.key]);anchor=cellPoint(cell);paintSelection();describeSelection(cell);}
  const chosen=pairs(selected),epoch=++selectionEpoch;
  try{const {data}=await rpc('menu',{cells:chosen});if(busy||activeTab!=='edit'||epoch!==selectionEpoch)return;const menu=$('contextMenu');menu.querySelectorAll('[data-action]').forEach(b=>b.disabled=!data[b.dataset.action]);menu.hidden=false;menu.style.left=Math.max(0,Math.min(e.clientX,innerWidth-menu.offsetWidth-4))+'px';menu.style.top=Math.max(0,Math.min(e.clientY,innerHeight-menu.offsetHeight-4))+'px';menu.querySelector('button:not(:disabled)')?.focus();}catch(error){status(error.message,true);}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#contextMenu'))hideMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideMenu();if(!document.querySelector('dialog[open]')){selected.clear();paintSelection();describeSelection(null);}}if(!$('contextMenu').hidden&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...$('contextMenu').querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}});
function changeZoom(value){fitMode=false;zoom=Math.max(.04,Math.min(3,value));layoutGrid();}
$('fit').onclick=()=>{fitMode=true;layoutGrid();};$('zoomIn').onclick=()=>changeZoom(zoom*1.25);$('zoomOut').onclick=()=>changeZoom(zoom/1.25);$('actualSize').onclick=()=>{viewWidth=1;changeZoom(1);};
wrap.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();changeZoom(zoom*(e.deltaY<0?1.15:1/1.15));}else if(e.shiftKey){e.preventDefault();wrap.scrollLeft+=e.deltaY;}},{passive:false});
new ResizeObserver(()=>requestAnimationFrame(layoutGrid)).observe(wrap);
for(const id of ['afterView','originalView','onlyChanged'])$(id).onchange=()=>{selected.clear();render();};
function openLesson(){if(!selected.size)return;$('lessonSummary').textContent=selected.size+'コマに設定します。';for(const [id,values] of [['classOptions',state.classes],['subjectOptions',state.subjects]])$(id).replaceChildren(...values.map(v=>new Option(v,v)));$('lessonClass').value='';$('lessonSubject').value='';$('lessonError').textContent='';$('lessonDialog').showModal();}
$('lessonCancel').onclick=()=>$('lessonDialog').close();$('lessonApply').onclick=()=>run(async()=>{try{const {data}=await rpc('edit',{action:'lesson',cells:pairs(selected),classes:$('lessonClass').value.trim(),subject:$('lessonSubject').value.trim()});update(data);dirty=true;$('lessonDialog').close();status('クラス・教科を設定しました。');}catch(e){$('lessonError').textContent=e.message;}});
$('candidateList').onclick=()=>{const rows=$('candidateRows');rows.replaceChildren(...candidateList.map((c,i)=>{const b=document.createElement('button');b.textContent=`案${i+1}　変更${c.changed}コマ・先生${c.teachers}人`;b.onclick=async()=>{$('candidates').value=i;await preview();const lines=[];for(const t of displayView.teachers)for(let s=0;s<29;s++)if(displayView.changed.some(([id,slot])=>id===t.id&&slot===s))lines.push(`${t.name} ${config.slots[s]}　${t.original[s]||'空き'} → ${t.cells[s]||'空き'}`);$('candidateChanges').textContent=lines.join('\n');};return b;}));$('candidateChanges').textContent='候補を選ぶと変更内容を表示します。';$('candidateDialog').showModal();};$('closeCandidates').onclick=()=>$('candidateDialog').close();

async function toggleFullscreen(){
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.fullscreenEnabled&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});
    else{status('全画面表示は、このブラウザーでは利用できません。Edge・ChromeではF11キーも使えます。');return;}
  }catch{status('全画面に切り替えられませんでした。Edge・ChromeではF11キーをお試しください。');}
}
function updateFullscreen(){
  const active=!!document.fullscreenElement;
  for(const button of document.querySelectorAll('[data-fullscreen]')){button.textContent=active?'✖全画面表示を解除':'全画面表示';button.setAttribute('aria-pressed',String(active));button.title=active?'全画面表示を解除（Escでも戻れます）':'ブラウザーのタブやアドレス欄を隠して広く表示';}
  requestAnimationFrame(layoutGrid);
}
for(const button of document.querySelectorAll('[data-fullscreen]'))button.onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',updateFullscreen);updateFullscreen();

if(document.fonts)document.fonts.ready.then(()=>requestAnimationFrame(layoutGrid));
