from http.server import BaseHTTPRequestHandler
import json
import os
from datetime import datetime
from urllib.parse import parse_qs, urlparse

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            ticker = query.get('ticker', [''])[0].upper().strip()
            
            if not ticker:
                self.send_json({'error': 'Ticker parameter required'}, 400)
                return

            import yfinance as yf
            from supabase import create_client
            
            supabase_url = os.environ.get('SUPABASE_URL', '')
            supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', os.environ.get('SUPABASE_KEY', ''))
            
            if not supabase_url or not supabase_key:
                return self.send_json({'error': 'Supabase credentials not configured'}, 500)
            
            supabase = create_client(supabase_url, supabase_key)

            # Get existing data
            result = supabase.table('stock_data').select('data').eq('ticker', ticker).execute()
            if not result.data or len(result.data) == 0:
                return self.send_json({'error': f'Ticker {ticker} not found in database. Load it first.'}, 404)
            
            existing_data = result.data[0]['data']

            # Encode special characters for yfinance (e.g., M&M.NS -> M%26M.NS)
            yf_ticker_symbol = ticker.replace('&', '%26')
            
            # If it's an Indian stock without .NS or .BO suffix, append .NS for yfinance
            if existing_data.get('market') == 'IN' and not yf_ticker_symbol.endswith('.NS') and not yf_ticker_symbol.endswith('.BO'):
                yf_ticker_symbol += '.NS'

            # Fetch latest data from yfinance
            yf_stock = yf.Ticker(yf_ticker_symbol)
            info = yf_stock.info
            
            current_price = info.get('currentPrice') or info.get('regularMarketPrice')
            if not current_price:
                return self.send_json({'error': f'No price data available for {ticker} from yfinance'}, 404)

            # Get today's OHLC for chart
            hist = yf_stock.history(period='5d')
            if not hist.empty:
                latest = hist.iloc[-1]
                latest_date = hist.index[-1].strftime('%Y-%m-%d')
                
                history_key = 'Monthly Adjusted Time Series'
                if 'history' not in existing_data:
                    existing_data['history'] = {history_key: {}}
                if history_key not in existing_data['history']:
                    existing_data['history'][history_key] = {}
                    
                # Add/update today's data point
                existing_data['history'][history_key][latest_date] = {
                    '1. open': str(latest.get('Open', current_price)),
                    '2. high': str(latest.get('High', current_price)),
                    '3. low': str(latest.get('Low', current_price)),
                    '4. close': str(latest.get('Close', current_price)),
                    '5. adjusted close': str(latest.get('Close', current_price)),
                    '6. volume': str(int(latest.get('Volume', 0))),
                }

            # Update quote
            if 'quote' not in existing_data:
                existing_data['quote'] = {'Global Quote': {}}
            
            prev_close = info.get('previousClose', current_price)
            change = current_price - prev_close if current_price and prev_close else 0
            change_pct = (change / prev_close * 100) if prev_close else 0
            
            existing_data['quote']['Global Quote']['05. price'] = str(current_price)
            existing_data['quote']['Global Quote']['08. previous close'] = str(prev_close)
            existing_data['quote']['Global Quote']['09. change'] = f"{change:.4f}"
            existing_data['quote']['Global Quote']['10. change percent'] = f"{change_pct:.4f}%"

            # Update derived metrics in overview
            if 'overview' in existing_data:
                def safe_str(key, default='N/A'):
                    val = info.get(key)
                    return str(val) if val is not None else default
                
                # Update key valuation & status metrics that might change with price
                metrics_to_update = {
                    'TrailingPE': safe_str('trailingPE', existing_data['overview'].get('TrailingPE')),
                    'ForwardPE': safe_str('forwardPE', existing_data['overview'].get('ForwardPE')),
                    'MarketCapitalization': safe_str('marketCap', existing_data['overview'].get('MarketCapitalization')),
                    'EPS': safe_str('trailingEps', existing_data['overview'].get('EPS')),
                    '52WeekHigh': safe_str('fiftyTwoWeekHigh', existing_data['overview'].get('52WeekHigh')),
                    '52WeekLow': safe_str('fiftyTwoWeekLow', existing_data['overview'].get('52WeekLow')),
                    'DividendYield': safe_str('dividendYield', existing_data['overview'].get('DividendYield')),
                    'Beta': safe_str('beta', existing_data['overview'].get('Beta')),
                    'PriceToBookRatio': safe_str('priceToBook', existing_data['overview'].get('PriceToBookRatio')),
                }
                
                for k, v in metrics_to_update.items():
                    if v != 'N/A':
                        existing_data['overview'][k] = v
                        # Update PERatio if TrailingPE changes since some UI might use PERatio
                        if k == 'TrailingPE':
                            existing_data['overview']['PERatio'] = v

            # Update last_updated timestamp
            existing_data['last_updated'] = datetime.now().isoformat()
            
            # Save to Supabase
            supabase.table('stock_data').update({
                'data': existing_data
            }).eq('ticker', ticker).execute()
            
            return self.send_json({
                'success': True,
                'message': f'{ticker} quick refreshed successfully via yfinance!'
            })

        except Exception as e:
            return self.send_json({'error': str(e)}, 500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
