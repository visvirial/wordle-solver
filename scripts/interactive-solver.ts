
import * as readline from 'readline/promises';

import { Dictionary } from '../src/Dictionary';
import { WordleResult } from '../src/WordleResult';
import { WordleSolver } from '../src/WordleSolver';

const main = async () => {
	console.log('Wordle interactive solver.');
	const rl = readline.createInterface({
		input : process.stdin,
		output: process.stdout,
	});
	const dicName = await rl.question('Input the dictionary name: ');
	const firstSuggestions: { [dicName: string]: string } = {
		'wordle-5': 'RAISE',
	};
	const dic = await Dictionary.load(dicName);
	const solver = new WordleSolver(dic);
	for(let trials=1; ; trials++) {
		const candidates = solver.findCandidates();
		console.log(`There are ${candidates.length.toLocaleString()} candidates.`);
		if(candidates.length <= 1) {
			console.log(`The answer is ${candidates[0]}. Congrats!`);
			rl.close();
			return;
		}
		console.log(`=== Trial: ${trials} ===`);
		const word = (() => {
			if(trials === 1 && firstSuggestions[dicName]) {
				return firstSuggestions[dicName];
			}
			return solver.suggest();
		})();
		console.log(word);
		const resultString = await rl.question('Input the result (@ for green, + for yellow, _ for gray): ');
		const result = WordleResult.fromHumanReadable(word, resultString);
		solver.addResult(result);
		console.log(result.toString());
	}
};

main();

