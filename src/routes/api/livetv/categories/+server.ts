/**
 * Categories API Endpoint
 *
 * GET /api/livetv/categories - List cached categories for filtering
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLiveTvChannelService } from '$lib/server/livetv/LiveTvChannelService';

export const GET: RequestHandler = async ({ url }) => {
	const channelService = getLiveTvChannelService();

	// Parse query parameters
	const accountIdParam = url.searchParams.get('accountId');

	try {
		const categories = await channelService.getCategories(accountIdParam || undefined);
		return json({ categories });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
