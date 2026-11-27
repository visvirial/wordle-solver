import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Dictionary } from '../../../src/Dictionary';
import { WordleProblem } from '../../../src/WordleProblem';
import { WordleResult } from '../../../src/WordleResult';
import { WordleSolver } from '../../../src/WordleSolver';
import { FastSolver, FIRST_WORDS, computeFeedback, digestToFeedback, feedbackToDigest, parseDictionary } from './solver';
import type { Feedback } from './types';

const DIC_DIR = path.resolve(__dirname, '../../../dic');
const loadWords = (name: string) => parseDictionary(fs.readFileSync(path.join(DIC_DIR, `${name}.txt`), 'ascii'));

// Deterministic PRNG (mulberry32).
function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function quietly<T>(fn: () => T): T {
	const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
	try {
		return fn();
	} finally {
		spy.mockRestore();
	}
}

const wordle5 = loadWords('wordle-5');
const words5 = loadWords('words-5');

describe('digest parity with src/WordleProblem + src/WordleResult', () => {
	for (const [name, words] of [
		['wordle-5', wordle5],
		['words-5', words5],
	] as const) {
		it(`matches for random pairs in ${name} (matrix and on-the-fly)`, () => {
			const withMatrix = new FastSolver(words, { name, useMatrix: name === 'wordle-5' });
			const r = rng(name.length);
			for (let n = 0; n < 20000; n++) {
				const a = Math.floor(r() * words.length);
				const g = Math.floor(r() * words.length);
				const expected = new WordleProblem(words[a]).check(words[g]);
				const d = withMatrix.digest(a, g);
				expect(d).toBe(expected.digest());
				expect(withMatrix.computeDigest(a, g)).toBe(d);
				expect(digestToFeedback(d, 5)).toEqual(expected.result);
				expect(feedbackToDigest(expected.result as Feedback[])).toBe(d);
				expect(computeFeedback(words[a], words[g])).toEqual(expected.result);
			}
		});
	}

	it('keeps the CLI duplicate-letter behaviour (no Wordle accounting)', () => {
		// Answer ABBEY, guess BOBBY: every B is Y/G even though ABBEY has only two Bs.
		const expected = new WordleProblem('ABBEY').check('BOBBY').result;
		expect(computeFeedback('ABBEY', 'BOBBY')).toEqual(expected);
		expect(expected).toEqual(['Y', 'W', 'G', 'Y', 'G']);
	});

	it('round-trips digests like WordleResult.fromDigest', () => {
		for (let d = 0; d < 243; d++) {
			expect(digestToFeedback(d, 5)).toEqual(WordleResult.fromDigest('ABCDE', d).result);
			expect(feedbackToDigest(digestToFeedback(d, 5))).toBe(d);
		}
	});
});

describe('suggestFirst parity', () => {
	it('matches WordleSolver.suggestFirst on a dictionary subset', () => {
		const r = rng(7);
		const subset = wordle5.filter(() => r() < 0.15);
		const orig = quietly(() => new WordleSolver(new Dictionary(subset)));
		const expected = quietly(() => orig.suggestFirst());
		const fast = new FastSolver(subset, { firstWord: null });
		expect(fast.words[fast.suggestFirstIndex().index]).toBe(expected);
		expect(fast.suggest().word).toBe(expected);
	});

	it('wordle-5 computed first word equals the hard-coded RAISE', () => {
		const fast = new FastSolver(wordle5, { name: 'wordle-5', firstWord: null });
		expect(fast.words[fast.suggestFirstIndex().index]).toBe('RAISE');
		expect(FIRST_WORDS['wordle-5']).toBe('RAISE');
	});

	it('hard-coded first words are used without history', () => {
		const a = new FastSolver(wordle5, { name: 'wordle-5' });
		expect(a.suggest().word).toBe('RAISE');
		const b = new FastSolver(words5, { name: 'words-5' });
		const s = b.suggest();
		expect(s.word).toBe(FIRST_WORDS['words-5']);
		expect(s.isCandidate).toBe(true);
		expect(s.worstCase).toBe(b.worstCase(b.indexOf(s.word)));
	});
});

function playGames(
	fast: FastSolver,
	orig: WordleSolver,
	answers: string[],
	firstWord: string,
): number {
	let compared = 0;
	for (const answer of answers) {
		fast.reset();
		orig.clearResults();
		let guess = firstWord;
		for (let turn = 0; turn < 12; turn++) {
			const result = new WordleProblem(answer).check(guess);
			orig.addResult(result);
			const state = fast.addResult(guess, result.result as Feedback[]);
			const origCandidates = orig.findCandidates();
			expect(state.candidateCount).toBe(origCandidates.length);
			expect(state.candidates).toEqual(origCandidates.slice(0, 200));
			if (result.isCorrect()) {
				expect(state.solved).toBe(true);
				break;
			}
			const expected = quietly(() => orig.suggest());
			const s = fast.suggest();
			expect(s.word, `answer=${answer} turn=${turn + 2}`).toBe(expected);
			expect(s.isCandidate).toBe(origCandidates.includes(expected));
			if (origCandidates.length > 1) expect(s.worstCase).toBe(fast.worstCase(fast.indexOf(s.word)));
			compared++;
			guess = s.word;
		}
	}
	return compared;
}

