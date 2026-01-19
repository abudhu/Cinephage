/**
 * Media-related utility functions
 */

/**
 * Common media info interface for items that have movie/series associations
 */
interface MediaAssociation {
	movie?: {
		id: string;
		title: string;
		year?: number | null;
	} | null;
	series?: {
		id: string;
		title: string;
		year?: number | null;
	} | null;
	seasonNumber?: number | null;
}

/**
 * Media info result containing title, href, and type
 */
export interface MediaInfo {
	title: string;
	href: string;
	type: 'movie' | 'tv';
}

/**
 * Get media info (title and link) from a queue or history item
 * @param item - Queue item or history item with media associations
 * @returns Media info object with title, href, and type, or null if no media is associated
 */
export function getMediaInfo(item: MediaAssociation): MediaInfo | null {
	if (item.movie) {
		return {
			title: item.movie.title + (item.movie.year ? ` (${item.movie.year})` : ''),
			href: `/library/movie/${item.movie.id}`,
			type: 'movie'
		};
	}
	if (item.series) {
		let title = item.series.title + (item.series.year ? ` (${item.series.year})` : '');
		if (item.seasonNumber !== null && item.seasonNumber !== undefined) {
			title += ` - Season ${item.seasonNumber}`;
		}
		return {
			title,
			href: `/library/tv/${item.series.id}`,
			type: 'tv'
		};
	}
	return null;
}
