/**
 * Responsive smoke test for the invite surfaces and the admin dashboard.
 *
 * Serves the production client build, stubs the REST API with layout fixtures,
 * and checks six screens at phone, tablet and desktop sizes:
 *   - /join/:code (requester view, approval required)
 *   - the Invite people modal (queue + active links)
 *   - the Audit Log with the Invites filter
 *   - Server Settings (form and three-button footer)
 *   - Members & Roles (long member rows and moderation controls)
 *   - /admin (stat cards, long tables and action buttons)
 *
 * A surface fails when the page scrolls horizontally, the modal leaves the
 * viewport or clips its content, a table clips instead of scrolling, or (on
 * touch viewports) a button is smaller than 36 px. It uses the Chrome/Edge
 * already installed on the machine or CI runner through playwright-core, so no
 * browser download is required.
 *
 * Failures write responsive-artifacts/<device>/<surface>.png and a trace.zip
 * for that device, plus responsive-artifacts/failures.txt. CI uploads the
 * directory only when the job fails.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLIENT_DIR = path.join(ROOT, 'client');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = path.join(ROOT, 'responsive-artifacts');

const NOW = new Date().toISOString();
const EARLIER = new Date(Date.now() - 90_000).toISOString();

const USER = {
  _id: 'user_layout',
  username: 'layout_tester',
  email: 'layout@example.com',
  level: 42,
  role: 'admin',
  profileType: 'gamer',
  savedPosts: [],
  favoriteChannels: []
};

const COMMUNITY = {
  _id: 'community_layout',
  name: 'Responsive Invite Check',
  slug: 'demo-server',
  description:
    'A deliberately long description used to verify that the invite card and modal wrap text at every width without pushing controls off screen.',
  icon: 'RL',
  isPrivate: true,
  ownerId: { _id: USER._id, username: USER.username },
  members: [
    {
      userId: { _id: USER._id, username: USER.username, level: USER.level, presence: { status: 'online' } },
      role: 'owner',
      joinedAt: NOW
    }
  ],
  memberCount: 1,
  createdAt: NOW
};

const CHANNEL = {
  _id: 'channel_general',
  communityId: COMMUNITY._id,
  name: 'general',
  type: 'text',
  position: 0,
  minRoleToRead: 'member'
};

const PERMISSIONS = [
  'VIEW_SERVER',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'DELETE_OWN_MESSAGE',
  'MANAGE_MESSAGES',
  'ADD_MEMBERS',
  'KICK_MEMBERS',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'VIEW_AUDIT_LOG',
  'MANAGE_SERVER',
  'ADD_REACTIONS',
  'ATTACH_FILES',
  'CREATE_FORUM_POSTS',
  'REPLY_FORUM_POSTS',
  'MENTION_EVERYONE',
  'TIMEOUT_MEMBERS',
  'PIN_MESSAGES',
  'MANAGE_FORUM_POSTS',
  'VIEW_REPORTS'
];

const INVITE_COMMUNITY = {
  name: 'Responsive Request Check',
  slug: 'demo-server',
  icon: 'RR',
  description:
    'A join page fixture with a longer description so wrapping is exercised at narrow widths.',
  memberCount: 1,
  isPrivate: true
};

const INVITE_PREVIEW = {
  code: 'demo-code',
  role: 'member',
  uses: 0,
  maxUses: 5,
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  requiresApproval: true,
  status: 'active',
  alreadyMember: false,
  pendingRequest: false,
  canJoin: true,
  url: `${BASE}/join/demo-code`,
  community: INVITE_COMMUNITY
};

const INVITES = {
  items: [
    {
      _id: 'invite_one',
      code: 'demo-code',
      uses: 1,
      maxUses: 5,
      requiresApproval: true,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      revokedAt: null,
      createdAt: NOW,
      status: 'active',
      url: `${BASE}/join/demo-code`,
      createdBy: USER.username
    }
  ],
  pendingRequests: 2
};

const JOIN_REQUESTS = {
  items: [
    { _id: 'request_one', userId: 'user_b', username: 'invited_player_one', level: 12, code: 'demo-code', createdAt: EARLIER },
    { _id: 'request_two', userId: 'user_c', username: 'invited_player_two', level: 7, code: 'demo-code', createdAt: NOW }
  ]
};

const AUDIT = {
  entries: [
    {
      _id: 'audit_one',
      actorId: { username: USER.username },
      actionType: 'INVITE_JOIN',
      metadata: { code: 'demo-code', username: 'invited_player_one' },
      createdAt: NOW
    },
    {
      _id: 'audit_two',
      actorId: { username: USER.username },
      actionType: 'INVITE_REQUEST',
      metadata: { code: 'demo-code', username: 'invited_player_two' },
      createdAt: EARLIER
    },
    {
      _id: 'audit_three',
      actorId: { username: USER.username },
      actionType: 'INVITE_CREATE',
      metadata: { code: 'demo-code', requiresApproval: true },
      createdAt: EARLIER
    }
  ],
  hasMore: false
};

// The admin dashboard renders real cards and tables, so the fixture includes
// long names and routes to exercise wrapping and horizontal table scrolling.
const ADMIN_HEALTH = {
  generatedAt: NOW,
  security: {
    secretIsolation: {
      ok: false,
      missingRequired: ['YOUTUBE_API_KEY'],
      weakSecrets: [],
      keys: [
        { name: 'JWT_SECRET', required: true, usedBy: 'API authentication', configured: true, strength: 'strong' },
        { name: 'YOUTUBE_API_KEY', required: true, usedBy: 'YouTube catalog sync', configured: false, strength: null },
        { name: 'CLOUDINARY_API_SECRET', required: false, usedBy: 'Media uploads', configured: true, strength: 'short' }
      ]
    },
    clientBundle: { scanned: true, files: 6, leakedKeys: [] }
  },
  health: {
    uptimeSeconds: 93784,
    node: 'v22.11.0',
    database: { connected: true, state: 'connected' },
    traffic: {
      totalRequests: 18432,
      avgLatencyMs: 42,
      p95LatencyMs: 138,
      serverErrors: 3,
      samples: 18432,
      rateLimits: [
        { name: 'login', hits: 12 },
        { name: 'admin', hits: 2 }
      ],
      topRoutes: [
        { route: '/api/communities/:slug/channels/:channelId/messages', count: 9042, avgMs: 31, maxMs: 412 },
        { route: '/api/feed', count: 1201, avgMs: 55, maxMs: 318 }
      ]
    },
    services: {
      youtube: {
        configured: true,
        cacheBackend: 'memory',
        estimatedQuotaUnitsPerSync: 3,
        lastSync: { message: 'synced 8 videos' }
      },
      cloudinary: { configured: true },
      gameCatalog: { provider: 'FreeToGame', cacheMinutes: 30 },
      redis: { configured: false, cache: 'memory', likeBuffer: 'off' }
    }
  },
  database: {
    counts: {
      users: 12894,
      posts: 8831,
      comments: 20114,
      communities: 412,
      messages: 120443,
      activeParties: 87,
      notifications: 3391,
      auditEvents: 5120
    }
  },
  audit: [
    {
      _id: 'admin_audit_one',
      actionType: 'COMMUNITY_ROLE_UPDATE',
      actor: 'layout_tester_with_a_long_username',
      actorRole: 'admin',
      community: 'Responsive Invite Check With A Very Long Server Name',
      targetModel: 'Community',
      metadata: {},
      createdAt: NOW
    }
  ]
};

const DM_REPORTS = {
  items: [
    {
      _id: 'report_one',
      reporter: { username: 'reporter_with_a_long_handle' },
      reported: { username: 'reported_player' },
      reason: 'harassment',
      note: 'A long report note that must wrap or scroll instead of widening the dashboard at tablet widths.',
      messages: [
        { _id: 'message_one', text: 'A reported message with enough text to require wrapping inside the disclosure.' }
      ],
      createdAt: NOW
    },
    {
      _id: 'report_two',
      reporter: { username: 'second_reporter' },
      reported: { username: 'another_player' },
      reason: 'spam',
      note: 'Short note.',
      messages: [],
      createdAt: EARLIER
    }
  ]
};

const VERIFICATIONS = {
  items: [
    {
      _id: 'verification_one',
      user: { username: 'business_owner' },
      business: {
        displayName: 'Long Business Display Name Studio',
        website: 'https://example.com/a/very/long/business/website/path',
        verificationDomain: 'verify.example-business.example.com',
        verificationMethod: 'dns_txt',
        verificationStatus: 'pending'
      },
      requestedAt: NOW
    }
  ]
};

const MEMBERS = {
  total: 8,
  members: [
    { userId: USER._id, username: USER.username, role: 'owner', joinedAt: EARLIER },
    { userId: 'user_admin', username: 'night_owl_sentinel', role: 'admin', joinedAt: EARLIER },
    { userId: 'user_mod', username: 'invited_player_one', role: 'moderator', joinedAt: EARLIER },
    {
      userId: 'user_timeout',
      username: 'speedrunner_with_a_long_name',
      role: 'member',
      joinedAt: NOW,
      timeoutUntil: new Date(Date.now() + 10 * 60_000).toISOString()
    },
    { userId: 'user_four', username: 'casual_gamer_four', role: 'member', joinedAt: NOW },
    { userId: 'user_five', username: 'casual_gamer_five', role: 'member', joinedAt: NOW },
    { userId: 'user_six', username: 'casual_gamer_six', role: 'member', joinedAt: NOW },
    { userId: 'user_seven', username: 'casual_gamer_seven', role: 'member', joinedAt: NOW }
  ]
};

const BANS = {
  bans: [
    { userId: 'banned_one', username: 'banned_player_with_a_long_name', reason: 'harassment' }
  ]
};

const ALL_DEVICES = [
  { name: 'iphone-se', width: 375, height: 667, touch: true },
  { name: 'iphone-13', width: 390, height: 844, touch: true },
  { name: 'pixel-7', width: 412, height: 915, touch: true },
  { name: 'ipad-air', width: 820, height: 1180, touch: true },
  { name: 'ipad-landscape', width: 1180, height: 820, touch: true },
  { name: 'tablet', width: 1024, height: 768, touch: false },
  { name: 'desktop', width: 1280, height: 900, touch: false }
];

// RESPONSIVE_ONLY=iphone-se,tablet makes local iteration on one failure quick.
const only = (process.env.RESPONSIVE_ONLY || '').split(',').map((name) => name.trim()).filter(Boolean);
const DEVICES = only.length ? ALL_DEVICES.filter((device) => only.includes(device.name)) : ALL_DEVICES;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

function startPreview() {
  const viteBin = path.join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) throw new Error('client dependencies are not installed (vite missing)');

  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: CLIENT_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForPreview(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite preview did not answer on ${BASE} within ${timeoutMs}ms`);
}

async function launchBrowser() {
  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (executablePath) {
    return chromium.launch({ executablePath, headless: true });
  }
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    throw new Error(
      'No Chrome/Edge found. Install Chrome, set CHROME_PATH, or run "npx playwright install chromium" and use the bundled build.\n' +
        err.message
    );
  }
}

async function stubApi(route) {
  const url = new URL(route.request().url());
  const apiPath = url.pathname.replace(/^\/api/, '');
  const method = route.request().method();
  let body = {};

  if (apiPath === '/auth/me') {
    body = { user: USER };
  } else if (apiPath === '/admin/system-health') {
    body = ADMIN_HEALTH;
  } else if (apiPath.startsWith('/admin/dm-reports')) {
    body = DM_REPORTS;
  } else if (apiPath.startsWith('/admin/business-verifications')) {
    body = VERIFICATIONS;
  } else if (apiPath.startsWith('/communities/invites/')) {
    body = INVITE_PREVIEW;
  } else if (/^\/communities\/[^/]+\/join-requests$/.test(apiPath)) {
    body = JOIN_REQUESTS;
  } else if (/^\/communities\/[^/]+\/invites$/.test(apiPath) && method === 'GET') {
    body = INVITES;
  } else if (/^\/communities\/[^/]+\/audit$/.test(apiPath)) {
    body = AUDIT;
  } else if (/^\/communities\/[^/]+\/members$/.test(apiPath) && method === 'GET') {
    body = MEMBERS;
  } else if (/^\/communities\/[^/]+\/bans$/.test(apiPath) && method === 'GET') {
    body = BANS;
  } else if (/^\/communities\/channels\/[^/]+\/messages$/.test(apiPath)) {
    body = { messages: [], hasMore: false };
  } else if (/^\/communities\/[^/]+$/.test(apiPath) && method === 'GET') {
    body = {
      community: COMMUNITY,
      channels: [CHANNEL],
      callerRole: 'owner',
      callerPermissions: PERMISSIONS,
      memberCount: COMMUNITY.memberCount
    };
  } else if (apiPath.startsWith('/notifications')) {
    body = { items: [], unreadCount: 0 };
  } else if (apiPath.startsWith('/users/me/muted')) {
    body = { mutedUsers: [] };
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function joinPageMetrics(page) {
  return page.evaluate(() => {
    const card = document.querySelector('main .card');
    const rect = card?.getBoundingClientRect();
    const offenders = [...document.querySelectorAll('main *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const box = element.getBoundingClientRect();
        return box.width > 1 && (box.right > innerWidth + 1 || box.left < -1);
      })
      .slice(0, 3)
      .map((element) => String(element.className || element.tagName).split(' ')[0]);

    return {
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cardMissing: !card,
      cardOutside: rect ? rect.left < -1 || rect.right > innerWidth + 1 : false,
      offenders,
      debug: {
        path: location.pathname,
        mainCount: document.querySelectorAll('main').length,
        cardCount: document.querySelectorAll('.card').length,
        mainClass: document.querySelector('main')?.className || '',
        text: (document.querySelector('main')?.innerText || '').slice(0, 90)
      }
    };
  });
}

async function modalMetrics(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.modal-box');
    if (!box) return { missing: true };
    const rect = box.getBoundingClientRect();
    const style = getComputedStyle(box);
    const buttons = [...box.querySelectorAll('.btn')].map((button) => button.getBoundingClientRect().height);
    return {
      missing: false,
      viewport: [innerWidth, innerHeight],
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) },
      withinViewport:
        rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
      horizontalClip: box.scrollWidth > box.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      scrollable: box.scrollHeight <= box.clientHeight + 1 || ['auto', 'scroll'].includes(style.overflowY),
      minButtonHeight: buttons.length ? Math.round(Math.min(...buttons)) : null
    };
  });
}

async function adminMetrics(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.admin-card')];
    const cardsOutside = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.width > 1 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).length;
    const tables = [...document.querySelectorAll('.admin-table')];
    const clippedTables = tables.filter((table) => {
      const canScroll = ['auto', 'scroll'].includes(getComputedStyle(table).overflowX);
      return table.scrollWidth > table.clientWidth + 1 && !canScroll;
    }).length;
    const buttons = [...document.querySelectorAll('.admin-card .btn, .page-header .btn')]
      .map((button) => button.getBoundingClientRect().height);

    return {
      viewport: [innerWidth, innerHeight],
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cards: cards.length,
      cardsOutside,
      tables: tables.length,
      clippedTables,
      minButtonHeight: buttons.length ? Math.round(Math.min(...buttons)) : null
    };
  });
}

/** Save a full-page screenshot for a failed surface; returns its repo path. */
async function captureFailure(page, deviceName, surface) {
  const file = path.join(ARTIFACT_DIR, deviceName, `${surface}.png`);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    return path.relative(ROOT, file);
  } catch {
    return null;
  }
}

