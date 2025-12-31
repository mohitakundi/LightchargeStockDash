import { supabase, jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === 'GET') {
        // Load projections
        const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();

        if (!ticker) {
            return jsonResponse({ error: 'Ticker required' }, 400);
        }

        const { data, error } = await supabase
            .from('projections')
            .select('data')
            .eq('ticker', ticker)
            .single();

        if (error && error.code !== 'PGRST116') {
            return jsonResponse({ error: error.message }, 500);
        }

        return jsonResponse(data?.data || {});
    }

    if (request.method === 'POST') {
        // Save projections
        const body = await request.json();
        const ticker = (body.ticker || '').toUpperCase().trim();
        const projectionData = body.data;

        if (!ticker || !projectionData) {
            return jsonResponse({ error: 'Ticker and data required' }, 400);
        }

        const { error } = await supabase
            .from('projections')
            .upsert(
                { ticker, data: projectionData, saved_at: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        if (error) {
            return jsonResponse({ error: error.message }, 500);
        }

        return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
}
