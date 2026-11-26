import { parse, type TokenType, tokTypes } from "acorn";

type Style = "comment" | "keyword" | "string" | "literal";
type Range = { start: number; end: number; style: Style };

function tokenStyle(type: TokenType, text: string): Style | undefined {
  switch (type) {
    case tokTypes.string:
    case tokTypes.regexp:
    case tokTypes.template:
    case tokTypes.invalidTemplate:
    case tokTypes.backQuote:
      return "string";
    case tokTypes.num:
    case tokTypes._null:
    case tokTypes._true:
    case tokTypes._false:
      return "literal";
    case tokTypes.name:
      if (["async", "await", "let", "yield"].includes(text)) return "keyword";
      return;
    default:
      if (type.keyword) return "keyword";
  }
}

/** Offset ranges leave line endings, escape sequences and all other source text untouched. */
export function javascriptHighlightRanges(code: string): Range[] {
  const ranges: Range[] = [];
  try {
    parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      onComment: (_block, _text, start, end) => {
        ranges.push({ start, end, style: "comment" });
      },
      onToken: ({ type, start, end }) => {
        const style = tokenStyle(type, code.slice(start, end));
        if (style && start < end) ranges.push({ start, end, style });
      },
    });
  } catch {
    return [];
  }
  return ranges.sort((a, b) => a.start - b.start);
}
