/**
 * STRM File Service
 *
 * Handles creation and management of .strm files for streaming releases.
 * STRM files are simple text files containing a URL that media players use
 * to locate and play streaming content.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { createChildLogger } from '$lib/logging';
import { db } from '$lib/server/db';
import { movies, series, episodes, seasons, rootFolders } from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';

const logger = createChildLogger({ module: 'StrmService' });

/**
 * Validate that a path is safe (no path traversal).
 * Returns true if the resolved path is within the expected root.
 */
function isPathSafe(rootPath: string, subPath: string): boolean {
	// Resolve to absolute paths
	const root = resolve(rootPath);
	const full = resolve(join(rootPath, subPath));

	// Check that resolved path starts with root path
	const relativePath = relative(root, full);

	// If relative path starts with '..' or is absolute, it's escaping
	if (relativePath.startsWith('..') || resolve(relativePath) === relativePath) {
		return false;
	}

	return true;
}

/**
 * Validate path component for safety.
 * Rejects paths containing traversal patterns.
 */
function sanitizePath(pathComponent: string): string {
	// Remove or replace dangerous characters and patterns
	return pathComponent
		.replace(/\.\./g, '') // Remove parent directory references
		.replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
		.replace(/[<>:"|?*]/g, '') // Remove invalid characters
		.trim();
}

export interface StrmCreateOptions {
	/** Media type: 'movie' or 'tv' */
	mediaType: 'movie' | 'tv';
	/** TMDB ID for the content */
	tmdbId: string;
	/** Movie ID if movie */
	movieId?: string;
	/** Series ID if TV */
	seriesId?: string;
	/** Season number for TV */
	season?: number;
	/** Episode number for TV */
	episode?: number;
	/** Base URL for the application (e.g., http://localhost:5173) */
	baseUrl: string;
}

export interface StrmCreateResult {
	success: boolean;
	filePath?: string;
	error?: string;
}

/**
 * Service for creating and managing .strm files
 */
export class StrmService {
	private static instance: StrmService;

	private constructor() {}

	static getInstance(): StrmService {
		if (!StrmService.instance) {
			StrmService.instance = new StrmService();
		}
		return StrmService.instance;
	}

	/**
	 * Generate the content of a .strm file
	 * Points to our resolve endpoint which handles stream extraction on-demand
	 */
	generateStrmContent(options: StrmCreateOptions): string {
		const { mediaType, tmdbId, season, episode, baseUrl } = options;

		if (mediaType === 'movie') {
			return `${baseUrl}/api/streaming/resolve/movie/${tmdbId}`;
		} else {
			return `${baseUrl}/api/streaming/resolve/tv/${tmdbId}/${season}/${episode}`;
		}
	}

	/**
	 * Create a .strm file for a streaming release
	 */
	async createStrmFile(options: StrmCreateOptions): Promise<StrmCreateResult> {
		const { mediaType, movieId, seriesId, season, episode } = options;

		try {
			let destinationPath: string;
			let filename: string;

			if (mediaType === 'movie' && movieId) {
				// Get movie details for folder path
				const movie = await db.query.movies.findFirst({
					where: eq(movies.id, movieId)
				});

				if (!movie) {
					return { success: false, error: `Movie not found: ${movieId}` };
				}

				if (!movie.rootFolderId) {
					return { success: false, error: 'Movie has no root folder configured' };
				}

				// Get root folder path
				const rootFolder = await db.query.rootFolders.findFirst({
					where: eq(rootFolders.id, movie.rootFolderId)
				});

				if (!rootFolder) {
					return { success: false, error: 'Root folder not found' };
				}

				// Build movie folder path - use existing path or construct from title
				const safeName = this.sanitizeFilename(movie.title);
				const year = movie.year ?? 'Unknown';
				const rawFolderName = movie.path || `${safeName} (${year})`;

				// Sanitize path to prevent traversal attacks
				const folderName = sanitizePath(rawFolderName);
				if (!isPathSafe(rootFolder.path, folderName)) {
					return { success: false, error: 'Invalid movie path: path traversal detected' };
				}

				const movieFolder = join(rootFolder.path, folderName);
				filename = `${safeName} (${year}).strm`;
				destinationPath = join(movieFolder, filename);
			} else if (mediaType === 'tv' && seriesId && season !== undefined && episode !== undefined) {
				// Get series details
				const show = await db.query.series.findFirst({
					where: eq(series.id, seriesId)
				});

				if (!show) {
					return { success: false, error: `Series not found: ${seriesId}` };
				}

				if (!show.rootFolderId) {
					return { success: false, error: 'Series has no root folder configured' };
				}

				// Get root folder path
				const rootFolder = await db.query.rootFolders.findFirst({
					where: eq(rootFolders.id, show.rootFolderId)
				});

				if (!rootFolder) {
					return { success: false, error: 'Root folder not found' };
				}

				// Build episode folder path - use existing path or construct from title
				const safeName = this.sanitizeFilename(show.title);
				const year = show.year ?? 'Unknown';
				const rawShowPath = show.path || `${safeName} (${year})`;

				// Sanitize path to prevent traversal attacks
				const showPath = sanitizePath(rawShowPath);
				if (!isPathSafe(rootFolder.path, showPath)) {
					return { success: false, error: 'Invalid series path: path traversal detected' };
				}

				const showFolder = join(rootFolder.path, showPath);
				const seasonFolder = join(showFolder, `Season ${season.toString().padStart(2, '0')}`);

				// Get episode title if available
				const episodeRow = await db.query.episodes.findFirst({
					where: and(
						eq(episodes.seriesId, seriesId),
						eq(episodes.seasonNumber, season),
						eq(episodes.episodeNumber, episode)
					)
				});
				const seasonStr = season.toString().padStart(2, '0');
				const episodeStr = episode.toString().padStart(2, '0');
				const episodeTitle = episodeRow?.title
					? ` - ${this.sanitizeFilename(episodeRow.title)}`
					: '';
				filename = `${safeName} - S${seasonStr}E${episodeStr}${episodeTitle}.strm`;
				destinationPath = join(seasonFolder, filename);
			} else {
				return { success: false, error: 'Invalid options for creating .strm file' };
			}

			// Ensure directory exists
			const dir = dirname(destinationPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
				logger.debug('[StrmService] Created directory', { dir });
			}

			// Generate and write .strm content
			const content = this.generateStrmContent(options);
			writeFileSync(destinationPath, content, 'utf8');

			logger.info('[StrmService] Created .strm file', {
				path: destinationPath,
				content
			});

			return { success: true, filePath: destinationPath };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[StrmService] Failed to create .strm file', { error: message });
			return { success: false, error: message };
		}
	}

	/**
	 * Delete a .strm file
	 */
	deleteStrmFile(filePath: string): boolean {
		try {
			if (existsSync(filePath)) {
				unlinkSync(filePath);
				logger.info('[StrmService] Deleted .strm file', { path: filePath });
				return true;
			}
			return false;
		} catch (error) {
			logger.error('[StrmService] Failed to delete .strm file', {
				path: filePath,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return false;
		}
	}

	/**
	 * Sanitize a string for use as a filename
	 */
	private sanitizeFilename(name: string): string {
		return name
			.replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
			.replace(/\s+/g, ' ') // Normalize whitespace
			.trim();
	}

	/**
	 * Parse an HTTP URL from a .strm file to extract media parameters.
	 * This is used when bulk-updating .strm files to understand what content they point to.
	 *
	 * Supports:
	 *   - {baseUrl}/api/streaming/resolve/movie/{tmdbId}
	 *   - {baseUrl}/api/streaming/resolve/tv/{tmdbId}/{season}/{episode}
	 */
	parseStrmFileUrl(url: string): {
		mediaType: 'movie' | 'tv';
		tmdbId: string;
		season?: number;
		episode?: number;
	} | null {
		// Match movie URL: {anyBaseUrl}/api/streaming/resolve/movie/{tmdbId}
		const movieMatch = url.match(/\/api\/streaming\/resolve\/movie\/(\d+)$/);
		if (movieMatch) {
			return {
				mediaType: 'movie',
				tmdbId: movieMatch[1]
			};
		}

		// Match TV URL: {anyBaseUrl}/api/streaming/resolve/tv/{tmdbId}/{season}/{episode}
		const tvMatch = url.match(/\/api\/streaming\/resolve\/tv\/(\d+)\/(\d+)\/(\d+)$/);
		if (tvMatch) {
			return {
				mediaType: 'tv',
				tmdbId: tvMatch[1],
				season: parseInt(tvMatch[2], 10),
				episode: parseInt(tvMatch[3], 10)
			};
		}

		return null;
	}

	/**
	 * Recursively find all .strm files in a directory
	 */
	private findStrmFiles(dir: string): string[] {
		const results: string[] = [];

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dir, entry.name);
				if (entry.isDirectory()) {
					results.push(...this.findStrmFiles(fullPath));
				} else if (entry.isFile() && entry.name.endsWith('.strm')) {
					results.push(fullPath);
				}
			}
		} catch (error) {
			// Directory might not be accessible, skip it
			logger.warn('[StrmService] Could not read directory', { dir, error });
		}

		return results;
	}

	/**
	 * Bulk update all .strm files across all root folders with a new base URL.
	 * This is useful when the server's IP/port/domain changes.
	 *
	 * @param newBaseUrl - The new base URL to use in .strm files
	 * @returns Summary of the update operation
	 */
	async bulkUpdateStrmUrls(newBaseUrl: string): Promise<{
		success: boolean;
		totalFiles: number;
		updatedFiles: number;
		errors: Array<{ path: string; error: string }>;
	}> {
		const errors: Array<{ path: string; error: string }> = [];
		let totalFiles = 0;
		let updatedFiles = 0;

		// Remove trailing slash from base URL
		const baseUrl = newBaseUrl.replace(/\/$/, '');

		logger.info('[StrmService] Starting bulk .strm URL update', { newBaseUrl: baseUrl });

		try {
			// Get all root folders from database
			const allRootFolders = await db.query.rootFolders.findMany();

			if (allRootFolders.length === 0) {
				logger.info('[StrmService] No root folders configured, nothing to update');
				return { success: true, totalFiles: 0, updatedFiles: 0, errors: [] };
			}

			// Find all .strm files across all root folders
			const strmFiles: string[] = [];
			for (const folder of allRootFolders) {
				if (existsSync(folder.path)) {
					const files = this.findStrmFiles(folder.path);
					strmFiles.push(...files);
				} else {
					logger.warn('[StrmService] Root folder does not exist', { path: folder.path });
				}
			}

			totalFiles = strmFiles.length;
			logger.info('[StrmService] Found .strm files to process', { count: totalFiles });

			// Process each .strm file
			for (const filePath of strmFiles) {
				try {
					// Read current content
					const currentContent = readFileSync(filePath, 'utf8').trim();

					// Parse the URL to extract media info
					const parsed = this.parseStrmFileUrl(currentContent);
					if (!parsed) {
						errors.push({ path: filePath, error: 'Could not parse URL format' });
						continue;
					}

					// Generate new content with the new base URL
					const newContent = this.generateStrmContent({
						mediaType: parsed.mediaType,
						tmdbId: parsed.tmdbId,
						season: parsed.season,
						episode: parsed.episode,
						baseUrl
					});

					// Only write if content actually changed
					if (currentContent !== newContent) {
						writeFileSync(filePath, newContent, 'utf8');
						updatedFiles++;
						logger.debug('[StrmService] Updated .strm file', {
							path: filePath,
							oldUrl: currentContent.substring(0, 50) + '...',
							newUrl: newContent.substring(0, 50) + '...'
						});
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Unknown error';
					errors.push({ path: filePath, error: message });
				}
			}

			logger.info('[StrmService] Bulk .strm URL update complete', {
				totalFiles,
				updatedFiles,
				unchanged: totalFiles - updatedFiles - errors.length,
				errors: errors.length
			});

			return {
				success: true,
				totalFiles,
				updatedFiles,
				errors
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[StrmService] Bulk .strm URL update failed', { error: message });
			return {
				success: false,
				totalFiles,
				updatedFiles,
				errors: [{ path: 'global', error: message }]
			};
		}
	}

	/**
	 * Parse a stream:// URL to extract parameters
	 * Supports:
	 *   - stream://movie/{tmdbId}
	 *   - stream://tv/{tmdbId}/{season}/{episode} (single episode)
	 *   - stream://tv/{tmdbId}/{season} (season pack - no episode)
	 *   - stream://tv/{tmdbId}/all (complete series - all seasons)
	 */
	static parseStreamUrl(url: string): {
		mediaType: 'movie' | 'tv';
		tmdbId: string;
		season?: number;
		episode?: number;
		isSeasonPack?: boolean;
		isCompleteSeries?: boolean;
	} | null {
		// Format: stream://movie/{tmdbId}
		const movieMatch = url.match(/^stream:\/\/movie\/(\d+)$/);
		if (movieMatch) {
			return {
				mediaType: 'movie',
				tmdbId: movieMatch[1]
			};
		}

		// Format: stream://tv/{tmdbId}/all (complete series - all seasons)
		const tvCompleteMatch = url.match(/^stream:\/\/tv\/(\d+)\/all$/);
		if (tvCompleteMatch) {
			return {
				mediaType: 'tv',
				tmdbId: tvCompleteMatch[1],
				season: undefined,
				episode: undefined,
				isSeasonPack: true,
				isCompleteSeries: true
			};
		}

		// Format: stream://tv/{tmdbId}/{season}/{episode} (single episode)
		const tvEpisodeMatch = url.match(/^stream:\/\/tv\/(\d+)\/(\d+)\/(\d+)$/);
		if (tvEpisodeMatch) {
			return {
				mediaType: 'tv',
				tmdbId: tvEpisodeMatch[1],
				season: parseInt(tvEpisodeMatch[2], 10),
				episode: parseInt(tvEpisodeMatch[3], 10),
				isSeasonPack: false
			};
		}

		// Format: stream://tv/{tmdbId}/{season} (season pack - no episode)
		const tvSeasonMatch = url.match(/^stream:\/\/tv\/(\d+)\/(\d+)$/);
		if (tvSeasonMatch) {
			return {
				mediaType: 'tv',
				tmdbId: tvSeasonMatch[1],
				season: parseInt(tvSeasonMatch[2], 10),
				episode: undefined,
				isSeasonPack: true
			};
		}

		return null;
	}

	/**
	 * Create .strm files for all episodes in a season
	 * Used for streaming "season pack" grabs
	 *
	 * Note: Only creates files for episodes that have already aired
	 * @param options.episodeIds - Optional: Only create files for these specific episode IDs (used to avoid race condition with watcher)
	 */
	async createSeasonStrmFiles(options: {
		seriesId: string;
		seasonNumber: number;
		tmdbId: string;
		baseUrl: string;
		episodeIds?: string[];
	}): Promise<{
		success: boolean;
		results: Array<{ episodeId: string; episodeNumber: number; filePath?: string; error?: string }>;
		error?: string;
	}> {
		const { seriesId, seasonNumber, tmdbId, baseUrl, episodeIds } = options;

		try {
			// Get all episodes for this season
			const allEpisodes = await db.query.episodes.findMany({
				where: and(eq(episodes.seriesId, seriesId), eq(episodes.seasonNumber, seasonNumber))
			});

			// Filter to only include episodes that have already aired
			const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
			let seasonEpisodes = allEpisodes.filter((ep) => {
				// If no air date, skip the episode (hasn't aired)
				if (!ep.airDate) {
					return false;
				}
				// Only include episodes that aired on or before today
				return ep.airDate <= today;
			});

			// If specific episode IDs provided, filter to only those episodes
			if (episodeIds && episodeIds.length > 0) {
				const episodeIdSet = new Set(episodeIds);
				seasonEpisodes = seasonEpisodes.filter((ep) => episodeIdSet.has(ep.id));
			}

			if (seasonEpisodes.length === 0) {
				const unairedCount = allEpisodes.length;
				return {
					success: false,
					results: [],
					error:
						unairedCount > 0
							? `No aired episodes found for season ${seasonNumber} (${unairedCount} episodes haven't aired yet)`
							: `No episodes found for season ${seasonNumber}`
				};
			}

			logger.info('[StrmService] Creating season pack .strm files', {
				seriesId,
				seasonNumber,
				airedEpisodes: seasonEpisodes.length,
				totalEpisodes: allEpisodes.length,
				skippedUnaired: allEpisodes.length - seasonEpisodes.length
			});

			const results: Array<{
				episodeId: string;
				episodeNumber: number;
				filePath?: string;
				error?: string;
			}> = [];
			let successCount = 0;

			// Create .strm file for each episode
			for (const ep of seasonEpisodes) {
				const result = await this.createStrmFile({
					mediaType: 'tv',
					tmdbId,
					seriesId,
					season: seasonNumber,
					episode: ep.episodeNumber,
					baseUrl
				});

				if (result.success && result.filePath) {
					results.push({
						episodeId: ep.id,
						episodeNumber: ep.episodeNumber,
						filePath: result.filePath
					});
					successCount++;
				} else {
					results.push({
						episodeId: ep.id,
						episodeNumber: ep.episodeNumber,
						error: result.error
					});
				}
			}

			logger.info('[StrmService] Season pack .strm files created', {
				seriesId,
				seasonNumber,
				airedEpisodes: seasonEpisodes.length,
				totalInSeason: allEpisodes.length,
				success: successCount,
				failed: seasonEpisodes.length - successCount,
				skippedUnaired: allEpisodes.length - seasonEpisodes.length
			});

			return {
				success: successCount > 0,
				results
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[StrmService] Failed to create season pack .strm files', {
				seriesId,
				seasonNumber,
				error: message
			});
			return { success: false, results: [], error: message };
		}
	}

	/**
	 * Create .strm files for all episodes in all seasons of a series
	 * Used for streaming "complete series" grabs
	 *
	 * Note: Excludes Season 0 (Specials) by default
	 */
	async createSeriesStrmFiles(options: {
		seriesId: string;
		tmdbId: string;
		baseUrl: string;
	}): Promise<{
		success: boolean;
		results: Array<{
			seasonNumber: number;
			episodeResults: Array<{
				episodeId: string;
				episodeNumber: number;
				filePath?: string;
				error?: string;
			}>;
		}>;
		error?: string;
	}> {
		const { seriesId, tmdbId, baseUrl } = options;

		try {
			// Get all seasons for this series from database (ordered by season number)
			const allSeasons = await db.query.seasons.findMany({
				where: eq(seasons.seriesId, seriesId),
				orderBy: [asc(seasons.seasonNumber)]
			});

			if (allSeasons.length === 0) {
				return {
					success: false,
					results: [],
					error: 'No seasons found for series'
				};
			}

			logger.info('[StrmService] Creating complete series .strm files', {
				seriesId,
				seasonCount: allSeasons.length
			});

			const results: Array<{
				seasonNumber: number;
				episodeResults: Array<{
					episodeId: string;
					episodeNumber: number;
					filePath?: string;
					error?: string;
				}>;
			}> = [];
			let totalSuccess = 0;
			let totalEpisodes = 0;

			// Create .strm files for each season (excluding Season 0 - Specials)
			for (const season of allSeasons) {
				// Skip Season 0 (Specials)
				if (season.seasonNumber === 0) {
					logger.debug('[StrmService] Skipping Season 0 (Specials)', { seriesId });
					continue;
				}

				const seasonResult = await this.createSeasonStrmFiles({
					seriesId,
					seasonNumber: season.seasonNumber,
					tmdbId,
					baseUrl
				});

				results.push({
					seasonNumber: season.seasonNumber,
					episodeResults: seasonResult.results
				});

				// Count successes
				const successCount = seasonResult.results.filter((r) => r.filePath).length;
				totalSuccess += successCount;
				totalEpisodes += seasonResult.results.length;
			}

			logger.info('[StrmService] Complete series .strm files created', {
				seriesId,
				seasonsProcessed: results.length,
				totalEpisodes,
				totalSuccess,
				totalFailed: totalEpisodes - totalSuccess
			});

			return {
				success: totalSuccess > 0,
				results
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error('[StrmService] Failed to create complete series .strm files', {
				seriesId,
				error: message
			});
			return { success: false, results: [], error: message };
		}
	}
}

export const strmService = StrmService.getInstance();
