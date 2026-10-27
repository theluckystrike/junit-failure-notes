import { browser, expect } from '@wdio/globals';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

// A free user who runs a Pro command gets the shared Pro notice with the "Sponsor on GitHub" button, and no window
// opens. A Pro user who runs the same command gets the window.
type Host = { plugins: { plugins: Record<string, { pro: SponsorsManager; dialogs: Set<{ close(): void }> }> } };

async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, enabled, id) => {
		const pro = (app as unknown as Host).plugins.plugins[id]!.pro;
		if (!enabled) { pro.signOut(); return pro.isPro(); }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
		return pro.isPro();
	}, on, pluginId);
}

/** Runs the command, then reads the notices, the open windows and the vault file count. */
async function run(command: string) {
	await browser.executeObsidian(() => { activeDocument.querySelectorAll('.notice').forEach((n) => n.remove()); });
	await browser.executeObsidianCommand(`${pluginId}:${command}`);
	await browser.pause(500);
	return browser.executeObsidian(({ app }, id) => ({
		notices: [...activeDocument.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', sponsor: n.querySelectorAll('.pf-pro-notice-sponsor').length })),
		windows: (app as unknown as Host).plugins.plugins[id]!.dialogs.size,
		files: app.vault.getFiles().length,
	}), pluginId);
}

describe('Pro commands', function () {
	before(async () => {
		await browser.executeObsidian(async ({ app }) => {
			if (!app.vault.getAbstractFileByPath('pro-notice.xml')) await app.vault.create('pro-notice.xml', '<testsuite><testcase name="bad"><failure/></testcase></testsuite>');
		});
	});
	afterEach(async () => {
		await browser.executeObsidian(({ app }, id) => { for (const d of [...(app as unknown as Host).plugins.plugins[id]!.dialogs]) d.close(); }, pluginId);
		await setPro(false);
	});

	it('a free user who runs Create folder reports, Save local baseline or Compare with local baseline gets a Pro notice with a Sponsor button, and no window opens', async () => {
		expect(await setPro(false)).toBe(false);
		for (const [command, lead] of [['folder-reports', 'Folder reports need Pro.'], ['save-baseline', 'Local baselines need Pro.'], ['compare-baseline', 'Baseline comparison needs Pro.']]) {
			const before = await browser.executeObsidian(({ app }) => app.vault.getFiles().length);
			const after = await run(command!);
			if (!after.notices.some((n) => n.text.includes(lead!) && n.sponsor === 1)) throw new Error(`No Pro notice after ${command}: ${JSON.stringify(after.notices)}`);
			expect(after.windows).toBe(0);
			expect(after.files).toBe(before);
		}
	});

	it('a Pro user who runs Create folder reports gets the window, with no Sponsor notice', async () => {
		expect(await setPro(true)).toBe(true);
		const after = await run('folder-reports');
		expect(after.windows).toBe(1);
		expect(after.notices.filter((n) => n.sponsor > 0)).toEqual([]);
	});
});
