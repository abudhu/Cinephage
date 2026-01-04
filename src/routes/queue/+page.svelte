<script lang="ts">
	import { resolve } from '$app/paths';
	import { resolvePath } from '$lib/utils/routing';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { Download, History, Filter } from 'lucide-svelte';
	import type { PageData } from './$types';
	import QueueTable from '$lib/components/queue/QueueTable.svelte';
	import QueueStats from '$lib/components/queue/QueueStats.svelte';
	import HistoryTable from '$lib/components/queue/HistoryTable.svelte';
	import { Inbox, Search } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let activeTab = $state<'queue' | 'history'>('queue');

	// SSE for real-time updates
	let eventSource: EventSource | null = null;
	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 10;
	const RECONNECT_BASE_DELAY = 1000; // 1 second
	let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

	// Debounce invalidation to prevent excessive page reloads
	// This is especially important when SABnzbd is slow to respond
	let invalidateTimeout: ReturnType<typeof setTimeout> | null = null;
	const INVALIDATE_DEBOUNCE_MS = 500;

	function debouncedInvalidate() {
		if (invalidateTimeout) {
			clearTimeout(invalidateTimeout);
		}
		invalidateTimeout = setTimeout(() => {
			invalidateAll();
			invalidateTimeout = null;
		}, INVALIDATE_DEBOUNCE_MS);
	}

	function connectSSE() {
		if (eventSource) {
			eventSource.close();
		}

		eventSource = new EventSource('/api/queue/events');

		eventSource.onopen = () => {
			// Reset reconnect attempts on successful connection
			reconnectAttempts = 0;
		};

		eventSource.onerror = () => {
			// Close the failed connection
			eventSource?.close();
			eventSource = null;

			// Attempt reconnection with exponential backoff
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts);
				reconnectAttempts++;
				reconnectTimeout = setTimeout(connectSSE, delay);
			}
		};

		// Use debounced invalidation for frequent events
		eventSource.addEventListener('queue:updated', () => {
			debouncedInvalidate();
		});

		eventSource.addEventListener('queue:stats', () => {
			debouncedInvalidate();
		});

		// Immediate invalidation for significant state changes
		eventSource.addEventListener('queue:added', () => {
			invalidateAll();
		});

		eventSource.addEventListener('queue:removed', () => {
			invalidateAll();
		});

		eventSource.addEventListener('queue:completed', () => {
			invalidateAll();
		});

		eventSource.addEventListener('queue:imported', () => {
			invalidateAll();
		});

		eventSource.addEventListener('queue:failed', () => {
			invalidateAll();
		});
	}

	onMount(() => {
		connectSSE();
	});

	onDestroy(() => {
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
		}
		if (invalidateTimeout) {
			clearTimeout(invalidateTimeout);
		}
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	});

	// Filter handling
	function updateFilters(key: string, value: string) {
		const url = new URL($page.url);
		if (value === 'all' || !value) {
			url.searchParams.delete(key);
		} else {
			url.searchParams.set(key, value);
		}
		goto(resolvePath(url.pathname + url.search), {
			replaceState: true,
			invalidateAll: true
		});
	}

	// Actions
	let actionInProgress = $state<string | null>(null);

	function handleAction(id: string) {
		return () => {
			actionInProgress = id;
			return async ({ update }: { update: () => Promise<void> }) => {
				await update();
				actionInProgress = null;
			};
		};
	}
</script>

