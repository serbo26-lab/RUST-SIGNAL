/** Integration test: real Node HTTP API and SQLite, no browser or mock DB. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const temp = await mkdtemp(join(tmpdir(), 'rs-global-leaderboard-'));
const dbPath = join(temp, 'scores.sqlite');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = 'http://127.0.0.1:' + port;
let child;

async function start() {
  child = spawn(process.execPath, ['server/leaderboard.mjs'], {
    env: { ...process.env, RS_LEADERBOARD_PORT: String(port),
      RS_LEADERBOARD_DB: dbPath, RS_PUBLIC_HOST: '127.0.0.1',
      RS_MIN_RUN_MS: '50', RS_MAX_SESSIONS: '6' },
    stdio: 'pipe',
  });
  let log = '';
  child.stderr.on('data', b => log += b.toString());
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('API exited: ' + log);
    try {
      if ((await fetch(origin + '/api/health')).ok) return;
    } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('API did not start: ' + log);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const c = child;
  await new Promise(resolve => {
    c.once('exit', resolve);
    c.kill('SIGTERM');
  });
  child = null;
}
async function post(path, body, requestOrigin = origin) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: {'Origin': requestOrigin, 'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  return {status:response.status, body:await response.json()};
}

try {
  await start();
  let response = await fetch(origin + '/api/leaderboard?difficulty=veteran');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, []);

  const run = {episode:1,difficulty:'veteran',character:'ignis'};
  assert.equal((await fetch(origin + '/api/leaderboard?difficulty=unknown')).status,400);
  // Force session eviction under a small test quota to verify disk bounds.
  const issued = [];
  for (let i=0;i<9;i++) {
    const resp=await post('/api/runs',run);
    assert.equal(resp.status,201);
    issued.push(resp.body.token);
  }
  assert.equal((await post('/api/runs', run, 'https://evil.example')).status, 403);
  assert.equal((await post('/api/runs', {...run,episode:99})).status, 400);
  const evicted = await post('/api/leaderboard',{
    token:issued[0],nickname:'Test_player',score:6125,combatScore:1000,
    episode:1,difficulty:'veteran',character:'ignis',livesLeft:2,elapsedSec:1,
  });
  assert.equal(evicted.status,409,'Old session should be evicted');
  const created = await post('/api/runs', run);
  assert.equal(created.status, 201);
  assert.equal(typeof created.body.token, 'string');
  assert(created.body.token.length > 32);

  const submission = {token:created.body.token, nickname:'  Иван_26  ',
    score:6125,combatScore:1000,episode:1,character:'ignis',
    difficulty:'veteran',livesLeft:2,elapsedSec:1};
  const tooEarly = await post('/api/leaderboard', submission);
  assert.equal(tooEarly.status, 422, 'Immediate submissions must be rejected');
  await new Promise(resolve=>setTimeout(resolve, 720));
  assert.equal((await post('/api/leaderboard', {...submission,score:999999})).status, 422,
    'Unverifiable score must be rejected');
  const saved = await post('/api/leaderboard', submission);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.rank, 1);
  assert.equal(saved.body.entry.nickname, 'Иван_26');
  assert.equal((await post('/api/leaderboard', submission)).status, 409,
    'Token must be single-use');
  response = await fetch(origin + '/api/leaderboard?difficulty=veteran');
  const board = await response.json();
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].score, 6125);
  assert.equal((await (await fetch(origin + '/api/leaderboard?difficulty=hardcore')).json()).entries.length, 0);

  const run5Res = await fetch(origin + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ episode: 5, difficulty: 'hardcore', character: 'volt' }),
  });
  const run6Res = await fetch(origin + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ episode: 6, difficulty: 'hardcore', character: 'ignis' }),
  });
  assert.equal(run5Res.status, 201);
  assert.equal(run6Res.status, 201);
  const run5Data = await run5Res.json();
  const run6Data = await run6Res.json();
  await new Promise((r) => setTimeout(r, 700));
  for (const sub of [
    { token: run5Data.token, episode: 5, character: 'volt', nickname: 'BastionAce', score: 13800, livesLeft: 1, combatScore: 1000, elapsedSec: 1 },
    { token: run6Data.token, episode: 6, character: 'ignis', nickname: 'BeaconHero', score: 18000, livesLeft: 3, combatScore: 2000, elapsedSec: 1 },
  ]) {
    const postRes = await fetch(origin + '/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        token: sub.token,
        nickname: sub.nickname,
        score: sub.score,
        episode: sub.episode,
        character: sub.character,
        difficulty: 'hardcore',
        livesLeft: sub.livesLeft,
        combatScore: sub.combatScore,
        elapsedSec: sub.elapsedSec,
      }),
    });
    assert.equal(postRes.status, 201, `Episode ${sub.episode} hardcore submission failed`);
  }
  const hardcoreBoard = await (await fetch(origin + '/api/leaderboard?difficulty=hardcore')).json();
  assert.equal(hardcoreBoard.entries.length, 2);
  assert.equal(hardcoreBoard.entries[0].episode, 6);
  assert.equal(hardcoreBoard.entries[1].episode, 5);

  await stop();
  await start();
  const afterRestart = await (await fetch(origin + '/api/leaderboard?difficulty=veteran')).json();
  assert.equal(afterRestart.entries.length, 1, 'SQLite leaderboard must survive restart');
  const sqlToken=(await post('/api/runs',run)).body.token;
  await new Promise(resolve=>setTimeout(resolve,720));
  const injected=await post('/api/leaderboard',{
    ...submission,token:sqlToken,nickname:"Robert'); DROP TABLE scores;--",
  });
  assert.equal(injected.status,201,'Parameterized nickname remains safe');
  assert.equal((await (await fetch(origin+'/api/leaderboard?difficulty=veteran')).json()).entries.length,2);
  if(process.platform!=='win32'){
    const {stat}=await import('node:fs/promises');
    const mode=(await stat(dbPath)).mode;
    assert.equal(mode & 0o077,0,'SQLite DB readable by group/other');
  }
  console.log('PASS: server-authoritative session tickets, score formula, rate inputs, replay rejection, cross-origin rejection, separate boards and SQLite persistence');
} finally {
  await stop();
  await rm(temp, {recursive:true,force:true});
}
