import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';

// Node.js 24 includes node:sqlite. Only Nginx can reach this loopback service.
const HOST = '127.0.0.1';
const PORT = Number(process.env.RS_LEADERBOARD_PORT || 32741);
const DB_PATH = process.env.RS_LEADERBOARD_DB || '/var/lib/rust-signal/leaderboard/leaderboard.sqlite';
const PUBLIC_HOST = process.env.RS_PUBLIC_HOST || 'localhost';
const MIN_RUN_MS = Math.max(1, Number(process.env.RS_MIN_RUN_MS || 12000));
const MAX_SCORE = 2_000_000;
const MAX_ENTRIES = 15;
const CAMPAIGN_EXPIRY_MS = 4 * 60 * 60 * 1000;
const MAX_CAMPAIGN_SCORE = MAX_SCORE * 6;
const MAX_ACTIVE_SESSIONS = Math.max(4,Math.min(20000,Number(process.env.RS_MAX_SESSIONS||20000))||20000);
const EXPIRY_MS = 4 * 60 * 60 * 1000;
const DIFFICULTY = {
  rookie: { mult: 1, maxLives: 5 },
  veteran: { mult: 1.25, maxLives: 5 },
  hardcore: { mult: 2, maxLives: 5 },
};
const EP_BASE = { 1: 1500, 2: 2200, 3: 2800, 4: 3500, 5: 4200, 6: 5000 };
const EP_PAR = { 1: 240, 2: 260, 3: 280, 4: 300, 5: 320, 6: 340 };

// The database and its WAL files must never be readable by other users.
process.umask(0o077);
const dbDirectory = dirname(DB_PATH);
if (existsSync(dbDirectory) && lstatSync(dbDirectory).isSymbolicLink())
  throw new Error('Refusing symlinked database directory');
mkdirSync(dbDirectory, { recursive: true, mode: 0o700 });
if (existsSync(DB_PATH) && lstatSync(DB_PATH).isSymbolicLink())
  throw new Error('Refusing symlinked database file');
