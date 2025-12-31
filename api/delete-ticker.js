import { supabase, jsonResponse, corsHeaders, verifyAdmin } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const authHeader = request.headers.get('authorization');
    if (!verifyAdmin(authHeader)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const body = await request.json();
        const ticker = (body.ticker || '').toUpperCase().trim();
        const market = body.market || 'US';

        if (!ticker) {
            return jsonResponse({ error: 'Ticker required' }, 400);
        }

        // Delete from all related tables
        await supabase.from('stock_data').delete().eq('ticker', ticker);
        await supabase.from('projections').delete().eq('ticker', ticker);
        await supabase.from('tickers').delete().eq('symbol', ticker);

        return jsonResponse({ success: true, deleted: ticker });
    } catch (error) {
        return jsonResponse({ error: error.message }, 500);
    }
}
