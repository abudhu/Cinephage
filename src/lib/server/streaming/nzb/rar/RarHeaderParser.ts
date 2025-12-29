/**
 * RarHeaderParser - Parse RAR4 and RAR5 archive headers.
 *
 * Extracts file entries with sizes and offsets for streaming.
 * Only supports stored (uncompressed) files for streaming.
 */

import { logger } from '$lib/logging';
import {
	RAR4_SIGNATURE,
	RAR5_SIGNATURE,
	RAR_METHOD_STORE,
	type RarArchiveInfo,
	type RarFileEntry
} from './types';

/**
 * RAR4 header types.
 */
const RAR4_HEADER = {
	MARK: 0x72,
	MAIN: 0x73,
	FILE: 0x74,
	COMMENT: 0x75,
	EXTRA: 0x76,
	SUBBLOCK: 0x77,
	RECOVERY: 0x78,
	END: 0x7b
};

/**
 * RAR4 main header flags.
 */
const RAR4_MAIN_FLAGS = {
	VOLUME: 0x0001,
	COMMENT: 0x0002,
	LOCK: 0x0004,
	SOLID: 0x0008,
	NEW_VOLUME_NAMING: 0x0010,
	AUTH: 0x0020,
	RECOVERY: 0x0040,
	ENCRYPTED: 0x0080,
	FIRST_VOLUME: 0x0100
};

/**
 * RAR4 file header flags.
 */
const RAR4_FILE_FLAGS = {
	CONTINUED_FROM_PREV: 0x0001,
	CONTINUED_TO_NEXT: 0x0002,
	ENCRYPTED: 0x0004,
	COMMENT: 0x0008,
	SOLID: 0x0010,
	LARGE_FILE: 0x0100,
	UNICODE: 0x0200,
	SALT: 0x0400,
	EXTTIME: 0x1000
};

/**
 * RAR5 header types.
 */
const RAR5_HEADER = {
	MAIN: 1,
	FILE: 2,
	SERVICE: 3,
	ENCRYPTION: 4,
	END: 5
};

/**
 * RAR5 main header flags.
 */
const RAR5_MAIN_FLAGS = {
	VOLUME: 0x0001,
	VOLUME_NUMBER: 0x0002,
	SOLID: 0x0004,
	RECOVERY: 0x0008,
	LOCKED: 0x0010
};

/**
 * RAR5 file header flags.
 */
const RAR5_FILE_FLAGS = {
	DIRECTORY: 0x0001,
	UNIX_TIME: 0x0002,
	CRC32: 0x0004,
	UNKNOWN_SIZE: 0x0008
};

/**
 * Parse RAR archive headers.
 */
export function parseRarArchive(data: Buffer): RarArchiveInfo | null {
	// Detect format
	if (data.length < 8) {
		return null;
	}

	if (data.subarray(0, 8).equals(RAR5_SIGNATURE)) {
		return parseRar5Archive(data);
	}

	if (data.subarray(0, 7).equals(RAR4_SIGNATURE)) {
		return parseRar4Archive(data);
	}

	return null;
}

/**
 * Parse RAR4 archive.
 */
