import { supabase, jsonResponse, corsHeaders, detectMarket, fetchUSStockWithFallback, verifyStockData } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const ticker = (body.ticker || '').toUpperCase().trim();

        if (!ticker) {
            return jsonResponse({ error: 'Ticker required' }, 400);
        }

        // Check if ticker was already updated today (smart refresh)
        const { data: existing } = await supabase
            .from('stock_data')
            .select('last_updated')
            .eq('ticker', ticker)
            .single();

        if (existing) {
            const lastUpdated = new Date(existing.last_updated);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (lastUpdated >= today) {
                return jsonResponse({
                    message: `${ticker} is already up to date (last updated: ${lastUpdated.toLocaleString()})`,
                    skipped: true
                });
            }
        }

        // Fetch new data
        const market = detectMarket(ticker);
        const url = new URL(request.url);
        const baseUrl = url.origin;
        let stockData;

        if (market === 'IN') {
            const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${encodeURIComponent(ticker)}&market=IN`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to fetch Indian stock');
            }
            stockData = await res.json();
            verifyStockData(ticker, stockData);
        } else {
            stockData = await fetchUSStockWithFallback(ticker, baseUrl);
        }

        // Store in database
        const { error: saveErr } = await supabase
            .from('stock_data')
            .upsert(
                { ticker, data: stockData, last_updated: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        if (saveErr) {
            throw new Error(`Database error saving stock data: ${saveErr.message}`);
        }

        return jsonResponse({
            message: `${ticker} refreshed successfully!`,
            success: true
        });
    } catch (error) {
        console.error('Refresh error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}
