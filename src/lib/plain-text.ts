/**
 * Strip Markdown from agent text so a judge never sees `**` or `#` on screen.
 *   plainText("**Pay the florist** first") === "Pay the florist first"
 */
export function plainText(text: string): string;
export function plainText(text: string | undefined | null): string | undefined;
export function plainText(text: string | undefined | null): string | undefined {
  if (text == null) return undefined;
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/(^|[\s(])\*(\S[^*\n]*?)\*(?=[\s).,!?:;]|$)/gm, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^(\s*)[*+]\s+/gm, "$1- ")
    .replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, "$1")
    .replace(/\*\*/g, "");
}
