<script lang="ts">
	import type { ComparisonRow } from '$lib/api';
	import { differenceSeverity } from '$lib/severity';

	interface Props {
		rows: ComparisonRow[];
		zone: string;
	}

	let { rows, zone }: Props = $props();

	type SortKey = 'time' | 'diff';
	type SortDir = 'asc' | 'desc';

	let sortKey = $state<SortKey>('diff');
	let sortDir = $state<SortDir>('desc');

	function setSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			// Sensible defaults: time asc (chronological), diff desc (largest |Δ| first)
			sortDir = key === 'time' ? 'asc' : 'desc';
		}
	}

	let sorted = $derived(
		[...rows].sort((a, b) => {
			if (sortKey === 'time') {
				const cmp = a.cgmaTime.localeCompare(b.cgmaTime);
				return sortDir === 'asc' ? cmp : -cmp;
			}
			// diff: compare by absolute magnitude
			const cmp = Math.abs(a.difference) - Math.abs(b.difference);
			return sortDir === 'asc' ? cmp : -cmp;
		}),
	);

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function formatDateTimeUtc(iso: string): string {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const y = d.getUTCFullYear();
		const m = pad(d.getUTCMonth() + 1);
		const day = pad(d.getUTCDate());
		const hh = pad(d.getUTCHours());
		const mm = pad(d.getUTCMinutes());
		return `${y}-${m}-${day} ${hh}:${mm}`;
	}

	function arrow(key: SortKey): string {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? '▲' : '▼';
	}

	let sortLabel = $derived(
		sortKey === 'time'
			? `sorted by Time UTC ${sortDir === 'asc' ? '↑' : '↓'}`
			: `sorted by |Difference| ${sortDir === 'asc' ? '↑' : '↓'}`,
	);
</script>

<div class="zone-wrap">
	<div class="zone-head">
		<div class="left">
			<h2 class="zone-name">{zone}</h2>
			<span class="zone-meta">{rows.length} rows · {sortLabel}</span>
		</div>
	</div>
	<div class="table-scroll">
		<table class="t">
			<thead>
				<tr>
					<th class="sortable" aria-sort={sortKey === 'time' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
						<button
							type="button"
							onclick={() => setSort('time')}
							title="Time shown in UTC format (YYYY-MM-DD HH:mm). Click to sort chronologically."
						>
							Time UTC <span class="arrow">{arrow('time')}</span>
						</button>
					</th>
					<th title="IGM net interchange (MW). Negative and positive values indicate the direction of flow, not magnitude.">
						IGM
					</th>
					<th title="CGMA net position (MW). Negative and positive values indicate the direction of flow, not magnitude.">
						CGMA
					</th>
					<th
						class="sortable"
						aria-sort={sortKey === 'diff' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
					>
						<button
							type="button"
							onclick={() => setSort('diff')}
							title="Absolute difference between IGM and CGMA (MW), shown without positive/negative sign. Click to sort by magnitude."
						>
							Difference <span class="arrow">{arrow('diff')}</span>
						</button>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as r, i (r.scenarioTime + '|' + r.cgmaTime + '|' + r.sshVersion + '|' + i)}
					{@const sev = differenceSeverity(r.difference)}
					{@const cls = sev === 'error' ? 'diff-bad' : sev === 'warn' ? 'diff-warn' : 'diff-ok'}
					<tr>
						<td>{formatDateTimeUtc(r.cgmaTime)}</td>
						<td>{r.netInterchange.toFixed(2)}</td>
						<td>{r.cgmaNetPosition.toFixed(2)}</td>
						<td class={cls}>
							{Math.abs(r.difference).toFixed(2)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.zone-wrap {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.zone-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px 6px;
		flex: 0 0 auto;
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
	.zone-meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: var(--fg-3);
	}
	.table-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		border-radius: 10px;
		border: 1px solid var(--line);
	}
	table.t {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	table.t th,
	table.t td {
		padding: 8px 14px;
		text-align: right;
		border-bottom: 1px solid var(--line);
	}
	table.t th {
		color: var(--fg-3);
		font-weight: 500;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0;
		background: var(--bg-2);
		position: sticky;
		top: 0;
		z-index: 1;
	}
	table.t th:not(.sortable) {
		padding: 10px 14px;
	}
	table.t th.sortable button {
		all: unset;
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 10px 14px;
		text-align: inherit;
		cursor: pointer;
		color: inherit;
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
	}
	table.t th.sortable button:hover {
		background: var(--bg-3, rgba(255, 255, 255, 0.04));
		color: var(--fg);
	}
	table.t th.sortable button:focus-visible {
		outline: 2px solid var(--accent, #4a9eff);
		outline-offset: -2px;
	}
	table.t th .arrow {
		display: inline-block;
		min-width: 0.9em;
		font-size: 10px;
		opacity: 0.85;
	}
	table.t th:first-child,
	table.t td:first-child {
		text-align: left;
	}
	table.t td.diff-warn {
		color: var(--warn);
		font-weight: 600;
	}
	table.t td.diff-bad {
		color: var(--bad);
		font-weight: 600;
	}
	table.t td.diff-ok {
		color: var(--fg-2);
	}
</style>
