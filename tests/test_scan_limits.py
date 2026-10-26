"""Large workflows use bounded AI requests and the real SDK per-run quotas."""
import json
import unittest
from collections import Counter
from copy import deepcopy
from pathlib import Path
from mt_plugin import SDKError
from plugin import Plugin, MAX_FILES
from test_workflow import Host, file
from test_workflow import identity, searched

class DirectoryHost(Host):
    def __init__(self, counts, old_host=False):
        super().__init__()
        self.directories = {str(i): [file(f'{i}-{n}') for n in range(count)] for i, count in enumerate(counts)}
        self.old_host = old_host
        self.counts = Counter()
        contract = json.loads((Path(__file__).resolve().parents[2] / 'plugin-sdk/mt_plugin/methods.json').read_text('utf-8'))
        self.limits = {m['name']: m['limit'] for m in contract['methods']}

    def call(self, invocation, method, args):
        self.counts[invocation, method] += 1
        assert self.counts[invocation, method] <= self.limits[method], f'{method} quota exceeded'
        if method in ('storage.set', 'runtime.result'):
            assert len(json.dumps(args['value']).encode()) <= 256 * 1024
        if method == 'tasks.wait':
            assert len(args['refs']) <= MAX_FILES
        if method == 'runtime.info' and self.old_host:
            return {'limits': {'maxFileBatch': 100}}
        if method == 'files.scan':
            self.calls.append((method, deepcopy(args)))
            assert args['limit'] == MAX_FILES
            return {'ref': args['path'], 'status': 'queued'}
        if method == 'tasks.items':
            self.calls.append((method, deepcopy(args)))
            items = self.directories[args['ref']]
            start, end = args['offset'], args['offset'] + args['limit']
            return {'items': [{'file': item} for item in items[start:end]], 'nextOffset': end if end < len(items) else 0}
        return super().call(invocation, method, args)

