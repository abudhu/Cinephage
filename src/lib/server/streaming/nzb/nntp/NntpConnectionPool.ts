/**
 * NntpConnectionPool - Manages a pool of NNTP connections to a single server.
 *
 * Provides connection reuse and concurrent request handling.
 */

import { logger } from '$lib/logging';
import { NntpClient } from './NntpClient';
import type { NntpServerConfig } from './types';

/**
 * Pooled connection wrapper.
 */
interface PooledConnection {
	client: NntpClient;
	inUse: boolean;
	lastUsed: number;
	requestCount: number;
}

/**
 * NntpConnectionPool manages a pool of connections to a single NNTP server.
 */
export class NntpConnectionPool {
	private config: NntpServerConfig;
	private connections: PooledConnection[] = [];
	private maxConnections: number;
	private pendingRequests: Array<{
		resolve: (client: NntpClient) => void;
		reject: (error: Error) => void;
	}> = [];
	private closed = false;

	// Stats
	private totalRequests = 0;
	private failedRequests = 0;

	constructor(config: NntpServerConfig) {
		this.config = config;
		this.maxConnections = config.maxConnections ?? 10;
	}

	/**
	 * Get server host for identification.
	 */
	get host(): string {
		return this.config.host;
	}

	/**
	 * Get pool statistics.
	 */
	get stats(): { total: number; inUse: number; available: number; pending: number } {
		const inUse = this.connections.filter((c) => c.inUse).length;
		return {
			total: this.connections.length,
			inUse,
			available: this.connections.length - inUse,
			pending: this.pendingRequests.length
		};
	}

	/**
	 * Acquire a connection from the pool.
	 * Returns an available connection or creates a new one.
	 */
	async acquire(): Promise<NntpClient> {
		if (this.closed) {
			throw new Error('Pool is closed');
		}

		this.totalRequests++;

		// Try to find an available connection
		const available = this.connections.find((c) => !c.inUse && c.client.isReady);
		if (available) {
			available.inUse = true;
			available.lastUsed = Date.now();
			available.requestCount++;
			return available.client;
		}

		// Create new connection if under limit
		if (this.connections.length < this.maxConnections) {
			const client = new NntpClient(this.config);

			try {
				await client.connect();

				const pooled: PooledConnection = {
					client,
					inUse: true,
					lastUsed: Date.now(),
					requestCount: 1
				};

				this.connections.push(pooled);
				logger.debug(
					`[NntpPool] Created connection ${this.connections.length}/${this.maxConnections}`,
					{
						host: this.config.host
					}
				);

				return client;
			} catch (error) {
				this.failedRequests++;
				throw error;
			}
		}

		// Wait for a connection to become available
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				const idx = this.pendingRequests.findIndex((r) => r.resolve === resolve);
				if (idx !== -1) {
					this.pendingRequests.splice(idx, 1);
				}
				reject(new Error('Connection pool timeout'));
			}, 30000);

			this.pendingRequests.push({
				resolve: (client) => {
					clearTimeout(timeout);
					resolve(client);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				}
			});
		});
	}

	/**
	 * Release a connection back to the pool.
	 */
	release(client: NntpClient): void {
		const pooled = this.connections.find((c) => c.client === client);
		if (!pooled) {
			return;
		}

		pooled.inUse = false;
		pooled.lastUsed = Date.now();

		// Check if there are pending requests
		if (this.pendingRequests.length > 0 && client.isReady) {
			const pending = this.pendingRequests.shift();
			if (pending) {
				pooled.inUse = true;
				pooled.requestCount++;
				pending.resolve(client);
			}
		}
	}

	/**
	 * Get an article body by message ID.
	 * Handles connection acquisition and release automatically.
	 */
	async getArticle(messageId: string): Promise<Buffer> {
		const client = await this.acquire();

		try {
			const body = await client.body(messageId);
			this.release(client);
			return body;
		} catch (error) {
			this.failedRequests++;

			// Check if connection is still valid
			if (!client.isReady) {
				// Remove dead connection from pool
				const idx = this.connections.findIndex((c) => c.client === client);
				if (idx !== -1) {
					this.connections.splice(idx, 1);
					logger.debug(`[NntpPool] Removed dead connection, ${this.connections.length} remaining`, {
						host: this.config.host
					});
				}
			} else {
				this.release(client);
			}

			throw error;
		}
	}

	/**
	 * Check if an article exists.
	 */
	async checkArticle(messageId: string): Promise<boolean> {
		const client = await this.acquire();

		try {
			const exists = await client.stat(messageId);
			this.release(client);
			return exists;
		} catch {
			this.release(client);
			return false;
		}
	}

	/**
	 * Close all connections in the pool.
	 */
	async close(): Promise<void> {
		this.closed = true;

		// Reject pending requests
		for (const pending of this.pendingRequests) {
			pending.reject(new Error('Pool closed'));
		}
		this.pendingRequests = [];

		// Disconnect all clients
		const disconnects = this.connections.map(async (c) => {
			try {
				await c.client.disconnect();
			} catch {
				// Ignore disconnect errors
			}
		});

		await Promise.allSettled(disconnects);
		this.connections = [];

		logger.info(`[NntpPool] Closed pool`, {
			host: this.config.host,
			totalRequests: this.totalRequests,
			failedRequests: this.failedRequests
		});
	}

	/**
	 * Clean up idle connections.
	 */
	cleanupIdle(maxIdleMs: number = 60000): void {
		const now = Date.now();
		const toRemove: PooledConnection[] = [];

		for (const conn of this.connections) {
			if (!conn.inUse && now - conn.lastUsed > maxIdleMs) {
				toRemove.push(conn);
			}
		}

		for (const conn of toRemove) {
			const idx = this.connections.indexOf(conn);
			if (idx !== -1) {
				this.connections.splice(idx, 1);
				conn.client.disconnect().catch(() => {});
			}
		}

		if (toRemove.length > 0) {
			logger.debug(`[NntpPool] Cleaned up ${toRemove.length} idle connections`, {
				host: this.config.host,
				remaining: this.connections.length
			});
		}
	}
}
