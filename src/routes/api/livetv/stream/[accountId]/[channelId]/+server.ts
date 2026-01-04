/**
 * GET/HEAD /api/livetv/stream/:accountId/:channelId
 *
 * HTTP passthrough streaming for IPTV channels.
 * Uses HTTP proxy instead of FFmpeg for lower resource usage.
 *
 * Features (based on Stalkerhek patterns):
 * - Stream type detection (HLS vs direct media)
 * - HLS manifest rewriting for proxy routing
 * - Watchdog lifecycle management
 * - Automatic retry with exponential backoff
 */

import type { RequestHandler } from './$types';
import { getStalkerPortalManager } from '$lib/server/livetv/stalker';
import { getChannelLineupService } from '$lib/server/livetv/lineup';
import { getHttpStreamService } from '$lib/server/livetv/proxy/HttpStreamService';
import { rewriteManifest, getBasePath } from '$lib/server/livetv/proxy/HlsManifestRewriter';
import { logger } from '$lib/logging';

/**
 * Common response headers for streams.
 */
const STREAM_HEADERS = {
	'Accept-Ranges': 'none',
	'Access-Control-Allow-Origin': '*',
	'Cache-Control': 'no-cache, no-store, must-revalidate',
	'X-Content-Type-Options': 'nosniff',
	Connection: 'keep-alive'
};

/**
 * HEAD handler - returns headers without fetching stream.
 * Used by Jellyfin/Plex to probe stream availability.
 */
export const HEAD: RequestHandler = async ({ params }) => {
	const { accountId, channelId } = params;

	// Validate channel is in user's lineup
	const lineupService = getChannelLineupService();
	const lineup = await lineupService.getLineup();
	const lineupItem = lineup.find(
		(item) => item.accountId === accountId && item.channelId === channelId
	);

	if (!lineupItem) {
		return new Response(null, { status: 404 });
	}

	// Verify account exists and is enabled
	const manager = getStalkerPortalManager();
	const account = await manager.getAccountRecord(accountId);

	if (!account || !account.enabled) {
		return new Response(null, { status: 404 });
	}

	// Return success with generic headers
	return new Response(null, {
		status: 200,
		headers: {
			...STREAM_HEADERS,
			'Content-Type': 'video/mp2t' // Default to MPEG-TS for compatibility
		}
	});
};