async function openSidebarIfNeeded(page) {
  // The off-canvas sidebar is aria-hidden while closed, so the visible role
  // query does not match it. Wait for the hidden node to prove the community
  // page mounted, then decide whether the drawer needs opening.
  const inviteAnywhere = page.getByRole('button', { name: 'Invite people', includeHidden: true });
  await inviteAnywhere.waitFor({ state: 'attached' });
  if (await inviteAnywhere.isVisible()) return;

  const toggle = page.getByRole('button', { name: 'Open channels and members' });
  if (await toggle.count()) {
    await toggle.first().click();
    await page.getByRole('button', { name: 'Invite people' }).waitFor({ state: 'visible' });
  }
}

async function runDevice(browser, device, failures) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    isMobile: device.touch,
    hasTouch: device.touch,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', stubApi);
  await context.tracing.start({ screenshots: true, snapshots: true });

  const failuresBefore = failures.length;
  const report = async (surface, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${device.name.padEnd(14)} ${surface.padEnd(16)} ${detail}`);
    if (ok) return;
    failures.push(`${device.name}/${surface}: ${detail}`);
    const screenshot = await captureFailure(page, device.name, surface);
    if (screenshot) console.log(`      screenshot: ${screenshot}`);
  };

  try {
    // 1. Public join page with an approval-gated invite.
    await page.goto(`${BASE}/join/demo-code`, { waitUntil: 'domcontentloaded' });
    await page.locator('main .card').waitFor();
    await page.getByRole('button', { name: 'Request to join' }).waitFor();
    await page.waitForTimeout(250);
    const join = await joinPageMetrics(page);
    const joinOk = !join.pageOverflow && !join.cardMissing && !join.cardOutside && join.offenders.length === 0;
    await report(
      'join-page',
      joinOk,
      joinOk
        ? `${device.width}x${device.height}, no overflow`
        : JSON.stringify(join)
    );

    // 2. Invite people modal on the server page.
    await page.goto(`${BASE}/communities/demo-server`, { waitUntil: 'domcontentloaded' });
    await openSidebarIfNeeded(page);
    await page.getByRole('button', { name: 'Invite people' }).click();
    await page.getByRole('heading', { name: /Join requests/ }).waitFor();
    // Let the sheet/slide animation finish before measuring its bounds.
    await page.waitForTimeout(450);
    const modal = await modalMetrics(page);
    const modalOk =
      !modal.missing &&
      modal.withinViewport &&
      !modal.horizontalClip &&
      !modal.pageOverflow &&
      modal.scrollable &&
      (!device.touch || (modal.minButtonHeight ?? 0) >= 36);
    await report('invite-modal', modalOk, modalOk ? `${device.width}x${device.height}, fits` : JSON.stringify(modal));

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // 3. Audit log with the Invites filter.
    if (!(await page.getByRole('button', { name: 'Audit log' }).isVisible().catch(() => false))) {
      await openSidebarIfNeeded(page);
    }
    await page.getByRole('button', { name: 'Audit log' }).click();
    await page.getByRole('button', { name: 'Invites' }).waitFor();
    await page.waitForTimeout(450);
    const audit = await modalMetrics(page);
    const auditOk =
      !audit.missing &&
      audit.withinViewport &&
      !audit.horizontalClip &&
      !audit.pageOverflow &&
      audit.scrollable &&
      (!device.touch || (audit.minButtonHeight ?? 0) >= 36);
    await report('audit-log', auditOk, auditOk ? `${device.width}x${device.height}, fits` : JSON.stringify(audit));

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // 4. Server Settings: form plus the three-button footer.
    if (!(await page.getByRole('button', { name: 'Server settings' }).isVisible().catch(() => false))) {
      await openSidebarIfNeeded(page);
    }
    await page.getByRole('button', { name: 'Server settings' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Server Settings' }).waitFor();
    await page.waitForTimeout(350);
    const settings = await modalMetrics(page);
    const settingsOk =
      !settings.missing &&
      settings.withinViewport &&
      !settings.horizontalClip &&
      !settings.pageOverflow &&
      settings.scrollable &&
      (!device.touch || (settings.minButtonHeight ?? 0) >= 36);
    await report(
      'server-settings',
      settingsOk,
      settingsOk ? `${device.width}x${device.height}, fits` : JSON.stringify(settings)
    );

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // 5. Members & Roles: dense rows with role and moderation controls.
    if (!(await page.getByRole('button', { name: 'Manage members and roles' }).isVisible().catch(() => false))) {
      await openSidebarIfNeeded(page);
    }
    await page.getByRole('button', { name: 'Manage members and roles' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: /Members & Roles/ }).waitFor();
    await page.locator('.role-member-row').first().waitFor();
    await page.waitForTimeout(350);
    const roleStates = [await modalMetrics(page)];
    await page.getByRole('button', { name: 'Banned users' }).click();
    await page.locator('.role-ban-row').first().waitFor();
    await page.waitForTimeout(250);
    roleStates.push(await modalMetrics(page));
    const rolesOk = roleStates.every((state) =>
      !state.missing &&
      state.withinViewport &&
      !state.horizontalClip &&
      !state.pageOverflow &&
      state.scrollable &&
      (!device.touch || (state.minButtonHeight ?? 0) >= 36)
    );
    await report(
      'role-manager',
      rolesOk,
      rolesOk
        ? `${device.width}x${device.height}, fits (members and bans)`
        : JSON.stringify({ members: roleStates[0], bans: roleStates[1] })
    );

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // 6. Platform admin dashboard: stat cards, long tables, action buttons.
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Admin monitor' }).waitFor();
    await page.getByRole('heading', { name: 'Message reports' }).waitFor();
    await page.locator('.admin-table').first().waitFor();
    await page.waitForTimeout(250);
    const admin = await adminMetrics(page);
    const adminOk =
      admin.cards >= 5 &&
      admin.tables >= 2 &&
      !admin.pageOverflow &&
      admin.cardsOutside === 0 &&
      admin.clippedTables === 0 &&
      (!device.touch || (admin.minButtonHeight ?? 0) >= 36);
    await report(
      'admin-page',
      adminOk,
      adminOk ? `${device.width}x${device.height}, no overflow` : JSON.stringify(admin)
    );

    if (pageErrors.length) {
      await report('runtime', false, `page errors: ${pageErrors.slice(0, 2).join(' | ')}`);
    }
  } catch (error) {
    const state = await page.evaluate(() => ({
      path: location.pathname,
      sidebar: document.querySelector('.community-sidebar')?.className || '',
      buttons: [...document.querySelectorAll('button')]
        .filter((button) => button.offsetParent !== null)
        .map((button) => button.getAttribute('aria-label') || button.textContent.trim())
        .slice(0, 14)
    })).catch(() => ({}));
    const flowFile = path.join(ARTIFACT_DIR, device.name, 'flow.txt');
    await mkdir(path.dirname(flowFile), { recursive: true }).catch(() => {});
    await writeFile(flowFile, `${error.stack || error.message}\n\n${JSON.stringify(state, null, 2)}\n`).catch(() => {});
    await report('flow', false, `${error.message.split('\n')[0]} | ${JSON.stringify(state)}`);
  } finally {
    if (failures.length > failuresBefore) {
      const trace = path.join(ARTIFACT_DIR, device.name, 'trace.zip');
      await mkdir(path.dirname(trace), { recursive: true }).catch(() => {});
      await context.tracing.stop({ path: trace }).catch(() => {});
      console.log(`      trace: ${path.relative(ROOT, trace)}`);
    } else {
      await context.tracing.stop().catch(() => {});
    }
    await context.close();
  }
}

async function main() {
  // A stale screenshot from a previous local run must not be mistaken for this
  // run's evidence, so start from a clean artifact directory.
  await rm(ARTIFACT_DIR, { recursive: true, force: true });
  console.log(`Responsive smoke: ${DEVICES.length} viewports against ${BASE}\n`);

  const server = startPreview();
  let browser = null;
  const failures = [];

  try {
    await waitForPreview();
    browser = await launchBrowser();

    for (const device of DEVICES) {
      await runDevice(browser, device, failures);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }

  console.log('');
  if (failures.length) {
    console.error(`${failures.length} responsive check(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    await writeFile(path.join(ARTIFACT_DIR, 'failures.txt'), `${failures.join('\n')}\n`).catch(() => {});
    console.error(`Artifacts: ${path.relative(ROOT, ARTIFACT_DIR)}`);
    process.exit(1);
  }
  console.log('All responsive checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
