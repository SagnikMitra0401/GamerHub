import React from 'react';
import { Link } from 'react-router-dom';

const TermsOfService = () => (
  <main className="content-container" style={{ maxWidth: 840, margin: '2rem auto', padding: '2rem 1.5rem' }}>
    <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.75rem' }}>Terms of Service</h1>
    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
      Last updated: October 31, 2026
    </p>

    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>1. Acceptance of Terms</h2>
        <p>
          By accessing or using GamerHub (<a href="https://gamer-hub-nu.vercel.app" style={{ color: 'var(--accent)' }}>gamer-hub-nu.vercel.app</a>),
          you agree to be bound by these Terms of Service.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>2. Acceptable Use & Conduct</h2>
        <p>
          GamerHub is a gaming social platform. Users agree not to engage in harassment, hate speech, spamming, malicious link distribution, unauthorized automation, or attempts to disrupt community infrastructure.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>3. User Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your credentials and all activity under your account. We reserve the right to suspend or terminate accounts that violate community rules.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>4. Disclaimer of Warranties</h2>
        <p>
          The service is provided on an "as is" and "as available" basis without warranties of any kind.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>5. Contact</h2>
        <p>
          For inquiries regarding these terms, contact <a href="mailto:sagnikmitra.tennis@gmail.com" style={{ color: 'var(--accent)' }}>sagnikmitra.tennis@gmail.com</a>.
        </p>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <Link to="/" style={{ color: 'var(--accent)', fontWeight: 600 }}>&larr; Return to Home</Link>
      </div>
    </section>
  </main>
);

export default TermsOfService;
