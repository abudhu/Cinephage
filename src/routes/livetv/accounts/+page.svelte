<script lang="ts">
	import { Plus, RefreshCw, Loader2, Search } from 'lucide-svelte';
	import {
		LiveTvAccountTable,
		StalkerAccountModal,
		XstreamAccountModal,
		M3uAccountModal,
		ProviderTypeSelector,
		PortalScanModal,
		PortalScanProgress,
		ScanResultsTable
	} from '$lib/components/livetv';
	import type {
		LiveTvAccount,
		LiveTvAccountTestResult,
		LiveTvProviderType
	} from '$lib/types/livetv';
	import { onMount } from 'svelte';

	// State
	let accounts = $state<LiveTvAccount[]>([]);
	let loading = $state(true);
	let refreshing = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Provider type selector state
	let selectedProviderType = $state<LiveTvProviderType>('stalker');
	let showProviderSelector = $state(false);

	// Modal state
	let modalOpen = $state(false);
	let modalMode = $state<'add' | 'edit'>('add');
	let editingAccount = $state<LiveTvAccount | null>(null);
	let modalError = $state<string | null>(null);

	// Testing state
	let testingId = $state<string | null>(null);

	// Determine modal type based on selected provider or editing account
	const effectiveProviderType = $derived.by(() => {
		if (editingAccount) {
			return editingAccount.providerType;
		}
		return selectedProviderType;
	});

	// Syncing state
	let syncingId = $state<string | null>(null);

	// Scanner state
	type ScannerView = 'none' | 'modal' | 'progress' | 'results';
	let scannerView = $state<ScannerView>('none');
	let activeWorkerId = $state<string | null>(null);
	let activePortalId = $state<string | null>(null);

	// Load accounts on mount
	onMount(() => {
		loadAccounts();
	});

	async function loadAccounts() {
		loading = true;
		error = null;

		try {
			const response = await fetch('/api/livetv/accounts');
			if (!response.ok) {
				throw new Error('Failed to load accounts');
			}
			accounts = await response.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load accounts';
		} finally {
			loading = false;
		}
	}

	async function refreshAccounts() {
		refreshing = true;
		await loadAccounts();
		refreshing = false;
	}

	function openAddModal() {
		modalMode = 'add';
		editingAccount = null;
		modalError = null;
		selectedProviderType = 'stalker'; // Default to stalker
		showProviderSelector = true;
		modalOpen = true;
	}

	function openEditModal(account: LiveTvAccount) {
		modalMode = 'edit';
		editingAccount = account;
		modalError = null;
		selectedProviderType = account.providerType;
		showProviderSelector = false; // Don't show selector when editing
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		editingAccount = null;
		modalError = null;
		showProviderSelector = false;
	}

	async function handleSaveStalker(data: {
		name: string;
		portalUrl: string;
		macAddress: string;
		enabled: boolean;
	}) {
		saving = true;
		modalError = null;

		try {
			const url =
				modalMode === 'add' ? '/api/livetv/accounts' : `/api/livetv/accounts/${editingAccount!.id}`;
			const method = modalMode === 'add' ? 'POST' : 'PUT';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...data,
					providerType: 'stalker',
					stalkerConfig: {
						portalUrl: data.portalUrl,
						macAddress: data.macAddress
					}
				})
			});

			if (!response.ok) {
				const result = await response.json();
				throw new Error(result.error || 'Failed to save account');
			}

			await loadAccounts();
			closeModal();
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'Failed to save account';
		} finally {
			saving = false;
		}
	}

	async function handleSaveXstream(data: {
		name: string;
		baseUrl: string;
		username: string;
		password: string;
		enabled: boolean;
	}) {
		saving = true;
		modalError = null;

		try {
			const url =
				modalMode === 'add' ? '/api/livetv/accounts' : `/api/livetv/accounts/${editingAccount!.id}`;
			const method = modalMode === 'add' ? 'POST' : 'PUT';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...data,
					providerType: 'xstream',
					xstreamConfig: {
						baseUrl: data.baseUrl,
						username: data.username,
						password: data.password
					}
				})
			});

			if (!response.ok) {
				const result = await response.json();
				throw new Error(result.error || 'Failed to save account');
			}

			await loadAccounts();
			closeModal();
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'Failed to save account';
		} finally {
			saving = false;
		}
	}

	async function handleSaveM3u(data: {
		name: string;
		url: string;
		fileContent: string;
		epgUrl: string;
		autoRefresh: boolean;
		enabled: boolean;
	}) {
		saving = true;
		modalError = null;

		try {
			const url =
				modalMode === 'add' ? '/api/livetv/accounts' : `/api/livetv/accounts/${editingAccount!.id}`;
			const method = modalMode === 'add' ? 'POST' : 'PUT';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...data,
					providerType: 'm3u',
					m3uConfig: {
						url: data.url || undefined,
						fileContent: data.fileContent || undefined,
						epgUrl: data.epgUrl || undefined,
						autoRefresh: data.autoRefresh
					}
				})
			});

			if (!response.ok) {
				const result = await response.json();
				throw new Error(result.error || 'Failed to save account');
			}

			await loadAccounts();
			closeModal();
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'Failed to save account';
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!editingAccount) return;

		const confirmed = confirm(`Are you sure you want to delete "${editingAccount.name}"?`);
		if (!confirmed) return;

		saving = true;
		modalError = null;

		try {
			const response = await fetch(`/api/livetv/accounts/${editingAccount.id}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const result = await response.json();
				throw new Error(result.error || 'Failed to delete account');
			}

			await loadAccounts();
			closeModal();
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'Failed to delete account';
		} finally {
			saving = false;
		}
	}

	async function handleToggle(account: LiveTvAccount) {
		try {
			const response = await fetch(`/api/livetv/accounts/${account.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !account.enabled })
			});

			if (!response.ok) {
				throw new Error('Failed to update account');
			}

			await loadAccounts();
		} catch (e) {
			console.error('Failed to toggle account:', e);
		}
	}

	async function handleTest(account: LiveTvAccount) {
		testingId = account.id;

		try {
			const response = await fetch(`/api/livetv/accounts/${account.id}/test`, {
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error('Failed to test account');
			}

			// Reload to get updated test results
			await loadAccounts();
		} catch (e) {
			console.error('Failed to test account:', e);
		} finally {
			testingId = null;
		}
	}

	async function handleSync(account: LiveTvAccount) {
		syncingId = account.id;

		try {
			const response = await fetch('/api/livetv/channels/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountIds: [account.id] })
			});

			if (!response.ok) {
				throw new Error('Failed to sync account');
			}

			// Reload to get updated sync results
			await loadAccounts();
		} catch (e) {
			console.error('Failed to sync account:', e);
		} finally {
			syncingId = null;
		}
	}

	async function handleTestStalkerConfig(config: {
		portalUrl: string;
		macAddress: string;
	}): Promise<LiveTvAccountTestResult> {
		const response = await fetch('/api/livetv/accounts/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				providerType: 'stalker',
				stalkerConfig: config
			})
		});

		return response.json();
	}

	async function handleTestXstreamConfig(config: {
		baseUrl: string;
		username: string;
		password: string;
	}): Promise<LiveTvAccountTestResult> {
		const response = await fetch('/api/livetv/accounts/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				providerType: 'xstream',
				xstreamConfig: config
			})
		});

		return response.json();
	}

	async function handleTestM3uConfig(config: {
		url?: string;
		fileContent?: string;
	}): Promise<LiveTvAccountTestResult> {
		const response = await fetch('/api/livetv/accounts/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				providerType: 'm3u',
				m3uConfig: config
			})
		});

		return response.json();
	}

	async function handleSaveIptvOrg(data: { name: string; countries: string[]; enabled: boolean }) {
		saving = true;
		modalError = null;

		try {
			const url =
				modalMode === 'add' ? '/api/livetv/accounts' : `/api/livetv/accounts/${editingAccount!.id}`;
			const method = modalMode === 'add' ? 'POST' : 'PUT';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: data.name,
					providerType: 'iptvorg',
					enabled: data.enabled,
					iptvOrgConfig: {
						countries: data.countries
					}
				})
			});

			if (!response.ok) {
				const result = await response.json();
				throw new Error(result.error || 'Failed to save account');
			}

			await loadAccounts();
			closeModal();
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'Failed to save account';
		} finally {
			saving = false;
		}
	}

	async function handleTestIptvOrgConfig(config: {
		countries: string[];
	}): Promise<LiveTvAccountTestResult> {
		const response = await fetch('/api/livetv/accounts/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				providerType: 'iptvorg',
				iptvOrgConfig: {
					countries: config.countries
				}
			})
		});

		return response.json();
	}

	// Scanner functions
	function openScanner() {
		scannerView = 'modal';
	}

	function closeScanner() {
		scannerView = 'none';
		activeWorkerId = null;
		activePortalId = null;
	}

	function handleScanStarted(workerId: string, portalId: string) {
		activeWorkerId = workerId;
		activePortalId = portalId;
		scannerView = 'progress';
	}

	function handleScanComplete() {
		scannerView = 'results';
	}

	function handleAccountsCreated() {
		loadAccounts();
	}

	// Check if there are any Stalker accounts (to show scanner button)
	const hasStalkerAccounts = $derived(accounts.some((a) => a.providerType === 'stalker'));
