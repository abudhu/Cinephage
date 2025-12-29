/**
 * Type definitions for NZB streaming.
 */

import type { NzbFile, NzbSegment } from '../NzbParser';

/**
 * Segment location info for seeking.
 */
export interface SegmentLocation {
	/** Index in the file's segments array */
	segmentIndex: number;
	/** Offset within the decoded segment data */
	offsetInSegment: number;
	/** The segment info */
	segment: NzbSegment;
}

/**
 * Range of segments to fetch.
 */
export interface SegmentRange {
	/** Starting segment index */
	startIndex: number;
	/** Ending segment index (inclusive) */
	endIndex: number;
	/** Byte offset to skip in first segment */
	startOffset: number;
	/** Byte limit in last segment (0 = full segment) */
	endLimit: number;
}

/**
 * HTTP Range request parsed.
 */
export interface ByteRange {
	/** Start byte (inclusive) */
	start: number;
	/** End byte (inclusive), -1 for open-ended */
	end: number;
}

/**
 * Stream options for NzbSeekableStream.
 */
export interface NzbStreamOptions {
	/** The NZB file to stream */
	file: NzbFile;
	/** Optional byte range for partial content */
	range?: ByteRange;
	/** Number of segments to prefetch ahead */
	prefetchCount?: number;
	/** Callback for progress updates */
	onProgress?: (bytesStreamed: number, totalBytes: number) => void;
}

/**
 * Cached segment data.
 */
export interface CachedSegment {
	/** Segment index */
	index: number;
	/** Decoded data */
	data: Buffer;
	/** Timestamp when cached */
	timestamp: number;
}

/**
 * Stream state for tracking position.
 */
export interface StreamState {
	/** Current segment index being streamed */
	currentSegmentIndex: number;
	/** Position within current segment */
	positionInSegment: number;
	/** Total bytes streamed so far */
	bytesStreamed: number;
	/** Target end byte (for range requests) */
	endByte: number;
	/** Whether stream has ended */
	ended: boolean;
}
