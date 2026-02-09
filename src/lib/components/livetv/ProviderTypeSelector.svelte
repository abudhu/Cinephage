<script lang="ts">
	import { Tv, Radio, List, Globe } from 'lucide-svelte';
	import type { LiveTvProviderType } from '$lib/types/livetv';

	interface Props {
		selected: LiveTvProviderType;
		onSelect: (type: LiveTvProviderType) => void;
	}

	let { selected, onSelect }: Props = $props();

	const providers: Array<{
		type: LiveTvProviderType;
		label: string;
		description: string;
		icon: typeof Tv;
	}> = [
		{
			type: 'stalker',
			label: 'Stalker Portal',
			description: 'MAG/Ministra portals using MAC address',
			icon: Tv
		},
		{
			type: 'xstream',
			label: 'XStream Codes',
			description: 'Username/password IPTV API',
			icon: Radio
		},
		{
			type: 'm3u',
			label: 'M3U Playlist',
			description: 'Playlist file, URL, or Free IPTV from iptv-org.github.io',
			icon: List
		}
	];
</script>

<div class="tabs-boxed tabs w-full">
	{#each providers as provider}
		<button
			class="tab flex-1 gap-2 {selected === provider.type ? 'tab-active' : ''}"
			onclick={() => onSelect(provider.type)}
			title={provider.description}
		>
			<provider.icon class="h-4 w-4" />
			<span class="hidden sm:inline">{provider.label}</span>
			<span class="sm:hidden">{provider.label.split(' ')[0]}</span>
		</button>
	{/each}
</div>
