'use strict';
const vm=require('node:vm');
const crypto=require('node:crypto');
const contract=require('./methods.json');
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const fail=(code,message)=>Object.assign(new Error(message),{code,retryable:false});
function buildSDK(call){
 const sdk=Object.create(null);
 for(const m of contract.methods){const parts=m.name.split('.');let o=sdk;for(const part of parts.slice(0,-1))o=o[part]||=(Object.create(null));o[parts.at(-1)]=input=>call(m.name,input===undefined?{}:clone(input))}
 const freeze=o=>{for(const value of Object.values(o))if(typeof value==='object')freeze(value);return Object.freeze(o)};return freeze(sdk);
}
// Only trusted local test code belongs in Node's VM. Production uses Goja in a
// separate process. Missing business fixtures fail rather than simulate success.
function runPlugin(code,input,handlers={}){
 const calls=[];
 const mt=buildSDK((name,arg)=>{calls.push({name,input:clone(arg)});if(!handlers[name])throw fail('MISSING_MOCK',`Provide a fixture for ${name}`);return clone(handlers[name](arg))});
 const context=vm.createContext({module:{exports:{}},mt,input:clone(input)});
 vm.runInContext(code,context,{timeout:1000});
 const result=vm.runInContext('module.exports.run(input)',context,{timeout:5000});
 if(result&&typeof result.then==='function')throw fail('UNSUPPORTED','Worker entry must be synchronous');
 if(result===undefined)throw fail('INVALID_RESULT','Return a JSON value');
 return {result:clone(result),calls};
}
function createMockHost(options={}){
 let clock=options.now??Date.now();let waiting=false;
 let values=new Map();const tasks=new Map();const grants=new Set(options.permissions||[]);
 const limits={quotaBytes:options.quotaBytes??33554432,quotaKeys:options.quotaKeys??10000,valueLimit:262144,batchLimit:1048576};
 function current(key){const v=values.get(key);return v&&(!v.expiresAt||Date.parse(v.expiresAt)>clock)?v:undefined}
 function entry(key,v=current(key)){return v?{key,found:true,...clone(v)}:{key,found:false,bytes:0}}
 function usage(map=values){let bytes=0,keys=0;for(const v of map.values())if(!v.expiresAt||Date.parse(v.expiresAt)>clock){keys++;bytes+=v.bytes}return{bytes,keys,...limits}}
 function batch({operations}){
  if(!Array.isArray(operations)||!operations.length||operations.length>100||Buffer.byteLength(JSON.stringify(operations))>limits.batchLimit)throw fail('INVALID_ARGUMENT','Invalid storage batch');
  const next=new Map(values);const out=[];
  for(const op of operations){
   if(typeof op.key!=='string'||!op.key||Buffer.byteLength(op.key)>256||['__proto__','prototype','constructor'].includes(op.key))throw fail('INVALID_ARGUMENT','Invalid key');
   let old=next.get(op.key);if(old?.expiresAt&&Date.parse(old.expiresAt)<=clock)old=undefined;
   if(op.expectedRevision!==undefined&&op.expectedRevision!==(old?.revision||''))throw fail('CONFLICT','Revision changed');
   if(op.operation==='set'){
    const json=JSON.stringify(op.value);if(json===undefined||Buffer.byteLength(json)>limits.valueLimit)throw fail('QUOTA_EXCEEDED','Value too large');
    if(op.expiresAt!==undefined&&!Number.isFinite(Date.parse(op.expiresAt)))throw fail('INVALID_ARGUMENT','Invalid expiration');
    const v={value:clone(op.value),bytes:Buffer.byteLength(json),revision:crypto.randomUUID(),updatedAt:new Date(clock).toISOString(),...(op.expiresAt?{expiresAt:op.expiresAt}:{})};next.set(op.key,v);out.push(entry(op.key,v));
   }else if(op.operation==='delete'){next.delete(op.key);out.push({key:op.key,found:false,bytes:0})}else if(op.operation==='get')out.push(entry(op.key,old));else throw fail('INVALID_ARGUMENT','Invalid operation');
  }
  const u=usage(next);if(u.bytes>limits.quotaBytes||u.keys>limits.quotaKeys)throw fail('QUOTA_EXCEEDED','Storage quota exceeded');values=next;return out;
 }
 const core={
  'runtime.info':()=>({sdkVersion:'2',instanceId:options.instanceId||'mock-instance',runId:'mock-run',action:'test',pluginVersion:'0.1.0',scheduleId:'',parentRunId:'',limits:{textBytes:131072,storageValueBytes:262144,storageBatchBytes:1048576,maxFileBatch:100,maxScanFiles:10000}}),
  'runtime.capabilities':()=>contract.methods.map(m=>({method:m.name,permission:m.permission,granted:!m.permission||grants.has(m.permission),perRunLimit:m.limit,calls:0})),
  'runtime.resources':()=>({roots:options.roots||[],organizeProfileIds:[],strmProfileIds:[],notificationChannelIds:[],http:[]}),
  'runtime.checkpoint':()=>true,'runtime.progress':()=>true,'runtime.result':({value})=>{if(Buffer.byteLength(JSON.stringify(value))>262144)throw fail('QUOTA_EXCEEDED','Result too large');return true},'config.get':()=>clone(options.config||{}),'log':()=>true,
  'storage.get':({key})=>entry(key),'storage.set':arg=>batch({operations:[{...arg,operation:'set'}]})[0],'storage.delete':arg=>batch({operations:[{...arg,operation:'delete'}]})[0],'storage.batch':batch,'storage.usage':()=>usage(),
  'storage.list':({prefix='',cursor='',limit=50,values:withValues=false})=>{const all=[...values.keys()].filter(k=>k.startsWith(prefix)&&k>cursor&&current(k)).sort();const keys=all.slice(0,limit);return{items:keys.map(k=>{const e=entry(k);if(!withValues)delete e.value;return e}),nextCursor:all.length>limit?keys.at(-1):''}},
  'files.roots':()=>clone(options.roots||[]),
  'tasks.list':()=>({items:[...tasks.values()],nextCursor:''}),
  'tasks.get':({ref})=>{if(!tasks.has(ref))throw fail('NOT_FOUND','Task not found');return clone(tasks.get(ref))},
  'tasks.wait':({refs})=>{if(!refs.length||refs.some(ref=>!tasks.has(ref)))throw fail('PERMISSION_DENIED','Unknown task');waiting=true;return{waiting:true}},
 };
 const handlers={};for(const m of contract.methods)handlers[m.name]=arg=>{if(waiting)throw fail('FLOW_WAITING','Return after tasks.wait');if(m.permission&&!grants.has(m.permission))throw fail('PERMISSION_DENIED','Missing permission');const fn=options.handlers?.[m.name]||core[m.name];if(!fn)throw fail('MISSING_MOCK',`Provide a fixture for ${m.name}`);return clone(fn(arg))};
 return {handlers,advanceTime(ms){clock+=ms},beginRun(){waiting=false},addTask(task){tasks.set(task.ref,clone(task))},snapshot(){return clone([...values])}};
}
module.exports={runPlugin,createMockHost,buildSDK,contract};
