<script lang="ts" generics="T extends string">
	import type { Snippet } from 'svelte';

	interface Option {
		value: T;
		label: string;
		icon: Snippet;
	}

	interface Props {
		value: T;
		options: Option[];
		ariaLabel?: string;
		onchange: (value: T) => void;
	}

	let { value = $bindable(), options, ariaLabel = 'View', onchange }: Props = $props();

	function pick(v: T) {
		value = v;
		onchange(v);
	}
</script>

<div class="pill-seg" role="tablist" aria-label={ariaLabel}>
	{#each options as opt (opt.value)}
		<button
			type="button"
			role="tab"
			aria-selected={value === opt.value}
			onclick={() => pick(opt.value)}
		>
			{@render opt.icon()}
			<span class="label-text">{opt.label}</span>
		</button>
	{/each}
</div>

<style>
	.pill-seg {
		display: inline-flex;
		padding: 2px;
		background: var(--bg-2);
		border-radius: 999px;
		margin-right: 6px;
	}
	.pill-seg button {
		border: 0;
		background: transparent;
		color: var(--fg-2);
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		padding: 4px 11px;
		border-radius: 999px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		transition: color 0.15s, background 0.15s;
	}
	.pill-seg button[aria-selected='true'] {
		background: var(--fg);
		color: var(--bg);
		font-weight: 600;
	}
	@media (max-width: 980px) {
		.pill-seg button {
			padding: 4px 9px;
		}
		.pill-seg button .label-text {
			display: none;
		}
	}
</style>
