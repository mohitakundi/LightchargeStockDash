-- Supabase Schema for Lightcharge Stock Dash
-- Run this in Supabase SQL Editor

-- Tickers table
CREATE TABLE IF NOT EXISTS tickers (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    market VARCHAR(10) NOT NULL DEFAULT 'US',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stock data table (stores JSON blob)
CREATE TABLE IF NOT EXISTS stock_data (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    data JSONB NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Projections table
CREATE TABLE IF NOT EXISTS projections (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    data JSONB NOT NULL,
    saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Access log for tracking recently viewed tickers
CREATE TABLE IF NOT EXISTS access_log (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL UNIQUE,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickers_market ON tickers(market);
CREATE INDEX IF NOT EXISTS idx_stock_data_ticker ON stock_data(ticker);
CREATE INDEX IF NOT EXISTS idx_access_log_last_accessed ON access_log(last_accessed DESC);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

-- Allow public read access (adjust as needed)
CREATE POLICY "Public read access" ON tickers FOR SELECT USING (true);
CREATE POLICY "Public read access" ON stock_data FOR SELECT USING (true);
CREATE POLICY "Public read access" ON projections FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Service role full access" ON tickers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON stock_data FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON projections FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON access_log FOR ALL USING (auth.role() = 'service_role');
