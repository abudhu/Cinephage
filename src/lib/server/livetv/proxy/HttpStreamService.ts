/**
 * HttpStreamService - HTTP passthrough streaming service.
 *
 * Replaces FFmpegStreamService with simple HTTP proxying like Stalkerhek.
 * Features:
 * - Manual redirect handling (avoids Referer header issues)
 * - Retry with exponential backoff
 * - Stream tracking for monitoring
 * - Header preservation
 */

import { logger } from '$lib/logging';
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryConfig } from './StalkerRetry';
import { detectStreamType, type StreamType } from './StreamTypeDetector';
import { rewriteManifest, getBasePath } from './HlsManifestRewriter';

/**
 * Active stream tracking information.
 */
export interface ActiveStream {
	key: string;
	accountId: string;
	channelId: string;
	channelName: string;
	clientIp: string;
	startedAt: Date;
	streamType: StreamType;
	hlsRoot?: string;
}

/**
 * Stream fetch result containing response and metadata.
 */
export interface StreamFetchResult {
	response: Response;
	streamType: StreamType;
	hlsRoot?: string;
	finalUrl: string;
}

/**
 * Headers to preserve when proxying responses.
 * Based on Stalkerhek's addHeaders function.
 */
const PRESERVED_HEADERS = [
	'content-type',
	'transfer-encoding',
	'cache-control',
	'date',
	'connection'
];

/**
 * Headers to preserve for media (not HLS) responses.
 * Content-Length should only be preserved for unaltered media.
 */
const MEDIA_ONLY_HEADERS = ['content-length'];

/**
 * Maximum redirect depth to prevent infinite loops.
 */
const MAX_REDIRECTS = 10;

/**
 * User agent for stream requests.
 */
const STREAM_USER_AGENT =
	'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3';

class HttpStreamService {
	private activeStreams: Map<string, ActiveStream> = new Map();

	/**
	 * Fetch a stream URL with manual redirect handling.
	 *
	 * Based on Stalkerhek's response() function which:
	 * - Doesn't follow redirects automatically (avoids Referer issues)
	 * - Manually follows redirects
	 * - Returns the final response
	 */
	async fetchStream(
		url: string,
		headers: Record<string, string>,
		retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
	): Promise<StreamFetchResult> {
		return withRetry(retryConfig, async () => {
			const result = await this.fetchWithRedirects(url, headers);
			return result;
		});
	}

	/**
	 * Internal fetch with manual redirect handling.
	 */
	private async fetchWithRedirects(
		url: string,
		headers: Record<string, string>,
		redirectCount: number = 0
	): Promise<StreamFetchResult> {
		if (redirectCount >= MAX_REDIRECTS) {
			throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
		}

		logger.debug('[HttpStreamService] Fetching', { url, redirectCount });

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'User-Agent': STREAM_USER_AGENT,
				...headers
			},
			redirect: 'manual' // Don't follow redirects automatically
		});

		// Handle redirects manually (like Stalkerhek)
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('Location');
			if (!location) {
				throw new Error(`Redirect response without Location header`);
			}

			// Resolve relative redirect URLs
			const redirectUrl = new URL(location, url).href;

			logger.debug('[HttpStreamService] Following redirect', {
				from: url,
				to: redirectUrl
			});

			// Follow redirect without Referer header (Stalkerhek pattern)
			return this.fetchWithRedirects(redirectUrl, headers, redirectCount + 1);
		}

		// Handle error responses
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		// Detect stream type from Content-Type
		const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
		const streamType = detectStreamType(contentType);

		return {
			response,
			streamType,
			hlsRoot: streamType === 'hls' ? getBasePath(url) : undefined,
			finalUrl: url
		};
	}

	/**
	 * Process an HLS manifest response - rewrite URLs to route through proxy.
	 */
	async processHlsManifest(
		response: Response,
		proxyPrefix: string,
		hlsRoot: string
	): Promise<string> {
		const manifest = await response.text();
		return rewriteManifest(manifest, proxyPrefix, hlsRoot);
	}

	/**
	 * Create proxy response headers from upstream response.
	 *
	 * @param upstreamHeaders - Headers from upstream response
	 * @param isMedia - True if this is a media response (not HLS manifest)
	 */
	createProxyHeaders(upstreamHeaders: Headers, isMedia: boolean): Record<string, string> {
		const result: Record<string, string> = {};

		// Add preserved headers
		for (const header of PRESERVED_HEADERS) {
			const value = upstreamHeaders.get(header);
			if (value) {
				result[header] = value;
			}
		}

		// Add media-only headers
		if (isMedia) {
			for (const header of MEDIA_ONLY_HEADERS) {
				const value = upstreamHeaders.get(header);
				if (value) {
					result[header] = value;
				}
			}
		}

		// Always add CORS header
		result['Access-Control-Allow-Origin'] = '*';

		return result;
	}

	/**
	 * Register an active stream for monitoring.
	 */
	registerStream(stream: ActiveStream): void {
		this.activeStreams.set(stream.key, stream);
		logger.info('[HttpStreamService] Stream registered', {
			key: stream.key,
			channel: stream.channelName,
			type: stream.streamType,
			clientIp: stream.clientIp
		});
	}

	/**
	 * Unregister a stream.
	 */
	unregisterStream(key: string): void {
		const stream = this.activeStreams.get(key);
		if (stream) {
			const duration = Date.now() - stream.startedAt.getTime();
			this.activeStreams.delete(key);
			logger.info('[HttpStreamService] Stream ended', {
				key,
				channel: stream.channelName,
				durationMs: duration
			});
		}
	}

	/**
	 * Get all active streams.
	 */
	getActiveStreams(): ActiveStream[] {
		return Array.from(this.activeStreams.values());
	}

	/**
	 * Get active stream count.
	 */
	getActiveStreamCount(): number {
		return this.activeStreams.size;
	}

	/**
	 * Get a specific active stream.
	 */
	getStream(key: string): ActiveStream | undefined {
		return this.activeStreams.get(key);
	}
}

// Singleton instance
let instance: HttpStreamService | null = null;

export function getHttpStreamService(): HttpStreamService {
	if (!instance) {
		instance = new HttpStreamService();
	}
	return instance;
}

export type { HttpStreamService };
