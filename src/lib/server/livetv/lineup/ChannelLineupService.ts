/**
 * ChannelLineupService - Manages user's custom channel lineup for Live TV.
 * Provides CRUD operations and ordering for lineup items.
 */

import { db } from '$lib/server/db';
import {
	channelLineupItems,
	stalkerPortalAccounts,
	channelCategories,
	type ChannelLineupItemRecord,
	type ChannelCategoryRecord
} from '$lib/server/db/schema';
import { eq, asc, inArray, sql, and } from 'drizzle-orm';
import { logger } from '$lib/logging';
import { randomUUID } from 'crypto';
import type {
	ChannelLineupItemWithAccount,
	AddToLineupRequest,
	ChannelCategory,
	UpdateChannelRequest
} from '$lib/types/livetv';

/**
 * Convert category record to API response format
 */
function toCategoryResponse(record: ChannelCategoryRecord | null): ChannelCategory | null {
	if (!record) return null;
	return {
		id: record.id,
		name: record.name,
		position: record.position,
		color: record.color,
		icon: record.icon,
		createdAt: record.createdAt || new Date().toISOString(),
		updatedAt: record.updatedAt || new Date().toISOString()
	};
}

/**
 * Convert database record to API response format with computed display values
 */
function toLineupItem(
	record: ChannelLineupItemRecord,
	accountName: string,
	category: ChannelCategoryRecord | null = null
): ChannelLineupItemWithAccount {
	return {
		id: record.id,
		accountId: record.accountId,
		channelId: record.channelId,
		position: record.position,
		channelNumber: record.channelNumber,
		cachedName: record.cachedName,
		cachedLogo: record.cachedLogo,
		cachedCategoryId: record.cachedCategoryId,
		cachedCategoryName: record.cachedCategoryName,
		cachedCmd: record.cachedCmd,
		customName: record.customName,
		customLogo: record.customLogo,
		epgId: record.epgId,
		categoryId: record.categoryId,
		addedAt: record.addedAt || new Date().toISOString(),
		updatedAt: record.updatedAt || new Date().toISOString(),
		accountName,
		category: toCategoryResponse(category),
		displayName: record.customName || record.cachedName,
		displayLogo: record.customLogo || record.cachedLogo
	};
}

class ChannelLineupService {
	/**
	 * Get all lineup items ordered by position with category info
	 */
	async getLineup(): Promise<ChannelLineupItemWithAccount[]> {
		const items = await db
			.select({
				item: channelLineupItems,
				accountName: stalkerPortalAccounts.name,
				category: channelCategories
			})
			.from(channelLineupItems)
			.leftJoin(stalkerPortalAccounts, eq(channelLineupItems.accountId, stalkerPortalAccounts.id))
			.leftJoin(channelCategories, eq(channelLineupItems.categoryId, channelCategories.id))
			.orderBy(asc(channelLineupItems.position));

		return items.map((row) =>
			toLineupItem(row.item, row.accountName || 'Unknown Account', row.category)
		);
	}

	/**
	 * Get a single lineup item by ID
	 */
	async getChannelById(id: string): Promise<ChannelLineupItemWithAccount | null> {
		const items = await db
			.select({
				item: channelLineupItems,
				accountName: stalkerPortalAccounts.name,
				category: channelCategories
			})
			.from(channelLineupItems)
			.leftJoin(stalkerPortalAccounts, eq(channelLineupItems.accountId, stalkerPortalAccounts.id))
			.leftJoin(channelCategories, eq(channelLineupItems.categoryId, channelCategories.id))
			.where(eq(channelLineupItems.id, id))
			.limit(1);

		if (items.length === 0) return null;

		const row = items[0];
		return toLineupItem(row.item, row.accountName || 'Unknown Account', row.category);
	}

	/**
	 * Get lineup item count
	 */
	async getLineupCount(): Promise<number> {
		const result = await db.select({ count: sql<number>`count(*)` }).from(channelLineupItems);
		return result[0]?.count || 0;
	}

	/**
	 * Check if a channel is already in the lineup
	 */
	async isInLineup(accountId: string, channelId: string): Promise<boolean> {
		const existing = await db
			.select({ id: channelLineupItems.id })
			.from(channelLineupItems)
			.where(
				and(
					eq(channelLineupItems.accountId, accountId),
					eq(channelLineupItems.channelId, channelId)
				)
			)
			.limit(1);
		return existing.length > 0;
	}

	/**
	 * Get set of channel keys already in lineup (for bulk checking)
	 * Returns Set of "accountId:channelId" strings
	 */
	async getLineupChannelKeys(): Promise<Set<string>> {
		const items = await db
			.select({
				accountId: channelLineupItems.accountId,
				channelId: channelLineupItems.channelId
			})
			.from(channelLineupItems);

		return new Set(items.map((item) => `${item.accountId}:${item.channelId}`));
	}