function parseRar4Archive(data: Buffer): RarArchiveInfo | null {
	let offset = 7; // Skip signature
	const files: RarFileEntry[] = [];
	let isMultiVolume = false;
	let isEncrypted = false;
	let hasEncryptedHeaders = false;
	let isSolid = false;

	try {
		while (offset < data.length - 7) {
			// Read header
			const _crc = data.readUInt16LE(offset);
			const type = data.readUInt8(offset + 2);
			const flags = data.readUInt16LE(offset + 3);
			const size = data.readUInt16LE(offset + 5);

			if (size < 7) break;

			const hasAddSize = (flags & 0x8000) !== 0;
			let addSize = 0;
			if (hasAddSize && offset + 7 + 4 <= data.length) {
				addSize = data.readUInt32LE(offset + 7);
			}

			const headerEnd = offset + size;
			const dataEnd = headerEnd + addSize;

			if (type === RAR4_HEADER.MAIN) {
				isMultiVolume = (flags & RAR4_MAIN_FLAGS.VOLUME) !== 0;
				isSolid = (flags & RAR4_MAIN_FLAGS.SOLID) !== 0;
				isEncrypted = (flags & RAR4_MAIN_FLAGS.ENCRYPTED) !== 0;
				hasEncryptedHeaders = isEncrypted;
			} else if (type === RAR4_HEADER.FILE) {
				const file = parseRar4FileHeader(data, offset, flags, size);
				if (file) {
					file.dataOffset = headerEnd;
					files.push(file);
				}
			} else if (type === RAR4_HEADER.END) {
				break;
			}

			offset = dataEnd;
		}

		return {
			format: 'rar4',
			isMultiVolume,
			isEncrypted,
			hasEncryptedHeaders,
			isSolid,
			files,
			headerEndOffset: offset
		};
	} catch (error) {
		logger.warn('[RarHeaderParser] Failed to parse RAR4 archive', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return null;
	}
}

/**
 * Parse RAR4 file header.
 */
function parseRar4FileHeader(
	data: Buffer,
	offset: number,
	flags: number,
	_headerSize: number
): RarFileEntry | null {
	try {
		const baseOffset = offset + 7;
		const compressedSize = data.readUInt32LE(baseOffset);
		const uncompressedSize = data.readUInt32LE(baseOffset + 4);
		const _hostOS = data.readUInt8(baseOffset + 8);
		const crc32 = data.readUInt32LE(baseOffset + 9);
		const mtime = data.readUInt32LE(baseOffset + 13);
		const _version = data.readUInt8(baseOffset + 17);
		const method = data.readUInt8(baseOffset + 18);
		const nameSize = data.readUInt16LE(baseOffset + 19);
		const attributes = data.readUInt32LE(baseOffset + 21);

		// Handle large files
		let actualCompressedSize = compressedSize;
		let actualUncompressedSize = uncompressedSize;
		if (flags & RAR4_FILE_FLAGS.LARGE_FILE) {
			const highCompressed = data.readUInt32LE(baseOffset + 25);
			const highUncompressed = data.readUInt32LE(baseOffset + 29);
			actualCompressedSize = compressedSize + highCompressed * 0x100000000;
			actualUncompressedSize = uncompressedSize + highUncompressed * 0x100000000;
		}

		// Read filename
		const nameOffset = baseOffset + 25 + (flags & RAR4_FILE_FLAGS.LARGE_FILE ? 8 : 0);
		const name = data.subarray(nameOffset, nameOffset + nameSize).toString('utf8');

		return {
			name,
			size: actualUncompressedSize,
			compressedSize: actualCompressedSize,
			dataOffset: 0, // Set by caller
			method,
			isEncrypted: (flags & RAR4_FILE_FLAGS.ENCRYPTED) !== 0,
			crc32,
			attributes,
			mtime: new Date(mtime * 1000)
		};
	} catch {
		return null;
	}
}

/**
 * Parse RAR5 archive.
 */
function parseRar5Archive(data: Buffer): RarArchiveInfo | null {
	let offset = 8; // Skip signature
	const files: RarFileEntry[] = [];
	let isMultiVolume = false;
	let isEncrypted = false;
	let hasEncryptedHeaders = false;
	let isSolid = false;

	try {
		while (offset < data.length - 7) {
			// Read vint header CRC
			const _headerCrc = data.readUInt32LE(offset);
			offset += 4;

			// Read header size (vint)
			const { value: headerSize, bytes: headerSizeBytes } = readVint(data, offset);
			offset += headerSizeBytes;

			const headerStart = offset;
			const headerEnd = headerStart + headerSize;

			// Read header type (vint)
			const { value: headerType, bytes: typeBytes } = readVint(data, offset);
			offset += typeBytes;

			// Read header flags (vint)
			const { value: headerFlags, bytes: flagsBytes } = readVint(data, offset);
			offset += flagsBytes;

			const hasExtraArea = (headerFlags & 0x0001) !== 0;
			const hasDataArea = (headerFlags & 0x0002) !== 0;

			let dataSize = 0;

			if (hasExtraArea) {
				const { bytes } = readVint(data, offset);
				offset += bytes;
			}

			if (hasDataArea) {
				const { value, bytes } = readVint(data, offset);
				dataSize = value;
				offset += bytes;
			}

			if (headerType === RAR5_HEADER.MAIN) {
				const { value: mainFlags } = readVint(data, offset);
				isMultiVolume = (mainFlags & RAR5_MAIN_FLAGS.VOLUME) !== 0;
				isSolid = (mainFlags & RAR5_MAIN_FLAGS.SOLID) !== 0;
			} else if (headerType === RAR5_HEADER.FILE) {
				const file = parseRar5FileHeader(data, offset, headerEnd);
				if (file) {
					file.dataOffset = headerEnd;
					file.compressedSize = dataSize;
					files.push(file);
				}
			} else if (headerType === RAR5_HEADER.ENCRYPTION) {
				isEncrypted = true;
				hasEncryptedHeaders = true;
			} else if (headerType === RAR5_HEADER.END) {
				break;
			}

			offset = headerEnd + dataSize;
		}

		return {
			format: 'rar5',
			isMultiVolume,
			isEncrypted,
			hasEncryptedHeaders,
			isSolid,
			files,
			headerEndOffset: offset
		};
	} catch (error) {
		logger.warn('[RarHeaderParser] Failed to parse RAR5 archive', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
		return null;
	}
}

/**
 * Parse RAR5 file header.
 */
function parseRar5FileHeader(
	data: Buffer,
	offset: number,
	_headerEnd: number
): RarFileEntry | null {
	try {
		// Read file flags (vint)
		const { value: fileFlags, bytes: flagsBytes } = readVint(data, offset);
		offset += flagsBytes;

		// Read unpacked size (vint)
		const { value: unpackedSize, bytes: sizeBytes } = readVint(data, offset);
		offset += sizeBytes;

		// Read attributes (vint)
		const { value: attributes, bytes: attrBytes } = readVint(data, offset);
		offset += attrBytes;

		let mtime: Date | undefined;
		let crc32: number | undefined;

		// Read mtime if present
		if (fileFlags & RAR5_FILE_FLAGS.UNIX_TIME) {
			mtime = new Date(data.readUInt32LE(offset) * 1000);
			offset += 4;
		}

		// Read CRC32 if present
		if (fileFlags & RAR5_FILE_FLAGS.CRC32) {
			crc32 = data.readUInt32LE(offset);
			offset += 4;
		}

		// Read compression info (vint)
		const { value: compressionInfo, bytes: compBytes } = readVint(data, offset);
		offset += compBytes;

		const method = compressionInfo & 0x3f; // Lower 6 bits

		// Read host OS (vint)
		const { bytes: osBytes } = readVint(data, offset);
		offset += osBytes;

		// Read name length (vint)
		const { value: nameLength, bytes: nameLenBytes } = readVint(data, offset);
		offset += nameLenBytes;

		// Read name
		const name = data.subarray(offset, offset + nameLength).toString('utf8');

		return {
			name,
			size: unpackedSize,
			compressedSize: 0, // Set by caller
			dataOffset: 0, // Set by caller
			method,
			isEncrypted: false, // Determined from encryption header
			crc32,
			attributes,
			mtime
		};
	} catch {
		return null;
	}
}

/**
 * Read variable-length integer (vint).
 */
function readVint(data: Buffer, offset: number): { value: number; bytes: number } {
	let value = 0;
	let bytes = 0;
	let shift = 0;

	while (offset + bytes < data.length) {
		const b = data.readUInt8(offset + bytes);
		bytes++;

		value |= (b & 0x7f) << shift;
		shift += 7;

		if ((b & 0x80) === 0) {
			break;
		}
	}

	return { value, bytes };
}

/**
 * Check if RAR archive can be streamed.
 * Streaming is only supported for stored (non-compressed) files.
 */
export function canStreamRar(archive: RarArchiveInfo): boolean {
	// Can't stream encrypted headers
	if (archive.hasEncryptedHeaders) {
		return false;
	}

	// Can't stream solid archives
	if (archive.isSolid) {
		return false;
	}

	// Check if all files are stored (method 0 or 0x30)
	for (const file of archive.files) {
		if (file.method !== 0 && file.method !== RAR_METHOD_STORE) {
			return false;
		}
	}

	return true;
}

/**
 * Get streaming error reason if not streamable.
 */
export function getStreamingError(archive: RarArchiveInfo): string | null {
	if (archive.hasEncryptedHeaders) {
		return 'Archive has encrypted headers - password required before parsing';
	}

	if (archive.isSolid) {
		return 'Solid archive cannot be streamed - requires full extraction';
	}

	const compressedFile = archive.files.find((f) => f.method !== 0 && f.method !== RAR_METHOD_STORE);
	if (compressedFile) {
		return `File "${compressedFile.name}" is compressed - streaming not supported`;
	}

	return null;
}
