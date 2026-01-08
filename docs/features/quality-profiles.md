# Quality Profiles

Cinephage uses a scoring system to evaluate and compare releases, helping you get the best quality for your preferences.

---

## Built-in Profiles

Four profiles cover common use cases:

| Profile      | Focus                | Use Case                               |
| ------------ | -------------------- | -------------------------------------- |
| **Quality**  | Maximum quality      | Remux, lossless audio, quality purists |
| **Balanced** | Quality + efficiency | x265/AV1 from quality groups           |
| **Compact**  | Small files          | Micro encodes, limited storage         |
| **Streamer** | Streaming only       | .strm files, instant playback          |

### Quality Profile

- Prioritizes highest quality regardless of file size
- Prefers Remux, then BluRay encodes
- Values lossless audio (TrueHD, DTS-HD MA)
- Prefers HDR formats (Dolby Vision, HDR10+)
- Uses top-tier release groups
- Continuously upgrades until hitting the best possible

### Balanced Profile

- High quality with efficient encoding
- Prefers x265/HEVC and AV1 codecs
- Values quality encoding groups
- Good balance of quality and file size
- Suitable for limited storage with quality priority

### Compact Profile

- Small files with decent quality
- Prefers efficient micro-encode groups
- Accepts standard audio codecs
- Lowest minScore threshold for flexibility
- Ideal for limited storage or bandwidth

### Streamer Profile

- Streaming-only via .strm files
- Instant playback with no downloads
- No upgrades (streams don't upgrade)
- Only uses streaming protocol
- Ideal for cloud-based media consumption

---

## Scoring System

Releases are scored based on multiple factors. Higher scores indicate better quality.

### Resolution + Source (0-20,000 points)

| Quality      | Score  |
| ------------ | ------ |
| 2160p Remux  | 20,000 |
| 2160p BluRay | 18,000 |
| 2160p Web-DL | 15,000 |
| 1080p Remux  | 14,000 |
| 1080p BluRay | 12,000 |
| 1080p Web-DL | 10,000 |
| 720p BluRay  | 7,000  |
| 720p Web-DL  | 5,000  |
| 480p         | 2,000  |

### Audio Codec (0-2,000 points)

| Codec        | Score |
| ------------ | ----- |
| TrueHD Atmos | 2,000 |
| DTS-HD MA    | 1,800 |
| TrueHD       | 1,600 |
| DTS-X        | 1,500 |
| Atmos        | 1,400 |
| DTS-HD       | 1,200 |
| DTS          | 800   |
| AAC          | 400   |

### HDR Format (0-1,000 points)

| Format       | Score |
| ------------ | ----- |
| Dolby Vision | 1,000 |
| HDR10+       | 800   |
| HDR10        | 600   |

### Release Group Tiers (0-500 points)

| Tier    | Examples        | Score |
| ------- | --------------- | ----- |
| Tier 1  | FraMeSToR, etc. | 500   |
| Tier 2  | SPARKS, etc.    | 300   |
| Tier 3  | RARBG, etc.     | 100   |
| Unknown | -               | 0     |

### Penalties

| Condition         | Score   |
| ----------------- | ------- |
| Banned groups     | -10,000 |
| Cam/Screener      | -5,000  |
| Low quality audio | -500    |
| Streaming rips    | -200    |

---

## How Scores Are Used

### Selecting Releases

When you search, results are sorted by score (highest first). The top result is typically the best quality available.

### Upgrade Decisions

Cinephage uses scores to determine when to upgrade:

1. Current file has a calculated score
2. New release must score significantly higher to trigger upgrade
3. Profile cutoff determines the "good enough" threshold

### Cutoff Score

Each profile has a cutoff score:

- Releases above cutoff are considered "good enough"
- Cinephage won't actively search for upgrades above cutoff
- You can still manually grab higher-quality releases

---

## Custom Profiles

> **Work in Progress**: Custom profiles are under active development. The 4 built-in profiles are recommended for now.

Custom profiles will allow:

- Adjusting score weights for each factor
- Setting custom cutoff thresholds
- Defining preferred and banned groups
- Configuring size limits

---

## Profile Assignment

### Default Profile

Set a default profile in **Settings > Profiles**. This applies to all new media unless overridden.

### Per-Item Override

Override the profile for specific items:

1. Navigate to the movie or series
2. Click **Edit**
3. Select a different quality profile
4. Save changes

---

## Tips for Choosing Profiles

| Scenario                        | Recommended Profile |
| ------------------------------- | ------------------- |
| Home theater, unlimited storage | Quality             |
| Good TV, limited storage        | Balanced            |
| Mobile devices, small storage   | Compact             |
| Cloud streaming only            | Streamer            |

---

**See also:** [Search & Download](search-and-download.md) | [Monitoring](monitoring.md) | [Indexers](../configuration/indexers.md)
