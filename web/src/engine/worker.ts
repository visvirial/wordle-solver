/// <reference lib="webworker" />
import wordle5 from '../../../dic/wordle-5.txt?raw';
import words5 from '../../../dic/words-5.txt?raw';
import { FastSolver, parseDictionary } from './solver';
import type { SolverRequest, SolverResponse } from './protocol';
import type { DictionaryName } from './types';

const SOURCES: Record<DictionaryName, string> = { 'wordle-5': wordle5, 'words-5': words5 };
const cache = new Map<DictionaryName, FastSolver>();
let solver: FastSolver | null = null;

function load(name: DictionaryName): FastSolver {
	const src = SOURCES[name];
	if (src === undefined) throw new Error(`Unknown dictionary: ${String(name)}`);
	let s = cache.get(name);
	if (!s) {
		s = new FastSolver(parseDictionary(src), { name });
		cache.set(name, s);
	}
	return s;
}

function need(): FastSolver {
	if (!solver) throw new Error('Solver not initialised. Call init() first.');
	return solver;
}

function handle(req: SolverRequest): unknown {
	switch (req.method) {
		case 'init':
			solver = load(req.dictionary);
			return solver.reset();
		case 'suggest':
			return need().suggest();
		case 'addResult':
			return need().addResult(req.guess, req.feedback);
		case 'undo':
			return need().undo();
		case 'reset':
			return need().reset();
		case 'isValidWord':
			return need().isValidWord(req.word);
		default:
			throw new Error(`Unknown method: ${(req as { method: string }).method}`);
	}
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (ev: MessageEvent<SolverRequest>) => {
	const req = ev.data;
	let res: SolverResponse;
	try {
		res = { id: req.id, ok: true, result: handle(req) };
	} catch (e) {
		res = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	ctx.postMessage(res);
};
