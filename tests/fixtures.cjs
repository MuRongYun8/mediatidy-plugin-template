'use strict';
const fs=require('node:fs'),path=require('node:path');
const {runPlugin,createMockHost}=require('../sdk/mock.cjs');
const code=fs.readFileSync(path.join(__dirname,'../dist/index.js'),'utf8');
const manifest=require('../plugin.json');
const file=(ref,name=ref+'.mkv',extra={})=>({ref,name,path:'media/'+name,rootId:'media',version:'v1',isDir:false,size:100,modifiedAt:'2026-01-01T00:00:00Z',...extra});
const files=[file('movie','Film.2024.mkv'),file('tv','A.Prophet.2026.S01E03.2160p.TX.WEB-DL.DDP5.1.HFR.H.265-FGTWeb.mkv')];
const identity=f=>({fileRef:f.ref,title:f.ref==='movie'?'Film':'AI 识别的剧名',year:2024,mediaType:f.ref==='tv'?'tv':'movie',season:f.ref==='tv'?2:null,episode:f.ref==='tv'?3:null,multiEpisode:false,reason:'模拟结论',tmdbId:f.ref==='tv'?202:101});
const answer=items=>({message:{role:'assistant',content:JSON.stringify({items})},usage:{},metrics:{modelRequests:1,nativeWebRequests:0,compatibilityRetries:0}});
const tool=(name,args,id='call')=>({message:{role:'assistant',toolCalls:[{id,name,arguments:JSON.stringify(args)}]},usage:{},metrics:{modelRequests:1,nativeWebRequests:0,compatibilityRetries:0}});
function fixture(options={}){
  let host,sequence=0,round=0,currentRun='',replay=[],lastWait;
  const submitted=[],tasks=[],snapshots=[],trace=[];
  const task=(kind,input)=>{const t={ref:'task-'+(tasks.length+1),runId:currentRun,kind,status:'queued',total:1,completed:0,failed:0,updatedAt:'2026-01-01T00:00:00Z'};tasks.push(t);host.addTask(t);return t;};
  const handlers={
    'runtime.info':()=>({sdkVersion:'2',instanceId:'test-instance',runId:currentRun,action:'test',pluginVersion:manifest.version,parentRunId:'',scheduleId:'',limits:{}}),
    'runtime.result':({value})=>{if(Buffer.byteLength(JSON.stringify(value))>262144)throw Error('RESULT_TOO_LARGE');snapshots.push(value);return true},
    'system.config':()=>({revision:'r1',version:'test',videoExtensions:['.mkv','.mp4'],metadataExtensions:['.nfo'],aiEnabled:true,aiModel:'mock',tmdbLanguage:'zh-CN',webSearchEnabled:true,proxyEnabled:false}),
    'organize.profile':()=>({id:1,name:'测试方案',enabled:true,kind:'organize',revision:'r1',source:{ref:'source',name:'来源'},destination:{ref:'dest',name:'媒体库'},settings:{}}),
    'ai.capabilities':()=>typeof options.capabilities==='function'?options.capabilities():options.capabilities||{chat:{available:true,reason:'available'},webSearch:{available:true,reason:'available'},tmdb:{available:true,reason:'available'}},
    'ai.chat':v=>options.chat?options.chat(v,round++):answer(JSON.parse(v.messages[1].content).files.map(f=>identity({ref:f.fileRef})).reverse()),
    'ai.web.search':options.web||(()=>({items:[{title:'公开来源',summary:'摘要',url:'https://example.com/show'}],usage:{},metrics:{}})),
    'tmdb.search':options.search||(()=>[]),'tmdb.detail':options.detail||(v=>({id:v.id,title:'工具返回作品',mediaType:v.mediaType,year:'2024',originalTitle:'',overview:''})),
    'tmdb.season':()=>[1,2,3],
    'files.scan':v=>task('files',v),'tasks.items':options.items||(()=>({items:[],nextOffset:-1})),
    'organize.manual.run':v=>{if(options.submit)return options.submit(v,submitted,task);submitted.push(v);return task('organize.manual',v)},
  };
  host=createMockHost({permissions:manifest.permissions,handlers});
  const wrapped=Object.fromEntries(Object.entries(host.handlers).map(([name,fn])=>[name,v=>{trace.push(name);try{const result=fn(v);replay.push({method:name,input:v,result});if(name==='tasks.wait')lastWait=v;return result;}catch(e){replay.push({method:name,input:v,error:'fixture failure'});throw e;}}]));
  function execute(input={}){
    currentRun='run-'+(++sequence);host.beginRun();replay=[];lastWait=undefined;
    const value={action:'recognize',files,input:{profileId:1,instructions:'用户原始说明'},config:options.config||{},sdkVersion:'2',...input};
    const result=runPlugin(code,value,wrapped);return {...result,scenario:{name:value.action,input:value,calls:replay,result:result.result},wait:lastWait,runId:currentRun};
  }
  function complete(previous,action,status='done'){
    const input=previous.wait.completion.input;
    const eventTasks=tasks.filter(t=>previous.wait.refs.includes(t.ref)).map(t=>({...t,status,...(status==='failed'?{error:{code:'BUSINESS_FAILED',message:'业务失败',retryable:false}}:{})}));
    return execute({action,files:[],input,event:{id:'event-'+sequence,instanceId:'test-instance',parentRunId:previous.runId,tasks:eventTasks}});
  }
  return {execute,complete,submitted,tasks,snapshots,trace,host};
}
module.exports={fixture,files,file,identity,answer,tool,code,manifest};
