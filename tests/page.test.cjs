// Exercise plugin bindings with the host's actual UI protocol evaluator.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { evaluate, validatePage } = require(process.env.MT_UI_SCHEMA || '../../plugin-ui-schema/index.cjs');
const generated = spawnSync(process.env.PYTHON || 'python', ['-c', 'import json; from page import recognition_page; print(json.dumps(recognition_page()))'], {
  cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
});
assert.equal(generated.status, 0, generated.stderr);
const page = validatePage(JSON.parse(generated.stdout), ['recognize', 'retry-recognition'], ['history', 'detail', 'retry-state', 'responses', 'results']);
const results = page.content[0].children.find(n => n.props?.title === '识别结果');
const table = results.children.find(n => n.component === 'Table');
const draftSection = results.children.find(n => n.component === 'Section');
const draftTable = draftSection.children.find(n => n.component === 'Table');

test('response diagnostics use the selected flow, expose failures, and render final text as plain text', () => {
  const section = results.children.find(n => n.props?.label === 'AI 原始回答与诊断');
  const answers = section.children.find(n => n.component === 'Table');
  const query = page.queries.find(q => q.id === 'responses');
  const model = { run: { id: 'continuation', flowId: 'root' }, query: { responses: { data: { items: [{ batch: 1 }] } } } };
  assert.deepEqual(evaluate(model, query.input), { flowKey: 'ai/flow/root', page: 1, revision: '' });
  assert.equal(evaluate(model, answers.props.visible), true);
  const raw = '<script>alert(1)</script>\n{"items":[]}';
  const cells = visibleCells({ batch: 1, diagnosis: '匹配 0/1', responseText: raw, truncated: true }, { columns: answers.props.columns, expanded: true });
  assert.equal(cells[0], '1');
  assert.equal(cells[1], '匹配 0/1');
  assert.match(cells[2], /仅保留前 8 KB/);
  assert.ok(cells[2].includes(raw));
  const disclosure = answers.props.columns[2].cells[0];
  assert.ok(disclosure.children.every(n => n.component === 'Text'));
  const refresh = section.children.find(n => n.component === 'Button');
  assert.deepEqual(refresh.props.onClick, [{ type: 'query', queryId: 'responses' }]);
  const empty = section.children.find(n => n.props?.text === '本次记录没有保存 AI 最终回答。');
  assert.equal(evaluate({ query: { responses: { data: { items: [] } } } }, empty.props.visible), true);
  assert.equal(evaluate({ query: { responses: { loading: true } } }, empty.props.visible), false);
  assert.equal(evaluate({ query: { responses: { error: '读取失败' } } }, empty.props.visible), false);
});

test('invalid AI result is a failure and does not imply the work was unrecognizable', () => {
  const cells = visibleCells({ name: 'Carrie.S01E01.mkv', status: 'failed', recognitionStatus: 'invalid_response',
    error: 'AI 回答缺少此文件的结果或文件引用不匹配' });
  assert.match(cells[2], /失败/);
  assert.doesNotMatch(cells[2], /未识别，已跳过|AI 识别完成/);
});

test('manual retry uses the original flow and is available only when idle with eligible files', () => {
  const card = page.content[0].children.find(n => n.props?.title === '本次识别');
  const button = card.children.flatMap(n => n.children || []).find(n => n.props?.onClick?.[0]?.actionId === 'retry-recognition');
  assert.ok(button);
  for (const status of ['failed', 'done', 'running', 'waiting', 'queued']) {
    const model = { run: { id: 'root', flowId: 'original-flow', status }, query: { retry: { data: { count: 2, flowKey: 'ai/flow/original-flow' } } } };
    assert.equal(evaluate(model, button.props.visible), ['failed', 'done'].includes(status));
    assert.equal(evaluate(model, button.props.label), '重试识别（2 个文件）');
    assert.deepEqual(evaluate(model, button.props.onClick[0].input), { flowKey: 'ai/flow/original-flow' });
    assert.deepEqual(evaluate(model, page.queries[0].input), { flowKey: 'ai/flow/original-flow' });
  }
  assert.equal(evaluate({ run: { status: 'failed' }, query: { retry: { data: { count: 0 } } } }, button.props.visible), false);
  assert.equal(evaluate({ run: { status: 'failed' }, query: {} }, button.props.visible), false);
});

function visibleCells(row, { expanded = false, columns = table.props.columns } = {}) {
  function render(nodes) {
    return nodes.flatMap(node => {
      const props = node.props || {}, model = { row };
      if (props.visible !== undefined && !evaluate(model, props.visible)) return [];
      if (node.component === 'Details') {
        return [String(evaluate(model, props.label)), ...(expanded ? render(node.children || []) : [])];
      }
      return [evaluate(model, props.text)].filter(value => value !== undefined && value !== null).map(String);
    });
  }
  return columns.map(column => render(column.cells).join('\n'));
}

