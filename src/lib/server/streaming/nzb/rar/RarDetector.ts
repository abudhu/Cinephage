/**
 * RarDetector - Detect RAR archives from filename or magic bytes.
 */

import { RAR4_SIGNATURE, RAR5_SIGNATURE } from './types';
import type { RarDetectionResult } from './types';

/**
 * RAR filename patterns for detection.
 */
const RAR_PATTERNS = {
	// .rar file (first volume or single)
	singleRar: /\.rar$/i,
	// .part1.rar, .part01.rar, etc.
	partRar: /\.part(\d+)\.rar$/i,
	// .r00, .r01, etc. (old style continuation)
	rNumber: /\.r(\d{2})$/i,
	// .001, .002, etc. (numbered volumes)
	numbered: /\.(\d{3})$/
};

/**
 * Detect RAR archive from filename.
 */
export function detectRarFromFilename(filename: string): RarDetectionResult {
	const lower = filename.toLowerCase();

	// Check .part##.rar pattern
	const partMatch = filename.match(RAR_PATTERNS.partRar);
	if (partMatch) {
		return {
			isRar: true,
			partNumber: parseInt(partMatch[1], 10),
			confidence: 'high'
		};
	}

	// Check .rar extension
	if (RAR_PATTERNS.singleRar.test(lower)) {
		return {
			isRar: true,
			partNumber: 1,
			confidence: 'high'
		};
	}

	// Check .r00, .r01 pattern (continuation files)
	const rMatch = filename.match(RAR_PATTERNS.rNumber);
	if (rMatch) {
		// .r00 = part 2 (after .rar), .r01 = part 3, etc.
		return {
			isRar: true,
			partNumber: parseInt(rMatch[1], 10) + 2,
			confidence: 'high'
		};
	}

	// Check .001, .002 pattern
	const numMatch = filename.match(RAR_PATTERNS.numbered);
	if (numMatch) {
		return {
			isRar: true,
			partNumber: parseInt(numMatch[1], 10),
			confidence: 'medium'
		};
	}

	return {
		isRar: false,
		confidence: 'high'
	};
}

/**
 * Detect RAR archive and format from magic bytes.
 */
export function detectRarFromBytes(data: Buffer): RarDetectionResult {
	// Need at least 8 bytes for RAR5 signature
	if (data.length < 8) {
		return { isRar: false, confidence: 'low' };
	}

	// Check RAR5 signature first (more specific)
	if (data.subarray(0, 8).equals(RAR5_SIGNATURE)) {
		return {
			isRar: true,
			format: 'rar5',
			confidence: 'high'
		};
	}

	// Check RAR4 signature
	if (data.subarray(0, 7).equals(RAR4_SIGNATURE)) {
		return {
			isRar: true,
			format: 'rar4',
			confidence: 'high'
		};
	}

	return { isRar: false, confidence: 'high' };
}

/**
 * Get expected part number order for multi-part RAR.
 * Used to sort files correctly for streaming.
 */
export function getRarPartOrder(filename: string): number {
	const result = detectRarFromFilename(filename);
	return result.partNumber ?? 0;
}

/**
 * Check if a file is likely media content based on name.
 * Used to identify what's inside a RAR archive.
 */
export function isMediaContent(filename: string): boolean {
	const ext = filename.toLowerCase().split('.').pop() || '';

	const mediaExtensions = new Set([
		// Video
		'mkv',
		'mp4',
		'avi',
		'mov',
		'wmv',
		'flv',
		'webm',
		'm4v',
		'mpg',
		'mpeg',
		'ts',
		'm2ts',
		'vob',
		// Audio
		'mp3',
		'flac',
		'aac',
		'ogg',
		'wav',
		'm4a',
		'wma'
	]);

	return mediaExtensions.has(ext);
}

/**
 * Extract base name from multi-part RAR filename.
 * e.g., "Movie.part1.rar" -> "Movie"
 */
export function getRarBaseName(filename: string): string {
	// Remove .part##.rar
	let base = filename.replace(/\.part\d+\.rar$/i, '');
	if (base !== filename) return base;

	// Remove .rar
	base = filename.replace(/\.rar$/i, '');
	if (base !== filename) return base;

	// Remove .r##
	base = filename.replace(/\.r\d{2}$/i, '');
	if (base !== filename) return base;

	// Remove .###
	base = filename.replace(/\.\d{3}$/, '');
	if (base !== filename) return base;

	return filename;
}

/**
 * Group multi-part RAR files by base name.
 */
export function groupRarParts<T extends { name: string }>(files: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();

	for (const file of files) {
		const detection = detectRarFromFilename(file.name);
		if (!detection.isRar) continue;

		const baseName = getRarBaseName(file.name);
		const group = groups.get(baseName) || [];
		group.push(file);
		groups.set(baseName, group);
	}

	// Sort each group by part number
	for (const [, parts] of groups) {
		parts.sort((a, b) => getRarPartOrder(a.name) - getRarPartOrder(b.name));
	}

	return groups;
}
