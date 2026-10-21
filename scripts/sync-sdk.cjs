'use strict';
// Public snapshots are copied from the SDK distribution; never edit definitions here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]||process.env.MT_PLUGIN_SDK||path.join(root,'../plugin-sdk'));
const files=['index.d.ts','methods.json','mock.cjs','cli.cjs','package.json','ui-schema/index.cjs','ui-schema/index.d.ts','ui-schema/registry.json'];
const hashes={};
for(const file of files){const data=fs.readFileSync(path.join(source,file));const target=path.join(root,'sdk',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);hashes[file]=crypto.createHash('sha256').update(data).digest('hex');}
fs.writeFileSync(path.join(root,'sdk/snapshot.json'),JSON.stringify({sdkVersion:'2',source:'MediaTidy plugin-sdk',sha256:hashes},null,2)+'\n');
console.log('SDK v2 public snapshots synchronized');
