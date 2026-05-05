<script lang="ts">
	interface Props {
		value: string;
		versions: string[];
		onchange: (value: string) => void;
	}

	let { value = $bindable(), versions, onchange }: Props = $props();

	function handle(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		value = v;
		onchange(v);
	}
</script>

<span class="pill-field" title="Version">
	<span class="pill-cap">VER</span>
	<select {value} onchange={handle} disabled={versions.length === 0}>
		<option value="latest">Latest</option>
		{#each versions as v (v)}
			<option value={v}>{v}</option>
		{/each}
	</select>
</span>

<style>
	.pill-field {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 8px;
		color: var(--fg);
		cursor: pointer;
		font-weight: 500;
		font-size: 13px;
		border: 1px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}
	.pill-field:hover {
		background: var(--line);
	}
	.pill-cap {
		font-size: 10.5px;
		color: var(--fg-3);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	@media (max-width: 1280px) {
		.pill-cap {
			display: none;
		}
	}
	select {
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		padding: 0;
		margin: 0;
		outline: none;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
		padding-right: 14px;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4 L5 7 L8 4' stroke='%23a4adb5' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
		background-repeat: no-repeat;
		background-position: right 0 center;
		font-family: 'JetBrains Mono', monospace;
	}
	option {
		background: var(--bg-1);
		color: var(--fg);
		font-family: 'JetBrains Mono', monospace;
	}
	select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
