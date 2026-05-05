<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		getScenarios,
		loadData,
		queryComparison,
		checkAvailability,
		type LoadResult,
		type ComparisonRow,
	} from '$lib/api';
	import { readTheme, applyTheme, toggleTheme, type Theme } from '$lib/theme';
	import { classifyZone, type ZoneSummary } from '$lib/classify';
	import FloatingPill from '$lib/components/FloatingPill.svelte';
	import LoadedContext, { type PillNotice } from '$lib/components/LoadedContext.svelte';
	import ZoneCard from '$lib/components/ZoneCard.svelte';
	import ZoneTable from '$lib/components/ZoneTable.svelte';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import NoticeStack from '$lib/components/NoticeStack.svelte';

	type View = 'chart' | 'table';

	let theme = $state<Theme>(readTheme());
	// Apply theme synchronously on script init (browser-only because ssr=false)
	// so the first chart build reads the correct CSS variables. The $effect
	// below keeps the DOM in sync when the user toggles afterwards.
	if (typeof document !== 'undefined') {
		applyTheme(readTheme());
	}
	let view = $state<View>('chart');
	let date = $state('');
	let scenario = $state('');
	let scenarios = $state<string[]>([]);
	let loading = $state(false);
	let querying = $state(false);
	let result = $state<LoadResult | null>(null);
	let comparisonRows = $state<ComparisonRow[]>([]);
	let error = $state('');
	let fallbackNotice = $state('');
	// The date `fallbackNotice` describes. The notice stays valid only while
	// `date` equals this — once the user picks a different date, the message
	// no longer reflects what was searched and must be cleared.
	let fallbackForDate = $state('');
	let selectedVersion = $state<string>('latest');

	let loadId = 0;

	let availableVersions = $derived(
		[...new Set(comparisonRows.map((r) => r.sshVersion).filter(Boolean))].sort((a, b) => {
			const na = Number.parseInt(a, 10);
			const nb = Number.parseInt(b, 10);
			if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
			return a.localeCompare(b);
		}),
	);

	let visibleRows = $derived.by<ComparisonRow[]>(() => {
		if (comparisonRows.length === 0) return [];
		if (selectedVersion === 'latest') return pickLatestPerTime(comparisonRows);
		return comparisonRows.filter((r) => r.sshVersion === selectedVersion);
	});

	let areaNames = $derived([...new Set(visibleRows.map((r) => r.name))].sort());

	let zoneSummaries = $derived<{ name: string; rows: ComparisonRow[]; summary: ZoneSummary }[]>(
		areaNames.map((name) => {
			const rows = visibleRows.filter((r) => r.name === name);
			return { name, rows, summary: classifyZone(rows) };
		}),
	);

	let resolvedVersionLabel = $derived(
		selectedVersion === 'latest' && availableVersions.length > 0
			? `Latest · ${availableVersions[availableVersions.length - 1]}`
			: selectedVersion,
	);

	let isDebug = $derived($page.url.searchParams.get('debug') === '1');

	$effect(() => {
		applyTheme(theme);
	});

	// Build the notice list shown inside LoadedContext. Policy lives here so the
	// component stays a dumb renderer; it will collapse to a "+N" badge when more
	// than one notice is present and never silently drop any of them.
	let pillNotices = $derived.by<PillNotice[]>(() => {
		const out: PillNotice[] = [];
		if (error) {
			out.push({ kind: 'error', text: error });
		} else if (result && !result.data_available) {
			out.push({
				kind: 'error',
				text: result.message || 'Data not available for comparison.',
			});
		}
		// The auto-resolve fallback is only meaningful when no harder failure has
		// happened — otherwise it just adds noise about a date the user didn't pick.
		if (out.length === 0 && fallbackNotice) {
			out.push({ kind: 'warn', text: fallbackNotice });
		}
		return out;
	});

	function utcTodayIso(): string {
		return new Date().toISOString().split('T')[0];
	}

	function addUtcDaysIso(days: number): string {
		const d = new Date();
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().split('T')[0];
	}

	function pickLatestPerTime(rows: ComparisonRow[]): ComparisonRow[] {
		const latest = new Map<string, ComparisonRow>();
		for (const row of rows) {
			const key = `${row.name}|${row.scenarioTime}`;
			const existing = latest.get(key);
			if (!existing) {
				latest.set(key, row);
				continue;
			}
			const currentNum = Number.parseInt(row.sshVersion, 10);
			const existingNum = Number.parseInt(existing.sshVersion, 10);
			if (Number.isFinite(currentNum) && Number.isFinite(existingNum)) {
				if (currentNum > existingNum) latest.set(key, row);
			} else if (row.sshVersion > existing.sshVersion) {
				latest.set(key, row);
			}
		}
		return [...latest.values()].sort((a, b) =>
			a.name === b.name
				? a.scenarioTime.localeCompare(b.scenarioTime)
				: a.name.localeCompare(b.name),
		);
	}

	async function resolveDateForScenario(): Promise<void> {
		fallbackNotice = '';
		fallbackForDate = '';
		if (scenario === '2D') {
			const d2 = addUtcDaysIso(2);
			const d1 = addUtcDaysIso(1);
			try {
				const avail2 = await checkAvailability(d2, scenario);
				if (avail2.available) {
					date = d2;
				} else {
					const avail1 = await checkAvailability(d1, scenario);
					if (avail1.available) {
						date = d1;
						fallbackNotice = `2D scenario for ${d2} is not yet available — showing ${d1} instead.`;
						fallbackForDate = d1;
					} else {
						date = d2;
					}
				}
			} catch (e: unknown) {
				error = `Availability check failed: ${(e as Error).message}`;
				date = utcTodayIso();
			}
		} else {
			date = utcTodayIso();
		}
	}

	async function handleLoad() {
		if (!date || !scenario) return;
		const id = ++loadId;
		loading = true;
		error = '';
		// Only drop the fallback message if the user is loading a different date
		// than the one the auto-resolver landed on. Loading the same date (e.g.
		// the auto-load on mount, or hitting Load again without changing the
		// date) must keep the explanation visible — otherwise the user never
		// sees why we picked a date one day earlier than expected.
		if (fallbackForDate && date !== fallbackForDate) {
			fallbackNotice = '';
			fallbackForDate = '';
		}
		result = null;
		comparisonRows = [];
		selectedVersion = 'latest';
		try {
			const r = await loadData(date, scenario);
			if (id !== loadId) return;
			result = r;
			if (r.data_available) {
				querying = true;
				const rows = await queryComparison();
				if (id !== loadId) return;
				comparisonRows = rows;
			}
		} catch (e: unknown) {
			if (id !== loadId) return;
			error = (e as Error).message;
		} finally {
			if (id === loadId) {
				loading = false;
				querying = false;
			}
		}
	}

	function handleToggleTheme() {
		theme = toggleTheme(theme);
	}

	onMount(async () => {
		try {
			const s = await getScenarios();
			scenarios = s;
			// Hour-based default scenario rule (handoff convention):
			// before noon local -> DA (intraday), from noon onward -> 2D (day-ahead+2).
			// Falls back to whichever of those is present, then to the first scenario.
			const preferred = new Date().getHours() < 12 ? 'DA' : '2D';
			const alternate = preferred === 'DA' ? '2D' : 'DA';
			scenario = s.includes(preferred)
				? preferred
				: s.includes(alternate)
					? alternate
					: (s[0] ?? '');
		} catch (e: unknown) {
			error = `Failed to load scenarios: ${(e as Error).message}`;
			return;
		}
		if (!scenario) return;
		await resolveDateForScenario();
		// Auto-load once on mount with sensible defaults; subsequent date/scenario
		// changes require an explicit Load click.
		if (date && scenario) await handleLoad();
	});