</script>

<svelte:head>
	<title>Live TV Accounts - Cinephage</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold">Live TV Accounts</h1>
			<p class="mt-1 text-base-content/60">Manage your IPTV accounts (Stalker, XStream, M3U)</p>
		</div>
		<div class="flex gap-2">
			<button
				class="btn btn-ghost btn-sm"
				onclick={refreshAccounts}
				disabled={loading || refreshing}
				title="Refresh"
			>
				{#if refreshing}
					<Loader2 class="h-4 w-4 animate-spin" />
				{:else}
					<RefreshCw class="h-4 w-4" />
				{/if}
			</button>
			{#if hasStalkerAccounts}
				<button class="btn btn-ghost btn-sm" onclick={openScanner}>
					<Search class="h-4 w-4" />
					Scan for Accounts
				</button>
			{/if}
			<button class="btn btn-sm btn-primary" onclick={openAddModal}>
				<Plus class="h-4 w-4" />
				Add Account
			</button>
		</div>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if error}
		<div class="alert alert-error">
			<span>{error}</span>
			<button class="btn btn-ghost btn-sm" onclick={loadAccounts}>Retry</button>
		</div>
	{:else}
		<LiveTvAccountTable
			{accounts}
			onEdit={openEditModal}
			onDelete={(account) => {
				editingAccount = account;
				handleDelete();
			}}
			onToggle={handleToggle}
			onTest={handleTest}
			onSync={handleSync}
			{testingId}
			{syncingId}
		/>
	{/if}
</div>

<!-- Provider Selector Modal (Add mode only) -->
{#if modalOpen && showProviderSelector}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-lg rounded-lg bg-base-100 p-6 shadow-xl">
			<h3 class="mb-4 text-xl font-bold">Select Account Type</h3>
			<ProviderTypeSelector
				selected={selectedProviderType}
				onSelect={(type) => (selectedProviderType = type)}
			/>
			<div class="mt-6 flex justify-end gap-2">
				<button class="btn btn-ghost" onclick={closeModal}>Cancel</button>
				<button
					class="btn btn-primary"
					onclick={() => {
						showProviderSelector = false;
					}}
				>
					Continue
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Stalker Modal -->
{#if modalOpen && !showProviderSelector && selectedProviderType === 'stalker'}
	<StalkerAccountModal
		open={modalOpen}
		mode={modalMode}
		account={editingAccount}
		{saving}
		error={modalError}
		onClose={closeModal}
		onSave={handleSaveStalker}
		onDelete={handleDelete}
		onTest={handleTestStalkerConfig}
	/>
{/if}

<!-- XStream Modal -->
{#if modalOpen && !showProviderSelector && selectedProviderType === 'xstream'}
	<XstreamAccountModal
		open={modalOpen}
		mode={modalMode}
		account={editingAccount}
		{saving}
		error={modalError}
		onClose={closeModal}
		onSave={handleSaveXstream}
		onDelete={handleDelete}
		onTest={handleTestXstreamConfig}
	/>
{/if}

<!-- M3U Modal (handles both M3U and IPTV-Org) -->
{#if modalOpen && !showProviderSelector && (effectiveProviderType === 'm3u' || effectiveProviderType === 'iptvorg')}
	<M3uAccountModal
		open={modalOpen}
		mode={modalMode}
		account={editingAccount}
		{saving}
		error={modalError}
		onClose={closeModal}
		onSave={handleSaveM3u}
		onSaveIptvOrg={handleSaveIptvOrg}
		onDelete={handleDelete}
		onTest={handleTestM3uConfig}
		onTestIptvOrg={handleTestIptvOrgConfig}
	/>
{/if}

<!-- Scanner Modal -->
<PortalScanModal
	open={scannerView === 'modal'}
	onClose={closeScanner}
	onScanStarted={handleScanStarted}
/>

<!-- Scanner Progress -->
{#if scannerView === 'progress' && activeWorkerId}
	<div class="mt-6">
		<PortalScanProgress
			workerId={activeWorkerId}
			onClose={closeScanner}
			onComplete={handleScanComplete}
		/>
	</div>
{/if}

<!-- Scan Results -->
{#if scannerView === 'results' && activePortalId}
	<div class="mt-6">
		<ScanResultsTable
			portalId={activePortalId}
			onClose={closeScanner}
			onAccountsCreated={handleAccountsCreated}
		/>
	</div>
{/if}
