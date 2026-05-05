<script lang="ts">
	import { ChartSpline, Table, Sun, Moon } from 'lucide-svelte';
	import SegmentedToggle from './SegmentedToggle.svelte';
	import DateInput from './DateInput.svelte';
	import ScenarioSelect from './ScenarioSelect.svelte';
	import VersionSelect from './VersionSelect.svelte';
	import LoadButton from './LoadButton.svelte';
	import IconButton from './IconButton.svelte';
	import type { Theme } from '$lib/theme';

	type View = 'chart' | 'table';

	interface Props {
		view: View;
		date: string;
		scenario: string;
		version: string;
		scenarios: string[];
		versions: string[];
		loading: boolean;
		theme: Theme;
		onChangeView: (v: View) => void;
		onChangeDate: (v: string) => void;
		onChangeScenario: (v: string) => void;
		onChangeVersion: (v: string) => void;
		onLoad: () => void;
		onToggleTheme: () => void;
	}

	let {
		view = $bindable(),
		date = $bindable(),
		scenario = $bindable(),
		version = $bindable(),
		scenarios,
		versions,
		loading,
		theme,
		onChangeView,
		onChangeDate,
		onChangeScenario,
		onChangeVersion,
		onLoad,
		onToggleTheme,
	}: Props = $props();

	const viewOptions = [
		{ value: 'chart' as const, label: 'Chart', icon: chartIcon },
		{ value: 'table' as const, label: 'Table', icon: tableIcon },
	];
</script>

{#snippet chartIcon()}
	<ChartSpline size={13} />
{/snippet}
{#snippet tableIcon()}
	<Table size={13} />
{/snippet}

<div class="pill" role="toolbar" aria-label="Compare controls">
	<div class="pill-section view-toggle">
		<SegmentedToggle
			bind:value={view}
			options={viewOptions}
			onchange={onChangeView}
		/>
	</div>

	<div class="pill-section pill-section-center">
		<span class="pill-divider divider-before-date"></span>
		<DateInput bind:value={date} onchange={onChangeDate} />
		<ScenarioSelect bind:value={scenario} {scenarios} onchange={onChangeScenario} />
		<LoadButton {loading} disabled={!date || !scenario} onclick={onLoad} />
		<span class="pill-divider divider-before-version"></span>
		<VersionSelect bind:value={version} {versions} onchange={onChangeVersion} />
	</div>

	<div class="pill-section trailing">
		<IconButton
			title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			onclick={onToggleTheme}
		>
			{#if theme === 'dark'}
				<Sun size={15} />
			{:else}
				<Moon size={15} />
			{/if}
		</IconButton>
	</div>
</div>

<style>
	.pill {
		display: flex;
		align-items: center;
		gap: 0;
		background: color-mix(in oklab, var(--bg-1) 88%, transparent);
		backdrop-filter: blur(20px) saturate(160%);
		-webkit-backdrop-filter: blur(20px) saturate(160%);
		border: 1px solid var(--line-2);
		border-radius: 999px;
		padding: 5px 8px;
		box-shadow:
			0 12px 40px rgba(0, 0, 0, 0.35),
			0 1px 0 rgba(255, 255, 255, 0.04) inset;
		height: 44px;
		min-width: 0;
		flex: 0 1 auto;
	}
	.pill-section {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.pill-section-center {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.pill-divider {
		width: 1px;
		height: 20px;
		background: var(--line-2);
		margin: 0 8px;
	}

	/* ---- Responsive: progressively shed non-essential controls ----
	   Priority (most -> least essential):
	   1. Date / Scenario / Load              (always)
	   2. Version select                      (always)
	   3. Chart / Table toggle                (always)
	   4. Theme toggle                        (always)
	   5. Pill dividers                       (hide with the items they separate)
	*/

	/* Tighten internals on medium widths */
	@media (max-width: 1280px) {
		.pill-divider {
			margin: 0 6px;
		}
		.pill-section,
		.pill-section-center {
			gap: 5px;
		}
	}

	/* Hide the trailing divider before version select to save a few px */
	@media (max-width: 920px) {
		.divider-before-version {
			display: none;
		}
	}

	/* Very narrow: drop the Chart/Table label-area divider too */
	@media (max-width: 760px) {
		.divider-before-date {
			display: none;
		}
		.pill {
			padding: 5px 6px;
		}
	}
</style>
