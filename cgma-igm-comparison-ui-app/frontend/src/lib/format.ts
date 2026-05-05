// experiments/cgma-igm-comparison-ui-app/frontend/src/lib/format.ts

/**
 * Format an ISO 8601 UTC string ("2026-04-13T23:00:00Z") as a human-readable
 * UTC datetime: "13 Apr 2026, 23:00 UTC".
 *
 * Rows in the comparison table can span multiple dates (e.g., day-prior 23:00
 * vs target-day 00:00), so we always include the full date — never just the
 * time. Output is in UTC because the API returns UTC and operators reason
 * about grid timestamps in UTC.
 *
 * Returns the input unchanged if it can't be parsed, so a malformed value
 * never blanks out the cell.
 */
export function formatUtcReadable(iso: string): string {
    if (!iso) return iso;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;

    const day = String(d.getUTCDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}
