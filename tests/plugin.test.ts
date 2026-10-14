import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import JunitFailureNotesPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('JunitFailureNotesPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new JunitFailureNotesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ prefix: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
});
