/**
 * FastSolver: a DOM-free, allocation-light port of the CLI solver in src/WordleSolver.ts.
 *
 * Behaviour intentionally mirrors the CLI exactly:
 *  - Feedback per position: G if same letter, else Y if the letter appears anywhere in the
 *    answer, else W (no duplicate-letter accounting, same as src/WordleProblem.check()).
 *  - Digest = sum_i (G=0, Y=1, W=2) * 3^i (same as src/WordleResult.digest()).
 *  - suggest(): first turn -> hard-coded first word (see FIRST_WORDS), otherwise the single
 *    remaining candidate, otherwise the dictionary word minimising the worst-case bucket size
 *    (first index wins ties, dictionary order).
 */
import type { DictionaryName, Feedback, SolverState, Suggestion } from './types';

/**
 * Precomputed first suggestions (the CLI's suggestFirst() result).
 *
 * - wordle-5: 'RAISE' is hard-coded in scripts/interactive-solver.ts. Our own suggestFirst()
 *   (exact port of the CLI's entropy formula) also yields RAISE (checked in solver.test.ts).
 * - words-5: derived offline by running FastSolver.suggestFirst() over dic/words-5.txt.
 *   suggestFirst() reproduces the CLI's formula term-by-term (same float expression, same digest
 *   summation order, strict '>' so the first maximum wins), using the fact that the CLI's
 *   findCandidates() for a single first result returns exactly the words in that digest bucket.
 */
export const FIRST_WORDS: Record<DictionaryName, string> = {
	'wordle-5': 'RAISE',
	'words-5': 'TARES',
};

export const MAX_LISTED_CANDIDATES = 200;

const FEEDBACK_VALUE: Record<Feedback, number> = { G: 0, Y: 1, W: 2 };
const FEEDBACK_CHARS: Feedback[] = ['G', 'Y', 'W'];

export function feedbackToDigest(feedback: readonly Feedback[]): number {
	let d = 0;
	let p = 1;
	for (let i = 0; i < feedback.length; i++) {
		d += FEEDBACK_VALUE[feedback[i]] * p;
		p *= 3;
	}
	return d;
}

export function digestToFeedback(digest: number, letters: number): Feedback[] {
	const out: Feedback[] = [];
	for (let i = 0; i < letters; i++) {
		out.push(FEEDBACK_CHARS[digest % 3]);
		digest = Math.floor(digest / 3);
	}
	return out;
}

/** Feedback for (answer, query) using the CLI's rule. Both strings upper-case, same length. */
export function computeFeedback(answer: string, query: string): Feedback[] {
	if (answer.length !== query.length) throw new Error('Word length mismatch.');
	const out: Feedback[] = [];
	for (let i = 0; i < query.length; i++) {
		out.push(answer[i] === query[i] ? 'G' : answer.includes(query[i]) ? 'Y' : 'W');
	}
	return out;
}

export function parseDictionary(text: string): string[] {
	return text
		.split('\n')
		.map((w) => w.trim().toUpperCase())
		.filter((w) => w.length > 0);
}

export interface FastSolverOptions {
	name?: DictionaryName;
	/** Override the hard-coded first word. null => compute via suggestFirst() (slow for big dicts). */
	firstWord?: string | null;
	/** Build an N*N Uint8 digest matrix. Default: when N <= 4000. */
	useMatrix?: boolean;
}

export class FastSolver {
	readonly name: DictionaryName;
	readonly words: string[];
	readonly letters: number;
	readonly size: number;
	private readonly codes: Uint8Array; // size*letters, 0..25
	private readonly masks: Int32Array; // letter presence bit mask per word
	private readonly index = new Map<string, number>();
	private readonly pow3: Int32Array;
	private readonly matrix: Uint8Array | null; // matrix[guess*N + answer] = digest
	private readonly buckets: Int32Array;
	private readonly firstWord: string | null;

	private history: { guess: number; digest: number }[] = [];
	private candidateStack: Int32Array[] = [];
	private candidates: Int32Array;
	private firstCache: Suggestion | null = null;

