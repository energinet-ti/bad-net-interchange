<script lang="ts">
	import { Play } from 'lucide-svelte';

	interface Props {
		loading: boolean;
		disabled?: boolean;
		onclick: () => void;
	}

	let { loading, disabled = false, onclick }: Props = $props();
</script>

<button
	type="button"
	class="btn-load"
	class:loading
	{disabled}
	aria-label={loading ? 'Loading' : 'Load selected date'}
	aria-busy={loading}
	{onclick}
>
	{#if loading}
		<span class="spin"></span>
	{:else}
		<Play size={12} fill="currentColor" />
	{/if}
	<span class="label-text">{loading ? 'Loading' : 'Load selected date'}</span>
</button>

<style>
	.btn-load {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: linear-gradient(135deg, var(--teal), var(--teal-bright));
		color: #062421;
		font-weight: 600;
		font-size: 13px;
		border: 0;
		border-radius: 999px;
		padding: 7px 14px;
		margin-left: 6px;
		white-space: nowrap;
		cursor: pointer;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.25) inset,
			0 4px 12px rgba(32, 168, 154, 0.35);
		transition: transform 0.12s, filter 0.15s;
	}
	.btn-load:hover {
		filter: brightness(1.05);
	}
	.btn-load:active {
		transform: translateY(1px);
	}
	.btn-load:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.btn-load.loading {
		pointer-events: none;
		opacity: 0.7;
	}
	.spin {
		width: 11px;
		height: 11px;
		border: 1.5px solid #062421;
		border-top-color: transparent;
		border-radius: 999px;
		animation: spin 0.7s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
	@media (max-width: 980px) {
		.btn-load {
			padding: 7px 10px;
		}
		.btn-load .label-text {
			display: none;
		}
	}
</style>
