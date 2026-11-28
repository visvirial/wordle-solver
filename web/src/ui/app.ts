import { SolverClient } from '../engine/client';
import type { DictionaryName, Feedback, SolverState, Suggestion } from '../engine/types';
import { $, h } from './dom';
import {
	MIN_ROWS,
	WORD_LENGTH,
	cycleFeedback,
	feedbackName,
	fmt,
	formatMs,
	isAllGreen,
	keyToFeedback,
	letterStatuses,
	toCode,
} from './format';

type Phase = 'loading' | 'thinking' | 'input' | 'busy' | 'solved' | 'error';
type Validity = 'unknown' | 'checking' | 'valid' | 'invalid';

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];
const DICTIONARIES: DictionaryName[] = ['wordle-5', 'words-5'];

export class App {
	private client = new SolverClient();
	private state: SolverState | null = null;
	private suggestion: Suggestion | null = null;
	private phase: Phase = 'loading';

	private guess = '';
	private feedback: Feedback[] = Array(WORD_LENGTH).fill('W');
	private cursor = 0;
	private edited = false;
	private validity: Validity = 'unknown';
	private validateSeq = 0;
	/** Bumped on every init/reset so late responses from an older game are ignored. */
	private generation = 0;
	private toastTimer: number | undefined;

	private el: {
		dictionary: HTMLSelectElement;
		undo: HTMLButtonElement;
		reset: HTMLButtonElement;
		board: HTMLElement;
		rowCode: HTMLElement;
		inlineError: HTMLElement;
		allGray: HTMLButtonElement;
		allGreen: HTMLButtonElement;
		useSuggestion: HTMLButtonElement;
		submit: HTMLButtonElement;
		solvedPanel: HTMLElement;
		solvedText: HTMLElement;
		newGame: HTMLButtonElement;
		keyboard: HTMLElement;
		details: HTMLElement;
		candCount: HTMLElement;
		candidates: HTMLElement;
		candMore: HTMLElement;
		status: HTMLElement;
		toast: HTMLElement;
	};

	constructor(private doc: Document) {
		const g = <T extends HTMLElement>(id: string) => $<T>(doc, id);
		this.el = {
			dictionary: g('dictionary'),
			undo: g('undo'),
			reset: g('reset'),
			board: g('board'),
			rowCode: g('row-code'),
			inlineError: g('inline-error'),
			allGray: g('all-gray'),
			allGreen: g('all-green'),
			useSuggestion: g('use-suggestion'),
			submit: g('submit'),
			solvedPanel: g('solved-panel'),
			solvedText: g('solved-text'),
			newGame: g('new-game'),
			keyboard: g('keyboard'),
			details: g('suggestion-details'),
			candCount: g('cand-count'),
			candidates: g('candidates'),
			candMore: g('cand-more'),
			status: g('status'),
			toast: g('toast'),
		};
		this.buildKeyboard();
		this.bindEvents();
		this.bindCompactLabels();
	}

	/** Use the short dictionary labels on narrow screens so the select text is not clipped. */
	private bindCompactLabels(): void {
		const options = Array.from(this.el.dictionary.options);
		for (const o of options) o.dataset.long = o.textContent ?? '';
		const apply = (narrow: boolean) => {
			for (const o of options) o.textContent = (narrow ? o.dataset.short : o.dataset.long) || o.dataset.long || '';
		};
		const mq = window.matchMedia?.('(max-width: 420px)');
		if (!mq) return;
		apply(mq.matches);
		mq.addEventListener?.('change', (ev) => apply(ev.matches));
	}

	async start(): Promise<void> {
		const saved = this.readSavedDictionary();
		this.el.dictionary.value = saved;
		await this.loadDictionary(saved);
	}

	// ---------------------------------------------------------------- flow

	private async loadDictionary(dict: DictionaryName): Promise<void> {
		const gen = ++this.generation;
		this.setPhase('loading');
		this.announce('Loading dictionary…');
		try {
			const state = await this.client.init(dict);
			if (gen !== this.generation) return;
			await this.applyState(state, gen);
		} catch (err) {
			if (gen !== this.generation) return;
			this.setPhase('error');
			this.showToast(`Failed to load dictionary: ${errorMessage(err)}`);
		}
	}

