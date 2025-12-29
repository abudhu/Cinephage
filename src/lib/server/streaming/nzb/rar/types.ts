/**
 * Type definitions for RAR archive handling.
 */

/**
 * RAR archive format version.
 */
export type RarFormat = 'rar4' | 'rar5';

/**
 * RAR compression method.
 * 0x30 = Storing (no compression) - only method we support for streaming
 */
export const RAR_METHOD_STORE = 0x30;

/**
 * RAR magic bytes.
 */
export const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
export const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);

/**
 * File entry within a RAR archive.
 */
export interface RarFileEntry {
	/** File name (with path) */
	name: string;
	/** Uncompressed size in bytes */
	size: number;
	/** Compressed size in bytes */
	compressedSize: number;
	/** Offset of data within archive */
	dataOffset: number;
	/** Compression method (0x30 = stored) */
	method: number;
	/** Whether file is encrypted */
	isEncrypted: boolean;
	/** CRC32 of uncompressed data */
	crc32?: number;
	/** File attributes */
	attributes?: number;
	/** Modification time */
	mtime?: Date;
}

/**
 * Parsed RAR archive info.
 */
export interface RarArchiveInfo {
	/** RAR format version */
	format: RarFormat;
	/** Whether archive is multi-volume */
	isMultiVolume: boolean;
	/** Whether archive has password protection */
	isEncrypted: boolean;
	/** Whether headers are encrypted */
	hasEncryptedHeaders: boolean;
	/** Whether archive uses solid compression */
	isSolid: boolean;
	/** Files in this volume */
	files: RarFileEntry[];
	/** Total header size for seeking */
	headerEndOffset: number;
}

/**
 * Multi-part RAR volume info.
 */
export interface RarVolumeInfo {
	/** Part number (1-based) */
	partNumber: number;
	/** File name pattern base */
	baseName: string;
	/** Archive info for this volume */
	archive: RarArchiveInfo;
	/** NZB file index for this volume */
	nzbFileIndex: number;
}

/**
 * Assembled multi-part RAR with unified byte mapping.
 */
export interface AssembledRar {
	/** All volumes in order */
	volumes: RarVolumeInfo[];
	/** Combined file entries with global offsets */
	files: AssembledRarFile[];
	/** Total uncompressed size */
	totalSize: number;
	/** Whether any volume is encrypted */
	isEncrypted: boolean;
	/** Whether streaming is supported (no compression) */
	isStreamable: boolean;
}

/**
 * File entry with global byte range mapping.
 */
export interface AssembledRarFile {
	/** File name */
	name: string;
	/** Total uncompressed size */
	size: number;
	/** Whether file is encrypted */
	isEncrypted: boolean;
	/** Compression method */
	method: number;
	/** Spans across volumes */
	spans: RarFileSpan[];
}

/**
 * Portion of a file within a volume.
 */
export interface RarFileSpan {
	/** Volume index (0-based) */
	volumeIndex: number;
	/** Offset within the NZB file's data */
	volumeOffset: number;
	/** Offset within the logical file */
	fileOffset: number;
	/** Size of this span */
	size: number;
}

/**
 * RAR detection result.
 */
export interface RarDetectionResult {
	/** Whether this is a RAR archive */
	isRar: boolean;
	/** RAR format if detected */
	format?: RarFormat;
	/** Part number for multi-volume */
	partNumber?: number;
	/** Detection confidence */
	confidence: 'high' | 'medium' | 'low';
}
