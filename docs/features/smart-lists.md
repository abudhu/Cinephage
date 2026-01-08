# Smart Lists

Smart Lists are dynamic, TMDB-powered lists that automatically discover content based on your criteria and optionally add it to your library.

---

## Overview

Smart Lists work by:

1. Querying TMDB's Discover API with your filters
2. Refreshing periodically to find new content
3. Optionally adding new items to your library
4. Optionally triggering searches for added items

---

## Creating a Smart List

1. Navigate to **Library > Smart Lists**
2. Click **Add Smart List**
3. Configure your list settings

### Basic Settings

| Setting             | Description                   |
| ------------------- | ----------------------------- |
| **Name**            | Display name for the list     |
| **Media Type**      | Movies or TV Shows            |
| **Root Folder**     | Where to store added items    |
| **Quality Profile** | Profile for added items       |
| **Limit**           | Maximum items to keep in list |

### Filter Options

Smart Lists use TMDB Discover filters:

**Genre Filters**

- Include specific genres (Action, Comedy, Drama, etc.)
- Exclude genres you don't want

**Rating Filters**

- Minimum rating (e.g., 7.0+)
- Maximum rating
- Minimum vote count (filters out obscure titles)

**Date Filters**

- Release year range
- Released after specific date
- Released before specific date

**Popularity Filters**

- Minimum popularity score
- Sort by popularity

**Other Filters**

- Original language
- With specific keywords
- Without specific keywords
- With specific cast/crew

### Sort Options

- **Popularity**: Most popular first (default)
- **Rating**: Highest rated first
- **Release Date**: Newest first
- **Revenue**: Highest grossing first

---

## Auto-Add Behavior

Control what happens when new items match your list:

| Option             | Description                                      |
| ------------------ | ------------------------------------------------ |
| **Disabled**       | Items appear in list but aren't added to library |
| **Add Only**       | Items are added to library but not searched      |
| **Add and Search** | Items are added and immediately searched         |

### When to Use Each

- **Disabled**: Browse potential additions, manually decide
- **Add Only**: Queue items for later, search when you're ready
- **Add and Search**: Fully automated discovery and download

---

## List Refresh

Smart Lists refresh periodically to discover new content.

### Automatic Refresh

- Default interval: 6 hours
- Configurable per list
- Runs as part of the Smart List Refresh monitoring task

### Manual Refresh

1. Navigate to your Smart List
2. Click **Refresh Now**
3. New items appear based on current TMDB data

### What Happens on Refresh

1. TMDB Discover API is queried with your filters
2. Results are compared against existing list items
3. New items are added according to auto-add setting
4. Removed items (no longer matching filters) are marked
5. Refresh history is recorded

---

## Managing List Items

### Viewing Items

Each Smart List shows:

- Items matching the current query
- Status (in library, monitored, downloaded)
- TMDB rating and popularity
- When item was added to list

### Excluding Items

Don't want a specific item?

1. Click on the item
2. Select **Exclude from List**
3. Item won't appear even if it matches filters

### Re-including Items

To bring back an excluded item:

1. Go to list settings
2. View excluded items
3. Click **Remove Exclusion**

---

## Example Smart Lists

### Trending Action Movies

- **Media Type**: Movies
- **Genre**: Action
- **Sort**: Popularity Descending
- **Release Date**: Last 2 years
- **Limit**: 50

### Highly Rated TV Dramas

- **Media Type**: TV Shows
- **Genre**: Drama
- **Minimum Rating**: 8.0
- **Minimum Votes**: 1000
- **Sort**: Rating Descending

### New Anime

- **Media Type**: TV Shows
- **Keywords**: anime
- **Release Date**: Last 6 months
- **Sort**: Release Date Descending
- **Auto-Add**: Add and Search

### Award-Winning Films

- **Media Type**: Movies
- **Minimum Rating**: 8.5
- **Minimum Votes**: 5000
- **Sort**: Rating Descending

---

## Limitations

- TMDB API rate limits apply
- Some filter combinations may return few results
- Results depend on TMDB's data accuracy
- Refreshing too frequently may hit rate limits

---

## Tips

1. **Start with Add Only**: Test your filters before enabling auto-search
2. **Use minimum votes**: Filters out obscure titles with inflated ratings
3. **Combine filters**: More specific = better quality matches
4. **Review regularly**: Check what's being added to your library
5. **Adjust limits**: Keep lists manageable (50-100 items)

---

**See also:** [Monitoring](monitoring.md) | [Library Management](library.md) | [Quality Profiles](quality-profiles.md)
