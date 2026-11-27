export function $<T extends HTMLElement = HTMLElement>(doc: Document, id: string): T {
	const el = doc.getElementById(id);
	if (!el) throw new Error(`Missing element #${id}`);
	return el as T;
}

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
	children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (props.class) el.className = props.class;
	if (props.text !== undefined) el.textContent = props.text;
	if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
	for (const c of children) el.append(c);
	return el;
}
