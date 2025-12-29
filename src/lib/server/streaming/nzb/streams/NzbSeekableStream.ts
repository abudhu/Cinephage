/**
 * NzbSeekableStream - Streamable interface for NZB content.
 *
 * Provides a readable stream that supports HTTP Range requests for seeking.
 * Fetches segments on-demand from NNTP and decodes yEnc data.
 */

import { Readable, type ReadableOptions } from 'node:stream';
import { logger } from '$lib/logging';
import type { NntpClientManager } from '../nntp/NntpClientManager';
import type { NzbFile } from '../NzbParser';
import { SegmentInterpolator } from './SegmentInterpolator';
import { PrefetchBuffer } from './PrefetchBuffer';
import type { ByteRange, StreamState } from './types';

/**
 * Options for creating an NzbSeekableStream.
 */
export interface NzbSeekableStreamOptions {
	/** The NZB file to stream */
	file: NzbFile;
	/** NNTP client manager for fetching articles */
	clientManager: NntpClientManager;
	/** Optional byte range for partial content */
	range?: ByteRange;
	/** Number of segments to prefetch ahead */
	prefetchCount?: number;
	/** Progress callback */
	onProgress?: (bytesStreamed: number, totalBytes: number) => void;
}

/**
 * NzbSeekableStream streams NZB content with seeking support.
 */
export class NzbSeekableStream extends Readable {
	private interpolator: SegmentInterpolator;
	private prefetch: PrefetchBuffer;
	private clientManager: NntpClientManager;
	private file: NzbFile;
	private state: StreamState;
	private range: ByteRange | null;
	private onProgress?: (bytesStreamed: number, totalBytes: number) => void;
	private reading = false;
	private currentSegmentData: Buffer | null = null;
	private _isDestroyed = false;

	constructor(options: NzbSeekableStreamOptions, readableOptions?: ReadableOptions) {
		super(readableOptions);

		this.file = options.file;
		this.clientManager = options.clientManager;
		this.range = options.range ?? null;
		this.onProgress = options.onProgress;
		this.interpolator = new SegmentInterpolator(options.file);

		// Get first group for NNTP commands
		const group = options.file.groups[0] || 'alt.binaries';

		this.prefetch = new PrefetchBuffer(options.clientManager, options.file.segments, group, {
			prefetchCount: options.prefetchCount ?? 5
		});

		// Initialize state based on range
		this.state = this.initializeState();

		logger.debug('[NzbSeekableStream] Created stream', {
			file: this.file.name,
			totalSize: this.interpolator.totalSize,
			segments: this.file.segments.length,
			range: this.range
		});
	}

	/**
	 * Initialize stream state based on range.
	 */
	private initializeState(): StreamState {
		const totalSize = this.interpolator.totalSize;

		if (this.range) {
			const startByte = this.range.start;
			const endByte =
				this.range.end === -1 ? totalSize - 1 : Math.min(this.range.end, totalSize - 1);

			const startLoc = this.interpolator.findSegmentForOffset(startByte);
			if (!startLoc) {
				throw new Error(`Invalid range start: ${startByte}`);
			}

			return {
				currentSegmentIndex: startLoc.segmentIndex,
				positionInSegment: startLoc.offsetInSegment,
				bytesStreamed: 0,
				endByte,
				ended: false
			};
		}

		// Full file stream
		return {
			currentSegmentIndex: 0,
			positionInSegment: 0,
			bytesStreamed: 0,
			endByte: totalSize - 1,
			ended: false
		};
	}

	/**
	 * Get content length for this stream.
	 */
	get contentLength(): number {
		if (this.range) {
			const start = this.range.start;
			const end = this.range.end === -1 ? this.interpolator.totalSize - 1 : this.range.end;
			return end - start + 1;
		}
		return this.interpolator.totalSize;
	}

	/**
	 * Get total file size.
	 */
	get totalSize(): number {
		return this.interpolator.totalSize;
	}

	/**
	 * Get start byte for range response.
	 */
	get startByte(): number {
		return this.range?.start ?? 0;
	}

	/**
	 * Get end byte for range response.
	 */
	get endByte(): number {
		if (this.range) {
			return this.range.end === -1 ? this.interpolator.totalSize - 1 : this.range.end;
		}
		return this.interpolator.totalSize - 1;
	}

	/**
	 * Implement Readable._read for streaming.
	 */
	override _read(_size: number): void {
		if (this.reading || this.state.ended || this._isDestroyed) {
			return;
		}

		this.reading = true;
		this.streamNext().catch((error) => {
			this.destroy(error instanceof Error ? error : new Error(String(error)));
		});
	}

