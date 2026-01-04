/**
 * Embedded Schema Synchronization
 *
 * This module handles database schema management without external migration files.
 * Similar to Radarr/Sonarr's approach - all schema definitions are embedded in code.
 *
 * On startup:
 * 1. Ensures all tables exist (CREATE TABLE IF NOT EXISTS)
 * 2. Checks schema version and applies incremental updates if needed
 * 3. Creates indexes for performance
 */

import Database from 'better-sqlite3';
import { logger } from '$lib/logging';

/**
 * Current schema version - increment when adding schema changes
 * Version 1: Initial complete schema
 * Version 2: Added profile_size_limits, custom_formats, naming_presets tables
 * Version 3: Added read_only column to root_folders for virtual mount support (NZBDav)
 * Version 4: Fix invalid scoring profile references and ensure default profile exists
 * Version 5: Added preserve_symlinks column to root_folders for NZBDav/rclone symlink preservation
 * Version 6: Added nntp_servers and nzb_stream_mounts tables for NZB streaming
 * Version 7: Added streamability, extraction columns to nzb_stream_mounts for compressed archive support
 * Version 8: Fixed nzb_stream_mounts status CHECK constraint to include all extraction states
 * Version 9: Remove deprecated qualityPresets system in favor of scoringProfiles
 * Version 10: Flag series with broken episode metadata for automatic repair
 * Version 11: Added stalker_portal_accounts table for Live TV IPTV support
 * Version 12: Added channel_lineup_items table for custom Live TV channel lineup
 * Version 13: Added channel_categories table and extended channel_lineup_items with customization fields
 * Version 14: Added EPG support - epg_sources, epg_programs tables, extended accounts and lineup items
 * Version 15: Added live_tv_settings table for scheduler configuration
 * Version 16: Added temp path columns to download_clients for SABnzbd dual folder support
 */
export const CURRENT_SCHEMA_VERSION = 16;

/**
 * All table definitions with CREATE TABLE IF NOT EXISTS
 * Order matters for foreign key constraints
 */