test('1.x history keeps filename and original summary without empty details or false recognition failure', () => {
  const summary = 'AI 已识别，等待 MT 核验：文件名明确标注 S05E01。';
  const cells = visibleCells({ file: 'series/The.It.Crowd.S05E01.mkv', status: summary }, { expanded: true });
  assert.equal(cells[0], 'series/The.It.Crowd.S05E01.mkv');
  assert.equal(cells[1], '旧版记录未保存作品字段');
  assert.equal(cells[2], '旧版摘要');
  assert.equal(cells[3], summary);
});

test('Python results show identity, specials, status and reasoning without expansion', () => {
  const cells = visibleCells({ name: 'Example.S00E01.mkv', title: 'Example', status: 'ready', detail: {
    path: 'series/Example.S00E01.mkv', identity: { title: 'Example', year: 2024, mediaType: 'tv', season: 0, episode: 1, tmdbId: 123, reason: 'Matched the special episode.', sources: ['https://example.invalid/show'] },
  } });
  assert.equal(cells[0], 'Example.S00E01.mkv');
  assert.equal(cells[1], 'Example\n2024 · 剧集 · S0 E1\nTMDB · 123');
  assert.equal(cells[2], '待确认');
  assert.match(cells[3], /^Matched the special episode\./);
});

test('JS 2.x history uses flat identity fields and preserves warnings', () => {
  const cells = visibleCells({ name: 'Example.mkv', title: 'Example', year: 2023, mediaType: 'tv', seasonEpisode: 'S1 E3', tmdbId: 456,
    status: 'needs_review', reason: 'Episode matched.', warning: 'Check the season.', error: 'Confirmation required.' });
  assert.equal(cells[1], 'Example\n2023 · 剧集 · S1 E3\nTMDB · 456');
  assert.equal(cells[2], '需人工处理\nConfirmation required.\nCheck the season.');
  assert.equal(cells[3], 'Episode matched.');
});

test('incomplete current results report missing data explicitly and show no empty disclosure', () => {
  const cells = visibleCells({ name: 'Unknown.mkv', title: '', status: 'needs_review', detail: { identity: { mediaType: 'tv', season: null, episode: null } } }, { expanded: true });
  assert.equal(cells[1], '未确定作品\n剧集 · S? E?');
  assert.equal(cells[3], '未保存识别说明');
});

test('AI failure keeps the filename and actionable error visible without an identity', () => {
  const error = 'AI 识别中止，未提交整理：AI 服务限流（HTTP 429）';
  const cells = visibleCells({ name: 'Example.mkv', title: '', status: 'failed', error,
    detail: { path: 'Example.mkv', identity: {}, taskRef: '' } });
  assert.equal(cells[0], 'Example.mkv');
  assert.equal(cells[2], '失败\n' + error);
});

test('host verification exposes recognized work and validation error for historical runs', () => {
  const draft = { file: { name: 'Example.S05E01.mkv' }, recognition: { title: 'Example' }, tmdbId: 123, mediaType: 'tv',
    season: 5, episode: 1, status: 'needs_review', error: '无法核验目标季', reason: '文件名明确标注 S05E01。' };
  const model = { run: { drafts: [draft], result: [{ file: 'Example.S05E01.mkv', status: 'AI 已识别' }] } };
  assert.equal(evaluate(model, draftSection.props.visible), true);
  const cells = visibleCells(draft, { columns: draftTable.props.columns });
  assert.equal(cells[0], 'Example.S05E01.mkv');
  assert.equal(cells[1], 'Example\nTMDB · 123 · S5 E1');
  assert.equal(cells[2], '需人工处理\n无法核验目标季');
  assert.equal(cells[3], '文件名明确标注 S05E01。');
  assert.equal(evaluate(model, table.props.visible), true);
});

test('partial draft preparation keeps unmatched AI results visible', () => {
  const model = { run: { drafts: [{ id: 'one' }], result: [{ name: 'one' }, { name: 'two', status: 'needs_review' }] } };
  assert.equal(evaluate(model, draftSection.props.visible), true);
  assert.equal(evaluate(model, table.props.visible), true);
});

test('submitted drafts show final task state instead of suggesting the file is still queued', () => {
  const cells = visibleCells({ file: { name: 'Example.mkv' }, status: 'submitted', taskStatus: 'failed', error: 'Target unavailable' }, { columns: draftTable.props.columns });
  assert.equal(cells[2], '失败\nTarget unavailable');
});

test('recognition completion remains visible when organization fails with metadata error', () => {
  const cells = visibleCells({ name: 'Example.mkv', title: 'Example', status: 'organize_failed', recognitionStatus: 'recognized',
    error: 'TMDB ID 不存在', detail: { identity: { title: 'Example', tmdbId: 123, mediaType: 'movie' }, organizeDurationMs: 2500 } });
  assert.match(cells[1], /TMDB · 123/);
  assert.match(cells[2], /AI 识别完成\n整理失败\nTMDB ID 不存在/);
  assert.match(cells[2], /2500 ms/);
});

