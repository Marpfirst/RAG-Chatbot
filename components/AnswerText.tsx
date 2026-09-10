import { Fragment, type ReactNode } from "react";

/**
 * Renders the small amount of Markdown the models actually emit.
 *
 * They already emit it: of the last 60 stored answers, two contained `**bold**`
 * and numbered lists, and the Specialist reaches for them whenever a question
 * has several parts. Those characters are paid for on every such answer whether
 * or not anything renders them, so printing them raw was spending tokens on
 * formatting and then throwing the formatting away.
 *
 * Deliberately not `react-markdown`: this needs bold, ordered and unordered
 * lists, and paragraphs. A dependency an order of magnitude larger than the
 * feature is a bad trade, and full Markdown would also mean deciding what to do
 * about raw HTML in model output. Nothing here interprets HTML — every node is
 * constructed, so there is no `dangerouslySetInnerHTML` anywhere.
 */

type Line = { indent: number; marker: "ol" | "ul" | null; text: string };

const BULLET = /^(\s*)[-*]\s+(.*)$/;
const NUMBER = /^(\s*)\d+\.\s+(.*)$/;

function parse(src: string): Line[] {
  return src.split("\n").map((raw) => {
    const bullet = raw.match(BULLET);
    if (bullet) return { indent: bullet[1].length, marker: "ul" as const, text: bullet[2] };
    const number = raw.match(NUMBER);
    if (number) return { indent: number[1].length, marker: "ol" as const, text: number[2] };
    return { indent: 0, marker: null, text: raw.trim() };
  });
}

/** `**bold**` only. Anything else is left as written. */
function inline(text: string, key: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <Fragment key={key}>
      {parts.map((part, i) =>
        // Odd indices are the captured groups, i.e. what was inside the stars.
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part
      )}
    </Fragment>
  );
}

export default function AnswerText({ text }: { text: string }) {
  const lines = parse(text);
  const out: ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.marker) {
      if (line.text) out.push(<p key={i}>{inline(line.text, `p${i}`)}</p>);
      i++;
      continue;
    }

    // One run of list items at this level. An indented run underneath an item
    // becomes a nested list inside it, which is the shape the models produce:
    // a numbered step whose detail lines are bullets.
    const marker = line.marker;
    const indent = line.indent;
    const items: ReactNode[] = [];

    while (i < lines.length && lines[i].marker === marker && lines[i].indent === indent) {
      const own = lines[i].text;
      i++;

      const nested: ReactNode[] = [];
      while (i < lines.length && lines[i].marker && lines[i].indent > indent) {
        nested.push(<li key={`n${i}`}>{inline(lines[i].text, `ni${i}`)}</li>);
        i++;
      }

      items.push(
        <li key={`i${i}`}>
          {inline(own, `t${i}`)}
          {nested.length > 0 && <ul>{nested}</ul>}
        </li>
      );
    }

    out.push(marker === "ol" ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>);
  }

  // A single plain answer — the common case — stays a single <p>.
  return <>{out.length > 0 ? out : <p>{text}</p>}</>;
}
