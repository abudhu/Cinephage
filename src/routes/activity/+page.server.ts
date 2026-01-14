import type { PageServerLoad } from './$types';
import type { UnifiedActivity, ActivityFilters } from '$lib/types/activity';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const status = url.searchParams.get('status') || 'all';
	const mediaType = url.searchParams.get('mediaType') || 'all';
	const search = url.searchParams.get('search') || '';

	// Build API URL with query params
	const apiUrl = new URL('/api/activity', url.origin);
	apiUrl.searchParams.set('limit', '50');
	apiUrl.searchParams.set('offset', '0');
	if (status !== 'all') apiUrl.searchParams.set('status', status);
	if (mediaType !== 'all') apiUrl.searchParams.set('mediaType', mediaType);
	if (search) apiUrl.searchParams.set('search', search);

	try {
		const response = await fetch(apiUrl.toString());
		const data = await response.json();

		return {
			activities: data.activities as UnifiedActivity[],
			total: data.total as number,
			hasMore: data.hasMore as boolean,
			filters: {
				status,
				mediaType,
				search
			} as ActivityFilters & { search: string }
		};
	} catch (error) {
		console.error('Failed to load activity:', error);
		return {
			activities: [] as UnifiedActivity[],
			total: 0,
			hasMore: false,
			filters: {
				status,
				mediaType,
				search
			}
		};
	}
};