const TABLE_DEFINITIONS: string[] = [
	// Core tables (no foreign keys)
	`CREATE TABLE IF NOT EXISTS "user" (
		"id" text PRIMARY KEY NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "indexer_definitions" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"description" text,
		"protocol" text NOT NULL CHECK ("protocol" IN ('torrent', 'usenet', 'streaming')),
		"type" text NOT NULL CHECK ("type" IN ('public', 'semi-private', 'private')),
		"language" text DEFAULT 'en-US',
		"urls" text NOT NULL,
		"legacy_urls" text,
		"settings_schema" text,
		"capabilities" text NOT NULL,
		"file_path" text,
		"file_hash" text,
		"loaded_at" text NOT NULL,
		"updated_at" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "scoring_profiles" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"description" text,
		"tags" text,
		"upgrades_allowed" integer DEFAULT true,
		"min_score" integer DEFAULT 0,
		"upgrade_until_score" integer DEFAULT -1,
		"min_score_increment" integer DEFAULT 0,
		"resolution_order" text,
		"format_scores" text,
		"allowed_protocols" text,
		"is_default" integer DEFAULT false,
		"movie_min_size_gb" text,
		"movie_max_size_gb" text,
		"episode_min_size_mb" text,
		"episode_max_size_mb" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "profile_size_limits" (
		"profile_id" text PRIMARY KEY NOT NULL,
		"movie_min_size_gb" real,
		"movie_max_size_gb" real,
		"episode_min_size_mb" real,
		"episode_max_size_mb" real,
		"is_default" integer DEFAULT false,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "custom_formats" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"description" text,
		"category" text NOT NULL DEFAULT 'other',
		"tags" text,
		"conditions" text,
		"enabled" integer DEFAULT true,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "external_id_cache" (
		"tmdb_id" integer NOT NULL,
		"media_type" text NOT NULL,
		"imdb_id" text,
		"tvdb_id" integer,
		"cached_at" text,
		PRIMARY KEY ("tmdb_id", "media_type")
	)`,

	`CREATE TABLE IF NOT EXISTS "download_clients" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"implementation" text NOT NULL,
		"enabled" integer DEFAULT true,
		"host" text NOT NULL,
		"port" integer NOT NULL,
		"use_ssl" integer DEFAULT false,
		"username" text,
		"password" text,
		"movie_category" text DEFAULT 'movies',
		"tv_category" text DEFAULT 'tv',
		"recent_priority" text DEFAULT 'normal',
		"older_priority" text DEFAULT 'normal',
		"initial_state" text DEFAULT 'start',
		"seed_ratio_limit" text,
		"seed_time_limit" integer,
		"download_path_local" text,
		"download_path_remote" text,
		"temp_path_local" text,
		"temp_path_remote" text,
		"priority" integer DEFAULT 1,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "root_folders" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"path" text NOT NULL UNIQUE,
		"media_type" text NOT NULL,
		"is_default" integer DEFAULT false,
		"read_only" integer DEFAULT false,
		"preserve_symlinks" integer DEFAULT false,
		"free_space_bytes" integer,
		"last_checked_at" text,
		"created_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "language_profiles" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"languages" text NOT NULL,
		"cutoff_index" integer DEFAULT 0,
		"upgrades_allowed" integer DEFAULT true,
		"minimum_score" integer DEFAULT 60,
		"is_default" integer DEFAULT false,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "delay_profiles" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"sort_order" integer DEFAULT 0 NOT NULL,
		"enabled" integer DEFAULT true,
		"usenet_delay" integer DEFAULT 0 NOT NULL,
		"torrent_delay" integer DEFAULT 0 NOT NULL,
		"quality_delays" text,
		"preferred_protocol" text,
		"tags" text,
		"bypass_if_highest_quality" integer DEFAULT true,
		"bypass_if_above_score" integer,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "subtitle_providers" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"implementation" text NOT NULL,
		"enabled" integer DEFAULT true,
		"priority" integer DEFAULT 25,
		"api_key" text,
		"username" text,
		"password" text,
		"settings" text,
		"requests_per_minute" integer DEFAULT 60,
		"last_error" text,
		"last_error_at" text,
		"consecutive_failures" integer DEFAULT 0,
		"throttled_until" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "library_settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "naming_settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "naming_presets" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"description" text,
		"config" text NOT NULL,
		"is_built_in" integer DEFAULT false,
		"created_at" integer
	)`,

	`CREATE TABLE IF NOT EXISTS "monitoring_settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "subtitle_settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`,

	`CREATE TABLE IF NOT EXISTS "task_history" (
		"id" text PRIMARY KEY NOT NULL,
		"task_id" text NOT NULL,
		"status" text NOT NULL,
		"results" text,
		"errors" text,
		"started_at" text,
		"completed_at" text
	)`,

	// Tables with foreign keys to root_folders, scoring_profiles, quality_presets
	`CREATE TABLE IF NOT EXISTS "indexers" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"definition_id" text NOT NULL,
		"enabled" integer DEFAULT true,
		"base_url" text NOT NULL,
		"alternate_urls" text,
		"priority" integer DEFAULT 25,
		"enable_automatic_search" integer DEFAULT true,
		"enable_interactive_search" integer DEFAULT true,
		"settings" text,
		"protocol_settings" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "indexer_status" (
		"indexer_id" text PRIMARY KEY NOT NULL REFERENCES "indexers"("id") ON DELETE CASCADE,
		"health" text DEFAULT 'healthy' NOT NULL CHECK ("health" IN ('healthy', 'warning', 'failing', 'disabled')),
		"consecutive_failures" integer DEFAULT 0 NOT NULL,
		"total_requests" integer DEFAULT 0 NOT NULL,
		"total_failures" integer DEFAULT 0 NOT NULL,
		"is_disabled" integer DEFAULT false NOT NULL,
		"disabled_at" text,
		"disabled_until" text,
		"last_success" text,
		"last_failure" text,
		"last_error_message" text,
		"avg_response_time" integer,
		"recent_failures" text DEFAULT '[]',
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "movies" (
		"id" text PRIMARY KEY NOT NULL,
		"tmdb_id" integer NOT NULL UNIQUE,
		"imdb_id" text,
		"title" text NOT NULL,
		"original_title" text,
		"year" integer,
		"overview" text,
		"poster_path" text,
		"backdrop_path" text,
		"runtime" integer,
		"genres" text,
		"path" text NOT NULL,
		"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
		"scoring_profile_id" text REFERENCES "scoring_profiles"("id") ON DELETE SET NULL,
		"language_profile_id" text,
		"monitored" integer DEFAULT true,
		"minimum_availability" text DEFAULT 'released',
		"added" text,
		"has_file" integer DEFAULT false,
		"wants_subtitles" integer DEFAULT true,
		"last_search_time" text
	)`,

	`CREATE TABLE IF NOT EXISTS "movie_files" (
		"id" text PRIMARY KEY NOT NULL,
		"movie_id" text NOT NULL REFERENCES "movies"("id") ON DELETE CASCADE,
		"relative_path" text NOT NULL,
		"size" integer,
		"date_added" text,
		"scene_name" text,
		"release_group" text,
		"quality" text,
		"media_info" text,
		"edition" text,
		"languages" text
	)`,

	`CREATE TABLE IF NOT EXISTS "series" (
		"id" text PRIMARY KEY NOT NULL,
		"tmdb_id" integer NOT NULL UNIQUE,
		"tvdb_id" integer,
		"imdb_id" text,
		"title" text NOT NULL,
		"original_title" text,
		"year" integer,
		"overview" text,
		"poster_path" text,
		"backdrop_path" text,
		"status" text,
		"network" text,
		"genres" text,
		"path" text NOT NULL,
		"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
		"scoring_profile_id" text REFERENCES "scoring_profiles"("id") ON DELETE SET NULL,
		"language_profile_id" text,
		"monitored" integer DEFAULT true,
		"monitor_new_items" text DEFAULT 'all',
		"monitor_specials" integer DEFAULT false,
		"season_folder" integer DEFAULT true,
		"series_type" text DEFAULT 'standard',
		"added" text,
		"episode_count" integer DEFAULT 0,
		"episode_file_count" integer DEFAULT 0,
		"wants_subtitles" integer DEFAULT true
	)`,

	`CREATE TABLE IF NOT EXISTS "seasons" (
		"id" text PRIMARY KEY NOT NULL,
		"series_id" text NOT NULL REFERENCES "series"("id") ON DELETE CASCADE,
		"season_number" integer NOT NULL,
		"monitored" integer DEFAULT true,
		"name" text,
		"overview" text,
		"poster_path" text,
		"air_date" text,
		"episode_count" integer DEFAULT 0,
		"episode_file_count" integer DEFAULT 0
	)`,

	`CREATE TABLE IF NOT EXISTS "episodes" (
		"id" text PRIMARY KEY NOT NULL,
		"series_id" text NOT NULL REFERENCES "series"("id") ON DELETE CASCADE,
		"season_id" text REFERENCES "seasons"("id") ON DELETE SET NULL,
		"tmdb_id" integer,
		"tvdb_id" integer,
		"season_number" integer NOT NULL,
		"episode_number" integer NOT NULL,
		"absolute_episode_number" integer,
		"title" text,
		"overview" text,
		"air_date" text,
		"runtime" integer,
		"monitored" integer DEFAULT true,
		"has_file" integer DEFAULT false,
		"wants_subtitles_override" integer,
		"last_search_time" text
	)`,

	`CREATE TABLE IF NOT EXISTS "episode_files" (
		"id" text PRIMARY KEY NOT NULL,
		"series_id" text NOT NULL REFERENCES "series"("id") ON DELETE CASCADE,
		"season_number" integer NOT NULL,
		"episode_ids" text,
		"relative_path" text NOT NULL,
		"size" integer,
		"date_added" text,
		"scene_name" text,
		"release_group" text,
		"release_type" text,
		"quality" text,
		"media_info" text,
		"languages" text
	)`,

	`CREATE TABLE IF NOT EXISTS "unmatched_files" (
		"id" text PRIMARY KEY NOT NULL,
		"path" text NOT NULL UNIQUE,
		"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE CASCADE,
		"media_type" text NOT NULL,
		"size" integer,
		"parsed_title" text,
		"parsed_year" integer,
		"parsed_season" integer,
		"parsed_episode" integer,
		"suggested_matches" text,
		"reason" text,
		"discovered_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "library_scan_history" (
		"id" text PRIMARY KEY NOT NULL,
		"scan_type" text NOT NULL,
		"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
		"status" text NOT NULL,
		"started_at" text,
		"completed_at" text,
		"files_scanned" integer DEFAULT 0,
		"files_added" integer DEFAULT 0,
		"files_updated" integer DEFAULT 0,
		"files_removed" integer DEFAULT 0,
		"unmatched_files" integer DEFAULT 0,
		"error_message" text
	)`,

	`CREATE TABLE IF NOT EXISTS "download_queue" (
		"id" text PRIMARY KEY NOT NULL,
		"download_client_id" text NOT NULL REFERENCES "download_clients"("id") ON DELETE CASCADE,
		"download_id" text NOT NULL,
		"info_hash" text,
		"title" text NOT NULL,
		"indexer_id" text,
		"indexer_name" text,
		"download_url" text,
		"magnet_url" text,
		"protocol" text DEFAULT 'torrent' NOT NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE SET NULL,
		"series_id" text REFERENCES "series"("id") ON DELETE SET NULL,
		"episode_ids" text,
		"season_number" integer,
		"status" text DEFAULT 'queued' NOT NULL,
		"progress" text DEFAULT '0',
		"size" integer,
		"download_speed" integer DEFAULT 0,
		"upload_speed" integer DEFAULT 0,
		"eta" integer,
		"ratio" text DEFAULT '0',
		"client_download_path" text,
		"output_path" text,
		"imported_path" text,
		"quality" text,
		"added_at" text,
		"started_at" text,
		"completed_at" text,
		"imported_at" text,
		"error_message" text,
		"import_attempts" integer DEFAULT 0,
		"last_attempt_at" text,
		"is_automatic" integer DEFAULT false,
		"is_upgrade" integer DEFAULT false
	)`,

	`CREATE TABLE IF NOT EXISTS "download_history" (
		"id" text PRIMARY KEY NOT NULL,
		"download_client_id" text,
		"download_client_name" text,
		"download_id" text,
		"title" text NOT NULL,
		"indexer_id" text,
		"indexer_name" text,
		"protocol" text,
		"movie_id" text REFERENCES "movies"("id") ON DELETE SET NULL,
		"series_id" text REFERENCES "series"("id") ON DELETE SET NULL,
		"episode_ids" text,
		"season_number" integer,
		"status" text NOT NULL,
		"status_reason" text,
		"size" integer,
		"download_time_seconds" integer,
		"final_ratio" text,
		"quality" text,
		"imported_path" text,
		"movie_file_id" text REFERENCES "movie_files"("id") ON DELETE SET NULL,
		"episode_file_ids" text,
		"grabbed_at" text,
		"completed_at" text,
		"imported_at" text,
		"created_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "blocklist" (
		"id" text PRIMARY KEY NOT NULL,
		"title" text NOT NULL,
		"info_hash" text,
		"indexer_id" text REFERENCES "indexers"("id") ON DELETE SET NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
		"episode_ids" text,
		"reason" text NOT NULL,
		"message" text,
		"source_title" text,
		"quality" text,
		"size" integer,
		"protocol" text,
		"created_at" text,
		"expires_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "pending_releases" (
		"id" text PRIMARY KEY NOT NULL,
		"title" text NOT NULL,
		"info_hash" text,
		"indexer_id" text REFERENCES "indexers"("id") ON DELETE SET NULL,
		"download_url" text,
		"magnet_url" text,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
		"episode_ids" text,
		"score" integer NOT NULL,
		"size" integer,
		"protocol" text NOT NULL,
		"quality" text,
		"delay_profile_id" text REFERENCES "delay_profiles"("id") ON DELETE SET NULL,
		"added_at" text,
		"process_at" text NOT NULL,
		"status" text DEFAULT 'pending' NOT NULL,
		"superseded_by" text
	)`,

	`CREATE TABLE IF NOT EXISTS "monitoring_history" (
		"id" text PRIMARY KEY NOT NULL,
		"task_history_id" text REFERENCES "task_history"("id") ON DELETE CASCADE,
		"task_type" text NOT NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
		"season_number" integer,
		"episode_id" text REFERENCES "episodes"("id") ON DELETE CASCADE,
		"status" text NOT NULL,
		"releases_found" integer DEFAULT 0,
		"release_grabbed" text,
		"queue_item_id" text,
		"is_upgrade" integer DEFAULT false,
		"old_score" integer,
		"new_score" integer,
		"executed_at" text,
		"error_message" text
	)`,

	`CREATE TABLE IF NOT EXISTS "subtitles" (
		"id" text PRIMARY KEY NOT NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"episode_id" text REFERENCES "episodes"("id") ON DELETE CASCADE,
		"relative_path" text NOT NULL,
		"language" text NOT NULL,
		"is_forced" integer DEFAULT false,
		"is_hearing_impaired" integer DEFAULT false,
		"format" text NOT NULL,
		"provider_id" text REFERENCES "subtitle_providers"("id") ON DELETE SET NULL,
		"provider_subtitle_id" text,
		"match_score" integer,
		"is_hash_match" integer DEFAULT false,
		"size" integer,
		"sync_offset" integer DEFAULT 0,
		"was_synced" integer DEFAULT false,
		"date_added" text
	)`,

	`CREATE TABLE IF NOT EXISTS "subtitle_history" (
		"id" text PRIMARY KEY NOT NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE SET NULL,
		"episode_id" text REFERENCES "episodes"("id") ON DELETE SET NULL,
		"action" text NOT NULL,
		"language" text NOT NULL,
		"provider_id" text,
		"provider_name" text,
		"provider_subtitle_id" text,
		"match_score" integer,
		"was_hash_match" integer DEFAULT false,
		"replaced_subtitle_id" text,
		"error_message" text,
		"created_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "subtitle_blacklist" (
		"id" text PRIMARY KEY NOT NULL,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"episode_id" text REFERENCES "episodes"("id") ON DELETE CASCADE,
		"provider_id" text REFERENCES "subtitle_providers"("id") ON DELETE CASCADE,
		"provider_subtitle_id" text NOT NULL,
		"reason" text,
		"language" text NOT NULL,
		"created_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "smart_lists" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"description" text,
		"media_type" text NOT NULL CHECK ("media_type" IN ('movie', 'tv')),
		"enabled" integer DEFAULT true,
		"filters" text NOT NULL,
		"sort_by" text DEFAULT 'popularity.desc',
		"item_limit" integer DEFAULT 100 NOT NULL,
		"exclude_in_library" integer DEFAULT true,
		"show_upgradeable_only" integer DEFAULT false,
		"excluded_tmdb_ids" text DEFAULT '[]',
		"scoring_profile_id" text REFERENCES "scoring_profiles"("id") ON DELETE SET NULL,
		"auto_add_behavior" text DEFAULT 'disabled' CHECK ("auto_add_behavior" IN ('disabled', 'add_only', 'add_and_search')),
		"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
		"auto_add_monitored" integer DEFAULT true,
		"minimum_availability" text DEFAULT 'released',
		"wants_subtitles" integer DEFAULT true,
		"language_profile_id" text,
		"refresh_interval_hours" integer DEFAULT 24 NOT NULL,
		"last_refresh_time" text,
		"last_refresh_status" text,
		"last_refresh_error" text,
		"next_refresh_time" text,
		"cached_item_count" integer DEFAULT 0,
		"items_in_library" integer DEFAULT 0,
		"items_auto_added" integer DEFAULT 0,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "smart_list_items" (
		"id" text PRIMARY KEY NOT NULL,
		"smart_list_id" text NOT NULL REFERENCES "smart_lists"("id") ON DELETE CASCADE,
		"media_type" text NOT NULL CHECK ("media_type" IN ('movie', 'tv')),
		"tmdb_id" integer NOT NULL,
		"title" text NOT NULL,
		"original_title" text,
		"overview" text,
		"poster_path" text,
		"backdrop_path" text,
		"release_date" text,
		"year" integer,
		"vote_average" text,
		"vote_count" integer,
		"popularity" text,
		"genre_ids" text,
		"original_language" text,
		"movie_id" text REFERENCES "movies"("id") ON DELETE SET NULL,
		"series_id" text REFERENCES "series"("id") ON DELETE SET NULL,
		"in_library" integer DEFAULT false,
		"was_auto_added" integer DEFAULT false,
		"auto_added_at" text,
		"position" integer NOT NULL,
		"is_excluded" integer DEFAULT false,
		"excluded_at" text,
		"first_seen_at" text,
		"last_seen_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "smart_list_refresh_history" (
		"id" text PRIMARY KEY NOT NULL,
		"smart_list_id" text NOT NULL REFERENCES "smart_lists"("id") ON DELETE CASCADE,
		"refresh_type" text NOT NULL CHECK ("refresh_type" IN ('automatic', 'manual')),
		"status" text NOT NULL CHECK ("status" IN ('running', 'success', 'partial', 'failed')),
		"items_found" integer DEFAULT 0,
		"items_new" integer DEFAULT 0,
		"items_removed" integer DEFAULT 0,
		"items_auto_added" integer DEFAULT 0,
		"items_failed" integer DEFAULT 0,
		"failure_details" text,
		"started_at" text,
		"completed_at" text,
		"duration_ms" integer,
		"error_message" text
	)`,

	// Streaming cache
	`CREATE TABLE IF NOT EXISTS "stream_extraction_cache" (
		"id" text PRIMARY KEY NOT NULL,
		"tmdb_id" integer NOT NULL,
		"media_type" text NOT NULL CHECK ("media_type" IN ('movie', 'tv')),
		"season_number" integer,
		"episode_number" integer,
		"extraction_result" text,
		"provider" text,
		"cached_at" text,
		"expires_at" text NOT NULL,
		"hit_count" integer DEFAULT 0,
		"last_access_at" text
	)`,

	// NZB Streaming tables
	`CREATE TABLE IF NOT EXISTS "nntp_servers" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"host" text NOT NULL,
		"port" integer NOT NULL DEFAULT 563,
		"use_ssl" integer DEFAULT true,
		"username" text,
		"password" text,
		"max_connections" integer DEFAULT 10,
		"priority" integer DEFAULT 1,
		"enabled" integer DEFAULT true,
		"download_client_id" text REFERENCES "download_clients"("id") ON DELETE SET NULL,
		"auto_fetched" integer DEFAULT false,
		"last_tested_at" text,
		"test_result" text,
		"test_error" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "nzb_stream_mounts" (
		"id" text PRIMARY KEY NOT NULL,
		"nzb_hash" text NOT NULL UNIQUE,
		"title" text NOT NULL,
		"indexer_id" text REFERENCES "indexers"("id") ON DELETE SET NULL,
		"release_guid" text,
		"download_url" text,
		"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
		"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
		"season_number" integer,
		"episode_ids" text,
		"file_count" integer NOT NULL,
		"total_size" integer NOT NULL,
		"media_files" text NOT NULL,
		"rar_info" text,
		"password" text,
		"status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'parsing', 'ready', 'requires_extraction', 'downloading', 'extracting', 'error', 'expired')),
		"error_message" text,
		"streamability" text,
		"extracted_file_path" text,
		"extraction_progress" integer,
		"last_accessed_at" text,
		"access_count" integer DEFAULT 0,
		"expires_at" text,
		"created_at" text,
		"updated_at" text
	)`,

	// Live TV tables
	`CREATE TABLE IF NOT EXISTS "stalker_portal_accounts" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"portal_url" text NOT NULL,
		"mac_address" text NOT NULL,
		"enabled" integer DEFAULT true,
		"priority" integer DEFAULT 1,
		"account_info" text,
		"channel_count" integer DEFAULT 0,
		"category_count" integer DEFAULT 0,
		"last_tested_at" text,
		"test_result" text,
		"test_error" text,
		"last_sync_at" text,
		"sync_interval_hours" integer,
		"epg_enabled" integer DEFAULT true,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "channel_categories" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"position" integer NOT NULL,
		"color" text,
		"icon" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "channel_lineup_items" (
		"id" text PRIMARY KEY NOT NULL,
		"account_id" text NOT NULL REFERENCES "stalker_portal_accounts"("id") ON DELETE CASCADE,
		"channel_id" text NOT NULL,
		"position" integer NOT NULL,
		"channel_number" integer,
		"cached_name" text NOT NULL,
		"cached_logo" text,
		"cached_category_id" text,
		"cached_category_name" text,
		"cached_cmd" text,
		"cached_archive" integer,
		"cached_archive_days" integer,
		"cached_xmltv_id" text,
		"sync_status" text DEFAULT 'synced',
		"custom_name" text,
		"custom_logo" text,
		"epg_id" text,
		"category_id" text REFERENCES "channel_categories"("id") ON DELETE SET NULL,
		"added_at" text,
		"updated_at" text,
		UNIQUE("account_id", "channel_id")
	)`,

	// EPG tables
	`CREATE TABLE IF NOT EXISTS "epg_sources" (
		"id" text PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"url" text NOT NULL,
		"enabled" integer DEFAULT true,
		"priority" integer DEFAULT 1,
		"last_fetched_at" text,
		"fetch_interval_hours" integer DEFAULT 6,
		"channel_count" integer DEFAULT 0,
		"status" text DEFAULT 'pending',
		"error_message" text,
		"created_at" text,
		"updated_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "epg_programs" (
		"id" text PRIMARY KEY NOT NULL,
		"channel_xmltv_id" text NOT NULL,
		"epg_source_id" text REFERENCES "epg_sources"("id") ON DELETE CASCADE,
		"account_id" text REFERENCES "stalker_portal_accounts"("id") ON DELETE CASCADE,
		"start_time" text NOT NULL,
		"end_time" text NOT NULL,
		"title" text NOT NULL,
		"description" text,
		"category" text,
		"icon" text,
		"rating" text,
		"episode_number" text,
		"created_at" text
	)`,

	`CREATE TABLE IF NOT EXISTS "live_tv_settings" (
		"key" text PRIMARY KEY NOT NULL,
		"value" text NOT NULL
	)`
];

