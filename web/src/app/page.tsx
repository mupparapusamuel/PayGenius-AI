"use client";

import { useMemo, useState } from "react";
import { useAuth } from "./auth/AuthProvider";

type PaymentStatus = "Paid" | "Failed" | "Pending" | "Review";

type Payment = {
  id: string;
  customer: string;
  email: string;
  date: string;
  amount: string;
  method: string;
  status: PaymentStatus;
  issue: string;
  initials: string;
  color: string;
};

const payments: Payment[] = [
  {
    id: "PY-2024-8912",
    customer: "Olivia Rhye",
    email: "olivia@untitledui.com",
    date: "Today, 10:42 AM",
    amount: "$249.00",
    method: "PayPal",
    status: "Review",
    issue: "Charged, order not confirmed",
    initials: "OR",
    color: "lavender",
  },
  {
    id: "PY-2024-8911",
    customer: "Phoenix Baker",
    email: "phoenix@acme.co",
    date: "Today, 10:18 AM",
    amount: "$89.00",
    method: "PayPal",
    status: "Failed",
    issue: "Payment authorization declined",
    initials: "PB",
    color: "peach",
  },
  {
    id: "PY-2024-8910",
    customer: "Lana Steiner",
    email: "lana@layers.to",
    date: "Today, 9:56 AM",
    amount: "$1,240.00",
    method: "PayPal",
    status: "Paid",
    issue: "Subscription renewal",
    initials: "LS",
    color: "mint",
  },
  {
    id: "PY-2024-8909",
    customer: "Demi Wilkinson",
    email: "demi@openlane.io",
    date: "Today, 9:31 AM",
    amount: "$64.00",
    method: "PayPal",
    status: "Pending",
    issue: "Awaiting provider confirmation",
    initials: "DW",
    color: "blue",
  },
  {
    id: "PY-2024-8908",
    customer: "Candice Wu",
    email: "candice@freemind.dev",
    date: "Today, 9:02 AM",
    amount: "$420.00",
    method: "PayPal",
    status: "Paid",
    issue: "Customer requested receipt",
    initials: "CW",
    color: "rose",
  },
];

const navigation = [
  { section: "WORKSPACE", items: ["Overview", "Transactions", "Investigations", "Customers"] },
  { section: "MANAGE", items: ["AI agents", "Integrations", "Policies", "Analytics"] },
];

const iconPaths: Record<string, string> = {
  Overview: "M3 3h7v7H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 14h7v7H3z",
  Transactions: "M4 6h16M4 12h16M4 18h16",
  Investigations: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm6 14 4 4",
  Customers: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m8-11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm12 11v-2a4 4 0 0 0-3-3.87m-3-12.13a4 4 0 0 1 0 7.75",
  "AI agents": "M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48 2.12 2.12m0-12.72-2.12 2.12m-8.48 8.48-2.12 2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  Integrations: "M8 7V3m8 4V3M7 11h10m-9 10h8a2 2 0 0 0 2-2v-6a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v6a2 2 0 0 0 2 2Z",
  Policies: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4",
  Analytics: "M3 3v18h18M8 15l4-4 4 4 5-7",
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  if (name === "PayPal") {
    return <span className={`paypal-mark ${className}`} aria-hidden="true">P</span>;
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name] ?? "M12 5v14m-7-7h14"} />
    </svg>
  );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span />{status}</span>;
}

