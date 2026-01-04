/**
 * StalkerRetry - Exponential backoff retry utility for Stalker Portal operations.
 *
 * Based on Stalkerhek patterns for reliable portal communication:
 * - Exponential backoff with configurable delays
 * - Session expiration detection via JSON parse errors
 * - Network error detection
 */

import { logger } from '$lib/logging';

export interface RetryConfig {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 10000,
	backoffMultiplier: 2
};

/**
 * Custom error for session expiration.
 * Thrown when portal session has expired and re-authentication is needed.
 */
export class SessionExpiredError extends Error {
	constructor(message: string = 'Portal session expired') {
		super(message);
		this.name = 'SessionExpiredError';
	}
}

/**
 * Custom error for network failures.
 */
export class NetworkError extends Error {
	constructor(
		message: string,
		public readonly cause?: Error
	) {
		super(message);
		this.name = 'NetworkError';
	}
}

/**
 * Check if an error indicates session expiration.
 * Stalkerhek pattern: JSON parse errors often indicate expired sessions.
 */
export function isSessionExpiredError(error: unknown): boolean {
	if (error instanceof SessionExpiredError) {
		return true;
	}

	// JSON parse error = likely session expired (Stalkerhek pattern)
	if (error instanceof SyntaxError && error.message.includes('JSON')) {
		return true;
	}

	// Check for portal error messages that indicate session issues
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (
			message.includes('session') ||
			message.includes('token') ||
			message.includes('unauthorized') ||
			message.includes('authentication')
		) {
			return true;
		}
	}

	return false;
}

/**
 * Check if an error is a network-related error worth retrying.
 */
export function isNetworkError(error: unknown): boolean {
	if (error instanceof NetworkError) {
		return true;
	}

	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes('network') ||
			message.includes('econnrefused') ||
			message.includes('econnreset') ||
			message.includes('etimedout') ||
			message.includes('enotfound') ||
			message.includes('fetch failed') ||
			message.includes('socket')
		);
	}

	return false;
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
	return isNetworkError(error) || isSessionExpiredError(error);
}

/**
 * Calculate delay for a given retry attempt using exponential backoff.
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
	const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
	return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with exponential backoff retry.
 *
 * @param config - Retry configuration
 * @param operation - Async operation to execute
 * @param shouldRetry - Optional custom function to determine if error is retryable
 * @returns Result of the operation
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
	config: RetryConfig,
	operation: () => Promise<T>,
	shouldRetry?: (error: unknown) => boolean
): Promise<T> {
	const checkRetryable = shouldRetry ?? isRetryableError;
	let lastError: unknown;

	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			// Don't retry if not a retryable error
			if (!checkRetryable(error)) {
				throw error;
			}

			// Don't retry if we've exhausted attempts
			if (attempt >= config.maxRetries) {
				break;
			}

			// Calculate delay and wait
			const delay = calculateDelay(attempt, config);
			logger.debug('[StalkerRetry] Retrying after error', {
				attempt: attempt + 1,
				maxRetries: config.maxRetries,
				delayMs: delay,
				error: error instanceof Error ? error.message : 'Unknown error'
			});

			await sleep(delay);
		}
	}

	throw lastError;
}

/**
 * Convenience function with default config.
 */
export async function withDefaultRetry<T>(operation: () => Promise<T>): Promise<T> {
	return withRetry(DEFAULT_RETRY_CONFIG, operation);
}
