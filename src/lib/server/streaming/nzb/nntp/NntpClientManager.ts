/**
 * NntpClientManager - BackgroundService that manages NNTP connection pools.
 *
 * Coordinates multiple NNTP providers with failover support.
 */

import type { BackgroundService, ServiceStatus } from '$lib/server/services/background-service';
import { logger } from '$lib/logging';
import { getNntpServerService } from '../NntpServerService';
import { NntpConnectionPool } from './NntpConnectionPool';
import type { NntpServerConfig } from './types';
import { decodeYenc, extractYencHeader } from './YencDecoder';
import type { YencDecodeResult, YencHeader } from './types';

/**
 * Article not found on any provider.
 */
export class ArticleNotFoundError extends Error {
	constructor(messageId: string) {
		super(`Article not found: ${messageId}`);
		this.name = 'ArticleNotFoundError';
	}
}

/**
 * NntpClientManager manages connection pools across multiple NNTP providers.
 */
export class NntpClientManager implements BackgroundService {
	readonly name = 'NntpClientManager';
	private _status: ServiceStatus = 'pending';

	private pools: Map<string, NntpConnectionPool> = new Map();
	private providerOrder: string[] = [];
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	get status(): ServiceStatus {
		return this._status;
	}

	/**
	 * Start the service (non-blocking).
	 */
	start(): void {
		this._status = 'starting';

		setImmediate(async () => {
			try {
				await this.initialize();
				this._status = 'ready';
				logger.info('[NntpClientManager] Service ready', { providers: this.providerOrder.length });
			} catch (error) {
				this._status = 'error';
				logger.error('[NntpClientManager] Failed to start', {
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		});
	}

	/**
	 * Stop the service.
	 */
	async stop(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		const closes = Array.from(this.pools.values()).map((pool) => pool.close());
		await Promise.allSettled(closes);

		this.pools.clear();
		this.providerOrder = [];
		this._status = 'pending';

		logger.info('[NntpClientManager] Service stopped');
	}

	/**
	 * Initialize connection pools from database.
	 */
	private async initialize(): Promise<void> {
		const service = getNntpServerService();
		const servers = await service.getEnabledServers();

		// Sort by priority (lower = higher priority)
		servers.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

		for (const server of servers) {
			const config: NntpServerConfig = {
				host: server.host,
				port: server.port,
				useSsl: server.useSsl ?? true,
				username: server.username ?? undefined,
				password: server.password ?? undefined,
				maxConnections: server.maxConnections ?? 10
			};

			const pool = new NntpConnectionPool(config);
			this.pools.set(server.id, pool);
			this.providerOrder.push(server.id);

			logger.debug('[NntpClientManager] Added provider pool', {
				id: server.id,
				host: server.host,
				priority: server.priority
			});
		}

		// Set up periodic cleanup
		this.cleanupInterval = setInterval(() => {
			for (const pool of this.pools.values()) {
				pool.cleanupIdle();
			}
		}, 60000);
	}

	/**
	 * Reload providers from database.
	 */
	async reload(): Promise<void> {
		logger.info('[NntpClientManager] Reloading providers');

		// Close existing pools
		for (const pool of this.pools.values()) {
			await pool.close();
		}
		this.pools.clear();
		this.providerOrder = [];

		// Reinitialize
		await this.initialize();
	}

	/**
	 * Get raw article body by message ID.
	 * Tries providers in priority order until successful.
	 */
	async getArticle(messageId: string): Promise<Buffer> {
		if (this._status !== 'ready') {
			throw new Error('Service not ready');
		}

		if (this.providerOrder.length === 0) {
			throw new Error('No NNTP providers configured');
		}

		const errors: string[] = [];

		for (const providerId of this.providerOrder) {
			const pool = this.pools.get(providerId);
			if (!pool) continue;

			try {
				const body = await pool.getArticle(messageId);
				return body;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				errors.push(`${pool.host}: ${message}`);
				logger.debug(`[NntpClientManager] Provider failed for ${messageId}`, {
					provider: pool.host,
					error: message
				});
				// Try next provider
				continue;
			}
		}

		throw new ArticleNotFoundError(
			`${messageId} (tried ${errors.length} providers: ${errors.join(', ')})`
		);
	}

	/**
	 * Get decoded article content (yEnc decoded).
	 */
	async getDecodedArticle(messageId: string): Promise<YencDecodeResult> {
		const body = await this.getArticle(messageId);
		return decodeYenc(body);
	}

	/**
	 * Get only the yEnc header for an article.
	 * Useful for determining byte ranges without full download.
	 */
	async getArticleHeader(messageId: string): Promise<YencHeader | null> {
		const body = await this.getArticle(messageId);
		return extractYencHeader(body);
	}

	/**
	 * Check if an article exists on any provider.
	 */
	async articleExists(messageId: string): Promise<boolean> {
		if (this._status !== 'ready' || this.providerOrder.length === 0) {
			return false;
		}

		for (const providerId of this.providerOrder) {
			const pool = this.pools.get(providerId);
			if (!pool) continue;

			try {
				const exists = await pool.checkArticle(messageId);
				if (exists) return true;
			} catch {
				continue;
			}
		}

		return false;
	}

	/**
	 * Get pool statistics.
	 */
	getStats(): Record<
		string,
		{ host: string; stats: { total: number; inUse: number; available: number; pending: number } }
	> {
		const result: Record<
			string,
			{ host: string; stats: { total: number; inUse: number; available: number; pending: number } }
		> = {};

		for (const [id, pool] of this.pools) {
			result[id] = {
				host: pool.host,
				stats: pool.stats
			};
		}

		return result;
	}
}

// Singleton instance
let instance: NntpClientManager | null = null;

/**
 * Get the singleton NntpClientManager instance.
 */
export function getNntpClientManager(): NntpClientManager {
	if (!instance) {
		instance = new NntpClientManager();
	}
	return instance;
}