	/** Apply a new solver state, then either finish or fetch the next suggestion. */
	private async applyState(state: SolverState, gen: number): Promise<void> {
		this.state = state;
		this.suggestion = null;
		this.resetActiveRow('');
		this.renderCandidates();
		if (state.solved) {
			this.setPhase('solved');
			const answer = this.answer();
			this.announce(answer ? `Solved. The answer is ${answer}.` : 'Solved.');
			this.el.newGame.focus();
			return;
		}
		this.setPhase('thinking');
		this.announce(`${fmt(state.candidateCount)} candidates remaining. Thinking…`);
		try {
			const s = await this.client.suggest();
			if (gen !== this.generation || this.state !== state) return;
			this.suggestion = s;
			this.resetActiveRow(s.word);
			this.validity = 'valid';
			this.setPhase('input');
			this.announce(
				`${fmt(state.candidateCount)} candidates remaining. Suggested guess: ${s.word}. ` +
					`Worst case ${fmt(s.worstCase)} remaining.`,
			);
		} catch (err) {
			if (gen !== this.generation) return;
			this.setPhase('input');
			this.showToast(`Could not compute a suggestion: ${errorMessage(err)}`);
		}
	}

	private async runAction(action: () => Promise<SolverState>, keepGeneration: boolean): Promise<void> {
		const gen = keepGeneration ? this.generation : ++this.generation;
		const prevPhase = this.phase;
		const active = this.doc.activeElement;
		const leavingSolved = prevPhase === 'solved' || (active !== null && this.el.solvedPanel.contains(active));
		this.setPhase('busy');
		try {
			const state = await action();
			if (gen !== this.generation) return;
			await this.applyState(state, gen);
			if (gen === this.generation && leavingSolved) this.restoreFocus();
		} catch (err) {
			if (gen !== this.generation) return;
			this.setPhase(prevPhase === 'busy' ? 'input' : prevPhase);
			this.showToast(errorMessage(err));
		}
	}

	private async submit(): Promise<void> {
		if (this.phase !== 'input') return;
		// Snapshot what is being submitted; the phase switch below blocks further edits.
		const guess = this.guess;
		const feedback = [...this.feedback];
		if (guess.length !== WORD_LENGTH) {
			this.setInlineError(`Enter a ${WORD_LENGTH}-letter word.`);
			return;
		}
		const gen = this.generation;
		// Leave 'input' before any await so a second Enter (or typing) cannot slip in.
		this.setPhase('busy');
		if (this.validity !== 'valid') {
			await this.validate();
			// Re-read fields mutated during the await (TS keeps the pre-await narrowing otherwise).
			const phase = this.phase as Phase;
			const validity = this.validity as Validity;
			if (gen !== this.generation || phase !== 'busy') return;
			if (validity !== 'valid' || this.guess !== guess) {
				this.setPhase('input');
				if (validity === 'invalid' && !this.el.inlineError.textContent)
					this.setInlineError(`${guess} is not in the dictionary.`);
				return;
			}
		}
		await this.runAction(() => this.client.addResult(guess, feedback), true);
	}

	private undo(): void {
		if (!this.canEditHistory() || !this.state?.history.length) return;
		void this.runAction(() => this.client.undo(), false);
	}

	private reset(): void {
		if (!this.canEditHistory()) return;
		void this.runAction(() => this.client.reset(), false);
	}

	private canEditHistory(): boolean {
		return this.phase === 'input' || this.phase === 'solved' || this.phase === 'error';
	}

	// ---------------------------------------------------------- active row

	private resetActiveRow(word: string): void {
		this.guess = word;
		this.feedback = Array(WORD_LENGTH).fill('W');
		this.cursor = 0;
		this.edited = false;
		this.validity = word ? 'valid' : 'unknown';
		this.setInlineError('');
	}

	private typeLetter(ch: string): void {
		if (this.phase !== 'input') return;
		if (!this.edited) {
			this.edited = true;
			this.guess = '';
		}
		if (this.guess.length >= WORD_LENGTH) return;
		this.guess += ch.toUpperCase();
		this.onGuessChanged();
	}

	private deleteLetter(): void {
		if (this.phase !== 'input') return;
		this.edited = true;
		this.guess = this.guess.slice(0, -1);
		this.onGuessChanged();
	}

