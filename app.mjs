const $=id=>document.getElementById(id);
let worker,config,state,snapshot,originalBytes,fileName,readyResolve,workerReady,pending=new Map(),sequence=0,activeTab='edit',selected=new Set(),anchor=null,candidate=-1,candidateList=[],busy=false,recovering=false,timer=null,dirty=false;
const key=(t,s)=>`${t}:${s}`,pairs=set=>[...set].map(v=>{const[t,s]=v.split(':');return[t,+s]});
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function startWorker(){
  workerReady=new Promise(r=>readyResolve=r);worker=new Worker('./worker.mjs',{type:'module'});
  worker.onmessage=({data:m})=>{
    if(m.type==='status'){status(m.text);return;}
    if(m.type==='ready'){config=m.data;readyResolve();$('runtime').textContent='ブラウザー内で実行';$('open').disabled=$('open2').disabled=busy;status('準備できました。Excelを読み込んでください。');return;}
    if(m.type==='progress'){if(m.data.solutions!==undefined)$('solutions').textContent=m.data.solutions;return;}
    if(m.type==='fatal'){status('起動できませんでした。通信環境を確認してページを再読み込みしてください。\n'+m.error,true);return;}
    const job=pending.get(m.id);if(!job)return;pending.delete(m.id);m.error?job.reject(new Error(m.error)):job.resolve(m);
  };
  worker.onerror=e=>status('実行部品を読み込めませんでした。ページを再読み込みしてください。'+e.message,true);
}
async function rpc(command,args={},bytes){await workerReady;const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,command,args,bytes});});}
function setBusy(on){busy=on;document.body.classList.toggle('busy',on);$('open').disabled=on||!config;$('save').disabled=on||!state;}
async function run(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){status(e.message,true);}finally{setBusy(false);}}
function update(data){if(data.snapshot)snapshot=data.snapshot;if(data.view){state=data.view;render();}if(data.snapshot){candidateList=[];$('count').textContent='0';}}
function render(view=state){
  $('welcome').hidden=true;$('workspace').hidden=false;$('save').disabled=busy;$('filename').textContent=fileName;
  const marked=field=>new Set(view[field].map(([t,s])=>key(t,s))),absent=marked('absent'),fixed=marked('fixed'),changed=marked('changed'),study=marked('study'),violations=marked('violations');
  const table=$('grid');table.replaceChildren();const head=document.createElement('thead');const days=document.createElement('tr');
  const corner=document.createElement('th');corner.className='teacher';corner.rowSpan=2;corner.textContent='先生';days.append(corner);
  for(const [d,n] of [['月',6],['火',6],['水',6],['木',5],['金',6]]){const th=document.createElement('th');th.colSpan=n;th.textContent=d+'曜日';th.className='dayStart';days.append(th);}
  const periods=document.createElement('tr');config.slots.forEach((s,i)=>{const th=document.createElement('th');th.textContent=s.slice(1);if([0,6,12,18,23].includes(i))th.className='dayStart';periods.append(th);});head.append(days,periods);table.append(head);
  const body=document.createElement('tbody');let prev;
  view.teachers.forEach((teacher,row)=>{const tr=document.createElement('tr');if(teacher.grade!==prev&&teacher.grade!=='未設定')tr.className='gradeStart';prev=teacher.grade;const th=document.createElement('th');th.className='teacher';th.textContent=teacher.name;tr.append(th);
    teacher.cells.forEach((value,s)=>{const cell=document.createElement('td');const k=key(teacher.id,s);cell.dataset.key=k;cell.dataset.row=row;cell.dataset.slot=s;cell.tabIndex=-1;cell.textContent=value.replace(/^!/,'').replace(' ','\n');cell.title=teacher.name+' '+config.slots[s]+' '+value.replace(/^!/,'');
      if(value==='/')cell.classList.add('blocked');if(absent.has(k))cell.classList.add('absent');if(fixed.has(k))cell.classList.add('fixed');if(changed.has(k))cell.classList.add('changed');if(study.has(k))cell.classList.add('study');if(violations.has(k))cell.classList.add('violation');if(selected.has(k))cell.classList.add('selected');if([0,6,12,18,23].includes(s))cell.classList.add('dayStart');
      cell.onclick=e=>selectCell(e,teacher.id,row,s);tr.append(cell);});body.append(tr);});table.append(body);$('undo').disabled=!view.undo;renderSettings();
}
async function selectCell(e,t,row,s){
  if(busy||!['edit','result'].includes(activeTab))return;
  if(e.shiftKey&&anchor){selected.clear();for(let r=Math.min(row,anchor.row);r<=Math.max(row,anchor.row);r++)for(let c=Math.min(s,anchor.s);c<=Math.max(s,anchor.s);c++)selected.add(key(state.teachers[r].id,c));}
  else if(e.ctrlKey||e.metaKey){const k=key(t,s);selected.has(k)?selected.delete(k):selected.add(k);anchor={row,s};}
  else{selected=new Set([key(t,s)]);anchor={row,s};}
  document.querySelectorAll('#grid td').forEach(c=>c.classList.toggle('selected',selected.has(c.dataset.key)));
  const description=state.teachers[row].name+' '+config.slots[s]+' '+(state.teachers[row].cells[s].replace(/^!/,'')||'空き')+`　｜ ${selected.size}コマ選択`;
  $('selectionInfo').textContent=description;const token=sequence;
  try{const {data}=await rpc('detail',{cell:[t,s]});if(sequence===token+1)$('selectionInfo').textContent=description+(data.reasons.length?'（'+data.reasons.join('、')+'）':'');}catch(e){status(e.message,true);}
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
function switchTab(name){activeTab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===name));$('settings').hidden=name!=='settings';$('gridPanel').hidden=name==='settings';$('candidateBar').hidden=name!=='candidates';$('toolbar').hidden=name==='settings';document.querySelector('.editbuttons').hidden=name!=='edit';if(name!=='candidates'&&state)render();if(name==='candidates'&&candidateList.length)preview();}
function message(title,text,confirm=false){$('messageTitle').textContent=title;$('messageText').textContent=text;$('messageCancel').hidden=!confirm;$('messageDialog').showModal();return new Promise(resolve=>{const close=v=>{$('messageDialog').close();resolve(v);};$('messageOK').onclick=()=>close(true);$('messageCancel').onclick=()=>close(false);$('messageDialog').oncancel=()=>resolve(false);});}
async function edit(action){if(!selected.size){status('変更するコマを選んでください。');return;}await run(async()=>{const args={action,cells:pairs(selected)};let {data}=await rpc('edit',args);if(data.confirm){if(!await message('合同授業の変更',data.confirm,true))return;({data}=await rpc('edit',{...args,confirmed:true}));}update(data);dirty=true;status('条件を変更しました。');});}
async function preview(){candidate=+$('candidates').value;await run(async()=>{const {data}=await rpc('preview',{index:candidate});render(data.view);const c=candidateList[candidate];$('candidateSummary').textContent=`変更 ${c.changed}コマ ／ 関わる先生 ${c.teachers}人`;});}
async function search(mode){
  $('timeDialog').close();if(busy)return;setBusy(true);candidateList=[];const seconds={quick:30,standard:120,careful:300}[mode],start=performance.now();$('solutions').textContent='0';$('progress').value=0;$('progressDialog').showModal();
  timer=setInterval(()=>{const elapsed=(performance.now()-start)/1000;$('progress').value=Math.min(100,elapsed/seconds*100);$('elapsed').textContent=`${Math.floor(elapsed)}秒 ／ 最大${seconds}秒`;},150);
  try{const {data}=await rpc('search',{mode});candidateList=data.candidates;$('count').textContent=candidateList.length;$('candidates').replaceChildren(...candidateList.map((c,i)=>new Option(`案${i+1}：${c.changed}コマ・${c.teachers}人`,i)));status(`${data.seconds.toFixed(1)}秒で ${data.solutions}件。上位${candidateList.length}件を表示します。`);if(!candidateList.length)await message('解決案が見つかりませんでした',[...data.issues,...data.diagnostics].slice(0,7).join('\n')||'検索時間を長くするか、空き指定・固定条件を確認してください。');}
  catch(e){if(e.message!=='cancelled')status(e.message,true);}
  finally{clearInterval(timer);$('progressDialog').close();if(!recovering)setBusy(false);}
  if(candidateList.length){switchTab('candidates');}
}
async function cancelSearch(){
  if(!busy)return;recovering=true;worker.terminate();for(const job of pending.values())job.reject(new Error('cancelled'));pending.clear();clearInterval(timer);$('progressDialog').close();startWorker();await workerReady;await rpc('restore',{snapshot},originalBytes);recovering=false;setBusy(false);status('中止しました。検索前の時間割と条件を保持しています。');
}
$('open').onclick=$('open2').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;if(dirty&&!await message('Excelを読み込む','未保存の変更を破棄して別のExcelを読み込みますか？',true))return;await run(async()=>{const bytes=await file.arrayBuffer();const {data}=await rpc('load',{name:file.name},bytes);originalBytes=bytes;fileName=file.name;selected.clear();update(data);dirty=false;switchTab('edit');status(`${state.teachers.length}人の時間割を読み込みました。`);});$('file').value='';};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>edit(b.dataset.action));
$('undo').onclick=()=>run(async()=>{update((await rpc('undo')).data);dirty=true;status('1つ前に戻しました。');});
$('search').onclick=()=>{if(!busy)$('timeDialog').showModal();};$('closeTime').onclick=()=>$('timeDialog').close();document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>search(b.dataset.mode));
$('cancel').onclick=cancelSearch;$('progressDialog').oncancel=e=>{e.preventDefault();cancelSearch();};$('candidates').onchange=preview;
$('apply').onclick=()=>run(async()=>{if(!candidateList.length)return;update((await rpc('apply',{index:+$('candidates').value})).data);dirty=true;switchTab('result');status('変更案を確定しました。Excelに保存してください。');});
$('save').onclick=()=>{if(candidateList.length){message('確定してから保存','変更候補を確定するか、条件を変更して候補を取り消してから保存してください。');return;}$('saveName').value=fileName.replace(/\.xlsx$/i,'')+'_変更.xlsx';$('saveDialog').showModal();};$('saveCancel').onclick=()=>$('saveDialog').close();
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
