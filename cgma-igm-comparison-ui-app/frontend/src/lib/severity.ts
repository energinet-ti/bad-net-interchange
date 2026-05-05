export type Severity = 'ok' | 'warn' | 'error';

export const SEVERITY_THRESHOLDS = {
	warn: 50,
	error: 200,
} as const;

export function differenceSeverity(diff: number): Severity {
	const abs = Math.abs(diff);
	if (abs >= SEVERITY_THRESHOLDS.error) return 'error';
	if (abs >= SEVERITY_THRESHOLDS.warn) return 'warn';
	return 'ok';
}
