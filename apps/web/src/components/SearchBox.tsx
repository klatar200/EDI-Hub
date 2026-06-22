import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function SearchBox(): JSX.Element {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  return (
    <form
      className="ml-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
      }}
    >
      <input
        className="input w-64"
        placeholder="Search PO / invoice / ISA #"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search"
      />
    </form>
  );
}
