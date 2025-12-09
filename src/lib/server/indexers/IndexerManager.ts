/**
 * IndexerManager - Central service for managing indexers.
 * Handles YAML definition loading, native TypeScript indexers,
 * indexer creation, and search orchestration.
 */

import { db } from '$lib/server/db';
import { indexers as indexersTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { logger } from '$lib/logging';

import type {
	IIndexer,
	IndexerConfig,
	SearchCriteria,
	SearchResult,
	IndexerCapabilities,
	SearchParam,
	SearchMode
} from './core';
import { YamlDefinitionLoader, YamlIndexerFactory } from './loader';
import type { YamlDefinition } from './schema/yamlDefinition';
import {
	getSearchOrchestrator,
	type SearchOrchestratorOptions,
	type EnhancedSearchResult
} from './search/SearchOrchestrator';
import { getPersistentStatusTracker } from './status';
import { getRateLimitRegistry } from './ratelimit';
import { cleanupIndexerCookies } from './http/IndexerHttp';
import {
	isNativeIndexer,
	getNativeIndexerDefinition,
	getAllNativeIndexerDefinitions,
	createNativeIndexer,
	CINEPHAGE_STREAM_DEFINITION_ID
} from './definitions/registry';

/** Manager options */
export interface IndexerManagerOptions {
	/** Path(s) to YAML definitions directory */
	definitionsPath?: string | string[];
}

/**
 * Central service for managing indexers.
 */
export class IndexerManager {
	private definitionLoader: YamlDefinitionLoader;
	private indexerFactory: YamlIndexerFactory;
	private indexerInstances: Map<string, IIndexer> = new Map();

	constructor(options: IndexerManagerOptions = {}) {
		const path = options.definitionsPath;
		const definitionsPath = typeof path === 'string' ? path : path?.[0];
		this.definitionLoader = new YamlDefinitionLoader(definitionsPath);
		this.indexerFactory = new YamlIndexerFactory(this.definitionLoader);
	}

	/** Initialize the manager - load definitions */
	async initialize(): Promise<void> {
		logger.info('Initializing IndexerManager');
		await this.definitionLoader.loadAll();

		// Seed built-in streaming indexer if not exists
		await this.seedStreamingIndexer();

		logger.info('IndexerManager initialized', {
			definitionCount: this.definitionLoader.count,
			errors: this.definitionLoader.getErrors().length
		});

		// Log any errors
		for (const error of this.definitionLoader.getErrors()) {
			logger.warn('Definition load error', {
				file: error.filePath,
				error: error.error
			});
		}
	}

	/** Get all available YAML definitions */
	getDefinitions(): YamlDefinition[] {
		return this.definitionLoader.getAll();
	}

	/** Get a specific definition by ID (checks both native and YAML) */
	getDefinition(
		id: string
	):
		| YamlDefinition
		| { id: string; name: string; type: string; protocol: 'torrent' | 'usenet' | 'streaming' }
		| undefined {
		// Check native indexers first
		const nativeDef = getNativeIndexerDefinition(id);
		if (nativeDef) {
			return {
				id: nativeDef.id,
				name: nativeDef.name,
				type: nativeDef.type,
				protocol: nativeDef.protocol
			};
		}
		// Fall back to YAML definitions
		return this.definitionLoader.get(id);
	}

	/** Check if a definition exists (native or YAML) */
	hasDefinition(id: string): boolean {
		return isNativeIndexer(id) || this.definitionLoader.hasDefinition(id);
	}

	/** Reload all definitions */
	async reloadDefinitions(): Promise<void> {
		await this.definitionLoader.reload();

		// Recreate factory with new loader state
		this.indexerFactory = new YamlIndexerFactory(this.definitionLoader);

		// Clear cached indexer instances so they get recreated
		this.indexerInstances.clear();
	}

	/**
	 * Seed the built-in streaming indexer if it doesn't exist in the database.
	 * This ensures users can use the streaming indexer without manual setup.
	 */
	private async seedStreamingIndexer(): Promise<void> {
		// Check if streaming indexer already exists
		const existing = await db
			.select()
			.from(indexersTable)
			.where(eq(indexersTable.implementation, CINEPHAGE_STREAM_DEFINITION_ID));

		if (existing.length > 0) {
			logger.debug('Streaming indexer already exists in database');
			return;
		}

		// Get definition info
		const def = getNativeIndexerDefinition(CINEPHAGE_STREAM_DEFINITION_ID);
		if (!def) {
			logger.warn('Streaming indexer definition not found in registry');
			return;
		}

		// Create the streaming indexer
		const id = randomUUID();
		await db.insert(indexersTable).values({
			id,
			name: def.name,
			implementation: CINEPHAGE_STREAM_DEFINITION_ID,
			enabled: true, // Enabled by default
			url: def.siteUrl,
			priority: 50, // Lower priority than torrent indexers (higher number = lower priority)
			protocol: 'streaming',
			enableAutomaticSearch: true, // Include in automatic searches
			enableInteractiveSearch: true, // Include in manual searches
			minimumSeeders: 0, // N/A for streaming
			preferMagnetUrl: false // N/A for streaming
		});

		logger.info('Seeded built-in streaming indexer to database', {
			id,
			name: def.name
		});
	}

	/** Get all configured indexers from database */
	async getIndexers(): Promise<IndexerConfig[]> {
		const rows = await db.select().from(indexersTable);
		return rows.map((row) => this.rowToConfig(row));
	}

	/** Get a specific indexer config by ID */
	async getIndexer(id: string): Promise<IndexerConfig | undefined> {
		const rows = await db.select().from(indexersTable).where(eq(indexersTable.id, id));
		return rows[0] ? this.rowToConfig(rows[0]) : undefined;
	}

	/** Create a new indexer configuration */
	async createIndexer(config: Omit<IndexerConfig, 'id' | 'protocol'>): Promise<IndexerConfig> {
		// Check both native TypeScript indexers and YAML definitions
		const nativeDef = getNativeIndexerDefinition(config.definitionId);
		const yamlDef = this.definitionLoader.get(config.definitionId);

		if (!nativeDef && !yamlDef) {
			throw new Error(`Unknown definition: ${config.definitionId}`);
		}

		const id = randomUUID();

		// Get default URL from appropriate source
		const defaultUrl = nativeDef
			? '' // Native indexers have their URLs built-in
			: yamlDef!.links[0];

		// Derive protocol from definition (native indexers have explicit protocol, YAML are all torrents)
		const protocol = nativeDef?.protocol ?? 'torrent';

		await db.insert(indexersTable).values({
			id,
			name: config.name,
			implementation: config.definitionId,
			enabled: config.enabled,
			url: config.baseUrl ?? defaultUrl,
			alternateUrls: config.alternateUrls,
			priority: config.priority,
			protocol,
			settings: config.settings as Record<string, unknown>,

			// Search capability toggles
			enableAutomaticSearch: config.enableAutomaticSearch,
			enableInteractiveSearch: config.enableInteractiveSearch,

			// Torrent seeding settings
			minimumSeeders: config.minimumSeeders,
			seedRatio: config.seedRatio,
			seedTime: config.seedTime,
			packSeedTime: config.packSeedTime,
			preferMagnetUrl: config.preferMagnetUrl
		});

		const created = await this.getIndexer(id);
		if (!created) {
			throw new Error('Failed to create indexer');
		}

		return created;
	}

	/** Update an indexer configuration */
	async updateIndexer(
		id: string,
		updates: Partial<Omit<IndexerConfig, 'id' | 'definitionId'>>
	): Promise<IndexerConfig> {
		const existing = await this.getIndexer(id);
		if (!existing) {
			throw new Error(`Indexer not found: ${id}`);
		}

		const updateData: Record<string, unknown> = {};
		if (updates.name !== undefined) updateData.name = updates.name;
		if (updates.enabled !== undefined) updateData.enabled = updates.enabled ? 1 : 0;
		if (updates.baseUrl !== undefined) updateData.url = updates.baseUrl;
		if (updates.alternateUrls !== undefined) updateData.alternateUrls = updates.alternateUrls;
		if (updates.priority !== undefined) updateData.priority = updates.priority;
		if (updates.settings !== undefined) updateData.settings = updates.settings;

		// Search capability toggles
		if (updates.enableAutomaticSearch !== undefined)
			updateData.enableAutomaticSearch = updates.enableAutomaticSearch;
		if (updates.enableInteractiveSearch !== undefined)
			updateData.enableInteractiveSearch = updates.enableInteractiveSearch;

		// Torrent seeding settings
		if (updates.minimumSeeders !== undefined) updateData.minimumSeeders = updates.minimumSeeders;
		if (updates.seedRatio !== undefined) updateData.seedRatio = updates.seedRatio;
		if (updates.seedTime !== undefined) updateData.seedTime = updates.seedTime;
		if (updates.packSeedTime !== undefined) updateData.packSeedTime = updates.packSeedTime;
		if (updates.preferMagnetUrl !== undefined) updateData.preferMagnetUrl = updates.preferMagnetUrl;

		await db.update(indexersTable).set(updateData).where(eq(indexersTable.id, id));

		// Clear cached instance so it gets recreated
		this.indexerInstances.delete(id);

		// Update status tracking
		const statusTracker = getPersistentStatusTracker();
		if (updates.enabled !== undefined) {
			if (updates.enabled) {
				statusTracker.enable(id);
			} else {
				statusTracker.disable(id);
			}
		}
		if (updates.priority !== undefined) {
			statusTracker.setPriority(id, updates.priority);
		}

		const updated = await this.getIndexer(id);
		if (!updated) {
			throw new Error('Failed to update indexer');
		}

		return updated;
	}

	/** Delete an indexer */
	async deleteIndexer(id: string): Promise<void> {
		await db.delete(indexersTable).where(eq(indexersTable.id, id));

		// Clean up all resources
		this.indexerInstances.delete(id);
		this.indexerFactory.removeIndexer(id);
		getPersistentStatusTracker().remove(id);
		getRateLimitRegistry().remove(id);
		cleanupIndexerCookies(id); // Clean up cookie jar to prevent memory leak
	}

	/** Create an indexer instance from config (tries native first, then YAML) */
	private createIndexerInstance(config: IndexerConfig): IIndexer | null {
		// Try native TypeScript indexer first
		if (isNativeIndexer(config.definitionId)) {
			const instance = createNativeIndexer(config);
			if (instance) {
				logger.debug('Created native indexer instance', {
					indexerId: config.id,
					definitionId: config.definitionId
				});
				return instance;
			}
		}

		// Fall back to YAML-based indexer
		const instance = this.indexerFactory.createIndexer(config);
		if (instance) {
			logger.debug('Created YAML indexer instance', {
				indexerId: config.id,
				definitionId: config.definitionId
			});
		}
		return instance;
	}

	/** Get or create an indexer instance */
	async getIndexerInstance(id: string): Promise<IIndexer | undefined> {
		// Check cache first
		let instance = this.indexerInstances.get(id);
		if (instance) return instance;

		// Load config
		const config = await this.getIndexer(id);
		if (!config) return undefined;

		// Create instance
		try {
			instance = this.createIndexerInstance(config) ?? undefined;
			if (instance) {
				this.indexerInstances.set(id, instance);
			}
			return instance;
		} catch (error) {
			logger.error('Failed to create indexer instance', {
				indexerId: id,
				error: error instanceof Error ? error.message : String(error)
			});
			return undefined;
		}
	}

	/** Get all enabled indexer instances with batch optimization */
	async getEnabledIndexers(): Promise<IIndexer[]> {
		const configs = await this.getIndexers();
		const enabledConfigs = configs.filter((c) => c.enabled);

		// Separate cached from uncached for batch processing
		const cached: IIndexer[] = [];
		const needsCreation: IndexerConfig[] = [];

		for (const config of enabledConfigs) {
			const existing = this.indexerInstances.get(config.id);
			if (existing) {
				cached.push(existing);
			} else {
				needsCreation.push(config);
			}
		}

		// Create uncached instances (synchronous but batched for clarity)
		const created: IIndexer[] = [];
		for (const config of needsCreation) {
			try {
				const instance = this.createIndexerInstance(config);
				if (instance) {
					this.indexerInstances.set(config.id, instance);
					created.push(instance);
				}
			} catch (error) {
				logger.error('Failed to create indexer instance', {
					indexerId: config.id,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		logger.debug('getEnabledIndexers batch result', {
			total: enabledConfigs.length,
			cached: cached.length,
			newlyCreated: created.length
		});

		return [...cached, ...created];
	}

	/** Search across all enabled indexers */
	async search(
		criteria: SearchCriteria,
		options?: SearchOrchestratorOptions
	): Promise<SearchResult> {
		const indexers = await this.getEnabledIndexers();
		const orchestrator = getSearchOrchestrator();
		return orchestrator.search(indexers, criteria, options);
	}

	/**
	 * Enhanced search with quality filtering and optional TMDB matching.
	 * Returns enriched releases with parsed metadata and quality scores.
	 */
	async searchEnhanced(
		criteria: SearchCriteria,
		options?: SearchOrchestratorOptions
	): Promise<EnhancedSearchResult> {
		const indexers = await this.getEnabledIndexers();
		const orchestrator = getSearchOrchestrator();
		return orchestrator.searchEnhanced(indexers, criteria, options);
	}

	/** Test an indexer's connectivity */
	async testIndexer(config: Omit<IndexerConfig, 'id'>): Promise<void> {
		// Check both native and YAML definitions
		const nativeDef = getNativeIndexerDefinition(config.definitionId);
		const yamlDef = this.definitionLoader.get(config.definitionId);

		if (!nativeDef && !yamlDef) {
			throw new Error(`Unknown definition: ${config.definitionId}`);
		}

		const tempConfig: IndexerConfig = {
			...config,
			id: 'test-' + randomUUID()
		};

		const instance = this.createIndexerInstance(tempConfig);
		if (!instance) {
			throw new Error(`Failed to create indexer instance for: ${config.definitionId}`);
		}
		await instance.test();
	}

	/** Get capabilities for a definition */
	getDefinitionCapabilities(definitionId: string): IndexerCapabilities | undefined {
		// Check native indexers first
		if (isNativeIndexer(definitionId)) {
			// Native indexers have capabilities built into the class
			// For now, return a generic capability set
			return {
				search: { available: true, supportedParams: ['q'] },
				movieSearch: { available: true, supportedParams: ['q', 'imdbId', 'tmdbId', 'year'] },
				tvSearch: {
					available: true,
					supportedParams: ['q', 'imdbId', 'tmdbId', 'tvdbId', 'season', 'ep']
				},
				categories: new Map<number, string>(),
				supportsPagination: false,
				supportsInfoHash: true,
				limitMax: 100,
				limitDefault: 100
			};
		}

		const definition = this.definitionLoader.get(definitionId);
		if (!definition) return undefined;

		return this.buildCapabilities(definition);
	}

	/** Get required settings fields for a definition */
	getDefinitionSettings(
		definitionId: string
	): Array<{ name: string; type: string; label: string; default?: string }> {
		// Check native indexers first
		const nativeDef = getNativeIndexerDefinition(definitionId);
		if (nativeDef) {
			// Native private indexers need cookie
			if (nativeDef.type === 'private') {
				return [{ name: 'cookie', type: 'text', label: 'Cookie' }];
			}
			// Public indexers have no required settings
			return [];
		}

		return this.indexerFactory.getRequiredSettings(definitionId);
	}

	/** Get all available definitions with metadata */
	getAvailableDefinitions(): Array<{
		id: string;
		name: string;
		type: string;
		language: string;
		description?: string;
	}> {
		// Get YAML definitions
		const yamlDefs = this.indexerFactory.getAllDefinitionMetadata();

		// Get native definitions
		const nativeDefs = getAllNativeIndexerDefinitions().map((def) => ({
			id: def.id,
			name: def.name,
			type: def.type,
			language: 'en-US',
			description: def.description
		}));

		// Combine and return (native indexers override YAML if same ID)
		const defMap = new Map<string, (typeof yamlDefs)[0]>();
		for (const def of yamlDefs) {
			defMap.set(def.id, def);
		}
		for (const def of nativeDefs) {
			defMap.set(def.id, def);
		}

		return Array.from(defMap.values());
	}

	/** Search definitions by name */
	searchDefinitions(query: string): YamlDefinition[] {
		return this.definitionLoader.searchByName(query);
	}

	/** Get definitions by type */
	getDefinitionsByType(type: 'public' | 'private' | 'semi-private'): YamlDefinition[] {
		return this.definitionLoader.getByType(type);
	}

	/** Convert database row to IndexerConfig */
	private rowToConfig(row: typeof indexersTable.$inferSelect): IndexerConfig {
		return {
			id: row.id,
			name: row.name,
			definitionId: row.implementation,
			enabled: !!row.enabled,
			baseUrl: row.url,
			alternateUrls: (row.alternateUrls as string[]) ?? [],
			priority: row.priority ?? 25,
			protocol: (row.protocol as 'torrent' | 'usenet' | 'streaming') ?? 'torrent',
			settings: (row.settings as Record<string, string>) ?? {},

			// Search capability toggles
			enableAutomaticSearch: row.enableAutomaticSearch ?? true,
			enableInteractiveSearch: row.enableInteractiveSearch ?? true,

			// Torrent seeding settings
			minimumSeeders: row.minimumSeeders ?? 1,
			seedRatio: row.seedRatio ?? null,
			seedTime: row.seedTime ?? null,
			packSeedTime: row.packSeedTime ?? null,
			preferMagnetUrl: row.preferMagnetUrl ?? false
		};
	}

	/** Build capabilities from YAML definition */
	private buildCapabilities(definition: YamlDefinition): IndexerCapabilities {
		const caps = definition.caps;
		const modes = caps.modes ?? {};

		// Helper to convert param strings to SearchParam type
		const toSearchParams = (params: string[] | undefined): SearchParam[] => {
			if (!params) return ['q'];
			const mapping: Record<string, SearchParam> = {
				q: 'q',
				imdbid: 'imdbId',
				tmdbid: 'tmdbId',
				tvdbid: 'tvdbId',
				tvmazeid: 'tvMazeId',
				traktid: 'traktId',
				season: 'season',
				ep: 'ep',
				year: 'year',
				genre: 'genre',
				artist: 'artist',
				album: 'album',
				author: 'author',
				title: 'title'
			};
			return params.map((p) => mapping[p.toLowerCase()] ?? ('q' as SearchParam));
		};

		// Helper to build SearchMode
		const buildSearchMode = (params: string[] | undefined): SearchMode => ({
			available: params !== undefined && params.length > 0,
			supportedParams: toSearchParams(params)
		});

		// Build category map
		const categories = new Map<number, string>();
		if (caps.categories) {
			for (const [catId, catName] of Object.entries(caps.categories)) {
				const numId = parseInt(catId, 10);
				if (!isNaN(numId)) {
					categories.set(numId, catName);
				}
			}
		}
		if (caps.categorymappings) {
			for (const mapping of caps.categorymappings) {
				if (mapping.cat) {
					const numId = parseInt(mapping.cat, 10);
					if (!isNaN(numId)) {
						categories.set(numId, mapping.desc ?? mapping.cat);
					}
				}
			}
		}

		return {
			search: modes['search']
				? buildSearchMode(modes['search'])
				: { available: true, supportedParams: ['q'] },
			movieSearch: modes['movie-search'] ? buildSearchMode(modes['movie-search']) : undefined,
			tvSearch: modes['tv-search'] ? buildSearchMode(modes['tv-search']) : undefined,
			musicSearch: modes['music-search'] ? buildSearchMode(modes['music-search']) : undefined,
			bookSearch: modes['book-search'] ? buildSearchMode(modes['book-search']) : undefined,
			categories,
			supportsPagination: false,
			supportsInfoHash: true,
			limitMax: 100,
			limitDefault: 100
		};
	}
}

/** Singleton instance */
let managerInstance: IndexerManager | null = null;

/** Get the singleton IndexerManager */
export async function getIndexerManager(): Promise<IndexerManager> {
	if (!managerInstance) {
		managerInstance = new IndexerManager();
		await managerInstance.initialize();
	}
	return managerInstance;
}

/** Reset the singleton (for testing) */
export function resetIndexerManager(): void {
	managerInstance = null;
}
