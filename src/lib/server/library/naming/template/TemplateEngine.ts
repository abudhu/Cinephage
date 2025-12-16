/**
 * Template Engine for naming format strings
 *
 * Handles parsing, validation, and rendering of naming templates
 * with support for tokens and conditional blocks.
 */

import type { TokenRegistry } from '../tokens/registry';
import type { MediaNamingInfo, NamingConfig } from '../NamingService';
import type { TemplateParseResult, ParsedToken, TemplateError, TemplateWarning } from './types';

/**
 * Template Engine for processing naming format strings
 */
export class TemplateEngine {
	constructor(private registry: TokenRegistry) {}

	/**
	 * Parse and validate a format string
	 */
	parse(format: string): TemplateParseResult {
		const tokens: ParsedToken[] = [];
		const errors: TemplateError[] = [];
		const warnings: TemplateWarning[] = [];

		// Find conditional blocks: {prefix{Token}suffix}
		const conditionalPattern = /\{([^{}]*)\{([A-Za-z:0-9]+)\}([^{}]*)\}/g;
		let conditionalMatches = format.matchAll(conditionalPattern);

		for (const match of conditionalMatches) {
			const [fullMatch, , token] = match;
			const [name, formatSpec] = token.split(':');
			const position = match.index ?? 0;

			tokens.push({
				name,
				formatSpec,
				position,
				length: fullMatch.length,
				isConditional: true
			});

			// Validate token exists
			const validation = this.registry.validate(name);
			if (!validation.valid) {
				if (validation.suggestion) {
					warnings.push({
						position,
						message: `Unknown token '${name}'. Did you mean '${validation.suggestion}'?`,
						suggestion: validation.suggestion
					});
				} else {
					errors.push({
						position,
						length: fullMatch.length,
						message: `Unknown token '${name}'`,
						token: name
					});
				}
			}
		}

		// Find simple tokens: {Token} or {Token:00}
		const tokenPattern = /\{([A-Za-z:0-9]+)\}/g;
		let tokenMatches = format.matchAll(tokenPattern);

		for (const match of tokenMatches) {
			const [fullMatch, token] = match;
			const [name, formatSpec] = token.split(':');
			const position = match.index ?? 0;

			// Skip if this position was already handled as part of a conditional block
			const isPartOfConditional = tokens.some(
				(t) => t.isConditional && position >= t.position && position < t.position + t.length
			);

			if (!isPartOfConditional) {
				tokens.push({
					name,
					formatSpec,
					position,
					length: fullMatch.length,
					isConditional: false
				});

				// Validate token exists
				const validation = this.registry.validate(name);
				if (!validation.valid) {
					if (validation.suggestion) {
						warnings.push({
							position,
							message: `Unknown token '${name}'. Did you mean '${validation.suggestion}'?`,
							suggestion: validation.suggestion
						});
					} else {
						errors.push({
							position,
							length: fullMatch.length,
							message: `Unknown token '${name}'`,
							token: name
						});
					}
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			tokens
		};
	}

	/**
	 * Render a format string with data
	 */
	render(format: string, info: MediaNamingInfo, config: NamingConfig): string {
		let result = format;

		// Process conditional blocks first: {prefix{Token}suffix}
		result = this.processConditionalBlocks(result, info, config);

		// Replace standard tokens
		result = this.replaceTokens(result, info, config);

		return result;
	}

	/**
	 * Process conditional blocks like {[{Quality}]} or {edition-{Edition}}
	 * Only includes the block content if at least one inner token has a value.
	 * Supports multiple tokens inside: {[{AudioCodec} {AudioChannels}]}
	 */
	private processConditionalBlocks(
		format: string,
		info: MediaNamingInfo,
		config: NamingConfig
	): string {
		// Pattern: Match outer braces that contain at least one inner {Token} pattern
		// This handles both single tokens {[{HDR}]} and multiple tokens {[{AudioCodec} {AudioChannels}]}
		const conditionalPattern = /\{([^{}]*(?:\{[A-Za-z:0-9]+\}[^{}]*)+)\}/g;

		return format.replace(conditionalPattern, (match, innerContent) => {
			// Check if this contains any {Token} patterns
			const tokenPattern = /\{([A-Za-z:0-9]+)\}/g;
			const tokens = [...innerContent.matchAll(tokenPattern)];

			if (tokens.length === 0) {
				// No tokens found, return as-is (shouldn't happen with our pattern)
				return match;
			}

			// Replace all tokens in the inner content
			let result = innerContent;
			let hasAnyValue = false;

			for (const tokenMatch of tokens) {
				const [fullToken, token] = tokenMatch;
				const [name, formatSpec] = token.split(':');
				const value = this.registry.render(name, info, config, formatSpec);

				if (value && value.trim()) {
					hasAnyValue = true;
					result = result.replace(fullToken, value);
				} else {
					result = result.replace(fullToken, '');
				}
			}

			// Only return the content if at least one token had a value
			if (hasAnyValue) {
				// Clean up any empty spaces from missing tokens
				return result.replace(/\s+/g, ' ').trim();
			}
			return '';
		});
	}

	/**
	 * Replace simple tokens like {Title}, {Year}
	 */
	private replaceTokens(format: string, info: MediaNamingInfo, config: NamingConfig): string {
		const tokenPattern = /\{([A-Za-z:0-9]+)\}/g;

		return format.replace(tokenPattern, (match, token) => {
			const [name, formatSpec] = token.split(':');
			return this.registry.render(name, info, config, formatSpec);
		});
	}

	/**
	 * Get all tokens used in a format string
	 */
	getUsedTokens(format: string): string[] {
		const result = this.parse(format);
		return [...new Set(result.tokens.map((t) => t.name))];
	}
}