	constructor(words: string[], options: FastSolverOptions = {}) {
		if (words.length === 0) throw new Error('Empty dictionary.');
		this.name = options.name ?? 'wordle-5';
		this.words = words.map((w) => w.toUpperCase());
		this.size = this.words.length;
		this.letters = this.words[0].length;
		if (3 ** this.letters > 1 << 16) throw new Error('Word length too large.');
		const N = this.size;
		const L = this.letters;
		this.codes = new Uint8Array(N * L);
		this.masks = new Int32Array(N);
		for (let w = 0; w < N; w++) {
			const word = this.words[w];
			if (word.length !== L) throw new Error(`Inconsistent word length: ${word}`);
			let mask = 0;
			for (let i = 0; i < L; i++) {
				const c = word.charCodeAt(i) - 65;
				if (c < 0 || c >= 26) throw new Error(`Invalid character in word: ${word}`);
				this.codes[w * L + i] = c;
				mask |= 1 << c;
			}
			this.masks[w] = mask;
			if (!this.index.has(word)) this.index.set(word, w);
		}
		this.pow3 = new Int32Array(L);
		for (let i = 0, p = 1; i < L; i++, p *= 3) this.pow3[i] = p;
		this.buckets = new Int32Array(3 ** L);

		const useMatrix = options.useMatrix ?? N <= 4000;
		if (useMatrix && L <= 5) {
			const m = new Uint8Array(N * N);
			for (let g = 0; g < N; g++) {
				const row = g * N;
				for (let a = 0; a < N; a++) m[row + a] = this.computeDigest(a, g);
			}
			this.matrix = m;
		} else {
			this.matrix = null;
		}

		if (options.firstWord === undefined) {
			this.firstWord = FIRST_WORDS[this.name] && this.index.has(FIRST_WORDS[this.name]) ? FIRST_WORDS[this.name] : null;
		} else {
			this.firstWord = options.firstWord === null ? null : options.firstWord.toUpperCase();
		}

		this.candidates = this.allIndices();
	}

	private allIndices(): Int32Array {
		const a = new Int32Array(this.size);
		for (let i = 0; i < this.size; i++) a[i] = i;
		return a;
	}

	/** Digest of the feedback the CLI gives when the answer is words[answer] and the query is words[guess]. */
	computeDigest(answer: number, guess: number): number {
		const L = this.letters;
		const codes = this.codes;
		const mask = this.masks[answer];
		const ao = answer * L;
		const go = guess * L;
		let d = 0;
		for (let i = 0; i < L; i++) {
			const qc = codes[go + i];
			if (codes[ao + i] !== qc) d += ((mask >>> qc) & 1 ? 1 : 2) * this.pow3[i];
		}
		return d;
	}

	digest(answer: number, guess: number): number {
		return this.matrix !== null ? this.matrix[guess * this.size + answer] : this.computeDigest(answer, guess);
	}

	indexOf(word: string): number {
		const i = this.index.get(word.toUpperCase());
		return i === undefined ? -1 : i;
	}

	isValidWord(word: string): boolean {
		return this.index.has(word.toUpperCase());
	}

	get candidateCount(): number {
		return this.candidates.length;
	}

	getCandidates(limit = Infinity): string[] {
		const n = Math.min(limit, this.candidates.length);
		const out: string[] = [];
		for (let i = 0; i < n; i++) out.push(this.words[this.candidates[i]]);
		return out;
	}

	getState(): SolverState {
		const last = this.history[this.history.length - 1];
		return {
			dictionary: this.name,
			history: this.history.map((h) => ({ guess: this.words[h.guess], feedback: digestToFeedback(h.digest, this.letters) })),
			candidateCount: this.candidates.length,
			candidates: this.getCandidates(MAX_LISTED_CANDIDATES),
			solved: (last !== undefined && last.digest === 0) || this.candidates.length === 1,
		};
	}

	addResult(guess: string, feedback: readonly Feedback[]): SolverState {
		const g = String(guess ?? '').toUpperCase();
		if (g.length !== this.letters) throw new Error(`Guess must be ${this.letters} letters long.`);
		const gi = this.index.get(g);
		if (gi === undefined) throw new Error(`"${g}" is not in the dictionary.`);
		if (!Array.isArray(feedback) || feedback.length !== this.letters) {
			throw new Error(`Feedback must have ${this.letters} entries.`);
		}
		for (const f of feedback) {
			if (f !== 'G' && f !== 'Y' && f !== 'W') throw new Error(`Invalid feedback value: ${String(f)}`);
		}
		const d = feedbackToDigest(feedback);
		const cur = this.candidates;
		const tmp = new Int32Array(cur.length);
		let n = 0;
		for (let k = 0; k < cur.length; k++) {
			const c = cur[k];
			if (this.digest(c, gi) === d) tmp[n++] = c;
		}
		if (n === 0) throw new Error('No candidates match this feedback. Please check the colours.');
		this.candidateStack.push(cur);
		this.candidates = tmp.slice(0, n);
		this.history.push({ guess: gi, digest: d });
		return this.getState();
	}

	undo(): SolverState {
		if (this.history.length > 0) {
			this.history.pop();
			this.candidates = this.candidateStack.pop()!;
		}
		return this.getState();
	}

