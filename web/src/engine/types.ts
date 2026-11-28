export type Feedback = 'G' | 'Y' | 'W';
export type DictionaryName = 'wordle-5' | 'words-5';

export interface SolverState {
	dictionary: DictionaryName;
	history: { guess: string; feedback: Feedback[] }[]; // upper-case guess
	candidateCount: number;
	candidates: string[]; // up to first 200 candidates, upper-case, dictionary order
	solved: boolean; // last feedback all G, or candidateCount === 1
}

export interface Suggestion {
	word: string;
	worstCase: number;
	isCandidate: boolean;
	elapsedMs: number;
}
