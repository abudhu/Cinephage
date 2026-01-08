# Search & Download

Cinephage searches configured indexers for releases and sends them to your download client.

---

## How Search Works

When you search for a movie or TV show:

1. **Query indexers** - Cinephage sends the search to all enabled indexers
2. **Parse results** - Responses are normalized into a common format
3. **Score releases** - Each release is scored against your quality profile
4. **Deduplicate** - Identical releases from multiple indexers are merged
5. **Present results** - Results are sorted by score (highest first)

---

## Manual Search

Search manually from any library item:

1. Navigate to the movie or episode in your library
2. Click **Search**
3. Review the results

### Understanding Results

Each result shows:

| Field             | Description                                |
| ----------------- | ------------------------------------------ |
| **Release Name**  | Full release name with quality indicators  |
| **Quality Score** | Calculated score from your quality profile |
| **Size**          | File size                                  |
| **Seeders/Peers** | For torrents, number of available sources  |
| **Indexer**       | Which indexer returned this result         |
| **Protocol**      | Torrent, Usenet, or Streaming              |

### Result Indicators

- **Green score**: Meets or exceeds your cutoff
- **Yellow score**: Below cutoff but acceptable
- **Red indicators**: Banned group, cam/screener, or other issues

---

## Grabbing Releases

Click **Grab** on any search result to download it:

1. Release is sent to your configured download client
2. Entry appears in the download queue
3. Cinephage monitors download progress
4. When complete, file is automatically imported

### Grab Behavior

- For torrents: Magnet link or .torrent file is sent to qBittorrent
- For usenet: NZB file is sent to SABnzbd or NZBGet
- For streaming: Stream is resolved and .strm file is created

---

## The Download Queue

View active downloads at **Activity > Queue**.

### Queue Statuses

| Status          | Description                              |
| --------------- | ---------------------------------------- |
| **Queued**      | Waiting for download client to start     |
| **Downloading** | Currently downloading                    |
| **Importing**   | Download complete, processing file       |
| **Completed**   | Successfully imported to library         |
| **Failed**      | Error occurred during download or import |

### Queue Actions

- **Retry**: Re-attempt a failed download
- **Remove**: Cancel and remove from queue
- **Blocklist**: Cancel and prevent this release from being grabbed again

### Failed Downloads

When a download fails:

1. Check the error message in the queue
2. Common issues:
   - Download client unreachable
   - Torrent has no seeders
   - NZB expired or incomplete
   - Import path permission issues
3. Either **Retry** or **Remove and search again**

---

## Automatic Searching

When monitoring is enabled, Cinephage searches automatically.

### Missing Content Search

Searches for movies/shows without files:

1. Runs at configured interval (default: 24 hours)
2. Finds items marked as monitored without any files
3. Searches indexers and grabs best match
4. Only grabs if result meets minimum quality

### New Episode Detection

Monitors for newly released TV episodes:

1. Runs at configured interval (default: 1 hour)
2. Checks air dates of monitored series
3. Searches for episodes that recently aired
4. Grabs according to quality profile

### Quality Upgrades

Searches for better releases of existing files:

1. Compares current file quality to available releases
2. If a significantly better release is found, grabs it
3. Old file is replaced after successful import

Configure automatic search intervals in **Settings > Tasks**.

---

## Blocklisting

Block releases you don't want:

### Adding to Blocklist

1. From the queue, click **Blocklist** on a bad release
2. From search results, right-click and select **Add to Blocklist**

### What Happens

- Release is removed from queue (if downloading)
- Future searches won't return this exact release
- Blocklist is per-title, not global

### Viewing Blocklist

Go to **Settings > Blocklist** to see and manage blocked releases.

---

## Rate Limiting

Cinephage respects indexer rate limits:

- Each indexer has configured request limits
- Searches are queued when limits are reached
- Failing indexers are automatically disabled temporarily
- Status shown in **Settings > Integrations > Indexers**

---

## Search Filters

Cinephage filters results based on your quality profile:

- Minimum quality threshold
- Banned release groups
- Size limits
- Protocol preferences (torrent/usenet/streaming)

Results that don't meet these filters are still shown but marked as rejected.

---

**See also:** [Quality Profiles](quality-profiles.md) | [Indexers](../configuration/indexers.md) | [Monitoring](monitoring.md)
