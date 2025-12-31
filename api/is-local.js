import { jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

// In serverless, always return true for save/load features
export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    return jsonResponse({ is_local: true });
}
