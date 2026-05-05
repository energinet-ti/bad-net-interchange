<script lang="ts">
	import type { LoadResult } from '$lib/api';

	interface Props {
		result: LoadResult | null;
	}

	let { result }: Props = $props();
</script>

{#if result}
	<div class="debug">
		<span class="pillette">DEBUG</span>
		<span>IGM: {result.igm_files_loaded} files</span>
		<span>CGMA: {result.cgma_files_loaded} files</span>
		<span>Triples: {result.total_triples.toLocaleString()}</span>
		<span style="margin-left: auto">append <code>?debug=0</code> to hide</span>
	</div>
{/if}

<style>
	.debug {
		margin-top: 14px;
		padding: 10px 16px;
		border-radius: 10px;
		border: 1px dashed var(--line-2);
		background: var(--bg-1);
		color: var(--fg-3);
		font-size: 12px;
		display: flex;
		gap: 18px;
		align-items: center;
		flex-wrap: wrap;
		font-family: 'JetBrains Mono', monospace;
	}
	.pillette {
		padding: 2px 8px;
		border: 1px solid var(--line-2);
		border-radius: 999px;
	}
	code {
		font-family: 'JetBrains Mono', monospace;
	}
</style>
