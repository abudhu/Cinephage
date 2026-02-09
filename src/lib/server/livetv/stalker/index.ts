/**
 * Stalker Portal Module
 *
 * Exports for Stalker/Ministra protocol IPTV integration.
 * NOTE: This module is now deprecated. Use the unified Live TV module instead.
 */

// Re-export portal-specific functionality (still used for portal scanning)
export { StalkerPortalClient, createStalkerClient } from './StalkerPortalClient';
export { StalkerPortalManager, getStalkerPortalManager } from './StalkerPortalManager';
export type {
	StalkerPortal,
	CreatePortalInput,
	UpdatePortalInput,
	PortalDetectionResult,
	PortalTestResult,
	PortalScanSummary
} from './StalkerPortalManager';
export { MacGenerator, MAC_PREFIXES } from './MacGenerator';
export type { MacPrefix } from './MacGenerator';
export { PortalScannerService, getPortalScannerService } from './PortalScannerService';
export type {
	ScanResult,
	ScanHistoryEntry,
	RandomScanOptions,
	SequentialScanOptions,
	ImportScanOptions
} from './PortalScannerService';

// Re-export unified services for backward compatibility
// These now support all provider types (Stalker, XStream, M3U)
export {
	getLiveTvAccountManager as getStalkerAccountManager,
	LiveTvAccountManager as StalkerAccountManager
} from '../LiveTvAccountManager';
export {
	getLiveTvChannelService as getStalkerChannelService,
	LiveTvChannelService as StalkerChannelService
} from '../LiveTvChannelService';

// Note: StalkerChannelSyncService is now integrated into LiveTvChannelService
// Use channelService.syncChannels(accountId) instead
export {
	getLiveTvChannelService as getStalkerChannelSyncService,
	LiveTvChannelService as StalkerChannelSyncService
} from '../LiveTvChannelService';
