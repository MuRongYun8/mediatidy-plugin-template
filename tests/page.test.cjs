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
const page = validatePage(JSON.parse(generated.stdout), ['recognize'], ['history', 'detail']);
const results = page.content[0].children.find(n => n.props?.title === '识别结果');
const table = results.children.find(n => n.component === 'Table');
const draftSection = results.children.find(n => n.component === 'Section');
const draftTable = draftSection.children.find(n => n.component === 'Table');

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
  assert.equal(evaluate(model, table.props.visible), false);
  assert.equal(evaluate(model, results.children.find(n => n.component === 'Details').props.visible), true);
});

test('partial draft preparation keeps unmatched AI results visible', () => {
  const model = { run: { drafts: [{ id: 'one' }], result: [{ name: 'one' }, { name: 'two', status: 'needs_review' }] } };
  assert.equal(evaluate(model, draftSection.props.visible), true);
  assert.equal(evaluate(model, table.props.visible), true);
  assert.equal(evaluate(model, results.children.find(n => n.component === 'Details').props.visible), false);
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
  assert.match(cells[2], /识别完成，待整理/);
});
