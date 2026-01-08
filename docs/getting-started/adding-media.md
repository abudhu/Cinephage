# Adding Media

This guide walks you through adding your first movie or TV show to Cinephage.

---

## Adding a Movie

### 1. Find a Movie

1. Click **Discover** in the navigation
2. Browse trending movies or use the search bar
3. Click on a movie to view its details

### 2. Add to Library

1. On the movie detail page, click **Add to Library**
2. Configure options:
   - **Root Folder**: Where to store the file (e.g., `/media/movies`)
   - **Quality Profile**: Which scoring profile to use
   - **Monitored**: Enable to automatically search for releases
3. Click **Add**

### 3. Search for Releases

If "Search on Add" was enabled, Cinephage automatically searches. Otherwise:

1. Go to **Library > Movies**
2. Click on your movie
3. Click **Search** to find releases

Search results display:

- Release name and source
- Quality score (higher is better)
- File size
- Seeders/peers
- Indexer source

### 4. Grab a Release

1. Review the search results
2. Click **Grab** on your preferred release
3. The release is sent to your download client

### 5. Monitor Progress

1. Go to **Activity > Queue** to see download status
2. Once complete, Cinephage automatically imports the file to your root folder
3. Check **Library > Movies** to confirm the import

---

## Adding a TV Series

### 1. Find a Series

1. Click **Discover** in the navigation
2. Switch to the **TV Shows** tab
3. Browse trending or search for a series
4. Click on a series to view details

### 2. Add to Library

1. On the series detail page, click **Add to Library**
2. Configure options:
   - **Root Folder**: Where to store files (e.g., `/media/tv`)
   - **Quality Profile**: Which profile to use
   - **Monitored**: Enable for automatic searches
3. Choose which seasons to monitor:
   - **All seasons**: Monitor everything
   - **Future seasons only**: Only new seasons after adding
   - **Specific seasons**: Select individual seasons
4. Click **Add**

### 3. Search for Episodes

1. Go to **Library > Series**
2. Click on your series
3. Navigate to a season
4. Click **Search Season** to search all episodes, or search individual episodes
5. Review results and grab releases

### 4. Automatic Episode Monitoring

When monitoring is enabled and new episodes air:

1. Cinephage automatically detects them via TMDB
2. The New Episode Monitor task searches for releases
3. Episodes are grabbed and downloaded automatically

---

## Understanding Monitoring

Cinephage uses **cascading monitoring** for TV shows:

| Series      | Season      | Episode   | Will Search? |
| ----------- | ----------- | --------- | ------------ |
| Monitored   | Monitored   | Monitored | Yes          |
| Monitored   | Unmonitored | Monitored | No           |
| Unmonitored | Monitored   | Monitored | No           |

All three levels must be monitored for an episode to be searched automatically.

---

## The Download Queue

View download progress at **Activity > Queue**:

| Status      | Description                              |
| ----------- | ---------------------------------------- |
| Queued      | Waiting for download client to start     |
| Downloading | Currently downloading                    |
| Importing   | Download complete, processing file       |
| Completed   | Successfully imported to library         |
| Failed      | Error occurred during download or import |

### Queue Actions

- **Retry**: Re-attempt a failed download
- **Remove**: Cancel and remove from queue
- **Blocklist**: Cancel and prevent this release from being grabbed again

---

## Understanding Quality Scores

Each release is scored based on multiple factors:

| Factor              | Max Points | Examples                  |
| ------------------- | ---------- | ------------------------- |
| Resolution + Source | 20,000     | 2160p Remux, 1080p BluRay |
| Audio Codec         | 2,000      | TrueHD Atmos, DTS-HD MA   |
| HDR Format          | 1,000      | Dolby Vision, HDR10+      |
| Release Group Tier  | 500        | Top-tier groups get bonus |

Higher scores indicate better quality. Scores help Cinephage automatically choose the best release and determine when upgrades are worthwhile.

---

## Automatic vs Manual Mode

### Automatic Mode (Monitored)

When monitoring is enabled:

- Cinephage periodically searches for missing content
- New episodes are grabbed automatically after they air
- Quality upgrades happen when better releases appear

Configure search intervals in **Settings > Tasks**.

### Manual Mode (Unmonitored)

When monitoring is disabled:

- You search manually from the library
- You choose which releases to grab
- Full control over what gets downloaded

---

## What's Next?

Now that you've added your first media:

- **[Library Management](../features/library.md)** - Learn about file scanning and organization
- **[Quality Profiles](../features/quality-profiles.md)** - Understand the scoring system
- **[Subtitles](../features/subtitles.md)** - Set up automatic subtitle downloads
- **[Monitoring](../features/monitoring.md)** - Configure automated tasks

---

**See also:** [Library Management](../features/library.md) | [Quality Profiles](../features/quality-profiles.md) | [Search & Download](../features/search-and-download.md)