/**
 * Index definitions for performance
 */
const INDEX_DEFINITIONS: string[] = [
	`CREATE INDEX IF NOT EXISTS "idx_indexer_definitions_protocol" ON "indexer_definitions" ("protocol")`,
	`CREATE INDEX IF NOT EXISTS "idx_indexer_definitions_type" ON "indexer_definitions" ("type")`,
	`CREATE INDEX IF NOT EXISTS "idx_indexers_definition" ON "indexers" ("definition_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_indexers_enabled" ON "indexers" ("enabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_indexer_status_health" ON "indexer_status" ("health", "is_disabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_movies_monitored_hasfile" ON "movies" ("monitored", "has_file")`,
	`CREATE INDEX IF NOT EXISTS "idx_series_monitored" ON "series" ("monitored")`,
	`CREATE INDEX IF NOT EXISTS "idx_episodes_series_season" ON "episodes" ("series_id", "season_number")`,
	`CREATE INDEX IF NOT EXISTS "idx_episodes_monitored_hasfile" ON "episodes" ("monitored", "has_file")`,
	`CREATE INDEX IF NOT EXISTS "idx_episodes_airdate" ON "episodes" ("air_date")`,
	`CREATE INDEX IF NOT EXISTS "idx_download_queue_status" ON "download_queue" ("status")`,
	`CREATE INDEX IF NOT EXISTS "idx_download_queue_movie" ON "download_queue" ("movie_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_download_queue_series" ON "download_queue" ("series_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_blocklist_movie" ON "blocklist" ("movie_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_blocklist_series" ON "blocklist" ("series_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_blocklist_infohash" ON "blocklist" ("info_hash")`,
	`CREATE INDEX IF NOT EXISTS "idx_monitoring_history_task_history" ON "monitoring_history" ("task_history_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_monitoring_history_movie" ON "monitoring_history" ("movie_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_monitoring_history_series" ON "monitoring_history" ("series_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_monitoring_history_episode" ON "monitoring_history" ("episode_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_subtitles_movie" ON "subtitles" ("movie_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_subtitles_episode" ON "subtitles" ("episode_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_lists_enabled" ON "smart_lists" ("enabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_lists_next_refresh" ON "smart_lists" ("next_refresh_time")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_lists_media_type" ON "smart_lists" ("media_type")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_items_list" ON "smart_list_items" ("smart_list_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_items_tmdb" ON "smart_list_items" ("tmdb_id", "media_type")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_items_in_library" ON "smart_list_items" ("in_library")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_items_position" ON "smart_list_items" ("smart_list_id", "position")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_refresh_history_list" ON "smart_list_refresh_history" ("smart_list_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_smart_list_refresh_history_status" ON "smart_list_refresh_history" ("status")`,
	// Stream extraction cache indexes
	`CREATE INDEX IF NOT EXISTS "idx_stream_cache_tmdb" ON "stream_extraction_cache" ("tmdb_id", "media_type")`,
	`CREATE INDEX IF NOT EXISTS "idx_stream_cache_expires" ON "stream_extraction_cache" ("expires_at")`,
	`CREATE INDEX IF NOT EXISTS "idx_stream_cache_hit_count" ON "stream_extraction_cache" ("hit_count")`,
	// NZB streaming indexes
	`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_enabled" ON "nntp_servers" ("enabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_priority" ON "nntp_servers" ("priority")`,
	`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_download_client" ON "nntp_servers" ("download_client_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_status" ON "nzb_stream_mounts" ("status")`,
	`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_movie" ON "nzb_stream_mounts" ("movie_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_series" ON "nzb_stream_mounts" ("series_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_expires" ON "nzb_stream_mounts" ("expires_at")`,
	`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_hash" ON "nzb_stream_mounts" ("nzb_hash")`,
	// Live TV indexes
	`CREATE INDEX IF NOT EXISTS "idx_stalker_accounts_enabled" ON "stalker_portal_accounts" ("enabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_stalker_accounts_priority" ON "stalker_portal_accounts" ("priority")`,
	// Channel categories indexes
	`CREATE INDEX IF NOT EXISTS "idx_channel_categories_position" ON "channel_categories" ("position")`,
	// Channel lineup indexes
	`CREATE UNIQUE INDEX IF NOT EXISTS "idx_lineup_account_channel" ON "channel_lineup_items" ("account_id", "channel_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_lineup_position" ON "channel_lineup_items" ("position")`,
	`CREATE INDEX IF NOT EXISTS "idx_lineup_account" ON "channel_lineup_items" ("account_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_lineup_category" ON "channel_lineup_items" ("category_id")`,
	// EPG indexes
	`CREATE INDEX IF NOT EXISTS "idx_epg_sources_enabled" ON "epg_sources" ("enabled")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_sources_priority" ON "epg_sources" ("priority")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_programs_channel" ON "epg_programs" ("channel_xmltv_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_programs_source" ON "epg_programs" ("epg_source_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_programs_account" ON "epg_programs" ("account_id")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_programs_time" ON "epg_programs" ("start_time", "end_time")`,
	`CREATE INDEX IF NOT EXISTS "idx_epg_programs_channel_time" ON "epg_programs" ("channel_xmltv_id", "start_time")`
];

