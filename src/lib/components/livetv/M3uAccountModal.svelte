<script lang="ts">
	import {
		X,
		Loader2,
		XCircle,
		CheckCircle2,
		List,
		Link,
		FileText,
		Globe,
		Radio
	} from 'lucide-svelte';
	import ModalWrapper from '$lib/components/ui/modal/ModalWrapper.svelte';
	import IptvOrgSelector from './IptvOrgSelector.svelte';
	import type { LiveTvAccount, LiveTvAccountTestResult } from '$lib/types/livetv';

	interface M3uAccountFormData {
		name: string;
		url: string;
		fileContent: string;
		epgUrl: string;
		autoRefresh: boolean;
		enabled: boolean;
	}

	interface IptvOrgFormData {
		name: string;
		countries: string[];
		enabled: boolean;
	}

	interface Props {
		open: boolean;
		mode: 'add' | 'edit';
		account?: LiveTvAccount | null;
		saving: boolean;
		error?: string | null;
		onClose: () => void;
		onSave: (data: M3uAccountFormData) => void;
		onSaveIptvOrg?: (data: IptvOrgFormData) => void;
		onDelete?: () => void;
		onTest: (data: { url?: string; fileContent?: string }) => Promise<LiveTvAccountTestResult>;
		onTestIptvOrg?: (data: { countries: string[] }) => Promise<LiveTvAccountTestResult>;
	}

	let {
		open,
		mode,
		account = null,
		saving,
		error = null,
		onClose,
		onSave,
		onSaveIptvOrg,
		onDelete,
		onTest,
		onTestIptvOrg
	}: Props = $props();

	// Input mode: 'url', 'file', or 'freeiptv'
	let inputMode = $state<'url' | 'file' | 'freeiptv'>('url');

	// M3U Form state
	let name = $state('');
	let url = $state('');
	let fileContent = $state('');
	let epgUrl = $state('');
	let autoRefresh = $state(false);
	let enabled = $state(true);

	// IPTV-Org Form state
	let selectedCountries = $state<string[]>([]);

	// UI state
	let testing = $state(false);
	let testResult = $state<LiveTvAccountTestResult | null>(null);
	let fileName = $state('');

	// Derived
	const isIptvOrgAccount = $derived(account?.providerType === 'iptvorg');
	const modalTitle = $derived(() => {
		if (mode === 'edit' && account) {
			if (isIptvOrgAccount) return 'Edit Free IPTV';
			return 'Edit M3U Playlist';
		}
		if (inputMode === 'freeiptv') return 'Add Free IPTV';
		return 'Add M3U Playlist';
	});

	const modalIcon = $derived(() => {
		if (inputMode === 'freeiptv' || isIptvOrgAccount) return Globe;
		return List;
	});

	// Validation for M3U mode
	const isUrlValid = $derived(() => {
		if (inputMode !== 'url') return true;
		if (!url.trim()) return false;
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	});

	const isEpgUrlValid = $derived(() => {
		if (!epgUrl.trim()) return true; // Optional
		try {
			new URL(epgUrl);
			return true;
		} catch {
			return false;
		}
	});

	// Validation for all modes
	const canSubmit = $derived(() => {
		if (name.trim().length === 0) return false;

		if (inputMode === 'freeiptv') {
			return selectedCountries.length > 0;
		}

		if (inputMode === 'url') {
			return isUrlValid() && isEpgUrlValid();
		} else {
			return fileContent.length > 0 && isEpgUrlValid();
		}
	});

	// Reset form when modal opens or account changes
	$effect(() => {
		if (open) {
			name = account?.name ?? '';
			enabled = account?.enabled ?? true;
			testResult = null;
			testing = false;

			if (isIptvOrgAccount && account) {
				// Editing IPTV-Org account
				inputMode = 'freeiptv';
				selectedCountries = account.iptvOrgConfig?.countries ?? [];
				// Clear M3U fields
				url = '';
				fileContent = '';
				epgUrl = '';
				autoRefresh = false;
				fileName = '';
			} else if (account?.m3uConfig) {
				// Editing M3U account
				url = account.m3uConfig.url ?? '';
				fileContent = account.m3uConfig.fileContent ?? '';
				epgUrl = account.m3uConfig.epgUrl ?? '';
				autoRefresh = account.m3uConfig.autoRefresh ?? false;
				inputMode = url ? 'url' : 'file';
				fileName = '';
				selectedCountries = [];
			} else {
				// Adding new account - default to URL mode
				inputMode = 'url';
				url = '';
				fileContent = '';
				epgUrl = '';
				autoRefresh = false;
				fileName = '';
				selectedCountries = [];
			}
		}
	});

	function getM3uFormData(): M3uAccountFormData {
		return {
			name: name.trim(),
			url: inputMode === 'url' ? url.trim() : '',
			fileContent: inputMode === 'file' ? fileContent : '',
			epgUrl: epgUrl.trim(),
			autoRefresh,
			enabled
		};
	}

	function getIptvOrgFormData(): IptvOrgFormData {
		return {
			name: name.trim(),
			countries: selectedCountries,
			enabled
		};
	}

	async function handleTest() {
		if (!canSubmit()) return;

		if (inputMode === 'freeiptv') {
			if (!onTestIptvOrg) return;
			testing = true;
			testResult = null;
			try {
				testResult = await onTestIptvOrg({ countries: selectedCountries });
			} finally {
				testing = false;
			}
		} else {
			testing = true;
			testResult = null;
			try {
				testResult = await onTest({
					url: inputMode === 'url' ? url.trim() : undefined,
					fileContent: inputMode === 'file' ? fileContent : undefined
				});
			} finally {
				testing = false;
			}
		}
	}

	function handleSave() {
		if (!canSubmit()) return;

		if (inputMode === 'freeiptv') {
			if (onSaveIptvOrg) {
				onSaveIptvOrg(getIptvOrgFormData());
			}
		} else {
			onSave(getM3uFormData());
		}
	}

	function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];

		if (file) {
			fileName = file.name;
			const reader = new FileReader();
			reader.onload = (e) => {
				fileContent = e.target?.result as string;
			};
			reader.readAsText(file);
		}
	}

	function setInputMode(mode: 'url' | 'file' | 'freeiptv') {
		inputMode = mode;
		testResult = null;

		if (mode === 'url') {
			fileContent = '';
			fileName = '';
			selectedCountries = [];
		} else if (mode === 'file') {
			url = '';
			selectedCountries = [];
		} else {
			// freeiptv
			url = '';
			fileContent = '';
			fileName = '';
			epgUrl = '';
			autoRefresh = false;
		}
	}
