<script lang="ts">
	import { X, Loader2, Plus } from 'lucide-svelte';
	import type { ChannelCategory } from '$lib/types/livetv';

	interface Props {
		open: boolean;
		channelCount: number;
		categories: ChannelCategory[];
		saving: boolean;
		onClose: () => void;
		onConfirm: (categoryId: string | null) => void;
	}

	let { open, channelCount, categories, saving, onClose, onConfirm }: Props = $props();

	let selectedCategoryId = $state<string | null>(null);

	// Reset when modal opens
	$effect(() => {
		if (open) {
			selectedCategoryId = null;
		}
	});

	function handleConfirm() {
		onConfirm(selectedCategoryId);
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
		<div class="modal-box max-w-md">
			<!-- Header -->
			<div class="mb-6 flex items-center justify-between">
				<h3 class="text-xl font-bold">Add to Lineup</h3>
				<button class="btn btn-circle btn-ghost btn-sm" onclick={onClose}>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Content -->
			<div class="space-y-4">
				<p class="text-base-content/70">
					Adding <span class="font-semibold">{channelCount}</span>
					channel{channelCount !== 1 ? 's' : ''} to your lineup.
				</p>

				<div class="form-control">
					<label class="label py-1" for="categorySelect">
						<span class="label-text">Assign to Category (optional)</span>
					</label>
					<select
						id="categorySelect"
						class="select-bordered select select-sm"
						bind:value={selectedCategoryId}
					>
						<option value={null}>No category</option>
						{#each categories as category (category.id)}
							<option value={category.id}>
								{category.name}
							</option>
						{/each}
					</select>
					<label class="label py-1">
						<span class="label-text-alt text-base-content/50">
							You can change this later for individual channels
						</span>
					</label>
				</div>

				{#if categories.length === 0}
					<div class="rounded-box bg-base-200 p-3 text-sm text-base-content/70">
						No categories yet. You can create categories in the lineup view to organize your
						channels.
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="modal-action">
				<button class="btn btn-ghost btn-sm" onclick={onClose} disabled={saving}>Cancel</button>

				<button class="btn btn-sm btn-primary" onclick={handleConfirm} disabled={saving}>
					{#if saving}
						<Loader2 class="h-4 w-4 animate-spin" />
						Adding...
					{:else}
						<Plus class="h-4 w-4" />
						Add {channelCount} Channel{channelCount !== 1 ? 's' : ''}
					{/if}
				</button>
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
