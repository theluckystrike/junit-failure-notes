import { Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { JunitFailureNotesSettingTab, normalizeSettings, type JunitFailureNotesSettings } from './settings';
import { MAX_BYTES, failedNames, nextReportPath, parseXml, renderReport, type Report } from './report';

export default class JunitFailureNotesPlugin extends Plugin {
	settings: JunitFailureNotesSettings = normalizeSettings(null);
	pro: SponsorsManager | null = null;
	private pending: Promise<unknown> = Promise.resolve();
	private dialogs = new Set<Modal>();
	private settingTab: JunitFailureNotesSettingTab | null = null;
	private stopped = false;

	async onload(): Promise<void> {
		this.stopped = false;
		await this.loadSettings();
		if (this.stopped) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new JunitFailureNotesSettingTab(this.app, this);
		this.settingTab = tab;
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.addCommand({ id: 'create-report', name: 'Create report from XML', callback: () => this.choose('report') });
		this.addCommand({ id: 'folder-reports', name: 'Create folder reports (pro)', callback: () => this.choose('folder') });
		this.addCommand({ id: 'save-baseline', name: 'Save local baseline (pro)', callback: () => this.choose('baseline') });
		this.addCommand({ id: 'compare-baseline', name: 'Compare with local baseline (pro)', callback: () => this.choose('compare') });
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		this.stopped = true;
		for (const modal of this.dialogs) modal.close();
		this.dialogs.clear();
		resetPro();
	}
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as unknown); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	private requireLoaded(): void {
		if (this.stopped) throw new Error('The plugin is not loaded.');
	}
	private requirePro(): void {
		if (!isPro()) throw new Error('This is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.');
	}
	async readReport(path: string): Promise<Report> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'xml') throw new Error('Select an XML file in the vault.');
		if (file.stat.size > MAX_BYTES) throw new Error('The XML file exceeds 2 MiB.');
		const parsed = parseXml(await this.app.vault.read(file));
		if (!parsed.ok) throw new Error(parsed.error);
		return parsed.report;
	}
	/** Serialize new reports so two commands do not select the same output path. */
	createReport(path: string, compare = false, open = true): Promise<TFile> {
		const action = async () => {
			this.requireLoaded();
			if (compare) this.requirePro();
			if (compare && !this.settings.baseline) throw new Error('Save a local baseline first.');
			const source = normalizePath(path);
			const report = await this.readReport(source);
			this.requireLoaded();
			if (compare) this.requirePro();
			const target = normalizePath(nextReportPath(source, (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null));
			const file = await this.app.vault.create(target, renderReport(report, source, compare ? this.settings.baseline ?? undefined : undefined));
			if (open && !this.stopped) await this.app.workspace.getLeaf(false).openFile(file);
			return file;
		};
		const task = this.pending.then(action);
		this.pending = task.catch(() => undefined);
		return task;
	}
	async saveBaseline(path: string): Promise<void> {
		this.requireLoaded();
		this.requirePro();
		const report = await this.readReport(path);
		this.requireLoaded();
		this.requirePro();
		this.settings.baseline = { source: normalizePath(path), names: failedNames(report) };
		await this.saveSettings();
		this.settingTab?.update();
	}
	async folderReports(path: string): Promise<{ created: string[]; errors: string[] }> {
		this.requireLoaded();
		this.requirePro();
		const folder = normalizePath(path);
		const item = this.app.vault.getAbstractFileByPath(folder || '/');
		if (!(item instanceof TFolder)) throw new Error('Select a folder in the vault.');
		const files = this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'xml' && (!folder || f.path.startsWith(folder + '/'))).sort((a, b) => a.path.localeCompare(b.path));
		const result: { created: string[]; errors: string[] } = { created: [], errors: [] };
		for (const file of files) {
			this.requireLoaded();
			this.requirePro();
			try { result.created.push((await this.createReport(file.path, false, false)).path); }
			catch (error) { result.errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
		}
		return result;
	}
	choose(mode: 'report' | 'folder' | 'baseline' | 'compare'): void {
		try {
			this.requireLoaded();
			if (mode !== 'report') this.requirePro();
			const files = this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'xml');
			if (!files.length) throw new Error('No XML files found in the vault.');
			const folders = new Set<string>(['']);
			if (mode === 'folder') for (const file of files) {
				let parent = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')));
				while (parent) {
					folders.add(parent);
					parent = parent.slice(0, Math.max(0, parent.lastIndexOf('/')));
				}
			}
			const paths = mode === 'folder' ? [...folders] : files.map((f) => f.path);
			paths.sort();
			const modal = new XmlSelectionModal(this, paths, mode, () => this.dialogs.delete(modal));
			this.dialogs.add(modal);
			modal.open();
		} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
	}
}
class XmlSelectionModal extends Modal {
	constructor(private plugin: JunitFailureNotesPlugin, private paths: string[], private mode: 'report' | 'folder' | 'baseline' | 'compare', private closed: () => void) { super(plugin.app); }
	onOpen(): void {
		this.titleEl.setText(this.mode === 'folder' ? 'Create folder reports (Pro)' : this.mode === 'baseline' ? 'Save local baseline (Pro)' : this.mode === 'compare' ? 'Compare with local baseline (Pro)' : 'Create JUnit report');
		this.contentEl.createEl('p', { text: 'Choose local XML. Limit: 2 MiB and 5,000 cases per file. The source stays unchanged.', cls: 'junit-help' });
		let selected = this.paths[0] ?? '';
		new Setting(this.contentEl).setName(this.mode === 'folder' ? 'Source folder' : 'Source XML').addDropdown((dropdown) => {
			for (const path of this.paths) dropdown.addOption(path, path || '(vault root)');
			dropdown.setValue(selected).onChange((value) => { selected = value; });
		});
		const status = this.contentEl.createEl('p', { cls: 'junit-status' });
		new Setting(this.contentEl).addButton((button) => button.setButtonText(this.mode === 'baseline' ? 'Save baseline' : 'Create report').setCta().onClick(async () => {
			button.setDisabled(true);
			try {
				if (this.mode === 'baseline') { await this.plugin.saveBaseline(selected); new Notice('Local baseline saved.'); }
				else if (this.mode === 'folder') {
					const result = await this.plugin.folderReports(selected);
					status.setText(`Created ${result.created.length} reports. ${result.errors.length} errors.\n${result.errors.join('\n')}`);
					button.setDisabled(false);
					return;
				} else await this.plugin.createReport(selected, this.mode === 'compare');
				this.close();
			} catch (error) { status.setText(error instanceof Error ? error.message : String(error)); button.setDisabled(false); }
		}));
	}
	onClose(): void { this.contentEl.empty(); this.closed(); }
}
