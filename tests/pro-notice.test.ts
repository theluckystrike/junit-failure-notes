import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import JunitFailureNotesPlugin from '../src/main';
import { PRO_LEADS, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user who runs a Pro command gets the shared Pro notice with the "Sponsor on GitHub" button.
// No window opens and nothing is written or saved.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'junit-failure-notes' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'ci/run.xml': '<testsuite><testcase name="bad"><failure/></testcase></testsuite>' } });
	const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const opened = vi.spyOn(Modal.prototype, 'open').mockImplementation(() => undefined);
	const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue(undefined);
	return { app, plugin, shown, opened, saveData };
}
const MODES = ['folder', 'baseline', 'compare'] as const;

describe('Pro commands', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who runs a Pro command gets the Pro notice with a Sponsor button, and no window opens', () => {
		const { app, plugin, shown, opened, saveData } = setup(false);
		const files = app.vault.getFiles().length;
		for (const mode of MODES) plugin.choose(mode);
		expect(shown).toEqual(MODES.map((mode) => ({ text: `${PRO_LEADS[mode]} ${PITCH}Sponsor on GitHub`, buttons: 1 })));
		expect(opened).not.toHaveBeenCalled();
		expect(saveData).not.toHaveBeenCalled();
		expect(app.vault.getFiles().length).toBe(files);
		// The free command still opens its window.
		plugin.choose('report');
		expect(opened).toHaveBeenCalledOnce();
		plugin.onunload();
	});

	it('a Pro user who runs a Pro command gets the window, with no Pro notice', () => {
		const { plugin, shown, opened } = setup(true);
		for (const mode of MODES) plugin.choose(mode);
		expect(opened).toHaveBeenCalledTimes(3);
		expect(shown).toEqual([]);
		plugin.onunload();
	});
});
