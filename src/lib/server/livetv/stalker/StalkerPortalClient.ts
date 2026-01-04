/**
 * StalkerPortalClient - HTTP client for Stalker Portal/MAG STB IPTV APIs.
 *
 * Handles authentication via MAC address handshake and provides methods
 * to fetch account info, categories, and channels from Stalker Portal servers.
 *
 * Features (based on Stalkerhek patterns):
 * - Watchdog keepalive to maintain sessions
 * - Session expiration detection with auto re-auth
 * - Stream link caching with TTL
 * - Proper device headers
 */

import { logger } from '$lib/logging';
import { withRetry, DEFAULT_RETRY_CONFIG, SessionExpiredError } from '../proxy/StalkerRetry';

export interface StalkerPortalConfig {
	portalUrl: string;
	macAddress: string;
	serialNumber?: string;
}

interface StalkerToken {
	token: string;
	expiresAt: number;
}

export interface StalkerAccountInfo {
	expDate: string | null;
	maxConnections: number;
	activeConnections: number;
	status: string;
	tariffName: string | null;
	phone: string | null;
}

export interface StalkerCategory {
	id: string;
	title: string;
	alias: string;
	number: number;
	censored: boolean;
}

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

export interface StalkerTestResult {
	success: boolean;
	error?: string;
	accountInfo?: StalkerAccountInfo;
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

export interface StalkerEpgProgram {
	id: string;
	channelId: string;
	startTime: string; // ISO timestamp
	endTime: string; // ISO timestamp
	startTimestamp: number;
	endTimestamp: number;
	title: string;
	description: string;
	category: string;
	hasArchive: boolean;
}

export interface StalkerEpgData {
	programs: Map<string, StalkerEpgProgram[]>; // Map of channelId -> programs
}

// User agent that mimics MAG STB devices
const STB_USER_AGENT =
	'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3';

// Token validity duration (refresh 2 minutes before expiry - tighter margin)
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

// Watchdog interval (5 minutes - keeps session alive)
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

// Stream link cache TTL (30s for HLS, 5s for media - from Stalkerhek)
const STREAM_LINK_HLS_TTL_MS = 30 * 1000;
const STREAM_LINK_MEDIA_TTL_MS = 5 * 1000;

// Cached stream link entry
interface CachedStreamLink {
	url: string;
	expiresAt: number;
	isHls: boolean;
}

export class StalkerPortalClient {
	private config: StalkerPortalConfig;
	private token: StalkerToken | null = null;
	private watchdogTimer: NodeJS.Timeout | null = null;
	private streamLinkCache: Map<string, CachedStreamLink> = new Map();
	private isReauthenticating = false;

	constructor(config: StalkerPortalConfig) {
		this.config = config;
	}

	/**
	 * Start watchdog keepalive timer.
	 * Call this when streams are active to prevent session expiration.
	 */
	startWatchdog(): void {
		if (this.watchdogTimer) return;

		logger.debug('[StalkerPortalClient] Starting watchdog');

		// Send initial watchdog
		this.sendWatchdog().catch((error) => {
			logger.warn('[StalkerPortalClient] Initial watchdog failed', {
				error: error instanceof Error ? error.message : 'Unknown'
			});
		});

		// Schedule periodic watchdog
		this.watchdogTimer = setInterval(() => {
			this.sendWatchdog().catch((error) => {
				logger.warn('[StalkerPortalClient] Watchdog failed, will re-auth on next request', {
					error: error instanceof Error ? error.message : 'Unknown'
				});
				// Clear token to force re-auth on next request
				this.token = null;
			});
		}, WATCHDOG_INTERVAL_MS);
	}

	/**
	 * Stop watchdog keepalive timer.
	 * Call this when no streams are active.
	 */
	stopWatchdog(): void {
		if (this.watchdogTimer) {
			clearInterval(this.watchdogTimer);
			this.watchdogTimer = null;
			logger.debug('[StalkerPortalClient] Stopped watchdog');
		}
	}

	/**
	 * Send watchdog request to keep session alive.
	 * Based on Stalkerhek's watchdogUpdate function.
	 */
	private async sendWatchdog(): Promise<void> {
		await this.ensureToken();

		const url = `${this.getPortalBaseUrl()}?action=get_events&event_active_id=0&init=0&type=watchdog&cur_play_type=1&JsHttpRequest=1-xml`;

		const response = await fetch(url, {
			method: 'GET',
			headers: this.getHeaders(true)
		});

		if (!response.ok) {
			throw new Error(`Watchdog failed: HTTP ${response.status}`);
		}

		// Parse response to validate session
		const data = await response.json();
		if (!data?.js) {
			throw new SessionExpiredError('Watchdog response invalid');
		}

		logger.debug('[StalkerPortalClient] Watchdog sent');
	}

