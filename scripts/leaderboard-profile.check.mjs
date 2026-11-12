/** Real API + SQLite: persistent player keys, best-per-mission & continuous campaign. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root=await mkdtemp(join(tmpdir(),'rs-profile-'));
const dbPath=join(root,'scores.sqlite');
const socket=createServer();
await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;
await new Promise(r=>socket.close(r));
const url='http://127.0.0.1:'+port;
const run={difficulty:'rookie',character:'ignis'};
const base=[0,1500,2200,2800,3500,4200,5000];
let child;
async function start(){
 child=spawn(process.execPath,['server/leaderboard.mjs'],{
  env:{...process.env,RS_LEADERBOARD_PORT:String(port),RS_LEADERBOARD_DB:dbPath,
   RS_PUBLIC_HOST:'127.0.0.1',RS_MIN_RUN_MS:'1'},
  stdio:'pipe'
 });
 let logs='';child.stderr.on('data',s=>logs+=s);
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('API exited '+logs);
  try{if((await fetch(url+'/api/health')).ok)return}catch{}
  await new Promise(r=>setTimeout(r,40));
 }
 throw Error('API failed to start '+logs);
}
async function stop(){
 if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')});
 child=null;
}
async function post(path,body,origin=url){
 const r=await fetch(url+path,{method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
async function list(scope='all',difficulty='rookie'){
 const query=scope==='campaign'?'&scope=campaign':typeof scope==='number'?'&episode='+scope:'';
 const r=await fetch(url+'/api/leaderboard?difficulty='+difficulty+query);
 assert.equal(r.status,200);
 return r.json();
}
async function ticket(episode,playerToken,campaignId){
 const p=await post('/api/runs',{...run,episode,playerToken,...(campaignId?{campaignId}:{})});
 assert.equal(p.status,201,JSON.stringify(p));
 return p.body;
}
function score(episode,combatScore=1100,livesLeft=2){
 return combatScore+base[episode]+livesLeft*400+1800;
}
async function finish(episode,playerToken,t,nickname='Игрок-01',combat=1100){
 const payload={...run,episode,playerToken,token:t.token,nickname,
  combatScore:combat,score:score(episode,combat),livesLeft:2,elapsedSec:1};
 const result=await post('/api/leaderboard',payload);
 assert.equal(result.status,201,JSON.stringify(result));
 return {result:result.body,payload};
}
try{
 await start();
 let profile=await post('/api/players',{},'https://evil.example');
 assert.equal(profile.status,403);
 profile=await post('/api/players',{});
 assert.equal(profile.status,201);
 const key=profile.body.playerToken;
 assert.match(key,/^[A-Za-z0-9_-]{43}$/);
 const other=(await post('/api/players',{})).body.playerToken;
 assert.notEqual(key,other);
 const first=await ticket(1,key);
 assert.equal(typeof first.campaignId,'string');
 const stolen=await post('/api/leaderboard',{...run,episode:1,
  token:first.token,playerToken:other,nickname:'Fake',score:score(1),
  combatScore:1100,livesLeft:2,elapsedSec:1});
 assert.equal(stolen.status,422, 'Very early submission is rejected before ownership');
 await new Promise(r=>setTimeout(r,630));
 const denied=await post('/api/leaderboard',{...run,episode:1,
  token:first.token,playerToken:other,nickname:'Fake',score:score(1),
  combatScore:1100,livesLeft:2,elapsedSec:1});
 assert.equal(denied.status,403);
 const one=await finish(1,key,first);
 assert(one.result.improved);
 assert.equal(one.result.campaign.missions,1);
 assert.equal((await list('campaign')).entries.length,0);
 assert.equal((await list(1)).entries.length,1);
 assert.equal((await list(2)).entries.length,0);
 assert.equal((await list('all')).entries.length,1);
 assert.equal((await post('/api/leaderboard',one.payload)).status,409);
 let chain=first.campaignId;
 let total=score(1);
 for(let ep=2;ep<=6;ep++){
  const t=await ticket(ep,key,chain);
  assert.equal(t.campaignId,chain,'Sequential campaign must remain attached at episode '+ep);
  await new Promise(r=>setTimeout(r,630));
  const {result}=await finish(ep,key,t);
  total+=score(ep);
  assert.equal(result.campaign.totalScore,total);
  assert.equal(result.campaign.missions,ep);
  assert.equal(result.campaign.completed,ep===6);
  if(ep<6)assert.equal((await list('campaign')).entries.length,0);
 }
 let boards=await list('campaign');
 assert.equal(boards.entries.length,1);
 assert.equal(boards.entries[0].score,total);
 assert.equal(boards.entries[0].nickname,'Игрок-01');
 assert.equal((await list('all')).entries.length,1,'Six missions must not duplicate one player');
 for(let ep=1;ep<=6;ep++)assert.equal((await list(ep)).entries.length,1);
 // Free play (direct episode 6) must not become a six-mission campaign.
 const direct=await ticket(6,other,null);
 assert.equal(direct.campaignId,null);
 await new Promise(r=>setTimeout(r,630));
 await finish(6,other,direct,'Игрок-02');
 assert.equal((await list('campaign')).entries.length,1);
 // Repeating an episode with a LOWER score updates the nickname but not the personal best.
 const replay=await ticket(1,key);
 await new Promise(r=>setTimeout(r,630));
 const low=await finish(1,key,replay,'Новый позывной',0);
 assert.equal(low.result.improved,false);
 const best=await list(1);
 assert.equal(best.entries.length,1);
 assert.equal(best.entries[0].score,score(1));
 assert.equal(best.entries[0].nickname,'Новый позывной');
 assert.equal((await list('campaign')).entries[0].nickname,'Новый позывной');
 assert.equal((await list('all')).entries.length,2);
 await stop();
 await start();
 assert.equal((await list('campaign')).entries[0].score,total,'Campaign must survive reboot');
 assert.equal((await list(1)).entries[0].nickname,'Новый позывной','Player nickname survives reboot');
 const invalid=await fetch(url+'/api/leaderboard?difficulty=rookie&scope=campaign&episode=2');
 assert.equal(invalid.status,400);
 console.log('PASS: device identity, anti-impersonation, one personal best per episode, six-stage campaign proof, nickname updates, replay protection and SQLite restart');
}finally{await stop();await rm(root,{recursive:true,force:true})}
