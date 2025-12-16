/**
 * Video codec normalization for media naming
 *
 * Maps various video codec name variants to standardized formats.
 */

import { createNormalizationMap, type NormalizationMap } from './types';

const VIDEO_CODEC_MAPPINGS: Record<string, string> = {
	// H.264/AVC
	x264: 'x264',
	h264: 'x264',
	'h.264': 'x264',
	avc: 'x264',

	// H.265/HEVC
	x265: 'x265',
	h265: 'x265',
	'h.265': 'x265',
	hevc: 'x265',

	// Legacy codecs
	xvid: 'XviD',
	divx: 'DivX',

	// Modern codecs
	av1: 'AV1',
	vp9: 'VP9',
	mpeg2: 'MPEG2'
};

export const videoCodecNormalizer: NormalizationMap = createNormalizationMap(VIDEO_CODEC_MAPPINGS);

/**
 * Normalize a video codec name to standard format
 */
export function normalizeVideoCodec(codec: string | undefined): string | undefined {
	if (!codec) return undefined;
	return videoCodecNormalizer.normalize(codec);
}
