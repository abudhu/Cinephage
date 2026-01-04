/**
 * ChannelSyncService - Synchronizes channel lineup with provider data.
 * Handles adding new channels, removing stale channels, and updating metadata.
 */

import { db } from '$lib/server/db';
import {
	channelLineupItems,
	stalkerPortalAccounts,
	type ChannelLineupItemRecord
} from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { logger } from '$lib/logging';
import { randomUUID } from 'crypto';
import { getStalkerPortalManager } from '../stalker/StalkerPortalManager';
import type { StalkerChannel } from '../stalker/StalkerPortalClient';

export interface SyncOptions {
	addNewChannels?: boolean; // Add new channels from provider to lineup
	removeStaleChannels?: boolean; // Remove channels no longer in provider
	updateMetadata?: boolean; // Update cached metadata for existing channels
}

export interface SyncResult {
	accountId: string;
	accountName: string;
	added: number;
	updated: number;
	removed: number;
	unchanged: number;
	errors: string[];
	syncedAt: string;
}

class ChannelSyncService {
	private manager = getStalkerPortalManager();

	/**
	 * Sync a single account's channels with the lineup.
	 */
	async syncAccount(accountId: string, options: SyncOptions = {}): Promise<SyncResult> {
		const { addNewChannels = false, removeStaleChannels = false, updateMetadata = true } = options;

		const now = new Date().toISOString();
		const result: SyncResult = {
			accountId,
			accountName: '',
			added: 0,
			updated: 0,
			removed: 0,
			unchanged: 0,
			errors: [],
			syncedAt: now
		};

		try {
			// Get account info
			const account = await this.manager.getAccount(accountId);
			if (!account) {
				result.errors.push('Account not found');
				return result;
			}
			result.accountName = account.name;

			// Fetch current provider channels
			const providerChannels = await this.manager.getAccountChannels(accountId);
			const providerCategories = await this.manager.getAccountCategories(accountId);

			// Build category name lookup
			const categoryMap = new Map(providerCategories.map((c) => [c.id, c.title]));

			// Build provider channel map by channel ID
			const providerChannelMap = new Map(providerChannels.map((ch) => [ch.id, ch]));

			// Get existing lineup items for this account
			const existingItems = await db
				.select()
				.from(channelLineupItems)
				.where(eq(channelLineupItems.accountId, accountId));

			const existingChannelIds = new Set(existingItems.map((item) => item.channelId));

			// Find channels to add, update, or remove
			const channelsToAdd: StalkerChannel[] = [];
			const channelsToUpdate: { item: ChannelLineupItemRecord; channel: StalkerChannel }[] = [];
			const itemsToRemove: string[] = [];

			// Check for new channels in provider
			if (addNewChannels) {
				for (const channel of providerChannels) {
					if (!existingChannelIds.has(channel.id)) {
						channelsToAdd.push(channel);
					}
				}
			}

			// Check existing items for updates or removal
			for (const item of existingItems) {
				const providerChannel = providerChannelMap.get(item.channelId);

				if (!providerChannel) {
					// Channel no longer exists in provider
					if (removeStaleChannels) {
						itemsToRemove.push(item.id);
					}
				} else if (updateMetadata) {
					// Channel exists - check if metadata needs update
					const needsUpdate = this.needsMetadataUpdate(item, providerChannel, categoryMap);
					if (needsUpdate) {
						channelsToUpdate.push({ item, channel: providerChannel });
					} else {
						result.unchanged++;
					}
				} else {
					result.unchanged++;
				}
			}

			// Add new channels
			if (channelsToAdd.length > 0) {
				const currentCount = existingItems.length;
				let position = currentCount + 1;

				for (const channel of channelsToAdd) {
					try {
						await db.insert(channelLineupItems).values({
							id: randomUUID(),
							accountId,
							channelId: channel.id,
							position: position++,
							cachedName: channel.name,
							cachedLogo: channel.logo || null,
							cachedCategoryId: channel.categoryId,
							cachedCategoryName: categoryMap.get(channel.categoryId) || null,
							cachedCmd: channel.cmd,
							cachedArchive: channel.archive,
							cachedArchiveDays: channel.archiveDays,
							cachedXmltvId: channel.xmltvId || null,
							syncStatus: 'synced',
							addedAt: now,
							updatedAt: now
						});
						result.added++;
					} catch (error) {
						result.errors.push(
							`Failed to add channel ${channel.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
						);
					}
				}
			}

			// Update existing channels
			for (const { item, channel } of channelsToUpdate) {
				try {
					await db
						.update(channelLineupItems)
						.set({
							cachedName: channel.name,
							cachedLogo: channel.logo || null,
							cachedCategoryId: channel.categoryId,
							cachedCategoryName: categoryMap.get(channel.categoryId) || null,
							cachedCmd: channel.cmd,
							cachedArchive: channel.archive,
							cachedArchiveDays: channel.archiveDays,
							cachedXmltvId: channel.xmltvId || null,
							syncStatus: 'synced',
							updatedAt: now
						})
						.where(eq(channelLineupItems.id, item.id));
					result.updated++;
				} catch (error) {
					result.errors.push(
						`Failed to update channel ${channel.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
					);
				}
			}

			// Remove stale channels
			if (itemsToRemove.length > 0) {
				try {
					await db.delete(channelLineupItems).where(inArray(channelLineupItems.id, itemsToRemove));
					result.removed = itemsToRemove.length;

					// Recompact positions after deletion
					await this.recompactPositions(accountId);
				} catch (error) {
					result.errors.push(
						`Failed to remove stale channels: ${error instanceof Error ? error.message : 'Unknown error'}`
					);
				}
			}

			// Update account's last sync time
			await db
				.update(stalkerPortalAccounts)
				.set({
					lastSyncAt: now,
					channelCount: providerChannels.length,
					categoryCount: providerCategories.length,
					updatedAt: now
				})
				.where(eq(stalkerPortalAccounts.id, accountId));

			logger.info('[ChannelSyncService] Synced account', {
				accountId,
				accountName: account.name,
				added: result.added,
				updated: result.updated,
				removed: result.removed,
				unchanged: result.unchanged,
				errors: result.errors.length
			});
		} catch (error) {
			result.errors.push(
				`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
			logger.error('[ChannelSyncService] Sync failed', {
				accountId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}

		return result;
	}

	/**
	 * Sync all enabled accounts.
	 */
	async syncAllAccounts(options: SyncOptions = {}): Promise<Map<string, SyncResult>> {
		const results = new Map<string, SyncResult>();
		const accounts = await this.manager.getAccounts();

		for (const account of accounts) {
			if (!account.enabled) continue;

			const result = await this.syncAccount(account.id, options);
			results.set(account.id, result);
		}

		logger.info('[ChannelSyncService] Synced all accounts', {
			accountCount: results.size
		});

		return results;
	}

	/**
	 * Get the last sync time for an account.
	 */
	async getLastSyncTime(accountId: string): Promise<string | null> {
		const records = await db
			.select({ lastSyncAt: stalkerPortalAccounts.lastSyncAt })
			.from(stalkerPortalAccounts)
			.where(eq(stalkerPortalAccounts.id, accountId))
			.limit(1);

		return records.length > 0 ? records[0].lastSyncAt : null;
	}

	/**
	 * Get sync status for all accounts.
	 */
	async getSyncStatus(): Promise<
		Array<{
			accountId: string;
			accountName: string;
			enabled: boolean;
			lastSyncAt: string | null;
			channelCount: number;
		}>
	> {
		const accounts = await db
			.select({
				id: stalkerPortalAccounts.id,
				name: stalkerPortalAccounts.name,
				enabled: stalkerPortalAccounts.enabled,
				lastSyncAt: stalkerPortalAccounts.lastSyncAt,
				channelCount: stalkerPortalAccounts.channelCount
			})
			.from(stalkerPortalAccounts);

		return accounts.map((a) => ({
			accountId: a.id,
			accountName: a.name,
			enabled: a.enabled ?? true,
			lastSyncAt: a.lastSyncAt,
			channelCount: a.channelCount ?? 0
		}));
	}

	/**
	 * Check if a lineup item's cached metadata differs from provider data.
	 */
	private needsMetadataUpdate(
		item: ChannelLineupItemRecord,
		channel: StalkerChannel,
		categoryMap: Map<string, string>
	): boolean {
		const categoryName = categoryMap.get(channel.categoryId) || null;

		return (
			item.cachedName !== channel.name ||
			item.cachedLogo !== (channel.logo || null) ||
			item.cachedCategoryId !== channel.categoryId ||
			item.cachedCategoryName !== categoryName ||
			item.cachedCmd !== channel.cmd ||
			item.cachedArchive !== channel.archive ||
			item.cachedArchiveDays !== channel.archiveDays ||
			item.cachedXmltvId !== (channel.xmltvId || null)
		);
	}

	/**
	 * Recompact positions for an account's lineup after deletion.
	 */
	private async recompactPositions(accountId: string): Promise<void> {
		const items = await db
			.select({ id: channelLineupItems.id })
			.from(channelLineupItems)
			.where(eq(channelLineupItems.accountId, accountId))
			.orderBy(channelLineupItems.position);

		for (let i = 0; i < items.length; i++) {
			await db
				.update(channelLineupItems)
				.set({ position: i + 1 })
				.where(eq(channelLineupItems.id, items[i].id));
		}
	}
}

// Singleton instance
let instance: ChannelSyncService | null = null;

export function getChannelSyncService(): ChannelSyncService {
	if (!instance) {
		instance = new ChannelSyncService();
	}
	return instance;
}

export type { ChannelSyncService };