export default function Home() {
  const auth = useAuth();
  const [activeNav, setActiveNav] = useState("Overview");
  const [activeFilter, setActiveFilter] = useState("All activity");
  const [query, setQuery] = useState("");
  const [selectedPayment, setSelectedPayment] = useState(payments[0]);
  const [notice, setNotice] = useState("");

  const filteredPayments = useMemo(() => {
    const searchTerm = query.trim().toLowerCase();
    return payments.filter((payment) => {
      const matchesSearch = !searchTerm || [
        payment.customer,
        payment.email,
        payment.id,
        payment.issue,
      ].some((value) => value.toLowerCase().includes(searchTerm));
      const matchesFilter = activeFilter === "All activity"
        || (activeFilter === "Needs attention" && ["Review", "Failed"].includes(payment.status))
        || (activeFilter === "Resolved" && payment.status === "Paid");
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, query]);

  function showDemoNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setActiveNav("Overview")} aria-label="PayNexus home">
          <span className="brand-mark"><span /></span>
          <span>paynexus<span className="brand-ai">.ai</span></span>
        </a>

        <button className="workspace-switcher" onClick={() => showDemoNotice("Workspace switching will be available after sign-in.")}>
          <span className="workspace-avatar">S</span>
          <span className="workspace-copy"><strong>Studio North</strong><small>Business workspace</small></span>
          <span className="switcher-chevron">⌄</span>
        </button>

        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              <p className="nav-label">{group.section}</p>
              {group.items.map((item) => (
                <button
                  className={`nav-item ${activeNav === item ? "nav-item-active" : ""}`}
                  key={item}
                  onClick={() => setActiveNav(item)}
                >
                  <Icon name={item} />
                  <span>{item}</span>
                  {item === "Investigations" && <span className="nav-count">4</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-heading"><span>AI resolutions</span><span>68%</span></div>
            <div className="usage-track"><span /></div>
            <p>34 of 50 monthly cases</p>
            <button onClick={() => showDemoNotice("Plan management is not connected in this demo.")}>View usage <span>→</span></button>
          </div>
          <button className="nav-item support-link" onClick={() => showDemoNotice("Support center is coming soon.")}>
            <span className="support-icon">?</span><span>Help & support</span>
          </button>
          <button className="profile-button" onClick={() => showDemoNotice("Account settings are not connected in this demo.")}>
            <span className="profile-avatar">JD</span>
            <span className="workspace-copy"><strong>Jordan Davis</strong><small>Admin</small></span>
            <span className="switcher-chevron">•••</span>
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <span className="environment-pill"><span /> Sandbox environment</span>
            {auth.configured && !auth.user && <button className="header-link" onClick={() => void auth.signIn().catch(() => showDemoNotice("Secure sign-in could not be started."))}>Sign in</button>}
            {auth.user && <a className="header-link" href="/workspace">Secure workspace →</a>}
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => showDemoNotice("You're all caught up.")}>♧<i /></button>
            <button className="top-avatar" aria-label="Open profile">JD</button>
          </div>
        </header>

        <div className="content">
          <div className="demo-banner">
            <span className="demo-banner-icon">i</span>
            <span><strong>Demo workspace</strong> — sample transactions only. No live payment data or actions.</span>
            <button onClick={() => showDemoNotice("Connect a provider from Integrations when setup is available.")}>Explore integrations <span>→</span></button>
          </div>

          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="sparkle">✳</span> TODAY AT A GLANCE</div>
              <h1>Good morning, Jordan <span>✦</span></h1>
              <p>Here&apos;s what&apos;s happening with your payments today.</p>
            </div>
            <button className="primary-button" onClick={() => showDemoNotice("New investigation requires a connected payment provider.")}>
              <span>＋</span> New investigation
            </button>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <div className="metric-top"><span>Payments today</span><span className="metric-icon icon-violet">↗</span></div>
              <strong>$24,680<span className="metric-cents">.50</span></strong>
              <div className="metric-foot"><span className="trend-positive">↗ 12.8%</span><span>vs. last week</span><div className="sparkline spark-purple"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Success rate</span><span className="metric-icon icon-green">✓</span></div>
              <strong>98.6<span className="metric-cents">%</span></strong>
              <div className="metric-foot"><span className="trend-positive">↗ 2.4%</span><span>vs. last week</span><div className="sparkline spark-green"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Need attention</span><span className="metric-icon icon-amber">!</span></div>
              <strong>4</strong>
              <div className="metric-foot"><span className="metric-muted">2 high priority</span><span className="metric-divider">·</span><span>Across 3 cases</span><div className="sparkline spark-amber"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>AI resolution rate</span><span className="metric-icon icon-blue">✳</span></div>
              <strong>86<span className="metric-cents">%</span></strong>
              <div className="metric-foot"><span className="trend-positive">↗ 5.2%</span><span>vs. last week</span><div className="sparkline spark-blue"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            </article>
          </div>

          <div className="dashboard-grid">
            <section className="panel transactions-panel">
              <div className="panel-heading">
                <div><h2>Recent activity</h2><p>A live view of your payment operations</p></div>
                <button className="more-button" aria-label="More transaction options" onClick={() => showDemoNotice("More options are not available in the sample workspace.")}>•••</button>
              </div>
              <div className="table-toolbar">
                <div className="filter-tabs" role="tablist" aria-label="Filter payments">
                  {["All activity", "Needs attention", "Resolved"].map((filter) => (
                    <button
                      className={activeFilter === filter ? "filter-active" : ""}
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      role="tab"
                      aria-selected={activeFilter === filter}
                    >{filter}{filter === "Needs attention" && <span className="filter-count">4</span>}</button>
                  ))}
                </div>
                <label className="search-field">
                  <Icon name="Investigations" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" aria-label="Search payments" />
                  <kbd>⌘ K</kbd>
                </label>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>PAYMENT</th><th>STATUS</th><th>AMOUNT</th><th>ISSUE</th><th><span className="sr-only">Open details</span></th></tr></thead>
                  <tbody>
                    {filteredPayments.map((payment) => (
                      <tr className={selectedPayment.id === payment.id ? "selected-row" : ""} key={payment.id} onClick={() => setSelectedPayment(payment)}>
                        <td>
                          <div className="payment-cell">
                            <span className={`customer-avatar avatar-${payment.color}`}>{payment.initials}</span>
                            <span><strong>{payment.customer}</strong><small>{payment.id} · {payment.date}</small></span>
                          </div>
                        </td>
                        <td><StatusBadge status={payment.status} /></td>
                        <td><strong className="amount">{payment.amount}</strong><small className="payment-method"><Icon name={payment.method} /> {payment.method}</small></td>
                        <td className="issue-cell">{payment.issue}</td>
                        <td><button className="row-arrow" aria-label={`View ${payment.id}`}>↗</button></td>
                      </tr>
                    ))}
                    {filteredPayments.length === 0 && <tr><td className="empty-state" colSpan={5}>No sample payments match your search.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="table-footer"><span>Showing <strong>{filteredPayments.length}</strong> of 128 payments</span><button onClick={() => setActiveNav("Transactions")}>View all transactions <span>→</span></button></div>
            </section>

            <aside className="right-column">
              <section className="panel copilot-panel">
                <div className="copilot-heading">
                  <div className="copilot-brand"><span className="copilot-orb">✳</span><span><strong>PayNexus AI</strong><small>Payment intelligence</small></span></div>
                  <span className="online-indicator"><i /> ONLINE</span>
                </div>
                <div className="copilot-body">
                  <div className="copilot-greeting"><span className="copilot-orb">✳</span><div><strong>Hi Jordan, I&apos;m on it.</strong><p>I&apos;m monitoring your payment activity and looking for anything that needs attention.</p></div></div>
                  <div className="insight-card">
                    <div className="insight-label"><span>✦</span> PRIORITY INSIGHT <span className="insight-dot" /></div>
                    <p>One customer reported a charge without an order confirmation.</p>
                    <div className="insight-payment"><span className="customer-avatar avatar-lavender">OR</span><span><strong>{selectedPayment.customer}</strong><small>{selectedPayment.id} · {selectedPayment.amount}</small></span><StatusBadge status={selectedPayment.status} /></div>
                    <div className="insight-note"><span>i</span> Investigation is read-only. No action will be taken without authorization.</div>
                    <button className="outline-button" onClick={() => setActiveNav("Investigations")}>Review investigation <span>→</span></button>
                  </div>
                  <div className="copilot-footer"><span className="readonly-lock">⌑</span> Read-only demo · Provider not connected</div>
                </div>
              </section>

              <section className="panel integration-panel">
                <div className="panel-heading compact-heading"><div><h2>Connected platforms</h2><p>Payment providers</p></div><button className="small-link" onClick={() => setActiveNav("Integrations")}>Manage</button></div>
                <div className="integration-row">
                  <span className="paypal-badge"><Icon name="PayPal" /></span>
                  <span className="integration-copy"><strong>PayPal</strong><small>Sandbox · Not connected</small></span>
                  <span className="disconnected-dot" />
                </div>
                <button className="connect-link" onClick={() => showDemoNotice("Provider authorization is not available in this prototype.")}>＋ Connect a platform</button>
              </section>

              <section className="panel activity-panel">
                <div className="panel-heading compact-heading"><div><h2>Agent activity</h2><p>Recent autonomous work</p></div><span className="live-tag"><i /> LIVE</span></div>
                <div className="activity-entry"><span className="activity-icon activity-check">✓</span><div><p><strong>Subscription renewal confirmed</strong></p><small>Renewal matched · Lana Steiner</small><span className="activity-time">12 min ago</span></div></div>
                <div className="activity-entry"><span className="activity-icon activity-search">⌕</span><div><p><strong>Payment investigation started</strong></p><small>Order confirmation mismatch</small><span className="activity-time">28 min ago</span></div></div>
                <button className="activity-link" onClick={() => setActiveNav("AI agents")}>View agent activity <span>→</span></button>
              </section>
            </aside>
          </div>
          <footer className="page-footer"><span>© 2024 PayNexus AI</span><span>SECURE PAYMENT INTELLIGENCE <i /> BUILT FOR TRUST</span></footer>
        </div>
      </section>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
