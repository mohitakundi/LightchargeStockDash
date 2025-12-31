"""
Python API route for fetching Indian stock data using yfinance.
Vercel supports Python natively, so this works properly.
This is a complete port of yfinance_fetcher.py functionality.
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
            query = parse_qs(urlparse(self.path).query)
            ticker = query.get('ticker', [''])[0].upper().strip()
            
            if not ticker:
                self.send_json({'error': 'Ticker parameter required'}, 400)
                return
            
            if not ticker.endswith('.NS') and not ticker.endswith('.BO'):
                ticker += '.NS'
            
            print(f"[yfinance] Fetching {ticker}...")
            stock = yf.Ticker(ticker)
            info = stock.info
            
            if not info or 'symbol' not in info:
                self.send_json({'error': f'No data found for {ticker}'}, 404)
                return
            
            # Validate that we have actual price data (not just an empty shell)
            price = info.get('currentPrice') or info.get('regularMarketPrice')
            if not price or price == 0:
                self.send_json({
                    'error': f'Invalid ticker "{ticker}" - no price data found. Please check the symbol.'
                }, 404)
                return
            
            # Build complete normalized data
            data = {
                'overview': self.build_overview(info),
                'quote': self.build_quote(info),
                'income': self.build_income(stock),
                'balance_sheet': self.build_balance_sheet(stock),
                'history': self.build_history(stock),
                'analyst_yf': self.build_analyst(info),  # Native yfinance analyst data
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
        self.wfile.write(json.dumps(data, default=str).encode())

    def build_overview(self, info):
        def safe_str(key, default='N/A'):
            val = info.get(key)
            return str(val) if val is not None else default
        
        def format_timestamp(ts):
            if ts is None:
                return 'None'
            try:
                return datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            except:
                return 'None'
        
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
            'ExDividendDate': format_timestamp(info.get('exDividendDate')),
            'AnalystTargetPrice': safe_str('targetMeanPrice'),
            # Analyst ratings breakdown
            'AnalystRatingStrongBuy': '0',
            'AnalystRatingBuy': '0',
            'AnalystRatingHold': '0',
            'AnalystRatingSell': '0',
            'AnalystRatingStrongSell': '0',
        }

    def build_quote(self, info):
        price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
        prev_close = info.get('previousClose') or info.get('regularMarketPreviousClose', price)
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
        """Build full income statement with all fields."""
        annual_reports = []
        try:
            income_df = stock.income_stmt
            if income_df is not None and not income_df.empty:
                for col in income_df.columns:
                    def safe_get(key):
                        try:
                            return str(income_df.loc[key, col])
                        except:
                            return '0'
                    
                    report = {
                        'fiscalDateEnding': col.strftime('%Y-%m-%d') if hasattr(col, 'strftime') else str(col),
                        'totalRevenue': safe_get('Total Revenue'),
                        'grossProfit': safe_get('Gross Profit'),
                        'operatingIncome': safe_get('Operating Income'),
                        'netIncome': safe_get('Net Income'),
                        'ebitda': safe_get('EBITDA'),
                    }
                    annual_reports.append(report)
        except Exception as e:
            print(f"[yfinance] Income statement error: {e}")
        
        return {'annualReports': annual_reports}

    def build_balance_sheet(self, stock):
        """Build balance sheet data."""
        annual_reports = []
        try:
            bs_df = stock.balance_sheet
            if bs_df is not None and not bs_df.empty:
                for col in bs_df.columns:
                    def safe_get(key):
                        try:
                            return str(bs_df.loc[key, col])
                        except:
                            return '0'
                    
                    # Try multiple possible key names
                    total_liabilities = '0'
                    for key in ['Total Liabilities Net Minority Interest', 'Total Liabilities']:
                        try:
                            total_liabilities = str(bs_df.loc[key, col])
                            break
                        except:
                            continue
                    
                    report = {
                        'fiscalDateEnding': col.strftime('%Y-%m-%d') if hasattr(col, 'strftime') else str(col),
                        'totalAssets': safe_get('Total Assets'),
                        'totalLiabilities': total_liabilities,
                        'totalShareholderEquity': safe_get('Stockholders Equity'),
                        'shortTermDebt': safe_get('Current Debt'),
                        'longTermDebt': safe_get('Long Term Debt'),
                    }
                    annual_reports.append(report)
        except Exception as e:
            print(f"[yfinance] Balance sheet error: {e}")
        
        return {'annualReports': annual_reports}

    def build_history(self, stock):
        """Build monthly price history."""
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

    def build_analyst(self, info):
        """Extract analyst data in native yfinance format."""
        return {
            'recommendationKey': info.get('recommendationKey', 'none'),
            'recommendationMean': info.get('recommendationMean'),
            'targetMeanPrice': info.get('targetMeanPrice'),
            'targetHighPrice': info.get('targetHighPrice'),
            'targetLowPrice': info.get('targetLowPrice'),
            'targetMedianPrice': info.get('targetMedianPrice'),
            'numberOfAnalystOpinions': info.get('numberOfAnalystOpinions', 0),
        }

    def get_exchange_rate(self):
        try:
            import urllib.request
            with urllib.request.urlopen('https://api.exchangerate-api.com/v4/latest/USD') as response:
                data = json.loads(response.read().decode())
                return data.get('rates', {}).get('INR', 83.50)
        except:
            return 83.50
