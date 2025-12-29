/**
 * Type definitions for NNTP client operations.
 */

/**
 * NNTP server configuration.
 */
export interface NntpServerConfig {
	host: string;
	port: number;
	useSsl: boolean;
	username?: string;
	password?: string;
	maxConnections?: number;
}

/**
 * NNTP connection state.
 */
export type NntpConnectionState =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'authenticating'
	| 'ready'
	| 'error';

/**
 * NNTP response codes.
 */
export const NntpResponseCode = {
	// Success codes
	POSTING_ALLOWED: 200,
	POSTING_PROHIBITED: 201,
	SLAVE_STATUS_NOTED: 202,
	CLOSING_CONNECTION: 205,
	GROUP_SELECTED: 211,
	INFORMATION_FOLLOWS: 215,
	ARTICLE_RETRIEVED: 220,
	HEAD_FOLLOWS: 221,
	BODY_FOLLOWS: 222,
	ARTICLE_SELECTED: 223,
	// AUTH codes
	AUTH_ACCEPTED: 281,
	PASSWORD_REQUIRED: 381,
	// Error codes
	SERVICE_UNAVAILABLE: 400,
	NO_SUCH_GROUP: 411,
	NO_SUCH_ARTICLE: 430,
	ARTICLE_NOT_FOUND: 420,
	AUTH_REQUIRED: 480,
	AUTH_REJECTED: 482,
	COMMAND_UNAVAILABLE: 500,
	SYNTAX_ERROR: 501
} as const;

/**
 * Parsed NNTP response.
 */
export interface NntpResponse {
	code: number;
	message: string;
	data?: Buffer;
}

/**
 * Article info from STAT command.
 */
export interface ArticleInfo {
	number: number;
	messageId: string;
}

/**
 * Group info from GROUP command.
 */
export interface GroupInfo {
	count: number;
	low: number;
	high: number;
	name: string;
}

/**
 * yEnc header info.
 */
export interface YencHeader {
	name: string;
	line: number;
	size: number;
	part?: number;
	total?: number;
	begin?: number;
	end?: number;
}

/**
 * yEnc trailer info.
 */
export interface YencTrailer {
	size: number;
	part?: number;
	crc32?: string;
	pcrc32?: string;
}

/**
 * Decoded yEnc result.
 */
export interface YencDecodeResult {
	header: YencHeader;
	trailer: YencTrailer;
	data: Buffer;
}
