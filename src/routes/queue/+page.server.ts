import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
	downloadQueue,
	downloadHistory,
	movies,
	series,
	downloadClients
} from '$lib/server/db/schema';
import { eq, desc, and, not, inArray, isNull, isNotNull } from 'drizzle-orm';
import { downloadMonitor } from '$lib/server/downloadClients/monitoring';
import { getDownloadClientManager } from '$lib/server/downloadClients';
import type {
	QueueItemWithMedia,
	QueueStatus,
	HistoryItemWithMedia,
	HistoryStatus
} from '$lib/types/queue';
import { logger } from '$lib/logging';

/**
 * Terminal statuses (items that are done processing)
 */
const TERMINAL_STATUSES: QueueStatus[] = ['imported', 'removed'];

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	// Disable caching for this page - we want fresh data
	setHeaders({
		'Cache-Control': 'no-cache, no-store, must-revalidate'
	});

	// Trigger a poll to get fresh data from download clients
	// Don't await - this runs in the background so page loads immediately with cached data
	// The SSE connection will receive updates when the poll completes
	downloadMonitor.forcePoll().catch((e) => {
		logger.warn('Background poll of download clients failed', {
			error: e instanceof Error ? e.message : String(e)
		});
	});

	// Parse queue filters
	const statusParam = url.searchParams.get('status') as QueueStatus | 'all' | null;
	const mediaType = url.searchParams.get('mediaType') as 'movie' | 'tv' | 'all' | null;
	const clientId = url.searchParams.get('clientId');

	// Parse history filters
	const historyStatus = url.searchParams.get('historyStatus') as HistoryStatus | 'all' | null;
	const historyMediaType = url.searchParams.get('historyMediaType') as
		| 'movie'
		| 'tv'
		| 'all'
		| null;

	// Build queue where conditions
	const queueConditions = [];
	if (statusParam && statusParam !== 'all') {
		queueConditions.push(eq(downloadQueue.status, statusParam));
	} else {
		queueConditions.push(not(inArray(downloadQueue.status, TERMINAL_STATUSES)));
	}
	if (mediaType === 'movie') {
		queueConditions.push(and(isNotNull(downloadQueue.movieId), isNull(downloadQueue.seriesId)));
	} else if (mediaType === 'tv') {
		queueConditions.push(and(isNotNull(downloadQueue.seriesId), isNull(downloadQueue.movieId)));
	}
	if (clientId) {
		queueConditions.push(eq(downloadQueue.downloadClientId, clientId));
	}

	const queueWhereClause = queueConditions.length > 0 ? and(...queueConditions) : undefined;

	// Fetch queue items
	const queueRows = await db
		.select()
		.from(downloadQueue)
		.where(queueWhereClause)
		.orderBy(desc(downloadQueue.addedAt));

	// Enrich queue items with media info
	const queueItems: QueueItemWithMedia[] = [];
	for (const row of queueRows) {
		const item: QueueItemWithMedia = {
			id: row.id,
			downloadClientId: row.downloadClientId,
			downloadId: row.downloadId,
			title: row.title,
			indexerId: row.indexerId,
			indexerName: row.indexerName,
			downloadUrl: row.downloadUrl,
			magnetUrl: row.magnetUrl,
			protocol: row.protocol,
			movieId: row.movieId,
			seriesId: row.seriesId,
			episodeIds: row.episodeIds as string[] | null,
			seasonNumber: row.seasonNumber,
			status: row.status as QueueStatus,
			progress: parseFloat(row.progress || '0'),
			size: row.size,
			downloadSpeed: row.downloadSpeed || 0,
			uploadSpeed: row.uploadSpeed || 0,
			eta: row.eta,
			ratio: parseFloat(row.ratio || '0'),
			clientDownloadPath: row.clientDownloadPath,
			outputPath: row.outputPath,
			importedPath: row.importedPath,
			quality: row.quality as QueueItemWithMedia['quality'],
			addedAt: row.addedAt || new Date().toISOString(),
			startedAt: row.startedAt,
			completedAt: row.completedAt,
			importedAt: row.importedAt,
			errorMessage: row.errorMessage,
			importAttempts: row.importAttempts || 0,
			lastAttemptAt: row.lastAttemptAt,
			isAutomatic: !!row.isAutomatic,
			isUpgrade: !!row.isUpgrade,
			movie: null,
			series: null,
			downloadClient: null
		};

		// Get movie info
		if (row.movieId) {
			const [movie] = await db
				.select({
					id: movies.id,
					tmdbId: movies.tmdbId,
					title: movies.title,
					year: movies.year,
					posterPath: movies.posterPath
				})
				.from(movies)
				.where(eq(movies.id, row.movieId))
				.limit(1);
			item.movie = movie || null;
		}

		// Get series info
		if (row.seriesId) {
			const [seriesData] = await db
				.select({
					id: series.id,
					tmdbId: series.tmdbId,
					title: series.title,
					year: series.year,
					posterPath: series.posterPath
				})
				.from(series)
				.where(eq(series.id, row.seriesId))
				.limit(1);
			item.series = seriesData || null;
		}

		// Get client info
		const [client] = await db
			.select({
				id: downloadClients.id,
				name: downloadClients.name,
				implementation: downloadClients.implementation
			})
			.from(downloadClients)
			.where(eq(downloadClients.id, row.downloadClientId))
			.limit(1);
		item.downloadClient = client || null;

		queueItems.push(item);
	}

	// Build history where conditions
	const historyConditions = [];
	if (historyStatus && historyStatus !== 'all') {
		historyConditions.push(eq(downloadHistory.status, historyStatus));
	}
	if (historyMediaType === 'movie') {
		historyConditions.push(
			and(isNotNull(downloadHistory.movieId), isNull(downloadHistory.seriesId))
		);
	} else if (historyMediaType === 'tv') {
		historyConditions.push(
			and(isNotNull(downloadHistory.seriesId), isNull(downloadHistory.movieId))
		);
	}

	const historyWhereClause = historyConditions.length > 0 ? and(...historyConditions) : undefined;

	// Fetch history items
	const historyRows = await db
		.select()
		.from(downloadHistory)
		.where(historyWhereClause)
		.orderBy(desc(downloadHistory.createdAt))
		.limit(50);

	// Batch fetch related media for history
	const movieIds = [...new Set(historyRows.filter((h) => h.movieId).map((h) => h.movieId!))];
	const seriesIds = [...new Set(historyRows.filter((h) => h.seriesId).map((h) => h.seriesId!))];

	const moviesData =
		movieIds.length > 0
			? await db
					.select({
						id: movies.id,
						tmdbId: movies.tmdbId,
						title: movies.title,
						year: movies.year,
						posterPath: movies.posterPath
					})
					.from(movies)
					.where(inArray(movies.id, movieIds))
			: [];

	const seriesData =
		seriesIds.length > 0
			? await db
					.select({
						id: series.id,
						tmdbId: series.tmdbId,
						title: series.title,
						year: series.year,
						posterPath: series.posterPath
					})
					.from(series)
					.where(inArray(series.id, seriesIds))
			: [];

	const movieMap = new Map(moviesData.map((m) => [m.id, m]));
	const seriesMap = new Map(seriesData.map((s) => [s.id, s]));

	const historyItems: HistoryItemWithMedia[] = historyRows.map((row) => ({
		...row,
		status: row.status as HistoryStatus,
		quality: row.quality as HistoryItemWithMedia['quality'],
		createdAt: row.createdAt || new Date().toISOString(),
		movie: row.movieId && movieMap.has(row.movieId) ? movieMap.get(row.movieId)! : null,
		series: row.seriesId && seriesMap.has(row.seriesId) ? seriesMap.get(row.seriesId)! : null
	}));

	// Get stats
	const stats = await downloadMonitor.getStats();

	// Get available download clients for filter dropdown
	const clients = await db
		.select({ id: downloadClients.id, name: downloadClients.name })
		.from(downloadClients)
		.where(eq(downloadClients.enabled, true));

	return {
		queueItems,
		historyItems,
		stats,
		clients,
		filters: {
			status: statusParam || 'all',
			mediaType: mediaType || 'all',
			clientId: clientId || null,
			historyStatus: historyStatus || 'all',
			historyMediaType: historyMediaType || 'all'
		}
	};
};

