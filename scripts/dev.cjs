const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
function compiler() { try { return require('typescript'); } catch { return require('../../frontend/node_modules/typescript'); } }
const action = process.argv[2];
if (action === 'validate') {
  const m = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
  if (m.sdkVersion !== '1' || m.entry !== 'dist/index.js' || !/^[a-z][a-z0-9.-]{2,79}$/.test(m.id)) throw Error('Invalid manifest');
  if (!m.actions.length || !m.permissions.includes('organize.prepare')) throw Error('Missing actions or capabilities');
} else {
  const ts = compiler();
  if (action === 'typecheck') {
    const program = ts.createProgram(['src/index.ts'], { noEmit: true, strict: true, target: ts.ScriptTarget.ES2017, types: [] });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: process.cwd, getCanonicalFileName: x => x, getNewLine: () => '\n' })); process.exit(1); }
  } else if (action === 'build') {
    const output = ts.transpileModule(fs.readFileSync('src/index.ts','utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, removeComments: true } });
    fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.js', output.outputText);
  } else throw Error('Unknown command');
}
