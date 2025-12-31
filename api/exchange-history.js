import { supabase, jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

const FIXER_API_KEY = process.env.FIXER_API_KEY;

/**
 * Historical Exchange Rates API
 * 
 * GET /api/exchange-history?date=2023-06-15
 *   - Returns cached rate for that date, or nearest available
 * 
 * POST /api/exchange-history { mode: 'yearly' }
 *   - Backfill yearly samples (1999-2024 = ~26 calls)
 * 
 * POST /api/exchange-history { mode: 'monthly', year: 2023 }
 *   - Backfill monthly data for a specific year (12 calls)
 */

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // GET: Retrieve rate for a date (with fallback to nearest)
    if (request.method === 'GET') {
        const url = new URL(request.url);
        const date = url.searchParams.get('date');

        if (!date) {
            return jsonResponse({ error: 'Date required (YYYY-MM-DD)' }, 400);
        }

        const rate = await getRateForDate(date);
        return jsonResponse({ date, rate, source: 'cached' });
    }

    // POST: Admin backfill operations
    if (request.method === 'POST') {
        const body = await request.json();
        const mode = body.mode || 'yearly';

        if (mode === 'yearly') {
            return await backfillYearly();
        } else if (mode === 'monthly') {
            const year = body.year || new Date().getFullYear();
            return await backfillMonthly(year);
        } else if (mode === 'status') {
            return await getBackfillStatus();
        }

        return jsonResponse({ error: 'Invalid mode' }, 400);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
}

// Get rate for a specific date, with fallback to nearest available
async function getRateForDate(targetDate) {
    // First try exact match
    const { data: exact } = await supabase
        .from('exchange_rates')
        .select('rate')
        .eq('date', targetDate)
        .single();

    if (exact?.rate) return exact.rate;

    // Fallback: find closest date before target
    const { data: before } = await supabase
        .from('exchange_rates')
        .select('date, rate')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(1)
        .single();

    if (before?.rate) return before.rate;

    // Last resort: find any closest date after target
    const { data: after } = await supabase
        .from('exchange_rates')
        .select('date, rate')
        .gt('date', targetDate)
        .order('date', { ascending: true })
        .limit(1)
        .single();

    return after?.rate || 83.5; // Fallback to reasonable default
}

// Backfill yearly samples (Jan 1 of each year from 1999 to current)
async function backfillYearly() {
    if (!FIXER_API_KEY) {
        return jsonResponse({ error: 'FIXER_API_KEY not configured' }, 500);
    }

    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = 1999; y <= currentYear; y++) {
        years.push(y);
    }

    const results = { success: 0, failed: 0, skipped: 0, rates: [] };

    for (const year of years) {
        const date = `${year}-01-01`;

        // Check if already exists
        const { data: existing } = await supabase
            .from('exchange_rates')
            .select('rate')
            .eq('date', date)
            .single();

        if (existing?.rate) {
            results.skipped++;
            continue;
        }

        // Fetch from Fixer.io
        try {
            const res = await fetch(`http://data.fixer.io/api/${date}?access_key=${FIXER_API_KEY}&base=EUR&symbols=USD,INR`);
            const data = await res.json();

            if (data.success && data.rates) {
                // Fixer free tier uses EUR as base, so we calculate USD/INR
                const usdInr = data.rates.INR / data.rates.USD;

                await supabase.from('exchange_rates').upsert({
                    date,
                    rate: usdInr,
                    source: 'fixer'
                }, { onConflict: 'date' });

                results.success++;
                results.rates.push({ date, rate: usdInr });
            } else {
                results.failed++;
            }
        } catch (e) {
            results.failed++;
        }

        // Rate limit: 100ms delay between calls
        await new Promise(r => setTimeout(r, 100));
    }

    return jsonResponse({
        message: `Yearly backfill complete`,
        ...results
    });
}

// Backfill monthly data for a specific year
async function backfillMonthly(year) {
    if (!FIXER_API_KEY) {
        return jsonResponse({ error: 'FIXER_API_KEY not configured' }, 500);
    }

    const months = [];
    for (let m = 1; m <= 12; m++) {
        months.push(m);
    }

    const results = { year, success: 0, failed: 0, skipped: 0 };

    for (const month of months) {
        const date = `${year}-${String(month).padStart(2, '0')}-15`; // Mid-month

        // Skip future dates
        if (new Date(date) > new Date()) continue;

        // Check if already exists
        const { data: existing } = await supabase
            .from('exchange_rates')
            .select('rate')
            .eq('date', date)
            .single();

        if (existing?.rate) {
            results.skipped++;
            continue;
        }

        // Fetch from Fixer.io
        try {
            const res = await fetch(`http://data.fixer.io/api/${date}?access_key=${FIXER_API_KEY}&base=EUR&symbols=USD,INR`);
            const data = await res.json();

            if (data.success && data.rates) {
                const usdInr = data.rates.INR / data.rates.USD;

                await supabase.from('exchange_rates').upsert({
                    date,
                    rate: usdInr,
                    source: 'fixer'
                }, { onConflict: 'date' });

                results.success++;
            } else {
                results.failed++;
            }
        } catch (e) {
            results.failed++;
        }

        await new Promise(r => setTimeout(r, 100));
    }

    return jsonResponse({
        message: `Monthly backfill for ${year} complete`,
        ...results
    });
}

// Get status of backfill
async function getBackfillStatus() {
    const { count } = await supabase
        .from('exchange_rates')
        .select('*', { count: 'exact', head: true });

    const { data: oldest } = await supabase
        .from('exchange_rates')
        .select('date')
        .order('date', { ascending: true })
        .limit(1)
        .single();

    const { data: newest } = await supabase
        .from('exchange_rates')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

    return jsonResponse({
        totalRates: count || 0,
        oldestDate: oldest?.date || null,
        newestDate: newest?.date || null
    });
}