/**
 * Schema updates keyed by version number
 * Each function runs when upgrading TO that version
 *
 * Example for future updates:
 * 2: (sqlite) => {
 *   sqlite.prepare(`ALTER TABLE movies ADD COLUMN new_field TEXT`).run();
 * }
 */
const SCHEMA_UPDATES: Record<number, (sqlite: Database.Database) => void> = {
	// Version 1 is the initial schema - handled by TABLE_DEFINITIONS
	// Version 2: Add missing tables that were defined in schema.ts but not in schema-sync.ts
	2: (sqlite) => {
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "profile_size_limits" (
			"profile_id" text PRIMARY KEY NOT NULL,
			"movie_min_size_gb" real,
			"movie_max_size_gb" real,
			"episode_min_size_mb" real,
			"episode_max_size_mb" real,
			"is_default" integer DEFAULT false,
			"updated_at" text
		)`
			)
			.run();

		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "custom_formats" (
			"id" text PRIMARY KEY NOT NULL,
			"name" text NOT NULL,
			"description" text,
			"category" text NOT NULL DEFAULT 'other',
			"tags" text,
			"conditions" text,
			"enabled" integer DEFAULT true,
			"created_at" text,
			"updated_at" text
		)`
			)
			.run();

		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "naming_presets" (
			"id" text PRIMARY KEY NOT NULL,
			"name" text NOT NULL,
			"description" text,
			"config" text NOT NULL,
			"is_built_in" integer DEFAULT false,
			"created_at" integer
		)`
			)
			.run();
	},

	// Version 3: Add read_only column to root_folders for virtual mount support (NZBDav)
	3: (sqlite) => {
		// Only add column if it doesn't exist (may already exist from fresh TABLE_DEFINITIONS)
		if (!columnExists(sqlite, 'root_folders', 'read_only')) {
			sqlite.prepare(`ALTER TABLE root_folders ADD COLUMN read_only INTEGER DEFAULT 0`).run();
		}
	},

	// Version 4: Fix invalid scoring profile references and ensure default profile exists
	4: (sqlite) => {
		// Ensure a default profile exists (set 'compact' as default if none)
		const hasDefault = sqlite.prepare(`SELECT id FROM scoring_profiles WHERE is_default = 1`).get();

		if (!hasDefault) {
			const validProfiles = sqlite.prepare(`SELECT id FROM scoring_profiles`).all() as {
				id: string;
			}[];
			const validIds = new Set(validProfiles.map((p) => p.id));

			if (validProfiles.length > 0) {
				const defaultId = validIds.has('compact') ? 'compact' : validProfiles[0].id;
				sqlite.prepare(`UPDATE scoring_profiles SET is_default = 1 WHERE id = ?`).run(defaultId);
				logger.info(`[SchemaSync] Set default scoring profile to '${defaultId}'`);
			}
		}

		// Clear invalid profile references (set to NULL so user can choose)
		// This prevents auto-downloads with unwanted profiles
		const invalidMovies = sqlite
			.prepare(
				`UPDATE movies SET scoring_profile_id = NULL
				 WHERE scoring_profile_id IS NOT NULL
				 AND scoring_profile_id != ''
				 AND scoring_profile_id NOT IN (SELECT id FROM scoring_profiles)`
			)
			.run();

		if (invalidMovies.changes > 0) {
			logger.info(
				`[SchemaSync] Cleared ${invalidMovies.changes} movies with invalid profile references`
			);
		}

		const invalidSeries = sqlite
			.prepare(
				`UPDATE series SET scoring_profile_id = NULL
				 WHERE scoring_profile_id IS NOT NULL
				 AND scoring_profile_id != ''
				 AND scoring_profile_id NOT IN (SELECT id FROM scoring_profiles)`
			)
			.run();

		if (invalidSeries.changes > 0) {
			logger.info(
				`[SchemaSync] Cleared ${invalidSeries.changes} series with invalid profile references`
			);
		}
	},

	// Version 5: Add preserve_symlinks column to root_folders for NZBDav/rclone symlink preservation
	5: (sqlite) => {
		// Only add column if it doesn't exist (may already exist from fresh TABLE_DEFINITIONS)
		if (!columnExists(sqlite, 'root_folders', 'preserve_symlinks')) {
			sqlite
				.prepare(`ALTER TABLE root_folders ADD COLUMN preserve_symlinks INTEGER DEFAULT 0`)
				.run();
			logger.info('[SchemaSync] Added preserve_symlinks column to root_folders');
		}
	},

	// Version 6: Add NZB streaming tables
	6: (sqlite) => {
		// Create NNTP servers table
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "nntp_servers" (
					"id" text PRIMARY KEY NOT NULL,
					"name" text NOT NULL,
					"host" text NOT NULL,
					"port" integer NOT NULL DEFAULT 563,
					"use_ssl" integer DEFAULT true,
					"username" text,
					"password" text,
					"max_connections" integer DEFAULT 10,
					"priority" integer DEFAULT 1,
					"enabled" integer DEFAULT true,
					"download_client_id" text REFERENCES "download_clients"("id") ON DELETE SET NULL,
					"auto_fetched" integer DEFAULT false,
					"last_tested_at" text,
					"test_result" text,
					"test_error" text,
					"created_at" text,
					"updated_at" text
				)`
			)
			.run();

		// Create NZB stream mounts table
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "nzb_stream_mounts" (
					"id" text PRIMARY KEY NOT NULL,
					"nzb_hash" text NOT NULL UNIQUE,
					"title" text NOT NULL,
					"indexer_id" text REFERENCES "indexers"("id") ON DELETE SET NULL,
					"release_guid" text,
					"download_url" text,
					"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
					"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
					"season_number" integer,
					"episode_ids" text,
					"file_count" integer NOT NULL,
					"total_size" integer NOT NULL,
					"media_files" text NOT NULL,
					"rar_info" text,
					"password" text,
					"status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'parsing', 'ready', 'requires_extraction', 'downloading', 'extracting', 'error', 'expired')),
					"error_message" text,
					"last_accessed_at" text,
					"access_count" integer DEFAULT 0,
					"expires_at" text,
					"created_at" text,
					"updated_at" text
				)`
			)
			.run();

		// Create indexes
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_enabled" ON "nntp_servers" ("enabled")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_priority" ON "nntp_servers" ("priority")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nntp_servers_download_client" ON "nntp_servers" ("download_client_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_status" ON "nzb_stream_mounts" ("status")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_movie" ON "nzb_stream_mounts" ("movie_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_series" ON "nzb_stream_mounts" ("series_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_expires" ON "nzb_stream_mounts" ("expires_at")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_hash" ON "nzb_stream_mounts" ("nzb_hash")`
			)
			.run();

		logger.info('[SchemaSync] Created NZB streaming tables (nntp_servers, nzb_stream_mounts)');
	},

	// Version 7: Add streamability and extraction columns for compressed archive support
	7: (sqlite) => {
		// Add new columns to nzb_stream_mounts (only if they don't exist)
		if (!columnExists(sqlite, 'nzb_stream_mounts', 'streamability')) {
			sqlite.prepare(`ALTER TABLE "nzb_stream_mounts" ADD COLUMN "streamability" text`).run();
		}
		if (!columnExists(sqlite, 'nzb_stream_mounts', 'extracted_file_path')) {
			sqlite.prepare(`ALTER TABLE "nzb_stream_mounts" ADD COLUMN "extracted_file_path" text`).run();
		}
		if (!columnExists(sqlite, 'nzb_stream_mounts', 'extraction_progress')) {
			sqlite
				.prepare(`ALTER TABLE "nzb_stream_mounts" ADD COLUMN "extraction_progress" integer`)
				.run();
		}

		logger.info('[SchemaSync] Added streamability and extraction columns to nzb_stream_mounts');
	},

	// Version 8: Fix nzb_stream_mounts status CHECK constraint to include extraction states
	8: (sqlite) => {
		// SQLite doesn't support ALTER TABLE to modify CHECK constraints
		// Need to recreate the table with the correct constraint

		// Create new table with correct CHECK constraint
		sqlite
			.prepare(
				`CREATE TABLE "nzb_stream_mounts_new" (
				"id" text PRIMARY KEY NOT NULL,
				"nzb_hash" text NOT NULL UNIQUE,
				"title" text NOT NULL,
				"indexer_id" text REFERENCES "indexers"("id") ON DELETE SET NULL,
				"release_guid" text,
				"download_url" text,
				"movie_id" text REFERENCES "movies"("id") ON DELETE CASCADE,
				"series_id" text REFERENCES "series"("id") ON DELETE CASCADE,
				"season_number" integer,
				"episode_ids" text,
				"file_count" integer NOT NULL,
				"total_size" integer NOT NULL,
				"media_files" text NOT NULL,
				"rar_info" text,
				"password" text,
				"status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'parsing', 'ready', 'requires_extraction', 'downloading', 'extracting', 'error', 'expired')),
				"error_message" text,
				"streamability" text,
				"extracted_file_path" text,
				"extraction_progress" integer,
				"last_accessed_at" text,
				"access_count" integer DEFAULT 0,
				"expires_at" text,
				"created_at" text,
				"updated_at" text
			)`
			)
			.run();

		// Copy data from old table
		sqlite
			.prepare(
				`INSERT INTO "nzb_stream_mounts_new" SELECT
				id, nzb_hash, title, indexer_id, release_guid, download_url,
				movie_id, series_id, season_number, episode_ids,
				file_count, total_size, media_files, rar_info, password,
				status, error_message, streamability, extracted_file_path, extraction_progress,
				last_accessed_at, access_count, expires_at, created_at, updated_at
			FROM "nzb_stream_mounts"`
			)
			.run();

		// Drop old table
		sqlite.prepare(`DROP TABLE "nzb_stream_mounts"`).run();

		// Rename new table
		sqlite.prepare(`ALTER TABLE "nzb_stream_mounts_new" RENAME TO "nzb_stream_mounts"`).run();

		// Recreate indexes
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_status" ON "nzb_stream_mounts" ("status")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_movie" ON "nzb_stream_mounts" ("movie_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_series" ON "nzb_stream_mounts" ("series_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_expires" ON "nzb_stream_mounts" ("expires_at")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_nzb_mounts_hash" ON "nzb_stream_mounts" ("nzb_hash")`
			)
			.run();

		logger.info(
			'[SchemaSync] Fixed nzb_stream_mounts status CHECK constraint to include extraction states'
		);
	},

	// Version 9: Remove deprecated qualityPresets system in favor of scoringProfiles
	9: (sqlite) => {
		// Step 1: Ensure default scoring profile exists
		const hasDefault = sqlite.prepare(`SELECT id FROM scoring_profiles WHERE is_default = 1`).get();
		let defaultProfileId = 'balanced';

		if (!hasDefault) {
			const validProfiles = sqlite.prepare(`SELECT id FROM scoring_profiles`).all() as {
				id: string;
			}[];
			if (validProfiles.length > 0) {
				const validIds = new Set(validProfiles.map((p) => p.id));
				defaultProfileId = validIds.has('balanced') ? 'balanced' : validProfiles[0].id;
				sqlite
					.prepare(`UPDATE scoring_profiles SET is_default = 1 WHERE id = ?`)
					.run(defaultProfileId);
			}
		} else {
			defaultProfileId = (hasDefault as { id: string }).id;
		}

		// Step 2: Migrate movies with quality_preset_id but no scoring_profile_id
		if (columnExists(sqlite, 'movies', 'quality_preset_id')) {
			const migratedMovies = sqlite
				.prepare(
					`UPDATE movies SET scoring_profile_id = ?
					 WHERE (scoring_profile_id IS NULL OR scoring_profile_id = '')
					 AND quality_preset_id IS NOT NULL`
				)
				.run(defaultProfileId);

			if (migratedMovies.changes > 0) {
				logger.info(
					`[SchemaSync] Migrated ${migratedMovies.changes} movies from qualityPresets to scoringProfiles`
				);
			}
		}

		// Step 3: Migrate series with quality_preset_id but no scoring_profile_id
		if (columnExists(sqlite, 'series', 'quality_preset_id')) {
			const migratedSeries = sqlite
				.prepare(
					`UPDATE series SET scoring_profile_id = ?
					 WHERE (scoring_profile_id IS NULL OR scoring_profile_id = '')
					 AND quality_preset_id IS NOT NULL`
				)
				.run(defaultProfileId);

			if (migratedSeries.changes > 0) {
				logger.info(
					`[SchemaSync] Migrated ${migratedSeries.changes} series from qualityPresets to scoringProfiles`
				);
			}
		}

		// Step 4: Drop quality_preset_id column from movies (requires table recreation)
		if (columnExists(sqlite, 'movies', 'quality_preset_id')) {
			sqlite
				.prepare(
					`CREATE TABLE "movies_new" (
					"id" text PRIMARY KEY NOT NULL,
					"tmdb_id" integer NOT NULL UNIQUE,
					"imdb_id" text,
					"title" text NOT NULL,
					"original_title" text,
					"year" integer,
					"overview" text,
					"poster_path" text,
					"backdrop_path" text,
					"runtime" integer,
					"genres" text,
					"path" text NOT NULL,
					"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
					"scoring_profile_id" text REFERENCES "scoring_profiles"("id") ON DELETE SET NULL,
					"language_profile_id" text,
					"monitored" integer DEFAULT true,
					"minimum_availability" text DEFAULT 'released',
					"added" text,
					"has_file" integer DEFAULT false,
					"wants_subtitles" integer DEFAULT true,
					"last_search_time" text
				)`
				)
				.run();

			sqlite
				.prepare(
					`INSERT INTO "movies_new" SELECT
					id, tmdb_id, imdb_id, title, original_title, year, overview,
					poster_path, backdrop_path, runtime, genres, path, root_folder_id,
					scoring_profile_id, language_profile_id, monitored, minimum_availability,
					added, has_file, wants_subtitles, last_search_time
				FROM "movies"`
				)
				.run();

			sqlite.prepare(`DROP TABLE "movies"`).run();
			sqlite.prepare(`ALTER TABLE "movies_new" RENAME TO "movies"`).run();

			// Recreate indexes
			sqlite
				.prepare(
					`CREATE INDEX IF NOT EXISTS "idx_movies_monitored_hasfile" ON "movies" ("monitored", "has_file")`
				)
				.run();
		}

		// Step 5: Drop quality_preset_id column from series (requires table recreation)
		if (columnExists(sqlite, 'series', 'quality_preset_id')) {
			sqlite
				.prepare(
					`CREATE TABLE "series_new" (
					"id" text PRIMARY KEY NOT NULL,
					"tmdb_id" integer NOT NULL UNIQUE,
					"tvdb_id" integer,
					"imdb_id" text,
					"title" text NOT NULL,
					"original_title" text,
					"year" integer,
					"overview" text,
					"poster_path" text,
					"backdrop_path" text,
					"status" text,
					"network" text,
					"genres" text,
					"path" text NOT NULL,
					"root_folder_id" text REFERENCES "root_folders"("id") ON DELETE SET NULL,
					"scoring_profile_id" text REFERENCES "scoring_profiles"("id") ON DELETE SET NULL,
					"language_profile_id" text,
					"monitored" integer DEFAULT true,
					"monitor_new_items" text DEFAULT 'all',
					"monitor_specials" integer DEFAULT false,
					"season_folder" integer DEFAULT true,
					"series_type" text DEFAULT 'standard',
					"added" text,
					"episode_count" integer DEFAULT 0,
					"episode_file_count" integer DEFAULT 0,
					"wants_subtitles" integer DEFAULT true
				)`
				)
				.run();

			sqlite
				.prepare(
					`INSERT INTO "series_new" SELECT
					id, tmdb_id, tvdb_id, imdb_id, title, original_title, year, overview,
					poster_path, backdrop_path, status, network, genres, path, root_folder_id,
					scoring_profile_id, language_profile_id, monitored, monitor_new_items,
					monitor_specials, season_folder, series_type, added, episode_count,
					episode_file_count, wants_subtitles
				FROM "series"`
				)
				.run();

			sqlite.prepare(`DROP TABLE "series"`).run();
			sqlite.prepare(`ALTER TABLE "series_new" RENAME TO "series"`).run();

			// Recreate indexes
			sqlite
				.prepare(`CREATE INDEX IF NOT EXISTS "idx_series_monitored" ON "series" ("monitored")`)
				.run();
		}

		// Step 6: Drop quality_presets table
		if (tableExists(sqlite, 'quality_presets')) {
			sqlite.prepare(`DROP TABLE "quality_presets"`).run();
			logger.info('[SchemaSync] Dropped deprecated quality_presets table');
		}

		logger.info(
			'[SchemaSync] Completed migration from qualityPresets to scoringProfiles (Version 9)'
		);
	},

	// Version 10: Flag series with broken episode metadata for automatic repair
	10: (sqlite) => {
		logger.info('[SchemaSync] Checking for series with broken episode metadata...');

		// Find series that have episode_files but no episodes in the database
		// These series were created through the unmatched endpoint bug
		const brokenSeries = sqlite
			.prepare(
				`
				SELECT DISTINCT s.id, s.tmdb_id, s.title
				FROM series s
				INNER JOIN episode_files ef ON ef.series_id = s.id
				WHERE s.episode_count = 0 OR NOT EXISTS (
					SELECT 1 FROM episodes e WHERE e.series_id = s.id
				)
			`
			)
			.all() as Array<{ id: string; tmdb_id: number; title: string }>;

		if (brokenSeries.length === 0) {
			logger.info('[SchemaSync] No series need episode metadata repair');
			return;
		}

		logger.info('[SchemaSync] Found series needing episode metadata repair', {
			count: brokenSeries.length,
			series: brokenSeries.map((s) => s.title)
		});

		// Flag each series for repair by the DataRepairService on startup
		// We use settings table since TMDB API calls need to be async
		for (const series of brokenSeries) {
			sqlite
				.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
				.run(
					`repair_series_${series.id}`,
					JSON.stringify({ tmdbId: series.tmdb_id, title: series.title })
				);
		}

		logger.info('[SchemaSync] Queued series for metadata repair on next startup', {
			count: brokenSeries.length
		});
	},

	// Version 11: Add stalker_portal_accounts table for Live TV IPTV support
	11: (sqlite) => {
		// Create the stalker portal accounts table for IPTV support
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "stalker_portal_accounts" (
					"id" text PRIMARY KEY NOT NULL,
					"name" text NOT NULL,
					"portal_url" text NOT NULL,
					"mac_address" text NOT NULL,
					"enabled" integer DEFAULT true,
					"priority" integer DEFAULT 1,
					"account_info" text,
					"channel_count" integer DEFAULT 0,
					"category_count" integer DEFAULT 0,
					"last_tested_at" text,
					"test_result" text,
					"test_error" text,
					"created_at" text,
					"updated_at" text
				)`
			)
			.run();

		// Create indexes
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_stalker_accounts_enabled" ON "stalker_portal_accounts" ("enabled")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_stalker_accounts_priority" ON "stalker_portal_accounts" ("priority")`
			)
			.run();

		logger.info('[SchemaSync] Added stalker_portal_accounts table for Live TV');
	},

	// Version 12: Add channel_lineup_items table for custom Live TV channel lineup
	12: (sqlite) => {
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "channel_lineup_items" (
					"id" text PRIMARY KEY NOT NULL,
					"account_id" text NOT NULL REFERENCES "stalker_portal_accounts"("id") ON DELETE CASCADE,
					"channel_id" text NOT NULL,
					"position" integer NOT NULL,
					"channel_number" integer,
					"cached_name" text NOT NULL,
					"cached_logo" text,
					"cached_category_id" text,
					"cached_category_name" text,
					"added_at" text,
					"updated_at" text,
					UNIQUE("account_id", "channel_id")
				)`
			)
			.run();

		// Create indexes
		sqlite
			.prepare(
				`CREATE UNIQUE INDEX IF NOT EXISTS "idx_lineup_account_channel" ON "channel_lineup_items" ("account_id", "channel_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_lineup_position" ON "channel_lineup_items" ("position")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_lineup_account" ON "channel_lineup_items" ("account_id")`
			)
			.run();

		logger.info('[SchemaSync] Added channel_lineup_items table for custom Live TV lineup');
	},

	// Version 13: Add channel_categories table and extend channel_lineup_items with customization fields
	13: (sqlite) => {
		// Create channel_categories table
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "channel_categories" (
					"id" text PRIMARY KEY NOT NULL,
					"name" text NOT NULL,
					"position" integer NOT NULL,
					"color" text,
					"icon" text,
					"created_at" text,
					"updated_at" text
				)`
			)
			.run();

		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_channel_categories_position" ON "channel_categories" ("position")`
			)
			.run();

		// Add new columns to channel_lineup_items for customization
		if (!columnExists(sqlite, 'channel_lineup_items', 'custom_name')) {
			sqlite.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "custom_name" text`).run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'custom_logo')) {
			sqlite.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "custom_logo" text`).run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'epg_id')) {
			sqlite.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "epg_id" text`).run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'category_id')) {
			sqlite
				.prepare(
					`ALTER TABLE "channel_lineup_items" ADD COLUMN "category_id" text REFERENCES "channel_categories"("id") ON DELETE SET NULL`
				)
				.run();
		}

		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_lineup_category" ON "channel_lineup_items" ("category_id")`
			)
			.run();

		logger.info(
			'[SchemaSync] Added channel_categories and extended channel_lineup_items with customization fields'
		);
	},

	// Version 14: Add EPG support - epg_sources, epg_programs tables, extend accounts and lineup items
	14: (sqlite) => {
		// Extend stalker_portal_accounts with sync and EPG settings
		if (!columnExists(sqlite, 'stalker_portal_accounts', 'last_sync_at')) {
			sqlite.prepare(`ALTER TABLE "stalker_portal_accounts" ADD COLUMN "last_sync_at" text`).run();
		}
		if (!columnExists(sqlite, 'stalker_portal_accounts', 'sync_interval_hours')) {
			sqlite
				.prepare(`ALTER TABLE "stalker_portal_accounts" ADD COLUMN "sync_interval_hours" integer`)
				.run();
		}
		if (!columnExists(sqlite, 'stalker_portal_accounts', 'epg_enabled')) {
			sqlite
				.prepare(
					`ALTER TABLE "stalker_portal_accounts" ADD COLUMN "epg_enabled" integer DEFAULT true`
				)
				.run();
		}

		// Extend channel_lineup_items with additional cached provider data
		if (!columnExists(sqlite, 'channel_lineup_items', 'cached_cmd')) {
			sqlite.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "cached_cmd" text`).run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'cached_archive')) {
			sqlite
				.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "cached_archive" integer`)
				.run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'cached_archive_days')) {
			sqlite
				.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "cached_archive_days" integer`)
				.run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'cached_xmltv_id')) {
			sqlite.prepare(`ALTER TABLE "channel_lineup_items" ADD COLUMN "cached_xmltv_id" text`).run();
		}
		if (!columnExists(sqlite, 'channel_lineup_items', 'sync_status')) {
			sqlite
				.prepare(
					`ALTER TABLE "channel_lineup_items" ADD COLUMN "sync_status" text DEFAULT 'synced'`
				)
				.run();
		}

		// Create EPG sources table
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "epg_sources" (
					"id" text PRIMARY KEY NOT NULL,
					"name" text NOT NULL,
					"url" text NOT NULL,
					"enabled" integer DEFAULT true,
					"priority" integer DEFAULT 1,
					"last_fetched_at" text,
					"fetch_interval_hours" integer DEFAULT 6,
					"channel_count" integer DEFAULT 0,
					"status" text DEFAULT 'pending',
					"error_message" text,
					"created_at" text,
					"updated_at" text
				)`
			)
			.run();

		// Create EPG programs table
		sqlite
			.prepare(
				`CREATE TABLE IF NOT EXISTS "epg_programs" (
					"id" text PRIMARY KEY NOT NULL,
					"channel_xmltv_id" text NOT NULL,
					"epg_source_id" text REFERENCES "epg_sources"("id") ON DELETE CASCADE,
					"account_id" text REFERENCES "stalker_portal_accounts"("id") ON DELETE CASCADE,
					"start_time" text NOT NULL,
					"end_time" text NOT NULL,
					"title" text NOT NULL,
					"description" text,
					"category" text,
					"icon" text,
					"rating" text,
					"episode_number" text,
					"created_at" text
				)`
			)
			.run();

		// Create indexes for EPG tables
		sqlite
			.prepare(`CREATE INDEX IF NOT EXISTS "idx_epg_sources_enabled" ON "epg_sources" ("enabled")`)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_sources_priority" ON "epg_sources" ("priority")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_programs_channel" ON "epg_programs" ("channel_xmltv_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_programs_source" ON "epg_programs" ("epg_source_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_programs_account" ON "epg_programs" ("account_id")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_programs_time" ON "epg_programs" ("start_time", "end_time")`
			)
			.run();
		sqlite
			.prepare(
				`CREATE INDEX IF NOT EXISTS "idx_epg_programs_channel_time" ON "epg_programs" ("channel_xmltv_id", "start_time")`
			)
			.run();

		logger.info(
			'[SchemaSync] Added EPG support - epg_sources, epg_programs tables and extended accounts/lineup'
		);
	},

	// Version 15: Add live_tv_settings table for scheduler configuration
	15: (sqlite) => {
		if (!tableExists(sqlite, 'live_tv_settings')) {
			sqlite
				.prepare(
					`CREATE TABLE IF NOT EXISTS "live_tv_settings" (
						"key" text PRIMARY KEY NOT NULL,
						"value" text NOT NULL
					)`
				)
				.run();
		}
		logger.info('[SchemaSync] Added live_tv_settings table for Live TV scheduler');
	},

	// Version 16: Add temp path columns to download_clients for SABnzbd dual folder support
	16: (sqlite) => {
		if (!columnExists(sqlite, 'download_clients', 'temp_path_local')) {
			sqlite.prepare(`ALTER TABLE download_clients ADD COLUMN temp_path_local TEXT`).run();
		}
		if (!columnExists(sqlite, 'download_clients', 'temp_path_remote')) {
			sqlite.prepare(`ALTER TABLE download_clients ADD COLUMN temp_path_remote TEXT`).run();
		}
		logger.info('[SchemaSync] Added temp path columns to download_clients for SABnzbd');
	}
};

