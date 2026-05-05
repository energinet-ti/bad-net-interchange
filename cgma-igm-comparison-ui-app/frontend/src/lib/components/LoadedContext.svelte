<script lang="ts">
	import { TriangleAlert, OctagonAlert, X } from 'lucide-svelte';

	export type NoticeKind = 'warn' | 'error';
	export interface PillNotice {
		kind: NoticeKind;
		text: string;
	}

	interface Props {
		date: string;
		scenario: string;
		versionLabel: string;
		visible?: boolean;
		notices?: PillNotice[];
	}

	let { date, scenario, versionLabel, visible = true, notices = [] }: Props = $props();

	let popoverOpen = $state(false);
	let popoverEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function formatDateNice(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-').map(Number);
		if (!y || !m || !d) return iso;
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${pad(d)} ${months[m - 1]} ${y}`;
	}

	let versionShort = $derived.by(() => {
		if (!versionLabel) return 'v000';
		if (versionLabel === 'latest' || /^latest$/i.test(versionLabel)) return 'Latest';
		return /^\d+$/.test(versionLabel) ? `v${versionLabel}` : versionLabel;
	});
	let dateLabel = $derived(date ? formatDateNice(date) : 'dd-mm-yyyy');
	let scenarioLabel = $derived(scenario || '2D');

	// Severity-sorted view of notices: errors first, then warnings.
	// Order within a kind is preserved (caller decides intra-kind priority).
	let sortedNotices = $derived.by<PillNotice[]>(() => {
		const errs = notices.filter((n) => n.kind === 'error');
		const warns = notices.filter((n) => n.kind === 'warn');
		return [...errs, ...warns];
	});
	let primaryNotice = $derived<PillNotice | null>(sortedNotices[0] ?? null);
	let extraCount = $derived(Math.max(0, sortedNotices.length - 1));
	let hasMultiple = $derived(extraCount > 0);

	// Auto-close the popover when notices disappear so we don't leave an empty shell open.
	$effect(() => {
		if (sortedNotices.length === 0 && popoverOpen) {
			popoverOpen = false;
		}
	});

	function togglePopover() {
		popoverOpen = !popoverOpen;
	}

	function closePopover() {
		popoverOpen = false;
		// Return focus to the trigger so keyboard users don't get stranded.
		triggerEl?.focus();
	}

	function handleDocClick(e: MouseEvent) {
		if (!popoverOpen) return;
		const target = e.target as Node | null;
		if (!target) return;
		if (popoverEl?.contains(target)) return;
		if (triggerEl?.contains(target)) return;
		popoverOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && popoverOpen) {
			e.stopPropagation();
			closePopover();
		}
	}
</script>

<svelte:window onclick={handleDocClick} onkeydown={handleKeydown} />

{#if visible}
	<div class="loaded" aria-label="Loaded data context">
		<span class="date" class:placeholder={!date}>{dateLabel}</span>
		<span class="sep" aria-hidden="true">·</span>
		<span class="scenario" class:placeholder={!scenario}>{scenarioLabel}</span>
		<span class="sep" aria-hidden="true">·</span>
		<span class="version" class:placeholder={!versionLabel}>{versionShort}</span>

		{#if primaryNotice}
			<button
				type="button"
				class="chip chip-{primaryNotice.kind} chip-button"
				bind:this={triggerEl}
				onclick={togglePopover}
				aria-haspopup="dialog"
				aria-expanded={popoverOpen}
				aria-controls="loaded-context-notices"
				title={hasMultiple
					? `${sortedNotices.length} messages — click to view all`
					: primaryNotice.text}
			>
				{#if primaryNotice.kind === 'error'}
					<OctagonAlert size={12} aria-hidden="true" />
				{:else}
					<TriangleAlert size={12} aria-hidden="true" />
				{/if}
				<span class="chip-text">{primaryNotice.text}</span>
				{#if hasMultiple}
					<span class="badge" aria-label="{extraCount} more">+{extraCount}</span>
				{/if}
			</button>
		{/if}

		{#if popoverOpen && primaryNotice}
			<div
				id="loaded-context-notices"
				class="popover"
				role="dialog"
				aria-label={hasMultiple ? 'All messages' : 'Message details'}
				bind:this={popoverEl}
			>
				<div class="popover-head">
					<span class="popover-title"
						>{sortedNotices.length}
						{sortedNotices.length === 1 ? 'message' : 'messages'}</span
					>
					<button
						type="button"
						class="popover-close"
						onclick={closePopover}
						aria-label="Close messages"
					>
						<X size={14} />
					</button>
				</div>
				<ul class="popover-list">
					{#each sortedNotices as n, i (i)}
						<li class="popover-item popover-item-{n.kind}">
							{#if n.kind === 'error'}
								<OctagonAlert size={14} aria-hidden="true" />
							{:else}
								<TriangleAlert size={14} aria-hidden="true" />
							{/if}
							<span class="popover-text">{n.text}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<style>
	.loaded {
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 16px;
		background: color-mix(in oklab, var(--bg-1) 88%, transparent);
		backdrop-filter: blur(20px) saturate(160%);
		-webkit-backdrop-filter: blur(20px) saturate(160%);
		border: 1px solid var(--line-2);
		border-radius: 22px;
		box-shadow:
			0 12px 40px rgba(0, 0, 0, 0.35),
			0 1px 0 rgba(255, 255, 255, 0.04) inset;
		color: var(--fg);
		box-sizing: border-box;
		flex: 0 1 auto;
		min-width: 0;
		flex-wrap: wrap;
		position: relative;
	}
	.date {
		color: var(--fg);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.scenario {
		color: var(--fg);
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: 600;
	}
	.version {
		color: var(--teal-bright);
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: 600;
	}
	:global(.light) .version {
		color: var(--teal-deep);
	}
	.sep {
		color: var(--fg-3);
		font-size: 12px;
		font-weight: 400;
	}

	/* Notice chip — single visual treatment, color-themed via modifier class. */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: 4px;
		padding: 3px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.01em;
		min-width: 0;
		max-width: 100%;
	}
	.chip-warn {
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--warn) 45%, transparent);
	}
	.chip-error {
		color: var(--bad);
		background: color-mix(in oklab, var(--bad) 14%, transparent);
		border: 1px solid color-mix(in oklab, var(--bad) 50%, transparent);
	}
	.chip-button {
		font: inherit;
		cursor: pointer;
	}
	.chip-button:hover {
		filter: brightness(1.08);
	}
	.chip-button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 1px;
	}
	.chip-text {
		min-width: 0;
		max-width: 36ch;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		flex: none;
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		background: color-mix(in oklab, currentColor 18%, transparent);
		border: 1px solid color-mix(in oklab, currentColor 35%, transparent);
		color: inherit;
	}

	/* Popover with the full list. Anchored to the bottom-left of the pill. */
	.popover {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 60;
		min-width: 280px;
		max-width: min(520px, 90vw);
		padding: 10px 12px 12px;
		background: var(--bg-1);
		border: 1px solid var(--line-2);
		border-radius: 14px;
		box-shadow:
			0 16px 48px rgba(0, 0, 0, 0.4),
			0 1px 0 rgba(255, 255, 255, 0.04) inset;
		color: var(--fg);
	}
	.popover-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.popover-title {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-3);
	}
	.popover-close {
		flex: none;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.popover-close:hover {
		background: var(--bg-2);
		color: var(--fg);
	}
	.popover-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.popover-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 10px;
		font-size: 12px;
		line-height: 1.4;
		border: 1px solid transparent;
	}
	.popover-item-error {
		color: var(--bad);
		background: color-mix(in oklab, var(--bad) 10%, transparent);
		border-color: color-mix(in oklab, var(--bad) 40%, transparent);
	}
	.popover-item-warn {
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
		border-color: color-mix(in oklab, var(--warn) 40%, transparent);
	}
	.popover-text {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.placeholder {
		color: var(--fg-3);
		opacity: 0.7;
	}
	@media (max-width: 900px) {
		.loaded {
			display: none;
		}
	}
</style>
