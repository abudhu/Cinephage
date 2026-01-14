/**
 * Format a number as USD currency
 */
export function formatCurrency(amount: number, locale = 'en-US'): string {
	if (amount <= 0) return '';
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0,
		notation: amount >= 1_000_000_000 ? 'compact' : 'standard'
	}).format(amount);
}

/**
 * Format a date string to readable format
 */
export function formatDate(dateString: string, locale = 'en-US'): string {
	if (!dateString) return '';
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	}).format(new Date(dateString));
}

/**
 * Format a date string to short format (MMM D, YYYY)
 */
export function formatDateShort(dateString: string, locale = 'en-US'): string {
	if (!dateString) return '';
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(new Date(dateString));
}

/**
 * Get display name for a language code (ISO 639-1)
 */
export function formatLanguage(code: string, locale = 'en-US'): string {
	if (!code) return '';
	try {
		return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code;
	} catch {
		return code;
	}
}

/**
 * Get display name for a country code (ISO 3166-1)
 */
export function formatCountry(code: string, locale = 'en-US'): string {
	if (!code) return '';
	try {
		return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code;
	} catch {
		return code;
	}
}

/**
 * Format bytes to human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number | null | undefined): string {
	if (!bytes) return '-';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format speed (bytes per second) to human-readable string (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSecond: number | null | undefined): string {
	if (!bytesPerSecond) return '-';
	return formatBytes(bytesPerSecond) + '/s';
}
