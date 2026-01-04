/**
 * TypeScript types for Live TV UI components
 */

/**
 * Stalker Portal account as returned by the API
 */
export interface StalkerAccount {
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
 * Form data for creating/editing an account
 */
export interface StalkerAccountFormData {
	name: string;
	portalUrl: string;
	macAddress: string;
	enabled: boolean;
	priority: number;
}

/**
 * Result from testing an account
 */
export interface StalkerAccountTestResult {
	success: boolean;
	error?: string;
	accountInfo?: {
		expDate: string | null;
		maxConnections: number;
		activeConnections: number;
		status: string;
		tariffName: string | null;
		phone: string | null;
	};
	serverInfo?: {
		timezone: string;
		serverTimestamp: number;
	};
	contentStats?: {
		liveChannels: number;
		liveCategories: number;
		vodItems: number;
	};
}

/**
 * Channel category from Stalker Portal
 */
export interface StalkerCategory {
	id: string;
	title: string;
	alias: string;
	number: number;
	censored: boolean;
}

/**
 * Category with account information (for aggregated views)
 */
export interface StalkerCategoryWithAccount extends StalkerCategory {
	accountId: string;
	accountName: string;
}

/**
 * Live TV channel from Stalker Portal
 */
export interface StalkerChannel {
	id: string;
	name: string;
	number: number;
	logo: string;
	categoryId: string;
	cmd: string;
	archive: boolean;
	archiveDays: number;
	xmltvId: string;
}

/**
 * Channel with account and category information (for aggregated views)
 */
export interface StalkerChannelWithAccount extends StalkerChannel {
	accountId: string;
	accountName: string;
	categoryName: string;
}

// ============================================================================
// CHANNEL CATEGORY TYPES
// ============================================================================

/**
 * User-created channel category for organizing lineup
 */
export interface ChannelCategory {
	id: string;
	name: string;
	position: number;
	color: string | null;
	icon: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * Form data for creating/editing a category
 */
export interface ChannelCategoryFormData {
	name: string;
	color?: string;
	icon?: string;
}

// ============================================================================
// CHANNEL LINEUP TYPES
// ============================================================================

/**
 * Channel lineup item as stored in the database
 */
export interface ChannelLineupItem {
	id: string;
	accountId: string;
	channelId: string;
	position: number;
	channelNumber: number | null;
	// Cached from portal (original values)
	cachedName: string;
	cachedLogo: string | null;
	cachedCategoryId: string | null;
	cachedCategoryName: string | null;
	cachedCmd: string | null; // Channel cmd for streaming
	// User customizations (override cached values when set)
	customName: string | null;
	customLogo: string | null;
	epgId: string | null;
	categoryId: string | null;
	addedAt: string;
	updatedAt: string;
}

/**
 * Enriched lineup item with account name, category, and computed display values
 */
export interface ChannelLineupItemWithAccount extends ChannelLineupItem {
	accountName: string;
	category: ChannelCategory | null;
	/** Resolved display name: customName if set, otherwise cachedName */
	displayName: string;
	/** Resolved display logo: customLogo if set, otherwise cachedLogo */
	displayLogo: string | null;
}

/**
 * Request to update a channel's customization
 */
export interface UpdateChannelRequest {
	channelNumber?: number | null;
	customName?: string | null;
	customLogo?: string | null;
	epgId?: string | null;
	categoryId?: string | null;
}

/**
 * Request to bulk update channels
 */
export interface BulkUpdateChannelsRequest {
	itemIds: string[];
	categoryId?: string | null;
	channelNumberStart?: number;
}

/**
 * Request to add channels to the lineup
 */
export interface AddToLineupRequest {
	channels: Array<{
		accountId: string;
		channelId: string;
		name: string;
		logo?: string;
		categoryId?: string;
		categoryName?: string;
		/** User's custom category to assign to this channel */
		userCategoryId?: string | null;
	}>;
}

/**
 * Request to reorder lineup items
 */
export interface ReorderLineupRequest {
	/** Array of lineup item IDs in the new order */
	itemIds: string[];
}

/**
 * Request to remove items from lineup
 */
export interface RemoveFromLineupRequest {
	/** Array of lineup item IDs to remove */
	itemIds: string[];
}
