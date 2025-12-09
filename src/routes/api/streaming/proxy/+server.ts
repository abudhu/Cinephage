/**
 * HLS Stream Proxy
 *
 * Proxies HLS streams and their segments with proper referer headers.
 * This is essential for streams which require the referer header
 * on ALL requests (master.txt, playlists, and segments).
 *
 * GET /api/streaming/proxy?url=<encoded_url>&referer=<encoded_referer>
 */

import type { RequestHandler } from './$types';
import { getBaseUrlAsync } from '$lib/server/streaming';
import { logger } from '$lib/logging';

// Security constants
const MAX_REDIRECTS = 5;
const ALLOWED_SCHEMES = ['http:', 'https:'];

// Private IP ranges that should be blocked (SSRF protection)
const PRIVATE_IP_PATTERNS = [
	/^127\./, // 127.0.0.0/8 (localhost)
	/^10\./, // 10.0.0.0/8 (private)
	/^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
	/^192\.168\./, // 192.168.0.0/16 (private)
	/^169\.254\./, // 169.254.0.0/16 (link-local)
	/^0\./, // 0.0.0.0/8
	/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
	/^192\.0\.0\./, // 192.0.0.0/24 (IETF protocol assignments)
	/^192\.0\.2\./, // 192.0.2.0/24 (TEST-NET-1)
	/^198\.51\.100\./, // 198.51.100.0/24 (TEST-NET-2)
	/^203\.0\.113\./, // 203.0.113.0/24 (TEST-NET-3)
	/^::1$/, // IPv6 localhost
	/^fc00:/i, // IPv6 unique local
	/^fe80:/i // IPv6 link-local
];

const BLOCKED_HOSTNAMES = ['localhost', 'localhost.localdomain', '[::1]', '0.0.0.0'];

/**
 * Validates that a URL is safe to proxy (not internal/private network)
 */
function isUrlSafe(urlString: string): { safe: boolean; reason?: string } {
	try {
		const url = new URL(urlString);

		// Check scheme
		if (!ALLOWED_SCHEMES.includes(url.protocol)) {
			return { safe: false, reason: `Invalid scheme: ${url.protocol}` };
		}

		// Check for blocked hostnames
		const hostname = url.hostname.toLowerCase();
		if (BLOCKED_HOSTNAMES.includes(hostname)) {
			return { safe: false, reason: 'Blocked hostname' };
		}

		// Check for private IP patterns
		for (const pattern of PRIVATE_IP_PATTERNS) {
			if (pattern.test(hostname)) {
				return { safe: false, reason: 'Private/internal IP address' };
			}
		}

		// Check for IPv6 localhost variations
		if (hostname.startsWith('[') && hostname.includes('::1')) {
			return { safe: false, reason: 'IPv6 localhost' };
		}

		return { safe: true };
	} catch {
		return { safe: false, reason: 'Invalid URL format' };
	}
}

