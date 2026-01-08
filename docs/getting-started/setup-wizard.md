# Setup Wizard

After installing Cinephage, complete these configuration steps in the web UI before adding media.

---

## 1. TMDB API Key

TMDB provides all movie and TV metadata. A free API key is required.

1. Get a free API key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
2. Navigate to **Settings > General**
3. Enter your TMDB API key
4. The key is validated automatically upon save

---

## 2. Download Client

Configure at least one download client for grabbing releases.

**Supported clients:** qBittorrent, SABnzbd, NZBGet

1. Navigate to **Settings > Integrations > Download Clients**
2. Click **Add Download Client**
3. Select your client type
4. Enter connection details:
   - **Host**: `localhost` or IP address
   - **Port**: Client's WebUI port
   - **Username/Password**: WebUI credentials
5. Click **Test Connection** to verify
6. Save the configuration

### qBittorrent Setup

qBittorrent requires WebUI to be enabled:

1. Open qBittorrent
2. Go to **Tools > Options > Web UI**
3. Enable **Web User Interface (Remote control)**
4. Set a username and password
5. Note the port (default: 8080)

If Cinephage runs on the same machine, you can enable "Bypass authentication for clients on localhost" for easier setup.

### SABnzbd Setup

1. Open SABnzbd's web interface
2. Go to **Config > General**
3. Note your API key
4. In Cinephage, enter the API key and SABnzbd's URL

### NZBGet Setup

1. Open NZBGet's web interface
2. Go to **Settings > Security**
3. Note the username and password
4. In Cinephage, enter these credentials and NZBGet's URL

---

## 3. Root Folders

Root folders define where Cinephage stores and organizes your media.

1. Navigate to **Settings > General**
2. Add root folders:
   - **Movies folder**: e.g., `/media/movies`
   - **TV folder**: e.g., `/media/tv`
3. Click **Add** for each folder

Cinephage automatically organizes imported files into these locations, creating subfolders for each movie or series.

### Path Mapping (Remote Clients)

If your download client and Cinephage see different paths to the same storage, configure path mappings:

| Scenario       | Download Client Sees | Cinephage Sees     |
| -------------- | -------------------- | ------------------ |
| Network share  | `\\server\downloads` | `/mnt/downloads`   |
| Docker mapping | `/downloads`         | `/media/downloads` |

Configure mappings in **Settings > Integrations > Download Clients** under your client's settings.

---

## 4. Indexers

Enable search sources for torrents and usenet.

1. Navigate to **Settings > Integrations > Indexers**
2. Public indexers (EZTV, YTS, Knaben, BitSearch) work immediately
3. For private trackers, click **Add Indexer** and enter credentials
4. Test each indexer to verify connectivity

Cinephage includes 7 built-in indexers plus a Newznab template for connecting usenet indexers like NZBGeek or DrunkenSlug.

See [Indexers](../configuration/indexers.md) for detailed setup.

---

## 5. Quality Profile (Optional)

Cinephage includes 4 built-in quality profiles. Review them to ensure they match your preferences.

1. Navigate to **Settings > Profiles**
2. Review the built-in profiles:
   - **Quality**: Maximum quality, remux preferred
   - **Balanced**: High quality with efficient encoding (x265/AV1)
   - **Compact**: Smaller file sizes, micro encodes
   - **Streamer**: Streaming only, no downloads

The default profile is applied to new media. You can change which profile is used when adding each item.

See [Quality Profiles](../features/quality-profiles.md) for scoring details.

---

## 6. Subtitle Providers (Optional)

If you want automatic subtitle downloads:

1. Navigate to **Settings > Integrations > Subtitle Providers**
2. Enable desired providers
3. For OpenSubtitles, enter your API key
4. Create a language profile with your preferred languages

Cinephage supports 8 subtitle providers. See [Subtitles](../features/subtitles.md) for provider setup.

---

## Verify Configuration

Before adding media, verify your setup:

1. **TMDB**: Search for any movie in Discover to confirm metadata loads
2. **Download Client**: Check the connection status in Settings
3. **Indexers**: Click **Test** next to each enabled indexer
4. **Root Folders**: Ensure paths are accessible (check permissions if using Docker)

---

## Next Steps

Your Cinephage instance is now configured. Continue to **[Adding Media](adding-media.md)** to add your first movie or TV show.

---

**See also:** [Adding Media](adding-media.md) | [Settings Reference](../configuration/settings-reference.md) | [Troubleshooting](../support/troubleshooting.md)
