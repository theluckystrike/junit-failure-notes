import { describe, expect, it, vi, afterEach } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import JunitFailureNotesPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';
const xml = '<testsuite><testcase name="ok"/><testcase name="bad"><failure message="Expected 2">got 1</failure></testcase></testsuite>';
function setup() {
	const app = App.createConfigured__({ files: { 'ci/result.xml': xml, 'ci/result JUnit report.md': 'Keep prior report', 'ci/next.XML': '<testsuite/>', 'ci/bad.xml': '<notjunit/>', 'other/test.xml': '<testsuite/>', 'ci/readme.md': 'Keep note' } });
	const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
	return { app, plugin };
}
function enablePro() { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }
afterEach(resetPro);
describe('Vault reports', () => {
	it('loads defaults and repairs saved baseline data', async () => {
		const { plugin } = setup(); await plugin.loadSettings(); expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ baseline: 5 })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ baseline: { source: 'a.xml', names: [3, 'x'] } })).toEqual({ baseline: { source: 'a.xml', names: ['x'] } });
	});
	it('creates numbered reports with no network and keeps input unchanged', async () => {
		const { app, plugin } = setup();
		const prior = app.vault.getAbstractFileByPath('ci/result JUnit report.md');
		const source = app.vault.getAbstractFileByPath('ci/result.xml');
		const file = await plugin.createReport('ci/result.xml', false, false);
		expect(file.path).toBe('ci/result JUnit report 2.md');
		expect(await app.vault.read(file)).toContain('| Failed | 1 |');
		expect(await app.vault.read(source as never)).toBe(xml);
		expect(await app.vault.read(prior as never)).toBe('Keep prior report');
	});
	it('serializes concurrent requests', async () => {
		const { plugin } = setup();
		const files = await Promise.all([plugin.createReport('ci/result.xml', false, false), plugin.createReport('ci/result.xml', false, false)]);
		expect(files.map((f) => f.path)).toEqual(['ci/result JUnit report 2.md', 'ci/result JUnit report 3.md']);
	});
	it('creates no report for invalid XML', async () => {
		const { app, plugin } = setup(); const before = app.vault.getFiles().length;
		await expect(plugin.createReport('ci/bad.xml', false, false)).rejects.toThrow('root');
		expect(app.vault.getFiles()).toHaveLength(before);
	});
	it('opens the new report through the workspace', async () => {
		const { app, plugin } = setup();
		const file = await plugin.createReport('ci/result.xml');
		expect(app.workspace.getActiveFile()?.path).toBe(file.path);
	});
	it('blocks Pro actions while core report works', async () => {
		const { plugin } = setup(); await expect(plugin.saveBaseline('ci/result.xml')).rejects.toThrow('pro feature');
		await expect(plugin.folderReports('ci')).rejects.toThrow('pro feature');
		await expect(plugin.createReport('ci/result.xml', true, false)).rejects.toThrow('pro feature');
		await expect(plugin.createReport('ci/result.xml', false, false)).resolves.toBeTruthy();
	});
	it('saves a baseline and reports resolved failures', async () => {
		enablePro(); const { app, plugin } = setup(); await plugin.saveBaseline('ci/result.xml');
		const file = await plugin.createReport('ci/next.XML', true, false); const md = await app.vault.read(file);
		expect(md).toContain('### Resolved: 1'); expect(md).toContain('["","bad"]');
	});
	it('requires a baseline before comparison', async () => { enablePro(); const { plugin } = setup(); await expect(plugin.createReport('ci/result.xml', true, false)).rejects.toThrow('baseline first'); });
	it('batch creates valid XML reports and lists invalid files', async () => {
		enablePro(); const { app, plugin } = setup(); const result = await plugin.folderReports('ci');
		expect(result.created).toHaveLength(2); expect(result.errors).toHaveLength(1);
		expect(app.vault.getAbstractFileByPath('other/test JUnit report.md')).toBeNull();
	});
});
