/**
 * Deterministic, zero-cost repair pass for LLM JSON output. No LLM call, no
 * spend -- this alone resolves the large majority of real-world "malformed
 * JSON" failures (fenced code blocks, leading/trailing prose, trailing
 * commas, smart quotes). Only if this fails does the caller escalate to a
 * paid LLM repair round-trip.
 */
export function repairJsonString(raw: string): string {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences.
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fenceMatch?.[1]) {
    text = fenceMatch[1].trim();
  }

  // Drop any prose before the first { or [ and after the matching close,
  // using a balanced, string-aware scan rather than a naive lastIndexOf
  // (which breaks the moment a brace/bracket appears inside a string value).
  const start = text.search(/[{[]/);
  if (start > 0) text = text.slice(start);
  text = extractBalanced(text);

  // Smart quotes -> straight quotes.
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Trailing commas before a closing brace/bracket.
  text = text.replace(/,(\s*[}\]])/g, '$1');

  return text.trim();
}

/**
 * Returns the shortest prefix of `text` (starting at its first {/[) whose
 * brace/bracket nesting balances, tracking string literals so a }/] inside a
 * string value doesn't end the scan early.
 */
function extractBalanced(text: string): string {
  const first = text[0];
  if (first !== '{' && first !== '[') return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }

  return text; // unbalanced; let JSON.parse report the real error
}
