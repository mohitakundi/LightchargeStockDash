import { jsonResponse, corsHeaders } from './_utils.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        return jsonResponse({ rate: data.rates?.INR || 83.50 });
    } catch {
        return jsonResponse({ rate: 83.50 });
    }
}
