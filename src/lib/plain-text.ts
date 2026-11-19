/**
 * Assistant answers as clean text for Telegram and the panel: AI models like markdown (**bold**,
 * "### title", "* item", `code`, [link](url)), which Telegram and the panel would show as raw
 * asterisks and hashes. One thing per line, bullets as "•", nothing else changed.
 */
export function cleanMarkdown(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/(^|[\s("“])\*([^*\s][^*\n]*?)\*(?=[\s)"”.,;:!?]|$)/gm, '$1$2')
    .replace(/(^|[\s("“])_([^_\s][^_\n]*?)_(?=[\s)"”.,;:!?]|$)/gm, '$1$2')
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/^[ \t]*[*+-][ \t]+/gm, '• ')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