export const GET: RequestHandler = async ({ url, request }) => {
	const targetUrl = url.searchParams.get('url');
	const referer = url.searchParams.get('referer') || 'https://videasy.net';
	const baseUrl = await getBaseUrlAsync(request);

	if (!targetUrl) {
		return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const decodedUrl = decodeURIComponent(targetUrl);

		// SSRF protection: validate URL is safe before proxying
		const safetyCheck = isUrlSafe(decodedUrl);
		if (!safetyCheck.safe) {
			logger.warn('Blocked unsafe URL', { url: decodedUrl, reason: safetyCheck.reason, logCategory: 'streams' });
			return new Response(
				JSON.stringify({ error: 'URL not allowed', reason: safetyCheck.reason }),
				{ status: 403, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const headers: HeadersInit = {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
			Accept: '*/*',
			'Accept-Encoding': 'identity',
			Referer: referer,
			Origin: new URL(referer).origin
		};

		// Follow redirects with loop protection
		let currentUrl = decodedUrl;
		let redirectCount = 0;
		const visitedUrls = new Set<string>();
		let response: Response;

		while (true) {
			// Check for redirect loop
			if (visitedUrls.has(currentUrl)) {
				logger.warn('Redirect loop detected', { url: currentUrl, logCategory: 'streams' });
				return new Response(JSON.stringify({ error: 'Redirect loop detected' }), {
					status: 508,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			visitedUrls.add(currentUrl);

			// Check redirect limit
			if (redirectCount >= MAX_REDIRECTS) {
				logger.warn('Max redirects exceeded', { url: decodedUrl, maxRedirects: MAX_REDIRECTS, logCategory: 'streams' });
				return new Response(
					JSON.stringify({ error: 'Too many redirects', maxRedirects: MAX_REDIRECTS }),
					{ status: 508, headers: { 'Content-Type': 'application/json' } }
				);
			}

			response = await fetch(currentUrl, {
				headers,
				redirect: 'manual'
			});

			// Handle redirects
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				if (location) {
					const redirectUrl = new URL(location, currentUrl).toString();

					// Validate redirect target for SSRF
					const redirectSafetyCheck = isUrlSafe(redirectUrl);
					if (!redirectSafetyCheck.safe) {
						logger.warn('Blocked unsafe redirect', {
							url: redirectUrl,
							reason: redirectSafetyCheck.reason,
							logCategory: 'streams'
						});
						return new Response(
							JSON.stringify({
								error: 'Redirect target not allowed',
								reason: redirectSafetyCheck.reason
							}),
							{ status: 403, headers: { 'Content-Type': 'application/json' } }
						);
					}

					currentUrl = redirectUrl;
					redirectCount++;
					continue;
				}
			}

			// Not a redirect, break out of loop
			break;
		}

		if (!response.ok) {
			return new Response(JSON.stringify({ error: `Upstream error: ${response.status}` }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const contentType = response.headers.get('content-type') || '';
		const arrayBuffer = await response.arrayBuffer();
		const firstBytes = new Uint8Array(arrayBuffer.slice(0, 4));
		const isMpegTs = firstBytes[0] === 0x47;
		const isFmp4 = firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0x00;
		const isVideoData = isMpegTs || isFmp4;

		const isPlaylist =
			!isVideoData &&
			(contentType.includes('mpegurl') ||
				decodedUrl.includes('.m3u8') ||
				decodedUrl.includes('.txt') ||
				(contentType.includes('text') && !decodedUrl.includes('.html')));

		if (isPlaylist) {
			const text = new TextDecoder().decode(arrayBuffer);
			const rewrittenPlaylist = rewritePlaylistUrls(text, decodedUrl, baseUrl, referer);
			// Ensure VOD markers are present so players start from beginning
			const vodPlaylist = ensureVodPlaylist(rewrittenPlaylist);

			return new Response(vodPlaylist, {
				status: 200,
				headers: {
					'Content-Type': 'application/vnd.apple.mpegurl',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, OPTIONS',
					'Access-Control-Allow-Headers': 'Range, Content-Type',
					'Cache-Control': 'public, max-age=300'
				}
			});
		}

		let actualContentType = 'video/mp2t';
		if (isMpegTs) {
			actualContentType = 'video/mp2t';
		} else if (isFmp4) {
			actualContentType = 'video/mp4';
		}

		return new Response(arrayBuffer, {
			status: 200,
			headers: {
				'Content-Type': actualContentType,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, OPTIONS',
				'Access-Control-Allow-Headers': 'Range, Content-Type',
				'Cache-Control': 'public, max-age=3600',
				'Content-Length': arrayBuffer.byteLength.toString()
			}
		});
	} catch (error) {
		logger.error('Proxy error', error, { url: targetUrl, logCategory: 'streams' });
		return new Response(
			JSON.stringify({
				error: 'Proxy error',
				details: error instanceof Error ? error.message : String(error)
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};

/**
 * Ensure playlist has VOD markers so players start from the beginning.
 * Without #EXT-X-ENDLIST and #EXT-X-PLAYLIST-TYPE:VOD, players treat
 * the stream as "live" and start at the end (live edge).
 */
function ensureVodPlaylist(playlist: string): string {
	const lines = playlist.split('\n');
	const rewritten: string[] = [];
	let hasEndList = false;
	let hasPlaylistType = false;
	let isMediaPlaylist = false;

	// First pass: detect existing tags
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '#EXT-X-ENDLIST') hasEndList = true;
		if (trimmed.startsWith('#EXT-X-PLAYLIST-TYPE:')) hasPlaylistType = true;
		// Media playlists have EXTINF (segment duration) tags, master playlists don't
		if (trimmed.startsWith('#EXTINF:')) isMediaPlaylist = true;
	}

	// Only modify media playlists, not master playlists
	if (!isMediaPlaylist) {
		return playlist;
	}

	// Second pass: rewrite with VOD markers
	for (const line of lines) {
		const trimmed = line.trim();

		// Add VOD type after EXTM3U if missing
		if (trimmed === '#EXTM3U') {
			rewritten.push(line);
			if (!hasPlaylistType) {
				rewritten.push('#EXT-X-PLAYLIST-TYPE:VOD');
			}
			continue;
		}

		// Skip if we're about to add ENDLIST and this is already at the end
		if (trimmed === '#EXT-X-ENDLIST') {
			hasEndList = true;
		}

		rewritten.push(line);
	}

	// Add ENDLIST if missing
	if (!hasEndList) {
		// Remove trailing empty lines before adding ENDLIST
		while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === '') {
			rewritten.pop();
		}
		rewritten.push('#EXT-X-ENDLIST');
	}

	return rewritten.join('\n');
}

function rewritePlaylistUrls(
	playlist: string,
	baseUrl: string,
	proxyBaseUrl: string,
	referer: string
): string {
	const lines = playlist.split('\n');
	const rewritten: string[] = [];

	const base = new URL(baseUrl);
	const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);

	const makeProxyUrl = (url: string, isSegment: boolean = false): string => {
		let absoluteUrl: string;

		if (url.startsWith('http://') || url.startsWith('https://')) {
			absoluteUrl = url;
		} else if (url.startsWith('/')) {
			absoluteUrl = `${base.origin}${url}`;
		} else {
			absoluteUrl = `${base.origin}${basePath}${url}`;
		}

		// Use path-based proxy URL with proper extension for FFmpeg compatibility
		// FFmpeg's HLS parser rejects URLs that don't end in recognized extensions
		const extension = isSegment ? 'ts' : 'm3u8';
		return `${proxyBaseUrl}/api/streaming/proxy/segment.${extension}?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
	};

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Handle HLS tags that contain URIs
		if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
			const uriMatch = line.match(/URI="([^"]+)"/);
			if (uriMatch) {
				const originalUri = uriMatch[1];
				const proxiedUri = makeProxyUrl(originalUri, false);
				rewritten.push(line.replace(`URI="${originalUri}"`, `URI="${proxiedUri}"`));
			} else {
				rewritten.push(line);
			}
			continue;
		}

		// Keep other comments and empty lines as-is
		if (line.startsWith('#') || trimmedLine === '') {
			rewritten.push(line);
			continue;
		}

		// This is a URL line - could be a playlist or segment
		if (!trimmedLine) {
			rewritten.push(line);
			continue;
		}

		try {
			// Determine if this is a segment (.ts) or a playlist (.m3u8)
			const isSegment =
				trimmedLine.includes('.ts') ||
				trimmedLine.includes('.aac') ||
				trimmedLine.includes('.mp4') ||
				(!trimmedLine.includes('.m3u8') && !trimmedLine.includes('.txt'));
			rewritten.push(makeProxyUrl(trimmedLine, isSegment));
		} catch {
			rewritten.push(line);
		}
	}

	return rewritten.join('\n');
}

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 200,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Range, Content-Type'
		}
	});
};
