/**
 * StalkerPortalManager - Manages Stalker Portal IPTV account configurations.
 * Provides CRUD operations, connection testing, and data fetching.
 *
 * Features (based on Stalkerhek patterns):
 * - Channel caching with TTL
 * - Watchdog lifecycle management
 * - Active stream tracking
 */

import { db } from '$lib/server/db';
import {
	stalkerPortalAccounts,
	type StalkerPortalAccountRecord,
	type NewStalkerPortalAccountRecord
} from '$lib/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { logger } from '$lib/logging';
import { randomUUID } from 'crypto';
import {
	StalkerPortalClient,
	type StalkerCategory,
	type StalkerChannel,
	type StalkerTestResult
} from './StalkerPortalClient';
import type { StalkerAccountCreate, StalkerAccountUpdate } from '$lib/validation/schemas';

// Channel cache TTL (5 minutes)
const CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;

// Watchdog inactivity timeout (stop watchdog after this duration of no streams)
const WATCHDOG_INACTIVITY_MS = 5 * 60 * 1000;

// Cached channel data
interface CachedChannelData {
	channels: StalkerChannel[];
	categories: StalkerCategory[];
	expiresAt: number;
}

/**
 * Public account info (for API responses).
 */
export interface StalkerAccountPublicInfo {
	id: string;
	name: string;
	portalUrl: string;
	macAddress: string;
	enabled: boolean;
	priority: number;
	accountInfo: {
		expDate?: string;
		maxConnections?: number;
		activeConnections?: number;
		status?: string;
	} | null;
	channelCount: number;
	categoryCount: number;
	lastTestedAt: string | null;
	testResult: 'success' | 'failed' | null;
	testError: string | null;
	// Sync and EPG fields
	lastSyncAt: string | null;
	syncIntervalHours: number | null;
	epgEnabled: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

/**
 * Category with account information.
 */
export interface StalkerCategoryWithAccount extends StalkerCategory {
	accountId: string;
	accountName: string;
}

/**
 * Channel with account and category information.
 */
export interface StalkerChannelWithAccount extends StalkerChannel {
	accountId: string;
	accountName: string;
	categoryName: string;
}

/**
 * Convert database record to public info.
 */
function toPublicInfo(record: StalkerPortalAccountRecord): StalkerAccountPublicInfo {
	return {
		id: record.id,
		name: record.name,
		portalUrl: record.portalUrl,
		macAddress: record.macAddress,
		enabled: record.enabled ?? true,
		priority: record.priority ?? 1,
		accountInfo: record.accountInfo as StalkerAccountPublicInfo['accountInfo'],
		channelCount: record.channelCount ?? 0,
		categoryCount: record.categoryCount ?? 0,
		lastTestedAt: record.lastTestedAt,
		testResult: record.testResult as 'success' | 'failed' | null,
		testError: record.testError,
		lastSyncAt: record.lastSyncAt ?? null,
		syncIntervalHours: record.syncIntervalHours ?? null,
		epgEnabled: record.epgEnabled ?? true,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt
	};
}

class StalkerPortalManager {
	// Cache clients by account ID to reuse tokens
	private clientCache: Map<string, StalkerPortalClient> = new Map();

	// Channel cache by account ID
	private channelCache: Map<string, CachedChannelData> = new Map();

	// Active stream count per account (for watchdog lifecycle)
	private activeStreamCounts: Map<string, number> = new Map();

	// Watchdog inactivity timers per account
	private inactivityTimers: Map<string, NodeJS.Timeout> = new Map();

	/**
	 * Get or create a client for an account.
	 */
	private getClient(
		portalUrl: string,
		macAddress: string,
		accountId?: string
	): StalkerPortalClient {
		// If we have an account ID, try to use cached client
		if (accountId) {
			const cached = this.clientCache.get(accountId);
			if (cached) {
				return cached;
			}
		}

		const client = new StalkerPortalClient({ portalUrl, macAddress });

		if (accountId) {
			this.clientCache.set(accountId, client);
		}

		return client;
	}

	/**
	 * Clear cached client for an account.
	 */
	private clearClientCache(accountId: string): void {
		const client = this.clientCache.get(accountId);
		if (client) {
			client.destroy();
		}
		this.clientCache.delete(accountId);
		this.channelCache.delete(accountId);
	}

