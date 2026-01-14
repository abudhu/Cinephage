<script lang="ts">
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { onMount, onDestroy } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolvePath } from '$lib/utils/routing';
	import ActivityTable from '$lib/components/activity/ActivityTable.svelte';
	import type { UnifiedActivity } from '$lib/types/activity';
	import { Activity, Search, RefreshCw, Loader2 } from 'lucide-svelte';

	let { data } = $props();

	// Local state for activities (for SSE updates)
	let activities = $state<UnifiedActivity[]>(data.activities);
	let total = $state(data.total);

	// Filter state
	let statusFilter = $state(data.filters.status || 'all');
	let mediaTypeFilter = $state(data.filters.mediaType || 'all');
	let searchQuery = $state(data.filters.search || '');

	// Sort state
	let sortField = $state('time');
	let sortDirection = $state<'asc' | 'desc'>('desc');

	// Loading states
	let isLoading = $state(false);
	let isLoadingMore = $state(false);

	// SSE connection
	let eventSource: EventSource | null = null;

	// Update activities when data changes (navigation)
	$effect(() => {
		activities = data.activities;
		total = data.total;
	});

	// Set up SSE connection
	onMount(() => {
		connectSSE();
	});

	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
		}
	});

	function connectSSE() {
		eventSource = new EventSource(resolvePath('/api/activity/stream'));

		eventSource.addEventListener('activity:new', (event) => {
			const newActivity = JSON.parse(event.data) as UnifiedActivity;
			// Add to beginning of list
			activities = [newActivity, ...activities.filter((a) => a.id !== newActivity.id)];
			total += 1;
		});

		eventSource.addEventListener('activity:updated', (event) => {
			const updated = JSON.parse(event.data) as Partial<UnifiedActivity>;
			activities = activities.map((a) => (a.id === updated.id ? { ...a, ...updated } : a));
		});

		eventSource.addEventListener('activity:progress', (event) => {
			const { id, progress, status } = JSON.parse(event.data);
			activities = activities.map((a) =>
				a.id === id ? { ...a, downloadProgress: progress, status: status || a.status } : a
			);
		});

		eventSource.onerror = () => {
			// Try to reconnect after a delay
			setTimeout(() => {
				if (eventSource) {
					eventSource.close();
				}
				connectSSE();
			}, 5000);
		};
	}

	// Apply filters via URL navigation
	async function applyFilters() {
		isLoading = true;
		const params = new SvelteURLSearchParams();
		if (statusFilter !== 'all') params.set('status', statusFilter);
		if (mediaTypeFilter !== 'all') params.set('mediaType', mediaTypeFilter);
		if (searchQuery) params.set('search', searchQuery);

		const queryString = params.toString();
		await goto(resolvePath(`/activity${queryString ? `?${queryString}` : ''}`), {
			keepFocus: true
		});
		isLoading = false;
	}

	// Handle search input
	let searchTimeout: ReturnType<typeof setTimeout>;
	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			applyFilters();
		}, 300);
	}

	// Handle sort
	function handleSort(field: string) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = 'desc';
		}

		// Sort locally
		activities = [...activities].sort((a, b) => {
			let aVal: string | number | null = null;
			let bVal: string | number | null = null;

			switch (field) {
				case 'time':
					aVal = a.startedAt;
					bVal = b.startedAt;
					break;
				case 'media':
					aVal = a.mediaTitle.toLowerCase();
					bVal = b.mediaTitle.toLowerCase();
					break;
				case 'size':
					aVal = a.size || 0;
					bVal = b.size || 0;
					break;
				case 'status':
					aVal = a.status;
					bVal = b.status;
					break;
				case 'release':
					aVal = a.releaseTitle?.toLowerCase() || '';
					bVal = b.releaseTitle?.toLowerCase() || '';
					break;
			}

			if (aVal === null || bVal === null) return 0;
			if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
			if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
			return 0;
		});
	}

	// Load more
	async function loadMore() {
		if (isLoadingMore || !data.hasMore) return;
		isLoadingMore = true;

		try {
			const apiUrl = new URL('/api/activity', window.location.origin);
			apiUrl.searchParams.set('limit', '50');
			apiUrl.searchParams.set('offset', String(activities.length));
			if (statusFilter !== 'all') apiUrl.searchParams.set('status', statusFilter);
			if (mediaTypeFilter !== 'all') apiUrl.searchParams.set('mediaType', mediaTypeFilter);
			if (searchQuery) apiUrl.searchParams.set('search', searchQuery);

			const response = await fetch(apiUrl.toString());
			const result = await response.json();

			if (result.success && result.activities) {
				activities = [...activities, ...result.activities];
			}
		} catch (error) {
			console.error('Failed to load more:', error);
		} finally {
			isLoadingMore = false;
		}
	}

	// Refresh data
	async function refresh() {
		isLoading = true;
		await invalidateAll();
		isLoading = false;
	}
