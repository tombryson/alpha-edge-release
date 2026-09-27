const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const YAML_LITERAL_KEY_RE = (key: string) =>
  new RegExp(`^${escapeRegExp(key)}:\\s*\\|[-+]?\\s*$`);

const TOP_LEVEL_YAML_KEY_RE = /^[A-Za-z0-9_-]+:\s*/;

export function extractYamlLiteralBlock(source: string, key: string): string | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => YAML_LITERAL_KEY_RE(key).test(line));

  if (startIndex === -1) return null;

  const bodyLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (TOP_LEVEL_YAML_KEY_RE.test(line)) break;
    bodyLines.push(line);
  }

  const nonEmptyLines = bodyLines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return "";

  const commonIndent = Math.min(
    ...nonEmptyLines.map((line) => line.match(/^ */)?.[0].length || 0),
  );

  return bodyLines
    .map((line) => (line.startsWith(" ".repeat(commonIndent)) ? line.slice(commonIndent) : line))
    .join("\n")
    .trim();
}

export function extractCopyPastePrompt(source: string): string | null {
  return extractYamlLiteralBlock(source, "copy_paste_prompt");
}

export function extractFencedTextBlock(source: string): string | null {
  const match = source.match(/```(?:text)?\s*\n([\s\S]*?)\n```/);
  return match?.[1]?.trim() ?? null;
}
