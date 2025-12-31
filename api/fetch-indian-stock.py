"""
Python API route for fetching Indian stock data using yfinance.
Vercel supports Python natively, so this works properly.
"""
from http.server import BaseHTTPRequestHandler
import json
import yfinance as yf
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
            # Parse query parameters
            query = parse_qs(urlparse(self.path).query)
            ticker = query.get('ticker', [''])[0].upper().strip()
            
            if not ticker:
                self.send_json({'error': 'Ticker parameter required'}, 400)
                return
            
            # Ensure proper suffix for Indian stocks
            if not ticker.endswith('.NS') and not ticker.endswith('.BO'):
                ticker += '.NS'
            
            print(f"[yfinance] Fetching {ticker}...")
            stock = yf.Ticker(ticker)
            info = stock.info
            
            if not info or 'symbol' not in info:
                self.send_json({'error': f'No data found for {ticker}'}, 404)
                return
            
            # Build normalized data
            data = {
                'overview': self.build_overview(info),
                'quote': self.build_quote(info),
                'income': self.build_income(stock),
                'balance_sheet': {'annualReports': []},
                'history': self.build_history(stock),
                'market': 'IN',
                'currency': 'INR',
                'usd_inr_rate': self.get_exchange_rate(),
                'last_updated': datetime.now().isoformat()
            }
            
            print(f"[yfinance] Successfully fetched {ticker}")
            self.send_json(data)
            
        except Exception as e:
            print(f"[yfinance] Error: {str(e)}")
            self.send_json({'error': str(e)}, 500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def build_overview(self, info):
        def safe_str(key, default='N/A'):
            val = info.get(key)
            return str(val) if val is not None else default
        
        return {
            'Symbol': safe_str('symbol'),
            'Name': safe_str('longName', safe_str('shortName', 'Unknown')),
            'Description': safe_str('longBusinessSummary', ''),
            'Exchange': safe_str('exchange'),
            'Currency': safe_str('currency', 'INR'),
            'Country': safe_str('country', 'India'),
            'Sector': safe_str('sector'),
            'Industry': safe_str('industry'),
            'MarketCapitalization': safe_str('marketCap'),
            'SharesOutstanding': safe_str('sharesOutstanding'),
            'TrailingPE': safe_str('trailingPE'),
            'ForwardPE': safe_str('forwardPE'),
            'PEGRatio': safe_str('pegRatio'),
            'PriceToBookRatio': safe_str('priceToBook'),
            'BookValue': safe_str('bookValue'),
            'PERatio': safe_str('trailingPE'),
            'RevenueTTM': safe_str('totalRevenue'),
            'EPS': safe_str('trailingEps'),
            'EBITDA': safe_str('ebitda'),
            'ProfitMargin': safe_str('profitMargins'),
            'OperatingMarginTTM': safe_str('operatingMargins'),
            'GrossProfitTTM': safe_str('grossProfits'),
            'ReturnOnEquityTTM': safe_str('returnOnEquity'),
            'ReturnOnAssetsTTM': safe_str('returnOnAssets'),
            'QuarterlyRevenueGrowthYOY': safe_str('revenueGrowth'),
            'QuarterlyEarningsGrowthYOY': safe_str('earningsGrowth'),
            '52WeekHigh': safe_str('fiftyTwoWeekHigh'),
            '52WeekLow': safe_str('fiftyTwoWeekLow'),
            '50DayMovingAverage': safe_str('fiftyDayAverage'),
            '200DayMovingAverage': safe_str('twoHundredDayAverage'),
            'Beta': safe_str('beta'),
            'DividendYield': safe_str('dividendYield'),
            'DividendPerShare': safe_str('dividendRate'),
            'AnalystTargetPrice': safe_str('targetMeanPrice')
        }

    def build_quote(self, info):
        price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
        prev_close = info.get('previousClose', price)
        change = price - prev_close if price and prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close else 0
        
        return {
            'Global Quote': {
                '01. symbol': info.get('symbol', ''),
                '02. open': str(info.get('open', info.get('regularMarketOpen', 0))),
                '03. high': str(info.get('dayHigh', info.get('regularMarketDayHigh', 0))),
                '04. low': str(info.get('dayLow', info.get('regularMarketDayLow', 0))),
                '05. price': str(price),
                '06. volume': str(info.get('volume', info.get('regularMarketVolume', 0))),
                '07. latest trading day': datetime.now().strftime('%Y-%m-%d'),
                '08. previous close': str(prev_close),
                '09. change': f'{change:.4f}',
                '10. change percent': f'{change_pct:.4f}%'
            }
        }

    def build_income(self, stock):
        annual_reports = []
        try:
            income_stmt = stock.income_stmt
            if income_stmt is not None and not income_stmt.empty:
                for col in income_stmt.columns[:4]:
                    report = {
                        'fiscalDateEnding': col.strftime('%Y-%m-%d') if hasattr(col, 'strftime') else str(col),
                        'totalRevenue': str(income_stmt.loc['Total Revenue', col]) if 'Total Revenue' in income_stmt.index else '0',
                        'netIncome': str(income_stmt.loc['Net Income', col]) if 'Net Income' in income_stmt.index else '0',
                    }
                    annual_reports.append(report)
        except Exception as e:
            print(f"[yfinance] Income statement error: {e}")
        
        return {'annualReports': annual_reports}

    def build_history(self, stock):
        monthly_data = {}
        try:
            hist = stock.history(period='max', interval='1mo')
            for date, row in hist.iterrows():
                date_str = date.strftime('%Y-%m-%d')
                monthly_data[date_str] = {
                    '1. open': str(row.get('Open', 0)),
                    '2. high': str(row.get('High', 0)),
                    '3. low': str(row.get('Low', 0)),
                    '4. close': str(row.get('Close', 0)),
                    '5. adjusted close': str(row.get('Close', 0)),
                    '6. volume': str(int(row.get('Volume', 0))),
                    '7. dividend amount': str(row.get('Dividends', 0))
                }
        except Exception as e:
            print(f"[yfinance] History error: {e}")
        
        return {'Monthly Adjusted Time Series': monthly_data}

    def get_exchange_rate(self):
        try:
            import urllib.request
            with urllib.request.urlopen('https://api.exchangerate-api.com/v4/latest/USD') as response:
                data = json.loads(response.read().decode())
                return data.get('rates', {}).get('INR', 83.50)
        except:
            return 83.50
