/// <reference path="../../sdk/index.d.ts" />
import {analyst,defaultPrompt,integer,text,safe,type Identity} from './ai';
import type {Flow,Item} from './types';

const json=(v:unknown):MTJSON=>JSON.parse(JSON.stringify(v));
const itemKey=(ref:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(ref))throw Error('文件引用无效');return 'ai/v2/file/'+ref;};
const write=(key:string,value:unknown)=>mt.storage.set({key,value:json(value)});
function read<T>(key:string):T {const v=mt.storage.get({key});if(!v.found||!v.value||!safe(v.value))throw Error('运行数据不存在或格式无效，请重新选择文件');return v.value as unknown as T;}
const load=(flow:Flow)=>flow.refs.map(ref=>read<Item>(itemKey(ref)));
function seed(file:MTFile,flow:Flow):Item{return {version:2,file,flowKey:flow.key,profileId:flow.profileId,title:'',year:null,mediaType:'unknown',tmdbId:null,season:null,episode:null,reason:'',warning:'',sources:'',status:'needs_review',error:'尚未识别',retryable:true};}
function bytes(s:string):number{let n=0;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&i+1<s.length&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n;}
function views(items:Item[]){
  const rows=items.map(i=>({fileRef:i.file.ref,name:i.file.name,path:i.file.path,title:i.title,year:i.year,mediaType:i.mediaType,tmdbId:i.tmdbId,seasonEpisode:i.mediaType==='tv'?`S${i.season??'?'} E${i.episode??'?'}`:'',reason:i.reason,warning:i.warning,sources:i.sources,status:i.status==='ready'?'pending':i.status,error:i.error,taskRef:i.taskRef||'',retryable:i.retryable}));
  if(bytes(JSON.stringify(rows))>240000)for(const row of rows){row.name=row.name.slice(0,150);row.path=row.path.slice(0,200);row.reason=row.reason.slice(0,80);row.warning=row.warning.slice(0,100);row.sources='详情较长，已省略来源；原始文件信息可在文件浏览器查看';}
  if(bytes(JSON.stringify(rows))>240000)for(const row of rows){row.name=row.name.slice(0,80);row.path=row.path.slice(0,80);row.title=row.title.slice(0,120);row.error=row.error.slice(0,90);row.reason=row.reason.slice(0,50);row.warning=row.warning.slice(0,50);row.sources='';}
  return rows;
}
function publish(items:Item[]){mt.runtime.result({value:json(views(items))});}
function append(flow:Flow,files:MTFile[]){
  const items=load(flow),seen=new Set(items.map(i=>i.file.rootId+':'+i.file.path));
  for(const f of files){
    const key=f.rootId+':'+f.path;if(seen.has(key))continue;
    if(flow.refs.length>=100)throw Error('选择范围超过 100 个视频，请缩小范围分批处理；本次尚未识别或整理');
    seen.add(key);flow.refs.push(f.ref);const item=seed(f,flow);write(itemKey(f.ref),item);items.push(item);
  }
  write(flow.key,flow);return items;
}
function identity(item:Item,v:Identity|undefined,note:string,sources:string[]){
  item.title=text(v?.title,300);item.year=integer(v?.year,1)?v!.year:null;
  item.mediaType=v?.mediaType==='movie'||v?.mediaType==='tv'?v.mediaType:'unknown';
  item.tmdbId=integer(v?.tmdbId,1,2147483647)?v!.tmdbId:null;
  item.season=integer(v?.season,0)?v!.season:null;item.episode=integer(v?.episode,1)?v!.episode:null;
  item.reason=text(v?.reason,500);item.warning=note;
  item.sources=(Array.isArray(v?.sources)?v!.sources.filter((s):s is string=>typeof s==='string'&&sources.includes(s)).slice(0,5):[]).join('\n').slice(0,2000);
  item.status='needs_review';item.error='';item.retryable=true;
  const invalid=v&&(typeof v.title!=='string'||v.title.length>300||!['movie','tv','unknown'].includes(String(v.mediaType))||v.year!=null&&!integer(v.year,1)||v.season!=null&&!integer(v.season,0)||v.episode!=null&&!integer(v.episode,1)||v.tmdbId!=null&&!integer(v.tmdbId,1,2147483647)||v.multiEpisode!==undefined&&typeof v.multiEpisode!=='boolean');
  if(item.mediaType==='tv'&&v&&v.season==null){item.season=1;item.warning+=(item.warning?'；':'')+'未识别到季数，默认第 1 季';}
  if(!v)item.error='AI 未返回此文件的有效结论';
  else if(invalid)item.error='AI 输出字段异常，请重试';
  else if(!item.title||item.mediaType==='unknown')item.error='AI 未确定作品或类型';
  else if(v.multiEpisode===true)item.error='AI 判断为多集合集，当前单文件季集参数无法表达，请人工处理';
  else if(!item.tmdbId)item.error='AI 已识别作品，未给出手动整理所需的 TMDB ID';
  else if(item.mediaType==='tv'&&(item.season===null||item.episode===null))item.error='AI 未给出完整季集，不猜测集号';
  else item.status='ready';
}
function submit(flow:Flow,item:Item){
  if(item.status!=='ready'||item.taskRef)return;
  // Persist before calling a mutation. An interrupted submission is never
  // automatically replayed by retry-pending.
  item.submissionKey='ai:manual:'+item.file.ref;
  item.status='outcome_unknown';item.retryable=false;item.error='正在提交；若中断请先核对 MT 任务';write(itemKey(item.file.ref),item);
  try {
    const task=mt.organize.manual.run({fileRef:item.file.ref,profileId:item.profileId,tmdbId:item.tmdbId!,mediaType:item.mediaType as 'movie'|'tv',...(item.mediaType==='tv'?{season:item.season!,episode:item.episode!}:{}),idempotencyKey:item.submissionKey});
    item.taskRef=task.ref;item.status=task.status;item.error=task.error?.message||'';flow.taskRefs.push(task.ref);
  } catch(e){
    mt.runtime.checkpoint();
    const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
    if(['INVALID_ARGUMENT','RESOURCE_CHANGED','PERMISSION_DENIED','UNSUPPORTED','UNAVAILABLE'].includes(code)){item.status='needs_review';item.retryable=true;delete item.submissionKey;item.error='整理未提交：'+code+'，请检查文件、方案或授权';}
    else item.error='整理提交结果待核对，不会自动重试；请查看 MT 任务中心';
  }
  write(itemKey(item.file.ref),item);
}
function process(flow:Flow,input:MTInput){
  const items=load(flow),pending=items.filter(i=>i.retryable&&!i.taskRef),identify=analyst(text(input.config.prompt,16000)||defaultPrompt,flow.instructions);
  for(let offset=0;offset<pending.length;offset+=8){
    mt.runtime.checkpoint();
    mt.runtime.progress({completed:offset,total:pending.length,message:`AI 分析 · 第 ${Math.floor(offset/8)+1}/${Math.ceil(pending.length/8)} 批`});
    const batch=pending.slice(offset,offset+8),result=identify(batch.map(i=>i.file));
    for(const item of batch){identity(item,result.identified[item.file.ref],result.note,result.sources);write(itemKey(item.file.ref),item);}
    publish(items);
    for(const item of batch){mt.runtime.checkpoint();submit(flow,item);}
    write(flow.key,flow);
    publish(items);
    mt.runtime.progress({completed:Math.min(offset+8,pending.length),total:pending.length,message:'AI 结论已保存，按结论逐文件提交手动整理'});
    if(result.stop)break;
  }
  if(flow.taskRefs.length){
    flow.organizeRunId=mt.runtime.info().runId;write(flow.key,flow);
    mt.runtime.progress({completed:0,total:flow.taskRefs.length,message:'等待 MT 手动整理任务；已入队不代表成功'});
    mt.tasks.wait({refs:flow.taskRefs,completion:{action:'organize-complete',input:{flowKey:flow.key}}});
  }
  return views(items);
}
function continuation(input:MTInput,kind:'scan'|'organize'):Flow{
  const key=text(input.input.flowKey,100);
  if(!key.startsWith('ai/v2/flow/'))throw Error('完成动作缺少运行引用');
  const flow=read<Flow>(key),expected=kind==='scan'?flow.scanTasks:flow.taskRefs,parent=kind==='scan'?flow.scanRunId:flow.organizeRunId;
  if(flow.version!==2||!input.event||input.event.parentRunId!==parent||input.event.tasks.length!==expected.length||input.event.tasks.some(t=>!expected.includes(t.ref)))throw Error('此动作只接受对应业务任务的完成事件');
  return flow;
}
module.exports.run=function(input:MTInput){
  if(input.sdkVersion!=='2')throw Error('此插件需要 SDK v2');
  if(input.action==='organize-complete'){
    const flow=continuation(input,'organize'),items=load(flow);
    for(const item of items){const task=input.event!.tasks.find(t=>t.ref===item.taskRef);if(task){item.status=task.status;item.error=task.error?.message||'';write(itemKey(item.file.ref),item);}}
    publish(items);mt.runtime.progress({completed:flow.taskRefs.length,total:flow.taskRefs.length,message:'整理任务已结束，请查看逐文件结果'});return views(items);
  }
  if(input.action==='scan-complete'){
    const flow=continuation(input,'scan');let items=load(flow);
    for(const task of input.event!.tasks){
      let offset=0;
      do {const page=mt.tasks.items({ref:task.ref,offset,limit:100});items=append(flow,page.items.flatMap(i=>i.file?[i.file]:[]));offset=page.nextOffset;}while(offset>=0);
      if(task.status!=='done')throw Error('目录扫描未完成；本次未识别或整理，请检查任务并重新选择');
    }
    if(!items.length)throw Error('所选目录没有 MT 已配置类型的视频文件');
    publish(items);return process(flow,input);
  }
  const runtime=mt.runtime.info(),key='ai/v2/flow/'+runtime.runId;
  const flow:Flow={version:2,key,refs:[],profileId:0,instructions:text(input.input.instructions,16000),scanRunId:runtime.runId,scanTasks:[],organizeRunId:'',taskRefs:[]};
  if(input.action==='retry-pending'){
    const refs=input.input.selectedFileRefs;
    if(!Array.isArray(refs)||!refs.length||refs.length>100||refs.some(r=>typeof r!=='string'))throw Error('请先选择需要重试的结果行');
    const items=[...new Set(refs as string[])].map(ref=>read<Item>(itemKey(ref))).filter(i=>i.version===2&&i.retryable&&!i.taskRef&&!i.submissionKey);
    if(!items.length)throw Error('所选文件均已提交或结果待核对，不会重复整理');
    const previous=read<Flow>(items[0].flowKey);flow.profileId=previous.profileId;flow.instructions=flow.instructions||previous.instructions;
    if(items.some(i=>i.profileId!==flow.profileId||i.flowKey!==previous.key))throw Error('请在同一运行结果中选择待处理文件');
    flow.refs=items.map(i=>i.file.ref);for(const item of items){item.flowKey=flow.key;write(itemKey(item.file.ref),item);}write(flow.key,flow);return process(flow,input);
  }
  if(input.action!=='recognize'||!input.files.length||input.files.length>100||!integer(input.input.profileId,1,2147483647))throw Error('请选择文件或目录及整理方案');
  flow.profileId=input.input.profileId;
  const profile=mt.organize.profile({id:flow.profileId});if(!profile.enabled)throw Error('整理方案已暂停');
  const extensions=mt.system.config().videoExtensions.map(x=>x.toLowerCase().replace(/^\./,''));
  write(flow.key,flow);
  append(flow,input.files.filter(f=>!f.isDir&&extensions.includes(f.name.slice(f.name.lastIndexOf('.')+1).toLowerCase())));
  for(const file of input.files.filter(f=>f.isDir)){
    const task=mt.files.scan({rootId:file.rootId,path:file.path,videoOnly:true,limit:101,idempotencyKey:runtime.runId+':scan:'+file.ref});flow.scanTasks.push(task.ref);
  }
  write(flow.key,flow);
  if(flow.scanTasks.length){
    const rows=views(load(flow));mt.runtime.progress({completed:0,total:flow.scanTasks.length,message:'扫描已选择的目录，统计视频文件'});
    mt.tasks.wait({refs:flow.scanTasks,completion:{action:'scan-complete',input:{flowKey:key}}});return rows;
  }
  if(!flow.refs.length)throw Error('请选择 MT 已配置类型的视频文件');
  return process(flow,input);
};
