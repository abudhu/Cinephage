/**
 * Test current Cinephage streaming flow
 */

import { channelLineupService } from '../src/lib/server/livetv/lineup/ChannelLineupService';
import { getLiveTvStreamService } from '../src/lib/server/livetv/streaming/LiveTvStreamService';
import { db } from '../src/lib/server/db';
import { livetvAccounts } from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

async function testCurrentFlow() {
    console.log('=== Testing Current Cinephage Streaming Flow ===\n');
    
    // Lineup item ID for GO| TRUTV
    const lineupItemId = '7c4b3fd8-a1eb-433e-8f44-8b25b0bb59ea';
    
    try {
        console.log('Step 1: Get lineup item from database...');
        const item = await channelLineupService.getChannelWithBackups(lineupItemId);
        console.log('✅ Lineup item found:', item?.channel?.name);
        console.log('   Provider Type:', item?.providerType);
        console.log('   Account ID:', item?.accountId);
        console.log('   Channel ID:', item?.channelId);
        console.log('');
        
        if (!item) {
            console.log('❌ Lineup item not found');
            return;
        }
        
        // Get the account
        const accountRecord = await db.select().from(livetvAccounts).where(eq(livetvAccounts.id, item.accountId)).limit(1).then(rows => rows[0]);
        console.log('Step 2: Account loaded');
        console.log('   Account Name:', accountRecord.name);
        console.log('   Provider Type:', accountRecord.providerType);
        console.log('   Stream URL Type:', accountRecord.stalkerConfig?.streamUrlType);
        console.log('');
        
        // Show the cached stalker data
        const stalkerData = item.channel.stalkerData as { cmd?: string } | undefined;
        console.log('Step 3: Cached channel data from database:');
        console.log('   CMD:', stalkerData?.cmd);
        
        // Extract the token from the cached URL
        const cachedUrl = stalkerData?.cmd?.replace(/^ffmpeg\s+/, '');
        const tokenMatch = cachedUrl?.match(/play_token=([^&]+)/);
        console.log('   Cached Token:', tokenMatch ? tokenMatch[1] : 'none');
        console.log('');
        
        console.log('Step 4: Now attempting to use LiveTvStreamService...');
        const streamService = getLiveTvStreamService();
        
        // This is what Cinephage currently does
        const result = await streamService.fetchStream(lineupItemId);
        
        console.log('✅ SUCCESS! Stream fetched');
        console.log('   URL:', result.url.substring(0, 80) + '...');
        console.log('   Type:', result.type);
        console.log('   Status:', result.response.status);
        
    } catch (error) {
        console.error('\n❌ ERROR in current flow:', error instanceof Error ? error.message : error);
        
        if (error instanceof Error && error.message.includes('458')) {
            console.log('\n=== DIAGNOSIS ===');
            console.log('The HTTP 458 error occurs because:');
            console.log('1. Cinephage uses the cached stalkerData.cmd from the database');
            console.log('2. This cached URL has an OLD/EXPIRED token');
            console.log('3. When streamUrlType is "direct", it uses this stale URL directly');
            console.log('4. The provider rejects the expired token with HTTP 458');
            console.log('');
            console.log('=== SOLUTION ===');
            console.log('Modify StalkerProvider.resolveStreamUrl() to always call');
            console.log('client.getFreshStreamUrl() instead of using cached stalkerData.cmd');
        }
    }
}

testCurrentFlow();
