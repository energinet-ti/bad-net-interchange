<script lang="ts">
	import { X } from 'lucide-svelte';
	import { getActive, dismiss, type Notice } from '$lib/services/notices.svelte';

	// Spread into a fresh array so the derived value's identity changes whenever
	// the underlying $state array mutates. Reading `.length` and iterating ensures
	// reactive subscriptions are established correctly.
	const notices = $derived<Notice[]>([...getActive()]);

	function handleDismiss(e: MouseEvent, id: string) {
		// Prevent the click from bubbling to ancestors which can interleave
		// state updates with their own listeners.
		e.stopPropagation();
		dismiss(id);
	}
</script>

{#if notices.length > 0}
	<div class="stack" role="region" aria-label="Notifications">
		{#each notices as n (n.id)}
			<div class="notice notice-{n.kind}" role={n.kind === 'bad' ? 'alert' : 'status'}>
				<div class="body">
					{#if n.title}<strong>{n.title}</strong>{' '}{/if}<span>{n.message}</span>
					{#if n.meta}<span class="meta">{n.meta}</span>{/if}
				</div>
				<button
					class="close"
					type="button"
					title="Dismiss"
					aria-label="Dismiss notification"
					onclick={(e) => handleDismiss(e, n.id)}
				>
					<X size={14} />
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px 10px 16px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--bg-1);
		font-size: 13px;
		color: var(--fg);
	}
	.notice-warn {
		border-color: color-mix(in oklab, var(--warn) 50%, transparent);
		background: color-mix(in oklab, var(--warn) 8%, var(--bg-1));
	}
	.notice-bad {
		border-color: color-mix(in oklab, var(--bad) 50%, transparent);
		background: color-mix(in oklab, var(--bad) 8%, var(--bg-1));
	}
	.notice-info {
		border-color: color-mix(in oklab, var(--good) 35%, transparent);
		background: color-mix(in oklab, var(--good) 6%, var(--bg-1));
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.meta {
		display: block;
		margin-top: 4px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: var(--fg-3);
	}
	.close {
		flex: none;
		width: 24px;
		height: 24px;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.close:hover {
		background: var(--bg-2);
		color: var(--fg);
	}
</style>