<svelte:head>
	<title>Download Queue - Cinephage</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold">Download Queue</h1>
			<p class="mt-1 text-base-content/60">Monitor and manage your downloads</p>
		</div>
	</div>

	<!-- Stats -->
	<QueueStats stats={data.stats} />

	<!-- Tabs -->
	<div class="tabs-boxed tabs w-fit bg-base-200">
		<button
			class="tab gap-2"
			class:tab-active={activeTab === 'queue'}
			onclick={() => (activeTab = 'queue')}
		>
			<Download class="h-4 w-4" />
			Queue
			{#if data.stats.totalCount > 0}
				<span class="badge badge-sm">{data.stats.totalCount}</span>
			{/if}
		</button>
		<button
			class="tab gap-2"
			class:tab-active={activeTab === 'history'}
			onclick={() => (activeTab = 'history')}
		>
			<History class="h-4 w-4" />
			History
		</button>
	</div>

	<!-- Queue Tab -->
	{#if activeTab === 'queue'}
		<!-- Queue Filters -->
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				<Filter class="h-4 w-4 text-base-content/60" />
				<span class="text-sm text-base-content/60">Filters:</span>
			</div>

			<select
				class="select-bordered select select-sm"
				value={data.filters.status}
				onchange={(e) => updateFilters('status', e.currentTarget.value)}
			>
				<option value="all">All Statuses</option>
				<option value="queued">Queued</option>
				<option value="downloading">Downloading</option>
				<option value="seeding">Seeding</option>
				<option value="paused">Paused</option>
				<option value="completed">Completed</option>
				<option value="importing">Importing</option>
				<option value="failed">Failed</option>
			</select>

			<select
				class="select-bordered select select-sm"
				value={data.filters.mediaType}
				onchange={(e) => updateFilters('mediaType', e.currentTarget.value)}
			>
				<option value="all">All Media</option>
				<option value="movie">Movies</option>
				<option value="tv">TV Shows</option>
			</select>

			{#if data.clients.length > 0}
				<select
					class="select-bordered select select-sm"
					value={data.filters.clientId || 'all'}
					onchange={(e) => updateFilters('clientId', e.currentTarget.value)}
				>
					<option value="all">All Clients</option>
					{#each data.clients as client (client.id)}
						<option value={client.id}>{client.name}</option>
					{/each}
				</select>
			{/if}
		</div>

		<!-- Queue Table or Empty State -->
		{#if data.queueItems.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<div class="mb-4 rounded-full bg-base-200 p-4">
					<Inbox class="h-8 w-8 text-base-content/40" />
				</div>
				<h3 class="text-lg font-medium">No downloads in queue</h3>
				<p class="mt-1 max-w-sm text-base-content/60">
					{#if data.filters.status !== 'all' || data.filters.mediaType !== 'all'}
						No downloads match your current filters. Try adjusting or clearing the filters.
					{:else}
						When you add content to download, it will appear here. Head to Discover to find
						something to add.
					{/if}
				</p>
				{#if data.filters.status !== 'all' || data.filters.mediaType !== 'all'}
					<button class="btn mt-4 btn-ghost btn-sm" onclick={() => goto(resolve('/queue'))}>
						Clear Filters
					</button>
				{:else}
					<a href={resolve('/discover')} class="btn mt-4 btn-sm btn-primary">
						<Search class="h-4 w-4" />
						Discover Content
					</a>
				{/if}
			</div>
		{:else}
			<QueueTable items={data.queueItems} {actionInProgress} {handleAction} />
		{/if}
	{/if}

	<!-- History Tab -->
	{#if activeTab === 'history'}
		<!-- History Filters -->
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex items-center gap-2">
				<Filter class="h-4 w-4 text-base-content/60" />
				<span class="text-sm text-base-content/60">Filters:</span>
			</div>

			<select
				class="select-bordered select select-sm"
				value={data.filters.historyStatus}
				onchange={(e) => updateFilters('historyStatus', e.currentTarget.value)}
			>
				<option value="all">All Statuses</option>
				<option value="imported">Imported</option>
				<option value="streaming">Streaming</option>
				<option value="failed">Failed</option>
				<option value="rejected">Rejected</option>
				<option value="removed">Removed</option>
			</select>

			<select
				class="select-bordered select select-sm"
				value={data.filters.historyMediaType}
				onchange={(e) => updateFilters('historyMediaType', e.currentTarget.value)}
			>
				<option value="all">All Media</option>
				<option value="movie">Movies</option>
				<option value="tv">TV Shows</option>
			</select>
		</div>

		<!-- History Table or Empty State -->
		{#if data.historyItems.length === 0}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<div class="mb-4 rounded-full bg-base-200 p-4">
					<History class="h-8 w-8 text-base-content/40" />
				</div>
				<h3 class="text-lg font-medium">No download history</h3>
				<p class="mt-1 max-w-sm text-base-content/60">
					{#if data.filters.historyStatus !== 'all' || data.filters.historyMediaType !== 'all'}
						No history items match your current filters.
					{:else}
						Completed downloads will appear here once you start adding content.
					{/if}
				</p>
				{#if data.filters.historyStatus !== 'all' || data.filters.historyMediaType !== 'all'}
					<button class="btn mt-4 btn-ghost btn-sm" onclick={() => goto(resolve('/queue'))}>
						Clear Filters
					</button>
				{/if}
			</div>
		{:else}
			<HistoryTable items={data.historyItems} />
		{/if}
	{/if}
</div>
