export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_CASES = 5000;
export const MAX_LOG = 20000;

export interface TestCase {
	name: string;
	classname: string;
	status: 'passed' | 'failed' | 'errored' | 'skipped';
	details: string[];
}
export interface Report {
	counts: { total: number; passed: number; failed: number; errored: number; skipped: number };
	cases: TestCase[];
	warnings: string[];
}
export type ParseResult = { ok: true; report: Report } | { ok: false; error: string };

export function checkLimits(bytes: number, cases: number): string | null {
	if (bytes > MAX_BYTES) return 'The XML file exceeds 2 MiB.';
	if (cases > MAX_CASES) return 'The XML file exceeds 5,000 test cases.';
	return null;
}

export function shorten(text: string): string {
	return text.length > MAX_LOG ? text.slice(0, MAX_LOG) + '\n[Log truncated at 20,000 characters]' : text;
}

/** The text stays literal in Markdown, including a supplied fence or image. */
export function fence(text: string): string {
	text = text.replace(/\r\n?/g, '\n');
	const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
	const marker = '`'.repeat(Math.max(3, longest + 1));
	return `${marker}text\n${text}\n${marker}`;
}

export function parseXml(xml: string): ParseResult {
	const sizeError = checkLimits(new TextEncoder().encode(xml).byteLength, 0);
	if (sizeError) return { ok: false, error: sizeError };
	const markup = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, ' ');
	if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(markup)) return { ok: false, error: 'DOCTYPE and ENTITY declarations are not supported.' };
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	if (document.getElementsByTagName('parsererror').length || !document.documentElement) return { ok: false, error: 'The XML is malformed.' };
	const root = document.documentElement;
	if (root.namespaceURI || Array.from(document.getElementsByTagName('*')).some((el) => el.namespaceURI || el.prefix || Array.from(el.attributes).some((a) => a.name === 'xmlns' || a.name.startsWith('xmlns:')))) {
		return { ok: false, error: 'XML namespaces are not supported in this version.' };
	}
	if (!['testsuite', 'testsuites'].includes(root.tagName)) return { ok: false, error: 'The XML root must be testsuite or testsuites.' };
	// Walk only suite children. A testcase inside a log or property is not a test.
	const suites: Element[] = [];
	const elements: Element[] = [];
	const pending: Element[] = [root];
	while (pending.length) {
		const suite = pending.pop();
		if (!suite) break;
		suites.push(suite);
		for (const child of Array.from(suite.children)) {
			if (child.tagName === 'testcase') elements.push(child);
			else if (child.tagName === 'testsuite' || child.tagName === 'testsuites') pending.push(child);
		}
	}
	const caseError = checkLimits(0, document.getElementsByTagName('testcase').length);
	if (caseError) return { ok: false, error: caseError };
	const report: Report = { counts: { total: elements.length, passed: 0, failed: 0, errored: 0, skipped: 0 }, cases: [], warnings: [] };
	const suiteCounts = new Map<Element, number>();
	for (const suite of [...suites].reverse()) {
		let actual = 0;
		for (const child of Array.from(suite.children)) {
			if (child.tagName === 'testcase') actual++;
			else actual += suiteCounts.get(child) ?? 0;
		}
		suiteCounts.set(suite, actual);
	}
	for (const suite of suites) {
		const declared = suite.getAttribute('tests');
		const actual = suiteCounts.get(suite) ?? 0;
		if (declared !== null && Number(declared) !== actual) report.warnings.push(`Declared count differs: suite ${suite.getAttribute('name') ?? '(unnamed)'} declares ${declared}; actual ${actual}.`);
	}
	for (const el of elements) {
		const children = Array.from(el.children);
		const has = (tag: string) => children.some((child) => child.tagName === tag);
		const status = has('error') ? 'errored' : has('failure') ? 'failed' : has('skipped') ? 'skipped' : 'passed';
		report.counts[status]++;
		report.cases.push({
			name: el.getAttribute('name') ?? '(unnamed test)',
			classname: el.getAttribute('classname') ?? '',
			status,
			details: children.filter((child) => ['failure', 'error', 'skipped', 'system-out', 'system-err'].includes(child.tagName)).map((child) => {
				const message = child.getAttribute('message');
				return `${child.tagName}${message ? '\nMessage: ' + shorten(message) : ''}\n${shorten(child.textContent ?? '')}`;
			}),
		});
	}
	return { ok: true, report };
}

export function failedNames(report: Report): string[] {
	return [...new Set(report.cases.filter((c) => c.status === 'failed' || c.status === 'errored').map((c) => JSON.stringify([c.classname, c.name])))].sort();
}

export function compareNames(current: string[], baseline: string[]): { added: string[]; resolved: string[]; retained: string[] } {
	return {
		added: current.filter((name) => !baseline.includes(name)),
		resolved: baseline.filter((name) => !current.includes(name)),
		retained: current.filter((name) => baseline.includes(name)),
	};
}

/** File names are encoded in a Markdown link so punctuation cannot add an embed. */
export function sourceLink(path: string): string {
	return `[Source XML](<${path.split('/').map((part) => encodeURIComponent(part)).join('/')}>)`;
}

export function nextReportPath(source: string, exists: (path: string) => boolean): string {
	const stem = source.replace(/\.xml$/i, '') + ' JUnit report';
	let path = stem + '.md';
	let n = 2;
	while (exists(path)) path = `${stem} ${n++}.md`;
	return path;
}

/** A portable path check for a saved list of occupied vault paths. */
export function numberedReportPath(source: string, occupied: string[]): string {
	return nextReportPath(source, (path) => occupied.includes(path));
}

export function renderReport(report: Report, source: string, baseline?: { source: string; names: string[] }): string {
	const c = report.counts;
	const lines = ['# JUnit test report', '', sourceLink(source), '', '| Result | Cases |', '| --- | ---: |', ...(['total', 'passed', 'failed', 'errored', 'skipped'] as const).map((key) => `| ${key[0]?.toUpperCase()}${key.slice(1)} | ${c[key]} |`), ''];
	for (const warning of report.warnings) lines.push('> [!warning] Declared count differs', ...fence(warning).split('\n').map((line) => '> ' + line), '');
	if (baseline) {
		const diff = compareNames(failedNames(report), baseline.names);
		lines.push('## Baseline comparison (Pro)', '', 'Baseline: ' + sourceLink(baseline.source), '');
		for (const key of ['added', 'resolved', 'retained'] as const) lines.push(`### ${key[0]?.toUpperCase()}${key.slice(1)}: ${diff[key].length}`, '', fence(diff[key].join('\n') || '(none)'), '');
	}
	lines.push('## Failed and errored cases', '');
	const failed = report.cases.filter((test) => test.status === 'failed' || test.status === 'errored');
	if (!failed.length) lines.push('No failed or errored cases.', '');
	failed.forEach((test, i) => {
		const text = `Test: ${test.name}\nClass: ${test.classname || '(not given)'}\nStatus: ${test.status}\n\n${test.details.join('\n\n')}`;
		lines.push(`> [!failure]- ${test.status === 'errored' ? 'Error' : 'Failure'} ${i + 1}`, ...fence(text).split('\n').map((line) => '> ' + line), '');
	});
	lines.push('Suite logs, timings and properties are not included.', '');
	return lines.join('\n');
}
