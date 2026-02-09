/**
 * Live Stalker Portal Test
 * Tests actual handshake, auth, and stream fetching
 */

import { StalkerPortalClient } from '../src/lib/server/livetv/stalker/StalkerPortalClient';

async function testStalker() {
    const config = {
        portalUrl: 'http://line.vueott.com/c/',
        macAddress: '00:1A:79:24:78:86',
        serialNumber: '18S7SHEVLECH',
        deviceId: '68DB6A7790EFB0CBBDBA888CEF262C15',
        deviceId2: '5D6B5ECA76BC92E6C67EE241DCF221AC',
        model: 'MAG254',
        timezone: 'Europe/London'
    };
    
    console.log('=== Stalker Portal Live Test ===\n');
    console.log('Portal URL:', config.portalUrl);
    console.log('MAC:', config.macAddress);
    console.log('');
    
    const client = new StalkerPortalClient(config);
    
    try {
        console.log('Step 1: Handshake + Authentication...');
        await client.start();
        console.log('✅ SUCCESS - Token:', client.getToken().substring(0, 16) + '...');
        console.log('');
        
        // Test getting fresh stream URL for channel 1930897 (GO| TRUTV)
        console.log('Step 2: Getting fresh stream URL for channel 1930897...');
        const freshUrl = await client.getFreshStreamUrl('1930897', 'direct');
        console.log('✅ SUCCESS - Fresh URL:', freshUrl.substring(0, 80) + '...');
        console.log('');
        
        // Try to fetch the stream
        console.log('Step 3: Testing actual stream fetch...');
        const response = await fetch(freshUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
                'Accept': '*/*'
            },
            redirect: 'follow'
        });
        
        console.log('Stream Response Status:', response.status, response.statusText);
        console.log('Content-Type:', response.headers.get('content-type'));
        console.log('Content-Length:', response.headers.get('content-length'));
        console.log('');
        
        if (response.ok) {
            console.log('✅ STREAM IS ACCESSIBLE!');
            console.log('This means the provider is working, and we just need to fix how Cinephage retrieves fresh URLs.');
        } else if (response.status === 458) {
            console.log('❌ HTTP 458 ERROR');
            console.log('This is a provider-side error. Common causes:');
            console.log('  - Subscription expired');
            console.log('  - MAC address revoked/banned');
            console.log('  - Concurrent stream limit exceeded');
            console.log('  - Channel not in subscription package');
            console.log('  - IP-based session binding (need same IP for auth and stream)');
        } else {
            console.log('❌ Stream failed with status:', response.status);
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error instanceof Error ? error.message : error);
        console.error('Stack:', error instanceof Error ? error.stack : '');
    }
}

testStalker();