	/**
	 * Get the base portal URL, ensuring it ends with /portal.php or /c/
	 */
	private getPortalBaseUrl(): string {
		let url = this.config.portalUrl.trim();
		// Remove trailing slash
		if (url.endsWith('/')) {
			url = url.slice(0, -1);
		}
		// Handle common URL patterns
		if (url.endsWith('/c')) {
			return url + '/portal.php';
		}
		if (url.endsWith('/portal.php')) {
			return url;
		}
		// Append portal.php if not present
		return url + '/portal.php';
	}

	/**
	 * URL encode MAC address for cookies (: becomes %3A)
	 */
	private getEncodedMac(): string {
		return encodeURIComponent(this.config.macAddress);
	}

	/**
	 * Build common headers for requests.
	 * Includes X-User-Agent required by some portals (from Stalkerhek).
	 */
	private getHeaders(includeAuth: boolean = false): Record<string, string> {
		// Build cookie with optional serial number
		let cookie = `mac=${this.getEncodedMac()}; timezone=UTC; stb_lang=en`;
		if (this.config.serialNumber) {
			cookie += `; sn=${encodeURIComponent(this.config.serialNumber)}`;
		}

		const headers: Record<string, string> = {
			'User-Agent': STB_USER_AGENT,
			'X-User-Agent': 'Model: MAG250; Link: WiFi', // Required by some portals
			Cookie: cookie
		};

		if (includeAuth && this.token) {
			headers['Authorization'] = `Bearer ${this.token.token}`;
		}

		return headers;
	}

	/**
	 * Perform handshake to get authentication token
	 */
	private async handshake(): Promise<string> {
		const url = `${this.getPortalBaseUrl()}?type=stb&action=handshake&JsHttpRequest=1-xml`;

		logger.debug('[StalkerPortalClient] Performing handshake', {
			portalUrl: this.config.portalUrl,
			mac: this.config.macAddress
		});

		const response = await fetch(url, {
			method: 'GET',
			headers: this.getHeaders(false)
		});

		if (!response.ok) {
			throw new Error(`Handshake failed: HTTP ${response.status}`);
		}

		const data = await response.json();

		// Stalker Portal wraps response in js object
		const token = data?.js?.token;
		if (!token) {
			throw new Error('Handshake failed: No token in response');
		}

		logger.debug('[StalkerPortalClient] Handshake successful', {
			token: token.substring(0, 8) + '...'
		});

		return token;
	}

	/**
	 * Ensure we have a valid token, refreshing if needed
	 */
	private async ensureToken(): Promise<string> {
		const now = Date.now();

		// Check if current token is still valid
		if (this.token && this.token.expiresAt > now + TOKEN_REFRESH_MARGIN_MS) {
			return this.token.token;
		}

		// Get new token
		const token = await this.handshake();

		// Tokens typically last 1 hour, we'll assume 30 minutes to be safe
		this.token = {
			token,
			expiresAt: now + 30 * 60 * 1000
		};

		return token;
	}

	/**
	 * Make an authenticated API request with session expiration detection.
	 * Based on Stalkerhek pattern: JSON parse errors indicate expired sessions.
	 */
	private async apiRequest<T>(
		type: string,
		action: string,
		params: Record<string, string> = {},
		allowRetry: boolean = true
	): Promise<T> {
		await this.ensureToken();

		const queryParams = new URLSearchParams({
			type,
			action,
			JsHttpRequest: '1-xml',
			...params
		});

		const url = `${this.getPortalBaseUrl()}?${queryParams.toString()}`;

		const response = await fetch(url, {
			method: 'GET',
			headers: this.getHeaders(true)
		});

		if (!response.ok) {
			throw new Error(`API request failed: HTTP ${response.status}`);
		}

		// Try to parse JSON - parse errors often indicate session expiry
		let data;
		try {
			data = await response.json();
		} catch (_error) {
			// JSON parse error = likely session expired (Stalkerhek pattern)
			if (allowRetry && !this.isReauthenticating) {
				logger.info('[StalkerPortalClient] JSON parse error, re-authenticating');
				await this.reauthenticate();
				return this.apiRequest<T>(type, action, params, false);
			}
			throw new SessionExpiredError('Failed to parse portal response');
		}

		// Check for session expiration indicators
		if (this.isSessionExpiredResponse(data)) {
			if (allowRetry && !this.isReauthenticating) {
				logger.info('[StalkerPortalClient] Session expired, re-authenticating');
				await this.reauthenticate();
				return this.apiRequest<T>(type, action, params, false);
			}
			throw new SessionExpiredError('Session expired');
		}

		// Handle Stalker Portal error responses
		if (data?.js?.error) {
			throw new Error(`Portal error: ${data.js.error}`);
		}

		return data?.js as T;
	}

