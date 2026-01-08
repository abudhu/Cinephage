# Live TV

Cinephage includes experimental IPTV support with Stalker portal integration, portal scanning, EPG management, and channel lineup organization.

> **Experimental Feature**: Live TV functionality is under active development. Expect bugs and incomplete features. Report issues on [GitHub](https://github.com/MoldyTaint/Cinephage/issues).

---

## Overview

Live TV support includes:

- Stalker/Ministra portal integration
- Portal scanner for discovering accounts
- Electronic Program Guide (EPG) sync
- Channel lineup management
- M3U playlist generation
- Category organization

---

## Stalker Portal Support

Cinephage connects to Stalker/Ministra IPTV portals.

### What Are Stalker Portals?

Stalker (also known as Ministra) is an IPTV middleware system. Many IPTV providers use Stalker-compatible portals to deliver live TV streams.

### Adding a Portal

1. Navigate to **Live TV > Accounts**
2. Click **Add Account**
3. Enter portal details:

| Setting         | Description                   |
| --------------- | ----------------------------- |
| **Name**        | Display name for this account |
| **Portal URL**  | Full portal URL               |
| **MAC Address** | Your assigned MAC address     |

### MAC Address

Your IPTV provider assigns a MAC address for your account. This is used to authenticate with the portal.

---

## Portal Scanner

Cinephage includes a portal scanner that can discover Stalker accounts.

### How It Works

1. Navigate to **Live TV > Scanner**
2. Enter a portal URL to scan
3. The scanner searches for valid account credentials
4. Discovered accounts can be added directly

### Scanner Features

- Automatic MAC address discovery
- Credential validation
- Batch scanning support
- Results can be saved as accounts

---

## Channel Sync

After adding an account, sync channels:

1. Go to your account settings
2. Click **Sync Channels**
3. Cinephage fetches the channel list from the portal
4. Channels appear in the channel management interface

### What Gets Synced

- Channel names
- Channel numbers
- Categories/groups
- Stream URLs
- Channel logos (if available)

---

## Channel Lineup

The channel lineup determines which channels are active and how they're organized.

### Managing Channels

1. Navigate to **Live TV > Channels**
2. View all synced channels
3. Toggle channels on/off
4. Reorder channels
5. Assign to categories

### Creating a Lineup

1. Go to **Live TV > Lineup**
2. Click **Create Lineup**
3. Select channels to include
4. Arrange order
5. Save

### Multiple Lineups

Create different lineups for different purposes:

- **All Channels**: Everything available
- **Sports Only**: Just sports channels
- **News**: News channels only
- **Family**: Family-friendly content

---

## Categories

Organize channels into categories:

### Default Categories

- Movies
- Sports
- News
- Entertainment
- Kids
- Music

### Custom Categories

1. Go to **Live TV > Categories**
2. Click **Add Category**
3. Name the category
4. Assign channels

---

## Electronic Program Guide (EPG)

EPG provides TV schedule information.

### EPG Sources

Cinephage can import EPG data from:

- Portal-provided EPG
- External XMLTV URLs

### Configuring EPG

1. Go to **Live TV > EPG**
2. Add EPG source URL
3. Configure refresh interval
4. Map EPG channels to your lineup

### EPG Refresh

- Default interval: 6 hours
- Manual refresh available
- EPG data cached locally

---

## M3U Playlist

Cinephage generates M3U playlists for external players.

### Accessing the Playlist

The M3U playlist is available at:

```
http://your-cinephage-url/api/livetv/playlist.m3u
```

### Using with External Apps

Point any M3U-compatible player to this URL:

- VLC
- IPTV apps
- Smart TV apps
- Kodi

### Playlist Contents

The M3U includes:

- Active channels from your lineup
- Stream URLs
- Channel names and numbers
- EPG mapping (if configured)

---

## Stream Playback

### Direct Play

Click any channel in the Live TV interface to play directly.

### Via Media Server

Import the M3U playlist into Jellyfin/Emby/Plex for integrated live TV.

---

## Known Limitations

This feature is experimental:

- Not all Stalker portals are supported
- Some streams may not play correctly
- EPG mapping can be imperfect
- Category sync may be incomplete
- DVR/recording not supported yet

---

## Troubleshooting

### Channels Not Loading

1. Verify portal URL is correct
2. Check MAC address is valid
3. Ensure portal is online
4. Check Cinephage logs for errors

### Streams Not Playing

- Some streams require specific player support
- Check if stream format is compatible
- Try playing in VLC directly

### EPG Not Showing

1. Verify EPG source URL is accessible
2. Check channel-to-EPG mapping
3. Wait for next EPG refresh
4. Check EPG source format is XMLTV compatible

---

**See also:** [Streaming](streaming.md) | [Notifications](notifications.md) | [Troubleshooting](../support/troubleshooting.md)
