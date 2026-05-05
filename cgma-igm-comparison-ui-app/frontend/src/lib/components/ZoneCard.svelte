<script lang="ts">
	import { TriangleAlert, Check } from 'lucide-svelte';
	import type { ComparisonRow } from '$lib/api';
	import type { ZoneSummary } from '$lib/classify';
	import ZoneChart from './ZoneChart.svelte';
	import ChartLegend from './ChartLegend.svelte';

	interface Props {
		zone: string;
		rows: ComparisonRow[];
		summary: ZoneSummary;
		dark: boolean;
		loading?: boolean;
	}

	let { zone, rows, summary, dark, loading = false }: Props = $props();

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}
</script>

<div class="card">
	<div class="zone-head">
		<div class="left">
			<h2 class="zone-name">{zone}</h2>
		</div>
		{#if summary.status === 'breach'}
			<span class="breach-tag">
				<TriangleAlert size={11} />
				breach Δ {Math.round(summary.max)} MW @ {pad(summary.maxHour)}:00
			</span>
		{:else if summary.status === 'warn'}
			<span class="warn-tag">
				<TriangleAlert size={11} />
				warn Δ {Math.round(summary.max)} MW @ {pad(summary.maxHour)}:00
			</span>
		{:else}
			<span class="ok-tag">
				<Check size={12} />
				within tolerance · max Δ {Math.round(summary.max)} MW
			</span>
		{/if}
	</div>
	<ZoneChart {rows} {dark} {loading} />
	<ChartLegend />
</div>

<style>
	.card {
		background: var(--bg-1);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 14px 18px 16px;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.02) inset,
			0 1px 2px rgba(0, 0, 0, 0.2);
	}
	.zone-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.zone-head .left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.zone-name {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.breach-tag,
	.warn-tag,
	.ok-tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
	}
	.breach-tag {
		background: var(--bad-bg);
		color: var(--bad);
		border: 1px solid color-mix(in oklab, var(--bad) 35%, transparent);
		border-radius: 999px;
		padding: 2px 9px;
	}
	.warn-tag {
		background: var(--warn-bg);
		color: var(--warn);
		border: 1px solid color-mix(in oklab, var(--warn) 35%, transparent);
		border-radius: 999px;
		padding: 2px 9px;
	}
	.ok-tag {
		color: var(--good);
	}
</style>
