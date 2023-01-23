
import { WordleResultAt, WordleResult } from './WordleResult';

const CHAR_INDEX_A = 'A'.charCodeAt(0);
export const charIndexAt = (str: string, i: number) => {
	return str.charCodeAt(i) - CHAR_INDEX_A;
};

export class WordleProblem {
	
	public readonly letters: boolean[] = [];
	
	constructor (public readonly word: string) {
		//this.word = word.toUpperCase();
		for(let i=0; i<26; i++) {
			this.letters[i] = false;
		}
		for(let i=0; i<this.length; i++) {
			this.letters[charIndexAt(this.word, i)] = true;
		}
	}
	
	get length(): number {
		return this.word.length;
	}
	
	// Get the result for the query.
	check(query: string): WordleResult {
		//query = query.toUpperCase();
		if(this.length !== query.length) {
			throw new Error('Word length mismatch.');
		}
		const result: WordleResultAt[] = [];
		for(let i=0; i<this.length; i++) {
			result.push(this.word[i] === query[i] ? 'G' : (this.letters[charIndexAt(query, i)] ? 'Y' : 'W'));
		}
		return new WordleResult(query, result);
	}
	
}