export const GET: RequestHandler = async ({ params, request, url }) => {
	const { accountId, channelId } = params;
	const clientIp =
		request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

	logger.info('[LiveTV] Stream requested', { accountId, channelId, clientIp });

	// 1. Validate channel is in user's lineup
	const lineupService = getChannelLineupService();
	const lineup = await lineupService.getLineup();
	const lineupItem = lineup.find(
		(item) => item.accountId === accountId && item.channelId === channelId
	);

	if (!lineupItem) {
		logger.warn('[LiveTV] Channel not in lineup', { accountId, channelId });
		return new Response('Channel not found', { status: 404 });
	}

	// 2. Get account and verify it's enabled
	const manager = getStalkerPortalManager();
	const account = await manager.getAccountRecord(accountId);

	if (!account) {
		logger.warn('[LiveTV] Account not found', { accountId });
		return new Response('Account not found', { status: 404 });
	}

	if (!account.enabled) {
		logger.warn('[LiveTV] Account disabled', { accountId });
		return new Response('Account disabled', { status: 404 });
	}

	// 3. Get channel cmd (prefer cached, fallback to fetch)
	let channelCmd = lineupItem.cachedCmd;
	if (!channelCmd) {
		try {
			const channels = await manager.getAccountChannels(accountId);
			const channel = channels.find((ch) => ch.id === channelId);
			if (channel) {
				channelCmd = channel.cmd;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[LiveTV] Failed to fetch channels', { accountId, error: message });
			return new Response('Failed to fetch channel info', { status: 502 });
		}
	}

	if (!channelCmd) {
		logger.warn('[LiveTV] Channel not found on portal', { accountId, channelId });
		return new Response('Channel not found on portal', { status: 404 });
	}

	// 4. Get stream URL and headers from portal
	let streamUrl: string;
	let streamHeaders: Record<string, string>;
	try {
		[streamUrl, streamHeaders] = await Promise.all([
			manager.getStreamUrl(accountId, channelCmd),
			manager.getStreamHeaders(accountId)
		]);
		logger.info('[LiveTV] Resolved stream URL', { accountId, channelId, streamUrl });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.error('[LiveTV] Failed to get stream URL', { accountId, channelId, error: message });
		return new Response('Failed to get stream URL', { status: 502 });
	}

	// 5. Notify stream start (for watchdog lifecycle)
	manager.notifyStreamStart(accountId);

	const streamService = getHttpStreamService();
	const channelName = lineupItem.cachedName || 'Unknown';
	const streamKey = `${accountId}:${channelId}:${Date.now()}`;

	try {
		// 6. Fetch stream with retry
		const { response, streamType, hlsRoot, finalUrl } = await streamService.fetchStream(
			streamUrl,
			streamHeaders
		);

		logger.info('[LiveTV] Stream fetched', {
			streamKey,
			streamType,
			finalUrl
		});

		// Register stream for monitoring
		streamService.registerStream({
			key: streamKey,
			accountId,
			channelId,
			channelName,
			clientIp,
			startedAt: new Date(),
			streamType,
			hlsRoot
		});

		// 7. Handle based on stream type
		if (streamType === 'hls') {
			// HLS: Rewrite manifest and return
			const manifest = await response.text();
			const proxyPrefix = `${url.origin}/api/livetv/stream/${accountId}/${channelId}/`;
			const rewrittenManifest = rewriteManifest(
				manifest,
				proxyPrefix,
				hlsRoot || getBasePath(finalUrl)
			);

			// Store HLS root for segment requests (in stream metadata)
			// This will be retrieved by the segment handler

			const headers = streamService.createProxyHeaders(response.headers, false);

			// Cleanup on response completion
			// Note: For HLS, the stream key is per-manifest-request
			streamService.unregisterStream(streamKey);
			manager.notifyStreamEnd(accountId);

			return new Response(rewrittenManifest, {
				status: 200,
				headers: {
					...STREAM_HEADERS,
					...headers,
					'Content-Type': 'application/vnd.apple.mpegurl'
				}
			});
		} else {
			// Direct media: Pipe response body through
			const headers = streamService.createProxyHeaders(response.headers, true);

			// Create a ReadableStream that handles cleanup
			const body = response.body;
			if (!body) {
				streamService.unregisterStream(streamKey);
				manager.notifyStreamEnd(accountId);
				return new Response('Empty stream', { status: 502 });
			}

			// Wrap body to handle cleanup
			const reader = body.getReader();
			const stream = new ReadableStream({
				async pull(controller) {
					try {
						const { done, value } = await reader.read();
						if (done) {
							controller.close();
							streamService.unregisterStream(streamKey);
							manager.notifyStreamEnd(accountId);
							return;
						}
						controller.enqueue(value);
					} catch (error) {
						logger.error('[LiveTV] Stream read error', {
							streamKey,
							error: error instanceof Error ? error.message : 'Unknown'
						});
						controller.error(error);
						streamService.unregisterStream(streamKey);
						manager.notifyStreamEnd(accountId);
					}
				},
				cancel() {
					reader.cancel();
					streamService.unregisterStream(streamKey);
					manager.notifyStreamEnd(accountId);
					logger.info('[LiveTV] Client disconnected', { streamKey });
				}
			});

			return new Response(stream, {
				status: 200,
				headers: {
					...STREAM_HEADERS,
					...headers
				}
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.error('[LiveTV] Stream failed', { streamKey, error: message });

		streamService.unregisterStream(streamKey);
		manager.notifyStreamEnd(accountId);

		return new Response('Stream failed: ' + message, { status: 502 });
	}
};
