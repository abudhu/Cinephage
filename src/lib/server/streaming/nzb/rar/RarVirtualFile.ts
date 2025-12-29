/**
 * RarVirtualFile - Seekable stream for files within RAR archives.
 *
 * Provides a virtual file interface for content inside multi-part RARs,
 * handling the complexity of spanning multiple volumes.
 */

import { Readable, type ReadableOptions } from 'node:stream';
import { logger } from '$lib/logging';
import type { NntpClientManager } from '../nntp/NntpClientManager';
import type { NzbFile } from '../NzbParser';
import { SegmentInterpolator } from '../streams/SegmentInterpolator';
import type { AssembledRar, AssembledRarFile } from './types';
import { findSpansForRange } from './MultiPartAssembler';
import type { ByteRange } from '../streams/types';

/**
 * Options for RarVirtualFile stream.
 */
export interface RarVirtualFileOptions {
	/** Assembled RAR info */
	assembledRar: AssembledRar;
	/** The inner file to stream */
	innerFile: AssembledRarFile;
	/** NZB files (for segment access) */
	nzbFiles: NzbFile[];
	/** NNTP client manager */
	clientManager: NntpClientManager;
	/** Optional byte range */
	range?: ByteRange;
	/** Prefetch count */
	prefetchCount?: number;
}

/**
 * Stream state for RAR virtual file.
 */
interface RarStreamState {
	currentSpanIndex: number;
	positionInSpan: number;
	bytesStreamed: number;
	endByte: number;
	ended: boolean;
}

/**
 * RarVirtualFile streams content from within a RAR archive.
 */
export class RarVirtualFile extends Readable {
	private options: RarVirtualFileOptions;
	private interpolators: Map<number, SegmentInterpolator> = new Map();
	private state: RarStreamState;
	private reading = false;
	private _isDestroyed = false;

	constructor(options: RarVirtualFileOptions, readableOptions?: ReadableOptions) {
		super(readableOptions);
		this.options = options;

		// Create interpolators for each volume
		for (const volume of options.assembledRar.volumes) {
			const nzbFile = options.nzbFiles.find((f) => f.index === volume.nzbFileIndex);
			if (nzbFile) {
				this.interpolators.set(volume.nzbFileIndex, new SegmentInterpolator(nzbFile));
			}
		}

		this.state = this.initializeState();

		logger.debug('[RarVirtualFile] Created stream', {
			file: options.innerFile.name,
			size: options.innerFile.size,
			spans: options.innerFile.spans.length,
			range: options.range
		});
	}

	/**
	 * Initialize stream state.
	 */
	private initializeState(): RarStreamState {
		const totalSize = this.options.innerFile.size;

		if (this.options.range) {
			const startByte = this.options.range.start;
			const endByte =
				this.options.range.end === -1
					? totalSize - 1
					: Math.min(this.options.range.end, totalSize - 1);

			// Find which span contains the start byte
			const spans = findSpansForRange(this.options.innerFile, startByte, endByte);
			if (spans.length === 0) {
				throw new Error(`Invalid range: ${startByte}-${endByte}`);
			}

			return {
				currentSpanIndex: this.findSpanIndex(spans[0].fileOffset),
				positionInSpan: startByte - spans[0].fileOffset,
				bytesStreamed: 0,
				endByte,
				ended: false
			};
		}

		return {
			currentSpanIndex: 0,
			positionInSpan: 0,
			bytesStreamed: 0,
			endByte: totalSize - 1,
			ended: false
		};
	}

	/**
	 * Find span index for a file offset.
	 */
	private findSpanIndex(fileOffset: number): number {
		const spans = this.options.innerFile.spans;
		for (let i = 0; i < spans.length; i++) {
			const span = spans[i];
			if (fileOffset >= span.fileOffset && fileOffset < span.fileOffset + span.size) {
				return i;
			}
		}
		return 0;
	}

	/**
	 * Get content length.
	 */
	get contentLength(): number {
		if (this.options.range) {
			const start = this.options.range.start;
			const end =
				this.options.range.end === -1 ? this.options.innerFile.size - 1 : this.options.range.end;
			return end - start + 1;
		}
		return this.options.innerFile.size;
	}

