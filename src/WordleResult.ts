
import { WordleProblem } from './WordleProblem';

export type WordleResultAt = 'G' | 'Y' | 'W';

export class WordleResult {
	
	constructor(public readonly query: string, public readonly result: WordleResultAt[]) {
	}
	
	get length() {
		return this.result.length;
	}
	
	toString() {
		return this.result.map((a) => a === 'G' ? '@' : (a === 'Y' ? '+' : '_')).join('');
	}
	
	isCorrect() {
		for(let i=0; i<this.length; i++) {
			if(this.result[i] !== 'G') return false;
		}
		return true;
	}
	
	hasSameResult(result: WordleResult) {
		for(let i=0; i<this.length; i++) {
			if(this.result[i] !== result.result[i]) return false;
		}
		return true;
	}
	
	// Compute a unique integer which represents the result. 0-3**letters.
	digest(): number {
		let result = 0;
		for(let i=0; i<this.result.length; i++) {
			result += (this.result[i] === 'G' ? 0 : (this.result[i] === 'Y' ? 1 : 2)) * (3 ** i);
		}
		return result;
	}
	
	static fromDigest(query: string, digest: number): WordleResult {
		const result: WordleResultAt[] = [];
		for(let i=0; i<query.length; i++) {
			result.push(['G' as WordleResultAt, 'Y' as WordleResultAt, 'W' as WordleResultAt][digest % 3]);
			digest = Math.floor(digest / 3);
		}
		return new WordleResult(query, result);
	}
	
	static fromHumanReadable(query: string, resultHR: string): WordleResult {
		if(query.length !== resultHR.length) {
			throw new Error(`The length of the query (${query.length}) and the human readable result (${resultHR.length}) is not the same!`);
		}
		const result = resultHR.split('').map((c) => {
			switch(c) {
				case '@':
					return 'G';
				case '+':
					return 'Y';
				case '_':
					return 'W';
				default:
					throw new Error(`Invalid character in the human readable result: ${c}.`);
			}
		});
		return new WordleResult(query, result);
	}
	
}

