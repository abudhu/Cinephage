<script lang="ts">
	import { X, Copy, Download, Check, FileText } from 'lucide-svelte';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { toasts } from '$lib/stores/toast.svelte';

	interface Props {
		open: boolean;
		baseUrl: string;
		onClose: () => void;
	}

	let { open, baseUrl, onClose }: Props = $props();

	// Copy state (shows checkmark briefly after copy)
	let copiedM3u = $state(false);
	let m3uInputEl = $state<HTMLInputElement | null>(null);

	const m3uUrl = $derived(`${baseUrl}/api/livetv/playlist.m3u`);

	async function handleCopyM3u() {
		const success = await copyToClipboard(m3uUrl);
		if (success) {
			copiedM3u = true;
			toasts.success('M3U URL copied to clipboard');
			setTimeout(() => {
				copiedM3u = false;
			}, 2000);
		} else {
			// Fallback: select the text so user can Ctrl+C
			if (m3uInputEl) {
				m3uInputEl.select();
				toasts.info('Text selected - press Ctrl+C to copy');
			} else {
				toasts.error('Failed to copy to clipboard');
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="modal-open modal">
		<div class="modal-box max-w-lg">
			<!-- Header -->
			<div class="mb-6 flex items-center justify-between">
				<h3 class="text-lg font-bold">Export Lineup</h3>
				<button class="btn btn-circle btn-ghost btn-sm" onclick={onClose}>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- M3U Section -->
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<FileText class="h-4 w-4 opacity-60" />
					<span class="font-medium">M3U Playlist</span>
				</div>

				<p class="text-sm opacity-60">
					Use this URL in VLC, Jellyfin, Plex, or any M3U-compatible player.
				</p>

				<!-- URL Display -->
				<div class="flex gap-2">
					<input
						bind:this={m3uInputEl}
						type="text"
						class="input-bordered input input-sm flex-1 font-mono text-xs"
						readonly
						value={m3uUrl}
					/>
					<button class="btn btn-square btn-sm" onclick={handleCopyM3u} title="Copy URL">
						{#if copiedM3u}
							<Check class="h-4 w-4 text-success" />
						{:else}
							<Copy class="h-4 w-4" />
						{/if}
					</button>
				</div>

				<!-- Download Button -->
				<a href={m3uUrl} download="playlist.m3u" class="btn gap-2 btn-outline btn-sm">
					<Download class="h-4 w-4" />
					Download M3U File
				</a>
			</div>

			<!-- Divider -->
			<div class="divider my-6"></div>

			<!-- EPG/XMLTV Section (Coming Soon) -->
			<div class="space-y-3 opacity-50">
				<div class="flex items-center gap-2">
					<FileText class="h-4 w-4" />
					<span class="font-medium">XML Guide (EPG)</span>
					<span class="badge badge-sm">Coming Soon</span>
				</div>

				<p class="text-sm">
					XMLTV guide export will be available in a future update for use with Jellyfin, Plex, and
					other EPG-compatible applications.
				</p>
			</div>

			<!-- Actions -->
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={onClose}>Close</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop cursor-default border-none bg-black/50"
			onclick={onClose}
			aria-label="Close modal"
		></button>
	</div>
{/if}
