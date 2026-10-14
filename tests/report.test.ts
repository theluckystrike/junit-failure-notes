import { describe, expect, it } from 'vitest';
import { parseXml, renderReport, shorten, fence, checkLimits, compareNames, nextReportPath, failedNames, sourceLink } from '../src/report';

function report(xml: string) {
	const parsed = parseXml(xml);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.report;
}
describe('JUnit XML', () => {
	it('counts one passing case', () => expect(report('<testsuite><testcase name="ok"/></testsuite>').counts).toEqual({ total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 }));
	it('counts nested suites once and uses child status', () => {
		const r = report('<testsuites tests="4"><testsuite><testcase name="ok"/><testcase name="bad"><failure message="Mismatch">trace</failure></testcase><testsuite><testcase><error/></testcase><testcase><skipped message="No DB"/></testcase></testsuite></testsuite></testsuites>');
		expect(r.counts).toEqual({ total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 });
	});
	it('warns on declared count mismatch', () => expect(report('<testsuite tests="99"><testcase/></testsuite>').warnings[0]).toContain('actual 1'));
	it('uses error then failure then skipped', () => {
		expect(report('<testsuite><testcase><skipped/><failure/><error/></testcase><testcase><skipped/><failure/></testcase></testsuite>').counts).toEqual({ total: 2, passed: 0, failed: 1, errored: 1, skipped: 0 });
	});
	it.each(['<testsuite><testcase></testsuite>', '<testsuite>','<testsuite/><testsuite/>', '<testsuite bad=unquoted/>'])('rejects malformed XML %s', (xml) => expect(parseXml(xml)).toEqual({ ok: false, error: 'The XML is malformed.' }));
	it.each(['<report/>', '<testcase/>'])('rejects unsupported roots %s', (xml) => expect(parseXml(xml)).toEqual({ ok: false, error: 'The XML root must be testsuite or testsuites.' }));
	it.each(['<testsuite xmlns="urn:junit"/>', '<j:testsuite xmlns:j="urn:junit"/>', '<testsuite><testcase xmlns="urn:case"/></testsuite>'])('rejects namespaces %s', (xml) => expect(parseXml(xml)).toEqual({ ok: false, error: 'XML namespaces are not supported in this version.' }));
	it.each(['<!DOCTYPE testsuite SYSTEM "https://evil.example/test"><testsuite/>', '<!ENTITY x SYSTEM "file:///etc/passwd"><testsuite/>'])('rejects declarations before parsing', (xml) => expect(parseXml(xml)).toEqual({ ok: false, error: 'DOCTYPE and ENTITY declarations are not supported.' }));
	it('preserves CDATA, case logs and messages with safe fences', () => {
		const log = '<img src="https://evil.example/image">\n```\n![remote](https://evil.example/image)\n<&>';
		const r = report(`<testsuite><testcase name="&lt;unsafe&gt;"><failure message="Mismatch"><![CDATA[${log}]]></failure><system-out>stdout</system-out><system-err>stderr</system-err></testcase></testsuite>`);
		const md = renderReport(r, 'build/result.xml');
		expect(md).toContain('> [!failure]- Failure 1');
		expect(md).toContain('> ````text');
		expect(md).toContain('> ![remote](https://evil.example/image)');
		expect(md).toContain('Message: Mismatch');
		expect(md).toContain('system-out\n> stdout');
		expect(md).toContain('system-err\n> stderr');
	});
	it('accepts empty suites', () => expect(report('<testsuites/>').counts.total).toBe(0));
	it('ignores suite logs and properties containing testcase markup', () => expect(report('<testsuite><properties><testcase/></properties><system-out>suite log</system-out><testcase/></testsuite>').counts.total).toBe(1));
	it('rejects actual byte size over 2 MiB', () => expect(parseXml('<testsuite>' + 'é'.repeat(1024 * 1024) + '</testsuite>')).toEqual({ ok: false, error: 'The XML file exceeds 2 MiB.' }));
	it('accepts 5000 cases and rejects 5001', () => {
		expect(report('<testsuite>' + '<testcase/>'.repeat(5000) + '</testsuite>').counts.total).toBe(5000);
		expect(parseXml('<testsuite>' + '<testcase/>'.repeat(5001) + '</testsuite>')).toEqual({ ok: false, error: 'The XML file exceeds 5,000 test cases.' });
	});
	it('truncates a long log with a visible mark', () => {
		const r = report('<testsuite><testcase><failure>' + 'x'.repeat(20001) + '</failure></testcase></testsuite>');
		expect(renderReport(r, 'a.xml')).toContain('[Log truncated at 20,000 characters]');
		expect(shorten('x'.repeat(20000))).toHaveLength(20000);
	});
	it('sizes fences for a long backtick run', () => expect(fence('``````')).toBe('```````text\n``````\n```````'));
	it('checks inclusive limits', () => { expect(checkLimits(2097152, 5000)).toBeNull(); expect(checkLimits(0, 5001)).toContain('5,000'); });
	it('encodes source links that contain Markdown punctuation', () => expect(sourceLink('a/[x] #!.xml')).toBe('[Source XML](<a/%5Bx%5D%20%23!.xml>)'));
	it('selects numbered output names without overwrites', () => expect(nextReportPath('ci/tests.XML', (path) => ['ci/tests JUnit report.md', 'ci/tests JUnit report 2.md'].includes(path))).toBe('ci/tests JUnit report 3.md'));
	it('distinguishes classes, deduplicates failures, and compares identities', () => {
		const r = report('<testsuite><testcase classname="A" name="x"><failure/></testcase><testcase classname="B" name="x"><error/></testcase><testcase classname="A" name="x"><failure/></testcase></testsuite>');
		expect(failedNames(r)).toEqual(['["A","x"]', '["B","x"]']);
		expect(compareNames(['new', 'same'], ['old', 'same'])).toEqual({ added: ['new'], resolved: ['old'], retained: ['same'] });
	});
});
