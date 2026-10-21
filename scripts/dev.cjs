'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'sdk/cli.cjs');
const command=process.argv[2];
if(command==='build'){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'plugin.json'),'utf8'));
  // The worker owns the default prompt. A generated manifest snapshot makes
  // the complete prompt editable in MT without maintaining a second copy.
  const prompt=fs.readFileSync(path.join(root,'src/worker/ai.ts'),'utf8').match(/export const defaultPrompt = '([^'\r\n]*)';/);
  if(!prompt)throw Error('Default prompt source is missing');
  manifest.config.find(f=>f.key==='prompt').default=prompt[1];
  fs.writeFileSync(path.join(root,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');
}
const result=spawnSync(process.execPath,[cli,command==='typecheck'||command==='validate'?'check':command,root],{stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
