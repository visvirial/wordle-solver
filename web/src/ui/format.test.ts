import { describe, expect, it } from 'vitest';
import { cycleFeedback, keyToFeedback, letterStatuses, toCode } from './format';

describe('ui/format', () => {
	it('cycles gray -> yellow -> green -> gray', () => {
		expect(cycleFeedback('W')).toBe('Y');
		expect(cycleFeedback('Y')).toBe('G');
		expect(cycleFeedback('G')).toBe('W');
	});
	it('renders the CLI code', () => {
		expect(toCode(['W', 'W', 'W', 'W', 'G'])).toBe('____@');
		expect(toCode(['W', 'G', 'W', 'Y', 'Y'])).toBe('_@_++');
	});
	it('maps number keys', () => {
		expect(keyToFeedback('1')).toBe('W');
		expect(keyToFeedback('2')).toBe('Y');
		expect(keyToFeedback('3')).toBe('G');
		expect(keyToFeedback('4')).toBeNull();
	});
	it('keeps the best status per letter', () => {
		const m = letterStatuses([
			{ guess: 'RAISE', feedback: ['W', 'Y', 'W', 'W', 'G'] },
			{ guess: 'CLEAN', feedback: ['W', 'W', 'Y', 'G', 'W'] },
		]);
		expect(m.get('A')).toBe('G');
		expect(m.get('E')).toBe('G');
		expect(m.get('R')).toBe('W');
	});
});
