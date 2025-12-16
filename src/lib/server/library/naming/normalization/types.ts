/**
 * Normalization map interface for consistent string transformations
 */
export interface NormalizationMap {
	/**
	 * Map of lowercase input to normalized output
	 */
	readonly mappings: Record<string, string>;

	/**
	 * Normalize an input string
	 * @param input - The string to normalize
	 * @returns The normalized string, or the original if no mapping exists
	 */
	normalize(input: string): string;

	/**
	 * Check if input is a recognized value
	 * @param input - The string to check
	 * @returns True if the input has a known mapping
	 */
	isKnown(input: string): boolean;
}

/**
 * Create a normalization map from a mappings object
 */
export function createNormalizationMap(mappings: Record<string, string>): NormalizationMap {
	return {
		mappings,
		normalize(input: string): string {
			const normalized = input.toLowerCase();
			return mappings[normalized] ?? input;
		},
		isKnown(input: string): boolean {
			return input.toLowerCase() in mappings;
		}
	};
}
