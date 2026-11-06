import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

test('API completa: acceso, selección, autorización, Start, ranking y Reset', async () => {
  const { server }=createServer();
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(route,body={},cookie='')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  try {
    const health=await fetch(base+'/api/health');
    assert.equal(health.status,200);
    assert.equal((await health.json()).status,'ok');
    const home=await fetch(base+'/');
    assert.equal(home.status,200);
    assert.match(await home.text(),/Summit Lab/);

    const nonadmin=await post('/api/login',{name:'Elena'});
    assert.equal(nonadmin.status,200);
    const userCookie=nonadmin.headers.get('set-cookie').split(';')[0];
    const player=(await nonadmin.json()).player;
    assert.equal(player.isAdmin,false);
    assert.equal((await post('/api/start',{},userCookie)).status,400); // acción rechazada
    const wrong=await post('/api/login',{name:'admin',password:'mala'});
    assert.equal(wrong.status,403);
    const admin=await post('/api/login',{name:'admin',password:'Admin2026'});
    assert.equal(admin.status,200);
    const adminCookie=admin.headers.get('set-cookie').split(';')[0];
    const streamController=new AbortController();
    const stream=await fetch(base+'/api/events',{headers:{Cookie:userCookie},signal:streamController.signal});
    assert.equal(stream.status,200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const streamReader=stream.body.getReader();
    const firstEvent=await streamReader.read();
    assert.equal(firstEvent.done,false);
    assert.match(new TextDecoder().decode(firstEvent.value), /stream abierto|event: state/);

    assert.equal((await post('/api/select',{algorithm:'annealing',params:{startTemp:17}},userCookie)).status,200);
    let streamed='';
    for(let i=0;i<5;i++){
      const result=await Promise.race([streamReader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Sin actualización SSE')),1600))]);
      streamed+=new TextDecoder().decode(result.value||new Uint8Array());
      if(streamed.includes('"algorithm":"annealing"'))break;
    }
    assert.match(streamed,/"algorithm":"annealing"/);
    const start=await post('/api/start',{},adminCookie);
    assert.equal(start.status,200);
    assert.equal((await start.json()).count,1);
    const current=await fetch(base+'/api/me',{headers:{Cookie:userCookie}});
    const currentData=await current.json();
    assert.equal(currentData.state.phase,'running');
    assert.equal(currentData.state.leaderboard.length,1);
    assert.equal(currentData.state.leaderboard[0].name,'Elena');
    assert.equal((await post('/api/select',{algorithm:'simple'},userCookie)).status,400);
    const reset=await post('/api/reset',{},adminCookie);
    const resetData=await reset.json();
    assert.equal(resetData.state.phase,'lobby');
    assert.equal(resetData.state.readyCount,0);
    assert.equal(resetData.state.players.find((p)=>p.id===player.id).algorithm,null);
    assert.equal(resetData.state.leaderboard.length,0);
    streamController.abort();
  } finally { server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve)); }
});
