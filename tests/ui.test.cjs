'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validatePage}=require('../sdk/ui-schema/index.cjs');
test('page and original logo ship inside SDK v2 plugin without draft or host recognition permissions',()=>{
  const m=require('../plugin.json');assert.equal(m.sdkVersion,'2');assert.ok(m.permissions.includes('organize.manual.run'));assert.equal(m.permissions.some(p=>p==='organize.prepare'||p==='organize.submit'||p.startsWith('media.')||p.startsWith('quality.')),false);
  const page=JSON.parse(fs.readFileSync(path.join(__dirname,'..',m.ui.entry)));validatePage(page,m.actions.map(a=>a.id));assert.equal(fs.readFileSync(path.join(__dirname,'..',m.ui.icon)).subarray(1,4).toString(),'PNG');assert.equal(/confirmDrafts|editDraft|run.drafts|SelectionBar/.test(JSON.stringify(page)),false);assert.match(JSON.stringify(page),/AI 识别并整理/);
});
test('SDK snapshots match synchronized checksums',()=>{const s=require('../sdk/snapshot.json');for(const [file,hash] of Object.entries(s.sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../sdk',file))).digest('hex'),hash,file);});
