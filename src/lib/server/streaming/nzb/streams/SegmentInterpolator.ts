/**
 * SegmentInterpolator - Maps byte offsets to NZB segments.
 *
 * Handles the challenge that segment boundaries are estimates until
 * yEnc headers are actually decoded. Uses segment byte sizes from NZB
 * for initial mapping, then refines with actual decoded sizes.
 */

import type { NzbFile, NzbSegment } from '../NzbParser';
import type { SegmentLocation, SegmentRange, ByteRange } from './types';

/**
 * Actual segment size info after decoding.
 */
interface DecodedSegmentInfo {
	/** Actual decoded size (may differ from NZB estimate) */
	actualSize: number;
	/** Cumulative offset up to this segment */
	cumulativeOffset: number;
}

/**
 * SegmentInterpolator maps byte positions to segments for seeking.
 */
export class SegmentInterpolator {
	private file: NzbFile;
	private estimatedOffsets: number[];
	private decodedInfo: Map<number, DecodedSegmentInfo> = new Map();
	private totalEstimatedSize: number;

	constructor(file: NzbFile) {
		this.file = file;
		this.estimatedOffsets = this.buildEstimatedOffsets();
		this.totalEstimatedSize = file.size;
	}

	/**
	 * Build estimated cumulative byte offsets for each segment.
	 */
	private buildEstimatedOffsets(): number[] {
		const offsets: number[] = [];
		let cumulative = 0;

		for (const segment of this.file.segments) {
			offsets.push(cumulative);
			cumulative += segment.bytes;
		}

		return offsets;
	}

	/**
	 * Get total file size (estimated or refined).
	 */
	get totalSize(): number {
		if (this.decodedInfo.size === this.file.segments.length) {
			// All segments decoded, use actual total
			const lastInfo = this.decodedInfo.get(this.file.segments.length - 1);
			if (lastInfo) {
				return lastInfo.cumulativeOffset + lastInfo.actualSize;
			}
		}
		return this.totalEstimatedSize;
	}

	/**
	 * Find which segment contains a byte offset.
	 */
	findSegmentForOffset(byteOffset: number): SegmentLocation | null {
		if (byteOffset < 0 || byteOffset >= this.totalSize) {
			return null;
		}

		// Use decoded info if available, otherwise estimates
		let cumulativeOffset = 0;

		for (let i = 0; i < this.file.segments.length; i++) {
			const segment = this.file.segments[i];
			const decoded = this.decodedInfo.get(i);
			const segmentSize = decoded?.actualSize ?? segment.bytes;

			if (byteOffset < cumulativeOffset + segmentSize) {
				return {
					segmentIndex: i,
					offsetInSegment: byteOffset - cumulativeOffset,
					segment
				};
			}

			cumulativeOffset += segmentSize;
		}

		// Edge case: exactly at end
		const lastIndex = this.file.segments.length - 1;
		return {
			segmentIndex: lastIndex,
			offsetInSegment: this.file.segments[lastIndex].bytes,
			segment: this.file.segments[lastIndex]
		};
	}

	/**
	 * Get segment range for a byte range request.
	 */
	getSegmentRange(range: ByteRange): SegmentRange | null {
		const startLoc = this.findSegmentForOffset(range.start);
		if (!startLoc) {
			return null;
		}

		const endByte = range.end === -1 ? this.totalSize - 1 : range.end;
		const endLoc = this.findSegmentForOffset(Math.min(endByte, this.totalSize - 1));
		if (!endLoc) {
			return null;
		}

		return {
			startIndex: startLoc.segmentIndex,
			endIndex: endLoc.segmentIndex,
			startOffset: startLoc.offsetInSegment,
			endLimit: endLoc.offsetInSegment + 1 // +1 because end is inclusive
		};
	}

	/**
	 * Update with actual decoded segment size.
	 * Call this after decoding each segment to refine offset calculations.
	 */
	updateDecodedSize(segmentIndex: number, actualSize: number): void {
		let cumulativeOffset = 0;

		// Calculate cumulative offset up to this segment
		for (let i = 0; i < segmentIndex; i++) {
			const info = this.decodedInfo.get(i);
			if (info) {
				cumulativeOffset = info.cumulativeOffset + info.actualSize;
			} else {
				cumulativeOffset += this.file.segments[i].bytes;
			}
		}

		this.decodedInfo.set(segmentIndex, {
			actualSize,
			cumulativeOffset
		});
	}

	/**
	 * Get estimated byte offset for a segment.
	 */
	getSegmentOffset(segmentIndex: number): number {
		if (segmentIndex < 0 || segmentIndex >= this.file.segments.length) {
			return -1;
		}

		const decoded = this.decodedInfo.get(segmentIndex);
		if (decoded) {
			return decoded.cumulativeOffset;
		}

		return this.estimatedOffsets[segmentIndex];
	}

	/**
	 * Get segment by index.
	 */
	getSegment(index: number): NzbSegment | null {
		if (index < 0 || index >= this.file.segments.length) {
			return null;
		}
		return this.file.segments[index];
	}

	/**
	 * Get total number of segments.
	 */
	get segmentCount(): number {
		return this.file.segments.length;
	}

	/**
	 * Get the file being interpolated.
	 */
	getFile(): NzbFile {
		return this.file;
	}
}
