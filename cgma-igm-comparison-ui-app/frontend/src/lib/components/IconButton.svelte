<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		ariaLabel?: string;
		spinning?: boolean;
		onclick: () => void;
		children: Snippet;
	}

	let {
		title,
		ariaLabel,
		spinning = false,
		onclick,
		children,
	}: Props = $props();

	// `ariaLabel = title` as a destructuring default captures the prop value
	// once and does not re-evaluate when `title` changes — which left the
	// theme-toggle button announcing a stale label after switching themes.
	// Using $derived makes the fallback reactive.
	const effectiveAriaLabel = $derived(ariaLabel ?? title);
</script>

<button
	class="pill-iconbtn"
	class:spinning
	{title}
	aria-label={effectiveAriaLabel}
	{onclick}
>
	{@render children()}
</button>

<style>
	.pill-iconbtn {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		background: transparent;
		border: 0;
		color: var(--fg);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		transition: background 0.15s;
	}
	.pill-iconbtn:hover {
		background: var(--bg-2);
	}
	.pill-iconbtn.spinning :global(svg) {
		animation: spin 0.9s linear infinite;
		transform-origin: center;
	}
</style>
