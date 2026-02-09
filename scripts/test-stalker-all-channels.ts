/**
 * Test multiple Stalker channels to see which ones work
 */

import { StalkerPortalClient } from '../src/lib/server/livetv/stalker/StalkerPortalClient';
import { db } from '../src/lib/server/db';
import { livetvChannels, livetvAccounts } from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

async function testMultipleChannels() {
    const config = {
        portalUrl: 'http://line.vueott.com/c/',
        macAddress: '00:1A:79:24:78:86',
        serialNumber: '18S7SHEVLECH',
        deviceId: '68DB6A7790EFB0CBBDBA888CEF262C15',
        deviceId2: '5D6B5ECA76BC92E6C67EE241DCF221AC',
        model: 'MAG254',
        timezone: 'Europe/London'
    };
    
    console.log('=== Testing Multiple Stalker Channels ===\n');
    
    const client = new StalkerPortalClient(config);
    
    try {
        console.log('Authenticating...');
        await client.start();
        console.log('✅ Auth successful\n');
        
        // Get channels from database
        const account = await db.select().from(livetvAccounts).where(eq(livetvAccounts.id, '4f8d9284-a4fb-42f3-9625-5db9fcdd6543')).limit(1).then(rows => rows[0]);
        const channels = await db.select().from(livetvChannels).where(eq(livetvChannels.accountId, account.id)).limit(10);
        
        console.log(`Testing ${channels.length} channels...\n`);
        
        let workingCount = 0;
        let error458Count = 0;
        let otherErrorCount = 0;
        
        for (const channel of channels) {
            const stalkerData = channel.stalkerData as { cmd: string } | null;
            if (!stalkerData?.cmd) continue;
            
            try {
                process.stdout.write(`Testing ${channel.name.substring(0, 40).padEnd(42)} `);
                
                // Get fresh URL
                const freshUrl = await client.getFreshStreamUrl(channel.externalId, 'direct');
                
                // Quick HEAD request to check if stream works
                const response = await fetch(freshUrl, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
                        'Accept': '*/*'
                    }
                });
                
                if (response.ok) {
                    console.log('✅ WORKING');
                    workingCount++;
                } else if (response.status === 458) {
                    console.log('❌ 458 ERROR');
                    error458Count++;
                } else {
                    console.log(`❌ HTTP ${response.status}`);
                    otherErrorCount++;
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown';
                if (msg.includes('458')) {
                    console.log('❌ 458 ERROR');
                    error458Count++;
                } else {
                    console.log(`❌ ${msg.substring(0, 30)}`);
                    otherErrorCount++;
                }
            }
            
            // Small delay to not hammer the server
            await new Promise(r => setTimeout(r, 500));
        }
        
        console.log('\n=== Results ===');
        console.log(`Working: ${workingCount}`);
        console.log(`HTTP 458 errors: ${error458Count}`);
        console.log(`Other errors: ${otherErrorCount}`);
        console.log(`Total tested: ${channels.length}`);
        
        if (workingCount === 0 && error458Count > 0) {
            console.log('\n⚠️  ALL CHANNELS RETURNING 458');
            console.log('This indicates the subscription is likely expired or the MAC address is banned.');
        } else if (workingCount > 0) {
            console.log('\n✅ Some channels work - the account is active');
            console.log('The 458 errors may be for specific channels not in the subscription.');
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
}

testMultipleChannels();
