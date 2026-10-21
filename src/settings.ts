import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type JunitFailureNotesPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface JunitFailureNotesSettings { baseline: { source: string; names: string[] } | null }
export const DEFAULT_SETTINGS: JunitFailureNotesSettings = { baseline: null };
export function normalizeSettings(saved: unknown): JunitFailureNotesSettings {
	if (!saved || typeof saved !== 'object' || !('baseline' in saved)) return { baseline: null };
	const b = saved.baseline;
	if (!b || typeof b !== 'object' || !('source' in b) || typeof b.source !== 'string' || !('names' in b) || !Array.isArray(b.names)) return { baseline: null };
	return { baseline: { source: b.source, names: b.names.filter((name): name is string => typeof name === 'string').slice(0, 5000) } };
}
export class JunitFailureNotesSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], private owner: JunitFailureNotesPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Local report limits', desc: '2 MiB, 5,000 cases and 20,000 characters per log. Reports go beside the XML source.' },
			{ name: 'Saved baseline (Pro)', desc: this.owner.settings.baseline ? `${this.owner.settings.baseline.names.length} failed or errored names from ${this.owner.settings.baseline.source}.` : 'No local baseline saved. Use the Save local baseline command.' },
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
		];
	}
}
