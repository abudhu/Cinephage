/**
 * Channel Sync API Endpoint
 *
 * POST /api/livetv/channels/sync - Trigger channel sync for accounts
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLiveTvChannelService, getLiveTvAccountManager } from '$lib/server/livetv';

export const POST: RequestHandler = async ({ request }) => {
	const channelService = getLiveTvChannelService();
	const accountManager = getLiveTvAccountManager();

	try {
		const body = await request.json().catch(() => ({}));
		const { accountIds } = body as { accountIds?: string[] };

		// If no specific accounts, sync all enabled accounts
		if (!accountIds || accountIds.length === 0) {
			const accounts = await accountManager.getAccounts();
			const results: Record<string, unknown> = {};

			for (const account of accounts.filter((a: (typeof accounts)[0]) => a.enabled)) {
				const result = await channelService.syncChannels(account.id);
				results[account.id] = result;
			}

			return json({ results });
		}

		// Sync specific accounts
		const results: Record<string, unknown> = {};

		for (const accountId of accountIds) {
			// Verify account exists
			const account = await accountManager.getAccount(accountId);
			if (!account) {
				results[accountId] = {
					success: false,
					error: 'Account not found'
				};
				continue;
			}

			const result = await channelService.syncChannels(accountId);
			results[accountId] = result;
		}

		return json({ results });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