	/**
	 * Check if response indicates session expiration.
	 */
	private isSessionExpiredResponse(data: unknown): boolean {
		if (!data || typeof data !== 'object') return true;

		const obj = data as Record<string, unknown>;

		// Empty js object often indicates session expiry
		if (obj.js === null || obj.js === undefined) return true;
		if (typeof obj.js === 'object' && Object.keys(obj.js as object).length === 0) return true;

		// Check for specific error messages
		if (obj.js && typeof obj.js === 'object') {
			const js = obj.js as Record<string, unknown>;
			if (typeof js.error === 'string') {
				const error = js.error.toLowerCase();
				if (error.includes('session') || error.includes('token') || error.includes('auth')) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Re-authenticate by clearing token and performing handshake.
	 */
	private async reauthenticate(): Promise<void> {
		if (this.isReauthenticating) return;

		try {
			this.isReauthenticating = true;
			this.token = null;
			this.streamLinkCache.clear();

			logger.info('[StalkerPortalClient] Re-authenticating');
			await this.handshake();
		} finally {
			this.isReauthenticating = false;
		}
	}

	/**
	 * Get account information
	 */
	async getAccountInfo(): Promise<StalkerAccountInfo> {
		// Get account info - expiry date is in the 'phone' field for most portals
		const accountData = await this.apiRequest<{
			phone?: string;
			mac?: string;
		}>('account_info', 'get_main_info');

		// Get profile for status (status=1 means active)
		let status = 'unknown';
		let maxConnections = 1;
		try {
			const profile = await this.apiRequest<{
				status?: number;
				playback_limit?: number;
			}>('stb', 'get_profile');
			status = profile.status === 1 ? 'active' : 'inactive';
			if (profile.playback_limit) {
				maxConnections = profile.playback_limit;
			}
		} catch {
			// Profile might not be available on all portals
		}

		return {
			expDate: accountData.phone || null, // phone field contains expiry date
			maxConnections,
			activeConnections: 0,
			status,
			tariffName: null,
			phone: null
		};
	}

	/**
	 * Get STB profile information (for additional account details)
	 */
	async getProfile(): Promise<Record<string, unknown>> {
		return this.apiRequest('stb', 'get_profile');
	}

	/**
	 * Get all channel categories (genres)
	 */
	async getCategories(): Promise<StalkerCategory[]> {
		const data = await this.apiRequest<
			Array<{
				id: string;
				title: string;
				alias: string;
				number?: string;
				censored?: number;
			}>
		>('itv', 'get_genres');

		if (!Array.isArray(data)) {
			return [];
		}

		return data.map((cat, idx) => ({
			id: cat.id,
			title: cat.title,
			alias: cat.alias || '',
			number: parseInt(cat.number || String(idx + 1), 10),
			censored: cat.censored === 1
		}));
	}

	/**
	 * Get all live TV channels
	 */
	async getAllChannels(): Promise<StalkerChannel[]> {
		const data = await this.apiRequest<{
			data: Array<{
				id: string;
				name: string;
				number: string;
				logo: string;
				tv_genre_id: string;
				cmd: string;
				tv_archive: number;
				tv_archive_duration: number;
				xmltv_id: string;
			}>;
		}>('itv', 'get_all_channels');

		if (!data?.data || !Array.isArray(data.data)) {
			return [];
		}

		return data.data.map((ch) => ({
			id: ch.id,
			name: ch.name,
			number: parseInt(ch.number, 10) || 0,
			logo: ch.logo || '',
			categoryId: ch.tv_genre_id,
			cmd: ch.cmd,
			archive: ch.tv_archive === 1,
			archiveDays: ch.tv_archive_duration || 0,
			xmltvId: ch.xmltv_id || ''
		}));
	}

	/**
	 * Get channels by category/genre
	 */
	async getChannelsByCategory(categoryId: string): Promise<StalkerChannel[]> {
		const data = await this.apiRequest<{
			data: Array<{
				id: string;
				name: string;
				number: string;
				logo: string;
				tv_genre_id: string;
				cmd: string;
				tv_archive: number;
				tv_archive_duration: number;
				xmltv_id: string;
			}>;
		}>('itv', 'get_ordered_list', {
			genre: categoryId,
			sortby: 'number'
		});

		if (!data?.data || !Array.isArray(data.data)) {
			return [];
		}

		return data.data.map((ch) => ({
			id: ch.id,
			name: ch.name,
			number: parseInt(ch.number, 10) || 0,
			logo: ch.logo || '',
			categoryId: ch.tv_genre_id,
			cmd: ch.cmd,
			archive: ch.tv_archive === 1,
			archiveDays: ch.tv_archive_duration || 0,
			xmltvId: ch.xmltv_id || ''
		}));
	}

	/**
	 * Get stream URL for a channel with caching.
	 * Uses TTL-based cache (30s for HLS, 5s for media) from Stalkerhek.
	 *
	 * Important: The cmd from get_all_channels may contain a full URL with an
	 * embedded play_token, but this token expires quickly. We must always call
	 * create_link to get a fresh token.
	 *
	 * create_link expects a reference format: "ffrt http://localhost/ch/{channelId}"
	 * If given a full URL, it returns broken responses with empty stream parameter.
	 */
	async getStreamUrl(cmd: string): Promise<string> {
		// Check cache first
		const cached = this.streamLinkCache.get(cmd);
		if (cached && cached.expiresAt > Date.now()) {
			logger.debug('[StalkerPortalClient] Using cached stream URL', { cmd: cmd.substring(0, 50) });
			return cached.url;
		}

		// Determine the command to send to create_link
		let createLinkCmd = cmd;

		// If cmd is a full URL (from get_all_channels), extract channel ID and use reference format
		// Full URL format: "ffmpeg http://host/play/live.php?...&stream=12345&..."
		if (cmd.startsWith('ffmpeg http://') || cmd.startsWith('ffmpeg https://')) {
			const streamMatch = cmd.match(/[&?]stream=(\d+)/);
			if (streamMatch) {
				const channelId = streamMatch[1];
				// Use the reference format that create_link expects
				createLinkCmd = `ffrt http://localhost/ch/${channelId}`;
				logger.debug('[StalkerPortalClient] Converted full URL to reference format', {
					channelId,
					originalCmd: cmd.substring(0, 60)
				});
			}
		}

		// Fetch fresh URL from create_link with retry
		const url = await withRetry(DEFAULT_RETRY_CONFIG, async () => {
			const data = await this.apiRequest<{
				cmd: string;
			}>('itv', 'create_link', {
				cmd: createLinkCmd
			});

			if (!data?.cmd) {
				throw new Error('Failed to get stream URL');
			}

			// Stream URL is typically in format "ffmpeg http://..."
			let streamUrl = data.cmd;
			if (streamUrl.startsWith('ffmpeg ')) {
				streamUrl = streamUrl.substring(7);
			}

			return streamUrl;
		});

		// Determine TTL based on URL pattern
		const isHls = url.includes('.m3u8') || url.includes('/playlist');
		const ttl = isHls ? STREAM_LINK_HLS_TTL_MS : STREAM_LINK_MEDIA_TTL_MS;

		// Cache the URL
		this.streamLinkCache.set(cmd, {
			url,
			expiresAt: Date.now() + ttl,
			isHls
		});

		logger.debug('[StalkerPortalClient] Cached stream URL', {
			cmd: cmd.substring(0, 50),
			isHls,
			ttlMs: ttl
		});

		return url;
	}

	/**
	 * Clear stream link cache.
	 */
	clearStreamLinkCache(): void {
		this.streamLinkCache.clear();
	}

	/**
	 * Check if watchdog is running.
	 */
	isWatchdogActive(): boolean {
		return this.watchdogTimer !== null;
	}

	/**
	 * Get HTTP headers needed for stream access.
	 * These must be passed to FFmpeg for authenticated streams.
	 */
	async getStreamHeaders(): Promise<Record<string, string>> {
		await this.ensureToken();
		return {
			'User-Agent': STB_USER_AGENT,
			Cookie: `mac=${this.getEncodedMac()}; timezone=UTC; stb_lang=en`
		};
	}

	/**
	 * Get VOD total count
	 */
	async getVodCount(): Promise<number> {
		try {
			const data = await this.apiRequest<{
				total_items?: number | string;
			}>('vod', 'get_ordered_list', { p: '1' });
			return typeof data.total_items === 'string'
				? parseInt(data.total_items, 10)
				: data.total_items || 0;
		} catch {
			return 0;
		}
	}

	/**
	 * Get EPG (Electronic Program Guide) data for all channels.
	 * @param period Number of hours of EPG data to fetch (default: 4)
	 * @returns Map of channel ID to array of programs
	 */
	async getEpgInfo(period: number = 4): Promise<StalkerEpgData> {
		const result: StalkerEpgData = {
			programs: new Map()
		};

		try {
			const data = await this.apiRequest<{
				data: Record<
					string,
					Array<{
						id: string;
						ch_id: string;
						time: string;
						time_to: string;
						start_timestamp: number;
						stop_timestamp: number;
						name: string;
						descr: string;
						category?: string;
						mark_archive?: number;
					}>
				>;
			}>('itv', 'get_epg_info', { period: String(period) });

			if (!data?.data || typeof data.data !== 'object') {
				logger.warn('[StalkerPortalClient] No EPG data returned');
				return result;
			}

			// Data is keyed by channel ID
			for (const [channelId, programs] of Object.entries(data.data)) {
				if (!Array.isArray(programs)) continue;

				const mappedPrograms: StalkerEpgProgram[] = programs.map((prog) => ({
					id: prog.id || '',
					channelId: prog.ch_id || channelId,
					startTime: prog.time || '',
					endTime: prog.time_to || '',
					startTimestamp: prog.start_timestamp || 0,
					endTimestamp: prog.stop_timestamp || 0,
					title: prog.name || '',
					description: prog.descr || '',
					category: prog.category || '',
					hasArchive: prog.mark_archive === 1
				}));

				result.programs.set(channelId, mappedPrograms);
			}

			logger.debug('[StalkerPortalClient] Fetched EPG data', {
				channels: result.programs.size,
				period
			});
		} catch (error) {
			logger.error('[StalkerPortalClient] Failed to fetch EPG', {
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		}

		return result;
	}

	/**
	 * Get short EPG (current/next program) for a specific channel.
	 */
	async getShortEpg(channelId: string): Promise<StalkerEpgProgram[]> {
		try {
			const data = await this.apiRequest<{
				data: Array<{
					id: string;
					ch_id: string;
					time: string;
					time_to: string;
					start_timestamp: number;
					stop_timestamp: number;
					name: string;
					descr: string;
					category?: string;
					mark_archive?: number;
				}>;
			}>('itv', 'get_short_epg', { ch_id: channelId });

			if (!data?.data || !Array.isArray(data.data)) {
				return [];
			}

			return data.data.map((prog) => ({
				id: prog.id || '',
				channelId: prog.ch_id || channelId,
				startTime: prog.time || '',
				endTime: prog.time_to || '',
				startTimestamp: prog.start_timestamp || 0,
				endTimestamp: prog.stop_timestamp || 0,
				title: prog.name || '',
				description: prog.descr || '',
				category: prog.category || '',
				hasArchive: prog.mark_archive === 1
			}));
		} catch (error) {
			logger.error('[StalkerPortalClient] Failed to fetch short EPG', {
				channelId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return [];
		}
	}

	/**
	 * Test connection to portal
	 */
	async test(): Promise<StalkerTestResult> {
		try {
			// First, try handshake
			await this.handshake();

			// Then get account info
			const accountInfo = await this.getAccountInfo();

			// Try to get profile for server info
			let serverInfo: { timezone: string; serverTimestamp: number } | undefined;
			try {
				const profile = await this.getProfile();
				if (profile) {
					serverInfo = {
						timezone: (profile.timezone as string) || 'UTC',
						serverTimestamp: (profile.now as number) || Date.now() / 1000
					};
				}
			} catch {
				// Profile not required for test success
			}

			// Get content stats (channels, categories, VOD)
			let contentStats:
				| { liveChannels: number; liveCategories: number; vodItems: number }
				| undefined;
			try {
				const [channels, categories, vodCount] = await Promise.all([
					this.getAllChannels(),
					this.getCategories(),
					this.getVodCount()
				]);
				contentStats = {
					liveChannels: channels.length,
					liveCategories: categories.length,
					vodItems: vodCount
				};
			} catch {
				// Content stats not required for test success
			}

			return {
				success: true,
				accountInfo,
				serverInfo,
				contentStats
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[StalkerPortalClient] Test failed', { error: message });

			return {
				success: false,
				error: message
			};
		}
	}

	/**
	 * Clear cached token and stream links (useful when credentials change)
	 */
	clearToken(): void {
		this.token = null;
		this.streamLinkCache.clear();
		this.stopWatchdog();
	}

	/**
	 * Cleanup resources (call on shutdown)
	 */
	destroy(): void {
		this.stopWatchdog();
		this.streamLinkCache.clear();
		this.token = null;
	}
}