describe('suggest() parity with src/WordleSolver on full simulated games (wordle-5)', () => {
	let orig: WordleSolver;
	let fast: FastSolver;
	beforeAll(() => {
		orig = quietly(() => new WordleSolver(new Dictionary(wordle5)));
		fast = new FastSolver(wordle5, { name: 'wordle-5' });
	}, 60_000);

	it('agrees on every turn after RAISE', () => {
		const r = rng(42);
		const answers = ['CRANE', 'ABBEY', 'MUMMY', 'TIGER'];
		while (answers.length < 7) answers.push(wordle5[Math.floor(r() * wordle5.length)]);
		const compared = playGames(fast, orig, answers, 'RAISE');
		expect(compared).toBeGreaterThan(5);
	}, 120_000);
});

describe('suggest() parity, on-the-fly digest path (words-5 subset, no matrix)', () => {
	it('agrees with the original solver', () => {
		const r = rng(99);
		const subset = words5.filter(() => r() < 0.12);
		const orig = quietly(() => new WordleSolver(new Dictionary(subset)));
		const fast = new FastSolver(subset, { name: 'words-5', useMatrix: false});
		const answers = [0, 1, 2, 3, 4].map(() => subset[Math.floor(r() * subset.length)]);
		const first = fast.words[fast.suggestFirstIndex().index];
		expect(playGames(fast, orig, answers, first)).toBeGreaterThan(3);
	}, 60_000);
});

describe('state management and errors', () => {
	const solver = new FastSolver(wordle5, { name: 'wordle-5' });
	const fb = (s: string) => s.split('') as Feedback[];

	it('starts with the full dictionary', () => {
		const s = solver.reset();
		expect(s.dictionary).toBe('wordle-5');
		expect(s.history).toEqual([]);
		expect(s.candidateCount).toBe(2309);
		expect(s.candidates.length).toBe(200);
		expect(s.candidates[0]).toBe(wordle5[0]);
		expect(s.solved).toBe(false);
	});

	it('addResult filters candidates and accepts lower-case guesses', () => {
		solver.reset();
		const s = solver.addResult('raise', computeFeedback('CRANE', 'RAISE'));
		expect(s.history).toEqual([{ guess: 'RAISE', feedback: computeFeedback('CRANE', 'RAISE') }]);
		expect(s.candidates).toContain('CRANE');
		expect(s.candidateCount).toBeLessThan(2309);
	});

	it('rejects invalid input without changing state', () => {
		solver.reset();
		solver.addResult('RAISE', computeFeedback('CRANE', 'RAISE'));
		const before = solver.getState();
		expect(() => solver.addResult('ABCD', fb('WWWW'))).toThrow(/5 letters/);
		expect(() => solver.addResult('ZZZZZ', fb('WWWWW'))).toThrow(/dictionary/);
		expect(() => solver.addResult('CRANE', fb('GGGG'))).toThrow(/5 entries/);
		expect(() => solver.addResult('CRANE', ['G', 'G', 'G', 'G', 'X' as Feedback])).toThrow(/Invalid feedback/);
		// RAISE was already reported as not all-G, so CRANE all-W leaves no candidate.
		expect(() => solver.addResult('CRANE', fb('WWWWW'))).toThrow(/No candidates/);
		expect(solver.getState()).toEqual(before);
	});

	it('undo restores previous states and is a no-op on empty history', () => {
		const s0 = solver.reset();
		expect(solver.undo()).toEqual(s0);
		const s1 = solver.addResult('RAISE', computeFeedback('CRANE', 'RAISE'));
		const s2 = solver.addResult('CLOTH', computeFeedback('CRANE', 'CLOTH'));
		expect(s2.candidateCount).toBeLessThanOrEqual(s1.candidateCount);
		expect(solver.undo()).toEqual(s1);
		expect(solver.undo()).toEqual(s0);
		expect(solver.suggest().word).toBe('RAISE');
	});

	it('reports solved on all-G or a single candidate', () => {
		solver.reset();
		const s = solver.addResult('CRANE', fb('GGGGG'));
		expect(s.solved).toBe(true);
		expect(s.candidates).toEqual(['CRANE']);
		const sug = solver.suggest();
		expect(sug).toMatchObject({ word: 'CRANE', worstCase: 1, isCandidate: true });
		expect(solver.reset().solved).toBe(false);
	});

	it('isValidWord', () => {
		expect(solver.isValidWord('crane')).toBe(true);
		expect(solver.isValidWord('ZZZZZ')).toBe(false);
		expect(solver.isValidWord('CRAN')).toBe(false);
	});
});
