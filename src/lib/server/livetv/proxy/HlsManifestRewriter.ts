/**
 * HlsManifestRewriter - Rewrite HLS manifest URLs to route through our proxy.
 *
 * Based on Stalkerhek's utils_m3u8.go rewriteLinks function.
 * This ensures HLS segment requests go through our proxy for:
 * - Authentication header injection
 * - Session keepalive
 * - Error recovery
 */

/**
 * Regex to extract URI values from attributes like EXT-X-KEY, EXT-X-MAP.
 * Matches: URI="some/path/here"
 */
const URI_REGEX = /URI="([^"]*)"/g;

/**
 * Delete everything after the last slash to get the base path.
 * e.g., "http://example.com/live/playlist.m3u8" -> "http://example.com/live/"
 */
export function getBasePath(url: string): string {
	const lastSlashIndex = url.lastIndexOf('/');
	if (lastSlashIndex === -1) {
		return url + '/';
	}
	return url.substring(0, lastSlashIndex + 1);
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(link: string, baseUrl: string): string {
	// Already absolute URL with protocol
	if (link.startsWith('http://') || link.startsWith('https://')) {
		return link;
	}

	try {
		const base = new URL(baseUrl);

		// Protocol-relative URL
		if (link.startsWith('//')) {
			return base.protocol + link;
		}

		// Absolute path
		if (link.startsWith('/')) {
			return base.origin + link;
		}

		// Relative path - resolve against base
		return new URL(link, baseUrl).href;
	} catch {
		// If URL parsing fails, return as-is
		return link;
	}
}

/**
 * Convert an absolute URL to a relative path for our proxy.
 * We need to encode the path so it can be passed through our proxy.
 */
function urlToProxyPath(absoluteUrl: string, originalRoot: string): string {
	// If the URL starts with the original root, strip it
	if (absoluteUrl.startsWith(originalRoot)) {
		return absoluteUrl.substring(originalRoot.length);
	}

	// For URLs outside the original root, we need to encode the full URL
	// This handles cases like CDN URLs different from the manifest origin
	return encodeURIComponent(absoluteUrl);
}

/**
 * Modify a link to route through our proxy.
 *
 * @param link - Original link from manifest (may be relative or absolute)
 * @param proxyPrefix - Our proxy URL prefix (e.g., "/api/livetv/stream/acc123/ch456/")
 * @param originalRoot - Original base URL of the manifest
 * @returns Modified link pointing to our proxy
 */
function modifyLink(link: string, proxyPrefix: string, originalRoot: string): string {
	// Resolve to absolute URL first
	const absoluteUrl = resolveUrl(link, originalRoot);

	// Convert to proxy path
	const proxyPath = urlToProxyPath(absoluteUrl, originalRoot);

	// Build final proxy URL
	return proxyPrefix + proxyPath;
}

/**
 * Rewrite all URLs in an HLS manifest to route through our proxy.
 *
 * Handles:
 * - Segment URLs (lines not starting with #)
 * - URI attributes in EXT-X-KEY, EXT-X-MAP, etc.
 * - Both relative and absolute URLs
 *
 * @param manifest - The HLS manifest content
 * @param proxyPrefix - Our proxy URL prefix (should end with /)
 * @param originalRoot - Original base URL of the manifest (should end with /)
 * @returns Rewritten manifest
 */
export function rewriteManifest(
	manifest: string,
	proxyPrefix: string,
	originalRoot: string
): string {
	// Ensure prefix ends with /
	const prefix = proxyPrefix.endsWith('/') ? proxyPrefix : proxyPrefix + '/';
	// Ensure root ends with /
	const root = originalRoot.endsWith('/') ? originalRoot : originalRoot + '/';

	const lines = manifest.split('\n');
	const result: string[] = [];

	for (const line of lines) {
		let processedLine = line;

		// Process non-comment lines (segment URLs)
		if (!line.startsWith('#') && line.trim() !== '') {
			processedLine = modifyLink(line.trim(), prefix, root);
		}
		// Process lines with URI attributes
		else if (line.includes('URI="') && !line.includes('URI=""')) {
			// Replace all URI="..." occurrences
			processedLine = line.replace(URI_REGEX, (match, uri) => {
				const newUri = modifyLink(uri, prefix, root);
				return `URI="${newUri}"`;
			});
		}

		result.push(processedLine);
	}

	return result.join('\n');
}

/**
 * Extract the HLS root URL from a stream URL.
 * Handles the initial redirect from Stalker portal to actual stream.
 *
 * @param streamUrl - The resolved stream URL
 * @returns Base path for resolving relative URLs in manifest
 */
export function extractHlsRoot(streamUrl: string): string {
	return getBasePath(streamUrl);
}

/**
 * Check if a path component is a URL-encoded absolute URL.
 * Used to detect when we need to decode and fetch from external CDN.
 */
export function isEncodedUrl(path: string): boolean {
	const decoded = decodeURIComponent(path);
	return decoded.startsWith('http://') || decoded.startsWith('https://');
}

/**
 * Resolve a segment path to a fetchable URL.
 *
 * @param segmentPath - The path from the proxy request (may be relative or encoded URL)
 * @param hlsRoot - The HLS manifest root URL
 * @returns Full URL to fetch the segment from
 */
export function resolveSegmentUrl(segmentPath: string, hlsRoot: string): string {
	// Check if it's an encoded absolute URL
	if (isEncodedUrl(segmentPath)) {
		return decodeURIComponent(segmentPath);
	}

	// Otherwise resolve relative to HLS root
	return resolveUrl(segmentPath, hlsRoot);
}
