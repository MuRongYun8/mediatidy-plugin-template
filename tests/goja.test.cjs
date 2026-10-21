'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {goja,archive,check}=require('../sdk/cli.cjs');
const {fixture,files,identity,answer,code}=require('./fixtures.cjs');
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('real Goja replays direct identification, completion and unresolved-file retry',async()=>{
  const f=fixture({chat:(_,i)=>answer(i===0?[identity(files[0])]:[identity(files[1])])}),first=f.execute(),complete=f.complete(first,'organize-complete'),retry=f.execute({action:'retry-pending',files:[],input:{selectedFileRefs:['movie','tv']}});
  for(const scenario of [first,complete,retry])assert.deepEqual((await goja(code,scenario.scenario)).result,scenario.result);
});
test('real Goja validates package including component page and logo',()=>{
  const root=path.resolve(__dirname,'..'),manifest=check(root),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mt-ai-package-')),file=path.join(dir,'plugin.zip');
  try{fs.writeFileSync(file,archive(root,manifest));const binary=process.env.MT_PLUGIN_RUNTIME||path.join(root,'sdk/bin/mt-plugin-runtime.exe'),r=spawnSync(binary,['check-package',file],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||String(r.error));}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
