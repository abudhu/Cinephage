/**
 * SSRF Protection Utilities
 *
 * Provides URL validation and secure fetch functions to prevent
 * Server-Side Request Forgery attacks in proxy endpoints.
 */

import { PROXY_FETCH_TIMEOUT_MS } from '$lib/server/streaming/constants';

// Allowed URL schemes
export const ALLOWED_SCHEMES = ['http:', 'https:'];

// Maximum redirects to follow
export const MAX_REDIRECTS = 5;

// Private IP ranges that should be blocked (SSRF protection)
export const PRIVATE_IP_PATTERNS = [
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

export const BLOCKED_HOSTNAMES = ['localhost', 'localhost.localdomain', '[::1]', '0.0.0.0'];

export interface UrlSafetyResult {
	safe: boolean;
	reason?: string;
}

/**
 * Validates that a URL is safe to proxy (not internal/private network)
 */
export function isUrlSafe(urlString: string): UrlSafetyResult {
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

/**
 * Fetch with timeout using AbortController
 */
export async function fetchWithTimeout(
	url: string,
	options: RequestInit,
	timeoutMs: number = PROXY_FETCH_TIMEOUT_MS
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, {
			...options,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeoutId);
	}
}