</script>

<div class="topbar">
	<div class="topbar-inner">
		<LoadedContext
			{date}
			{scenario}
			versionLabel={visibleRows.length === 0
				? ''
				: selectedVersion === 'latest'
					? 'Latest'
					: selectedVersion}
			notices={pillNotices}
		/>

		<FloatingPill
			bind:view
			bind:date
			bind:scenario
			bind:version={selectedVersion}
			{scenarios}
			versions={availableVersions}
			{loading}
			{theme}
			onChangeView={(v) => (view = v)}
			onChangeDate={() => {}}
			onChangeScenario={async () => {
				await resolveDateForScenario();
			}}
			onChangeVersion={(v) => (selectedVersion = v)}
			onLoad={handleLoad}
			onToggleTheme={handleToggleTheme}
		/>
	</div>
</div>

<div class="app">
	<div class="stage">
		<h1 class="sr-only">CGMA / IGM zone comparison</h1>
		<NoticeStack />

		{#if comparisonRows.length > 0 && visibleRows.length === 0}
			<div class="notice">
				No rows match version <strong>{selectedVersion}</strong> for this date. Pick another version or use "Latest".
			</div>
		{/if}

		{#if visibleRows.length > 0}
			{#if view === 'chart'}
				{#each zoneSummaries as z (z.name)}
					<ZoneCard
						zone={z.name}
						rows={z.rows}
						summary={z.summary}
						dark={theme === 'dark'}
						loading={loading || querying}
					/>
				{/each}
			{:else}
				<div class="table-grid" style:--area-cols={zoneSummaries.length}>
					{#each zoneSummaries as z (z.name)}
						<div class="card flat">
							<ZoneTable rows={z.rows} zone={z.name} />
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		{#if isDebug}
			<DebugPanel {result} />
		{/if}
	</div>
</div>

<style>
	.topbar {
		position: fixed;
		top: 14px;
		left: 0;
		right: 0;
		z-index: 50;
		padding: 0 24px;
		pointer-events: none;
	}
	.topbar-inner {
		max-width: 1640px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.topbar-inner > :global(*) {
		pointer-events: auto;
	}
	/* Always keep the FloatingPill (last child) on the right edge of the
	   content area, regardless of whether LoadedContext is rendered. */
	.topbar-inner > :global(*:last-child) {
		margin-left: auto;
	}
	.app {
		position: relative;
		min-height: 100vh;
		height: 100vh;
		padding: 64px 24px 24px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
	}
	.stage {
		max-width: 1640px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1 1 auto;
		min-height: 0;
	}
	.card {
		background: var(--bg-1);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 14px 18px 16px;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.02) inset,
			0 1px 2px rgba(0, 0, 0, 0.2);
	}
	.card.flat {
		padding: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.notice {
		padding: 10px 16px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--bg-1);
		font-size: 13px;
		color: var(--fg);
	}
	.table-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px;
		flex: 1 1 auto;
		min-height: 0;
	}
	/* Stacked (narrow): cap each card so they don't all try to fill height */
	.table-grid > .card.flat {
		max-height: 70vh;
	}
	@media (min-width: 1100px) {
		.table-grid {
			grid-template-columns: repeat(var(--area-cols, 1), minmax(0, 1fr));
		}
		/* Side-by-side: let cards fill available height */
		.table-grid > .card.flat {
			max-height: none;
		}
	}
</style>