</script>

<svelte:head>
	<title>Activity - Cinephage</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="flex items-center gap-2 text-3xl font-bold">
				<Activity class="h-8 w-8" />
				Activity
			</h1>
			<p class="text-base-content/70">Download and search history</p>
		</div>
		<button class="btn btn-ghost btn-sm" onclick={refresh} disabled={isLoading}>
			<RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
			Refresh
		</button>
	</div>

	<!-- Filters -->
	<div class="card bg-base-200">
		<div class="card-body p-4">
			<div class="flex flex-wrap items-center gap-4">
				<!-- Media Type Filter -->
				<div class="form-control">
					<label class="label py-0">
						<span class="label-text text-xs">Media Type</span>
					</label>
					<select
						class="select-bordered select select-sm"
						bind:value={mediaTypeFilter}
						onchange={applyFilters}
					>
						<option value="all">All</option>
						<option value="movie">Movies</option>
						<option value="tv">TV Shows</option>
					</select>
				</div>

				<!-- Status Filter -->
				<div class="form-control">
					<label class="label py-0">
						<span class="label-text text-xs">Status</span>
					</label>
					<select
						class="select-bordered select select-sm"
						bind:value={statusFilter}
						onchange={applyFilters}
					>
						<option value="all">All</option>
						<option value="success">Success</option>
						<option value="downloading">Downloading</option>
						<option value="failed">Failed</option>
						<option value="rejected">Rejected</option>
						<option value="no_results">No Results</option>
					</select>
				</div>

				<!-- Search -->
				<div class="form-control flex-1">
					<label class="label py-0">
						<span class="label-text text-xs">Search</span>
					</label>
					<div class="relative">
						<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-base-content/50" />
						<input
							type="text"
							placeholder="Search media or release..."
							class="input-bordered input input-sm w-full pl-9"
							bind:value={searchQuery}
							oninput={handleSearchInput}
						/>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Activity Stats -->
	<div class="flex items-center gap-4 text-sm text-base-content/70">
		<span>{total} activities</span>
		{#if activities.some((a) => a.status === 'downloading')}
			<span class="badge gap-1 badge-info">
				<Loader2 class="h-3 w-3 animate-spin" />
				{activities.filter((a) => a.status === 'downloading').length} downloading
			</span>
		{/if}
	</div>

	<!-- Activity Table -->
	{#if isLoading && activities.length === 0}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="h-8 w-8 animate-spin" />
		</div>
	{:else}
		<ActivityTable {activities} {sortField} {sortDirection} onSort={handleSort} />

		<!-- Load More -->
		{#if data.hasMore}
			<div class="flex justify-center py-4">
				<button class="btn btn-ghost" onclick={loadMore} disabled={isLoadingMore}>
					{#if isLoadingMore}
						<Loader2 class="h-4 w-4 animate-spin" />
					{/if}
					Load More
				</button>
			</div>
		{/if}
	{/if}
</div>