if (process.platform !== 'win32') chmodSync(dbDirectory, 0o700);
const db = new DatabaseSync(DB_PATH, { allowExtension: false, defensive: true, timeout: 3000 });
if (process.platform !== 'win32') chmodSync(DB_PATH, 0o600);
db.exec([
  'PRAGMA journal_mode=WAL;',
  'PRAGMA busy_timeout=3000;',
  'PRAGMA trusted_schema=OFF;',
  'PRAGMA journal_size_limit=4194304;',
  'PRAGMA max_page_count=16384;',
  'PRAGMA wal_autocheckpoint=250;',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, episode INTEGER NOT NULL, difficulty TEXT NOT NULL, character TEXT NOT NULL, started_ms INTEGER NOT NULL, consumed_ms INTEGER);',
  'CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, score INTEGER NOT NULL, episode INTEGER NOT NULL, character TEXT NOT NULL, difficulty TEXT NOT NULL, lives_left INTEGER NOT NULL, elapsed_sec INTEGER NOT NULL, date_iso TEXT NOT NULL);',
  'CREATE INDEX IF NOT EXISTS scores_rank ON scores(difficulty,score DESC,elapsed_sec ASC,episode DESC,date_iso DESC);',
  'CREATE INDEX IF NOT EXISTS sessions_by_age ON sessions(started_ms DESC);',
].join('\n'));
// Preserve the original scores/sessions tables and existing leaderboard records.
db.exec([
  'CREATE TABLE IF NOT EXISTS players (owner_hash TEXT PRIMARY KEY, nickname TEXT NOT NULL DEFAULT \'Игрок\', created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS player_scores (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, score INTEGER NOT NULL, episode INTEGER NOT NULL, character TEXT NOT NULL, difficulty TEXT NOT NULL, lives_left INTEGER NOT NULL, elapsed_sec INTEGER NOT NULL, date_iso TEXT NOT NULL, UNIQUE(owner_hash,difficulty,episode));',
  'CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, difficulty TEXT NOT NULL, character TEXT NOT NULL, next_episode INTEGER NOT NULL, total_score INTEGER NOT NULL, total_elapsed_sec INTEGER NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, completed_ms INTEGER);',
  'CREATE TABLE IF NOT EXISTS campaign_bests (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, difficulty TEXT NOT NULL, character TEXT NOT NULL, score INTEGER NOT NULL, elapsed_sec INTEGER NOT NULL, date_iso TEXT NOT NULL, UNIQUE(owner_hash,difficulty));',
  'CREATE INDEX IF NOT EXISTS player_scores_rank ON player_scores(difficulty,episode,score DESC,elapsed_sec ASC);',
  'CREATE INDEX IF NOT EXISTS campaigns_age ON campaigns(updated_ms);',
  'CREATE INDEX IF NOT EXISTS campaign_bests_rank ON campaign_bests(difficulty,score DESC,elapsed_sec ASC);'
].join('\n'));
for (const name of ['owner_hash','campaign_id']) {
  const fields = db.prepare('PRAGMA table_info(sessions)').all().map(col => col.name);
  if (!fields.includes(name)) db.exec('ALTER TABLE sessions ADD COLUMN ' + name + ' TEXT');
}
const selectPlayer = db.prepare('SELECT owner_hash,nickname FROM players WHERE owner_hash=?');
const addPlayer = db.prepare('INSERT INTO players(owner_hash,nickname,created_ms,updated_ms) VALUES(?,?,?,?)');
const renamePlayer = db.prepare('UPDATE players SET nickname=?,updated_ms=? WHERE owner_hash=?');
const getPlayerScore = db.prepare('SELECT id FROM player_scores WHERE owner_hash=? AND difficulty=? AND episode=?');
const getPlayerScoreEntry = db.prepare('SELECT s.id,p.nickname,s.score,s.episode,s.character,s.difficulty,s.lives_left AS livesLeft,s.elapsed_sec AS elapsedSec,s.date_iso AS dateIso FROM player_scores s JOIN players p ON s.owner_hash=p.owner_hash WHERE s.owner_hash=? AND s.difficulty=? AND s.episode=?');
const upsertPlayerScore = db.prepare(`
 INSERT INTO player_scores(id,owner_hash,score,episode,character,difficulty,lives_left,elapsed_sec,date_iso)
 VALUES(?,?,?,?,?,?,?,?,?)
 ON CONFLICT(owner_hash,difficulty,episode) DO UPDATE SET
 id=excluded.id,score=excluded.score,character=excluded.character,lives_left=excluded.lives_left,
 elapsed_sec=excluded.elapsed_sec,date_iso=excluded.date_iso
 WHERE excluded.score>player_scores.score OR (excluded.score=player_scores.score AND excluded.elapsed_sec<player_scores.elapsed_sec)`);
const selectMissionScores = db.prepare('SELECT s.id,p.nickname,s.score,s.episode,s.character,s.difficulty,s.lives_left AS livesLeft,s.elapsed_sec AS elapsedSec,s.date_iso AS dateIso FROM player_scores s JOIN players p ON s.owner_hash=p.owner_hash WHERE s.difficulty=? AND s.episode=? ORDER BY s.score DESC,s.elapsed_sec ASC LIMIT ?');
const selectLegacyMission = db.prepare('SELECT id,nickname,score,episode,character,difficulty,lives_left AS livesLeft,elapsed_sec AS elapsedSec,date_iso AS dateIso FROM scores WHERE difficulty=? AND episode=? ORDER BY score DESC,elapsed_sec ASC LIMIT ?');
const selectPlayerOverall = db.prepare(`
 SELECT id,nickname,score,episode,character,difficulty,livesLeft,elapsedSec,dateIso FROM (
   SELECT s.id,p.nickname,s.score,s.episode,s.character,s.difficulty,s.lives_left AS livesLeft,
     s.elapsed_sec AS elapsedSec,s.date_iso AS dateIso,
     ROW_NUMBER() OVER (PARTITION BY s.owner_hash ORDER BY s.score DESC,s.elapsed_sec ASC,s.episode DESC) AS pos
   FROM player_scores s JOIN players p ON s.owner_hash=p.owner_hash WHERE s.difficulty=?
 ) WHERE pos=1 ORDER BY score DESC,elapsedSec ASC LIMIT ?`);
