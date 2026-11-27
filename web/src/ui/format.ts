import type { Feedback } from '../engine/types';

export const WORD_LENGTH = 5;
export const MIN_ROWS = 6;

/** gray -> yellow -> green -> gray */
export function cycleFeedback(f: Feedback): Feedback {
	return f === 'W' ? 'Y' : f === 'Y' ? 'G' : 'W';
}

/** CLI human-readable notation: @ green, + yellow, _ gray. */
export function toCode(feedback: Feedback[]): string {
	return feedback.map((f) => (f === 'G' ? '@' : f === 'Y' ? '+' : '_')).join('');
}

export function feedbackName(f: Feedback): string {
	return f === 'G' ? 'green' : f === 'Y' ? 'yellow' : 'gray';
}

export function keyToFeedback(key: string): Feedback | null {
	return key === '1' ? 'W' : key === '2' ? 'Y' : key === '3' ? 'G' : null;
}

export function isAllGreen(feedback: Feedback[]): boolean {
	return feedback.length === WORD_LENGTH && feedback.every((f) => f === 'G');
}

/**
 * Best-known status per letter, for keyboard colouring. With the solver's
 * feedback rule (Y = letter appears anywhere), W means the letter is absent.
 */
export function letterStatuses(history: { guess: string; feedback: Feedback[] }[]): Map<string, Feedback> {
	const rank: Record<Feedback, number> = { W: 0, Y: 1, G: 2 };
	const out = new Map<string, Feedback>();
	for (const { guess, feedback } of history) {
		for (let i = 0; i < guess.length; i++) {
			const ch = guess[i];
			const f = feedback[i];
			const prev = out.get(ch);
			if (prev === undefined || rank[f] > rank[prev]) out.set(ch, f);
		}
	}
	return out;
}

export function formatMs(ms: number): string {
	if (ms < 1) return '<1 ms';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(2)} s`;
}

export const fmt = (n: number): string => n.toLocaleString('en-US');
