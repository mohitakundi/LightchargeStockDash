import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// CORS headers for all responses
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

// Helper to create JSON response
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        }
    });
}

// Helper to verify admin password
export function verifyAdmin(authHeader) {
    if (!authHeader) return false;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return false;
    const token = authHeader.replace('Bearer ', '');
    return token === adminPassword;
}

// Detect market from ticker
export function detectMarket(ticker) {
    const t = ticker.toUpperCase();
    if (t.endsWith('.NS') || t.endsWith('.BO')) {
        return 'IN';
    }
    return 'US';
}
