import { supabase, jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Return list of available tickers with basic info
    const { data, error } = await supabase
        .from('tickers')
        .select('symbol, market')
        .order('symbol');

    if (error) {
        return jsonResponse({ error: error.message }, 500);
    }

    // Format for search dropdown
    const stocks = await Promise.all(data.map(async (t) => {
        const { data: stockData } = await supabase
            .from('stock_data')
            .select('data')
            .eq('ticker', t.symbol)
            .single();

        const name = stockData?.data?.overview?.Name || t.symbol;

        return {
            symbol: t.symbol,
            name: name,
            market: t.market
        };
    }));

    return jsonResponse({ stocks });
}
