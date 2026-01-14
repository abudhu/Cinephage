import type { RequestHandler } from './$types';
import { downloadMonitor } from '$lib/server/downloadClients/monitoring';
import { db } from '$lib/server/db';
import { movies, series, episodes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { extractReleaseGroup } from '$lib/server/indexers/parser/patterns/releaseGroup';
import type { UnifiedActivity, ActivityStatus } from '$lib/types/activity';

/**
 * Server-Sent Events endpoint for real-time activity updates
 *
 * Events emitted:
 * - activity:new - New activity started (download grabbed)
 * - activity:updated - Activity status/progress changed
 * - activity:completed - Activity completed (imported/failed)
 */
export const GET: RequestHandler = async ({ request }) => {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\n`));
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Connection closed
				}
			};

			// Send initial connection event
			send('connected', { timestamp: new Date().toISOString() });

			// Heartbeat to keep connection alive
			const heartbeatInterval = setInterval(() => {
				try {
					send('heartbeat', { timestamp: new Date().toISOString() });
				} catch {
					clearInterval(heartbeatInterval);
				}
			}, 30000);

			// Helper to convert queue item to activity
			const queueItemToActivity = async (item: {
				id: string;
				title: string;
				movieId?: string | null;
				seriesId?: string | null;
				episodeIds?: string[] | null;
				seasonNumber?: number | null;
				status: string;
				progress?: number;
				size?: number | null;
				indexerId?: string | null;
				indexerName?: string | null;
				protocol?: string | null;
				quality?: { resolution?: string; source?: string; codec?: string; hdr?: string } | null;
				addedAt: string;
				completedAt?: string | null;
				errorMessage?: string | null;
				isUpgrade?: boolean;
			}): Promise<Partial<UnifiedActivity>> => {
				let mediaType: 'movie' | 'episode' = 'movie';
				let mediaId = item.movieId || '';
				let mediaTitle = 'Unknown';
				let mediaYear: number | null = null;
				let seriesTitle: string | undefined;
				let seasonNumber: number | undefined;
				let episodeNumber: number | undefined;

				// Fetch media info
				if (item.movieId) {
					const movie = await db
						.select({ id: movies.id, title: movies.title, year: movies.year })
						.from(movies)
						.where(eq(movies.id, item.movieId))
						.get();

					if (movie) {
						mediaType = 'movie';
						mediaId = movie.id;
						mediaTitle = movie.title;
						mediaYear = movie.year;
					}
				} else if (item.seriesId) {
					const s = await db
						.select({ id: series.id, title: series.title, year: series.year })
						.from(series)
						.where(eq(series.id, item.seriesId))
						.get();

					if (s) {
						mediaType = 'episode';
						seriesTitle = s.title;
						mediaYear = s.year;
						seasonNumber = item.seasonNumber ?? undefined;

						if (item.episodeIds && item.episodeIds.length > 0) {
							const ep = await db
								.select({
									id: episodes.id,
									episodeNumber: episodes.episodeNumber
								})
								.from(episodes)
								.where(eq(episodes.id, item.episodeIds[0]))
								.get();

							if (ep) {
								mediaId = ep.id;
								episodeNumber = ep.episodeNumber ?? undefined;
								mediaTitle = `${s.title} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
							}
						} else {
							mediaId = s.id;
							mediaTitle = item.seasonNumber ? `${s.title} Season ${item.seasonNumber}` : s.title;
						}
					}
				}

				// Map status
				let status: ActivityStatus = 'downloading';
				if (item.status === 'failed') status = 'failed';
				else if (item.status === 'imported') status = 'imported';
				else if (item.status === 'removed') status = 'removed';

				const releaseGroup = extractReleaseGroup(item.title);

				return {
					id: `queue-${item.id}`,
					mediaType,
					mediaId,
					mediaTitle,
					mediaYear,
					seriesTitle,
					seasonNumber,
					episodeNumber,
					releaseTitle: item.title,
					quality: item.quality ?? null,
					releaseGroup: releaseGroup?.group ?? null,
					size: item.size ?? null,
					indexerId: item.indexerId ?? null,
					indexerName: item.indexerName ?? null,
					protocol: (item.protocol as 'torrent' | 'usenet' | 'streaming') ?? null,
					status,
					statusReason: item.errorMessage ?? undefined,
					downloadProgress: Math.round((item.progress ?? 0) * 100),
					isUpgrade: item.isUpgrade ?? false,
					startedAt: item.addedAt,
					completedAt: item.completedAt ?? null,
					queueItemId: item.id
				};
			};

			// Event handlers
			const onQueueAdded = async (item: unknown) => {
				try {
					const activity = await queueItemToActivity(
						item as Parameters<typeof queueItemToActivity>[0]
					);
					send('activity:new', activity);
				} catch {
					// Error converting item
				}
			};

			const onQueueUpdated = async (item: unknown) => {
				try {
					const typedItem = item as Parameters<typeof queueItemToActivity>[0];
					// For progress updates, send minimal data
					send('activity:progress', {
						id: `queue-${typedItem.id}`,
						progress: Math.round((typedItem.progress ?? 0) * 100),
						status: typedItem.status
					});
				} catch {
					// Error
				}
			};

			const onQueueCompleted = async (item: unknown) => {
				try {
					const activity = await queueItemToActivity(
						item as Parameters<typeof queueItemToActivity>[0]
					);
					send('activity:updated', { ...activity, status: 'downloading' });
				} catch {
					// Error
				}
			};

			const onQueueImported = async (data: unknown) => {
				try {
					const typedData = data as { queueItem: Parameters<typeof queueItemToActivity>[0] };
					const activity = await queueItemToActivity(typedData.queueItem);
					send('activity:updated', { ...activity, status: 'imported' });
				} catch {
					// Error
				}
			};

			const onQueueFailed = async (data: unknown) => {
				try {
					const typedData = data as {
						queueItem: Parameters<typeof queueItemToActivity>[0];
						error: string;
					};
					const activity = await queueItemToActivity(typedData.queueItem);
					send('activity:updated', {
						...activity,
						status: 'failed',
						statusReason: typedData.error
					});
				} catch {
					// Error
				}
			};

			// Register handlers
			downloadMonitor.on('queue:added', onQueueAdded);
			downloadMonitor.on('queue:updated', onQueueUpdated);
			downloadMonitor.on('queue:completed', onQueueCompleted);
			downloadMonitor.on('queue:imported', onQueueImported);
			downloadMonitor.on('queue:failed', onQueueFailed);

			// Cleanup on disconnect
			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeatInterval);
				downloadMonitor.off('queue:added', onQueueAdded);
				downloadMonitor.off('queue:updated', onQueueUpdated);
				downloadMonitor.off('queue:completed', onQueueCompleted);
				downloadMonitor.off('queue:imported', onQueueImported);
				downloadMonitor.off('queue:failed', onQueueFailed);
				try {
					controller.close();
				} catch {
					// Already closed
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
