/**
 * The route table, frozen so a refactor cannot drop an endpoint.
 *
 * Step 6 moves handlers into services. The one failure that a unit test cannot
 * see from inside a module is a route that quietly disappears with the code
 * that used to define it. This script reads every router the application
 * mounts, writes the method and path list to a fixture, and the unit test
 * compares the live table with that fixture.
 *
 *   node scripts/route-snapshot.js           # print the table and compare
 *   node scripts/route-snapshot.js --write   # record the current table
 *
 * The mount list is written out here on purpose. Reading it out of
 * `app._router` means depending on Express internals and on the shape of a
 * mount regexp; naming the mounts is the same fact in a form a reader can check
 * against `server/app.js` in seconds.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'fixtures', 'routes.json');

const MOUNTS = [
  ['/api/auth', '../server/routes/authRoutes'],
  ['/api/posts', '../server/routes/postRoutes'],
  ['/api/posts/:postId/comments', '../server/routes/commentRoutes'],
  ['/api/users', '../server/routes/userRoutes'],
  ['/api/communities', '../server/routes/communityRoutes'],
  ['/api/lfg', '../server/routes/lfgRoutes'],
  ['/api/notifications', '../server/routes/notificationRoutes'],
  ['/api/account', '../server/routes/accountRoutes'],
  ['/api/invitations', '../server/routes/invitationRoutes'],
  ['/api/squad-chats', '../server/routes/squadChatRoutes'],
  ['/api/games', '../server/routes/gameRoutes'],
  ['/api/admin', '../server/routes/adminRoutes'],
  ['/api/bot', '../server/routes/botRoutes'],
  ['/api/messages', '../server/routes/dmRoutes'],
  ['/api/business', '../server/routes/businessRoutes'],
  ['/api/discover', '../server/routes/discoverRoutes'],
  ['/api/stories', '../server/routes/storyRoutes'],
  ['/api/channels', '../server/routes/broadcastRoutes'],
];

const join = (mount, routePath) => {
  const tail = routePath === '/' ? '' : routePath;
  return `${mount}${tail}` || '/';
};

/** Every method and path the application answers, sorted. */
function routeTable() {
  const table = [];
  for (const [mount, modulePath] of MOUNTS) {
    const router = require(modulePath);
    for (const layer of router.stack || []) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        table.push(`${method.toUpperCase()} ${join(mount, layer.route.path)}`);
      }
    }
  }
  return [...new Set(table)].sort();
}

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function writeFixture(routes) {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, `${JSON.stringify(routes, null, 2)}\n`);
}

function diff(live, recorded) {
  const liveSet = new Set(live);
  const recordedSet = new Set(recorded);
  return {
    added: live.filter((route) => !recordedSet.has(route)),
    removed: recorded.filter((route) => !liveSet.has(route)),
  };
}

if (require.main === module) {
  const routes = routeTable();
  if (process.argv.includes('--write')) {
    writeFixture(routes);
    console.log(`recorded ${routes.length} routes in ${FIXTURE}`);
  } else {
    const { added, removed } = diff(routes, readFixture());
    for (const route of added) console.log(`+ ${route}`);
    for (const route of removed) console.log(`- ${route}`);
    console.log(`${routes.length} routes, ${added.length} added, ${removed.length} removed`);
    if (added.length || removed.length) process.exitCode = 1;
  }
}

module.exports = { MOUNTS, FIXTURE, routeTable, readFixture, writeFixture, diff };
