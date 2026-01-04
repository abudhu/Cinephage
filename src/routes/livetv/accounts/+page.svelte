<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Plus } from 'lucide-svelte';
	import type { PageData } from './$types';
	import type { StalkerAccount, StalkerAccountTestResult } from '$lib/types/livetv';
	import { StalkerAccountModal, StalkerAccountTable } from '$lib/components/livetv';
	import { ConfirmationModal } from '$lib/components/ui/modal';

	let { data }: { data: PageData } = $props();

	// Modal state
	let modalOpen = $state(false);
	let modalMode = $state<'add' | 'edit'>('add');
	let editingAccount = $state<StalkerAccount | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	// Delete confirmation state
	let confirmDeleteOpen = $state(false);
	let deleteTarget = $state<StalkerAccount | null>(null);

	// Testing and syncing state
	let testingId = $state<string | null>(null);
	let syncingId = $state<string | null>(null);

	// Modal functions
	function openAddModal() {
		modalMode = 'add';
		editingAccount = null;
		saveError = null;
		modalOpen = true;
	}

	function openEditModal(account: StalkerAccount) {
		modalMode = 'edit';
		editingAccount = account;
		saveError = null;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		editingAccount = null;
		saveError = null;
	}

	// Test connection
	async function handleTest(config: {
		portalUrl: string;
		macAddress: string;
	}): Promise<StalkerAccountTestResult> {
		try {
			const response = await fetch('/api/livetv/accounts/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(config)
			});
			return await response.json();
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
		}
	}

	// Test saved account from table
	async function handleTestAccount(account: StalkerAccount) {
		testingId = account.id;
		try {
			await fetch(`/api/livetv/accounts/${account.id}/test`, {
				method: 'POST'
			});
			await invalidateAll();
		} finally {
			testingId = null;
		}
	}

	// Sync account channels
	async function handleSyncAccount(account: StalkerAccount) {
		const confirmed = confirm(
			`Sync will refresh channel metadata from "${account.name}".\n\n` +
				`This updates existing lineup channels only - it will not add or remove channels.\n\n` +
				`Continue?`
		);
		if (!confirmed) return;

		syncingId = account.id;
		try {
			await fetch(`/api/livetv/accounts/${account.id}/sync`, {
				method: 'POST'
			});
			await invalidateAll();
		} finally {
			syncingId = null;
		}
	}

	// Save account
	async function handleSave(formData: {
		name: string;
		portalUrl: string;
		macAddress: string;
		enabled: boolean;
		priority: number;
	}) {
		saving = true;
		saveError = null;
		try {
			let response: Response;
			if (modalMode === 'edit' && editingAccount) {
				response = await fetch(`/api/livetv/accounts/${editingAccount.id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(formData)
				});
			} else {
				response = await fetch('/api/livetv/accounts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(formData)
				});
			}

			const result = await response.json();
			if (!response.ok || result.error) {
				saveError = result.error || 'Failed to save account';
				return;
			}

			closeModal();
			await invalidateAll();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			saving = false;
		}
	}

	// Delete confirmation
	function confirmDelete(account: StalkerAccount) {
		deleteTarget = account;
		confirmDeleteOpen = true;
	}

	function confirmDeleteFromModal() {
		if (editingAccount) {
			deleteTarget = editingAccount;
			modalOpen = false;
			confirmDeleteOpen = true;
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;

		try {
			await fetch(`/api/livetv/accounts/${deleteTarget.id}`, {
				method: 'DELETE'
			});
			await invalidateAll();
		} finally {
			confirmDeleteOpen = false;
			deleteTarget = null;
		}
	}

	// Toggle enabled
	async function handleToggle(account: StalkerAccount) {
		await fetch(`/api/livetv/accounts/${account.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !account.enabled })
		});
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>IPTV Accounts - Cinephage</title>
</svelte:head>

<div class="w-full p-4">
	<div class="mb-6">
		<h1 class="text-2xl font-bold">IPTV Accounts</h1>
		<p class="text-base-content/70">Manage your Stalker Portal accounts for live TV streaming.</p>
	</div>

	<div class="mb-4 flex items-center justify-end">
		<button class="btn gap-2 btn-primary" onclick={openAddModal}>
			<Plus class="h-4 w-4" />
			Add Account
		</button>
	</div>

	<div class="card bg-base-100 shadow-xl">
		<div class="card-body p-0">
			<StalkerAccountTable
				accounts={data.accounts}
				onEdit={openEditModal}
				onDelete={confirmDelete}
				onToggle={handleToggle}
				onTest={handleTestAccount}
				onSync={handleSyncAccount}
				{testingId}
				{syncingId}
			/>
		</div>
	</div>
</div>

<!-- Add/Edit Modal -->
<StalkerAccountModal
	open={modalOpen}
	mode={modalMode}
	account={editingAccount}
	{saving}
	error={saveError}
	onClose={closeModal}
	onSave={handleSave}
	onDelete={confirmDeleteFromModal}
	onTest={handleTest}
/>

<!-- Delete Confirmation -->
<ConfirmationModal
	open={confirmDeleteOpen}
	title="Delete Account"
	message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
	confirmLabel="Delete"
	confirmVariant="error"
	onConfirm={handleDelete}
	onCancel={() => {
		confirmDeleteOpen = false;
		deleteTarget = null;
	}}
/>
