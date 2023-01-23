
import { Dictionary } from './Dictionary';
import { WordleProblem } from './WordleProblem';
import { WordleResult } from './WordleResult';

export class WordleSolver {
	
	public readonly results: WordleResult[] = [];
	
	public readonly resultCache: { [word: string]: { [query: string]: WordleResult } } = {};
	
	constructor(public readonly dic: Dictionary) {
		const begin = Date.now();
		this.dic.words.forEach((word: string) => {
			this.resultCache[word] = {};
			const problem = new WordleProblem(word);
			this.dic.words.forEach((query: string) => {
				const result = problem.check(query);
				this.resultCache[word][query] = result;
			});
		});
		console.log(`[WordleSolver.constructor] ${(Date.now()-begin).toLocaleString()}ms.`);
	}
	
	addResult(result: WordleResult) {
		this.results.push(result);
	}
	
	popResult() {
		return this.results.pop();
	}
	
	clearResults() {
		return this.results.splice(0);
	}
	
	// Find possible candidates for the current result set.
	findCandidates(possibleCandidates: string[] = this.dic.words): string[] {
		const check = (word: string) => {
			for(let i=0; i<this.results.length; i++) {
				const result = this.resultCache[word][this.results[i].query];
				if(!result.hasSameResult(this.results[i])) {
					return false;
				}
			}
			return true;
		};
		const candidates: string[] = [];
		possibleCandidates.forEach((word) => {
			if(check(word)) {
				candidates.push(word);
			}
		});
		return candidates;
	}
	
	// Suggest for the first try.
	suggestFirst(): string {
		if(this.results.length !== 0) {
			throw new Error(`The number of trials currently should be zero. Current: ${this.results.length}`);
		}
		const entropies = this.dic.words.map((query, i) => {
			const digestCounts: number[] = [];
			for(let i=0; i<3**this.dic.letters; i++) {
				digestCounts[i] = 0;
			}
			// Find result digests for each problem.
			this.dic.words.forEach((word) => {
				const result = this.resultCache[word][query];
				digestCounts[result.digest()]++;
			});
			// Compute the number of candidates for each digests.
			let totalEntropy = 0;
			for(let digest=0; digest<3**this.dic.letters; digest++) {
				if(digestCounts[digest] === 0) continue;
				const result = WordleResult.fromDigest(query, digest);
				this.addResult(result);
				const candidates = this.findCandidates();
				this.popResult();
				//console.log(`${result.toString()}`, digestCounts[digest], candidates.length);
				const entropy = (digestCounts[digest] / this.dic.length) * (Math.log(this.dic.length) - Math.log(candidates.length));
				totalEntropy += entropy;
			}
			//console.log(`Total entropy gained by querying ${query} is: ${totalEntropy}`);
			if(i % 100 === 0) {
				console.log(`Completed: ${i+1}`);
			}
			return totalEntropy;
		});
		// Find the max entropy.
		let maxIndex = 0;
		for(let i=1; i<entropies.length; i++) {
			if(entropies[i] > entropies[maxIndex]) {
				maxIndex = i;
			}
		}
		return this.dic.words[maxIndex];
	}
	
	// Find the next word which gives less candidates.
	suggest(): string {
		const begin = Date.now();
		if(this.results.length === 0) {
			return this.suggestFirst();
		}
		const candidates = this.findCandidates();
		// If there is one candidate, do nothing.
		if(candidates.length === 1) return candidates[0];
		const maxCandidates: number[] = [];
		for(let i=0; i<this.dic.words.length; i++) {
			const word = this.dic.words[i];
			let max = 0;
			// candidateCache[WordleResult.digest()] = count.
			const candidateCache: number[] = [];
			for(let j=0; j<candidates.length; j++) {
				const result = this.resultCache[candidates[j]][word];
				if(candidateCache[result.digest()] === undefined) {
					this.addResult(result);
					const count = this.findCandidates(candidates).length;
					max = Math.max(max, count);
					this.popResult();
					candidateCache[result.digest()] = count;
				} else {
					max = Math.max(max, candidateCache[result.digest()]);
				}
			}
			maxCandidates.push(max);
		}
		// Find minimum `maxCandidates` index.
		let index = 0;
		for(let i=1; i<maxCandidates.length; i++) {
			if(maxCandidates[i] < maxCandidates[index]) {
				index = i;
			}
		}
		//console.log(`[WordleSolver.suggest] ${(Date.now()-begin).toLocaleString()}ms.`);
		return this.dic.words[index];
	}
	
}

