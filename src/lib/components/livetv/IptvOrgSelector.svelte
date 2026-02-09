<script lang="ts">
	import { Search, X, Globe, Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface Country {
		code: string;
		name: string;
		flag: string;
	}

	interface Props {
		selectedCountries: string[];
		onChange: (countries: string[]) => void;
	}

	let { selectedCountries, onChange }: Props = $props();

	// Data state
	let countries = $state<Country[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Search state
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);

	// Filtered countries based on search
	const filteredCountries = $derived(
		searchQuery.trim()
			? countries.filter(
					(c) =>
						c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						c.code.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: countries
	);

	// Selected country objects for display
	const selectedCountryObjects = $derived(
		selectedCountries
			.map((code) => countries.find((c) => c.code === code))
			.filter(Boolean) as Country[]
	);

	onMount(async () => {
		try {
			const response = await fetch('/api/livetv/iptvorg/countries');
			const result = await response.json();

			if (!result.success) {
				throw new Error(result.error || 'Failed to load countries');
			}

			countries = result.countries;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load countries';
		} finally {
			loading = false;
		}
	});

	function toggleCountry(code: string) {
		if (selectedCountries.includes(code)) {
			onChange(selectedCountries.filter((c) => c !== code));
		} else {
			onChange([...selectedCountries, code]);
		}
	}

	function removeCountry(code: string) {
		onChange(selectedCountries.filter((c) => c !== code));
	}

	function clearAll() {
		onChange([]);
	}

	function handleDropdownClick(event: Event) {
		event.stopPropagation();
	}

	function handleDocumentClick() {
		isDropdownOpen = false;
	}

	// Close dropdown when clicking outside
	$effect(() => {
		if (isDropdownOpen) {
			document.addEventListener('click', handleDocumentClick);
			return () => document.removeEventListener('click', handleDocumentClick);
		}
	});
</script>

{#if loading}
	<div class="flex items-center gap-2 text-base-content/60">
		<Loader2 class="h-4 w-4 animate-spin" />
		<span class="text-sm">Loading countries...</span>
	</div>
{:else if error}
	<div class="alert-sm alert alert-error">
		<span class="text-sm">{error}</span>
	</div>
{:else}
	<div class="form-control">
		<label class="label py-1">
			<span class="label-text flex items-center gap-2">
				<Globe class="h-4 w-4" />
				Countries
				<span class="text-xs text-base-content/60">({countries.length} available)</span>
			</span>
		</label>

		<!-- Selected Countries Tags -->
		{#if selectedCountryObjects.length > 0}
			<div class="mb-2 flex flex-wrap gap-1">
				{#each selectedCountryObjects as country}
					<span class="badge gap-1 badge-sm badge-primary">
						<span>{country.flag}</span>
						<span>{country.name}</span>
						<button
							class="ml-1 hover:text-error"
							onclick={() => removeCountry(country.code)}
							type="button"
						>
							<X class="h-3 w-3" />
						</button>
					</span>
				{/each}
				{#if selectedCountryObjects.length > 1}
					<button class="btn btn-ghost btn-xs" onclick={clearAll} type="button"> Clear all </button>
				{/if}
			</div>
		{/if}

		<!-- Search Input -->
		<div class="dropdown w-full" class:dropdown-open={isDropdownOpen}>
			<div class="relative">
				<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-base-content/50" />
				<input
					type="text"
					class="input-bordered input input-sm w-full pl-9"
					placeholder="Search countries..."
					bind:value={searchQuery}
					onclick={() => (isDropdownOpen = true)}
					onfocus={() => (isDropdownOpen = true)}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							isDropdownOpen = false;
						}
					}}
				/>
				{#if searchQuery}
					<button
						class="absolute top-1/2 right-2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
						onclick={() => (searchQuery = '')}
						type="button"
					>
						<X class="h-4 w-4" />
					</button>
				{/if}
			</div>

			<!-- Dropdown Menu -->
			<div
				class="dropdown-content menu absolute z-50 mt-1 max-h-64 w-full flex-col overflow-y-auto menu-sm rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
				onclick={handleDropdownClick}
				role="listbox"
				tabindex="0"
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						isDropdownOpen = false;
					}
				}}
			>
				{#if filteredCountries.length === 0}
					<div class="px-3 py-2 text-sm text-base-content/60">No countries found</div>
				{:else}
					{#each filteredCountries.slice(0, 100) as country (country.code)}
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-base-200"
						>
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={selectedCountries.includes(country.code)}
								onchange={() => toggleCountry(country.code)}
							/>
							<span class="text-lg">{country.flag}</span>
							<span class="flex-1 text-sm">{country.name}</span>
							<span class="text-xs text-base-content/50">{country.code}</span>
						</label>
					{/each}
					{#if filteredCountries.length > 100}
						<div class="px-3 py-2 text-xs text-base-content/50">
							+{filteredCountries.length - 100} more countries
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<div class="label py-1">
			<span class="label-text-alt text-xs">
				{selectedCountries.length === 0
					? 'Select one or more countries to import channels'
					: `${selectedCountries.length} countr${selectedCountries.length === 1 ? 'y' : 'ies'} selected`}
			</span>
		</div>
	</div>
{/if}
