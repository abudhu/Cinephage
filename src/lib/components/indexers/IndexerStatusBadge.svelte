<script lang="ts">
	import { Check, X, AlertTriangle } from 'lucide-svelte';

	interface Props {
		enabled: boolean;
		healthy?: boolean;
		consecutiveFailures?: number;
		lastFailure?: string;
		disabledUntil?: string;
	}

	let {
		enabled,
		healthy: _healthy = true,
		consecutiveFailures = 0,
		lastFailure,
		disabledUntil
	}: Props = $props();
	// Intentionally unused - kept for API compatibility
	void _healthy;

	// Use $derived for reactive computed values from props
	const hasFailures = $derived(consecutiveFailures > 0);
	const isAutoDisabled = $derived(!!disabledUntil && new Date(disabledUntil) > new Date());

	const badgeClass = $derived(() => {
		if (!enabled) return 'badge-ghost';
		if (isAutoDisabled) return 'badge-error';
		if (hasFailures) return 'badge-warning';
		return 'badge-success';
	});

	const statusText = $derived(() => {
		if (!enabled) return 'Disabled';
		if (isAutoDisabled) return 'Auto-disabled';
		if (hasFailures) return 'Degraded';
		return 'Healthy';
	});

	const tooltipText = $derived(() => {
		if (!enabled) return 'Indexer is disabled by user';
		if (isAutoDisabled) {
			const until = new Date(disabledUntil!).toLocaleString();
			return `Auto-disabled until ${until} due to ${consecutiveFailures} consecutive failures`;
		}
		if (hasFailures) {
			const failureTime = lastFailure ? new Date(lastFailure).toLocaleString() : 'Unknown';
			return `${consecutiveFailures} consecutive failure(s). Last failure: ${failureTime}`;
		}
		return 'Indexer is healthy and operational';
	});
</script>

<div class="tooltip tooltip-right" data-tip={tooltipText()}>
	<div class="badge {badgeClass()} gap-1">
		{#if !enabled}
			<X class="h-3 w-3" />
		{:else if isAutoDisabled}
			<AlertTriangle class="h-3 w-3" />
		{:else if hasFailures}
			<AlertTriangle class="h-3 w-3" />
		{:else}
			<Check class="h-3 w-3" />
		{/if}
		<span class="text-xs">{statusText()}</span>
	</div>
</div>
