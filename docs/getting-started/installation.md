# Installation

Get Cinephage up and running with Docker (recommended) or manual installation.

---

## Requirements

### Software

| Component       | Required    | Notes                                                             |
| --------------- | ----------- | ----------------------------------------------------------------- |
| Download Client | Yes         | qBittorrent 4.5+, SABnzbd 4.0+, or NZBGet                         |
| TMDB API Key    | Yes         | Free at [themoviedb.org](https://www.themoviedb.org/settings/api) |
| Node.js         | Manual only | Version 20+ (comes with npm 10+)                                  |
| ffprobe         | Optional    | For media info extraction (resolution, codecs)                    |

### System

| Resource | Minimum          | Recommended      |
| -------- | ---------------- | ---------------- |
| RAM      | 512 MB           | 1 GB             |
| Disk     | 100 MB + library | 500 MB + library |
| CPU      | 1 core           | 2+ cores         |

---

## Docker Installation (Recommended)

Docker provides the simplest setup and automatic updates.

### Using Docker Compose

```bash
mkdir cinephage && cd cinephage
curl -O https://raw.githubusercontent.com/MoldyTaint/cinephage/main/docker-compose.yaml
curl -O https://raw.githubusercontent.com/MoldyTaint/cinephage/main/.env.docker.example
cp .env.docker.example .env
```

Edit `.env` to configure your installation:

```bash
CINEPHAGE_PORT=3000
CINEPHAGE_MEDIA_PATH=/path/to/your/media
CINEPHAGE_UID=1000
CINEPHAGE_GID=1000
CINEPHAGE_ORIGIN=http://localhost:3000
```

Start Cinephage:

```bash
docker compose up -d
```

### Using Docker Run

```bash
docker run -d \
  --name cinephage \
  --restart unless-stopped \
  --user 1000:1000 \
  -p 3000:3000 \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  -v /path/to/your/media:/media \
  -e ORIGIN=http://localhost:3000 \
  -e TZ=UTC \
  ghcr.io/moldytaint/cinephage:latest
```

### Building from Source

If you prefer to build the Docker image yourself:

```bash
git clone https://github.com/MoldyTaint/cinephage.git
cd cinephage
cp .env.docker.example .env
docker compose -f docker-compose.yaml -f docker-compose.build.yaml up -d --build
```

---

## Manual Installation

For running without Docker or for development.

### 1. Clone the Repository

```bash
git clone https://github.com/MoldyTaint/cinephage.git
cd cinephage
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Application

```bash
npm run build
```

### 4. Start the Server

```bash
npm start
```

Cinephage is now running at **http://localhost:3000**.

The database initializes automatically on first run at `data/cinephage.db`.

---

## Installing ffprobe (Optional)

ffprobe enables media info extraction for resolution, codec, and audio track details. Without it, Cinephage can still function but won't detect quality information from existing files.

**Ubuntu/Debian:**

```bash
sudo apt install ffmpeg
```

**macOS:**

```bash
brew install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

If ffprobe is not in your system PATH, set the `FFPROBE_PATH` environment variable to its location.

---

## Verify Installation

Open http://localhost:3000 in your browser. You should see the Cinephage interface prompting you for initial setup.

If the page doesn't load:

- Check that port 3000 is not in use by another application
- Review the logs (`logs/` directory or `docker logs cinephage`)
- See [Troubleshooting](../support/troubleshooting.md) for common issues

---

## Next Steps

Continue to **[Setup Wizard](setup-wizard.md)** to configure TMDB, download clients, and root folders.

---

**See also:** [Setup Wizard](setup-wizard.md) | [Deployment](../operations/deployment.md) | [Settings Reference](../configuration/settings-reference.md)
