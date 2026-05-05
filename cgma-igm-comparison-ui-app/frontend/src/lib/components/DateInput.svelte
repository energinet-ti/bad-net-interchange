<script lang="ts">
	import { Calendar } from 'lucide-svelte';

	interface Props {
		value: string;
		onchange: (value: string) => void;
	}

	let { value = $bindable(), onchange }: Props = $props();

	function handle(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		value = v;
		onchange(v);
	}
</script>

<span class="pill-field" title="Date">
	<Calendar size={14} />
	<input type="date" {value} onchange={handle} />
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
	input[type='date'] {
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		padding: 0;
		margin: 0;
		outline: none;
		width: 108px;
		color-scheme: dark;
	}
	:global(html.light) input[type='date'] {
		color-scheme: light;
	}
	@media (max-width: 1100px) {
		input[type='date'] {
			width: 96px;
		}
	}
</style>
