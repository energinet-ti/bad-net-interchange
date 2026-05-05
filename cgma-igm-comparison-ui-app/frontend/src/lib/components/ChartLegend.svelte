<div class="legend">
	<span><span class="line"></span>IGM netInterchange</span>
	<span><span class="dash"></span>CGMA netPosition</span>
	<span><span class="line diff"></span>Δ Difference</span>
</div>

<style>
	.legend {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		font-size: 11.5px;
		color: var(--fg-2);
		align-items: center;
		padding-top: 10px;
		margin-top: 10px;
		border-top: 1px solid var(--line);
	}
	.legend .dash {
		width: 14px;
		height: 0;
		border-top: 2px dashed var(--cgma);
		display: inline-block;
		margin-right: 6px;
		vertical-align: middle;
	}
	.legend .line {
		width: 14px;
		height: 0;
		border-top: 2px solid var(--igm);
		display: inline-block;
		margin-right: 6px;
		vertical-align: middle;
	}
	.legend .line.diff {
		border-top-color: var(--diff);
	}
</style>
