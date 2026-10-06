/** Cuts text to at most `maxLength` characters, marking the cut with an ellipsis. */
export function shortenText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