</script>

<ModalWrapper {open} {onClose} maxWidth="lg" labelledBy="m3u-account-modal-title">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
				{#if inputMode === 'freeiptv' || isIptvOrgAccount}
					<Globe class="h-5 w-5 text-primary" />
				{:else}
					<List class="h-5 w-5 text-primary" />
				{/if}
			</div>
			<h3 id="m3u-account-modal-title" class="text-xl font-bold">{modalTitle()}</h3>
		</div>
		<button class="btn btn-circle btn-ghost btn-sm" onclick={onClose}>
			<X class="h-4 w-4" />
		</button>
	</div>

	<!-- Form -->
	<div class="space-y-4">
		<!-- Name -->
		<div class="form-control">
			<label class="label py-1" for="name">
				<span class="label-text">Name</span>
			</label>
			<input
				id="name"
				type="text"
				class="input-bordered input input-sm"
				bind:value={name}
				placeholder={inputMode === 'freeiptv' ? 'My Free IPTV Channels' : 'My M3U Playlist'}
			/>
			<div class="label py-1">
				<span class="label-text-alt text-xs">A friendly name for this collection</span>
			</div>
		</div>

		<!-- Input Mode Tabs (only show when adding new accounts) -->
		{#if mode === 'add' || !isIptvOrgAccount}
			<div class="tabs-boxed tabs">
				<button
					class="tab {inputMode === 'url' ? 'tab-active' : ''}"
					onclick={() => setInputMode('url')}
					disabled={isIptvOrgAccount}
				>
					<Link class="mr-2 inline h-4 w-4" />
					URL
				</button>
				<button
					class="tab {inputMode === 'file' ? 'tab-active' : ''}"
					onclick={() => setInputMode('file')}
					disabled={isIptvOrgAccount}
				>
					<FileText class="mr-2 inline h-4 w-4" />
					File Upload
				</button>
				<button
					class="tab {inputMode === 'freeiptv' ? 'tab-active' : ''}"
					onclick={() => setInputMode('freeiptv')}
				>
					<Radio class="mr-2 inline h-4 w-4" />
					Free IPTV
				</button>
			</div>
		{/if}

		{#if inputMode === 'url'}
			<!-- M3U URL -->
			<div class="form-control">
				<label class="label py-1" for="m3uUrl">
					<span class="label-text">M3U Playlist URL</span>
				</label>
				<div class="relative">
					<input
						id="m3uUrl"
						type="url"
						class="input-bordered input input-sm w-full pr-8"
						class:input-error={url.length > 0 && !isUrlValid()}
						bind:value={url}
						placeholder="http://example.com/playlist.m3u"
					/>
					{#if url.length > 0}
						<div class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
							{#if isUrlValid()}
								<CheckCircle2 class="h-4 w-4 text-success" />
							{:else}
								<XCircle class="h-4 w-4 text-error" />
							{/if}
						</div>
					{/if}
				</div>
				<div class="label py-1">
					<span class="label-text-alt text-xs">Direct link to M3U playlist file</span>
				</div>
			</div>
		{:else if inputMode === 'file'}
			<!-- File Upload -->
			<div class="form-control">
				<label class="label py-1" for="m3uFile">
					<span class="label-text">Upload M3U File</span>
				</label>
				<div class="flex gap-2">
					<input
						id="m3uFile"
						type="file"
						accept=".m3u,.m3u8"
						class="file-input-bordered file-input flex-1 file-input-sm"
						onchange={handleFileUpload}
					/>
				</div>
				{#if fileName}
					<div class="label py-1">
						<span class="label-text-alt text-xs text-success">✓ Loaded: {fileName}</span>
					</div>
				{:else}
					<div class="label py-1">
						<span class="label-text-alt text-xs">Select an M3U or M3U8 file from your computer</span
						>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Free IPTV / IPTV-Org Selector -->
			<IptvOrgSelector
				{selectedCountries}
				onChange={(countries) => (selectedCountries = countries)}
			/>
		{/if}

		{#if inputMode === 'url'}
			<!-- EPG URL (only for URL mode) -->
			<div class="form-control">
				<label class="label py-1" for="epgUrl">
					<span class="label-text">EPG URL (Optional)</span>
				</label>
				<div class="relative">
					<input
						id="epgUrl"
						type="url"
						class="input-bordered input input-sm w-full pr-8"
						class:input-error={epgUrl.length > 0 && !isEpgUrlValid()}
						bind:value={epgUrl}
						placeholder="http://example.com/epg.xml"
					/>
					{#if epgUrl.length > 0}
						<div class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
							{#if isEpgUrlValid()}
								<CheckCircle2 class="h-4 w-4 text-success" />
							{:else}
								<XCircle class="h-4 w-4 text-error" />
							{/if}
						</div>
					{/if}
				</div>
				<div class="label py-1">
					<span class="label-text-alt text-xs">
						XMLTV EPG URL for program guide data (optional)
					</span>
				</div>
			</div>

			<!-- Auto Refresh -->
			<label class="label cursor-pointer gap-2">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={autoRefresh} />
				<span class="label-text">Auto-refresh playlist</span>
			</label>
		{/if}

		<!-- Enabled -->
		<label class="label cursor-pointer gap-2">
			<input type="checkbox" class="checkbox checkbox-sm" bind:checked={enabled} />
			<span class="label-text">Enabled</span>
		</label>
	</div>

	<!-- Save Error -->
	{#if error}
		<div class="mt-6 alert alert-error">
			<XCircle class="h-5 w-5" />
			<div>
				<div class="font-medium">Failed to save</div>
				<div class="text-sm opacity-80">{error}</div>
			</div>
		</div>
	{/if}

	<!-- Test Result -->
	{#if testResult}
		<div class="mt-6">
			{#if testResult.success && testResult.profile}
				<div class="alert alert-success">
					<CheckCircle2 class="h-5 w-5" />
					<div class="flex-1">
						<div class="font-medium">
							{inputMode === 'freeiptv' ? 'Channels found' : 'Playlist parsed successfully'}
						</div>
						<div class="mt-2 grid grid-cols-2 gap-2 text-sm opacity-80">
							<div>Channels: {testResult.profile.channelCount.toLocaleString()}</div>
							<div>Categories: {testResult.profile.categoryCount}</div>
						</div>
					</div>
				</div>
			{:else}
				<div class="alert alert-error">
					<XCircle class="h-5 w-5" />
					<div>
						<div class="font-medium">
							{inputMode === 'freeiptv' ? 'No channels found' : 'Failed to parse playlist'}
						</div>
						<div class="text-sm opacity-80">{testResult.error || 'Unknown error'}</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Actions -->
	<div class="modal-action">
		{#if mode === 'edit' && onDelete}
			<button class="btn mr-auto btn-outline btn-error" onclick={onDelete}>Delete</button>
		{/if}

		<button class="btn btn-ghost" onclick={handleTest} disabled={testing || saving || !canSubmit()}>
			{#if testing}
				<Loader2 class="h-4 w-4 animate-spin" />
			{/if}
			Test
		</button>

		<button class="btn btn-ghost" onclick={onClose}>Cancel</button>

		<button class="btn btn-primary" onclick={handleSave} disabled={saving || !canSubmit()}>
			{#if saving}
				<Loader2 class="h-4 w-4 animate-spin" />
			{/if}
			Save
		</button>
	</div>
</ModalWrapper>
