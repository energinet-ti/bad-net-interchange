import type { ComparisonRow } from '$lib/api';
import { differenceSeverity } from '$lib/severity';

export type ZoneStatus = 'ok' | 'warn' | 'breach';

export interface ZoneSummary {
	max: number;
	maxHour: number;
	breachCount: number;
	warnCount: number;
	status: ZoneStatus;
}

export function hourFromIso(iso: string): number {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? -1 : d.getUTCHours();
}

export function classifyZone(rows: ComparisonRow[]): ZoneSummary {
	let max = 0;
	let maxHour = -1;
	let breachCount = 0;
	let warnCount = 0;
	for (const r of rows) {
		const a = Math.abs(r.difference);
		if (a > max) {
			max = a;
			maxHour = hourFromIso(r.cgmaTime);
		}
		const sev = differenceSeverity(r.difference);
		if (sev === 'error') breachCount++;
		else if (sev === 'warn') warnCount++;
	}
	const status: ZoneStatus =
		breachCount > 0 ? 'breach' : warnCount > 0 ? 'warn' : 'ok';
	return { max, maxHour, breachCount, warnCount, status };
}

export function deriveOverallStatus(summaries: ZoneSummary[]): ZoneStatus {
	if (summaries.some((s) => s.status === 'breach')) return 'breach';
	if (summaries.some((s) => s.status === 'warn')) return 'warn';
	return 'ok';
}
