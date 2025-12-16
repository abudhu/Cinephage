/**
 * Source name normalization for media naming
 *
 * Maps various source name variants to standardized formats
 * following TRaSH Guides conventions.
 */

import { createNormalizationMap, type NormalizationMap } from './types';

const SOURCE_MAPPINGS: Record<string, string> = {
	// Blu-ray variants
	bluray: 'Bluray',
	'blu-ray': 'Bluray',
	bdrip: 'Bluray',
	brrip: 'Bluray',

	// Remux
	remux: 'Remux',

	// Web sources
	webdl: 'WEB-DL',
	'web-dl': 'WEB-DL',
	'web dl': 'WEB-DL',
	webrip: 'WEBRip',
	'web-rip': 'WEBRip',
	web: 'WEB',

	// TV sources
	hdtv: 'HDTV',
	pdtv: 'PDTV',
	dsr: 'DSR',

	// DVD sources
	dvdrip: 'DVDRip',
	dvd: 'DVD',

	// Low quality sources
	hdcam: 'HDCAM',
	hdrip: 'HDRip',
	cam: 'CAM',
	telesync: 'TS',
	ts: 'TS',
	telecine: 'TC',
	tc: 'TC',
	screener: 'SCR',
	scr: 'SCR',
	r5: 'R5'
};

export const sourceNormalizer: NormalizationMap = createNormalizationMap(SOURCE_MAPPINGS);

/**
 * Normalize a source name to standard format
 */
export function normalizeSource(source: string): string {
	return sourceNormalizer.normalize(source);
}
