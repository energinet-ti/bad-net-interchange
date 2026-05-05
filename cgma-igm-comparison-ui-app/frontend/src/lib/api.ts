const BASE = '';  // Uses Vite proxy in dev, same-origin in prod

export async function getScenarios(): Promise<string[]> {
    const res = await fetch(`${BASE}/api/scenarios`);
    if (!res.ok) throw new Error(`Failed to fetch scenarios: ${res.status}`);
    return res.json();
}

export interface LoadResult {
    igm_files_loaded: number;
    cgma_files_loaded: number;
    total_triples: number;
    errors: string[];
    data_available: boolean;
    message: string;
    igm_api_entries: number;
    cgma_api_entries: number;
}

export async function loadData(date: string, scenario: string): Promise<LoadResult> {
    const res = await fetch(`${BASE}/api/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, scenario }),
    });
    if (!res.ok) throw new Error(`Load failed: ${res.status} ${await res.text()}`);
    return res.json();
}

export interface ComparisonRow {
    scenarioTime: string;
    cgmaTime: string;
    energyIdentCodeEic: string;
    name: string;
    businessType: string;
    netInterchange: number;
    cgmaNetPosition: number;
    difference: number;
    measurementUnit: string;
    resolution: string;
    sshVersion: string;
}

export async function queryComparison(): Promise<ComparisonRow[]> {
    const res = await fetch(`${BASE}/api/query`, { method: 'POST' });
    if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
    return res.json();
}

export interface AvailabilityResult {
    date: string;
    scenario: string;
    igm_api_entries: number;
    cgma_api_entries: number;
    available: boolean;
}

export async function checkAvailability(date: string, scenario: string): Promise<AvailabilityResult> {
    const params = new URLSearchParams({ date, scenario });
    const res = await fetch(`${BASE}/api/available?${params.toString()}`);
    if (!res.ok) throw new Error(`Availability check failed: ${res.status} ${await res.text()}`);
    return res.json();
}