export const actions: Actions = {
	pause: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id');

		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Missing queue item ID' });
		}

		try {
			await db.update(downloadQueue).set({ status: 'paused' }).where(eq(downloadQueue.id, id));
			return { success: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return fail(500, { error: message });
		}
	},

	resume: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id');

		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Missing queue item ID' });
		}

		try {
			await db.update(downloadQueue).set({ status: 'downloading' }).where(eq(downloadQueue.id, id));
			return { success: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return fail(500, { error: message });
		}
	},

	remove: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id');
		const deleteFiles = data.get('deleteFiles') === 'true';

		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Missing queue item ID' });
		}

		try {
			// Get queue item first
			const [queueItem] = await db
				.select()
				.from(downloadQueue)
				.where(eq(downloadQueue.id, id))
				.limit(1);

			if (!queueItem) {
				return fail(404, { error: 'Queue item not found' });
			}

			// Create history record before deleting
			await db.insert(downloadHistory).values({
				downloadClientId: queueItem.downloadClientId,
				downloadId: queueItem.downloadId,
				title: queueItem.title,
				status: 'removed',
				movieId: queueItem.movieId,
				seriesId: queueItem.seriesId,
				seasonNumber: queueItem.seasonNumber,
				episodeIds: queueItem.episodeIds,
				indexerId: queueItem.indexerId,
				indexerName: queueItem.indexerName,
				protocol: queueItem.protocol,
				size: queueItem.size,
				quality: queueItem.quality,
				grabbedAt: queueItem.addedAt,
				completedAt: queueItem.completedAt,
				importedAt: null,
				createdAt: new Date().toISOString()
			});

			// Remove from download client and optionally delete files
			if (queueItem.downloadClientId && queueItem.infoHash) {
				try {
					const clientInstance = await getDownloadClientManager().getClientInstance(
						queueItem.downloadClientId
					);
					if (clientInstance) {
						await clientInstance.removeDownload(queueItem.infoHash, deleteFiles);
						logger.info('Removed torrent from download client', {
							infoHash: queueItem.infoHash,
							deleteFiles
						});
					}
				} catch (err) {
					// Log but don't fail - queue item should still be removed
					logger.warn('Failed to remove from download client', {
						error: err instanceof Error ? err.message : 'Unknown error',
						infoHash: queueItem.infoHash
					});
				}
			}

			// Delete from queue
			await db.delete(downloadQueue).where(eq(downloadQueue.id, id));

			return { success: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return fail(500, { error: message });
		}
	},

	retry: async ({ request, fetch }) => {
		const data = await request.formData();
		const id = data.get('id');

		if (!id || typeof id !== 'string') {
			return fail(400, { error: 'Missing queue item ID' });
		}

		try {
			// Use the API endpoint which handles both native client retry and re-add
			const response = await fetch(`/api/queue/${id}/retry`, {
				method: 'POST'
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				return fail(response.status, {
					error: errorData.message || `Retry failed: ${response.statusText}`
				});
			}

			return { success: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return fail(500, { error: message });
		}
	}
};
