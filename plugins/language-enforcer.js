// Plugin: Language Enforcer
// Ensures responses match the expected language based on system prompt
// Detects zh-TW requests and adds reinforcement if needed

module.exports = {
  name: 'language-enforcer',
  description: 'Reinforces language consistency in system prompts',

  preProcess(messages, model) {
    if (!messages || !Array.isArray(messages)) return { messages, model };

    // Check if any system or user message contains Chinese
    const hasChinese = messages.some(m => {
      const content = typeof m.content === 'string' ? m.content : '';
      return /[\u4e00-\u9fff]/.test(content);
    });

    // If Chinese detected but no explicit language instruction in system prompt
    if (hasChinese) {
      const hasLangInstruction = messages.some(m =>
        m.role === 'system' && typeof m.content === 'string' &&
        (m.content.includes('繁體中文') || m.content.includes('zh-TW') || m.content.includes('Traditional Chinese'))
      );

      if (!hasLangInstruction) {
        // Prepend language instruction to first system message, or add one
        const sysIdx = messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) {
          messages[sysIdx].content = '請用繁體中文回答。\n' + messages[sysIdx].content;
        } else {
          messages.unshift({ role: 'system', content: '請用繁體中文回答。' });
        }
      }
    }

    return { messages, model };
  }
};