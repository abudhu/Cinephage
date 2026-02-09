/**
 * Test the fix approach - use getFreshStreamUrl instead of cached cmd
 */

import { StalkerPortalClient } from '../src/lib/server/livetv/stalker/StalkerPortalClient';

async function testFix() {
    const config = {
        portalUrl: 'http://line.vueott.com/c/',
        macAddress: '00:1A:79:24:78:86',
        serialNumber: '18S7SHEVLECH',
        deviceId: '68DB6A7790EFB0CBBDBA888CEF262C15',
        deviceId2: '5D6B5ECA76BC92E6C67EE241DCF221AC',
        model: 'MAG254',
        timezone: 'Europe/London'
    };
    
    console.log('=== Testing Fix Approach ===\n');
    console.log('Channel: US| TRUTV HD (external_id: 45468)');
    console.log('');
    
    const client = new StalkerPortalClient(config);
    
    try {
        console.log('Step 1: Authenticate...');
        await client.start();
        console.log('✅ Auth successful\n');
        
        console.log('Step 2: What Cinephage CURRENTLY does (WRONG):');
        console.log('   Uses cached stalkerData.cmd with old token:');
        console.log('   play_token=zXApRdRvyf (OLD/EXPIRED)');
        console.log('   Result: HTTP 458 ❌');
        console.log('');
        
        console.log('Step 3: What Cinephage SHOULD do (FIX):');
        console.log('   Call client.getFreshStreamUrl() to get fresh token...');
        const freshUrl = await client.getFreshStreamUrl('45468', 'direct');
        const newTokenMatch = freshUrl.match(/play_token=([^&]+)/);
        console.log('   Fresh Token:', newTokenMatch ? newTokenMatch[1] : 'none');
        console.log('   Fresh URL:', freshUrl.substring(0, 80) + '...');
        console.log('');
        
        console.log('Step 4: Testing the fresh URL...');
        const response = await fetch(freshUrl, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
                'Accept': '*/*'
            }
        });
        
        console.log('   Response Status:', response.status, response.statusText);
        
        if (response.ok) {
            console.log('✅ STREAM WORKS WITH FRESH URL!');
            console.log('');
            console.log('=== CONCLUSION ===');
            console.log('The fix is CONFIRMED to work!');
            console.log('');
            console.log('Current code in StalkerProvider.resolveStreamUrl():');
            console.log('  if (streamUrlType === "direct") {');
            console.log('    url = stalkerData.cmd.replace(/^ffmpeg\\s+/, "");  // ❌ Uses stale token');
            console.log('  }');
            console.log('');
            console.log('Fixed code:');
            console.log('  if (streamUrlType === "direct") {');
            console.log('    url = await client.getFreshStreamUrl(channel.externalId, "direct");  // ✅ Fresh token');
            console.log('  }');
        } else if (response.status === 458) {
            console.log('❌ Still getting 458 - this channel may not be in subscription');
        } else {
            console.log('❌ Other error:', response.status);
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
}

testFix();
