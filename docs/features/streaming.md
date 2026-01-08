# Streaming

Cinephage supports streaming content directly without downloading. It includes a built-in streaming indexer and 10 streaming providers with automatic failover.

---

## Overview

Instead of downloading files, streaming mode:

1. Uses the built-in Cinephage Stream indexer to find content
2. Resolves stream URLs from multiple providers
3. Creates .strm files that point to streams
4. Enables instant playback in media servers like Jellyfin/Emby/Plex

---

## Cinephage Stream Indexer

Cinephage includes its own streaming indexer (`cinephage-stream`) that integrates directly with the streaming providers.

### How It Works

1. Enable the Cinephage Stream indexer in **Settings > Integrations > Indexers**
2. Search results include streaming options alongside torrent/usenet
3. Grabbing a streaming result creates a .strm file
4. No download client needed for streaming content

### Benefits

- Integrated search across all streaming providers
- Appears in normal search results
- Quality scoring still applies
- Works with the Streamer quality profile

---

## Streaming Providers

Cinephage includes 10 streaming providers:

| Provider   | Focus   | Features          |
| ---------- | ------- | ----------------- |
| Vidlink    | General | Movies and TV     |
| Videasy    | General | Multiple sources  |
| XPrime     | General | Fast resolution   |
| Smashy     | General | Good availability |
| Hexa       | General | Reliable streams  |
| YFlix      | General | Wide coverage     |
| Mapple     | General | Quality options   |
| OneTouchTV | TV      | TV show focus     |
| AnimeKai   | Anime   | Anime specialized |
| KissKH     | Asian   | Asian drama focus |

---

## Circuit Breaker Pattern

Cinephage uses a circuit breaker pattern to handle provider failures:

### How It Works

1. **Closed State** (normal): Requests go to provider normally
2. **After 3 failures**: Circuit "opens" - provider is temporarily disabled
3. **After 60 seconds**: Circuit "half-opens" - one test request is allowed
4. **If test succeeds**: Circuit closes, provider resumes normally
5. **If test fails**: Circuit stays open for another 60 seconds

### Benefits

- Fast failover when a provider is down
- Automatic recovery when provider comes back
- No manual intervention needed
- Prevents cascading failures

### Viewing Provider Health

Check provider status in the streaming settings. Each provider shows:

- Current circuit state (closed/open)
- Recent failure count
- Success rate

---

## .strm Files

### What Are .strm Files?

.strm files are text files containing a URL. When your media server (Jellyfin, Emby, Plex) plays the file, it reads the URL and streams from that source.

### File Contents

A typical .strm file contains:

```
https://stream-provider.example/video/abc123.m3u8
```

### Advantages

- No local storage needed
- Instant playback
- Works with any media server that supports .strm
- Files are tiny (just a URL)

### Disadvantages

- Requires internet connection
- Stream quality depends on provider
- Links may expire (Cinephage handles refresh)
- No offline viewing

---

## Using the Streamer Profile

The **Streamer** quality profile enables streaming-only mode:

1. Go to **Settings > Profiles**
2. Select **Streamer** as default, or assign per-item
3. When you grab a release, a .strm file is created instead of downloading

### Streamer Profile Behavior

- Only searches streaming protocol (not torrent/usenet)
- No quality upgrades (streams don't upgrade)
- Instant availability
- No storage usage

---

## NZB Streaming

Cinephage can also stream directly from usenet without downloading:

### How It Works

1. Connects to your configured usenet provider
2. Resolves NZB file to NNTP segments
3. Streams content directly via NNTP protocol
4. Handles multi-part files and RAR extraction on-the-fly

### Requirements

- Usenet provider with streaming support
- NZB indexer
- Adequate bandwidth for real-time streaming

### Limitations

- Experimental feature
- Requires fast usenet server
- Some content may not stream smoothly
- Incomplete NZBs won't work

---

## Stream Resolution

When you search and grab a streaming release:

1. Cinephage queries multiple providers in parallel
2. First successful response wins
3. Stream URL is extracted and validated
4. HLS playlist is parsed if needed
5. Best quality stream is selected
6. .strm file is created in your library

### Quality Selection

When multiple quality options are available:

- Cinephage selects the highest quality by default
- Resolution preference follows your quality profile
- Some providers offer multiple bitrates

---

## Language Preferences

Configure preferred audio/subtitle languages for streams:

1. Go to streaming settings
2. Set preferred audio language
3. Set preferred subtitle language
4. Providers that support language selection will respect these

---

## External URL Configuration

For .strm files to work from outside your network:

1. Configure your external URL in settings
2. Cinephage uses this URL when generating .strm files
3. Media servers can then access streams remotely

---

## Troubleshooting Streams

### Stream Won't Play

1. Check if the provider is healthy (circuit not open)
2. Try refreshing the .strm file
3. Check your internet connection
4. Try a different provider

### Buffering Issues

- Check your bandwidth
- Try a lower quality stream
- Check if provider is under load

### Expired Links

Cinephage can refresh .strm files:

1. Navigate to the movie/episode
2. Click **Refresh Stream**
3. New URL is fetched and .strm updated

---

**See also:** [Quality Profiles](quality-profiles.md) | [Search & Download](search-and-download.md) | [Notifications](notifications.md)
