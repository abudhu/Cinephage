/**
 * NzbStreamService - Coordinates NZB streaming operations.
 *
 * Central service for creating streams, managing parsed NZB cache,
 * and coordinating NNTP fetches.
 */

import { logger } from '$lib/logging';
import { getNntpClientManager } from './nntp/NntpClientManager';
import { type ParsedNzb } from './NzbParser';
import { getNzbMountManager, type MountInfo } from './NzbMountManager';
import { NzbSeekableStream, parseRangeHeader } from './streams/NzbSeekableStream';

/**
 * Cached parsed NZB for active streams.
 */
interface CachedNzb {
	parsed: ParsedNzb;
	timestamp: number;
}

/**
 * Stream creation result.
 */
export interface CreateStreamResult {
	stream: NzbSeekableStream;
	contentLength: number;
	startByte: number;
	endByte: number;
	totalSize: number;
	isPartial: boolean;
	contentType: string;
}

/**
 * NZB cache TTL (1 hour).
 */
const NZB_CACHE_TTL = 60 * 60 * 1000;

/**
 * NzbStreamService manages streaming operations.
 */
class NzbStreamService {
	private nzbCache: Map<string, CachedNzb> = new Map();
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		// Periodic cache cleanup
		this.cleanupInterval = setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
	}

	/**
	 * Create a stream for a mount file.
	 */
	async createStream(
		mountId: string,
		fileIndex: number,
		rangeHeader: string | null
	): Promise<CreateStreamResult> {
		const mountManager = getNzbMountManager();
		const clientManager = getNntpClientManager();

		// Get mount info
		const mount = await mountManager.getMount(mountId);
		if (!mount) {
			throw new Error(`Mount not found: ${mountId}`);
		}

		if (mount.status !== 'ready') {
			throw new Error(`Mount not ready: ${mount.status}`);
		}

		// Get the parsed NZB (from cache or re-fetch)
		const parsed = await this.getParsedNzb(mount);

		// Find the file
		const file = parsed.files.find((f) => f.index === fileIndex);
		if (!file) {
			throw new Error(`File not found at index ${fileIndex}`);
		}

		// Update access time
		await mountManager.touchMount(mountId);

		// Parse range header
		const range = parseRangeHeader(rangeHeader, file.size);

		// Create stream
		const stream = new NzbSeekableStream({
			file,
			clientManager,
			range: range ?? undefined,
			prefetchCount: 5
		});

		const contentType = this.detectContentType(file.name);

		logger.info('[NzbStreamService] Created stream', {
			mountId,
			fileIndex,
			fileName: file.name,
			range: range ? `${range.start}-${range.end}` : 'full',
			contentType
		});

		return {
			stream,
			contentLength: stream.contentLength,
			startByte: stream.startByte,
			endByte: stream.endByte,
			totalSize: stream.totalSize,
			isPartial: range !== null,
			contentType
		};
	}

	/**
	 * Get parsed NZB from cache or storage.
	 */
	private async getParsedNzb(mount: MountInfo): Promise<ParsedNzb> {
		// Check cache
		const cached = this.nzbCache.get(mount.nzbHash);
		if (cached && Date.now() - cached.timestamp < NZB_CACHE_TTL) {
			return cached.parsed;
		}

		// Need to re-fetch and parse NZB
		// For now, we need the NZB content stored somewhere
		// In the full implementation, we'd store the NZB content or fetch from downloadUrl

		// Check if we have mediaFiles with full segment data
		// If not, we need to re-fetch the NZB
		if (mount.mediaFiles.length > 0 && mount.mediaFiles[0].segments?.length > 0) {
			// We have full data, reconstruct ParsedNzb
			const parsed: ParsedNzb = {
				hash: mount.nzbHash,
				files: mount.mediaFiles,
				mediaFiles: mount.mediaFiles.filter((f) => !f.isRar),
				totalSize: mount.totalSize,
				groups: mount.mediaFiles.flatMap((f) => f.groups).filter((v, i, a) => a.indexOf(v) === i)
			};

			this.nzbCache.set(mount.nzbHash, { parsed, timestamp: Date.now() });
			return parsed;
		}

		throw new Error('NZB content not available - mount needs to be recreated');
	}

	/**
	 * Store parsed NZB in cache.
	 */
	cacheNzb(hash: string, parsed: ParsedNzb): void {
		this.nzbCache.set(hash, {
			parsed,
			timestamp: Date.now()
		});
	}

	/**
	 * Check if NNTP service is ready.
	 */
	isReady(): boolean {
		const manager = getNntpClientManager();
		return manager.status === 'ready';
	}

	/**
	 * Get service status info.
	 */
	getStatus(): { ready: boolean; providers: number; pools: Record<string, unknown> } {
		const manager = getNntpClientManager();
		return {
			ready: manager.status === 'ready',
			providers: Object.keys(manager.getStats()).length,
			pools: manager.getStats()
		};
	}

	/**
	 * Detect content type from filename.
	 */
	private detectContentType(filename: string): string {
		const ext = filename.toLowerCase().split('.').pop() || '';

		const types: Record<string, string> = {
			// Video
			mkv: 'video/x-matroska',
			mp4: 'video/mp4',
			avi: 'video/x-msvideo',
			mov: 'video/quicktime',
			wmv: 'video/x-ms-wmv',
			flv: 'video/x-flv',
			webm: 'video/webm',
			m4v: 'video/x-m4v',
			mpg: 'video/mpeg',
			mpeg: 'video/mpeg',
			ts: 'video/mp2t',
			m2ts: 'video/mp2t',
			vob: 'video/dvd',
			// Audio
			mp3: 'audio/mpeg',
			flac: 'audio/flac',
			aac: 'audio/aac',
			ogg: 'audio/ogg',
			wav: 'audio/wav',
			m4a: 'audio/x-m4a',
			wma: 'audio/x-ms-wma'
		};

		return types[ext] || 'application/octet-stream';
	}

	/**
	 * Cleanup old cache entries.
	 */
	private cleanupCache(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [hash, cached] of this.nzbCache) {
			if (now - cached.timestamp > NZB_CACHE_TTL) {
				this.nzbCache.delete(hash);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.debug('[NzbStreamService] Cleaned NZB cache', { count: cleaned });
		}
	}

	/**
	 * Shutdown the service.
	 */
	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		this.nzbCache.clear();
	}
}

// Singleton instance
let instance: NzbStreamService | null = null;

/**
 * Get the singleton NzbStreamService.
 */
export function getNzbStreamService(): NzbStreamService {
	if (!instance) {
		instance = new NzbStreamService();
	}
	return instance;
}