	// ========================================================================
	// Stream Lifecycle (Watchdog Management)
	// ========================================================================

	/**
	 * Called when a stream starts - manages watchdog lifecycle.
	 */
	notifyStreamStart(accountId: string): void {
		const count = (this.activeStreamCounts.get(accountId) || 0) + 1;
		this.activeStreamCounts.set(accountId, count);

		// Clear any pending inactivity timer
		const timer = this.inactivityTimers.get(accountId);
		if (timer) {
			clearTimeout(timer);
			this.inactivityTimers.delete(accountId);
		}

		// Start watchdog if this is the first stream
		if (count === 1) {
			const client = this.clientCache.get(accountId);
			if (client) {
				client.startWatchdog();
				logger.debug('[StalkerPortalManager] Started watchdog for account', { accountId });
			}
		}

		logger.debug('[StalkerPortalManager] Stream started', { accountId, activeStreams: count });
	}

	/**
	 * Called when a stream ends - manages watchdog lifecycle.
	 */
	notifyStreamEnd(accountId: string): void {
		const count = Math.max(0, (this.activeStreamCounts.get(accountId) || 0) - 1);
		this.activeStreamCounts.set(accountId, count);

		logger.debug('[StalkerPortalManager] Stream ended', { accountId, activeStreams: count });

		// If no more streams, start inactivity timer
		if (count === 0) {
			// Clear any existing timer
			const existingTimer = this.inactivityTimers.get(accountId);
			if (existingTimer) {
				clearTimeout(existingTimer);
			}

			// Set new inactivity timer
			const timer = setTimeout(() => {
				this.stopWatchdogForAccount(accountId);
				this.inactivityTimers.delete(accountId);
			}, WATCHDOG_INACTIVITY_MS);

			this.inactivityTimers.set(accountId, timer);
		}
	}

	/**
	 * Stop watchdog for an account.
	 */
	private stopWatchdogForAccount(accountId: string): void {
		const client = this.clientCache.get(accountId);
		if (client && client.isWatchdogActive()) {
			client.stopWatchdog();
			logger.debug('[StalkerPortalManager] Stopped watchdog for account due to inactivity', {
				accountId
			});
		}
	}

	/**
	 * Get active stream count for an account.
	 */
	getActiveStreamCount(accountId: string): number {
		return this.activeStreamCounts.get(accountId) || 0;
	}

	/**
	 * Get total active stream count across all accounts.
	 */
	getTotalActiveStreamCount(): number {
		let total = 0;
		for (const count of this.activeStreamCounts.values()) {
			total += count;
		}
		return total;
	}

	// ========================================================================
	// CRUD Operations
	// ========================================================================

	/**
	 * Get all accounts (public info).
	 */
	async getAccounts(): Promise<StalkerAccountPublicInfo[]> {
		const records = await db
			.select()
			.from(stalkerPortalAccounts)
			.orderBy(asc(stalkerPortalAccounts.priority));
		return records.map(toPublicInfo);
	}

	/**
	 * Get all enabled accounts.
	 */
	async getEnabledAccounts(): Promise<StalkerPortalAccountRecord[]> {
		return db
			.select()
			.from(stalkerPortalAccounts)
			.where(eq(stalkerPortalAccounts.enabled, true))
			.orderBy(asc(stalkerPortalAccounts.priority));
	}

	/**
	 * Get a single account by ID.
	 */
	async getAccount(id: string): Promise<StalkerAccountPublicInfo | null> {
		const records = await db
			.select()
			.from(stalkerPortalAccounts)
			.where(eq(stalkerPortalAccounts.id, id));
		return records.length > 0 ? toPublicInfo(records[0]) : null;
	}

	/**
	 * Get account record (internal use).
	 */
	async getAccountRecord(id: string): Promise<StalkerPortalAccountRecord | null> {
		const records = await db
			.select()
			.from(stalkerPortalAccounts)
			.where(eq(stalkerPortalAccounts.id, id));
		return records.length > 0 ? records[0] : null;
	}

	/**
	 * Create a new account.
	 */
	async createAccount(input: StalkerAccountCreate): Promise<StalkerAccountPublicInfo> {
		const now = new Date().toISOString();
		const newAccount: NewStalkerPortalAccountRecord = {
			id: randomUUID(),
			name: input.name,
			portalUrl: input.portalUrl,
			macAddress: input.macAddress.toUpperCase(),
			enabled: input.enabled ?? true,
			priority: input.priority ?? 1,
			createdAt: now,
			updatedAt: now
		};

		const [created] = await db.insert(stalkerPortalAccounts).values(newAccount).returning();
		logger.info('[StalkerPortalManager] Created account', { id: created.id, name: created.name });
		return toPublicInfo(created);
	}

