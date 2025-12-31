import { supabase, jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();

    if (!ticker) {
        return jsonResponse({ error: 'Ticker parameter required' }, 400);
    }

    try {
        // Log access
        await supabase
            .from('access_log')
            .upsert(
                { ticker, last_accessed: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        // Fetch stock data
        const { data, error } = await supabase
            .from('stock_data')
            .select('data, last_updated')
            .eq('ticker', ticker)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        if (!data) {
            return jsonResponse({ error: 'Data not found locally.' }, 404);
        }

        // Return the stored JSON data
        return jsonResponse(data.data);
    } catch (error) {
        console.error('Stock data error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}
