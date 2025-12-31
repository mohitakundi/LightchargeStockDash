import { supabase, jsonResponse, corsHeaders, verifyAdmin } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const market = url.searchParams.get('market') || 'US';

    if (request.method === 'GET') {
        // List tickers for market
        const { data, error } = await supabase
            .from('tickers')
            .select('symbol, created_at')
            .eq('market', market)
            .order('symbol');

        if (error) {
            return jsonResponse({ error: error.message }, 500);
        }

        // Get last updated times from stock_data
        const tickers = await Promise.all(data.map(async (t) => {
            const { data: stockData } = await supabase
                .from('stock_data')
                .select('last_updated')
                .eq('ticker', t.symbol)
                .single();

            return {
                symbol: t.symbol,
                last_updated: stockData?.last_updated
                    ? new Date(stockData.last_updated).toLocaleString()
                    : 'Never'
            };
        }));

        return jsonResponse({ tickers, market });
    }

    if (request.method === 'POST') {
        // Add ticker (admin only)
        const authHeader = request.headers.get('authorization');
        if (!verifyAdmin(authHeader)) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json();
        const ticker = (body.ticker || '').toUpperCase().trim();
        const tickerMarket = body.market || 'US';

        if (!ticker) {
            return jsonResponse({ error: 'Ticker required' }, 400);
        }

        // Format ticker for Indian stocks
        let symbol = ticker;
        if (tickerMarket === 'IN' && !ticker.endsWith('.NS') && !ticker.endsWith('.BO')) {
            symbol = ticker + '.NS';
        }

        // Insert ticker
        const { error } = await supabase
            .from('tickers')
            .upsert({ symbol, market: tickerMarket }, { onConflict: 'symbol' });

        if (error) {
            return jsonResponse({ error: error.message }, 500);
        }

        return jsonResponse({ success: true, symbol, market: tickerMarket });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
}
