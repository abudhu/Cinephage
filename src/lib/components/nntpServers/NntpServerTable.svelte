<script lang="ts">
	import {
		Settings,
		Trash2,
		ToggleLeft,
		ToggleRight,
		Server,
		FlaskConical,
		CheckCircle2,
		XCircle,
		Loader2
	} from 'lucide-svelte';
	interface NntpServer {
		id: string;
		name: string;
		host: string;
		port: number;
		useSsl: boolean | null;
		username: string | null;
		maxConnections: number | null;
		priority: number | null;
		enabled: boolean | null;
		testResult: string | null;
		lastTestedAt: string | null;
	}

	interface Props {
		servers: NntpServer[];
		onEdit: (server: NntpServer) => void;
		onDelete: (server: NntpServer) => void;
		onToggle: (server: NntpServer) => void;
		onTest: (server: NntpServer) => Promise<void>;
		testingId?: string | null;
	}

	let { servers, onEdit, onDelete, onToggle, onTest, testingId = null }: Props = $props();
</script>

{#if servers.length === 0}
	<div class="py-12 text-center text-base-content/60">
		<Server class="mx-auto mb-4 h-12 w-12 opacity-40" />
		<p class="text-lg font-medium">No usenet servers configured</p>
		<p class="mt-1 text-sm">Add an NNTP server to enable direct NZB streaming</p>
	</div>
{:else}
	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Host</th>
					<th>Connections</th>
					<th>Priority</th>
					<th>Test</th>
					<th>Status</th>
					<th class="text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each servers as server (server.id)}
					<tr class="hover">
						<td>
							<div class="flex items-center gap-3">
								<div class="placeholder avatar">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-content"
									>
										<Server class="h-5 w-5" />
									</div>
								</div>
								<div>
									<div class="font-bold">{server.name}</div>
									<div class="text-sm opacity-50">NNTP</div>
								</div>
							</div>
						</td>
						<td>
							<div class="font-mono text-sm">
								{server.useSsl ? 'nntps' : 'nntp'}://{server.host}:{server.port}
							</div>
							{#if server.username}
								<div class="text-xs opacity-50">Auth: {server.username}</div>
							{/if}
						</td>
						<td>
							<span class="badge badge-ghost badge-sm">{server.maxConnections ?? 10}</span>
						</td>
						<td>
							<span class="badge badge-outline badge-sm">{server.priority ?? 1}</span>
						</td>
						<td>
							{#if testingId === server.id}
								<span class="badge gap-1 badge-ghost badge-sm">
									<Loader2 class="h-3 w-3 animate-spin" />
									Testing
								</span>
							{:else if server.testResult === 'success'}
								<span class="badge gap-1 badge-sm badge-success">
									<CheckCircle2 class="h-3 w-3" />
									OK
								</span>
							{:else if server.testResult === 'failed'}
								<span class="badge gap-1 badge-sm badge-error">
									<XCircle class="h-3 w-3" />
									Failed
								</span>
							{:else}
								<span class="badge badge-ghost badge-sm">Not tested</span>
							{/if}
						</td>
						<td>
							<span class="badge {server.enabled ? 'badge-success' : 'badge-ghost'}">
								{server.enabled ? 'Enabled' : 'Disabled'}
							</span>
						</td>
						<td>
							<div class="flex justify-end gap-1">
								<button
									class="btn btn-ghost btn-sm"
									onclick={() => onTest(server)}
									title="Test connection"
									disabled={testingId === server.id}
								>
									{#if testingId === server.id}
										<Loader2 class="h-4 w-4 animate-spin" />
									{:else}
										<FlaskConical class="h-4 w-4" />
									{/if}
								</button>
								<button
									class="btn btn-ghost btn-sm"
									onclick={() => onToggle(server)}
									title={server.enabled ? 'Disable' : 'Enable'}
								>
									{#if server.enabled}
										<ToggleRight class="h-4 w-4 text-success" />
									{:else}
										<ToggleLeft class="h-4 w-4" />
									{/if}
								</button>
								<button class="btn btn-ghost btn-sm" onclick={() => onEdit(server)} title="Edit">
									<Settings class="h-4 w-4" />
								</button>
								<button
									class="btn text-error btn-ghost btn-sm"
									onclick={() => onDelete(server)}
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
