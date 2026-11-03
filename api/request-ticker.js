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

        const market = detectMarket(ticker);
        const url = new URL(request.url);
        const baseUrl = url.origin;
        let stockData;

        if (market === 'IN') {
            // Call Python yfinance function for Indian stocks
            const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${encodeURIComponent(ticker)}&market=IN`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to fetch ${ticker}`);
            }
            stockData = await res.json();
            verifyStockData(ticker, stockData);
        } else {
            // Fetch US stock with yfinance fallback & verification
            stockData = await fetchUSStockWithFallback(ticker, baseUrl);
        }

        // Store in database
        const { error: stockErr } = await supabase
            .from('stock_data')
            .upsert(
                { ticker, data: stockData, last_updated: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        if (stockErr) {
            throw new Error(`Database error saving stock data: ${stockErr.message}`);
        }

        // Add to tickers if not exists
        await supabase
            .from('tickers')
            .upsert(
                { symbol: ticker, market },
                { onConflict: 'symbol' }
            );

        return jsonResponse({ success: true, ticker, market });
    } catch (error) {
        console.error('Request ticker error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}