	private useSuggestion(word?: string): void {
		if (this.phase !== 'input') return;
		const w = word ?? this.suggestion?.word;
		if (!w) return;
		this.guess = w;
		this.edited = word !== undefined && word !== this.suggestion?.word;
		this.validity = 'valid';
		this.setInlineError('');
		this.render();
		this.announce(`Guess set to ${w}.`);
	}

	private onGuessChanged(): void {
		this.validity = 'unknown';
		this.setInlineError('');
		if (this.guess.length === WORD_LENGTH) void this.validate();
		this.render();
	}

	private async validate(): Promise<void> {
		const seq = ++this.validateSeq;
		const word = this.guess;
		this.validity = 'checking';
		try {
			const ok = await this.client.isValidWord(word);
			if (seq !== this.validateSeq || word !== this.guess) return;
			this.validity = ok ? 'valid' : 'invalid';
			this.setInlineError(ok ? '' : `${word} is not in the dictionary.`);
		} catch (err) {
			if (seq !== this.validateSeq) return;
			this.validity = 'invalid';
			this.setInlineError(errorMessage(err));
		}
		this.render();
	}

	private setFeedback(index: number, f: Feedback): void {
		if (this.phase !== 'input' || index < 0 || index >= WORD_LENGTH) return;
		this.feedback[index] = f;
		this.render();
	}

	private setAllFeedback(f: Feedback): void {
		if (this.phase !== 'input') return;
		this.feedback = Array(WORD_LENGTH).fill(f);
		this.cursor = 0;
		this.render();
		this.announce(`All tiles set to ${feedbackName(f)}.`);
		this.el.submit.focus();
	}

	// -------------------------------------------------------------- events

	private bindEvents(): void {
		const e = this.el;
		e.dictionary.addEventListener('change', () => {
			const dict = e.dictionary.value as DictionaryName;
			this.saveDictionary(dict);
			void this.loadDictionary(dict);
		});
		e.undo.addEventListener('click', () => this.undo());
		e.reset.addEventListener('click', () => this.reset());
		e.newGame.addEventListener('click', () => this.reset());
		e.allGray.addEventListener('click', () => this.setAllFeedback('W'));
		e.allGreen.addEventListener('click', () => this.setAllFeedback('G'));
		e.useSuggestion.addEventListener('click', () => this.useSuggestion());
		e.submit.addEventListener('click', () => void this.submit());

		e.board.addEventListener('click', (ev) => {
			const tile = (ev.target as HTMLElement).closest<HTMLElement>('[data-tile]');
			if (!tile) return;
			const i = Number(tile.dataset.tile);
			if (i >= this.guess.length) return;
			this.cursor = i;
			this.setFeedback(i, cycleFeedback(this.feedback[i]));
			this.focusTile(i);
			this.announce(`Letter ${i + 1}, ${this.guess[i]}: ${feedbackName(this.feedback[i])}.`);
		});

		// Mouse/touch clicks on on-screen keys and candidate words must not move focus there,
		// otherwise the physical Enter key would re-activate that button instead of submitting.
		const keepFocus = (ev: MouseEvent) => {
			if ((ev.target as HTMLElement).closest('[data-key], [data-word]')) ev.preventDefault();
		};
		e.keyboard.addEventListener('mousedown', keepFocus);
		e.candidates.addEventListener('mousedown', keepFocus);

		e.keyboard.addEventListener('click', (ev) => {
			const key = (ev.target as HTMLElement).closest<HTMLElement>('[data-key]');
			if (!key) return;
			if (ev.detail > 0 && this.doc.activeElement === key) key.blur();
			this.handleKey(key.dataset.key!, null);
		});

		e.candidates.addEventListener('click', (ev) => {
			const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-word]');
			if (!btn) return;
			if (ev.detail > 0 && this.doc.activeElement === btn) btn.blur();
			this.useSuggestion(btn.dataset.word!);
		});

