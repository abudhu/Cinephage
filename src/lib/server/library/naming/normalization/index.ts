/**
 * Normalization module for media naming
 *
 * Provides consistent string transformations for sources, codecs, and audio formats.
 */

export { normalizeSource, sourceNormalizer } from './sources';
export { normalizeVideoCodec, videoCodecNormalizer } from './videoCodecs';
export { normalizeAudioCodec, audioCodecNormalizer } from './audioCodecs';
export { createNormalizationMap, type NormalizationMap } from './types';