	/**
	 * Update an account.
	 */
	async updateAccount(
		id: string,
		input: StalkerAccountUpdate
	): Promise<StalkerAccountPublicInfo | null> {
		const existing = await this.getAccountRecord(id);
		if (!existing) {
			return null;
		}

		const updates: Partial<StalkerPortalAccountRecord> = {
			updatedAt: new Date().toISOString()
		};

		if (input.name !== undefined) updates.name = input.name;
		if (input.portalUrl !== undefined) updates.portalUrl = input.portalUrl;
		if (input.macAddress !== undefined) updates.macAddress = input.macAddress.toUpperCase();
		if (input.enabled !== undefined) updates.enabled = input.enabled;
		if (input.priority !== undefined) updates.priority = input.priority;

		// If portal URL or MAC changed, clear the client cache
		if (input.portalUrl !== undefined || input.macAddress !== undefined) {
			this.clearClientCache(id);
		}

		const [updated] = await db
			.update(stalkerPortalAccounts)
			.set(updates)
			.where(eq(stalkerPortalAccounts.id, id))
			.returning();

		logger.info('[StalkerPortalManager] Updated account', { id, name: updated.name });
		return toPublicInfo(updated);
	}

	/**
	 * Delete an account.
	 */
	async deleteAccount(id: string): Promise<boolean> {
		const existing = await this.getAccountRecord(id);
		if (!existing) {
			return false;
		}

		await db.delete(stalkerPortalAccounts).where(eq(stalkerPortalAccounts.id, id));
		this.clearClientCache(id);

		logger.info('[StalkerPortalManager] Deleted account', { id, name: existing.name });
		return true;
	}

	// ========================================================================
	// Testing
	// ========================================================================

	/**
	 * Test account configuration (before saving).
	 */
	async testAccountConfig(config: {
		portalUrl: string;
		macAddress: string;
	}): Promise<StalkerTestResult> {
		const client = this.getClient(config.portalUrl, config.macAddress);
		return client.test();
	}

	/**
	 * Test a saved account and update its test status.
	 */
	async testAccount(id: string): Promise<StalkerTestResult> {
		const account = await this.getAccountRecord(id);
		if (!account) {
			return { success: false, error: 'Account not found' };
		}

		const client = this.getClient(account.portalUrl, account.macAddress, id);
		const result = await client.test();

		// Update test status in database
		const now = new Date().toISOString();
		await db
			.update(stalkerPortalAccounts)
			.set({
				lastTestedAt: now,
				testResult: result.success ? 'success' : 'failed',
				testError: result.error || null,
				accountInfo: result.accountInfo
					? {
							expDate: result.accountInfo.expDate || undefined,
							maxConnections: result.accountInfo.maxConnections,
							activeConnections: result.accountInfo.activeConnections,
							status: result.accountInfo.status
						}
					: null,
				channelCount: result.contentStats?.liveChannels ?? 0,
				categoryCount: result.contentStats?.liveCategories ?? 0,
				updatedAt: now
			})
			.where(eq(stalkerPortalAccounts.id, id));

		return result;
	}

	// ========================================================================
	// Data Fetching
	// ========================================================================

	/**
	 * Get categories from a specific account.
	 */
	async getAccountCategories(id: string): Promise<StalkerCategory[]> {
		const account = await this.getAccountRecord(id);
		if (!account) {
			throw new Error('Account not found');
		}

		const client = this.getClient(account.portalUrl, account.macAddress, id);
		return client.getCategories();
	}

