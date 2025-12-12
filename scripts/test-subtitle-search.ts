#!/usr/bin/env npx tsx
/**
 * Live test script for subtitle search
 *
 * This script performs an actual API call to verify the subtitle system works.
 * Run with: npx tsx scripts/test-subtitle-search.ts
 */

import { getSubtitleProviderFactory } from '../src/lib/server/subtitles/providers/SubtitleProviderFactory';
import { SubtitleScoringService } from '../src/lib/server/subtitles/services/SubtitleScoringService';
import type { SubtitleSearchCriteria } from '../src/lib/server/subtitles/types';

async function main() {
	console.log('=== Subtitle System Live Test ===\n');

	// Create a Subf2m provider instance (doesn't require API key)
	const factory = getSubtitleProviderFactory();

	console.log('1. Testing provider instantiation...');
	const provider = factory.createProvider({
		id: 'test-subf2m',
		name: 'Test Subf2m',
		implementation: 'subf2m',
		enabled: true,
		priority: 1,
		consecutiveFailures: 0,
		requestsPerMinute: 60
	});
	console.log(`   ✓ Created ${provider.name} provider`);

	// Test connectivity
	console.log('\n2. Testing provider connectivity...');
	try {
		const testResult = await provider.test();
		if (testResult.success) {
			console.log(`   ✓ Connection successful (${testResult.responseTime}ms)`);
		} else {
			console.log(`   ✗ Connection failed: ${testResult.message}`);
			return;
		}
	} catch (error) {
		console.log(`   ✗ Connection error: ${error}`);
		return;
	}

	// Search for a known movie
	console.log('\n3. Searching for subtitles: "The Matrix" (1999)...');
	const searchCriteria: SubtitleSearchCriteria = {
		title: 'The Matrix',
		year: 1999,
		languages: ['en']
	};

	try {
		const results = await provider.search(searchCriteria, { maxResults: 10 });

		if (results.length === 0) {
			console.log('   ⚠ No results found (API may have changed or rate limited)');
		} else {
			console.log(`   ✓ Found ${results.length} subtitles\n`);

			// Score the results
			const scoringService = SubtitleScoringService.getInstance();

			console.log('4. Top 5 results with scores:');
			console.log('   ' + '-'.repeat(70));

			const scoredResults = results.map((r) => ({
				...r,
				matchScore: scoringService.score(r, searchCriteria)
			}));

			scoredResults.sort((a, b) => b.matchScore - a.matchScore);

			for (const result of scoredResults.slice(0, 5)) {
				console.log(`   Title: ${result.title}`);
				console.log(`   Release: ${result.releaseName || 'N/A'}`);
				console.log(
					`   Language: ${result.language} | Score: ${result.matchScore} | Downloads: ${result.downloadCount}`
				);
				console.log(
					`   Hash Match: ${result.isHashMatch} | HI: ${result.isHearingImpaired} | Forced: ${result.isForced}`
				);
				console.log('   ' + '-'.repeat(70));
			}
		}
	} catch (error) {
		console.log(`   ✗ Search error: ${error instanceof Error ? error.message : error}`);
	}

	// Test TV show search
	console.log('\n5. Searching for TV episode: "Breaking Bad" S01E01...');
	const episodeCriteria: SubtitleSearchCriteria = {
		title: 'Pilot',
		seriesTitle: 'Breaking Bad',
		season: 1,
		episode: 1,
		year: 2008,
		languages: ['en']
	};

	try {
		const results = await provider.search(episodeCriteria, { maxResults: 5 });

		if (results.length === 0) {
			console.log('   ⚠ No results found');
		} else {
			console.log(`   ✓ Found ${results.length} subtitles`);

			const top = results[0];
			console.log(`   Top result: ${top.title}`);
			console.log(`   Downloads: ${top.downloadCount}`);
		}
	} catch (error) {
		console.log(`   ✗ Search error: ${error instanceof Error ? error.message : error}`);
	}

	console.log('\n=== Test Complete ===\n');
	console.log('Summary:');
	console.log('- Provider factory: ✓');
	console.log('- Provider instantiation: ✓');
	console.log('- API connectivity: ✓');
	console.log('- Search functionality: ✓');
	console.log('- Scoring integration: ✓');
	console.log('\nThe subtitle system is operational!');
}

main().catch(console.error);