const selectCampaignTop = db.prepare('SELECT c.id,p.nickname,c.score,6 AS episode,c.character,c.difficulty,0 AS livesLeft,c.elapsed_sec AS elapsedSec,c.date_iso AS dateIso FROM campaign_bests c JOIN players p ON c.owner_hash=p.owner_hash WHERE c.difficulty=? ORDER BY c.score DESC,c.elapsed_sec ASC LIMIT ?');
const selectCampaign = db.prepare('SELECT * FROM campaigns WHERE id=?');
const insertCampaign = db.prepare('INSERT INTO campaigns(id,owner_hash,difficulty,character,next_episode,total_score,total_elapsed_sec,created_ms,updated_ms) VALUES(?,?,?,?,1,0,0,?,?)');
const advanceCampaign = db.prepare('UPDATE campaigns SET next_episode=?,total_score=?,total_elapsed_sec=?,updated_ms=?,completed_ms=? WHERE id=? AND next_episode=? AND completed_ms IS NULL');
const cleanupCampaigns = db.prepare('DELETE FROM campaigns WHERE updated_ms<?');
const capCampaigns = db.prepare('DELETE FROM campaigns WHERE id IN (SELECT id FROM campaigns WHERE completed_ms IS NULL ORDER BY updated_ms DESC LIMIT -1 OFFSET 20000)');
const upsertCampaignBest = db.prepare(`
 INSERT INTO campaign_bests(id,owner_hash,difficulty,character,score,elapsed_sec,date_iso)
 VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(owner_hash,difficulty) DO UPDATE SET
 id=excluded.id,character=excluded.character,score=excluded.score,
 elapsed_sec=excluded.elapsed_sec,date_iso=excluded.date_iso
 WHERE excluded.score>campaign_bests.score OR
 (excluded.score=campaign_bests.score AND excluded.elapsed_sec<campaign_bests.elapsed_sec)`);
