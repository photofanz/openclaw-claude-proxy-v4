// Plugin: Cost Savings Tracker
// Estimates how much you're saving vs Anthropic API pricing
// Writes daily report to ~/.openclaw/logs/proxy-cost-savings.json

const fs = require('fs');
const path = require('path');

const API_PRICING = {
  'claude-opus-4-7':    { input: 15.00, output: 75.00 },  // per 1M tokens
  'claude-sonnet-4-6':  { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':   { input: 0.80,  output: 4.00 },
};

const SAVINGS_FILE = path.join(
  process.env.HOME || '.',
  '.openclaw/logs/proxy-cost-savings.json'
);

function loadSavings() {
  try { return JSON.parse(fs.readFileSync(SAVINGS_FILE, 'utf8')); }
  catch { return { totalSaved: 0, byDay: {}, byModel: {} }; }
}

function saveSavings(data) {
  try {
    fs.mkdirSync(path.dirname(SAVINGS_FILE), { recursive: true });
    fs.writeFileSync(SAVINGS_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

module.exports = {
  name: 'cost-tracker',
  description: 'Tracks API cost savings vs subscription',

  postProcess(text, model) {
    if (!text) return text;

    const pricing = API_PRICING[model] || API_PRICING['claude-opus-4-7'];
    const outputTokens = Math.ceil(text.length / 4);
    const saved = (outputTokens / 1_000_000) * pricing.output;

    const data = loadSavings();
    const today = new Date().toISOString().split('T')[0];

    data.totalSaved = (data.totalSaved || 0) + saved;
    if (!data.byDay[today]) data.byDay[today] = 0;
    data.byDay[today] += saved;
    if (!data.byModel[model]) data.byModel[model] = 0;
    data.byModel[model] += saved;

    // Clean old days (keep 30 days)
    const keys = Object.keys(data.byDay).sort();
    while (keys.length > 30) { delete data.byDay[keys.shift()]; }

    saveSavings(data);

    return text; // pass through unchanged
  }
};