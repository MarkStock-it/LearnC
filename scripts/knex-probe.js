// Probe the actual knex insert result shape on the server
process.env.NODE_ENV = 'production';
const dbmod = require('/data/users/s25103705/learnc-app/backend/dist/db/knex.js');

(async () => {
  try {
    const db = dbmod.db ? dbmod.db() : dbmod.default?.();
    const uname = '__knexprobe_' + Date.now();
    const result = await db('users').insert({ username: uname, email: uname + '@example.edu' });
    console.log('typeof result:', typeof result);
    console.log('JSON result:', JSON.stringify(result));
    console.log('Array?', Array.isArray(result), 'result[0]:', JSON.stringify(result[0]), 'typeof:', typeof result[0]);
    if (result[0] && typeof result[0] === 'object') console.log('result[0].insertId:', result[0].insertId);
    await db('users').where({ username: uname }).del();
    console.log('cleanup ok');
  } catch (e) {
    console.error('PROBE ERROR:', e && e.message, e && e.code);
  }
  process.exit(0);
})();
