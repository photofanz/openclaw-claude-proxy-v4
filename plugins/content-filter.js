// Plugin: Content Safety Filter
// Blocks sensitive data from leaking through AI-generated responses
// Also sanitizes outgoing content (no API keys, no internal URLs, etc.)

const BLOCK_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI-style API keys
  /mt_live_[a-zA-Z0-9]+/g,          // MindThread API keys
  /Bearer [a-zA-Z0-9/+=]{20,}/g,    // Bearer tokens
  /CRON_SECRET[=:]\s*\S+/gi,        // Cron secrets
  /password[=:]\s*\S+/gi,           // Passwords in assignments
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses
  /firebase.*\.json/gi,             // Firebase config files
  /service.account.*\.json/gi,      // Service account files
];

const REDACT_REPLACEMENT = '[REDACTED]';

module.exports = {
  name: 'content-filter',
  description: 'Blocks sensitive data from AI responses',

  postProcess(text) {
    if (!text) return text;
    let filtered = text;
    for (const pattern of BLOCK_PATTERNS) {
      filtered = filtered.replace(pattern, REDACT_REPLACEMENT);
    }
    return filtered;
  }
};
