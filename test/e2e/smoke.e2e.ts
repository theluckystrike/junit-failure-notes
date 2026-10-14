import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} in Obsidian`, function () {
	it('reloads without errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
	it('creates a literal report and keeps the source and prior note', async function () {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { createReport(path: string, compare?: boolean, open?: boolean): Promise<{path: string}> }> } }).plugins.plugins[id]!;
			const xml = '<testsuites tests="99"><testsuite><testcase name="ok"/><testcase name="bad"><failure message="Mismatch"><![CDATA[<img src="https://example.com/image.png">\n```\n![image](https://example.com/image.png)\n<&>]]></failure><system-out>case output</system-out><system-err>case error</system-err></testcase><testsuite><testcase name="broken"><error>stack</error></testcase><testcase name="later"><skipped message="No DB"/></testcase></testsuite></testsuite></testsuites>';
			await app.vault.createFolder('ci reports');
			const source = await app.vault.create('ci reports/browser-result.xml', xml);
			const prior = await app.vault.create('ci reports/browser-result JUnit report.md', 'Keep prior report');
			const file = await p.createReport(source.path, false, false);
			const output = await app.vault.read(app.vault.getFileByPath(file.path)!);
			await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' } });
			return { path: file.path, output, source: await app.vault.read(source), prior: await app.vault.read(prior), xml };
		}, pluginId);
		expect(result.path).toBe('ci reports/browser-result JUnit report 2.md');
		for (const row of ['Total | 4', 'Passed | 1', 'Failed | 1', 'Errored | 1', 'Skipped | 1']) expect(result.output).toContain(row);
		expect(result.output).toContain('Declared count differs'); expect(result.output).toContain('> ````text'); expect(result.output).toContain('> <&>');
		expect(result.source).toBe(result.xml); expect(result.prior).toBe('Keep prior report');
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view .callout[data-callout="failure"]').length === 2), { timeout: 10000 });
		expect(await browser.execute(() => {
			const view = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view')!;
			return { images: view.querySelectorAll('img').length, folded: view.querySelectorAll('.callout[data-callout="failure"].is-collapsed').length };
		})).toEqual({ images: 0, folded: 2 });
		const target = await browser.executeObsidian(({ app }) => {
			const link = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view a.internal-link');
			const href = decodeURIComponent(link?.getAttribute('data-href') ?? '');
			return app.metadataCache.getFirstLinkpathDest(href, 'ci reports/browser-result JUnit report 2.md')?.path ?? null;
		});
		expect(target).toBe('ci reports/browser-result.xml');
	});
	it('rejects invalid sources without success notes and enforces limits', async function () {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { createReport(path: string, compare?: boolean, open?: boolean): Promise<{path:string}> }> } }).plugins.plugins[id]!;
			const errors: string[] = [];
			const inputs = ['<testsuite>', '<wrong/>', '<testsuite xmlns="urn:junit"/>', '<!DOCTYPE testsuite SYSTEM "https://example.com/external"><testsuite/>', '<!ENTITY x "value"><testsuite/>', '<testsuite>' + 'x'.repeat(2097152) + '</testsuite>', '<testsuite>' + '<testcase/>'.repeat(5001) + '</testsuite>'];
			for (let i = 0; i < inputs.length; i++) {
				await app.vault.create(`invalid-${i}.xml`, inputs[i]!);
				try { await p.createReport(`invalid-${i}.xml`, false, false); errors.push('Unexpected success'); } catch (e) { errors.push((e as Error).message); }
			}
			await app.vault.create('long-log.xml', '<testsuite><testcase><failure>' + 'x'.repeat(20001) + '</failure></testcase></testsuite>');
			const file = await p.createReport('long-log.xml', false, false);
			return { errors, reports: app.vault.getFiles().filter((f) => f.path.startsWith('invalid-') && f.extension === 'md').length, output: await app.vault.read(app.vault.getFileByPath(file.path)!) };
		}, pluginId);
		expect(result.errors).toEqual(['The XML is malformed.', 'The XML root must be testsuite or testsuites.', 'XML namespaces are not supported in this version.', 'DOCTYPE and ENTITY declarations are not supported.', 'DOCTYPE and ENTITY declarations are not supported.', 'The XML file exceeds 2 MiB.', 'The XML file exceeds 5,000 test cases.']);
		expect(result.reports).toBe(0); expect(result.output).toContain('[Log truncated at 20,000 characters]');
	});
	it('gates Pro and compares a baseline with a mocked sponsorship', async function () {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			interface P { pro: { signOut(): void; refreshNow(): Promise<unknown>; opts: {http: unknown} }; saveBaseline(path: string): Promise<void>; folderReports(path: string): Promise<{created:string[];errors:string[]}>; createReport(path: string, compare?: boolean, open?: boolean): Promise<{path:string}> }
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			p.pro.signOut(); let blocked = false;
			try { await p.saveBaseline('ci reports/browser-result.xml'); } catch { blocked = true; }
			p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret(id + '-github-token', 'gho_' + '0'.repeat(36)); await p.pro.refreshNow();
			await p.saveBaseline('ci reports/browser-result.xml'); await app.vault.createFolder('batch');
			await app.vault.create('batch/fresh.xml', '<testsuite><testcase name="new"><failure/></testcase></testsuite>'); await app.vault.create('batch/bad.xml', '<wrong/>');
			const file = await p.createReport('batch/fresh.xml', true, false);
			const diff = await app.vault.read(app.vault.getFileByPath(file.path)!); const batch = await p.folderReports('batch'); p.pro.signOut(); return { blocked, diff, batch };
		}, pluginId);
		expect(result.blocked).toBe(true); expect(result.diff).toContain('### Added: 1'); expect(result.diff).toContain('### Resolved: 2');
		expect(result.batch.created).toHaveLength(1); expect(result.batch.errors).toHaveLength(1);
	});
	it('opens the chooser through the core command', async function () {
		await browser.executeObsidianCommand(`${pluginId}:create-report`);
		const dialog = browser.$('.modal'); await dialog.waitForDisplayed(); expect(await dialog.$('.modal-title').getText()).toBe('Create JUnit report');
		await dialog.$('select').selectByAttribute('value', 'ci reports/browser-result.xml'); await dialog.$('button.mod-cta').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !!app.vault.getAbstractFileByPath('ci reports/browser-result JUnit report 3.md')), { timeout: 10000 });
		await dialog.waitForDisplayed({ reverse: true });
	});
	it('keeps carriage return references literal in a rendered callout', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { createReport(path: string, compare?: boolean, open?: boolean): Promise<{path: string}> }> } }).plugins.plugins[id]!;
			await app.vault.create('carriage-return.xml', '<testsuite><testcase name="bad"><failure>trace&#13;&#13;![literal](sample.png)&#13;end</failure></testcase></testsuite>');
			const file = await p.createReport('carriage-return.xml', false, false);
			await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' } });
		}, pluginId);
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view .callout[data-callout="failure"]').length === 1), { timeout: 10000 });
		expect(await browser.execute(() => {
			const view = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view')!;
			return { images: view.querySelectorAll('img').length, literal: view.querySelector('code')?.textContent?.includes('![literal](sample.png)') };
		})).toEqual({ images: 0, literal: true });
	});
	it('opens the exact report file when its name contains a hash', async function () {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { createReport(path: string): Promise<{path: string}> }> } }).plugins.plugins[id]!;
			await app.vault.create('hash#run.xml', '<testsuite/>');
			await app.vault.create('hash.md', 'Other note');
			const file = await p.createReport('hash#run.xml');
			return { expected: file.path, active: app.workspace.getActiveFile()?.path };
		}, pluginId);
		expect(result.active).toBe(result.expected);
	});
});
