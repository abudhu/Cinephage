/**
 * Naming Presets
 *
 * Built-in presets based on TRaSH Guides recommendations for different media servers.
 * @see https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/
 * @see https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/
 */

import type { NamingConfig } from './NamingService';

/**
 * Naming preset definition
 */
export interface NamingPreset {
	id: string;
	name: string;
	description: string;
	isBuiltIn: boolean;
	config: Partial<NamingConfig>;
}

/**
 * Base format strings shared across presets
 * Only the mediaServerIdFormat differs between servers
 */
const BASE_MOVIE_FILE_FORMAT =
	'{CleanTitle} ({Year}) {edition-{Edition}} [{QualityFull}]{[{HDR}]}{[{AudioCodec} {AudioChannels}]}{[{VideoCodec}]}{-{ReleaseGroup}}';

const BASE_EPISODE_FILE_FORMAT =
	'{SeriesCleanTitle} ({Year}) - S{Season:00}E{Episode:00} - {EpisodeCleanTitle} [{QualityFull}]{[{HDR}]}{[{AudioCodec} {AudioChannels}]}{[{VideoCodec}]}{-{ReleaseGroup}}';

const BASE_DAILY_EPISODE_FORMAT =
	'{SeriesCleanTitle} ({Year}) - {AirDate} - {EpisodeCleanTitle} [{QualityFull}]{[{VideoCodec}]}{-{ReleaseGroup}}';

const BASE_ANIME_EPISODE_FORMAT =
	'{SeriesCleanTitle} ({Year}) - S{Season:00}E{Episode:00} - {Absolute:000} - {EpisodeCleanTitle} [{QualityFull}]{[{HDR}]}{[{BitDepth}bit]}{[{VideoCodec}]}{[{AudioCodec} {AudioChannels}]}{-{ReleaseGroup}}';

/**
 * Built-in presets based on TRaSH Guides
 */
export const BUILT_IN_PRESETS: NamingPreset[] = [
	{
		id: 'plex',
		name: 'Plex',
		description: 'TRaSH Guides recommended format for Plex. Uses {tmdb-ID} and {tvdb-ID} format.',
		isBuiltIn: true,
		config: {
			mediaServerIdFormat: 'plex',
			movieFolderFormat: '{CleanTitle} ({Year}) {MediaId}',
			movieFileFormat: BASE_MOVIE_FILE_FORMAT,
			seriesFolderFormat: '{CleanTitle} ({Year}) {SeriesId}',
			seasonFolderFormat: 'Season {Season:00}',
			episodeFileFormat: BASE_EPISODE_FILE_FORMAT,
			dailyEpisodeFormat: BASE_DAILY_EPISODE_FORMAT,
			animeEpisodeFormat: BASE_ANIME_EPISODE_FORMAT,
			multiEpisodeStyle: 'range',
			colonReplacement: 'smart',
			includeQuality: true,
			includeMediaInfo: true,
			includeReleaseGroup: true
		}
	},
	{
		id: 'jellyfin',
		name: 'Jellyfin',
		description:
			'TRaSH Guides recommended format for Jellyfin. Uses [tmdbid-ID] and [tvdbid-ID] format.',
		isBuiltIn: true,
		config: {
			mediaServerIdFormat: 'jellyfin',
			movieFolderFormat: '{CleanTitle} ({Year}) {MediaId}',
			movieFileFormat: BASE_MOVIE_FILE_FORMAT,
			seriesFolderFormat: '{CleanTitle} ({Year}) {SeriesId}',
			seasonFolderFormat: 'Season {Season:00}',
			episodeFileFormat: BASE_EPISODE_FILE_FORMAT,
			dailyEpisodeFormat: BASE_DAILY_EPISODE_FORMAT,
			animeEpisodeFormat: BASE_ANIME_EPISODE_FORMAT,
			multiEpisodeStyle: 'range',
			colonReplacement: 'smart',
			includeQuality: true,
			includeMediaInfo: true,
			includeReleaseGroup: true
		}
	},
	{
		id: 'emby',
		name: 'Emby',
		description:
			'TRaSH Guides recommended format for Emby. Uses [tmdb-ID] and [tvdb-ID] format (same as Plex brackets but square).',
		isBuiltIn: true,
		config: {
			// Emby uses same format as Jellyfin for brackets
			mediaServerIdFormat: 'jellyfin',
			movieFolderFormat: '{CleanTitle} ({Year}) {MediaId}',
			movieFileFormat: BASE_MOVIE_FILE_FORMAT,
			seriesFolderFormat: '{CleanTitle} ({Year}) {SeriesId}',
			seasonFolderFormat: 'Season {Season:00}',
			episodeFileFormat: BASE_EPISODE_FILE_FORMAT,
			dailyEpisodeFormat: BASE_DAILY_EPISODE_FORMAT,
			animeEpisodeFormat: BASE_ANIME_EPISODE_FORMAT,
			multiEpisodeStyle: 'range',
			colonReplacement: 'smart',
			includeQuality: true,
			includeMediaInfo: true,
			includeReleaseGroup: true
		}
	},
	{
		id: 'kodi',
		name: 'Kodi',
		description: 'Simple format for Kodi. No media server IDs in folder names.',
		isBuiltIn: true,
		config: {
			mediaServerIdFormat: 'plex',
			movieFolderFormat: '{CleanTitle} ({Year})',
			movieFileFormat: BASE_MOVIE_FILE_FORMAT,
			seriesFolderFormat: '{CleanTitle} ({Year})',
			seasonFolderFormat: 'Season {Season:00}',
			episodeFileFormat: BASE_EPISODE_FILE_FORMAT,
			dailyEpisodeFormat: BASE_DAILY_EPISODE_FORMAT,
			animeEpisodeFormat: BASE_ANIME_EPISODE_FORMAT,
			multiEpisodeStyle: 'range',
			colonReplacement: 'smart',
			includeQuality: true,
			includeMediaInfo: true,
			includeReleaseGroup: true
		}
	},
	{
		id: 'minimal',
		name: 'Minimal',
		description: 'Simple format without quality/codec info. Good for basic setups.',
		isBuiltIn: true,
		config: {
			mediaServerIdFormat: 'plex',
			movieFolderFormat: '{CleanTitle} ({Year})',
			movieFileFormat: '{CleanTitle} ({Year}){-{ReleaseGroup}}',
			seriesFolderFormat: '{CleanTitle} ({Year})',
			seasonFolderFormat: 'Season {Season:00}',
			episodeFileFormat:
				'{SeriesCleanTitle} ({Year}) - S{Season:00}E{Episode:00} - {EpisodeCleanTitle}{-{ReleaseGroup}}',
			dailyEpisodeFormat:
				'{SeriesCleanTitle} ({Year}) - {AirDate} - {EpisodeCleanTitle}{-{ReleaseGroup}}',
			animeEpisodeFormat:
				'{SeriesCleanTitle} ({Year}) - S{Season:00}E{Episode:00} - {Absolute:000} - {EpisodeCleanTitle}{-{ReleaseGroup}}',
			multiEpisodeStyle: 'range',
			colonReplacement: 'smart',
			includeQuality: false,
			includeMediaInfo: false,
			includeReleaseGroup: true
		}
	}
];

/**
 * Get a built-in preset by ID
 */
export function getBuiltInPreset(id: string): NamingPreset | undefined {
	return BUILT_IN_PRESETS.find((p) => p.id === id);
}

/**
 * Get all built-in preset IDs
 */
export function getBuiltInPresetIds(): string[] {
	return BUILT_IN_PRESETS.map((p) => p.id);
}
