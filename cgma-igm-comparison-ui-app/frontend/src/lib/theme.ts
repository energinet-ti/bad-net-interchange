export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cgma:theme';

export function readTheme(): Theme {
	if (typeof localStorage === 'undefined') return 'dark';
	const v = localStorage.getItem(STORAGE_KEY);
	return v === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('light', theme === 'light');
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch (_) {}
}

export function toggleTheme(current: Theme): Theme {
	return current === 'dark' ? 'light' : 'dark';
}
