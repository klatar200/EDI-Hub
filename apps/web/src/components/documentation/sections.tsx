/**
 * Documentation — content registry.
 *
 * Each function below renders one documentation section. Content is grounded
 * in what the app actually does today — field labels, tab names, and page
 * names here should match the real UI. If the UI copy changes, update the
 * matching section here too.
 *
 * To add a section: write a component, add it to DOC_SECTIONS with a unique
 * id (used in the URL as /documentation/:id) and a group (controls which
 * cluster it sits under in the sidebar).
 */
import {
  DocLead,
  DocH2,
  DocH3,
  DocP,
  DocUl,
  DocCode,
  DocLink,
  DocCallout,
  DocSteps,
  DocStep,
  DocFieldList,
} from './DocBlocks.tsx';

export interface DocSection {
  id: string;
  label: string;
  group: string;
  content: JSX.Element;
}

export const DOC_GROUPS = ['Setup', 'Using the hub', 'Administration', 'Reference'] as const;

export const DEFAULT_DOC_SECTION = 'getting-started';

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────

function GettingStarted(): JSX.Element {
  return (
    <>
      <DocLead>
        This walks through everything required to go from a brand-new account to your first
        stitched purchase-order lifecycle: creating your organization, telling the hub who you
        are on the EDI network, adding your first trading partner, deciding whether to track
        their acknowledgments, and getting a real file in.
      </DocLead>

      <DocSteps>
        <DocStep n={1} title="Create your account and organization">
          Sign-up and sign-in run through Clerk. The first person to create an organization in
          Clerk becomes that organization&apos;s hub tenant — every user, partner, and transaction
          you see afterward is scoped to that organization. The first user in a new organization
          is an <DocCode>Admin</DocCode> by default (see <DocLink to="/documentation/users-roles">Users &amp; roles</DocLink>).
          <DocCallout kind="note" title="Running the desktop edition?">
            A five-step first-run wizard appears automatically for the admin the first time: a
            welcome screen, connecting Clerk (adding this machine&apos;s address to Clerk&apos;s
            allowed redirect URIs), choosing a local drop folder to watch for files, adding a
            first trading partner, and an optional crash-report opt-in. In the hosted edition
            there&apos;s no local folder or LAN step, so you land straight on the dashboard —
            everything below still applies.
          </DocCallout>
        </DocStep>

        <DocStep n={2} title="Set your EDI identity">
          Go to <DocLink to="/settings">Settings</DocLink> → <DocCode>EDI identity</DocCode> and
          add your own ISA interchange ID(s) — the ID your organization uses in the ISA06/ISA08
          segment of every interchange envelope. The hub matches this against each file&apos;s
          sender and receiver IDs to automatically classify transactions as inbound or outbound.
          Skipping this step is the single most common cause of transactions showing up with the
          wrong direction.
          <DocCallout kind="tip">
            If you send or receive under more than one ID — multiple warehouses, EDI providers,
            or legal entities — add all of them here.
          </DocCallout>
        </DocStep>

        <DocStep n={3} title="Add your first trading partner">
          Go to <DocLink to="/partners-config">Partners</DocLink> (admin only) and add a partner.
          The editor has five tabs — <DocLink to="/documentation/trading-partners">Trading partners</DocLink> covers
          every field in depth, but at minimum for a first partner:
          <DocUl>
            <li><DocCode>Identity</DocCode> — a display name, and the partner&apos;s ISA sender ID(s) (what they put in ISA06 when sending you files) and ISA receiver ID(s) (what they use in ISA08 when you send to them).</li>
            <li><DocCode>Sets &amp; flow</DocCode> — which transaction sets you expect from this partner. Leave it empty while you&apos;re still learning their traffic; the hub will accept anything from them and you can tighten it later.</li>
            <li><DocCode>SLAs &amp; alerts</DocCode> — this is where you decide whether to track acknowledgments for this partner (see step 4 below).</li>
          </DocUl>
        </DocStep>

        <DocStep n={4} title="Decide whether to track acknowledgments">
          Acknowledgment tracking (997/999) is opt-in <em>per partner, per transaction set, per
          direction</em> — there is no global on/off switch. On the partner&apos;s{' '}
          <DocCode>SLAs &amp; alerts</DocCode> tab, add an SLA window for each combination you
          want watched, e.g. &quot;inbound 850 → expect an acknowledgment within 60 minutes.&quot;
          <DocUl>
            <li>Add a row for a set + direction → the hub will raise a <DocCode>Missing 997 ack</DocCode> alert if that acknowledgment doesn&apos;t show up in time.</li>
            <li>Leave the tab empty → no missing-acknowledgment alerts will ever fire for this partner. You&apos;ll still see any 997/999s that do arrive, and rejection-rate metrics still work — you just won&apos;t be paged about a missing one.</li>
          </DocUl>
          There&apos;s also a <DocCode>Show SLA countdown on lifecycle rows for this partner</DocCode> checkbox
          on the same tab — turn it on if you want a live countdown next to this partner&apos;s
          rows on the <DocLink to="/lifecycles">Lifecycles</DocLink> page.
          <DocCallout kind="warning">
            Rejection-rate spike detection is different — it runs automatically for any partner
            with 997 traffic, whether or not you&apos;ve added SLA windows. SLA windows only
            control <em>missing</em>-acknowledgment alerts.
          </DocCallout>
        </DocStep>

        <DocStep n={5} title="Decide how files will reach the hub">
          There are up to four ways a file gets in — see{' '}
          <DocLink to="/documentation/connecting-channels">Connecting channels</DocLink> for the
          full picture. The short version: <DocCode>Upload</DocCode> works immediately, right in
          the browser, with no setup. SFTP and AS2 are enabled by whoever manages your
          infrastructure (they&apos;re environment-level switches, not something you turn on from
          this UI). The desktop edition also watches a local folder you chose in the first-run
          wizard.
        </DocStep>

        <DocStep n={6} title="Upload your first file">
          Go to <DocLink to="/documents">Documents</DocLink> → <DocCode>Received files</DocCode> tab
          and use the upload panel — drag a file in or browse for one (<DocCode>.edi</DocCode>,{' '}
          <DocCode>.x12</DocCode>, or <DocCode>.txt</DocCode>). Each result shows{' '}
          <DocCode>Uploaded</DocCode>, <DocCode>Duplicate</DocCode> (same ISA control number as a
          file you already have), or an error. A successfully parsed file with a PO number will
          immediately appear on the <DocLink to="/lifecycles">Lifecycles</DocLink> page.
          <DocCallout kind="tip">
            Nothing showing up, or stuck on an error? <DocLink to="/documentation/troubleshooting">Troubleshooting &amp; FAQ</DocLink> covers
            the most common causes.
          </DocCallout>
        </DocStep>

        <DocStep n={7} title="Invite your team">
          Go to <DocLink to="/users">Users</DocLink> (admin only) — new teammates are invited
          through your Clerk organization and appear on this page once they accept. Assign each
          person a role (<DocCode>Viewer</DocCode>, <DocCode>Operations</DocCode>, or{' '}
          <DocCode>Admin</DocCode>); see <DocLink to="/documentation/users-roles">Users &amp; roles</DocLink> for
          what each can do.
        </DocStep>

        <DocStep n={8} title="Know where to look next">
          A setup checklist follows you around the app (in the header on smaller screens, at the
          bottom of the left sidebar on wide screens) until four things are done: a trading
          partner exists, your ISA IDs are set, an inbound channel is connected, and a first file
          has been received. Once you&apos;re past it, the{' '}
          <DocLink to="/dashboard">Dashboard</DocLink> is the daily starting point, and{' '}
          <DocLink to="/settings">Settings</DocLink> → <DocCode>Notifications</DocCode> is where to
          set up email/Slack alerting the way your team wants it (see{' '}
          <DocLink to="/documentation/monitoring-alerts">Monitoring &amp; alerts</DocLink>).
        </DocStep>
      </DocSteps>
    </>
  );
}

