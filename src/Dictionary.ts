
import path from 'path';
import fs from 'fs/promises';

export class Dictionary {
	
	public readonly letters: number;
	
	constructor(public readonly words: string[]) {
		this.words = words.map((word) => word.toUpperCase());
		this.letters = words[0].length;
	}
	
	get length() {
		return this.words.length;
	}
	
	random() {
		return this.words[Math.floor(Math.random() * this.words.length)];
	}
	
	static async load(name: string) {
		const lines = await fs.readFile(path.resolve(__dirname, '..', 'dic', `${name}.txt`), {encoding: 'ascii'});
		return new Dictionary(lines.trim().split('\n'));
	}
	
}

