import type { DictionaryName, Feedback } from './types';

export type SolverRequest =
	| { id: number; method: 'init'; dictionary: DictionaryName }
	| { id: number; method: 'suggest' }
	| { id: number; method: 'addResult'; guess: string; feedback: Feedback[] }
	| { id: number; method: 'undo' }
	| { id: number; method: 'reset' }
	| { id: number; method: 'isValidWord'; word: string };

export type SolverResponse =
	| { id: number; ok: true; result: unknown }
	| { id: number; ok: false; error: string };