	/**
	 * Add channels to the lineup
	 */
	async addToLineup(request: AddToLineupRequest): Promise<{ added: number; skipped: number }> {
		const existingKeys = await this.getLineupChannelKeys();
		const currentCount = await this.getLineupCount();

		let position = currentCount + 1;
		let added = 0;
		let skipped = 0;

		const now = new Date().toISOString();

		for (const channel of request.channels) {
			const key = `${channel.accountId}:${channel.channelId}`;

			if (existingKeys.has(key)) {
				skipped++;
				continue;
			}

			await db.insert(channelLineupItems).values({
				id: randomUUID(),
				accountId: channel.accountId,
				channelId: channel.channelId,
				position: position++,
				cachedName: channel.name,
				cachedLogo: channel.logo || null,
				cachedCategoryId: channel.categoryId || null,
				cachedCategoryName: channel.categoryName || null,
				categoryId: channel.userCategoryId || null,
				addedAt: now,
				updatedAt: now
			});

			added++;
			existingKeys.add(key);
		}

		logger.info('[ChannelLineupService] Added channels to lineup', {
			added,
			skipped
		});
		return { added, skipped };
	}

	/**
	 * Remove items from the lineup
	 */
	async removeFromLineup(itemIds: string[]): Promise<number> {
		if (itemIds.length === 0) return 0;

		await db.delete(channelLineupItems).where(inArray(channelLineupItems.id, itemIds));

		// Recompact positions after deletion
		await this.recompactPositions();

		logger.info('[ChannelLineupService] Removed items from lineup', {
			count: itemIds.length
		});
		return itemIds.length;
	}

	/**
	 * Reorder lineup items.
	 * The itemIds array represents the new order (first = position 1).
	 */
	async reorderLineup(itemIds: string[]): Promise<void> {
		const now = new Date().toISOString();

		// Update positions based on array order
		for (let i = 0; i < itemIds.length; i++) {
			await db
				.update(channelLineupItems)
				.set({ position: i + 1, updatedAt: now })
				.where(eq(channelLineupItems.id, itemIds[i]));
		}

		logger.info('[ChannelLineupService] Reordered lineup', {
			count: itemIds.length
		});
	}

	/**
	 * Recompact positions to ensure sequential ordering (no gaps).
	 */
	private async recompactPositions(): Promise<void> {
		const items = await db
			.select({ id: channelLineupItems.id })
			.from(channelLineupItems)
			.orderBy(asc(channelLineupItems.position));

		for (let i = 0; i < items.length; i++) {
			await db
				.update(channelLineupItems)
				.set({ position: i + 1 })
				.where(eq(channelLineupItems.id, items[i].id));
		}
	}

	/**
	 * Update cached channel metadata (for when live data is refreshed).
	 */
	async updateCachedMetadata(
		accountId: string,
		channelId: string,
		metadata: {
			name: string;
			logo?: string;
			categoryId?: string;
			categoryName?: string;
		}
	): Promise<void> {
		await db
			.update(channelLineupItems)
			.set({
				cachedName: metadata.name,
				cachedLogo: metadata.logo || null,
				cachedCategoryId: metadata.categoryId || null,
				cachedCategoryName: metadata.categoryName || null,
				updatedAt: new Date().toISOString()
			})
			.where(
				and(
					eq(channelLineupItems.accountId, accountId),
					eq(channelLineupItems.channelId, channelId)
				)
			);
	}

	/**
	 * Update a channel's customization fields
	 */
	async updateChannel(id: string, data: UpdateChannelRequest): Promise<void> {
		const now = new Date().toISOString();

		await db
			.update(channelLineupItems)
			.set({
				...(data.channelNumber !== undefined && { channelNumber: data.channelNumber }),
				...(data.customName !== undefined && { customName: data.customName }),
				...(data.customLogo !== undefined && { customLogo: data.customLogo }),
				...(data.epgId !== undefined && { epgId: data.epgId }),
				...(data.categoryId !== undefined && { categoryId: data.categoryId }),
				updatedAt: now
			})
			.where(eq(channelLineupItems.id, id));

		logger.info('[ChannelLineupService] Updated channel', { id });
	}

	/**
	 * Bulk assign category to multiple channels
	 */
	async bulkAssignCategory(itemIds: string[], categoryId: string | null): Promise<number> {
		if (itemIds.length === 0) return 0;

		const now = new Date().toISOString();

		await db
			.update(channelLineupItems)
			.set({
				categoryId: categoryId,
				updatedAt: now
			})
			.where(inArray(channelLineupItems.id, itemIds));

		logger.info('[ChannelLineupService] Bulk assigned category', {
			count: itemIds.length,
			categoryId
		});
		return itemIds.length;
	}

	/**
	 * Auto-number channels starting from a given number
	 */
	async autoNumberChannels(itemIds: string[], startNumber: number): Promise<number> {
		if (itemIds.length === 0) return 0;

		const now = new Date().toISOString();

		for (let i = 0; i < itemIds.length; i++) {
			await db
				.update(channelLineupItems)
				.set({
					channelNumber: startNumber + i,
					updatedAt: now
				})
				.where(eq(channelLineupItems.id, itemIds[i]));
		}

		logger.info('[ChannelLineupService] Auto-numbered channels', {
			count: itemIds.length,
			startNumber
		});
		return itemIds.length;
	}

	/**
	 * Clear the entire lineup
	 */
	async clearLineup(): Promise<number> {
		const count = await this.getLineupCount();
		await db.delete(channelLineupItems);
		logger.info('[ChannelLineupService] Cleared lineup', { count });
		return count;
	}
}

// Singleton instance
let instance: ChannelLineupService | null = null;

export function getChannelLineupService(): ChannelLineupService {
	if (!instance) {
		instance = new ChannelLineupService();
	}
	return instance;
}

export type { ChannelLineupService };
