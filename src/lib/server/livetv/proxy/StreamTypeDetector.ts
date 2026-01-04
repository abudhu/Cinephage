/**
 * StreamTypeDetector - Detect stream type from Content-Type header.
 *
 * Based on Stalkerhek's getLinkType pattern to differentiate between
 * HLS streams (which need manifest rewriting) and direct media streams.
 */

/**
 * Stream types that determine how we handle the content.
 */
export type StreamType = 'hls' | 'media';

/**
 * Content-Type values that indicate HLS streams.
 */
const HLS_CONTENT_TYPES = [
	'application/vnd.apple.mpegurl',
	'application/x-mpegurl',
	'audio/mpegurl',
	'audio/x-mpegurl'
];

/**
 * Content-Type prefixes that indicate direct media streams.
 */
const MEDIA_CONTENT_TYPE_PREFIXES = ['video/', 'audio/'];

/**
 * Content-Type values that indicate binary/media content.
 */
const MEDIA_CONTENT_TYPES = ['application/octet-stream'];

/**
 * Detect stream type from Content-Type header.
 *
 * Based on Stalkerhek's utils.go getLinkType function:
 * - HLS: application/vnd.apple.mpegurl, application/x-mpegurl
 * - Media: video/*, audio/*, application/octet-stream
 *
 * @param contentType - The Content-Type header value
 * @returns The detected stream type
 */
export function detectStreamType(contentType: string): StreamType {
	const normalized = contentType.toLowerCase().split(';')[0].trim();

	// Check for HLS content types
	if (HLS_CONTENT_TYPES.includes(normalized)) {
		return 'hls';
	}

	// Check for media content type prefixes
	for (const prefix of MEDIA_CONTENT_TYPE_PREFIXES) {
		if (normalized.startsWith(prefix)) {
			return 'media';
		}
	}

	// Check for specific media content types
	if (MEDIA_CONTENT_TYPES.includes(normalized)) {
		return 'media';
	}

	// Default to media for unknown types (Stalkerhek behavior)
	return 'media';
}

/**
 * Check if content type indicates HLS stream.
 */
export function isHlsContentType(contentType: string): boolean {
	return detectStreamType(contentType) === 'hls';
}

/**
 * Check if content type indicates media stream.
 */
export function isMediaContentType(contentType: string): boolean {
	return detectStreamType(contentType) === 'media';
}

/**
 * Get the appropriate Content-Type for proxied response.
 * Preserves original Content-Type for media, ensures correct type for HLS.
 */
export function getProxyContentType(originalContentType: string, streamType: StreamType): string {
	if (streamType === 'hls') {
		// Always return standard HLS content type for manifest
		return 'application/vnd.apple.mpegurl';
	}
	// Preserve original for media
	return originalContentType;
}
