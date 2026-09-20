import {loadPyodide} from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';
let py;
globalThis.reportProgress = text => postMessage({type:'progress',data:JSON.parse(text)});
const ready=(async()=>{
  postMessage({type:'status',text:'検索エンジンを準備しています…'});
  py=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});
  const response=await fetch('./engine.zip?v=20260920-ui2');if(!response.ok)throw new Error('検索エンジンを取得できませんでした。');
  py.FS.mkdirTree('/app');py.FS.mkdirTree('/data');
  py.unpackArchive(await response.arrayBuffer(),'zip',{extractDir:'/app'});
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
  }catch(error){postMessage({id,error:String(error)});}
};
