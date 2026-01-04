/**
 * GET /api/livetv/stream/:accountId/:channelId/:path
 *
 * Handle HLS segment and sub-manifest requests.
 * Proxies segment requests to the original HLS server.
 *
 * Path can be:
 * - segment.ts - TS segment file
 * - chunk.m4s - fMP4 segment
 * - variant.m3u8 - Sub-manifest for variant streams
 * - key.key - Encryption key
 * - init.mp4 - Initialization segment
 */

import type { RequestHandler } from './$types';
import { getStalkerPortalManager } from '$lib/server/livetv/stalker';
import { getChannelLineupService } from '$lib/server/livetv/lineup';
import { getHttpStreamService } from '$lib/server/livetv/proxy/HttpStreamService';
import { isHlsContentType } from '$lib/server/livetv/proxy/StreamTypeDetector';
import { rewriteManifest, resolveSegmentUrl } from '$lib/server/livetv/proxy/HlsManifestRewriter';
import { logger } from '$lib/logging';

/**
 * Common response headers.
 */
const STREAM_HEADERS = {
	'Accept-Ranges': 'bytes',
	'Access-Control-Allow-Origin': '*',
	'Cache-Control': 'no-cache, no-store, must-revalidate',
	'X-Content-Type-Options': 'nosniff'
};

export const GET: RequestHandler = async ({ params, url }) => {
	const { accountId, channelId, path } = params;

	if (!path) {
		return new Response('Missing path', { status: 400 });
	}

	logger.debug('[LiveTV] Segment requested', { accountId, channelId, path });

	// 1. Validate channel is in user's lineup
	const lineupService = getChannelLineupService();
	const lineup = await lineupService.getLineup();
	const lineupItem = lineup.find(
		(item) => item.accountId === accountId && item.channelId === channelId
	);

	if (!lineupItem) {
		return new Response('Channel not found', { status: 404 });
	}

	// 2. Get account and verify it's enabled
	const manager = getStalkerPortalManager();
	const account = await manager.getAccountRecord(accountId);

	if (!account || !account.enabled) {
		return new Response('Account not found', { status: 404 });
	}

	// 3. Get channel cmd and stream URL to determine HLS root
	let channelCmd = lineupItem.cachedCmd;
	if (!channelCmd) {
		try {
			const channels = await manager.getAccountChannels(accountId);
			const channel = channels.find((ch) => ch.id === channelId);
			if (channel) {
				channelCmd = channel.cmd;
			}
		} catch {
			return new Response('Failed to fetch channel info', { status: 502 });
		}
	}

	if (!channelCmd) {
		return new Response('Channel not found on portal', { status: 404 });
	}

	// 4. Get stream URL to determine HLS root
	let streamUrl: string;
	let streamHeaders: Record<string, string>;
	try {
		[streamUrl, streamHeaders] = await Promise.all([
			manager.getStreamUrl(accountId, channelCmd),
			manager.getStreamHeaders(accountId)
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.error('[LiveTV] Failed to get stream URL for segment', { error: message });
		return new Response('Failed to get stream URL', { status: 502 });
	}

	// 5. Resolve segment URL
	// The path might be an encoded absolute URL or a relative path
	const hlsRoot = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
	const segmentUrl = resolveSegmentUrl(path, hlsRoot);

	logger.debug('[LiveTV] Fetching segment', { segmentUrl, path });

	// 6. Fetch segment
	const streamService = getHttpStreamService();

	try {
		const { response } = await streamService.fetchStream(segmentUrl, streamHeaders);

		// Check if this is a sub-manifest (needs rewriting)
		const contentType = response.headers.get('Content-Type') || '';
		if (isHlsContentType(contentType)) {
			// Sub-manifest: rewrite and return
			const manifest = await response.text();
			const proxyPrefix = `${url.origin}/api/livetv/stream/${accountId}/${channelId}/`;
			const manifestRoot = segmentUrl.substring(0, segmentUrl.lastIndexOf('/') + 1);
			const rewritten = rewriteManifest(manifest, proxyPrefix, manifestRoot);

			return new Response(rewritten, {
				status: 200,
				headers: {
					...STREAM_HEADERS,
					'Content-Type': 'application/vnd.apple.mpegurl'
				}
			});
		}

		// Regular segment: pass through
		const headers = streamService.createProxyHeaders(response.headers, true);

		// Pipe body through
		const body = response.body;
		if (!body) {
			return new Response('Empty segment', { status: 502 });
		}

		return new Response(body, {
			status: response.status,
			headers: {
				...STREAM_HEADERS,
				...headers
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.error('[LiveTV] Segment fetch failed', { path, error: message });
		return new Response('Segment fetch failed: ' + message, { status: 502 });
	}
};
