let py;
function readableError(error){
  const detail=String(error),lines=detail.trim().split(/\r?\n/);
  const expected=lines.findLast(line=>/^(ValueError|FileNotFoundError|PermissionError):/.test(line.trim()));
  if(expected)return expected.trim().replace(/^[^:]+:\s*/, '');
  console.error(detail);
  return '処理中にエラーが発生しました。'+(lines.at(-1)||'').replace(/^PythonError:\s*/, '');
}
globalThis.reportProgress = text => postMessage({type:'progress',data:JSON.parse(text)});
const ready=(async()=>{
  const startup=(completed,text)=>postMessage({type:'startup',completed,text});
  startup(0,'実行部品を読み込んでいます');
  // Download the unchanged engine while the Python runtime initializes.
  // Capture errors immediately so a failed request cannot become an unhandled rejection.
  const engineDownload=(async()=>{
    const response=await fetch('./engine.zip?v=20260920-gapfix1');
    if(!response.ok)throw new Error('検索エンジンを取得できませんでした。');
    return {archive:await response.arrayBuffer()};
  })().catch(error=>({error}));
  const {loadPyodide}=await import('https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs');
  startup(1,'実行環境を準備しています');
  py=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});
  startup(2,'時間割の検索エンジンを読み込んでいます');
  const downloaded=await engineDownload;
  if(downloaded.error)throw downloaded.error;
  const {archive}=downloaded;
  startup(3,'検索とExcel編集の準備を仕上げています');
  py.FS.mkdirTree('/app');py.FS.mkdirTree('/data');
  py.unpackArchive(archive,'zip',{extractDir:'/app'});
  py.runPython("import sys;sys.path.insert(0,'/app');import bridge,json");
  const config=JSON.parse(py.runPython("json.dumps(bridge.dispatch('config',{}),ensure_ascii=False)"));
  postMessage({type:'ready',data:config});
})().catch(error=>{postMessage({type:'fatal',error:String(error)});throw error;});
onmessage=async({data})=>{
  const {id,command,args={},bytes}=data;
  try{
    await ready;
    if(bytes)py.FS.writeFile('/data/source.xlsx',new Uint8Array(bytes));
    py.globals.set('_command',command);py.globals.set('_args',JSON.stringify(args));
    const answer=JSON.parse(py.runPython("json.dumps(bridge.dispatch(_command,json.loads(_args)),ensure_ascii=False)"));
    if(command==='export'){
      const file=py.FS.readFile('/data/output.xlsx');postMessage({id,data:answer,file:file.buffer},[file.buffer]);
    }else postMessage({id,data:answer});
  }catch(error){postMessage({id,error:readableError(error)});}
};


