import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	downloadHistory,
	downloadQueue,
	monitoringHistory,
	movies,
	series,
	episodes
} from '$lib/server/db/schema';
import { desc, inArray } from 'drizzle-orm';
import { logger } from '$lib/logging';
import { extractReleaseGroup } from '$lib/server/indexers/parser/patterns/releaseGroup';
import type {
	UnifiedActivity,
	ActivityEvent,
	ActivityStatus,
	ActivityFilters
} from '$lib/types/activity';

/**
 * GET - Get unified activity with optional filtering
 *
 * Query params:
 * - status: Filter by status ('imported', 'failed', 'downloading', 'no_results', 'success', 'all')
 * - mediaType: Filter by media type ('movie', 'tv', 'all')
 * - search: Search in media title or release title
 * - limit: Max number of results (default 50)
 * - offset: Pagination offset (default 0)
 * - sort: Sort field ('time', 'media', 'size')
 * - direction: Sort direction ('asc', 'desc')
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const statusParam = url.searchParams.get('status') as ActivityFilters['status'] | null;
		const mediaType = url.searchParams.get('mediaType') as ActivityFilters['mediaType'] | null;
		const search = url.searchParams.get('search');
		const limitParam = url.searchParams.get('limit');
		const offsetParam = url.searchParams.get('offset');

		const limit = Math.min(limitParam ? parseInt(limitParam, 10) : 50, 100);
		const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

		// Fetch from multiple sources and consolidate
		const activities: UnifiedActivity[] = [];

		// 1. Get active downloads from queue (downloading status)
		const activeDownloads = await db
			.select()
			.from(downloadQueue)
			.where(
				inArray(downloadQueue.status, [
					'downloading',
					'queued',
					'paused',
					'stalled',
					'seeding',
					'completed',
					'postprocessing',
					'importing'
				])
			)
			.orderBy(desc(downloadQueue.addedAt))
			.all();

		// 2. Get download history (completed activities)
		const historyItems = await db
			.select()
			.from(downloadHistory)
			.orderBy(desc(downloadHistory.createdAt))
			.limit(200) // Get more for consolidation
			.all();

		// 3. Get monitoring history for search-only events (no_results, etc.)
		const monitoringItems = await db
			.select()
			.from(monitoringHistory)
			.where(inArray(monitoringHistory.status, ['no_results', 'error', 'skipped']))
			.orderBy(desc(monitoringHistory.executedAt))
			.limit(100)
			.all();

		// Batch fetch media info
		const allMovieIds = [
			...new Set([
				...activeDownloads.filter((d) => d.movieId).map((d) => d.movieId!),
				...historyItems.filter((h) => h.movieId).map((h) => h.movieId!),
				...monitoringItems.filter((m) => m.movieId).map((m) => m.movieId!)
			])
		];

		const allSeriesIds = [
			...new Set([
				...activeDownloads.filter((d) => d.seriesId).map((d) => d.seriesId!),
				...historyItems.filter((h) => h.seriesId).map((h) => h.seriesId!),
				...monitoringItems.filter((m) => m.seriesId).map((m) => m.seriesId!)
			])
		];

		const allEpisodeIds = [
			...new Set([
				...activeDownloads.filter((d) => d.episodeIds).flatMap((d) => d.episodeIds || []),
				...historyItems.filter((h) => h.episodeIds).flatMap((h) => h.episodeIds || []),
				...monitoringItems.filter((m) => m.episodeId).map((m) => m.episodeId!)
			])
		];

		// Fetch media data
		const moviesData =
			allMovieIds.length > 0
				? await db
						.select({ id: movies.id, title: movies.title, year: movies.year })
						.from(movies)
						.where(inArray(movies.id, allMovieIds))
						.all()
				: [];

		const seriesData =
			allSeriesIds.length > 0
				? await db
						.select({ id: series.id, title: series.title, year: series.year })
						.from(series)
						.where(inArray(series.id, allSeriesIds))
						.all()
				: [];

		const episodesData =
			allEpisodeIds.length > 0
				? await db
						.select({
							id: episodes.id,
							seriesId: episodes.seriesId,
							title: episodes.title,
							seasonNumber: episodes.seasonNumber,
							episodeNumber: episodes.episodeNumber
						})
						.from(episodes)
						.where(inArray(episodes.id, allEpisodeIds))
						.all()
				: [];

		// Create lookup maps
		const movieMap = new Map(moviesData.map((m) => [m.id, m]));
		const seriesMap = new Map(seriesData.map((s) => [s.id, s]));
		const episodeMap = new Map(episodesData.map((e) => [e.id, e]));

		// Get monitoring history linked to queue items for timeline
		const queueIds = activeDownloads.map((d) => d.id);
		const linkedMonitoring =
			queueIds.length > 0
				? await db
						.select()
						.from(monitoringHistory)
						.where(inArray(monitoringHistory.queueItemId, queueIds))
						.all()
				: [];

		const monitoringByQueueId = new Map<string, (typeof linkedMonitoring)[0][]>();
		for (const m of linkedMonitoring) {
			if (m.queueItemId) {
				const existing = monitoringByQueueId.get(m.queueItemId) || [];
				existing.push(m);
				monitoringByQueueId.set(m.queueItemId, existing);
			}
		}

		// Convert active downloads to activities
		for (const download of activeDownloads) {
			const timeline: ActivityEvent[] = [];
			const linkedMon = monitoringByQueueId.get(download.id) || [];

			// Build timeline from monitoring history
			for (const m of linkedMon) {
				if (m.status === 'grabbed' && m.executedAt) {
					timeline.push({
						type: 'grabbed',
						timestamp: m.executedAt,
						details: m.releaseGrabbed || undefined
					});
				}
				if (m.releasesFound && m.releasesFound > 0 && m.executedAt) {
					timeline.push({
						type: 'found',
						timestamp: m.executedAt,
						details: `${m.releasesFound} releases found`
					});
				}
			}

			// Add download events
			if (download.addedAt) {
				timeline.push({ type: 'grabbed', timestamp: download.addedAt });
			}
			if (download.startedAt) {
				timeline.push({ type: 'downloading', timestamp: download.startedAt });
			}

			// Sort timeline by timestamp
			timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

			// Determine media info
			let mediaType: 'movie' | 'episode' = 'movie';
			let mediaId = download.movieId || '';
			let mediaTitle = 'Unknown';
			let mediaYear: number | null = null;
			let seriesTitle: string | undefined;
			let seasonNumber: number | undefined;
			let episodeNumber: number | undefined;

			if (download.movieId && movieMap.has(download.movieId)) {
				const movie = movieMap.get(download.movieId)!;
				mediaType = 'movie';
				mediaId = movie.id;
				mediaTitle = movie.title;
				mediaYear = movie.year;
			} else if (download.seriesId && seriesMap.has(download.seriesId)) {
				const s = seriesMap.get(download.seriesId)!;
				mediaType = 'episode';
				mediaId = download.episodeIds?.[0] || s.id;
				seriesTitle = s.title;
				mediaYear = s.year;
				seasonNumber = download.seasonNumber ?? undefined;

				// Get episode info if available
				if (download.episodeIds && download.episodeIds.length > 0) {
					const firstEp = episodeMap.get(download.episodeIds[0]);
					if (firstEp) {
						episodeNumber = firstEp.episodeNumber ?? undefined;
						mediaTitle =
							download.episodeIds.length > 1
								? `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(firstEp.episodeNumber).padStart(2, '0')}-E${String(episodeMap.get(download.episodeIds[download.episodeIds.length - 1])?.episodeNumber).padStart(2, '0')}`
								: `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(firstEp.episodeNumber).padStart(2, '0')}`;
					} else {
						mediaTitle = `${s.title} Season ${seasonNumber}`;
					}
				} else {
					mediaTitle = download.seasonNumber
						? `${s.title} Season ${download.seasonNumber}`
						: s.title;
				}
			}

			// Map queue status to activity status
			let status: ActivityStatus = 'downloading';
			if (download.status === 'failed') status = 'failed';
			else if (download.status === 'imported') status = 'imported';
			else if (download.status === 'removed') status = 'removed';
			else if (
				[
					'downloading',
					'queued',
					'paused',
					'stalled',
					'seeding',
					'completed',
					'postprocessing',
					'importing'
				].includes(download.status)
			) {
				status = 'downloading';
			}

			// Use stored releaseGroup, fall back to extraction for older records
			const releaseGroup =
				download.releaseGroup ?? extractReleaseGroup(download.title)?.group ?? null;

			activities.push({
				id: `queue-${download.id}`,
				mediaType,
				mediaId,
				mediaTitle,
				mediaYear,
				seriesId: download.seriesId ?? undefined,
				seriesTitle,
				seasonNumber,
				episodeNumber,
				episodeIds: download.episodeIds ?? undefined,
				releaseTitle: download.title,
				quality: download.quality ?? null,
				releaseGroup,
				size: download.size ?? null,
				indexerId: download.indexerId ?? null,
				indexerName: download.indexerName ?? null,
				protocol: (download.protocol as 'torrent' | 'usenet' | 'streaming') ?? null,
				status,
				statusReason: download.errorMessage ?? undefined,
				downloadProgress: Math.round((Number(download.progress) || 0) * 100),
				isUpgrade: download.isUpgrade ?? false,
				timeline,
				startedAt: download.addedAt || new Date().toISOString(),
				completedAt: download.completedAt ?? null,
				queueItemId: download.id
			});
		}

		// Convert history items to activities (excluding those already in queue)
		const queueTitles = new Set(activeDownloads.map((d) => d.title));

		for (const history of historyItems) {
			// Skip if this release is still in the queue
			if (queueTitles.has(history.title)) continue;

			const timeline: ActivityEvent[] = [];

			// Add history events
			if (history.grabbedAt) {
				timeline.push({ type: 'grabbed', timestamp: history.grabbedAt });
			}
			if (history.completedAt) {
				timeline.push({ type: 'completed', timestamp: history.completedAt });
			}
			if (history.importedAt && history.status === 'imported') {
				timeline.push({ type: 'imported', timestamp: history.importedAt });
			}
			if (history.status === 'failed' && history.createdAt) {
				timeline.push({
					type: 'failed',
					timestamp: history.createdAt,
					details: history.statusReason ?? undefined
				});
			}
			if (history.status === 'rejected' && history.createdAt) {
				timeline.push({
					type: 'rejected',
					timestamp: history.createdAt,
					details: history.statusReason ?? undefined
				});
			}

			// Sort timeline
			timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

			// Determine media info
			let mediaType: 'movie' | 'episode' = 'movie';
			let mediaId = history.movieId || '';
			let mediaTitle = 'Unknown';
			let mediaYear: number | null = null;
			let seriesTitle: string | undefined;
			let seasonNumber: number | undefined;
			let episodeNumber: number | undefined;

			if (history.movieId && movieMap.has(history.movieId)) {
				const movie = movieMap.get(history.movieId)!;
				mediaType = 'movie';
				mediaId = movie.id;
				mediaTitle = movie.title;
				mediaYear = movie.year;
			} else if (history.seriesId && seriesMap.has(history.seriesId)) {
				const s = seriesMap.get(history.seriesId)!;
				mediaType = 'episode';
				mediaId = history.episodeIds?.[0] || s.id;
				seriesTitle = s.title;
				mediaYear = s.year;
				seasonNumber = history.seasonNumber ?? undefined;

				if (history.episodeIds && history.episodeIds.length > 0) {
					const firstEp = episodeMap.get(history.episodeIds[0]);
					if (firstEp) {
						episodeNumber = firstEp.episodeNumber ?? undefined;
						mediaTitle =
							history.episodeIds.length > 1
								? `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(firstEp.episodeNumber).padStart(2, '0')}-E${String(episodeMap.get(history.episodeIds[history.episodeIds.length - 1])?.episodeNumber).padStart(2, '0')}`
								: `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(firstEp.episodeNumber).padStart(2, '0')}`;
					} else {
						mediaTitle = `${s.title} Season ${seasonNumber}`;
					}
				} else {
					mediaTitle = history.seasonNumber ? `${s.title} Season ${history.seasonNumber}` : s.title;
				}
			}

			// Use stored releaseGroup, fall back to extraction for older records
			const releaseGroup =
				history.releaseGroup ?? extractReleaseGroup(history.title)?.group ?? null;

			activities.push({
				id: `history-${history.id}`,
				mediaType,
				mediaId,
				mediaTitle,
				mediaYear,
				seriesId: history.seriesId ?? undefined,
				seriesTitle,
				seasonNumber,
				episodeNumber,
				episodeIds: history.episodeIds ?? undefined,
				releaseTitle: history.title,
				quality: history.quality ?? null,
				releaseGroup,
				size: history.size ?? null,
				indexerId: history.indexerId ?? null,
				indexerName: history.indexerName ?? null,
				protocol: (history.protocol as 'torrent' | 'usenet' | 'streaming') ?? null,
				status: history.status as ActivityStatus,
				statusReason: history.statusReason ?? undefined,
				isUpgrade: false,
				timeline,
				startedAt: history.grabbedAt || history.createdAt || new Date().toISOString(),
				completedAt: history.importedAt || history.completedAt || null,
				downloadHistoryId: history.id,
				importedPath: history.importedPath ?? undefined
			});
		}

		// Convert monitoring-only items (no_results, etc.)
		const processedMediaIds = new Set(
			activities.map((a) => `${a.mediaType}-${a.mediaId}-${a.startedAt?.slice(0, 10)}`)
		);

		for (const mon of monitoringItems) {
			// Skip if no executedAt timestamp
			const executedAt = mon.executedAt;
			if (!executedAt) continue;

			// Skip if we already have an activity for this media on this day
			const mediaKey = mon.movieId
				? `movie-${mon.movieId}-${executedAt.slice(0, 10)}`
				: `episode-${mon.episodeId || mon.seriesId}-${executedAt.slice(0, 10)}`;

			if (processedMediaIds.has(mediaKey)) continue;
			processedMediaIds.add(mediaKey);

			let mediaType: 'movie' | 'episode' = 'movie';
			let mediaId = mon.movieId || '';
			let mediaTitle = 'Unknown';
			let mediaYear: number | null = null;
			let seriesTitle: string | undefined;
			let seasonNumber: number | undefined;
			let episodeNumber: number | undefined;

			if (mon.movieId && movieMap.has(mon.movieId)) {
				const movie = movieMap.get(mon.movieId)!;
				mediaType = 'movie';
				mediaId = movie.id;
				mediaTitle = movie.title;
				mediaYear = movie.year;
			} else if (mon.seriesId && seriesMap.has(mon.seriesId)) {
				const s = seriesMap.get(mon.seriesId)!;
				mediaType = 'episode';
				seriesTitle = s.title;
				mediaYear = s.year;
				seasonNumber = mon.seasonNumber ?? undefined;

				if (mon.episodeId && episodeMap.has(mon.episodeId)) {
					const ep = episodeMap.get(mon.episodeId)!;
					mediaId = ep.id;
					episodeNumber = ep.episodeNumber ?? undefined;
					mediaTitle = `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
				} else {
					mediaId = s.id;
					mediaTitle = mon.seasonNumber ? `${s.title} Season ${mon.seasonNumber}` : s.title;
				}
			}

			const timeline: ActivityEvent[] = [
				{
					type: 'searched',
					timestamp: executedAt,
					details:
						mon.errorMessage || (mon.status === 'no_results' ? 'No results found' : undefined)
				}
			];

			activities.push({
				id: `monitoring-${mon.id}`,
				mediaType,
				mediaId,
				mediaTitle,
				mediaYear,
				seriesId: mon.seriesId ?? undefined,
				seriesTitle,
				seasonNumber,
				episodeNumber,
				releaseTitle: null,
				quality: null,
				releaseGroup: null,
				size: null,
				indexerId: null,
				indexerName: null,
				protocol: null,
				status: mon.status === 'error' ? 'failed' : 'no_results',
				statusReason: mon.errorMessage ?? undefined,
				isUpgrade: mon.isUpgrade ?? false,
				oldScore: mon.oldScore ?? undefined,
				newScore: mon.newScore ?? undefined,
				timeline,
				startedAt: executedAt,
				completedAt: executedAt,
				monitoringHistoryId: mon.id
			});
		}

		// Sort all activities by start time (newest first)
		activities.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

		// Apply filters
		let filtered = activities;

		// Status filter
		if (statusParam && statusParam !== 'all') {
			if (statusParam === 'success') {
				filtered = filtered.filter((a) => a.status === 'imported' || a.status === 'streaming');
			} else {
				filtered = filtered.filter((a) => a.status === statusParam);
			}
		}

		// Media type filter
		if (mediaType === 'movie') {
			filtered = filtered.filter((a) => a.mediaType === 'movie');
		} else if (mediaType === 'tv') {
			filtered = filtered.filter((a) => a.mediaType === 'episode');
		}

		// Search filter
		if (search) {
			const searchLower = search.toLowerCase();
			filtered = filtered.filter(
				(a) =>
					a.mediaTitle.toLowerCase().includes(searchLower) ||
					a.releaseTitle?.toLowerCase().includes(searchLower) ||
					a.seriesTitle?.toLowerCase().includes(searchLower)
			);
		}

		// Get total before pagination
		const total = filtered.length;

		// Apply pagination
		const paginated = filtered.slice(offset, offset + limit);

		return json({
			success: true,
			activities: paginated,
			total,
			hasMore: offset + paginated.length < total
		});
	} catch (err) {
		logger.error('Error fetching activity', err instanceof Error ? err : undefined);
		return json({ error: 'Failed to fetch activity', success: false }, { status: 500 });
	}
};
