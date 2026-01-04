/**
 * IPTV Proxy Module
 *
 * Provides HTTP passthrough streaming and M3U playlist generation
 * for Live TV channels.
 *
 * Architecture (based on Stalkerhek patterns):
 * - HTTP passthrough instead of FFmpeg for lower resource usage
 * - HLS manifest rewriting for proxy routing
 * - Stream type detection (HLS vs direct media)
 * - Exponential backoff retry
 */

// Core utilities
export * from './StalkerRetry';
export * from './StreamTypeDetector';
export * from './HlsManifestRewriter';

// Services
export {
	getHttpStreamService,
	type HttpStreamService,
	type ActiveStream
} from './HttpStreamService';
export { getPlaylistGenerator, type PlaylistGenerator } from './PlaylistGenerator';

// Legacy FFmpeg service (kept for archive playback if needed)
export { getFFmpegStreamService, type FFmpegStreamService } from './FFmpegStreamService';

// Constants and types
export * from './constants';
export * from './types';
