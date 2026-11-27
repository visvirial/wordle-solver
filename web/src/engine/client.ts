import type { DictionaryName, Feedback, SolverState, Suggestion } from './types';
import type { SolverRequest, SolverResponse } from './protocol';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise-based front for the solver Web Worker. Requests are matched to responses by id. */
export class SolverClient {
	private readonly worker: Worker;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private terminated = false;
	/** Set when the worker itself failed; every later call rejects with this error. */
	private broken: Error | null = null;

	constructor() {
		this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.worker.onmessage = (ev: MessageEvent<SolverResponse>) => {
			const res = ev.data;
			const p = this.pending.get(res.id);
			if (!p) return;
			this.pending.delete(res.id);
			if (res.ok) p.resolve(res.result);
			else p.reject(new Error(res.error));
		};
		this.worker.onerror = (ev: ErrorEvent) => {
			ev.preventDefault();
			this.markBroken(new Error(`Solver worker error: ${ev.message || 'unknown error'}`));
		};
		this.worker.onmessageerror = () => {
			this.markBroken(new Error('Solver worker sent a message that could not be read.'));
		};
	}

	private markBroken(err: Error): void {
		this.broken ??= err;
		this.failAll(err);
	}

	private failAll(err: Error): void {
		for (const p of this.pending.values()) p.reject(err);
		this.pending.clear();
	}

	private call<T>(req: DistributiveOmit<SolverRequest, 'id'>): Promise<T> {
		if (this.terminated) return Promise.reject(new Error('Solver has been terminated.'));
		if (this.broken) return Promise.reject(this.broken);
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.worker.postMessage({ ...req, id } as SolverRequest);
		});
	}

	init(dictionary: DictionaryName): Promise<SolverState> {
		return this.call({ method: 'init', dictionary });
	}

	suggest(): Promise<Suggestion> {
		return this.call({ method: 'suggest' });
	}

	addResult(guess: string, feedback: Feedback[]): Promise<SolverState> {
		return this.call({ method: 'addResult', guess, feedback: [...feedback] });
	}

	undo(): Promise<SolverState> {
		return this.call({ method: 'undo' });
	}

	reset(): Promise<SolverState> {
		return this.call({ method: 'reset' });
	}

	isValidWord(word: string): Promise<boolean> {
		return this.call({ method: 'isValidWord', word });
	}

	terminate(): void {
		if (this.terminated) return;
		this.terminated = true;
		this.worker.terminate();
		this.failAll(new Error('Solver has been terminated.'));
	}
}
