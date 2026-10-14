import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal, parseLinktext } from 'obsidian-test-mocks/obsidian';
import { requestUrl } from 'obsidian';
import JunitFailureNotesPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { parseXml, renderReport } from '../src/report';
import manifest from '../manifest.json';

vi.mock('obsidian', async () => {
	const original = await vi.importActual<typeof import('obsidian-test-mocks/obsidian')>('obsidian');
	return { ...original, requestUrl: vi.fn(original.requestUrl) };
});

afterEach(() => { resetPro(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('Review regressions', () => {
	it('keeps XML carriage return references inside quoted code fences', () => {
		const parsed = parseXml('<testsuite><testcase name="bad"><failure>trace&#13;&#13;![remote](https://example.com/image.png)&#13;end</failure></testcase></testsuite>');
		if (!parsed.ok) throw new Error(parsed.error);
		const md = renderReport(parsed.report, 'result.xml');
		expect(md).not.toContain('\r');
		expect(md).toContain('\n> \n> ![remote](https://example.com/image.png)\n> end');
	});
	it('uses the counted cases for declared count warnings', () => {
		const parsed = parseXml('<testsuite tests="1"><properties><testcase/></properties><testcase/></testsuite>');
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.report.counts.total).toBe(1);
		expect(parsed.report.warnings).toEqual([]);
	});
	it('accepts declaration text in CDATA and comments', () => {
		const parsed = parseXml('<testsuite><!-- <!DOCTYPE sample> --><testcase name="bad"><failure><![CDATA[<!DOCTYPE html> and <!ENTITY example "text">]]></failure></testcase></testsuite>');
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(renderReport(parsed.report, 'result.xml')).toContain('<!DOCTYPE html> and <!ENTITY example "text">');
	});
	it('offers parent folders and the root when XML exists only in child folders', () => {
		vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) { document.body.appendChild(this.containerEl); this.onOpen(); });
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const app = App.createConfigured__({ files: { 'ci/unit/run.xml': '<testsuite/>' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		plugin.choose('folder');
		try {
			const select = document.querySelector('select');
			expect(select).not.toBeNull();
			expect(Array.from(select!.options).map((option) => option.value)).toEqual(['', 'ci', 'ci/unit']);
		} finally { plugin.onunload(); }
	});
	it('does not start an interval if layout becomes ready after unload', async () => {
		const app = App.createConfigured__({ files: {} });
		let ready: (() => unknown) | undefined;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		await plugin.onload();
		plugin.onunload();
		const interval = vi.spyOn(window, 'setInterval').mockReturnValue(1);
		try { ready?.(); expect(interval).not.toHaveBeenCalled(); }
		finally { plugin.pro?.dispose(); }
	});
	it('creates no report if the plugin unloads during a source read', async () => {
		const app = App.createConfigured__({ files: { 'run.xml': '<testsuite/>' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		let finish: ((xml: string) => void) | undefined;
		vi.spyOn(app.vault, 'read').mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
		const task = plugin.createReport('run.xml', false, false);
		await Promise.resolve();
		plugin.onunload();
		finish?.('<testsuite/>');
		await expect(task).rejects.toThrow('not loaded');
		expect(app.vault.getFiles().map((file) => file.path)).toEqual(['run.xml']);
	});
	it('opens the created file when its path contains a hash', async () => {
		const app = App.createConfigured__({ files: { 'ci/run #1.xml': '<testsuite/>', 'ci/run .md': 'Other note' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		// The mock does not parse headings. Use the public link parser, as Obsidian does.
		vi.spyOn(app.workspace, 'openLinkText').mockImplementation(async (linktext, sourcePath, newLeaf) => {
			const file = app.metadataCache.getFirstLinkpathDest(parseLinktext(linktext).path, sourcePath);
			if (file) await app.workspace.getLeaf(newLeaf).openFile(file);
		});
		const file = await plugin.createReport('ci/run #1.xml');
		expect(app.workspace.getActiveFile()?.path).toBe(file.path);
	});
	it('loads and creates a free report without a token or a request', async () => {
		const request = vi.mocked(requestUrl);
		request.mockClear();
		const app = App.createConfigured__({ files: { 'run.xml': '<testsuite/>' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		await plugin.onload();
		try {
			await plugin.pro?.refresh();
			await plugin.createReport('run.xml', false, false);
			expect(request).not.toHaveBeenCalled();
		} finally { plugin.onunload(); plugin.pro?.dispose(); }
	});
	it('reports child folders and continues after a bad source', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const app = App.createConfigured__({ files: { 'ci/unit/a.xml': '<wrong/>', 'ci/unit/b.xml': '<testsuite/>', 'ci-other/c.xml': '<testsuite/>' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		const result = await plugin.folderReports('ci');
		expect(result.created).toEqual(['ci/unit/b JUnit report.md']);
		expect(result.errors).toEqual(['ci/unit/a.xml: The XML root must be testsuite or testsuites.']);
		expect(app.vault.getAbstractFileByPath('ci-other/c JUnit report.md')).toBeNull();
	});
	it('replaces the baseline and keeps it when Pro is reset', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const app = App.createConfigured__({ files: { 'old.xml': '<testsuite><testcase name="old"><failure/></testcase></testsuite>', 'new.xml': '<testsuite><testcase name="new"><error/></testcase></testsuite>' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		await plugin.saveBaseline('old.xml');
		await plugin.saveBaseline('new.xml');
		resetPro();
		expect(plugin.settings.baseline).toEqual({ source: 'new.xml', names: ['["","new"]'] });
		await expect(plugin.createReport('new.xml', true, false)).rejects.toThrow('pro feature');
	});
	it('handles an empty vault without a report or dialog', () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		const open = vi.spyOn(Modal.prototype, 'open');
		plugin.choose('report');
		expect(open).not.toHaveBeenCalled();
		expect(app.vault.getFiles()).toEqual([]);
	});
});