function TradingPartners(): JSX.Element {
  return (
    <>
      <DocLead>
        Reference for every field in the partner editor at <DocLink to="/partners-config">Partners</DocLink>{' '}
        (admin only). If you just want the minimum to get started, see{' '}
        <DocLink to="/documentation/getting-started">Getting started</DocLink> instead.
      </DocLead>

      <DocH2>The partner list</DocH2>
      <DocP>
        Each row shows the partner&apos;s name, their ISA sender IDs (file IDs), the transaction
        sets they&apos;re configured for, how many SLA windows they have, a{' '}
        <DocCode>Setup</DocCode> status pill, their connectivity channel, and active/disabled
        status. The <DocCode>Setup</DocCode> pill reads &quot;Ready&quot; or &quot;N gaps&quot;
        and is a sanity check, not a hard gate:
      </DocP>
      <DocUl>
        <li>Missing ISA sender IDs — the hub can&apos;t recognize this partner&apos;s inbound files at all. Fix this first.</li>
        <li>No SLA windows — missing-acknowledgment alerts will never fire for this partner (may be intentional; see <DocLink to="/documentation/getting-started">Getting started</DocLink>, step 4).</li>
        <li>No contacts — alerts for this partner only go to the global notification webhook, if one is configured.</li>
      </DocUl>

      <DocH2>Identity tab</DocH2>
      <DocFieldList
        items={[
          { field: 'Display name', description: 'How this partner shows up everywhere in the hub. Required.' },
          { field: 'ISA sender IDs', description: 'Comma-separated file IDs this partner uses in ISA06 when sending you files.' },
          { field: 'ISA receiver IDs', description: 'Comma-separated file IDs this partner uses in ISA08 when you send them files.' },
          { field: 'Status', description: <><DocCode>active</DocCode> or <DocCode>disabled</DocCode>.</> },
        ]}
      />

      <DocH2>Sets &amp; flow tab</DocH2>
      <DocFieldList
        items={[
          { field: 'Supported sets', description: 'Comma-separated list, e.g. "850, 855, 810". Empty means accept any transaction set from this partner.' },
          { field: 'Lifecycle flow', description: <>How this partner&apos;s documents chain together. Use the shipped <DocCode>Standard</DocCode> flow (850 → 855 → 856 → 810 → 997s) or <DocCode>Grocery</DocCode> flow (875 → 880), or build a custom one from individual set + direction steps. Leave empty to use the shipped defaults.</> },
          { field: 'Ack-code overrides', description: 'Optional custom wording for this partner’s AK304 / AK403 / AK501 / AK901 codes, if they use non-standard phrasing.' },
          { field: 'Segment label overrides', description: 'Optional custom display labels for partner-specific (Z-segment) elements, keyed by transaction set and segment.' },
        ]}
      />

      <DocH2>SLAs &amp; alerts tab</DocH2>
      <DocP>
        This tab controls acknowledgment tracking for this partner — see{' '}
        <DocLink to="/documentation/acknowledgments">Acknowledgments &amp; rejections</DocLink> for
        how the resulting alerts work.
      </DocP>
      <DocFieldList
        items={[
          { field: 'Show SLA countdown…', description: 'Checkbox — shows a live countdown on this partner’s rows on the Lifecycles page.' },
          { field: 'SLA window rows', description: <>Each row: transaction set, direction (<DocCode>inbound</DocCode>/<DocCode>outbound</DocCode>/<DocCode>unknown</DocCode>), an expected-acknowledgment window in minutes, and which set counts as the acknowledgment (defaults to 997).</> },
        ]}
      />

      <DocH2>Connectivity tab</DocH2>
      <DocCallout kind="note">
        This tab is recordkeeping only — filling it in does not create or activate a channel. See{' '}
        <DocLink to="/documentation/connecting-channels">Connecting channels</DocLink> for how files
        actually get in.
      </DocCallout>
      <DocFieldList
        items={[
          { field: 'Channel', description: 'AS2, SFTP, VAN, API, or Email — whichever method you use with this partner today.' },
          { field: 'Endpoint', description: 'The partner’s connection address, e.g. sftp://partner.example.com/in or https://partner.example.com/as2.' },
          { field: 'Technical contact', description: 'Email address of the person to contact about connectivity issues.' },
          { field: 'Notes', description: 'Operational notes — cert rotation schedule, on-call rotation, etc. Do not put credentials here; reference where they’re stored instead.' },
        ]}
      />

      <DocH2>Notes &amp; contacts tab</DocH2>
      <DocFieldList
        items={[
          { field: 'Notes', description: 'Free-text notes about this partner.' },
          { field: 'Contacts', description: <>Repeatable rows: name, email, role, an optional Slack alert link, and which alert types each contact should receive (<DocCode>missing-ack</DocCode>, <DocCode>rejection-spike</DocCode>, <DocCode>stale-traffic</DocCode>, <DocCode>unknown-isa</DocCode>). Leave all types checked to receive everything for this partner.</> },
        ]}
      />
    </>
  );
}

