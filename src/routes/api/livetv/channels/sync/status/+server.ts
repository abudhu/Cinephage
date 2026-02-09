/**
 * Sync Status API Endpoint
 *
 * GET /api/livetv/channels/sync/status - Get sync status for all accounts
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLiveTvChannelService } from '$lib/server/livetv/LiveTvChannelService';

export const GET: RequestHandler = async () => {
	const channelService = getLiveTvChannelService();

	try {
		const accounts = await channelService.getSyncStatus();
		return json({ accounts });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
