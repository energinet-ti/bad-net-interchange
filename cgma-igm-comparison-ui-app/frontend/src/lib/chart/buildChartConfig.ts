import type { ChartConfiguration } from 'chart.js';
import type { ComparisonRow } from '$lib/api';
import { differenceSeverity } from '$lib/severity';
import { hourFromIso } from '$lib/classify';

function readVar(name: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const v = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return v || fallback;
}

export function buildChartConfig(
	rows: ComparisonRow[],
	dark: boolean,
): ChartConfiguration<'line'> {
	const sorted = [...rows].sort((a, b) =>
		a.cgmaTime.localeCompare(b.cgmaTime),
	);

	const igmCol = readVar('--igm', '#e8ecef');
	const cgmaCol = readVar('--cgma', '#36c5b5');
	const diffCol = readVar('--diff', '#a4cf6f');
	const warnCol = readVar('--warn', '#e3a82b');
	const badCol = readVar('--bad', '#d8584c');
	const fg = readVar('--fg', '#e8ecef');
	const fg2 = readVar('--fg-2', '#a4adb5');
	const fg3 = readVar('--fg-3', '#6f7780');
	const line = readVar('--line', 'rgba(255,255,255,0.08)');
	const tooltipBg = dark ? 'rgba(15,17,19,0.95)' : 'rgba(255,255,255,0.97)';
	const pointHalo = dark ? '#0f1113' : '#ffffff';

	const labels = sorted.map((r) => `${String(hourFromIso(r.cgmaTime)).padStart(2, '0')}:00`);

	const diffPointColors = sorted.map((r) => {
		const sev = differenceSeverity(r.difference);
		if (sev === 'error') return badCol;
		if (sev === 'warn') return warnCol;
		return diffCol;
	});
	const diffPointRadii = sorted.map((r) => {
		const sev = differenceSeverity(r.difference);
		return sev === 'error' ? 5 : sev === 'warn' ? 4 : 2.5;
	});

	return {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'Δ Difference',
					data: sorted.map((r) => r.difference),
					borderColor: diffCol,
					backgroundColor: diffPointColors,
					pointBackgroundColor: diffPointColors,
					pointBorderColor: pointHalo,
					pointBorderWidth: 1.5,
					pointRadius: diffPointRadii,
					pointHoverRadius: diffPointRadii.map((r) => r + 2),
					yAxisID: 'y',
					tension: 0.32,
					borderWidth: 1.6,
					order: 0,
				},
				{
					label: 'CGMA netPosition',
					data: sorted.map((r) => r.cgmaNetPosition),
					borderColor: cgmaCol,
					backgroundColor: cgmaCol,
					yAxisID: 'y',
					tension: 0.32,
					borderWidth: 2,
					borderDash: [5, 4],
					pointRadius: 0,
					pointHoverRadius: 4,
					order: 1,
				},
				{
					label: 'IGM netInterchange',
					data: sorted.map((r) => r.netInterchange),
					borderColor: igmCol,
					backgroundColor: igmCol,
					yAxisID: 'y',
					tension: 0.32,
					borderWidth: 2,
					pointRadius: 0,
					pointHoverRadius: 4,
					order: 2,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: { duration: 350 },
			interaction: { mode: 'index', intersect: false },
			plugins: {
				legend: { display: false },
				tooltip: {
					backgroundColor: tooltipBg,
					titleColor: fg,
					bodyColor: fg2,
					borderColor: line,
					borderWidth: 1,
					padding: 10,
					cornerRadius: 8,
					callbacks: {
						label(ctx) {
							const v = ctx.parsed.y ?? 0;
							const sign = v > 0 ? '+' : '';
							return `  ${ctx.dataset.label}  ${sign}${v.toFixed(1)} MW`;
						},
					},
				},
			},
			scales: {
				x: {
					grid: { color: line, drawTicks: false },
					ticks: {
						color: fg3,
						font: { family: 'JetBrains Mono', size: 10 },
						maxRotation: 0,
						autoSkipPadding: 18,
					},
					border: { display: false },
					title: {
						display: true,
						text: 'Scenario Time',
						color: fg3,
						font: { size: 10, family: 'Inter' },
					},
				},
				y: {
					position: 'left',
					grid: { color: line, drawTicks: false },
					ticks: {
						color: fg3,
						font: { family: 'JetBrains Mono', size: 10 },
						padding: 8,
						callback: (v) => Number(v).toLocaleString(),
					},
					border: { display: false },
					title: {
						display: true,
						text: 'MW',
						color: fg3,
						font: { size: 10, family: 'Inter' },
					},
				},
			},
		},
	};
}
