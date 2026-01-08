/**
 * Indexer Factory
 *
 * Creates indexer instances from YAML definitions.
 * Uses a single interface regardless of the underlying definition.
 */

import type { IIndexer, IndexerConfig } from '../types';
import { YamlIndexer } from '../runtime/YamlIndexer';
import { YamlDefinitionLoader } from './YamlDefinitionLoader';
import { createChildLogger } from '$lib/logging';
import { getNewznabCapabilitiesProvider } from '../newznab/NewznabCapabilitiesProvider';

const log = createChildLogger({ module: 'IndexerFactory' });

/** Definition IDs that use the Newznab protocol */
const NEWZNAB_DEFINITIONS = ['newznab'];

/**
 * Factory for creating indexer instances.
 */
export class IndexerFactory {
	private cache: Map<string, IIndexer> = new Map();
	private yamlLoader: YamlDefinitionLoader | null = null;

	/**
	 * Initialize the factory with the YAML loader.
	 * Must be called before creating indexers.
	 */
	async initialize(): Promise<void> {
		if (!this.yamlLoader) {
			this.yamlLoader = new YamlDefinitionLoader();
			await this.yamlLoader.loadAll();
		}
	}

	/**
	 * Create an indexer instance from database config.
	 */
	async createIndexer(config: IndexerConfig): Promise<IIndexer> {
		// Check cache first
		const cached = this.cache.get(config.id);
		if (cached) {
			return cached;
		}

		// Ensure loader is ready
		await this.initialize();

		// Create YAML indexer (may fetch capabilities asynchronously)
		const indexer = await this.createYamlIndexer(config);

		// Cache and return
		this.cache.set(config.id, indexer);
		log.debug('Created indexer', {
			id: config.id,
			definitionId: config.definitionId
		});

		return indexer;
	}

	/**
	 * Create a YAML indexer.
	 * For Newznab indexers, fetches live capabilities to filter unsupported params.
	 */
	private async createYamlIndexer(config: IndexerConfig): Promise<IIndexer> {
		if (!this.yamlLoader) {
			throw new Error('YAML loader not initialized. Call initialize() first.');
		}

		const definition = this.yamlLoader.getDefinition(config.definitionId);
		if (!definition) {
			throw new Error(`YAML definition not found: ${config.definitionId}`);
		}

		// For Newznab, fetch live capabilities from the indexer's /api?t=caps endpoint
		// This allows us to filter out unsupported search params (e.g., tmdbid if not supported)
		let liveCapabilities;
		if (NEWZNAB_DEFINITIONS.includes(config.definitionId)) {
			try {
				const provider = getNewznabCapabilitiesProvider();
				const apiKey = config.settings?.apikey as string | undefined;
				liveCapabilities = await provider.getCapabilities(config.baseUrl, apiKey);
				log.info('Fetched Newznab capabilities', {
					indexerId: config.id,
					baseUrl: config.baseUrl,
					movieSearch: liveCapabilities.searching.movieSearch.supportedParams,
					tvSearch: liveCapabilities.searching.tvSearch.supportedParams
				});
			} catch (error) {
				// Log but don't fail - indexer will work, just without param filtering
				log.warn('Failed to fetch Newznab capabilities, using defaults', {
					indexerId: config.id,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return new YamlIndexer({
			config,
			definition,
			rateLimit: definition.requestdelay
				? { requests: 1, periodMs: definition.requestdelay * 1000 }
				: undefined,
			liveCapabilities
		});
	}

	/**
	 * Check if this factory can create an indexer for the given definition.
	 */
	canCreate(definitionId: string): boolean {
		return this.yamlLoader?.hasDefinition(definitionId) ?? false;
	}

	/**
	 * Remove an indexer from the cache.
	 */
	removeFromCache(id: string): void {
		this.cache.delete(id);
	}

	/**
	 * Clear the entire cache.
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get a cached indexer if it exists.
	 */
	getCached(id: string): IIndexer | undefined {
		return this.cache.get(id);
	}
}

// ============================================================================
// Singleton
// ============================================================================

let instance: IndexerFactory | null = null;

/**
 * Get the singleton factory instance.
 */
export function getIndexerFactory(): IndexerFactory {
	if (!instance) {
		instance = new IndexerFactory();
	}
	return instance;
}