	reset(): SolverState {
		this.history = [];
		this.candidateStack = [];
		this.candidates = this.allIndices();
		return this.getState();
	}

	/** Worst-case bucket size of the current candidates for guess index g (no pruning). */
	worstCase(g: number): number {
		const b = this.buckets;
		b.fill(0);
		const cand = this.candidates;
		let max = 0;
		for (let k = 0; k < cand.length; k++) {
			const v = ++b[this.digest(cand[k], g)];
			if (v > max) max = v;
		}
		return max;
	}

	private isCandidateIndex(g: number): boolean {
		const cand = this.candidates;
		// candidates are sorted ascending: binary search
		let lo = 0;
		let hi = cand.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (cand[mid] === g) return true;
			if (cand[mid] < g) lo = mid + 1;
			else hi = mid - 1;
		}
		return false;
	}

	/** Index of the dictionary word minimising the worst-case bucket (CLI semantics). */
	minimaxIndex(): { index: number; worstCase: number } {
		const N = this.size;
		const cand = this.candidates;
		const M = cand.length;
		const b = this.buckets;
		let best = Infinity;
		let bestIndex = 0;
		if (this.matrix !== null) {
			const m = this.matrix;
			for (let g = 0; g < N; g++) {
				b.fill(0);
				const row = g * N;
				let max = 0;
				let k = 0;
				for (; k < M; k++) {
					const v = ++b[m[row + cand[k]]];
					if (v > max) {
						max = v;
						if (max >= best) break;
					}
				}
				if (k === M && max < best) {
					best = max;
					bestIndex = g;
				}
			}
		} else {
			const L = this.letters;
			const codes = this.codes;
			const masks = this.masks;
			const pow3 = this.pow3;
			for (let g = 0; g < N; g++) {
				b.fill(0);
				const go = g * L;
				let max = 0;
				let k = 0;
				for (; k < M; k++) {
					const a = cand[k];
					const ao = a * L;
					const mask = masks[a];
					let d = 0;
					for (let i = 0; i < L; i++) {
						const qc = codes[go + i];
						if (codes[ao + i] !== qc) d += ((mask >>> qc) & 1 ? 1 : 2) * pow3[i];
					}
					const v = ++b[d];
					if (v > max) {
						max = v;
						if (max >= best) break;
					}
				}
				if (k === M && max < best) {
					best = max;
					bestIndex = g;
				}
			}
		}
		return { index: bestIndex, worstCase: best };
	}

	/**
	 * Port of WordleSolver.suggestFirst(): maximum expected information over the whole dictionary.
	 * The CLI computes, per digest bucket of size c, (c/N) * (log N - log |findCandidates|), where
	 * findCandidates for the single first result is exactly that bucket, i.e. |..| = c.
	 * Strict '>' keeps the first maximum. Ignores history (CLI requires no history).
	 */
	suggestFirstIndex(onProgress?: (done: number, total: number) => void): { index: number; entropy: number } {
		const N = this.size;
		const D = this.buckets.length;
		const counts = new Int32Array(D);
		const logN = Math.log(N);
		let bestIndex = 0;
		let bestEntropy = -Infinity;
		for (let g = 0; g < N; g++) {
			counts.fill(0);
			for (let a = 0; a < N; a++) counts[this.digest(a, g)]++;
			let total = 0;
			for (let d = 0; d < D; d++) {
				const c = counts[d];
				if (c === 0) continue;
				total += (c / N) * (logN - Math.log(c));
			}
			if (g === 0 || total > bestEntropy) {
				bestEntropy = total;
				bestIndex = g;
			}
			if (onProgress && g % 500 === 0) onProgress(g, N);
		}
		return { index: bestIndex, entropy: bestEntropy };
	}

	suggest(): Suggestion {
		const begin = now();
		let index: number;
		let worstCase: number;
		if (this.history.length === 0) {
			if (this.firstCache) return { ...this.firstCache, elapsedMs: now() - begin };
			index = this.firstWord !== null ? this.indexOf(this.firstWord) : -1;
			if (index < 0) index = this.suggestFirstIndex().index;
			worstCase = this.worstCase(index);
		} else if (this.candidates.length === 1) {
			index = this.candidates[0];
			worstCase = 1;
		} else {
			const r = this.minimaxIndex();
			index = r.index;
			worstCase = r.worstCase;
		}
		const s: Suggestion = {
			word: this.words[index],
			worstCase,
			isCandidate: this.isCandidateIndex(index),
			elapsedMs: 0,
		};
		if (this.history.length === 0) this.firstCache = s;
		return { ...s, elapsedMs: now() - begin };
	}
}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