/**
 * Get current schema version from database
 */
function getSchemaVersion(sqlite: Database.Database): number {
	try {
		const result = sqlite
			.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`)
			.get() as { value: string } | undefined;
		return result ? parseInt(result.value, 10) : 0;
	} catch {
		// Table doesn't exist yet
		return 0;
	}
}

/**
 * Set schema version in database
 */
function setSchemaVersion(sqlite: Database.Database, version: number): void {
	sqlite
		.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)`)
		.run(version.toString());
}

/**
 * Check if a table exists in the database
 */
function tableExists(sqlite: Database.Database, tableName: string): boolean {
	const result = sqlite
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
		.get(tableName);
	return !!result;
}

/**
 * Check if a column exists in a table
 */
function columnExists(sqlite: Database.Database, tableName: string, columnName: string): boolean {
	const result = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
	return result.some((col) => col.name === columnName);
}

/**
 * Synchronize database schema
 * - Creates missing tables
 * - Runs version-based updates
 * - Sets schema version
 */
export function syncSchema(sqlite: Database.Database): void {
	const currentVersion = getSchemaVersion(sqlite);

	logger.info('[SchemaSync] Starting schema synchronization', {
		currentVersion,
		targetVersion: CURRENT_SCHEMA_VERSION
	});

	// Check if this is an existing database from the migration era
	const hasDrizzleMigrations = tableExists(sqlite, '__drizzle_migrations');
	const _hasSettingsTable = tableExists(sqlite, 'settings');

	if (hasDrizzleMigrations && currentVersion === 0) {
		// This is an existing database that was using migrations
		// All tables should exist, just need to set version
		logger.info('[SchemaSync] Detected existing database from migration era');
	}

	// Create all tables (IF NOT EXISTS makes this safe)
	logger.info('[SchemaSync] Ensuring all tables exist...');
	for (const tableDef of TABLE_DEFINITIONS) {
		try {
			sqlite.prepare(tableDef).run();
		} catch (error) {
			logger.error('[SchemaSync] Failed to create table', {
				error: error instanceof Error ? error.message : String(error),
				sql: tableDef.substring(0, 100) + '...'
			});
			throw error;
		}
	}

	// Create all indexes
	logger.info('[SchemaSync] Creating indexes...');
	for (const indexDef of INDEX_DEFINITIONS) {
		try {
			sqlite.prepare(indexDef).run();
		} catch (error) {
			// Index errors are usually not fatal (might already exist differently)
			logger.warn('[SchemaSync] Index creation warning', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	// Run incremental updates if needed
	if (currentVersion < CURRENT_SCHEMA_VERSION) {
		logger.info('[SchemaSync] Running schema updates...', {
			from: currentVersion,
			to: CURRENT_SCHEMA_VERSION
		});

		for (let v = currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
			const update = SCHEMA_UPDATES[v];
			if (update) {
				logger.info(`[SchemaSync] Applying update to version ${v}`);
				try {
					update(sqlite);
				} catch (error) {
					logger.error(`[SchemaSync] Failed to apply update ${v}`, {
						error: error instanceof Error ? error.message : String(error)
					});
					throw error;
				}
			}
		}
	}

	// Set the schema version
	setSchemaVersion(sqlite, CURRENT_SCHEMA_VERSION);

	// Clean up old drizzle migrations table if it exists (optional)
	// We keep it for now as it doesn't hurt anything

	logger.info('[SchemaSync] Schema synchronization complete', {
		version: CURRENT_SCHEMA_VERSION
	});
}
