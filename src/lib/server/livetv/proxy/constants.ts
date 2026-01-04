/**
 * Constants for IPTV proxy system
 */

// FFmpeg binary paths (configurable via environment)
export const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Timeout settings (in microseconds for FFmpeg -timeout flag)
export const FFMPEG_CONNECT_TIMEOUT_US = 10_000_000; // 10 seconds (connection timeout)
export const FFMPEG_RW_TIMEOUT_US = 30_000_000; // 30 seconds (read/write timeout for stalled streams)

// Stream restart settings (application-level reconnection for expired play tokens)
export const STREAM_MAX_RESTARTS = 3; // Maximum automatic restarts before giving up
export const STREAM_RESTART_DELAY_MS = 500; // Delay between restart attempts
export const STREAM_MIN_HEALTHY_MS = 60_000; // Reset restart counter after 60s of healthy streaming

// Content types
export const MPEGTS_CONTENT_TYPE = 'video/MP2T';
export const M3U_CONTENT_TYPE = 'application/x-mpegurl';
