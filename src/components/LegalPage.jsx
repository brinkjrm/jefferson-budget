import React from 'react'

const LAST_UPDATED = 'July 30, 2026'

export default function LegalPage({ page }) {
  const privacy = page === 'privacy'

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header className="glass" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <a href="/" className="text-white font-bold tracking-tight">Jefferson Construction Manager</a>
          <a href="/" className="text-acc text-sm">Return to project</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10">
        <p className="text-acc text-xs font-semibold uppercase tracking-widest">Jefferson Project Communications</p>
        <h1 className="text-white font-bold text-3xl mt-2">{privacy ? 'Privacy Policy' : 'Text Messaging Terms'}</h1>
        <p className="text-lbl3 text-sm mt-2">Last updated {LAST_UPDATED}</p>

        <div className="apple-card p-6 sm:p-8 mt-7 space-y-7 text-lbl2 text-sm leading-6">
          {privacy ? <PrivacyPolicy /> : <MessagingTerms />}
        </div>

        <div className="flex gap-5 py-8 text-sm">
          <a className="text-acc" href="/privacy">Privacy Policy</a>
          <a className="text-acc" href="/terms">Text Messaging Terms</a>
          <a className="text-acc" href="mailto:Josh@3120jeffersonst.com">Contact</a>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-white font-semibold text-lg mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function PrivacyPolicy() {
  return (
    <>
      <Section title="Information we collect">
        <p>The Jefferson Construction Manager stores project information supplied by the project owner, including contact details, a mobile phone number, project emails, invoices, action items, schedule information, and text-message delivery records.</p>
      </Section>

      <Section title="How information is used">
        <p>Information is used only to operate the owner’s private construction-management service, monitor the dedicated project inbox, prepare project summaries, and deliver requested text-message briefings.</p>
      </Section>

      <Section title="Mobile information and consent">
        <p><strong className="text-white">Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes.</strong> Text-messaging originator opt-in data and consent will not be shared with any third parties, except service providers necessary to deliver the requested messages.</p>
        <p>The service sends up to one daily project briefing when enabled. Message frequency may vary if delivery is paused or no briefing is generated. Message and data rates may apply. Reply STOP to opt out or HELP for help.</p>
      </Section>

      <Section title="Service providers and disclosure">
        <p>Limited information may be processed by hosting, database, email, and telecommunications providers solely to operate and secure the service. Information may also be disclosed when required by law or to protect the service and its users.</p>
      </Section>

      <Section title="Data security and retention">
        <p>Reasonable technical safeguards are used to protect project information. Records are retained only as long as reasonably necessary to operate the project service, meet legal obligations, and resolve disputes.</p>
      </Section>

      <Section title="Contact">
        <p>Questions or privacy requests may be sent to <a className="text-acc" href="mailto:Josh@3120jeffersonst.com">Josh@3120jeffersonst.com</a>.</p>
      </Section>
    </>
  )
}

function MessagingTerms() {
  return (
    <>
      <Section title="Program description">
        <p>Jefferson Project Briefings provide the project owner with automated construction updates compiled from the private project inbox and project records. A briefing may include invoice notices, schedule issues, inspection reminders, and owner action items.</p>
      </Section>

      <Section title="Consent and message frequency">
        <p>By enabling Daily Text Briefing in the application settings, you consent to receive automated text messages at the mobile number supplied for the project. Consent is not a condition of purchasing any goods or services. The program sends up to one message per day while enabled, although message frequency may vary.</p>
      </Section>

      <Section title="Opt-out and help">
        <p>Reply STOP to any message to opt out. After opting out, you may receive one confirmation message and no further project briefings unless you opt in again. Reply HELP for help or email <a className="text-acc" href="mailto:Josh@3120jeffersonst.com">Josh@3120jeffersonst.com</a>.</p>
      </Section>

      <Section title="Charges and delivery">
        <p>Message and data rates may apply. Mobile carriers are not liable for delayed or undelivered messages. Message delivery is subject to carrier availability and is not guaranteed.</p>
      </Section>

      <Section title="Informational use">
        <p>Project briefings are informational summaries. They do not approve invoices, authorize payments, accept change orders, modify the construction schedule, or replace review of the underlying project records.</p>
      </Section>

      <Section title="Privacy and changes">
        <p>Use of the messaging program is also governed by the <a className="text-acc" href="/privacy">Privacy Policy</a>. These terms may be updated as the service changes; the current version will remain available at this URL.</p>
      </Section>
    </>
  )
}
