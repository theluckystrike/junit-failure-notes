import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as report from '../src/report';
import vectors from './vectors.json';

describe('golden acceptance vectors', () => {
	for (const vector of vectors.cases) it(vector.name, () => {
		const fn = (report as unknown as Record<string, (...args: unknown[]) => unknown>)[('function' in vector ? vector.function : vectors.function) as string];
		expect(fn!(...vector.args)).toEqual(vector.expected);
	});
	const monorepoVector = '../../packages/spec/vectors/junit-failure-notes.json';
	it.skipIf(!existsSync(monorepoVector))('matches the shared vector file', () => expect(JSON.parse(readFileSync(monorepoVector, 'utf8'))).toEqual(vectors));
});
