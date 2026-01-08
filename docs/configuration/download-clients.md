# Download Clients

Cinephage supports three download clients for grabbing releases from indexers.

---

## Supported Clients

| Client      | Protocol | Description                        |
| ----------- | -------- | ---------------------------------- |
| qBittorrent | Torrent  | Popular open-source torrent client |
| SABnzbd     | Usenet   | Python-based usenet downloader     |
| NZBGet      | Usenet   | Efficient C++ usenet downloader    |

---

## qBittorrent Setup

qBittorrent is recommended for torrent downloads.

### Enable WebUI

1. Open qBittorrent
2. Go to **Tools > Options > Web UI**
3. Enable **Web User Interface (Remote control)**
4. Set a **username** and **password**
5. Note the **port** (default: 8080)
6. Click **Apply**

### Optional: Localhost Bypass

If Cinephage runs on the same machine as qBittorrent:

1. In qBittorrent Web UI settings
2. Enable **Bypass authentication for clients on localhost**
3. No username/password needed in Cinephage

### Add to Cinephage

1. Navigate to **Settings > Integrations > Download Clients**
2. Click **Add Download Client**
3. Select **qBittorrent**
4. Configure:

| Setting  | Value                                    |
| -------- | ---------------------------------------- |
| Name     | qBittorrent (or custom name)             |
| Host     | `localhost` or IP address                |
| Port     | `8080` (or your configured port)         |
| Username | Your WebUI username                      |
| Password | Your WebUI password                      |
| Category | `cinephage` (optional, for organization) |

5. Click **Test Connection**
6. Save

### Recommended qBittorrent Settings

For best compatibility:

- **Downloads > When adding a torrent > Add in paused state**: Disabled
- **Downloads > Saving Management > Default Torrent Management Mode**: Automatic
- **Connection > Listening Port**: Configured for your network
- **BitTorrent > Seeding Limits**: Configure based on your preferences

---

## SABnzbd Setup

SABnzbd is recommended for usenet downloads.

### Get API Key

1. Open SABnzbd web interface
2. Go to **Config > General**
3. Find **API Key** section
4. Copy the API key

### Add to Cinephage

1. Navigate to **Settings > Integrations > Download Clients**
2. Click **Add Download Client**
3. Select **SABnzbd**
4. Configure:

| Setting  | Value                            |
| -------- | -------------------------------- |
| Name     | SABnzbd (or custom name)         |
| Host     | `localhost` or IP address        |
| Port     | `8080` (or your configured port) |
| API Key  | Your SABnzbd API key             |
| Category | `cinephage` (optional)           |

5. Click **Test Connection**
6. Save

### SABnzbd Category Setup

Create a category for Cinephage downloads:

1. In SABnzbd, go to **Config > Categories**
2. Add a new category named `cinephage`
3. Set the output folder path
4. Save

---

## NZBGet Setup

NZBGet is an alternative usenet client.

### Get Credentials

1. Open NZBGet web interface
2. Go to **Settings > Security**
3. Note the username and password (ControlUsername/ControlPassword)

### Add to Cinephage

1. Navigate to **Settings > Integrations > Download Clients**
2. Click **Add Download Client**
3. Select **NZBGet**
4. Configure:

| Setting  | Value                        |
| -------- | ---------------------------- |
| Name     | NZBGet (or custom name)      |
| Host     | `localhost` or IP address    |
| Port     | `6789` (default NZBGet port) |
| Username | Your NZBGet username         |
| Password | Your NZBGet password         |
| Category | `cinephage` (optional)       |

5. Click **Test Connection**
6. Save

---

## Path Mapping

When your download client and Cinephage see files at different paths, configure path mappings.

### Common Scenarios

| Scenario        | Download Client Path | Cinephage Path     |
| --------------- | -------------------- | ------------------ |
| Docker          | `/downloads`         | `/media/downloads` |
| Network share   | `\\server\downloads` | `/mnt/downloads`   |
| Different mount | `/volume1/downloads` | `/data/downloads`  |

### Configuring Mappings

1. Go to your download client settings in Cinephage
2. Find the **Path Mapping** section
3. Add mappings:
   - **Remote Path**: Path as seen by download client
   - **Local Path**: Path as seen by Cinephage
4. Save

### Example

If qBittorrent saves to `/downloads/movies` but Cinephage sees `/media/movies`:

| Remote Path  | Local Path |
| ------------ | ---------- |
| `/downloads` | `/media`   |

---

## Multiple Clients

You can configure multiple download clients:

- Multiple torrent clients (e.g., qBittorrent for movies, another for TV)
- Multiple usenet clients
- Mix of torrent and usenet

### Priority

When multiple clients are configured, releases are sent based on:

1. Protocol match (torrent releases to torrent clients)
2. Client priority order
3. Client availability

---

## Troubleshooting

### Connection Failed

1. Verify host and port are correct
2. Check client is running and WebUI is enabled
3. Verify firewall allows connection
4. Check username/password

### Downloads Not Starting

1. Verify the download client is not paused
2. Check client disk space
3. Verify torrent/NZB was received (check client directly)
4. Check Cinephage logs for errors

### Imports Not Working

1. Verify path mappings are correct
2. Check file permissions
3. Ensure root folder is accessible
4. Check import settings in Cinephage

---

**See also:** [Setup Wizard](../getting-started/setup-wizard.md) | [Indexers](indexers.md) | [Troubleshooting](../support/troubleshooting.md)
