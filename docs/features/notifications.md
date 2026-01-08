# Notifications

Cinephage integrates with media servers to notify them when your library changes.

---

## Jellyfin/Emby Integration

Cinephage can notify Jellyfin and Emby when content is added, updated, or removed.

### What It Does

When media is imported:

1. Cinephage detects the import completion
2. Notification is queued for the media server
3. Jellyfin/Emby rescans the affected library
4. New content appears in your media server immediately

### Notification Triggers

| Event                   | Notification           |
| ----------------------- | ---------------------- |
| Movie imported          | Library scan triggered |
| Episode imported        | Library scan triggered |
| File replaced (upgrade) | Library scan triggered |
| File deleted            | Library scan triggered |

---

## Setting Up Jellyfin

1. Navigate to **Settings > Integrations > Notifications**
2. Click **Add Notification Connection**
3. Select **Jellyfin**
4. Configure connection:

| Setting        | Description                                         |
| -------------- | --------------------------------------------------- |
| **URL**        | Jellyfin server URL (e.g., `http://localhost:8096`) |
| **API Key**    | Jellyfin API key                                    |
| **Library ID** | (Optional) Specific library to scan                 |

### Getting a Jellyfin API Key

1. Open Jellyfin Dashboard
2. Go to **Administration > API Keys**
3. Click **Add** to create a new key
4. Copy the key to Cinephage

---

## Setting Up Emby

1. Navigate to **Settings > Integrations > Notifications**
2. Click **Add Notification Connection**
3. Select **Emby**
4. Configure connection:

| Setting     | Description                                     |
| ----------- | ----------------------------------------------- |
| **URL**     | Emby server URL (e.g., `http://localhost:8096`) |
| **API Key** | Emby API key                                    |

### Getting an Emby API Key

1. Open Emby Server Dashboard
2. Go to **API Keys** under Advanced
3. Click **New API Key**
4. Copy the key to Cinephage

---

## Path Mapping

If Cinephage and your media server see files at different paths, configure path mappings:

### Example

| Cinephage Path  | Media Server Path   |
| --------------- | ------------------- |
| `/media/movies` | `/mnt/media/movies` |
| `/data/tv`      | `/volume1/tv`       |

### Configuring Mappings

1. Go to your notification connection settings
2. Add path mappings
3. Enter the Cinephage path and corresponding media server path
4. Save

---

## Notification Batching

To avoid overwhelming your media server:

- Notifications are batched in 5-second windows
- Multiple imports in quick succession trigger one scan
- Prevents excessive rescanning during bulk imports

---

## Testing the Connection

1. Go to your notification connection settings
2. Click **Test Connection**
3. Verify Jellyfin/Emby responds successfully
4. Check your media server logs for the test notification

---

## Troubleshooting

### Notifications Not Working

1. Verify the URL is correct and accessible
2. Check the API key is valid
3. Ensure network connectivity between Cinephage and media server
4. Check Cinephage logs for errors

### Library Not Updating

1. Verify path mappings are correct
2. Check media server can access the file paths
3. Try triggering a manual library scan in the media server
4. Check media server logs for scan issues

### Connection Test Fails

- Verify URL includes protocol (`http://` or `https://`)
- Check firewall rules allow connection
- Verify API key has sufficient permissions

---

## Future Integrations

Additional notification integrations are planned:

- Plex
- Kodi
- Discord webhooks
- Custom webhooks

See the [Roadmap](../roadmap.md) for planned features.

---

**See also:** [Library Management](library.md) | [Monitoring](monitoring.md) | [Troubleshooting](../support/troubleshooting.md)