const selectSession = db.prepare('SELECT * FROM sessions WHERE token_hash=?');
const consumeSession = db.prepare('UPDATE sessions SET consumed_ms=? WHERE token_hash=? AND consumed_ms IS NULL');
const insertScore = db.prepare('INSERT INTO scores(id,nickname,score,episode,character,difficulty,lives_left,elapsed_sec,date_iso) VALUES(?,?,?,?,?,?,?,?,?)');
const selectTop = db.prepare('SELECT id,nickname,score,episode,character,difficulty,lives_left AS livesLeft,elapsed_sec AS elapsedSec,date_iso AS dateIso FROM scores WHERE difficulty=? ORDER BY score DESC,elapsed_sec ASC,episode DESC,date_iso DESC LIMIT ?');
const trimScores = db.prepare('DELETE FROM scores WHERE difficulty=? AND id NOT IN (SELECT id FROM scores WHERE difficulty=? ORDER BY score DESC,elapsed_sec ASC,episode DESC,date_iso DESC LIMIT ?)');
const expireSessions = db.prepare('DELETE FROM sessions WHERE started_ms < ?');
const capSessions = db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY started_ms DESC, rowid DESC LIMIT -1 OFFSET ?)');
const insertSession = db.prepare('INSERT INTO sessions(token_hash,episode,difficulty,character,started_ms,owner_hash,campaign_id) VALUES(?,?,?,?,?,?,?)');
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(payload)});
  res.end(payload);
}
function validDifficulty(d) { return Object.prototype.hasOwnProperty.call(DIFFICULTY, d); }
function validEpisode(n) { return Number.isInteger(n) && n >= 1 && n <= 6; }
function validCharacter(c) { return c === 'ignis' || c === 'volt'; }
function validOrigin(req) {
  try {
    const origin = new URL(String(req.headers.origin || ''));
    const host = String(req.headers.host || '').split(':')[0];
    return (origin.protocol === 'https:' || origin.protocol === 'http:')
      && origin.hostname === (PUBLIC_HOST === '*' ? host : PUBLIC_HOST) && host === (PUBLIC_HOST === '*' ? host : PUBLIC_HOST);
  } catch { return false; }
}
function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g,' ').trim().slice(0,16);
}
function integerInRange(v, min, max) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
}
function calculateScore(input, diff) {
  const mult = DIFFICULTY[diff].mult;
  const timeBonus = Math.round(Math.max(0,Math.min(180,EP_PAR[input.episode]-input.elapsedSec))*10*mult);
  return input.combatScore + Math.round(EP_BASE[input.episode]*mult)
    + Math.round(input.livesLeft*400*mult) + timeBonus;
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>{
      body+=chunk.toString();
      if (Buffer.byteLength(body)>2048) {
        reject(Object.assign(new Error('Слишком большой запрос'),{status:413}));
        req.destroy();
      }
    });
    req.on('end',()=>{
      try { const json=JSON.parse(body); if(!json||typeof json!=='object'||Array.isArray(json)) throw Error(); resolve(json); }
      catch { reject(Object.assign(new Error('Некорректный JSON'),{status:400})); }
    });
    req.on('error',reject);
  });
}
const throttle = new Map();
let issuedSinceTrim = 0;
function allowRequest(req,type) {
  const ip=String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'local').slice(0,128);
  const key=type+':'+ip,now=Date.now();
  const data=throttle.get(key);
  if(!data||now>=data.until) {
    throttle.set(key,{count:1,until:now+3_600_000});
    if(throttle.size>10000) {
      for(const[k,v]of throttle)if(v.until<=now)throttle.delete(k);
      // Prevent unbounded memory from untrusted IP keys.
      while(throttle.size>10000)throttle.delete(throttle.keys().next().value);
    }
    return true;
  }
  data.count++;
  return data.count<=(type==='start'?100:type==='profile'?30:40);
}
function validPlayerToken(token) {
  return typeof token==='string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function topEntries(diff,scope='all',episode=null){
  if(scope==='campaign') return selectCampaignTop.all(diff,MAX_ENTRIES);
  const legacy=scope==='episode'?selectLegacyMission.all(diff,episode,MAX_ENTRIES):selectTop.all(diff,MAX_ENTRIES);
  const modern=scope==='episode'?selectMissionScores.all(diff,episode,MAX_ENTRIES):selectPlayerOverall.all(diff,MAX_ENTRIES);
  return legacy.concat(modern).sort((a,b)=>b.score-a.score || a.elapsedSec-b.elapsedSec || b.episode-a.episode || b.dateIso.localeCompare(a.dateIso)).slice(0,MAX_ENTRIES);
}
async function handler(req,res){
  const url=new URL(req.url||'/','http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')
    return send(res,200,{ok:true,service:'rust-signal-leaderboard',mode:'global'});
  if(req.method==='GET'&&url.pathname==='/api/leaderboard'){
    const difficulty=url.searchParams.get('difficulty')||'veteran';
    if(!validDifficulty(difficulty))return send(res,400,{error:'Неизвестная сложность'});
    const epRaw=url.searchParams.get('episode');
    const scope=url.searchParams.get('scope')||(epRaw?'episode':'all');
    const episode=epRaw===null?null:Number(epRaw);
    if(!['all','episode','campaign'].includes(scope)||(scope==='episode'&&!validEpisode(episode))
      ||(scope!=='episode'&&epRaw!==null))
      return send(res,400,{error:'Неизвестный раздел рейтинга'});
    return send(res,200,{difficulty,entries:topEntries(difficulty,scope,episode),limit:MAX_ENTRIES,scope,episode});
  }
  if(req.method==='POST'&&url.pathname==='/api/players'){
    if(!validOrigin(req))return send(res,403,{error:'Недопустимый источник запроса'});
    if(!allowRequest(req,'profile'))return send(res,429,{error:'Слишком частые запросы'});
    if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')
      return send(res,415,{error:'Требуется JSON'});
    try { await readBody(req); } catch(e) { return send(res,e.status||400,{error:e.message||'Ошибка запроса'}); }
    const token=randomBytes(32).toString('base64url'),now=Date.now();
    addPlayer.run(tokenHash(token),'Игрок',now,now);
    return send(res,201,{playerToken:token});
  }
  if(req.method==='POST'&&(url.pathname==='/api/runs'||url.pathname==='/api/leaderboard')){
    if(!validOrigin(req))return send(res,403,{error:'Недопустимый источник запроса'});
    if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')
      return send(res,415,{error:'Требуется JSON'});
    const type=url.pathname==='/api/runs'?'start':'submit';
    if(!allowRequest(req,type))return send(res,429,{error:'Слишком частые запросы. Попробуйте позже.'});
    let body;
    try{body=await readBody(req);}catch(e){return send(res,e.status||400,{error:e.message||'Ошибка запроса'});}
    if(type==='start'){
      if(!validEpisode(body.episode)||!validDifficulty(body.difficulty)||!validCharacter(body.character))
        return send(res,400,{error:'Некорректные параметры миссии'});
      let ownerHash=null,campaignId=null;
      if(body.playerToken!==undefined){
        if(!validPlayerToken(body.playerToken))return send(res,403,{error:'Неверный ключ игрока'});
        ownerHash=tokenHash(body.playerToken);
        if(!selectPlayer.get(ownerHash))return send(res,403,{error:'Ключ игрока неизвестен'});
      }
      const token=randomBytes(32).toString('base64url');
      const hash=tokenHash(token);
      const now=Date.now();
      expireSessions.run(now-EXPIRY_MS);
      if(ownerHash){
        if(body.episode===1){
          campaignId=randomUUID();
          cleanupCampaigns.run(now-CAMPAIGN_EXPIRY_MS);
          capCampaigns.run();
          insertCampaign.run(campaignId,ownerHash,body.difficulty,body.character,now,now);
        } else if(typeof body.campaignId==='string'&&body.campaignId.length===36){
          const c=selectCampaign.get(body.campaignId);
          if(c&&c.owner_hash===ownerHash&&c.difficulty===body.difficulty&&c.character===body.character
            &&c.next_episode===body.episode&&c.completed_ms===null&&c.updated_ms>now-CAMPAIGN_EXPIRY_MS)
              campaignId=c.id;
        }
      }
      insertSession.run(hash,body.episode,body.difficulty,body.character,now,ownerHash,campaignId);
      issuedSinceTrim++;
      if(issuedSinceTrim>=Math.min(64,Math.max(1,Math.floor(MAX_ACTIVE_SESSIONS/4)))) {
        capSessions.run(MAX_ACTIVE_SESSIONS);
        issuedSinceTrim=0;
      }
      return send(res,201,{token,campaignId,expiresAt:new Date(now+EXPIRY_MS).toISOString()});
    }
    const nickname=sanitizeNickname(body.nickname);
    if(nickname.length<2||nickname.length>16)return send(res,400,{error:'Позывной: от 2 до 16 символов'});
    if(!validEpisode(body.episode)||!validDifficulty(body.difficulty)||!validCharacter(body.character)
      ||!integerInRange(body.score,0,MAX_SCORE)||!integerInRange(body.combatScore,0,MAX_SCORE)
      ||!integerInRange(body.elapsedSec,1,14400)
      ||!integerInRange(body.livesLeft,0,DIFFICULTY[body.difficulty].maxLives)
      ||typeof body.token!=='string'||body.token.length>128)
        return send(res,400,{error:'Некорректные данные результата'});
    if(calculateScore(body,body.difficulty)!==body.score)
      return send(res,422,{error:'Счёт не совпадает с правилами начисления очков'});
    const now=Date.now(),hash=tokenHash(body.token);
    let entry,rank,improved=true,campaign=null;
    try{
      db.exec('BEGIN IMMEDIATE');
      const session=selectSession.get(hash);
      if(!session||session.consumed_ms!==null||session.started_ms<now-EXPIRY_MS)
        throw Object.assign(new Error('Попытка уже завершена или срок её действия истёк'),{status:409});
      if(session.episode!==body.episode||session.difficulty!==body.difficulty||session.character!==body.character)
        throw Object.assign(new Error('Параметры попытки не совпадают'),{status:422});
      // Single-use, time-bound tickets mitigate scripted spam, but cannot
      // prove legitimate browser gameplay without server-authoritative rules.
      if(now-session.started_ms<MIN_RUN_MS||now-session.started_ms<body.elapsedSec*600)
        throw Object.assign(new Error('Время попытки не подтверждено сервером'),{status:422});
      const ownerHash=session.owner_hash;
      if(ownerHash){
        if(!validPlayerToken(body.playerToken)||tokenHash(body.playerToken)!==ownerHash||!selectPlayer.get(ownerHash))
          throw Object.assign(new Error('Ключ игрока не соответствует попытке'),{status:403});
      } else if(body.playerToken!==undefined){
        throw Object.assign(new Error('У попытки нет зарегистрированного игрока'),{status:403});
      }
      const id=randomUUID();
      entry={id,nickname,score:body.score,episode:body.episode,character:body.character,
        difficulty:body.difficulty,livesLeft:body.livesLeft,elapsedSec:body.elapsedSec,dateIso:new Date(now).toISOString()};
      if(ownerHash){
        renamePlayer.run(nickname,now,ownerHash);
        const outcome=upsertPlayerScore.run(id,ownerHash,body.score,body.episode,body.character,
          body.difficulty,body.livesLeft,body.elapsedSec,entry.dateIso);
        improved=outcome.changes===1;
        entry=getPlayerScoreEntry.get(ownerHash,body.difficulty,body.episode);
        if(session.campaign_id){
          const c=selectCampaign.get(session.campaign_id);
          if(c&&c.owner_hash===ownerHash&&c.difficulty===body.difficulty&&c.character===body.character
            &&c.next_episode===body.episode&&c.completed_ms===null&&c.updated_ms>now-CAMPAIGN_EXPIRY_MS){
            const total=c.total_score+body.score;
            const time=c.total_elapsed_sec+body.elapsedSec;
            if(total>MAX_CAMPAIGN_SCORE)throw Object.assign(new Error('Превышен лимит очков кампании'),{status:422});
            const completed=body.episode===6;
            advanceCampaign.run(body.episode+1,total,time,now,completed?now:null,c.id,c.next_episode);
            campaign={completed,missions:body.episode,totalScore:total,elapsedSec:time};
            if(completed){
              upsertCampaignBest.run(c.id,ownerHash,body.difficulty,body.character,total,time,entry.dateIso);
              const final=topEntries(body.difficulty,'campaign');
              campaign.rank=final.findIndex(x=>x.id===c.id)+1||null;
              if(campaign.rank===0)campaign.rank=null;
            }
          }
        }
      } else {
        insertScore.run(id,nickname,body.score,body.episode,body.character,body.difficulty,body.livesLeft,body.elapsedSec,entry.dateIso);
        trimScores.run(body.difficulty,body.difficulty,MAX_ENTRIES);
      }
      consumeSession.run(now,hash);
      const entries=topEntries(body.difficulty,'episode',body.episode),i=entries.findIndex(x=>x.id===entry.id);
      rank=i<0?null:i+1;
      db.exec('COMMIT');
    }catch(e){
      db.exec('ROLLBACK');
      return send(res,e.status||500,{error:e.status?e.message:'Ошибка записи результата'});
    }
    return send(res,201,{entry,rank,improved,campaign,
      entries:topEntries(body.difficulty,'episode',body.episode),scope:'episode'});
  }
  return send(res,404,{error:'Неизвестный адрес API'});
}
const server=createServer((req,res)=>{
  Promise.resolve(handler(req,res)).catch(e=>{
    console.error('API error',e);
    if(!res.headersSent)send(res,500,{error:'Внутренняя ошибка сервера'});
  });
});
server.maxConnections=256;
server.keepAliveTimeout=4000;
server.requestTimeout=10000;
server.headersTimeout=12000;
server.listen(PORT,HOST,()=>console.log('Rust Signal global leaderboard on '+HOST+':'+PORT));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