	/**
	 * Stream the next chunk of data.
	 */
	private async streamNext(): Promise<void> {
		try {
			while (!this.state.ended && !this._isDestroyed) {
				// Check if we've reached the end byte
				const currentBytePos = this.calculateCurrentBytePosition();
				if (currentBytePos > this.state.endByte) {
					this.state.ended = true;
					this.push(null);
					return;
				}

				// Get current segment data if not loaded
				if (!this.currentSegmentData) {
					if (this.state.currentSegmentIndex >= this.file.segments.length) {
						this.state.ended = true;
						this.push(null);
						return;
					}

					this.currentSegmentData = await this.prefetch.getSegment(this.state.currentSegmentIndex);

					// Update interpolator with actual size
					this.interpolator.updateDecodedSize(
						this.state.currentSegmentIndex,
						this.currentSegmentData.length
					);
				}

				// Calculate how much to read from current segment
				const segmentRemaining = this.currentSegmentData.length - this.state.positionInSegment;
				const bytesUntilEnd = this.state.endByte - currentBytePos + 1;
				const toRead = Math.min(segmentRemaining, bytesUntilEnd);

				if (toRead <= 0) {
					// Move to next segment
					this.state.currentSegmentIndex++;
					this.state.positionInSegment = 0;
					this.currentSegmentData = null;
					continue;
				}

				// Extract the chunk
				const chunk = this.currentSegmentData.subarray(
					this.state.positionInSegment,
					this.state.positionInSegment + toRead
				);

				this.state.positionInSegment += toRead;
				this.state.bytesStreamed += toRead;

				// Report progress
				if (this.onProgress) {
					this.onProgress(this.state.bytesStreamed, this.contentLength);
				}

				// Check if segment exhausted
				if (this.state.positionInSegment >= this.currentSegmentData.length) {
					this.state.currentSegmentIndex++;
					this.state.positionInSegment = 0;
					this.currentSegmentData = null;
				}

				// Push chunk
				const canContinue = this.push(chunk);
				if (!canContinue) {
					this.reading = false;
					return;
				}
			}
		} catch (error) {
			logger.error('[NzbSeekableStream] Stream error', {
				file: this.file.name,
				segment: this.state.currentSegmentIndex,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			throw error;
		} finally {
			this.reading = false;
		}
	}

	/**
	 * Calculate current byte position in the file.
	 */
	private calculateCurrentBytePosition(): number {
		const segmentOffset = this.interpolator.getSegmentOffset(this.state.currentSegmentIndex);
		return segmentOffset + this.state.positionInSegment;
	}

	/**
	 * Override destroy to clean up resources.
	 */
	override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
		this._isDestroyed = true;
		this.prefetch.clear();
		this.currentSegmentData = null;

		logger.debug('[NzbSeekableStream] Stream destroyed', {
			file: this.file.name,
			bytesStreamed: this.state.bytesStreamed,
			error: error?.message
		});

		callback(error);
	}

	/**
	 * Get stream statistics.
	 */
	get stats(): {
		bytesStreamed: number;
		currentSegment: number;
		totalSegments: number;
		cacheStats: { cached: number; pending: number; maxSize: number };
	} {
		return {
			bytesStreamed: this.state.bytesStreamed,
			currentSegment: this.state.currentSegmentIndex,
			totalSegments: this.file.segments.length,
			cacheStats: this.prefetch.stats
		};
	}
}

/**
 * Parse HTTP Range header.
 * Returns null if header is invalid or missing.
 */
export function parseRangeHeader(header: string | null, totalSize: number): ByteRange | null {
	if (!header) {
		return null;
	}

	// Format: "bytes=start-end" or "bytes=start-" or "bytes=-suffix"
	const match = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) {
		return null;
	}

	const [, startStr, endStr] = match;

	if (startStr === '' && endStr === '') {
		return null;
	}

	if (startStr === '') {
		// Suffix range: bytes=-500 means last 500 bytes
		const suffix = parseInt(endStr, 10);
		if (isNaN(suffix) || suffix <= 0) {
			return null;
		}
		return {
			start: Math.max(0, totalSize - suffix),
			end: totalSize - 1
		};
	}

	const start = parseInt(startStr, 10);
	if (isNaN(start) || start < 0 || start >= totalSize) {
		return null;
	}

	if (endStr === '') {
		// Open-ended: bytes=500-
		return { start, end: -1 };
	}

	const end = parseInt(endStr, 10);
	if (isNaN(end) || end < start) {
		return null;
	}

	return {
		start,
		end: Math.min(end, totalSize - 1)
	};
}