	/**
	 * Get all channels from a specific account with caching.
	 * Uses 5-minute TTL cache to reduce portal requests.
	 */
	async getAccountChannels(id: string): Promise<StalkerChannel[]> {
		// Check cache first
		const cached = this.channelCache.get(id);
		if (cached && cached.expiresAt > Date.now()) {
			logger.debug('[StalkerPortalManager] Using cached channels', {
				accountId: id,
				count: cached.channels.length
			});
			return cached.channels;
		}

		const account = await this.getAccountRecord(id);
		if (!account) {
			throw new Error('Account not found');
		}

		const client = this.getClient(account.portalUrl, account.macAddress, id);
		const [channels, categories] = await Promise.all([
			client.getAllChannels(),
			client.getCategories()
		]);

		// Cache the results
		this.channelCache.set(id, {
			channels,
			categories,
			expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS
		});

		logger.debug('[StalkerPortalManager] Fetched and cached channels', {
			accountId: id,
			channels: channels.length,
			categories: categories.length
		});

		return channels;
	}

	/**
	 * Get cached categories for an account (populated when channels are fetched).
	 */
	getCachedCategories(id: string): StalkerCategory[] | null {
		const cached = this.channelCache.get(id);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.categories;
		}
		return null;
	}

	/**
	 * Invalidate channel cache for an account.
	 */
	invalidateChannelCache(id: string): void {
		this.channelCache.delete(id);
	}

	/**
	 * Update cached stats (channel/category counts) for an account.
	 */
	async updateAccountStats(id: string): Promise<void> {
		try {
			const categories = await this.getAccountCategories(id);
			const channels = await this.getAccountChannels(id);

			await db
				.update(stalkerPortalAccounts)
				.set({
					categoryCount: categories.length,
					channelCount: channels.length,
					updatedAt: new Date().toISOString()
				})
				.where(eq(stalkerPortalAccounts.id, id));

			logger.debug('[StalkerPortalManager] Updated account stats', {
				id,
				categories: categories.length,
				channels: channels.length
			});
		} catch (error) {
			logger.error('[StalkerPortalManager] Failed to update account stats', {
				id,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}
	}

	// ========================================================================
	// Aggregated Data (All Accounts)
	// ========================================================================

	/**
	 * Get all categories from all enabled accounts.
	 */
	async getAllCategories(): Promise<StalkerCategoryWithAccount[]> {
		const accounts = await this.getEnabledAccounts();
		const results: StalkerCategoryWithAccount[] = [];

		for (const account of accounts) {
			try {
				const client = this.getClient(account.portalUrl, account.macAddress, account.id);
				const categories = await client.getCategories();

				for (const category of categories) {
					results.push({
						...category,
						accountId: account.id,
						accountName: account.name
					});
				}
			} catch (error) {
				logger.error('[StalkerPortalManager] Failed to get categories from account', {
					accountId: account.id,
					accountName: account.name,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		return results;
	}

	/**
	 * Get all channels from all enabled accounts.
	 */
	async getAllChannels(): Promise<StalkerChannelWithAccount[]> {
		const accounts = await this.getEnabledAccounts();
		const results: StalkerChannelWithAccount[] = [];

		for (const account of accounts) {
			try {
				const client = this.getClient(account.portalUrl, account.macAddress, account.id);
				const [channels, categories] = await Promise.all([
					client.getAllChannels(),
					client.getCategories()
				]);

				// Build category name lookup
				const categoryMap = new Map(categories.map((c) => [c.id, c.title]));

				for (const channel of channels) {
					results.push({
						...channel,
						accountId: account.id,
						accountName: account.name,
						categoryName: categoryMap.get(channel.categoryId) || 'Unknown'
					});
				}
			} catch (error) {
				logger.error('[StalkerPortalManager] Failed to get channels from account', {
					accountId: account.id,
					accountName: account.name,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		return results;
	}

	/**
	 * Get stream URL for a channel.
	 */
	async getStreamUrl(accountId: string, channelCmd: string): Promise<string> {
		const account = await this.getAccountRecord(accountId);
		if (!account) {
			throw new Error('Account not found');
		}

		const client = this.getClient(account.portalUrl, account.macAddress, accountId);
		return client.getStreamUrl(channelCmd);
	}

	/**
	 * Get HTTP headers needed for stream access.
	 */
	async getStreamHeaders(accountId: string): Promise<Record<string, string>> {
		const account = await this.getAccountRecord(accountId);
		if (!account) {
			throw new Error('Account not found');
		}

		const client = this.getClient(account.portalUrl, account.macAddress, accountId);
		return client.getStreamHeaders();
	}
}

// Singleton instance
let instance: StalkerPortalManager | null = null;

export function getStalkerPortalManager(): StalkerPortalManager {
	if (!instance) {
		instance = new StalkerPortalManager();
	}
	return instance;
}
