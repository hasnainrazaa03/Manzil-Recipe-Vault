import { Fragment } from 'react';
import { splitOnMatch } from '../lib/format';

interface HighlightProps {
  text: string;
  term: string;
}

/**
 * Marks occurrences of a search term. The term is regex-escaped before the
 * pattern is built — the same discipline the server applies to search, for the
 * same reason: a user typing `(` should get a search, not an exception.
 */
export function Highlight({ text, term }: HighlightProps) {
  const segments = splitOnMatch(text, term);

  if (segments.length === 1) return <>{text}</>;

  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.match ? <mark>{segment.text}</mark> : segment.text}
        </Fragment>
      ))}
    </>
  );
}
