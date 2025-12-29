/**
 * MultiPartAssembler - Assembles multi-part RAR archives.
 *
 * Creates a unified byte mapping across all volumes for seamless streaming.
 */

import { logger } from '$lib/logging';
import { detectRarFromFilename, getRarPartOrder, getRarBaseName } from './RarDetector';
import { parseRarArchive, canStreamRar, getStreamingError } from './RarHeaderParser';
import type { NzbFile } from '../NzbParser';
import type { NntpClientManager } from '../nntp/NntpClientManager';
import type { RarVolumeInfo, AssembledRar, AssembledRarFile, RarFileSpan } from './types';

/**
 * Minimum bytes needed to parse RAR header.
 */
const RAR_HEADER_PEEK_SIZE = 64 * 1024; // 64KB should be enough for headers

/**
 * Assemble multi-part RAR files into a unified structure.
 */
export async function assembleMultiPartRar(
	nzbFiles: NzbFile[],
	clientManager: NntpClientManager
): Promise<AssembledRar> {
	// Filter and sort RAR files
	const rarFiles = nzbFiles
		.filter((f) => detectRarFromFilename(f.name).isRar)
		.sort((a, b) => getRarPartOrder(a.name) - getRarPartOrder(b.name));

	if (rarFiles.length === 0) {
		throw new Error('No RAR files found');
	}

	const baseName = getRarBaseName(rarFiles[0].name);
	const volumes: RarVolumeInfo[] = [];
	let isEncrypted = false;
	let isStreamable = true;
	let streamError: string | null = null;

	// Parse each volume's headers
	for (let i = 0; i < rarFiles.length; i++) {
		const file = rarFiles[i];
		const partNumber = getRarPartOrder(file.name);

		logger.debug('[MultiPartAssembler] Parsing volume', {
			name: file.name,
			part: partNumber,
			segments: file.segments.length
		});

		// Fetch enough data to parse headers
		const headerData = await fetchHeaderData(file, clientManager, RAR_HEADER_PEEK_SIZE);

		const archive = parseRarArchive(headerData);
		if (!archive) {
			throw new Error(`Failed to parse RAR headers for ${file.name}`);
		}

		// Check streamability
		if (!canStreamRar(archive)) {
			isStreamable = false;
			streamError = streamError || getStreamingError(archive);
		}

		if (archive.isEncrypted) {
			isEncrypted = true;
		}

		volumes.push({
			partNumber,
			baseName,
			archive,
			nzbFileIndex: file.index
		});
	}

	// Assemble file entries with global offsets
	const assembledFiles = assembleFiles(volumes);

	const totalSize = assembledFiles.reduce((sum, f) => sum + f.size, 0);

	logger.info('[MultiPartAssembler] Assembled RAR', {
		baseName,
		volumes: volumes.length,
		files: assembledFiles.length,
		totalSize,
		isStreamable,
		isEncrypted
	});

	if (!isStreamable && streamError) {
		logger.warn('[MultiPartAssembler] RAR not streamable', { reason: streamError });
	}

	return {
		volumes,
		files: assembledFiles,
		totalSize,
		isEncrypted,
		isStreamable
	};
}

/**
 * Fetch enough data from NZB file to parse RAR headers.
 */
async function fetchHeaderData(
	file: NzbFile,
	clientManager: NntpClientManager,
	maxBytes: number
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	for (const segment of file.segments) {
		if (totalBytes >= maxBytes) break;

		try {
			const result = await clientManager.getDecodedArticle(segment.messageId);
			chunks.push(result.data);
			totalBytes += result.data.length;
		} catch (error) {
			// If first segment fails, we can't proceed
			if (chunks.length === 0) {
				throw error;
			}
			// Otherwise, try with what we have
			break;
		}
	}

	return Buffer.concat(chunks);
}

/**
 * Assemble files from all volumes with global byte mapping.
 */
function assembleFiles(volumes: RarVolumeInfo[]): AssembledRarFile[] {
	const fileMap = new Map<string, AssembledRarFile>();

	for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex++) {
		const volume = volumes[volumeIndex];

		for (const entry of volume.archive.files) {
			let assembled = fileMap.get(entry.name);

			if (!assembled) {
				assembled = {
					name: entry.name,
					size: entry.size,
					isEncrypted: entry.isEncrypted,
					method: entry.method,
					spans: []
				};
				fileMap.set(entry.name, assembled);
			}

			// Calculate file offset from previous spans
			const previousSpansSize = assembled.spans.reduce((sum, s) => sum + s.size, 0);

			assembled.spans.push({
				volumeIndex,
				volumeOffset: entry.dataOffset,
				fileOffset: previousSpansSize,
				size: entry.compressedSize // For stored files, this equals uncompressed
			});
		}
	}

	return Array.from(fileMap.values());
}

/**
 * Find spans needed to read a byte range from an assembled file.
 */
export function findSpansForRange(
	file: AssembledRarFile,
	startByte: number,
	endByte: number
): RarFileSpan[] {
	const result: RarFileSpan[] = [];

	for (const span of file.spans) {
		const spanEnd = span.fileOffset + span.size - 1;

		// Skip spans before our range
		if (spanEnd < startByte) continue;

		// Stop if we've passed our range
		if (span.fileOffset > endByte) break;

		// Calculate overlap
		const overlapStart = Math.max(startByte, span.fileOffset);
		const overlapEnd = Math.min(endByte, spanEnd);

		result.push({
			volumeIndex: span.volumeIndex,
			volumeOffset: span.volumeOffset + (overlapStart - span.fileOffset),
			fileOffset: overlapStart,
			size: overlapEnd - overlapStart + 1
		});
	}

	return result;
}

/**
 * Get the volume and offset for a specific file byte position.
 */
export function getPositionInVolume(
	file: AssembledRarFile,
	bytePosition: number
): { volumeIndex: number; offset: number } | null {
	for (const span of file.spans) {
		const spanEnd = span.fileOffset + span.size;

		if (bytePosition >= span.fileOffset && bytePosition < spanEnd) {
			const offsetInSpan = bytePosition - span.fileOffset;
			return {
				volumeIndex: span.volumeIndex,
				offset: span.volumeOffset + offsetInSpan
			};
		}
	}

	return null;
}
