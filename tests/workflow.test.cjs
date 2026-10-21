'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,files,file,identity,answer,tool}=require('./fixtures.cjs');
test('direct answers go straight to per-file manual organize in one dialogue',()=>{
  const f=fixture(),r=f.execute();assert.equal(r.calls.filter(c=>c.name==='ai.chat').length,1);
  assert.deepEqual(f.submitted.map(p=>[p.fileRef,p.tmdbId,p.season,p.episode]),[['movie',101,undefined,undefined],['tv',202,2,3]]);
  assert.equal(r.result[0].status,'queued');assert.equal(r.calls.at(-1).name,'tasks.wait');assert.equal(f.trace.some(c=>/organize.*prepare|organize.submit|media\./.test(c)),false);
  const model=JSON.parse(r.calls.find(c=>c.name==='ai.chat').input.messages[1].content);
  assert.equal(model.files[1].name,files[1].name);assert.equal(model.instructions,'用户原始说明');assert.deepEqual(Object.keys(model.files[0]).sort(),['fileRef','name','path']);
  assert.ok(f.complete(r,'organize-complete').result.every(i=>i.status==='done'));assert.equal(f.submitted.length,2);
});
test('AI chooses tool order and returns parallel tool results together',()=>{
  const f=fixture({chat:(v,i)=>i===0?{message:{role:'assistant',toolCalls:[tool('web_search',{query:'AI 自己的 原词'},'a').message.toolCalls[0],tool('tmdb_detail',{id:202,mediaType:'tv'},'b').message.toolCalls[0]]}}:(assert.equal(v.messages.filter(m=>m.role==='tool').length,2),answer(files.map(x=>({...identity(x),sources:['https://example.com/show','javascript:alert(1)']}))))});
  const r=f.execute();assert.equal(r.calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(r.calls.find(c=>c.name==='ai.web.search').input.query,'AI 自己的 原词');assert.equal(r.result[1].sources,'https://example.com/show');
  const direct=fixture({chat:(_,i)=>i===0?tool('tmdb_search',{query:'AI 原名',mediaType:'tv'}):i===1?tool('tmdb_season',{id:202,season:0},'s'):answer(files.map(identity))}).execute();
  assert.equal(direct.calls.some(c=>c.name==='ai.web.search'),false);assert.equal(direct.calls.find(c=>c.name==='tmdb.search').input.query,'AI 原名');
});
test('missing, duplicate and foreign refs stay isolated',()=>{
  for(const entries of [[identity(files[0])],[identity(files[0]),identity(files[0]),{...identity(files[1]),fileRef:'foreign'}]]){const f=fixture({chat:()=>answer(entries)}),r=f.execute();assert.equal(r.result[1].status,'needs_review');assert.equal(f.submitted.length,entries.length===1?1:0);}
});
test('missing seasons default one; explicit seasons and missing episodes are preserved',()=>{
  for(const season of [null,undefined,0,3,-1,'2',10000]){const f=fixture({chat:()=>answer([{...identity(files[1]),season}])}),r=f.execute({files:[files[1]]});if(season==null||season===0||season===3){assert.equal(f.submitted[0].season,season??1);if(season==null)assert.match(r.result[0].warning,/默认第 1 季/);}else assert.equal(f.submitted.length,0);}
  const f=fixture({chat:()=>answer([{...identity(files[1]),episode:null}])}),r=f.execute({files:[files[1]]});assert.equal(f.submitted.length,0);assert.match(r.result[0].error,/不猜测/);
});
test('unknown identities, missing IDs and multi-episode files never invoke host recognition',()=>{
  for(const patch of [{title:'',reason:'未知'},{tmdbId:null},{multiEpisode:true},{tmdbId:'202'}]){const f=fixture({chat:()=>answer([{...identity(files[1]),...patch}])}),r=f.execute({files:[files[1]]});assert.equal(f.submitted.length,0);assert.equal(r.result[0].status,'needs_review');assert.equal(f.trace.some(c=>c.startsWith('media.')||c==='tmdb.search'),false);}
});
test('disabled tools are omitted and unsupported functions are not retried in later batches',()=>{
  const noTools={chat:{available:true},webSearch:{available:false,reason:'disabled'},tmdb:{available:false,reason:'not_granted'}};
  const r=fixture({capabilities:noTools,chat:v=>{assert.equal(v.tools,undefined);return answer(files.map(identity))}}).execute();assert.equal(r.calls.filter(c=>c.name==='ai.chat').length,1);
  const many=Array.from({length:9},(_,i)=>file('f'+i));
  const fallback=fixture({chat:(v,i)=>{if(i===0)return {message:{role:'assistant'},toolsUnavailable:true};assert.equal(v.tools,undefined);return answer(JSON.parse(v.messages[1].content).files.map(f=>identity({ref:f.fileRef})));}}).execute({files:many});assert.equal(fallback.calls.filter(c=>c.name==='ai.chat').length,3);
});
test('repeated tools stop the loop and errors never leak to model or result',()=>{
  const repeated=fixture({chat:(_,i)=>tool('tmdb_search',{query:'same',mediaType:'tv'},String(i))}).execute();assert.equal(repeated.calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(repeated.calls.filter(c=>c.name==='tmdb.search').length,1);
  const marker='FF_CACHE_SECRET_MARKER',f=fixture({web:()=>{throw Error(marker)},chat:(v,i)=>i===0?tool('web_search',{query:'q'}):(assert.equal(JSON.stringify(v).includes(marker),false),answer(files.map(identity)))}),r=f.execute();assert.equal(JSON.stringify({result:r.result,calls:r.calls,snapshots:f.snapshots}).includes(marker),false);
});
test('malicious tools and parameters cannot become SDK dispatches',()=>{
  for(const [name,args] of [['organize.manual.run',{confirmed:true}],['http.request',{url:'http://localhost/ff'}],['tmdb_search',JSON.parse('{"query":"x","mediaType":"tv","__proto__":{"x":1}}')],['tmdb_detail',{id:1,mediaType:'tv',url:'http://localhost'}]]){const f=fixture({chat:(_,i)=>i===0?tool(name,args):answer([])}),r=f.execute();assert.equal(f.submitted.length,0);assert.equal(r.calls.some(c=>['http.request','tmdb.search','tmdb.detail'].includes(c.name)),false);}
});
test('100 direct files require 13 AI calls and 100 distinct manual tasks',()=>{
  const f=fixture(),r=f.execute({files:Array.from({length:100},(_,i)=>file('f'+i))});assert.equal(r.calls.filter(c=>c.name==='ai.chat').length,13);assert.equal(f.submitted.length,100);assert.equal(new Set(f.submitted.map(p=>p.idempotencyKey)).size,100);assert.equal(r.wait.refs.length,100);assert.ok(f.snapshots.every(s=>Buffer.byteLength(JSON.stringify(s))<=262144));
});
test('scan completion combines directories and standalone files without duplicate paths',()=>{
  const f=fixture({items:()=>({items:files.map((f,index)=>({index,status:'done',file:f})),nextOffset:-1})}),scan=f.execute({files:[file('folder','folder',{isDir:true,path:'.'}),files[0]]});assert.equal(f.submitted.length,0);assert.equal(scan.wait.completion.action,'scan-complete');
  const r=f.complete(scan,'scan-complete');assert.equal(f.submitted.length,2);assert.equal(r.result.length,2);assert.equal(r.wait.completion.action,'organize-complete');assert.ok(f.complete(r,'organize-complete','failed').result.every(i=>i.status==='failed'));
});
test('overflow and failed scans never partially organize a directory',()=>{
  for(const mode of ['overflow','failed']){const f=fixture({items:()=>({items:Array.from({length:mode==='overflow'?101:1},(_,i)=>({index:i,status:'done',file:file('f'+i)})),nextOffset:-1})}),r=f.execute({files:[file('folder','folder',{isDir:true,path:'.'})]});assert.throws(()=>f.complete(r,'scan-complete',mode==='failed'?'failed':'done'),mode==='overflow'?/100/:/扫描未完成/);assert.equal(f.submitted.length,0);assert.equal(f.trace.includes('ai.chat'),false);}
});
test('retry only touches selected unresolved rows without replaying submitted operations',()=>{
  const f=fixture({chat:(_,i)=>answer(i===0?[identity(files[0])]:[identity(files[1])])}),first=f.execute(),retried=f.execute({action:'retry-pending',files:[],input:{selectedFileRefs:['movie','tv']}});assert.equal(retried.calls.filter(c=>c.name==='ai.chat').length,1);assert.equal(f.submitted.length,2);assert.equal(f.submitted[1].fileRef,'tv');assert.throws(()=>f.execute({action:'retry-pending',files:[],input:{selectedFileRefs:['movie','tv']}}),/不会重复/);assert.equal(f.submitted.length,2);assert.equal(first.result[1].retryable,true);
});
test('unknown submission outcomes cannot be retried automatically',()=>{
  const f=fixture({submit:()=>{throw Error('FF_CACHE_SECRET_MARKER')}}),r=f.execute();assert.ok(r.result.every(i=>i.status==='outcome_unknown'&&!i.retryable));assert.equal(JSON.stringify(r.result).includes('FF_CACHE_SECRET_MARKER'),false);assert.throws(()=>f.execute({action:'retry-pending',files:[],input:{selectedFileRefs:['movie']}}),/不会重复/);
});
test('timeouts preserve completed batches without retrying the batch',()=>{
  const f=fixture({chat:(v,i)=>{if(i)throw Error('secret');return answer(JSON.parse(v.messages[1].content).files.map(f=>identity({ref:f.fileRef})));}}),r=f.execute({files:Array.from({length:20},(_,i)=>file('f'+i))});assert.equal(r.calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(f.submitted.length,8);assert.equal(r.result.filter(i=>i.retryable).length,12);assert.equal(JSON.stringify(r.result).includes('secret'),false);
});
test('custom prompt is the whole prompt; retired strategy settings are ignored',()=>{const r=fixture({config:{prompt:'完整自定义',extractionPrompt:'不应出现',selectionPrompt:'不应出现'}}).execute();assert.equal(r.calls.find(c=>c.name==='ai.chat').input.messages[0].content,'完整自定义');});
test('completion actions require the exact event and cannot be forged',()=>{const f=fixture();assert.throws(()=>f.execute({action:'organize-complete',files:[],input:{flowKey:'ai/v2/flow/nonexistent'}}));const r=f.execute();assert.throws(()=>f.execute({action:'organize-complete',files:[],input:r.wait.completion.input,event:{parentRunId:'fake',tasks:[]}}),/对应业务任务/);});