function ConnectingChannels(): JSX.Element {
  return (
    <>
      <DocLead>
        A &quot;channel&quot; is a way files reach the hub. The <DocLink to="/channels">Channels</DocLink> page
        shows the health of every channel that&apos;s already running, but it&apos;s a monitoring
        view, not a setup screen — there is no &quot;add a channel&quot; button in the UI. Getting
        a new channel running is a one-time task for whoever manages your infrastructure.
      </DocLead>

      <DocH2>Upload</DocH2>
      <DocP>
        The one channel anyone with the Operations role or higher can use directly, right now,
        with no setup: go to <DocLink to="/documents">Documents</DocLink> → <DocCode>Received files</DocCode>,
        and drag a file into the upload panel or browse for one.
      </DocP>

      <DocH2>SFTP</DocH2>
      <DocP>
        A watched SFTP folder — partners (or your own systems) drop files there and the hub picks
        them up automatically. Turning this on is an infrastructure-level change (an environment
        variable plus server configuration), done by an admin or IT, not from this UI. Once it&apos;s
        running, it shows up on the Channels page like any other source.
      </DocP>

      <DocH2>AS2</DocH2>
      <DocP>
        Direct AS2 connectivity, with certificate-based signing and MDN receipts. Like SFTP, this
        is set up outside the app — certificates, partnership configuration, and the AS2 endpoint
        itself are all infrastructure work. Once configured, AS2 traffic appears on the Channels
        page alongside everything else.
      </DocP>

      <DocH2>Desktop drop folder</DocH2>
      <DocP>
        Desktop-edition only. Chosen during the first-run wizard, this is a folder on the machine
        running the hub — anything copied into it is picked up automatically. A banner reminding
        you where to drop files appears at the top of the app until your first file arrives.
      </DocP>

      <DocH2>Monitoring channel health</DocH2>
      <DocP>
        The <DocLink to="/channels">Channels</DocLink> page lists every active channel with a
        status pill (<DocCode>running</DocCode>, <DocCode>error</DocCode>, or otherwise), its
        source, and any error detail. Each card links straight to that channel&apos;s received
        files, filtered by source — a fast way to check &quot;is anything actually coming through
        this connection.&quot;
      </DocP>
      <DocCallout kind="tip">
        No channels registered yet, but you expect one? That almost always means the
        infrastructure-side setup (env vars, credentials, folder) hasn&apos;t been completed —
        check with whoever manages your hosting, not this page.
      </DocCallout>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Using the hub
// ─────────────────────────────────────────────────────────────

function DocumentsSearch(): JSX.Element {
  return (
    <>
      <DocLead>
        Every EDI transaction that touches the hub — inbound and outbound, decoded and raw — lives
        under <DocLink to="/documents">Documents</DocLink>, with a global{' '}
        <DocLink to="/search">Search</DocLink> for finding one specific thing fast.
      </DocLead>

      <DocH2>Documents page</DocH2>
      <DocP>
        Two tabs. <DocCode>Parsed transactions</DocCode> shows every decoded transaction —
        filterable by set, status, direction, partner, PO number, invoice number, and date, with
        a link straight into that PO&apos;s lifecycle. <DocCode>Received files</DocCode> shows the
        raw transmissions as they arrived — filterable by source and status, with the original
        file always available alongside its parsed result. Keeping the raw file next to the
        parsed one means you can always go back to exactly what was sent, which matters for
        disputes and edge-case debugging.
      </DocP>

      <DocH2>Transaction detail</DocH2>
      <DocP>
        Opening any transaction shows its decoded header fields (PO number, dates, amounts — the
        exact fields depend on the transaction set), line items where applicable, a rejection
        panel if it was rejected by an acknowledgment, and a raw-vs-parsed toggle for the
        underlying EDI.
      </DocP>

      <DocH2>Search</DocH2>
      <DocP>
        The search bar in the header (or the command palette — press <DocCode>⌘K</DocCode> /{' '}
        <DocCode>Ctrl K</DocCode>) matches PO numbers, invoice numbers, shipment IDs, and ISA
        control numbers (file IDs). Results are grouped into lifecycle conversations,
        transactions, and raw files, so one search can jump you straight to whichever level of
        detail you need.
      </DocP>
    </>
  );
}

function LifecycleStitching(): JSX.Element {
  return (
    <>
      <DocLead>
        This is the core of the product: pull up one purchase order and see every related
        document — the 850, 855, 856, 810, and every 997 — in one chronological,
        status-aware view.
      </DocLead>

      <DocH2>Finding a lifecycle</DocH2>
      <DocP>
        Browse and filter on the <DocLink to="/lifecycles">Lifecycles</DocLink> page (by partner,
        flow, document type, direction, date range, open alerts, or parse errors), or jump
        straight to one via <DocLink to="/search">Search</DocLink> with a PO number, invoice
        number, or shipment ID.
      </DocP>

      <DocH2>Reading the timeline</DocH2>
      <DocP>Each document in a lifecycle shows:</DocP>
      <DocUl>
        <li>A status pill — <DocCode>Received</DocCode>, <DocCode>Acknowledged</DocCode>, <DocCode>Rejected</DocCode>, or <DocCode>Expected — not received</DocCode> (shown with a dashed ring, so a missing document reads as a gap, not an error).</li>
        <li>A direction pill — <DocCode>Inbound</DocCode>, <DocCode>Outbound</DocCode>, or <DocCode>Unknown</DocCode>.</li>
        <li>For outbound documents, a stage badge tracking <DocCode>generated → transmitted → confirmed</DocCode> — the gap between &quot;generated&quot; and &quot;confirmed&quot; is exactly where silent outbound failures hide.</li>
      </DocUl>
      <DocP>
        If the same document arrives more than once (a resend, a partner glitch), the duplicates
        are grouped together with a side-by-side compare panel rather than shown as separate,
        confusing entries.
      </DocP>

      <DocH2>Notes and export</DocH2>
      <DocP>
        Expand any row for an <DocCode>Operations notes</DocCode> panel (Operations role and
        above) to leave context for teammates. Select one or more rows to export as CSV or ZIP,
        with an option to include the original raw EDI in the ZIP.
      </DocP>
    </>
  );
}

function Acknowledgments(): JSX.Element {
  return (
    <>
      <DocLead>
        Functional acknowledgments (997/999) are the most-ignored document in EDI. The hub turns
        them into three things: a plain-English rejection reason, a missing-acknowledgment alert,
        and a rejection-rate trend per partner.
      </DocLead>

      <DocH2>Is tracking on for a given partner?</DocH2>
      <DocP>
        Missing-acknowledgment alerts are opt-in per partner, per transaction set, per direction —
        controlled entirely by that partner&apos;s SLA windows (see{' '}
        <DocLink to="/documentation/trading-partners">Trading partners</DocLink>). No SLA window
        for a given set + direction means no missing-ack alert for it, ever — by design, not by
        accident. Rejection-rate spike detection is different and runs automatically for any
        partner with 997 traffic, regardless of SLA windows.
      </DocP>

      <DocH2>Reading a rejection</DocH2>
      <DocP>
        Open the rejected transaction — its detail page shows exactly which segment and element
        failed, decoded into plain English rather than a raw AK304/AK403/AK501/AK901 code, plus a
        link back to the acknowledgment that rejected it. (For a segment-by-segment glossary of
        what each transaction set means, see the <DocLink to="/help/transaction-sets">Help</DocLink> page.)
      </DocP>

      <DocH2>Missing-acknowledgment alerts</DocH2>
      <DocP>
        When a partner has an SLA window for a set + direction and the matching acknowledgment
        doesn&apos;t arrive within that window, a <DocCode>Missing 997 ack</DocCode> alert fires —
        see <DocLink to="/documentation/monitoring-alerts">Monitoring &amp; alerts</DocLink> for
        what happens next.
      </DocP>

      <DocH2>Rejection-rate metrics</DocH2>
      <DocP>
        The <DocLink to="/metrics">Metrics</DocLink> page shows a rejection rate per partner over
        a 7, 30, or 90-day window, color-coded (green under 2%, amber to 10%, red above). A
        rejection is defined strictly, the same way X12 defines it: an acknowledgment status code
        of <DocCode>R</DocCode> (rejected) or <DocCode>M</DocCode> (rejected, message follows).
      </DocP>
    </>
  );
}

function MonitoringAlerts(): JSX.Element {
  return (
    <>
      <DocLead>
        Moving from &quot;view what happened&quot; to &quot;tell me when something&apos;s wrong.&quot;
      </DocLead>

      <DocH2>Dashboard</DocH2>
      <DocP>
        <DocLink to="/dashboard">Dashboard</DocLink> is the daily-glance view: recent activity
        across all partners, open alert counts, inbound health (parsed / errored / duplicate),
        rejection trends, recent inbound failures, and a per-partner health table (last received,
        last acknowledgment, 30-day rejection rate, missing acks, open alerts).
      </DocP>

      <DocH2>Alerts</DocH2>
      <DocP>The <DocLink to="/alerts">Alerts</DocLink> page lists four alert types:</DocP>
      <DocUl>
        <li><DocCode>Missing 997 ack</DocCode> — an expected acknowledgment didn&apos;t arrive within its SLA window.</li>
        <li><DocCode>Rejection-rate spike</DocCode> — a partner&apos;s rejection rate jumped noticeably above its own baseline.</li>
        <li><DocCode>Stale traffic</DocCode> — no EDI at all from a partner (or the whole hub) within the configured window.</li>
        <li><DocCode>Unknown ISA sender</DocCode> — a file arrived from an ISA ID that doesn&apos;t match any configured partner.</li>
      </DocUl>
      <DocP>
        Filter by status, partner, or type; sort by SLA breach or recency. Each alert can be
        snoozed (1, 4, or 24 hours) or acknowledged. Operations role and above can also manually{' '}
        <DocCode>Run detection</DocCode> or bulk-acknowledge everything matching the current
        filters.
      </DocP>

      <DocH2>Notifications</DocH2>
      <DocP>
        Configure delivery in <DocLink to="/settings">Settings</DocLink> → <DocCode>Notifications</DocCode>{' '}
        (admin only): an optional daily email digest with a chosen send hour, quiet hours during
        which alerts won&apos;t page anyone, and the ability to mute specific alert types (a muted
        type still shows up on the Alerts page — it just won&apos;t email or Slack anyone). For
        per-partner routing, add contacts with a Slack alert link and choose which alert types
        each one should receive, on that partner&apos;s <DocCode>Notes &amp; contacts</DocCode> tab.
      </DocP>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Administration
// ─────────────────────────────────────────────────────────────

function UsersRoles(): JSX.Element {
  return (
    <>
      <DocLead>
        Your Clerk organization <em>is</em> the tenant — there&apos;s no separate
        organization-creation step inside the hub itself.
      </DocLead>

      <DocH2>Inviting teammates</DocH2>
      <DocP>
        Invite people through your Clerk organization (dashboard or invite link). Once they
        accept, they appear automatically on the <DocLink to="/users">Users</DocLink> page — no
        manual add step needed on this side.
      </DocP>

      <DocH2>Roles</DocH2>
      <DocFieldList
        items={[
          { field: 'Viewer', description: 'Read-only across the whole hub. Can browse, search, and export, but can’t upload files, change settings, acknowledge alerts, or edit anything.' },
          { field: 'Operations', description: 'Everything a Viewer can do, plus day-to-day work: upload files, retry a failed parse, acknowledge and snooze alerts, add lifecycle notes, run detection manually.' },
          { field: 'Admin', description: 'Everything above, plus configuration: add/edit trading partners, change tenant Settings, manage user roles, and view the audit log.' },
        ]}
      />

      <DocH2>Changing a role or removing access</DocH2>
      <DocP>
        On the <DocLink to="/users">Users</DocLink> page (admin only), change a teammate&apos;s
        role from the dropdown next to their name, or revoke their access entirely. Everyone else
        sees this page as read-only.
      </DocP>
    </>
  );
}

function SettingsPreferences(): JSX.Element {
  return (
    <>
      <DocLead>
        <DocLink to="/settings">Settings</DocLink> covers personal preferences (anyone can change
        these) and tenant-wide configuration (admin only).
      </DocLead>

      <DocH2>Appearance</DocH2>
      <DocP>Light/dark theme, stored in your browser — personal, per device.</DocP>

      <DocH2>Default landing page</DocH2>
      <DocP>
        Choose whether signing in takes you to the <DocCode>Dashboard</DocCode> (monitoring-first)
        or <DocCode>Lifecycles</DocCode> (PO-conversation-first) — personal, per user.
      </DocP>

      <DocH2>EDI identity</DocH2>
      <DocP>
        Your organization&apos;s own ISA interchange IDs — see{' '}
        <DocLink to="/documentation/getting-started">Getting started</DocLink> step 2. Editable by
        an admin in either the hosted or desktop edition.
      </DocP>

      <DocH2>Monitoring</DocH2>
      <DocP>
        The global stale-traffic window (in hours — how long with no EDI from a partner counts as
        &quot;quiet&quot; on the Dashboard), and whether SLA countdowns show on lifecycle rows by
        default.
      </DocP>

      <DocH2>Notifications</DocH2>
      <DocP>
        Daily digest opt-in and send hour, quiet hours, and muted alert types — see{' '}
        <DocLink to="/documentation/monitoring-alerts">Monitoring &amp; alerts</DocLink> for what
        each one does.
      </DocP>

      <DocCallout kind="note">
        Tenant-wide settings require the Admin role. Everyone else sees these sections read-only.
      </DocCallout>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Reference
// ─────────────────────────────────────────────────────────────

function Troubleshooting(): JSX.Element {
  return (
    <>
      <DocLead>Answers to the questions that come up most while getting set up.</DocLead>

      <DocH3>A file didn&apos;t parse</DocH3>
      <DocP>
        Check its status on <DocLink to="/documents">Documents</DocLink> → <DocCode>Received files</DocCode>.
        A <DocCode>PARSE_ERROR</DocCode> or <DocCode>FAILED</DocCode> row shows the error inline —
        use <DocCode>Copy report</DocCode> to grab full context for whoever&apos;s investigating,
        and <DocCode>Retry parse</DocCode> once the underlying issue (usually a malformed segment
        upstream) is understood.
      </DocP>

      <DocH3>A file shows as Duplicate</DocH3>
      <DocP>
        The hub identifies files by their ISA control number. A <DocCode>Duplicate</DocCode> result
        means a file with that exact control number was already received — click through to the
        original to compare.
      </DocP>

      <DocH3>I&apos;m not getting missing-acknowledgment alerts</DocH3>
      <DocP>
        The most common cause: that partner has no SLA window for the set + direction you care
        about. Check <DocLink to="/partners-config">Partners</DocLink> → that partner →{' '}
        <DocCode>SLAs &amp; alerts</DocCode>. Second most common: the alert type is muted in{' '}
        <DocLink to="/settings">Settings</DocLink> → <DocCode>Notifications</DocCode>, or the
        specific contact isn&apos;t opted into that alert type on the partner&apos;s{' '}
        <DocCode>Notes &amp; contacts</DocCode> tab.
      </DocP>

      <DocH3>A partner&apos;s files aren&apos;t being recognized as theirs</DocH3>
      <DocP>
        Double-check the ISA sender/receiver IDs on that partner&apos;s <DocCode>Identity</DocCode> tab
        match exactly what appears in ISA06/ISA08 on their actual files — a single extra space or
        wrong padding is enough to cause a mismatch, which usually shows up as an{' '}
        <DocCode>Unknown ISA sender</DocCode> alert instead.
      </DocP>

      <DocH3>A channel shows an error, or I don&apos;t see how to add one</DocH3>
      <DocP>
        Channels (SFTP, AS2) are infrastructure-level, configured by whoever manages your
        hosting — there&apos;s intentionally no in-app &quot;add channel&quot; flow. See{' '}
        <DocLink to="/documentation/connecting-channels">Connecting channels</DocLink>, and loop in
        an admin/IT contact for anything showing an error on the{' '}
        <DocLink to="/channels">Channels</DocLink> page.
      </DocP>

      <DocH3>Where&apos;s the transaction-set glossary?</DocH3>
      <DocP>
        Segment-by-segment plain-English explanations of each transaction set (850 through 997,
        plus the grocery sets) live on the <DocLink to="/help/transaction-sets">Help</DocLink> page,
        not here — this documentation focuses on how to use the app rather than what each EDI
        segment means.
      </DocP>
    </>
  );
}

export const DOC_SECTIONS: DocSection[] = [
  { id: 'getting-started', label: 'Getting started', group: 'Setup', content: <GettingStarted /> },
  { id: 'trading-partners', label: 'Trading partners', group: 'Setup', content: <TradingPartners /> },
  { id: 'connecting-channels', label: 'Connecting channels', group: 'Setup', content: <ConnectingChannels /> },
  { id: 'documents-search', label: 'Documents & search', group: 'Using the hub', content: <DocumentsSearch /> },
  { id: 'lifecycle-stitching', label: 'Lifecycle stitching', group: 'Using the hub', content: <LifecycleStitching /> },
  { id: 'acknowledgments', label: 'Acknowledgments & rejections', group: 'Using the hub', content: <Acknowledgments /> },
  { id: 'monitoring-alerts', label: 'Monitoring & alerts', group: 'Using the hub', content: <MonitoringAlerts /> },
  { id: 'users-roles', label: 'Users & roles', group: 'Administration', content: <UsersRoles /> },
  { id: 'settings-preferences', label: 'Settings & preferences', group: 'Administration', content: <SettingsPreferences /> },
  { id: 'troubleshooting', label: 'Troubleshooting & FAQ', group: 'Reference', content: <Troubleshooting /> },
];
