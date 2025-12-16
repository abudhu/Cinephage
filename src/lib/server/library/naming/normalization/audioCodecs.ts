/**
 * Audio codec normalization for media naming
 *
 * Maps various audio codec name variants to standardized formats.
 */

import { createNormalizationMap, type NormalizationMap } from './types';

/**
 * Pre-process audio codec input by removing non-alphanumeric characters
 */
function preprocessAudioCodec(codec: string): string {
	return codec.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const AUDIO_CODEC_MAPPINGS: Record<string, string> = {
	// Lossless formats
	truehd: 'TrueHD',
	'truehd atmos': 'TrueHD Atmos',
	truhdatmos: 'TrueHD Atmos',
	truehdatmos: 'TrueHD Atmos',
	dtshd: 'DTS-HD',
	dtshdma: 'DTS-HD MA',
	'dtshd ma': 'DTS-HD MA',
	dtsx: 'DTS-X',
	flac: 'FLAC',
	pcm: 'PCM',
	lpcm: 'LPCM',

	// Lossy formats
	dts: 'DTS',
	'dolby digital': 'DD',
	dolbydigital: 'DD',
	dd: 'DD',
	ddp: 'DD+',
	'dd+': 'DD+',
	ddplus: 'DD+',
	eac3: 'EAC3',
	ac3: 'AC3',
	aac: 'AAC',
	mp3: 'MP3',
	opus: 'Opus',
	vorbis: 'Vorbis'
};

export const audioCodecNormalizer: NormalizationMap = createNormalizationMap(AUDIO_CODEC_MAPPINGS);

/**
 * Normalize an audio codec name to standard format
 */
export function normalizeAudioCodec(codec: string | undefined): string | undefined {
	if (!codec) return undefined;
	const preprocessed = preprocessAudioCodec(codec);
	return audioCodecNormalizer.normalize(preprocessed);
}