	/**
	 * Get total size.
	 */
	get totalSize(): number {
		return this.options.innerFile.size;
	}

	/**
	 * Get start byte.
	 */
	get startByte(): number {
		return this.options.range?.start ?? 0;
	}

	/**
	 * Get end byte.
	 */
	get endByte(): number {
		if (this.options.range) {
			return this.options.range.end === -1
				? this.options.innerFile.size - 1
				: this.options.range.end;
		}
		return this.options.innerFile.size - 1;
	}

	/**
	 * Implement Readable._read.
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
	 * Stream next chunk.
	 */
	private async streamNext(): Promise<void> {
		try {
			while (!this.state.ended && !this._isDestroyed) {
				const spans = this.options.innerFile.spans;

				if (this.state.currentSpanIndex >= spans.length) {
					this.state.ended = true;
					this.push(null);
					return;
				}

				const span = spans[this.state.currentSpanIndex];
				const currentFilePos = span.fileOffset + this.state.positionInSpan;

				if (currentFilePos > this.state.endByte) {
					this.state.ended = true;
					this.push(null);
					return;
				}

				// Calculate how much to read
				const spanRemaining = span.size - this.state.positionInSpan;
				const bytesUntilEnd = this.state.endByte - currentFilePos + 1;
				const toRead = Math.min(spanRemaining, bytesUntilEnd);

				if (toRead <= 0) {
					this.state.currentSpanIndex++;
					this.state.positionInSpan = 0;
					continue;
				}

				// Read data from the volume
				const chunk = await this.readFromVolume(
					span.volumeIndex,
					span.volumeOffset + this.state.positionInSpan,
					toRead
				);

				this.state.positionInSpan += chunk.length;
				this.state.bytesStreamed += chunk.length;

				// Move to next span if current is exhausted
				if (this.state.positionInSpan >= span.size) {
					this.state.currentSpanIndex++;
					this.state.positionInSpan = 0;
				}

				const canContinue = this.push(chunk);
				if (!canContinue) {
					this.reading = false;
					return;
				}
			}
		} catch (error) {
			logger.error('[RarVirtualFile] Stream error', {
				file: this.options.innerFile.name,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			throw error;
		} finally {
			this.reading = false;
		}
	}

	/**
	 * Read data from a specific volume at given offset.
	 */
	private async readFromVolume(
		volumeIndex: number,
		offset: number,
		length: number
	): Promise<Buffer> {
		const volume = this.options.assembledRar.volumes[volumeIndex];
		if (!volume) {
			throw new Error(`Volume ${volumeIndex} not found`);
		}

		const nzbFile = this.options.nzbFiles.find((f) => f.index === volume.nzbFileIndex);
		if (!nzbFile) {
			throw new Error(`NZB file for volume ${volumeIndex} not found`);
		}

		const interpolator = this.interpolators.get(volume.nzbFileIndex);
		if (!interpolator) {
			throw new Error(`No interpolator for volume ${volumeIndex}`);
		}

		// Find which segment contains this offset
		const location = interpolator.findSegmentForOffset(offset);
		if (!location) {
			throw new Error(`Offset ${offset} not found in volume`);
		}

		// Fetch and decode the segment
		const result = await this.options.clientManager.getDecodedArticle(location.segment.messageId);

		// Update interpolator with actual size
		interpolator.updateDecodedSize(location.segmentIndex, result.data.length);

		// Extract the portion we need
		const startInSegment = location.offsetInSegment;
		const endInSegment = Math.min(startInSegment + length, result.data.length);

		return result.data.subarray(startInSegment, endInSegment);
	}

	/**
	 * Override destroy.
	 */
	override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
		this._isDestroyed = true;
		this.interpolators.clear();

		logger.debug('[RarVirtualFile] Destroyed', {
			file: this.options.innerFile.name,
			bytesStreamed: this.state.bytesStreamed
		});

		callback(error);
	}
}