test('unknown identity is skipped without asking for manual processing or showing invented timing', () => {
  const cells = visibleCells({ name: 'Unknown.mkv', status: 'unrecognized', recognitionStatus: 'unknown', error: 'AI 未提供有效 TMDB ID',
    detail: { identity: { mediaType: 'unknown' }, organizeDurationMs: null } });
  assert.match(cells[2], /未识别，已跳过/);
  assert.doesNotMatch(cells[2], /需人工|整理耗时|AI 识别完成/);
});

test('published batch shows recognition completed while waiting to organize', () => {
  const cells = visibleCells({ name: 'Example.mkv', title: 'Example', status: 'recognized', recognitionStatus: 'recognized', detail: { identity: {tmdbId: 123} } });
  assert.match(cells[2], /AI 识别完成/);
  assert.match(cells[2], /识别完成，待核对/);
});


test('verification failure preserves AI identity, timing and clickable search source', () => {
  const row={name:'Antonia.mkv', title:"Antonia's Line", status:'verification_failed', recognitionStatus:'recognized',
    error:'AI 返回 Antonia，但 ID 754 对应变脸', detail:{identity:{tmdbId:754},metadataCheckMs:15,
    sourceMarkdown:'[TMDB 搜索依据](https://www.themoviedb.org/movie/754)'}};
  const cells=visibleCells(row);
  assert.match(cells[1],/Antonia/);
  assert.match(cells[2],/AI 识别完成/);
  assert.match(cells[2],/核对失败，已跳过/);
  assert.match(cells[2],/元数据核对：15 ms/);
  assert.match(cells[3],/https:\/\/www.themoviedb.org\/movie\/754/);
});

test('metadata verification without citations shows a checked entry, not search evidence', () => {
  const cells=visibleCells({name:'Animales.2026.NF.mkv',title:'Animals',status:'ready',recognitionStatus:'recognized',
    detail:{identity:{title:'Animals',tmdbId:1236045},identityVerified:true,metadataCheckMs:12,
      sourceMarkdown:'[TMDB 核对条目](https://www.themoviedb.org/movie/1236045)'}});
  assert.match(cells[2],/AI 识别完成\nTMDB 核对通过/);
  assert.match(cells[2],/待确认/);
  assert.match(cells[3],/TMDB 核对条目/);
  assert.doesNotMatch(cells.join('\n'),/未识别|搜索依据/);
});

test('result and answer paging follows the selected flow and refreshes with run changes', () => {
  const query = page.queries.find(q => q.id === 'results');
  const model = {run: {id: 'child', flowId: 'flow', updatedAt: 'now'}, state: {resultsFlow: 'ai/flow/flow', resultsPage: 6}, query: {results: {data: {available: true, page: 6, pages: 6, total: 106, previous: 5, next: 6, items: [{name: 'last'}]}}}};
  assert.deepEqual(evaluate(model, query.input), {flowKey: 'ai/flow/flow', page: 6, revision: 'now'});
  assert.deepEqual(evaluate(model, table.props.source), [{name: 'last'}]);
  const pager = results.children.find(n => n.component === 'Stack');
  assert.equal(evaluate(model, pager.props.visible), true);
  assert.equal(evaluate(model, pager.children[0].props.disabled), false);
  assert.equal(evaluate(model, pager.children[2].props.disabled), true);
  assert.deepEqual(evaluate(model, pager.children[0].props.onClick), [
    {type: 'set', path: 'state.resultsFlow', value: 'ai/flow/flow'},
    {type: 'set', path: 'state.resultsPage', value: 5},
  ]);
  model.run.flowId = 'new-flow';
  assert.equal(evaluate(model, query.input).page, 1);
  assert.deepEqual(evaluate({run: {result: [{name: 'legacy'}]}}, table.props.source), [{name: 'legacy'}]);
});

test('series grouping waits visibly and conflicts cannot look ready to confirm', () => {
  const waiting = visibleCells({name:'E016.mkv',status:'group_pending',recognitionStatus:'recognized',detail:{identity:{tmdbId:2661,mediaType:'tv',season:30,episode:16}}});
  assert.match(waiting[2], /等待同剧核对/);
  assert.doesNotMatch(waiting[2], /待确认|TMDB 核对通过/);
  const conflict = visibleCells({name:'E017.mkv',status:'identity_conflict',recognitionStatus:'conflict',error:'2661 / S30；155371 / S1，整组未提交整理',detail:{identity:{tmdbId:155371,mediaType:'tv',season:1,episode:17}}});
  assert.match(conflict[2], /同剧识别冲突，未整理/);
  assert.match(conflict[2], /2661.*155371/);
  assert.doesNotMatch(conflict[2], /待确认|AI 识别完成|TMDB 核对通过/);
});