class ScanLimitTests(unittest.TestCase):
    def start(self, host, review=True):
        plugin = Plugin()
        plugin.recognize({'profileId': 7, 'review': review}, host.context(files=[file(ref, directory=True) for ref in host.directories]))
        event = {'parentRunId': 'run-start', 'tasks': [{'ref': ref, 'status': 'done'} for ref in host.directories]}
        return plugin, host.context(run='scan-complete', event=event)

    def all_rows(self, plugin, host):
        ctx = host.context(run='query-results')
        first = plugin.results({'flowKey': 'ai/flow/flow'}, ctx)
        return first['items'] + [row for page in range(2, first['pages']+1)
            for row in plugin.results({'flowKey': 'ai/flow/flow', 'page': page}, ctx)['items']]

    def test_reported_106_files_use_14_requests_and_prepare_all(self):
        host = DirectoryHost([12, 46, 1, 47])
        plugin, ctx = self.start(host)
        self.assertEqual(len(plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)), 20)
        rows = self.all_rows(plugin, host)
        self.assertEqual(len(rows), 106)
        self.assertEqual(len({r['fileRef'] for r in rows}), 106)
        self.assertTrue(all(row['status'] == 'ready' for row in rows))
        self.assertEqual(len(host.prepared), 106)
        chats = [args for method, args in host.calls if method == 'ai.chat']
        self.assertEqual([len(c['fileRefs']) for c in chats], [8]*13 + [2])
        self.assertEqual(len({ref for c in chats for ref in c['fileRefs']}), 106)
        progress = next(args['message'] for method, args in reversed(host.calls) if method == 'runtime.progress')
        self.assertIn('第 14/14 批', progress)

    def test_100_files_use_13_batches_and_duplicate_refs_are_ignored(self):
        host = DirectoryHost([60, 40])
        host.directories['1'] += [host.directories['0'][0], host.directories['1'][0]]
        plugin, ctx = self.start(host)
        plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(len(self.all_rows(plugin, host)), 100)
        self.assertEqual(sum(method == 'ai.chat' for method, _ in host.calls), 13)

    def test_500_files_submit_once_wait_and_write_back_every_task(self):
        host = DirectoryHost([500])
        plugin, ctx = self.start(host, review=False)
        plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(len(host.submissions), 500)
        self.assertEqual(len(host.waits[-1]['refs']), 500)
        self.assertEqual(sum(method == 'ai.chat' for method, _ in host.calls), 63)
        event = {'parentRunId': 'scan-complete', 'tasks': [{'ref': ref, 'status': 'done'} for ref in host.waits[-1]['refs']]}
        plugin.organize_complete({'flowKey': 'ai/flow/flow'}, host.context(run='organize-complete', event=event))
        rows = self.all_rows(plugin, host)
        self.assertEqual(len(rows), 500)
        self.assertTrue(all(row['status'] == 'done' for row in rows))
        plugin.recognize({'profileId': 7}, host.context())
        self.assertEqual(len(host.submissions), 500)
        answers = plugin.responses({'flowKey': 'ai/flow/flow', 'page': 7}, host.context(run='query-answers'))
        self.assertEqual([a['batch'] for a in answers['items']], [61, 62, 63])
        self.assertEqual(answers['total'], 63)

    def test_501_files_fail_before_ai_with_consistent_rows(self):
        host = DirectoryHost([500, 1])
        plugin, ctx = self.start(host)
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(caught.exception.code, 'FILE_LIMIT_EXCEEDED')
        self.assertIn('501', str(caught.exception))
        self.assertIn('分批选择', str(caught.exception))
        flow = host.values['ai/flow/flow']
        rows = [v for k, v in host.values.items() if k.startswith('ai/flow/flow/')]
        self.assertEqual(len(rows), len(flow['refs']))
        self.assertTrue(all(row['status'] == 'failed' for row in rows))
        self.assertEqual(plugin.retry_state({'flowKey': 'ai/flow/flow'}, ctx)['count'], 0)
        self.assertFalse(any(method == 'ai.chat' for method, _ in host.calls))

    def test_old_host_requires_update_before_ai(self):
        host = DirectoryHost([106], old_host=True)
        plugin, ctx = self.start(host)
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(caught.exception.code, 'HOST_UPDATE_REQUIRED')
        self.assertIn('更新主程序', str(caught.exception))
        self.assertFalse(any(method == 'ai.chat' for method, _ in host.calls))
        self.assertFalse(host.prepared or host.submissions)

    def test_retry_after_later_batch_failure_excludes_submitted_files(self):
        host = DirectoryHost([106])
        host.chat_results = [searched({'message': {'content': json.dumps({'items': [identity(f'0-{i}') for i in range(8)]})}}),
                             SDKError('synthetic timeout', 'AI_TIMEOUT', True)]
        plugin, ctx = self.start(host, review=False)
        plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(len(host.submissions), 8)
        event = {'parentRunId': 'scan-complete', 'tasks': [{'ref': ref, 'status': 'done'} for ref in host.waits[-1]['refs']]}
        plugin.organize_complete({'flowKey': 'ai/flow/flow'}, host.context(run='finished', event=event))
        self.assertEqual(plugin.retry_state({'flowKey': 'ai/flow/flow'}, host.context(run='retry-query'))['count'], 98)
        plugin.retry_recognition({'flowKey': 'ai/flow/flow'}, host.context(run='retry', flow='retry'))
        self.assertEqual(len(host.submissions), 106)
        self.assertEqual(len({row['fileRef'] for row in host.submissions}), 106)

    def test_legacy_answers_and_result_pages_remain_readable(self):
        host = Host()
        plugin = Plugin()
        host.values['ai/flow/old'] = {'key': 'ai/flow/old', 'responses': [{'batch': i} for i in range(1, 14)]}
        answer = plugin.responses({'flowKey': 'ai/flow/old', 'page': 99}, host.context())
        self.assertEqual(answer['page'], 2)
        self.assertEqual([row['batch'] for row in answer['items']], [11, 12, 13])
        self.assertFalse(plugin.results({'flowKey': 'ai/flow/old'}, host.context())['available'])
        self.assertFalse(plugin.results({'flowKey': 'ai/flow/missing'}, host.context())['available'])

    def test_failed_scan_task_surfaces_error_before_reading_items(self):
        host = DirectoryHost([47, 12])
        plugin, ctx = self.start(host)
        ctx.event['tasks'][-1]['status'] = 'failed'
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(caught.exception.code, 'SCAN_FAILED')
        self.assertFalse(any(method in ('tasks.items', 'ai.chat') for method, _ in host.calls))

    def test_single_directory_host_limit_requests_split_selection(self):
        host = DirectoryHost([500])
        plugin, ctx = self.start(host)
        ctx.event['tasks'][0].update(status='failed', completed=500, error={'code': 'QUOTA_EXCEEDED', 'message': '扫描达到文件上限，已有结果已保留'})
        with self.assertRaises(SDKError) as caught:
            plugin.scan_complete({'flowKey': 'ai/flow/flow'}, ctx)
        self.assertEqual(caught.exception.code, 'FILE_LIMIT_EXCEEDED')
        self.assertIn('至少 501', str(caught.exception))
        self.assertFalse(any(method in ('tasks.items', 'ai.chat') for method, _ in host.calls))
