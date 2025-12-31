import { jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // In serverless mode, operations complete within the request
    return jsonResponse({
        status: 'Idle',
        queue_length: 0,
        mode: 'serverless'
    });
}
