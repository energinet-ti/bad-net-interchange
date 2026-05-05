<script lang="ts">
	import { Chart, registerables } from 'chart.js';
	import type { ComparisonRow } from '$lib/api';
	import { buildChartConfig } from '$lib/chart/buildChartConfig';

	interface Props {
		rows: ComparisonRow[];
		dark: boolean;
		loading?: boolean;
	}

	let { rows, dark, loading = false }: Props = $props();
	let canvas = $state<HTMLCanvasElement | undefined>(undefined);

	let registered = false;
	function registerOnce() {
		if (registered) return;
		Chart.register(...registerables);
		registered = true;
	}

	// Single source of truth for the chart lifecycle.
	// Creates the chart when canvas/rows/dark settle, tears it down on
	// teardown OR before the next re-creation. Two RAFs let the browser
	// commit a non-zero layout for the wrapper before Chart.js measures it
	// (fixes the "blank chart on first paint / every-other-toggle" bug).
	$effect(() => {
		const el = canvas;
		// Track reactive deps explicitly so they aren't dropped by the
		// short-circuit returns below.
		const data = rows;
		const isDark = dark;
		if (!el || data.length === 0) return;

		registerOnce();

		let chart: Chart | null = null;
		let cancelled = false;
		let raf2 = 0;
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => {
				if (cancelled) return;
				chart = new Chart(el, buildChartConfig(data, isDark));
			});
		});

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf1);
			if (raf2) cancelAnimationFrame(raf2);
			if (chart) {
				chart.destroy();
				chart = null;
			}
		};
	});
</script>

<div class="chart-wrap">
	<canvas bind:this={canvas}></canvas>
	{#if loading}
		<div class="loading-overlay">loading…</div>
	{/if}
</div>

<style>
	.chart-wrap {
		position: relative;
		height: 340px;
	}
	.chart-wrap :global(canvas) {
		display: block;
	}
	.loading-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in oklab, var(--bg-1) 60%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: var(--fg-2);
		border-radius: 14px;
		backdrop-filter: blur(2px);
	}
</style>
