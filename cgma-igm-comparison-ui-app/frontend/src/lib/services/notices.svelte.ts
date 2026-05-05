// Notice center: shared reactive store for transient warnings/errors.
//
// Behaviour:
// - `show(input)` upserts a notice keyed by `id`. While active it is visible
//   in the page (rendered as a banner) and an auto-dismiss timer runs.
// - When the timer fires (or `dismiss(id)` is called) the notice moves to
//   `archived`, where it remains until cleared. The Bell icon in the top
//   bar shows the archived count and re-shows them on click.
// - Re-showing an archived notice restarts its auto-dismiss timer.

import { untrack } from 'svelte';

export type NoticeKind = 'info' | 'warn' | 'bad';

export interface NoticeInput {
	id: string;
	kind: NoticeKind;
	title?: string;
	message: string;
	meta?: string;
	/** Auto-dismiss timeout in ms. Defaults to 7000. Use 0 to disable. */
	durationMs?: number;
}

export interface Notice extends NoticeInput {
	createdAt: number;
}

const DEFAULT_DURATION_MS = 7000;

const active = $state<Notice[]>([]);
const archived = $state<Notice[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
}

function scheduleDismiss(id: string, durationMs: number): void {
	clearTimer(id);
	if (durationMs <= 0) return;
	const handle = setTimeout(() => dismiss(id), durationMs);
	timers.set(id, handle);
}

function removeFrom(list: Notice[], id: string): Notice | undefined {
	const idx = list.findIndex((n) => n.id === id);
	if (idx === -1) return undefined;
	const [removed] = list.splice(idx, 1);
	return removed;
}

// Mutator bodies are wrapped in `untrack` so that when they're called from
// within a `$effect`, the effect doesn't subscribe to `active`/`archived`
// (these arrays are read here for upsert/findIndex logic). Without untrack,
// the read+write inside the same effect creates a reactive cycle that Svelte
// aborts via update-depth protection — which silently halts further effect
// propagation in the same tick (e.g. the theme $effect stops applying).
export function show(input: NoticeInput): void {
	untrack(() => {
		const duration = input.durationMs ?? DEFAULT_DURATION_MS;
		const next: Notice = { ...input, durationMs: duration, createdAt: Date.now() };
		removeFrom(archived, input.id);
		const existingIdx = active.findIndex((n) => n.id === input.id);
		if (existingIdx === -1) active.push(next);
		else active[existingIdx] = next;
		scheduleDismiss(input.id, duration);
	});
}

export function dismiss(id: string): void {
	untrack(() => {
		clearTimer(id);
		const removed = removeFrom(active, id);
		if (removed) archived.unshift(removed);
	});
}

export function restore(id: string): void {
	untrack(() => {
		const removed = removeFrom(archived, id);
		if (!removed) return;
		active.push(removed);
		scheduleDismiss(id, removed.durationMs ?? DEFAULT_DURATION_MS);
	});
}

export function clearArchived(): void {
	untrack(() => {
		archived.length = 0;
	});
}

export function clearById(id: string): void {
	untrack(() => {
		clearTimer(id);
		removeFrom(active, id);
		removeFrom(archived, id);
	});
}

export function getActive(): Notice[] {
	return active;
}

export function getArchived(): Notice[] {
	return archived;
}
