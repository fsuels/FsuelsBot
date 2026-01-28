// Fetch all products from DLM and analyze descriptions for boilerplate
const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${e.message}\nBody: ${data.substring(0, 500)}`)); }
      });
    }).on('error', reject);
  });
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '[SIZE CHART TABLE]')
    .replace(/<img[^>]*>/gi, '[IMAGE]')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Boilerplate detection patterns
const BOILERPLATE_PATTERNS = [
  // Broken English patterns
  { pattern: /splendid\s+polyester/i, label: 'Broken English: "splendid polyester"' },
  { pattern: /scintillating/i, label: 'Broken English: "scintillating"' },
  { pattern: /nationalistic\s+essence/i, label: 'Broken English: "nationalistic essence"' },
  { pattern: /the\s+little\s+angle/i, label: 'Broken English: "the little angle" (should be angel)' },
  { pattern: /high[\s-]?quality\s+material/i, label: 'Generic: "high quality material"' },
  { pattern: /comfortable\s+to\s+wear/i, label: 'Generic: "comfortable to wear"' },
  { pattern: /suit\s+for\s+daily/i, label: 'Broken English: "suit for daily"' },
  { pattern: /suitable\s+for\s+all\s+occasions/i, label: 'Generic: "suitable for all occasions"' },
  { pattern: /package\s+include/i, label: 'AliExpress boilerplate: "package include"' },
  { pattern: /package\s+content/i, label: 'AliExpress boilerplate: "package content"' },
  { pattern: /please\s+allow\s+\d/i, label: 'AliExpress boilerplate: "please allow [measurement error]"' },
  { pattern: /due\s+to\s+the\s+light/i, label: 'AliExpress boilerplate: "due to the light"' },
  { pattern: /due\s+to\s+(?:different\s+)?monitor/i, label: 'AliExpress boilerplate: "due to monitor"' },
  { pattern: /actual\s+color\s+may\s+(?:be\s+)?slightly/i, label: 'AliExpress boilerplate: color disclaimer' },
  { pattern: /1-3\s*cm\s+(?:error|difference)/i, label: 'AliExpress boilerplate: measurement disclaimer' },
  { pattern: /manual\s+measurement/i, label: 'AliExpress boilerplate: "manual measurement"' },
  { pattern: /asian\s+size/i, label: 'Supplier boilerplate: "Asian size"' },
  { pattern: /chinese\s+size/i, label: 'Supplier boilerplate: "Chinese size"' },
  { pattern: /we\s+will\s+ship/i, label: 'Supplier boilerplate: shipping language' },
  { pattern: /within\s+\d+\s+(?:business\s+)?days?\s+(?:after|of)\s+(?:payment|order)/i, label: 'Supplier boilerplate: shipping time' },
  { pattern: /if\s+you\s+(?:have\s+any\s+)?(?:question|problem)/i, label: 'Supplier boilerplate: customer service' },
  { pattern: /contact\s+us\s+(?:before|first)/i, label: 'Supplier boilerplate: "contact us before"' },
  { pattern: /positive\s+feedback/i, label: 'AliExpress boilerplate: "positive feedback"' },
  { pattern: /5[\s-]?star/i, label: 'AliExpress boilerplate: "5 star"' },
  { pattern: /(?:dear\s+)?(?:buyer|customer|friend)/i, label: 'Supplier boilerplate: "dear buyer/customer"' },
  { pattern: /we\s+(?:are\s+)?professional/i, label: 'Supplier boilerplate: "we are professional"' },
  { pattern: /factory\s+direct/i, label: 'Supplier boilerplate: "factory direct"' },
  { pattern: /wholesale/i, label: 'Supplier boilerplate: "wholesale"' },
  { pattern: /dropship/i, label: 'Supplier boilerplate: "dropship"' },
  { pattern: /retail\s+and\s+wholesale/i, label: 'Supplier boilerplate: "retail and wholesale"' },
  { pattern: /note:\s*1\./i, label: 'Supplier boilerplate: numbered notes' },
  { pattern: /warm\s+tips?:/i, label: 'Supplier boilerplate: "warm tips"' },
  { pattern: /kindly\s+note/i, label: 'Supplier boilerplate: "kindly note"' },
  { pattern: /pls\s/i, label: 'Supplier shorthand: "pls"' },
  { pattern: /plz\s/i, label: 'Supplier shorthand: "plz"' },
  { pattern: /good\s+quality/i, label: 'Generic: "good quality"' },
  { pattern: /best\s+(?:price|quality|service)/i, label: 'Supplier boilerplate: "best price/quality"' },
  { pattern: /material\s*:\s*\w+/i, label: 'Spec-list format (possible supplier copy)' },
  { pattern: /season\s*:\s*\w+/i, label: 'Spec-list format: "Season:"' },
  { pattern: /gender\s*:\s*\w+/i, label: 'Spec-list format: "Gender:"' },
  { pattern: /style\s*:\s*\w+/i, label: 'Spec-list format: "Style:"' },
  { pattern: /occasion\s*:\s*\w+/i, label: 'Spec-list format: "Occasion:"' },
  { pattern: /collar\s*:\s*\w+/i, label: 'Spec-list format: "Collar:"' },
  { pattern: /sleeve\s*length\s*:\s*\w+/i, label: 'Spec-list format: "Sleeve length:"' },
  { pattern: /pattern\s*(?:type)?\s*:\s*\w+/i, label: 'Spec-list format: "Pattern:"' },
  { pattern: /decoration\s*:\s*\w+/i, label: 'Spec-list format: "Decoration:"' },
  { pattern: /closure\s*(?:type)?\s*:\s*\w+/i, label: 'Spec-list format: "Closure type:"' },
  { pattern: /1688\.com/i, label: 'CRITICAL: 1688.com URL in description' },
  { pattern: /alicdn\.com/i, label: 'WARNING: alicdn.com image URL in description' },
  { pattern: /aliexpress/i, label: 'CRITICAL: AliExpress reference' },
  { pattern: /taobao/i, label: 'CRITICAL: Taobao reference' },
  { pattern: /size\s+chart\s+(?:measurements?\s+)?(?:are\s+)?provided\s+by\s+the\s+factory/i, label: 'Factory reference in sizing note' },
  { pattern: /buckydeals\.com/i, label: 'WARNING: BuckyDeals URL exposed in description' },
];

function analyzeDescription(title, bodyHtml) {
  const text = stripHtml(bodyHtml);
  const issues = [];

  // Check for empty/missing description
  if (!bodyHtml || bodyHtml.trim().length === 0) {
    issues.push({ severity: 'CRITICAL', issue: 'No description at all' });
    return { text: '', issues };
  }

  // Check for very short descriptions (less than 50 chars of actual text)
  const textWithoutChart = text.replace(/\[SIZE CHART TABLE\]/g, '').replace(/\[IMAGE\]/g, '').trim();
  if (textWithoutChart.length < 50) {
    issues.push({ severity: 'HIGH', issue: `Very short description (${textWithoutChart.length} chars)` });
  }

  // Check for only size chart, no actual description
  if (bodyHtml.includes('<table') && textWithoutChart.length < 100) {
    issues.push({ severity: 'HIGH', issue: 'Description is mostly just a size chart, no marketing copy' });
  }

  // Run pattern checks
  for (const { pattern, label } of BOILERPLATE_PATTERNS) {
    if (pattern.test(text) || pattern.test(bodyHtml)) {
      // Determine severity
      let severity = 'MEDIUM';
      if (label.includes('CRITICAL')) severity = 'CRITICAL';
      else if (label.includes('WARNING')) severity = 'HIGH';
      else if (label.includes('Broken English') || label.includes('AliExpress')) severity = 'HIGH';
      else if (label.includes('Supplier')) severity = 'MEDIUM';
      else if (label.includes('Generic')) severity = 'LOW';
      else if (label.includes('Spec-list')) severity = 'MEDIUM';
      
      issues.push({ severity, issue: label });
    }
  }

  return { text: textWithoutChart.substring(0, 200), issues };
}

async function main() {
  let allProducts = [];
  let page = 1;
  
  console.log('Fetching products from dresslikemommy.com...');
  
  while (true) {
    const url = `https://www.dresslikemommy.com/products.json?limit=250&page=${page}`;
    console.log(`Fetching page ${page}...`);
    const data = await fetchJSON(url);
    
    if (!data.products || data.products.length === 0) break;
    
    for (const p of data.products) {
      allProducts.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        body_html: p.body_html,
        status: p.published_at ? 'Active' : 'Draft',
        tags: p.tags || [],
        created_at: p.created_at,
      });
    }
    
    console.log(`  Got ${data.products.length} products (total: ${allProducts.length})`);
    if (data.products.length < 250) break;
    page++;
  }
  
  console.log(`\nTotal products: ${allProducts.length}`);
  console.log('Analyzing descriptions...\n');
  
  // Analyze each product
  const results = [];
  for (const product of allProducts) {
    const analysis = analyzeDescription(product.title, product.body_html);
    if (analysis.issues.length > 0) {
      results.push({
        title: product.title,
        handle: product.handle,
        id: product.id,
        status: product.status,
        description_preview: analysis.text,
        issues: analysis.issues,
        // Priority based on severity and status
        priority: analysis.issues.some(i => i.severity === 'CRITICAL') ? 'CRITICAL' :
                  analysis.issues.some(i => i.severity === 'HIGH') ? 'HIGH' : 
                  analysis.issues.some(i => i.severity === 'MEDIUM') ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // Sort by priority
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  results.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  // Output as JSON for processing
  console.log(JSON.stringify({ total_products: allProducts.length, flagged: results.length, products: results }, null, 2));
}

main().catch(console.error);