		this.doc.addEventListener('keydown', (ev) => {
			if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
			const target = ev.target as HTMLElement | null;
			if (target?.closest('input, select, textarea, summary')) return;
			const tile = target?.closest<HTMLElement>('[data-tile]') ?? null;
			// On-screen keys are not keyboard-focusable on purpose; if one has focus anyway, Enter submits.
			const isOtherButton = !tile && !!target?.closest('button') && !target?.closest('[data-key]');
			// Let native buttons handle Enter/Space themselves.
			if (isOtherButton && (ev.key === 'Enter' || ev.key === ' ')) return;
			if (this.handleKey(ev.key, tile)) ev.preventDefault();
		});
	}

	/** Returns true if the key was handled. */
	private handleKey(key: string, tile: HTMLElement | null): boolean {
		if (this.phase !== 'input') return false;
		if (key === '⏎' || key === 'Enter') {
			void this.submit();
			return true;
		}
		if (key === '⌫' || key === 'Backspace') {
			this.deleteLetter();
			return true;
		}
		if (/^[a-zA-Z]$/.test(key)) {
			this.typeLetter(key);
			return true;
		}
		const f = keyToFeedback(key);
		if (f) {
			const i = tile ? Number(tile.dataset.tile) : this.cursor;
			if (i >= this.guess.length) return true;
			this.setFeedback(i, f);
			this.cursor = Math.min(i + 1, WORD_LENGTH - 1);
			if (tile) this.focusTile(this.cursor);
			this.announce(`Letter ${i + 1}, ${this.guess[i]}: ${feedbackName(f)}.`);
			return true;
		}
		if (key === 'ArrowLeft' || key === 'ArrowRight') {
			const d = key === 'ArrowLeft' ? -1 : 1;
			const base = tile ? Number(tile.dataset.tile) : this.cursor;
			this.cursor = Math.max(0, Math.min(WORD_LENGTH - 1, base + d));
			this.render();
			if (tile) this.focusTile(this.cursor);
			return true;
		}
		return false;
	}

	private focusTile(i: number): void {
		this.el.board.querySelector<HTMLElement>(`[data-tile="${i}"]`)?.focus();
	}

	/** Put keyboard focus back on the board if it was lost (e.g. the focused button got hidden). */
	private restoreFocus(): void {
		const a = this.doc.activeElement as HTMLElement | null;
		if (a && a !== this.doc.body && a.isConnected && a.offsetParent !== null) return;
		const tile = this.el.board.querySelector<HTMLButtonElement>('[data-tile="0"]');
		if (tile && !tile.disabled) tile.focus();
		else this.el.board.focus();
	}

	// ------------------------------------------------------------- render

	private setPhase(p: Phase): void {
		this.phase = p;
		this.render();
		this.renderDetails();
	}

	private render(): void {
		this.renderBoard();
		this.renderControls();
		this.renderKeyboard();
	}

	private renderBoard(): void {
		const active = this.doc.activeElement as HTMLElement | null;
		const focusedTile = active?.dataset.tile !== undefined ? Number(active.dataset.tile) : -1;

		const history = this.state?.history ?? [];
		const showActive = this.phase !== 'solved' && this.phase !== 'error' && this.state !== null;
		const rowCount = Math.max(MIN_ROWS, history.length + (showActive ? 1 : 0));
		const frag = this.doc.createDocumentFragment();

		history.forEach((row, r) => {
			const label = `Guess ${r + 1}: ${row.guess}, ${row.feedback.map(feedbackName).join(', ')}`;
			const rowEl = h('div', { class: 'row', attrs: { role: 'group', 'aria-label': label } });
			for (let i = 0; i < WORD_LENGTH; i++) {
				rowEl.append(
					h('div', { class: `tile filled fb-${row.feedback[i]}`, text: row.guess[i] ?? '', attrs: { 'aria-hidden': 'true' } }),
				);
			}
			rowEl.append(h('span', { class: 'row-tag', text: toCode(row.feedback), attrs: { 'aria-hidden': 'true' } }));
			frag.append(rowEl);
		});

		if (showActive) {
			const thinking = this.phase === 'thinking' || this.phase === 'loading';
			const rowEl = h('div', {
				class: `row active${thinking ? ' thinking' : ''}${this.validity === 'invalid' ? ' invalid' : ''}`,
				attrs: { role: 'group', 'aria-label': `Guess ${history.length + 1}${thinking ? ', thinking' : ''}` },
			});
			for (let i = 0; i < WORD_LENGTH; i++) {
				const ch = thinking ? '' : (this.guess[i] ?? '');
				const fb = this.feedback[i];
				const cls = ['tile', 'tile-btn'];
				if (ch) cls.push('filled', `fb-${fb}`);
				if (!this.edited && ch) cls.push('suggested');
				if (i === this.cursor && ch && this.phase === 'input') cls.push('cursor');
				const btn = h('button', {
					class: cls.join(' '),
					text: ch,
					attrs: {
						type: 'button',
						'data-tile': String(i),
						'aria-label': ch
							? `Letter ${i + 1}: ${ch}, ${feedbackName(fb)}. Activate to change colour, or press 1, 2 or 3.`
							: `Letter ${i + 1}: empty`,
					},
				});
				btn.disabled = this.phase !== 'input' || !ch;
				rowEl.append(btn);
			}
			rowEl.append(
				h('span', {
					class: 'row-tag',
					text: thinking ? '' : this.guess.length === WORD_LENGTH ? toCode(this.feedback) : '',
					attrs: { 'aria-hidden': 'true' },
				}),
			);
			frag.append(rowEl);
		}

		const filled = history.length + (showActive ? 1 : 0);
		for (let r = filled; r < rowCount; r++) {
			const rowEl = h('div', { class: 'row empty', attrs: { 'aria-hidden': 'true' } });
			for (let i = 0; i < WORD_LENGTH; i++) rowEl.append(h('div', { class: 'tile' }));
			rowEl.append(h('span', { class: 'row-tag' }));
			frag.append(rowEl);
		}

		this.el.board.replaceChildren(frag);
		if (focusedTile >= 0) {
			const t = this.el.board.querySelector<HTMLButtonElement>(`[data-tile="${focusedTile}"]`);
			if (t && !t.disabled) t.focus();
		}

		// Row code line (CLI notation)
		let code = '';
		if (this.phase === 'loading') code = 'Loading dictionary…';
		else if (this.phase === 'thinking') code = 'Thinking…';
		else if (this.phase === 'busy') code = 'Working…';
		else if (this.phase === 'input' && this.guess.length === WORD_LENGTH)
			code = `${this.guess}  ${toCode(this.feedback)}`;
		else if (this.phase === 'input') code = `Type a word (${this.guess.length}/${WORD_LENGTH})`;
		this.el.rowCode.textContent = code;
		this.el.rowCode.classList.toggle('pulse', this.phase === 'thinking' || this.phase === 'loading');
	}

	private renderControls(): void {
		const e = this.el;
		const input = this.phase === 'input';
		const complete = this.guess.length === WORD_LENGTH;
		const historyLen = this.state?.history.length ?? 0;
		e.submit.disabled = !input || !complete || this.validity === 'invalid';
		e.allGray.disabled = !input || !complete;
		e.allGreen.disabled = !input || !complete;
		e.useSuggestion.hidden = !(input && this.edited && this.suggestion);
		if (this.suggestion) e.useSuggestion.textContent = `Use suggestion (${this.suggestion.word})`;
		e.undo.disabled = !this.canEditHistory() || historyLen === 0;
		e.reset.disabled = !this.canEditHistory() || (historyLen === 0 && this.phase !== 'error');
		e.dictionary.disabled = this.phase === 'busy';

		const solved = this.phase === 'solved';
		e.solvedPanel.hidden = !solved;
		e.submit.hidden = solved;
		(e.allGray.parentElement as HTMLElement).hidden = solved;
		if (solved) {
			const answer = this.answer();
			const hist = this.state?.history ?? [];
			const last = hist[hist.length - 1];
			if (last && isAllGreen(last.feedback)) {
				e.solvedText.textContent = '';
				e.solvedText.append(
					'The answer is ',
					h('strong', { class: 'answer', text: last.guess }),
					` — solved in ${hist.length} ${hist.length === 1 ? 'guess' : 'guesses'}.`,
				);
			} else if (answer) {
				e.solvedText.textContent = '';
				e.solvedText.append(
					'The answer must be ',
					h('strong', { class: 'answer', text: answer }),
					` — found after ${hist.length} ${hist.length === 1 ? 'guess' : 'guesses'}; enter it as guess #${hist.length + 1}.`,
				);
			} else {
				e.solvedText.textContent = 'Solved.';
			}
		}
	}

	private buildKeyboard(): void {
		for (const row of KEY_ROWS) {
			const rowEl = h('div', { class: 'kb-row' });
			for (const k of row) {
				const label = k === '⏎' ? 'Enter' : k === '⌫' ? 'Backspace' : k;
				rowEl.append(
					h('button', {
						class: `key${k === '⏎' || k === '⌫' ? ' key-wide' : ''}`,
						text: k === '⏎' ? 'Enter' : k,
						attrs: { type: 'button', 'data-key': k, 'aria-label': label, tabindex: '-1' },
					}),
				);
			}
			this.el.keyboard.append(rowEl);
		}
	}

	private renderKeyboard(): void {
		const statuses = letterStatuses(this.state?.history ?? []);
		const input = this.phase === 'input';
		this.el.keyboard.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((btn) => {
			const k = btn.dataset.key!;
			btn.classList.remove('fb-G', 'fb-Y', 'fb-W');
			const s = statuses.get(k);
			if (s) btn.classList.add(`fb-${s}`);
			btn.disabled = !input;
			if (k.length === 1 && /[A-Z]/.test(k)) {
				btn.setAttribute('aria-label', s ? `${k}, ${feedbackName(s)}` : k);
			}
		});
	}

	private renderDetails(): void {
		const d = this.el.details;
		d.replaceChildren();
		const add = (term: string, value: string | Node, cls = '') => {
			d.append(h('dt', { text: term }), h('dd', { class: cls }, [value]));
		};
		if (this.phase === 'loading') {
			add('Status', 'Loading dictionary…', 'pulse');
			return;
		}
		if (this.phase === 'thinking') {
			add('Status', 'Thinking…', 'pulse');
			return;
		}
		if (this.phase === 'solved') {
			add('Answer', h('strong', { class: 'mono', text: this.answer() ?? '–' }));
			return;
		}
		const s = this.suggestion;
		if (!s) {
			add('Status', this.phase === 'error' ? 'Unavailable' : '–');
			return;
		}
		add('Best guess', h('strong', { class: 'mono', text: s.word }));
		add('Worst case', `${fmt(s.worstCase)} ${s.worstCase === 1 ? 'candidate' : 'candidates'} left`);
		add('Possible answer', s.isCandidate ? 'Yes' : 'No (probe word)', s.isCandidate ? 'yes' : 'no');
		add('Compute time', formatMs(s.elapsedMs));
	}

	private renderCandidates(): void {
		const st = this.state;
		const list = this.el.candidates;
		list.replaceChildren();
		if (!st) {
			this.el.candCount.textContent = '–';
			this.el.candMore.textContent = '';
			return;
		}
		this.el.candCount.textContent = fmt(st.candidateCount);
		const frag = this.doc.createDocumentFragment();
		for (const w of st.candidates) {
			frag.append(
				h('li', {}, [
					h('button', {
						class: 'cand',
						text: w,
						attrs: { type: 'button', 'data-word': w, title: `Use ${w} as the next guess` },
					}),
				]),
			);
		}
		list.append(frag);
		const more = st.candidateCount - st.candidates.length;
		this.el.candMore.textContent = more > 0 ? `…and ${fmt(more)} more` : '';
	}

	// -------------------------------------------------------------- misc

	private answer(): string | null {
		const st = this.state;
		if (!st) return null;
		const last = st.history[st.history.length - 1];
		if (last && isAllGreen(last.feedback)) return last.guess;
		return st.candidates[0] ?? null;
	}

	private setInlineError(msg: string): void {
		this.el.inlineError.textContent = msg;
	}

	private announce(msg: string): void {
		// Clear first so repeated identical messages are re-announced.
		this.el.status.textContent = '';
		window.setTimeout(() => (this.el.status.textContent = msg), 30);
	}

	private showToast(msg: string): void {
		const t = this.el.toast;
		t.textContent = msg;
		t.hidden = false;
		t.classList.add('show');
		window.clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => {
			t.classList.remove('show');
			t.hidden = true;
		}, 5000);
	}

	private readSavedDictionary(): DictionaryName {
		try {
			const v = localStorage.getItem('wordle-solver:dictionary');
			if (v && (DICTIONARIES as string[]).includes(v)) return v as DictionaryName;
		} catch {
			/* storage unavailable */
		}
		return 'wordle-5';
	}

	private saveDictionary(d: DictionaryName): void {
		try {
			localStorage.setItem('wordle-solver:dictionary', d);
		} catch {
			/* ignore */
		}
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
