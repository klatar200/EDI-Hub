/**
 * U3/N3 — Documents explorer (UI-3 gate decision).
 *
 * Single page that unifies the previous /transactions (parsed) and
 * /ingestions (raw files) lists behind a `view=parsed|raw` query toggle.
 * Old routes redirect into this page via AppRoutes.tsx, preserving filters.
 *
 * The two list implementations are reused as-is (`hideHeader` prop hides
 * their page header so the chrome doesn't stack). Only the active view's
 * component is mounted so we don't double-fetch the inactive list.
 */
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../components/ui';
import { TransactionsPage } from './TransactionsPage.tsx';
import { IngestionsPage } from './IngestionsPage.tsx';

type DocumentsView = 'parsed' | 'raw';

const VIEW_COPY: Record<DocumentsView, { label: string; subtitle: string }> = {
  parsed: {
    label: 'Parsed transactions',
    subtitle: 'Decoded EDI transactions across your trading partners.',
  },
  raw: {
    label: 'Raw ingestions',
    subtitle: 'Every raw EDI transmission received by the hub, newest first.',
  },
};

function isDocumentsView(v: string | null): v is DocumentsView {
  return v === 'parsed' || v === 'raw';
}

export function DocumentsPage(): JSX.Element {
  const [sp, setSp] = useSearchParams();
  const view: DocumentsView = isDocumentsView(sp.get('view')) ? (sp.get('view') as DocumentsView) : 'parsed';

  function changeView(next: string): void {
    if (!isDocumentsView(next) || next === view) return;
    // Swapping views resets the filter query — the two list types don't
    // share a filter vocabulary (e.g. raw has `source`, parsed has
    // `direction`), so carrying them across would surface nonsense.
    setSp({ view: next });
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={VIEW_COPY[view].subtitle}
      />
      <div className="mb-4">
        <Tabs value={view} onValueChange={changeView}>
          <Tabs.List ariaLabel="Documents view">
            <Tabs.Trigger value="parsed" testId="documents-view-parsed">
              Parsed transactions
            </Tabs.Trigger>
            <Tabs.Trigger value="raw" testId="documents-view-raw">
              Raw ingestions
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </div>

      {view === 'parsed' ? (
        <TransactionsPage hideHeader />
      ) : (
        <IngestionsPage hideHeader />
      )}
    </div>
  );
}
