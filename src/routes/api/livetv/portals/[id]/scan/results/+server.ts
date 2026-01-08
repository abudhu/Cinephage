/**
 * Portal Scan Results API
 *
 * GET    /api/livetv/portals/[id]/scan/results - Get scan results
 * DELETE /api/livetv/portals/[id]/scan/results - Clear scan results
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPortalScannerService, type ScanResult } from '$lib/server/livetv/stalker';
import { logger } from '$lib/logging';

/**
 * Get scan results for a portal
 */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const status = url.searchParams.get('status') as ScanResult['status'] | null;

		const scannerService = getPortalScannerService();
		const results = await scannerService.getScanResults(params.id, status || undefined);

		return json(results);
	} catch (error) {
		logger.error('[API] Failed to get scan results', {
			portalId: params.id,
			error: error instanceof Error ? error.message : String(error)
		});

		return json({ error: 'Failed to get scan results' }, { status: 500 });
	}
};

/**
 * Clear scan results
 */
export const DELETE: RequestHandler = async ({ params, url }) => {
	try {
		const status = url.searchParams.get('status') as ScanResult['status'] | null;

		const scannerService = getPortalScannerService();
		const deleted = await scannerService.clearResults(params.id, status || undefined);

		return json({ deleted });
	} catch (error) {
		logger.error('[API] Failed to clear scan results', {
			portalId: params.id,
			error: error instanceof Error ? error.message : String(error)
		});

		return json({ error: 'Failed to clear scan results' }, { status: 500 });
	}
};
