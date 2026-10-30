import React from 'react';
import { Link } from 'react-router-dom';

const PrivacyPolicy = () => (
  <main className="content-container" style={{ maxWidth: 840, margin: '2rem auto', padding: '2rem 1.5rem' }}>
    <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.75rem' }}>Privacy Policy</h1>
    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
      Last updated: October 31, 2026
    </p>

    <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>1. Overview</h2>
        <p>
          GamerHub ("we", "our", or "us") respects your privacy. This Privacy Policy explains how we collect,
          use, and safeguard your information when you access our web application at <a href="https://gamer-hub-nu.vercel.app" style={{ color: 'var(--accent)' }}>gamer-hub-nu.vercel.app</a>.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>2. Information We Collect</h2>
        <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <li><strong>Account Data:</strong> When registering or logging in via Google OAuth, we collect your name, email address, and profile picture avatar.</li>
          <li><strong>User Content:</strong> Posts, comments, channel messages, squad requests, and gameplay clips you choose to share.</li>
          <li><strong>Usage & Device Metrics:</strong> Non-sensitive interaction telemetry used solely to maintain uptime and prevent spam or abuse.</li>
        </ul>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>3. Google OAuth & Third-Party Services</h2>
        <p>
          We use Google Identity Services solely for identity authentication (single sign-on). We only request standard basic profile scopes (<code>openid</code>, <code>email</code>, <code>profile</code>). We do not access, sell, transfer, or use your Google data for advertising.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>4. Data Security & Storage</h2>
        <p>
          Authentication tokens and passwords are cryptographically hashed and protected. Communication occurs over secure TLS/HTTPS encryption at all times.
        </p>
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>5. Contact</h2>
        <p>
          If you have questions about this privacy statement, please contact us at <a href="mailto:sagnikmitra.tennis@gmail.com" style={{ color: 'var(--accent)' }}>sagnikmitra.tennis@gmail.com</a>.
        </p>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <Link to="/" style={{ color: 'var(--accent)', fontWeight: 600 }}>&larr; Return to Home</Link>
      </div>
    </section>
  </main>
);

export default PrivacyPolicy;
