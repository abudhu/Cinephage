<script lang="ts">
	import { X, Loader2, XCircle, CheckCircle2, Radio } from 'lucide-svelte';
	import ModalWrapper from '$lib/components/ui/modal/ModalWrapper.svelte';
	import type { LiveTvAccount, LiveTvAccountTestResult } from '$lib/types/livetv';

	interface XstreamAccountFormData {
		name: string;
		baseUrl: string;
		username: string;
		password: string;
		enabled: boolean;
	}

	interface Props {
		open: boolean;
		mode: 'add' | 'edit';
		account?: LiveTvAccount | null;
		saving: boolean;
		error?: string | null;
		onClose: () => void;
		onSave: (data: XstreamAccountFormData) => void;
		onDelete?: () => void;
		onTest: (data: {
			baseUrl: string;
			username: string;
			password: string;
		}) => Promise<LiveTvAccountTestResult>;
	}

	let {
		open,
		mode,
		account = null,
		saving,
		error = null,
		onClose,
		onSave,
		onDelete,
		onTest
	}: Props = $props();

	// Form state
	let name = $state('');
	let baseUrl = $state('');
	let username = $state('');
	let password = $state('');
	let enabled = $state(true);

	// UI state
	let testing = $state(false);
	let testResult = $state<LiveTvAccountTestResult | null>(null);

	// Derived
	const modalTitle = $derived(mode === 'add' ? 'Add XStream Account' : 'Edit XStream Account');

	// Validation
	const isUrlValid = $derived(() => {
		try {
			new URL(baseUrl);
			return true;
		} catch {
			return false;
		}
	});
	const canSubmit = $derived(
		name.trim().length > 0 &&
			baseUrl.trim().length > 0 &&
			username.trim().length > 0 &&
			password.trim().length > 0 &&
			isUrlValid()
	);

	// Reset form when modal opens or account changes
	$effect(() => {
		if (open) {
			name = account?.name ?? '';
			baseUrl = account?.xstreamConfig?.baseUrl ?? '';
			username = account?.xstreamConfig?.username ?? '';
			password = account?.xstreamConfig?.password ?? '';
			enabled = account?.enabled ?? true;
			testResult = null;
		}
	});

	function getFormData(): XstreamAccountFormData {
		return {
			name: name.trim(),
			baseUrl: baseUrl.trim(),
			username: username.trim(),
			password: password.trim(),
			enabled
		};
	}

	async function handleTest() {
		if (!canSubmit) return;

		testing = true;
		testResult = null;

		try {
			testResult = await onTest({
				baseUrl: baseUrl.trim(),
				username: username.trim(),
				password: password.trim()
			});
		} finally {
			testing = false;
		}
	}

	function handleSave() {
		if (!canSubmit) return;
		onSave(getFormData());
	}

	function formatExpiryDate(isoDate: string | null): string {
		if (!isoDate) return 'Unknown';
		try {
			return new Date(isoDate).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return 'Unknown';
		}
	}
</script>

<ModalWrapper {open} {onClose} maxWidth="lg" labelledBy="xstream-account-modal-title">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
				<Radio class="h-5 w-5 text-primary" />
			</div>
			<h3 id="xstream-account-modal-title" class="text-xl font-bold">{modalTitle}</h3>
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
				placeholder="My XStream Account"
			/>
			<div class="label py-1">
				<span class="label-text-alt text-xs">A friendly name for this account</span>
			</div>
		</div>

		<!-- Base URL -->
		<div class="form-control">
			<label class="label py-1" for="baseUrl">
				<span class="label-text">Server URL</span>
			</label>
			<div class="relative">
				<input
					id="baseUrl"
					type="url"
					class="input-bordered input input-sm w-full pr-8"
					class:input-error={baseUrl.length > 0 && !isUrlValid()}
					bind:value={baseUrl}
					placeholder="http://example.com:8080"
				/>
				{#if baseUrl.length > 0}
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
				<span class="label-text-alt text-xs">
					The XStream server URL (e.g., http://example.com:8080)
				</span>
			</div>
		</div>

		<!-- Username -->
		<div class="form-control">
			<label class="label py-1" for="username">
				<span class="label-text">Username</span>
			</label>
			<input
				id="username"
				type="text"
				class="input-bordered input input-sm"
				bind:value={username}
				placeholder="your_username"
			/>
			<div class="label py-1">
				<span class="label-text-alt text-xs">Your XStream username</span>
			</div>
		</div>

		<!-- Password -->
		<div class="form-control">
			<label class="label py-1" for="password">
				<span class="label-text">Password</span>
			</label>
			<input
				id="password"
				type="password"
				class="input-bordered input input-sm"
				bind:value={password}
				placeholder="••••••••"
			/>
			<div class="label py-1">
				<span class="label-text-alt text-xs">Your XStream password</span>
			</div>
		</div>

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
						<div class="font-medium">Connection successful</div>
						<div class="mt-2 grid grid-cols-2 gap-2 text-sm opacity-80">
							<div>Channels: {testResult.profile.channelCount.toLocaleString()}</div>
							<div>Categories: {testResult.profile.categoryCount}</div>
							<div>Max Connections: {testResult.profile.playbackLimit}</div>
							<div>
								Status: <span
									class="badge badge-sm {testResult.profile.status === 'active'
										? 'badge-success'
										: testResult.profile.status === 'expired'
											? 'badge-error'
											: 'badge-warning'}"
								>
									{testResult.profile.status}
								</span>
							</div>
							{#if testResult.profile.expiresAt}
								<div class="col-span-2">
									Expires: {formatExpiryDate(testResult.profile.expiresAt)}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<div class="alert alert-error">
					<XCircle class="h-5 w-5" />
					<div>
						<div class="font-medium">Connection failed</div>
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

		<button class="btn btn-ghost" onclick={handleTest} disabled={testing || saving || !canSubmit}>
			{#if testing}
				<Loader2 class="h-4 w-4 animate-spin" />
			{/if}
			Test
		</button>

		<button class="btn btn-ghost" onclick={onClose}>Cancel</button>

		<button class="btn btn-primary" onclick={handleSave} disabled={saving || !canSubmit}>
			{#if saving}
				<Loader2 class="h-4 w-4 animate-spin" />
			{/if}
			Save
		</button>
	</div>
</ModalWrapper>
