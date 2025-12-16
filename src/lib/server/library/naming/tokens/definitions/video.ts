/**
 * Video tokens - VideoCodec, HDR, BitDepth, 3D
 */

import type { TokenDefinition } from '../types';
import { normalizeVideoCodec } from '../../normalization';

export const videoTokens: TokenDefinition[] = [
	{
		name: 'VideoCodec',
		aliases: ['Codec'],
		category: 'video',
		description: 'Video codec (x264, x265, AV1)',
		applicability: ['movie', 'episode'],
		render: (info) => normalizeVideoCodec(info.codec) || ''
	},
	{
		name: 'HDR',
		category: 'video',
		description: 'HDR format (DV, HDR10, HDR10+)',
		applicability: ['movie', 'episode'],
		render: (info) => info.hdr || ''
	},
	{
		name: 'BitDepth',
		category: 'video',
		description: 'Bit depth (8, 10, 12)',
		applicability: ['movie', 'episode'],
		render: (info) => info.bitDepth || ''
	},
	{
		name: '3D',
		category: 'video',
		description: '"3D" if applicable',
		applicability: ['movie', 'episode'],
		render: (info) => (info.is3D ? '3D' : '')
	}
];
