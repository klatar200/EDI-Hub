import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMaxMd } from '../lib/useMediaQuery.ts';
import { HEADER_SEARCH_INPUT_ID } from '../lib/keyboard.ts';

const PLACEHOLDER_FULL = 'Search PO / invoice / shipment / ISA #';
const PLACEHOLDER_SHORT = 'Search PO / ISA…';

export function SearchBox(): JSX.Element {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const narrow = useMaxMd();
  return (
    <form
      className="min-w-0 shrink"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
      }}
    >
      <input
        id={HEADER_SEARCH_INPUT_ID}
        className="input w-[min(16rem,100%)] max-w-full"
        placeholder={narrow ? PLACEHOLDER_SHORT : PLACEHOLDER_FULL}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search"
      />
    </form>
  );
}
