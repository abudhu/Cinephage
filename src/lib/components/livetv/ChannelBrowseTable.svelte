<script lang="ts">
	import { Tv, Check, Radio } from 'lucide-svelte';
	import type { StalkerChannelWithAccount, ChannelCategory } from '$lib/types/livetv';

	interface Props {
		channels: StalkerChannelWithAccount[];
		selectedKeys: Set<string>;
		lineupKeys: Set<string>;
		categories: ChannelCategory[];
		categorySelections: Map<string, string | null>;
		selectable?: boolean;
		onToggleSelect: (key: string) => void;
		onSelectAll: () => void;
		onClearSelection: () => void;
		onCategoryChange: (key: string, categoryId: string | null) => void;
	}

	let {
		channels,
		selectedKeys,
		lineupKeys,
		categories,
		categorySelections,
		selectable = true,
		onToggleSelect,
		onSelectAll,
		onClearSelection,
		onCategoryChange
	}: Props = $props();

	// Virtual scrolling configuration
	const ROW_HEIGHT = 56; // Fixed height for each row (logo + padding)
	const OVERSCAN = 5; // Extra rows to render above/below viewport

	// Scroll state
	let scrollTop = $state(0);
	let containerHeight = $state(600); // Will be updated dynamically
	let containerRef: HTMLDivElement | undefined = $state();

	// Update container height on mount and resize
	$effect(() => {
		if (!containerRef) return;

		const updateHeight = () => {
			containerHeight = containerRef?.clientHeight || 600;
		};

		updateHeight();

		const observer = new ResizeObserver(updateHeight);
		observer.observe(containerRef);

		return () => observer.disconnect();
	});

	// Virtual scrolling calculations
	const totalHeight = $derived(channels.length * ROW_HEIGHT);
	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
	const endIndex = $derived(
		Math.min(channels.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
	);
	const visibleChannels = $derived(channels.slice(startIndex, endIndex));
	const offsetY = $derived(startIndex * ROW_HEIGHT);

	function handleScroll(e: Event) {
		scrollTop = (e.target as HTMLDivElement).scrollTop;
	}

	// Get unique accounts for color badges
	const accountColors = $derived(() => {
		const colors = [
			'bg-primary text-primary-content',
			'bg-secondary text-secondary-content',
			'bg-accent text-accent-content',
			'bg-info text-info-content',
			'bg-warning text-warning-content'
		];
		const accounts = [...new Set(channels.map((c) => c.accountId))];
		return new Map(accounts.map((id, idx) => [id, colors[idx % colors.length]]));
	});

	function getChannelKey(channel: StalkerChannelWithAccount): string {
		return `${channel.accountId}:${channel.id}`;
	}

	function isInLineup(channel: StalkerChannelWithAccount): boolean {
		return lineupKeys.has(getChannelKey(channel));
	}

	// Filter out channels already in lineup for select all
	const selectableChannels = $derived(channels.filter((c) => !isInLineup(c)));
	const allSelected = $derived(
		selectableChannels.length > 0 && selectedKeys.size === selectableChannels.length
	);
	const someSelected = $derived(
		selectedKeys.size > 0 && selectedKeys.size < selectableChannels.length
	);
</script>

{#if channels.length === 0}
	<div class="py-12 text-center text-base-content/60">
		<Radio class="mx-auto mb-4 h-12 w-12 opacity-40" />
		<p class="text-lg font-medium">No channels found</p>
		<p class="mt-1 text-sm">Try adjusting your filters or add an IPTV account</p>
	</div>
{:else}
	{#if selectable}
		<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
			<div class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={allSelected}
					indeterminate={someSelected}
					onchange={() => (allSelected ? onClearSelection() : onSelectAll())}
					disabled={selectableChannels.length === 0}
				/>
				<span class="text-sm text-base-content/70">
					{selectedKeys.size > 0 ? `${selectedKeys.size} selected` : `${channels.length} channels`}
					{#if lineupKeys.size > 0}
						<span class="text-base-content/50">
							({channels.filter((c) => isInLineup(c)).length} in lineup)
						</span>
					{/if}
				</span>
			</div>
		</div>
	{/if}

	<!-- Virtual scrolling container - fills available space -->
	<div
		class="overflow-x-hidden overflow-y-auto"
		style="height: calc(100vh - 220px); min-height: 400px;"
		bind:this={containerRef}
		onscroll={handleScroll}
	>
		<table class="table w-full table-fixed">
			<thead class="sticky top-0 z-10 bg-base-100">
				<tr>
					{#if selectable}
						<th class="w-12"></th>
					{/if}
					<th class="w-16">#</th>
					<th class="w-[40%]">Channel</th>
					<th class="w-[20%]">Category</th>
					<th class="w-[15%]">Account</th>
					<th class="w-[15%]">Features</th>
				</tr>
			</thead>
			<tbody>
				<!-- Top spacer -->
				{#if offsetY > 0}
					<tr aria-hidden="true">
						<td colspan={selectable ? 6 : 5} class="p-0" style="height: {offsetY}px;"></td>
					</tr>
				{/if}

				<!-- Visible rows only -->
				{#each visibleChannels as channel (channel.accountId + ':' + channel.id)}
					{@const key = getChannelKey(channel)}
					{@const inLineup = isInLineup(channel)}
					<tr class="hover {inLineup ? 'opacity-50' : ''}" style="height: {ROW_HEIGHT}px;">
						{#if selectable}
							<td class="py-2">
								{#if inLineup}
									<div class="tooltip" data-tip="Already in lineup">
										<Check class="h-4 w-4 text-success" />
									</div>
								{:else}
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={selectedKeys.has(key)}
										onchange={() => onToggleSelect(key)}
									/>
								{/if}
							</td>
						{/if}
						<td class="py-2">
							<span class="font-mono text-sm opacity-70">{channel.number}</span>
						</td>
						<td class="overflow-hidden py-2">
							<div class="flex items-center gap-3">
								{#if channel.logo}
									<div class="avatar">
										<div class="h-10 w-10 rounded bg-base-100">
											<img
												src={channel.logo}
												alt={channel.name}
												class="object-contain"
												loading="lazy"
												onerror={(e) => {
													const target = e.target as HTMLImageElement;
													target.style.display = 'none';
												}}
											/>
										</div>
									</div>
								{:else}
									<div class="placeholder avatar">
										<div class="flex h-10 w-10 items-center justify-center rounded bg-base-300">
											<Tv class="h-5 w-5 opacity-40" />
										</div>
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">{channel.name}</div>
									{#if channel.xmltvId}
										<div class="truncate text-xs opacity-50">{channel.xmltvId}</div>
									{/if}
								</div>
							</div>
						</td>
						<td class="overflow-hidden py-2">
							{#if inLineup}
								<span class="badge max-w-full truncate badge-ghost badge-sm"
									>{channel.categoryName}</span
								>
							{:else}
								<select
									class="select w-full max-w-[140px] bg-base-200 select-xs"
									value={categorySelections.get(key) ?? ''}
									onchange={(e) => {
										const val = e.currentTarget.value;
										onCategoryChange(key, val === '' ? null : val);
									}}
								>
									<option value="">No category</option>
									{#each categories as cat (cat.id)}
										<option value={cat.id}>{cat.name}</option>
									{/each}
								</select>
							{/if}
						</td>
						<td class="overflow-hidden py-2">
							<span
								class="badge max-w-full truncate badge-sm {accountColors().get(channel.accountId)}"
							>
								{channel.accountName}
							</span>
						</td>
						<td class="overflow-hidden py-2">
							<div class="flex flex-wrap gap-1">
								{#if channel.archive}
									<span class="badge badge-outline badge-sm" title="Has archive/catchup">
										{channel.archiveDays > 0 ? `${channel.archiveDays}d` : 'Archive'}
									</span>
								{/if}
								{#if inLineup}
									<span class="badge badge-sm badge-success">In Lineup</span>
								{/if}
							</div>
						</td>
					</tr>
				{/each}

				<!-- Bottom spacer -->
				{#if totalHeight - offsetY - visibleChannels.length * ROW_HEIGHT > 0}
					<tr aria-hidden="true">
						<td
							colspan={selectable ? 6 : 5}
							class="p-0"
							style="height: {totalHeight - offsetY - visibleChannels.length * ROW_HEIGHT}px;"
						></td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
{/if}
