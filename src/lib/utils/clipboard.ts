/**
 * Copy text to clipboard.
 * Tries modern Clipboard API first, falls back to execCommand for HTTP contexts.
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	// Try modern Clipboard API first (requires HTTPS or localhost)
	if (typeof navigator !== 'undefined' && navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to legacy method
		}
	}

	// Fallback: create temporary textarea and use execCommand
	if (typeof document !== 'undefined') {
		try {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.left = '-9999px';
			textarea.style.top = '-9999px';
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			const success = document.execCommand('copy');
			document.body.removeChild(textarea);
			return success;
		} catch {
			return false;
		}
	}

	return false;
}
