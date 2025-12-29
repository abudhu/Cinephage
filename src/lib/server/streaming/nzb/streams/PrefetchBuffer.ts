/**
 * PrefetchBuffer - Manages prefetching of upcoming segments.
 *
 * Prefetches segments ahead of the current position to ensure
 * smooth streaming without stalls.
 */

import { logger } from '$lib/logging';
import type { NntpClientManager } from '../nntp/NntpClientManager';
import type { NzbSegment } from '../NzbParser';
import type { CachedSegment } from './types';

/**
 * PrefetchBuffer caches decoded segments for streaming.
 */
export class PrefetchBuffer {
	private cache: Map<number, CachedSegment> = new Map();
	private pendingFetches: Map<number, Promise<Buffer>> = new Map();
	private prefetchCount: number;
	private maxCacheSize: number;
	private clientManager: NntpClientManager;
	private segments: NzbSegment[];
	private group: string;

	constructor(
		clientManager: NntpClientManager,
		segments: NzbSegment[],
		group: string,
		options: { prefetchCount?: number; maxCacheSize?: number } = {}
	) {
		this.clientManager = clientManager;
		this.segments = segments;
		this.group = group;
		this.prefetchCount = options.prefetchCount ?? 5;
		this.maxCacheSize = options.maxCacheSize ?? 20;
	}

	/**
	 * Get a segment, fetching if not cached.
	 */
	async getSegment(index: number): Promise<Buffer> {
		// Check cache first
		const cached = this.cache.get(index);
		if (cached) {
			return cached.data;
		}

		// Check if already fetching
		const pending = this.pendingFetches.get(index);
		if (pending) {
			return pending;
		}

		// Fetch the segment
		const data = await this.fetchSegment(index);

		// Trigger prefetch of upcoming segments
		this.triggerPrefetch(index);

		return data;
	}

	/**
	 * Fetch a single segment from NNTP.
	 */
	private async fetchSegment(index: number): Promise<Buffer> {
		if (index < 0 || index >= this.segments.length) {
			throw new Error(`Segment index out of range: ${index}`);
		}

		const segment = this.segments[index];
		const fetchPromise = this.doFetch(segment, index);
		this.pendingFetches.set(index, fetchPromise);

		try {
			const data = await fetchPromise;

			// Cache the result
			this.cacheSegment(index, data);

			return data;
		} finally {
			this.pendingFetches.delete(index);
		}
	}

	/**
	 * Perform the actual NNTP fetch and decode.
	 */
	private async doFetch(segment: NzbSegment, index: number): Promise<Buffer> {
		const startTime = Date.now();

		try {
			const result = await this.clientManager.getDecodedArticle(segment.messageId);

			logger.debug('[PrefetchBuffer] Fetched segment', {
				index,
				messageId: segment.messageId.slice(0, 20),
				size: result.data.length,
				ms: Date.now() - startTime
			});

			return result.data;
		} catch (error) {
			logger.error('[PrefetchBuffer] Failed to fetch segment', {
				index,
				messageId: segment.messageId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			throw error;
		}
	}

	/**
	 * Cache a segment, evicting old entries if needed.
	 */
	private cacheSegment(index: number, data: Buffer): void {
		// Evict old entries if cache is full
		if (this.cache.size >= this.maxCacheSize) {
			this.evictOldest();
		}

		this.cache.set(index, {
			index,
			data,
			timestamp: Date.now()
		});
	}

	/**
	 * Evict oldest entries from cache.
	 */
	private evictOldest(): void {
		// Find entries to evict (oldest first)
		const entries = Array.from(this.cache.entries()).sort(
			(a, b) => a[1].timestamp - b[1].timestamp
		);

		// Evict half the cache
		const toEvict = Math.ceil(this.maxCacheSize / 2);
		for (let i = 0; i < toEvict && i < entries.length; i++) {
			this.cache.delete(entries[i][0]);
		}

		logger.debug('[PrefetchBuffer] Evicted cache entries', { evicted: toEvict });
	}

	/**
	 * Trigger prefetch of upcoming segments.
	 */
	private triggerPrefetch(currentIndex: number): void {
		for (let i = 1; i <= this.prefetchCount; i++) {
			const nextIndex = currentIndex + i;

			// Don't prefetch beyond end
			if (nextIndex >= this.segments.length) {
				break;
			}

			// Skip if already cached or fetching
			if (this.cache.has(nextIndex) || this.pendingFetches.has(nextIndex)) {
				continue;
			}

			// Start prefetch (don't await)
			this.fetchSegment(nextIndex).catch((error) => {
				logger.warn('[PrefetchBuffer] Prefetch failed', {
					index: nextIndex,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			});
		}
	}

	/**
	 * Check if a segment is cached.
	 */
	isCached(index: number): boolean {
		return this.cache.has(index);
	}

	/**
	 * Check if a segment is being fetched.
	 */
	isPending(index: number): boolean {
		return this.pendingFetches.has(index);
	}

	/**
	 * Clear all cached data.
	 */
	clear(): void {
		this.cache.clear();
		// Note: pending fetches will complete but won't be cached
	}

	/**
	 * Get cache statistics.
	 */
	get stats(): { cached: number; pending: number; maxSize: number } {
		return {
			cached: this.cache.size,
			pending: this.pendingFetches.size,
			maxSize: this.maxCacheSize
		};
	}
}
