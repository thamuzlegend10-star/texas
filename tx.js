/* Texas Hold'em online add-on: room codes via PeerJS. Host runs the game, friends take seats,
   empty seats stay empty. Clients only receive their own hole cards until showdown. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PFX = 'aurora-tx-', ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MU = '1d676475c53bd584694643e3', MC = 'HRo8LpXR0azCwMul';
  const ICE = [{ urls: 'stun:stun.relay.metered.ca:80' }, { urls: 'stun:stun.l.google.com:19302' },
    ...['turn:global.relay.metered.ca:80', 'turn:global.relay.metered.ca:80?transport=tcp', 'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp', 'turn:standard.relay.metered.ca:80', 'turn:standard.relay.metered.ca:443?transport=tcp']
      .map((u) => ({ urls: u, username: MU, credential: MC }))];
  const TX = window.TX = {};
  let peer = null, conns = [], hc = null, isHost = false, seat = 0, seats = [true, false, false, false, false];
  let running = false, code = '', asking = false, joinT = 0;
  const pend = {};

  const st = document.createElement('style');
  st.textContent = `#ov{position:fixed;inset:0;display:grid;place-items:center;background:#0b1411ee;z-index:9;padding:16px}
#ov .pn{max-width:380px;width:100%;background:#0f2a20;border:1px solid #fff2;border-radius:16px;padding:22px;text-align:center}
#ov h2{color:var(--gold);margin-bottom:10px}#ov p{margin:8px 0;opacity:.85}#ov ul{list-style:none;padding:0;margin:10px 0;text-align:left}
#ov li{padding:4px 0;border-bottom:1px solid #fff2}#ov .cd{font-size:2.2rem;font-weight:bold;letter-spacing:.25em;color:var(--gold)}
#ov input{width:100%;font:inherit;font-size:1.5rem;text-align:center;text-transform:uppercase;letter-spacing:.25em;padding:8px;border-radius:8px;border:1px solid #fff4;background:#0006;color:var(--ink);margin:8px 0}
#ov button{margin:4px}#ov button:disabled{opacity:.5;cursor:not-allowed}`;
  document.head.appendChild(st);

  const ov = (html) => {
    let e = $('ov');
    if (!e) { e = document.createElement('div'); e.id = 'ov'; document.body.appendChild(e); }
    e.innerHTML = '<div class="pn" role="dialog" aria-live="polite">' + html + '</div>';
  };
  const ovHide = () => { const e = $('ov'); if (e) e.remove(); };
  const note = (t) => { const e = $('xm'); if (e) e.textContent = t; };

  function stop() {
    clearTimeout(joinT);
    try { conns.forEach((c) => c.close()); } catch (e) {}
    try { if (hc) hc.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conns = []; hc = null; peer = null; running = false;
  }

  // screen 1: single player or friends
  TX.menu = () => {
    stop();
    ov(`<h2>♠ Texas Hold'em ♥</h2><p>How do you want to play?</p>
<button id="xb">Single player</button><button id="xf">Play with friends</button>`);
    $('xb').onclick = () => { ovHide(); main(); };
    $('xf').onclick = friends;
    $('xb').focus();
  };
  // screen 2: host a room or join one
  function friends() {
    stop();
    ov(`<h2>Play with friends</h2><p>Host a room and share the code, or join with a friend's code.</p>
<button id="xh">Host a room</button>
<input id="xi" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" aria-label="Room code">
<button id="xj">Join room</button><button id="xk">Back</button><p id="xm" role="status"></p>`);
    $('xh').onclick = host; $('xj').onclick = join; $('xk').onclick = TX.menu;
    $('xi').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  }

  function lobbyUI(msg) {
    const n = seats.filter(Boolean).length;
    ov(`<h2>Room</h2><p>Share this code</p><div class="cd" aria-label="Room code">${code}</div>
<ul>${seats.map((on, i) => `<li>${i === 0 ? 'Host' : 'Seat ' + (i + 1)}: ${on ? '<b>Player</b>' + (i === seat ? ' (you)' : '') : '<i>Empty</i>'}</li>`).join('')}</ul>
<p>Empty seats stay empty. No bots in online games.</p>
${isHost ? `<button id="xs"${n < 2 ? ' disabled' : ''}>Start game</button>` : '<p>Waiting for host to start…</p>'}
<button id="xc">Copy code</button><button id="xl">Leave</button><p id="xm" role="status">${msg || (isHost && n < 2 ? 'Waiting for at least one friend.' : '')}</p>`);
    if (isHost) $('xs').onclick = start;
    $('xc').onclick = () => { try { navigator.clipboard.writeText(code); note('Code copied.'); } catch (e) { note('Code: ' + code); } };
    $('xl').onclick = () => location.reload();
  }
  const lobby = () => { const m = { t: 'lobby', seats }; conns.forEach((c) => c.open && c.send(m)); lobbyUI(); };

  function host() {
    if (typeof Peer === 'undefined') return note('Online play needs internet.');
    stop(); isHost = true; seat = 0; seats = [true, false, false, false, false];
    code = Array.from({ length: 4 }, () => ABC[(Math.random() * ABC.length) | 0]).join('');
    peer = new Peer(PFX + code, { config: { iceServers: ICE } });
    peer.on('open', lobby);
    peer.on('error', (e) => e.type === 'unavailable-id' ? host() : note('Connection problem: ' + e.type));
    peer.on('connection', (c) => {
      c.on('open', () => {
        const s = [1, 2, 3, 4].find((i) => !seats[i]);
        if (running || s === undefined) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
        seats[s] = true; c.seat = s; conns.push(c); c.send({ t: 'hi', seat: s }); lobby();
      });
      c.on('data', (d) => onData(d, c));
      c.on('close', () => drop(c));
    });
  }

  function join() {
    const v = ($('xi').value || '').trim().toUpperCase();
    if (v.length !== 4) return note('Enter the 4-character code.');
    if (typeof Peer === 'undefined') return note('Online play needs internet.');
    stop(); isHost = false; code = v; note('Step 1/3: contacting server…');
    let opened = false;
    joinT = setTimeout(() => note(opened ? 'Room found but no direct link. Ask the host to keep the room screen open.' : 'Cannot reach the matchmaking server. Try another network.'), 12000);
    peer = new Peer({ config: { iceServers: ICE } });
    peer.on('error', (e) => note(e.type === 'peer-unavailable' ? 'Room not found.' : 'Connection problem: ' + e.type));
    peer.on('open', () => {
      opened = true; note('Step 2/3: finding room…');
      hc = peer.connect(PFX + code, { reliable: true });
      hc.on('open', () => { clearTimeout(joinT); note('Step 3/3: connected.'); });
      hc.on('data', (d) => onData(d, hc));
      hc.on('close', () => {
        if (running) ov('<h2>Host left</h2><button onclick="location.reload()">Back</button>');
        else { friends(); note('Host closed the room.'); }
      });
    });
  }

  function drop(c) {
    conns = conns.filter((x) => x !== c);
    if (c.seat == null) return;
    seats[c.seat] = false;
    if (running) {
      const p = P[c.seat]; p.human = false; p.absent = true; p.folded = true;
      L(p.n + ' left the table');
      const r = pend[c.seat];
      if (r) { delete pend[c.seat]; r({ t: 'f' }); }
      p.out = true;
      if (!conns.length) ov('<h2>Everyone left</h2><button onclick="location.reload()">Back</button>');
    } else lobby();
  }

  function onData(d, c) {
    if (d.t === 'a') {
      const r = pend[c.seat];
      if (!r) return;
      delete pend[c.seat];
      const a = d.a || {};
      r(a.t === 'r' && isFinite(a.to) ? { t: 'r', to: +a.to } : a.t === 'c' ? { t: 'c' } : { t: 'f' });
    } else if (d.t === 'hi') seat = d.seat;
    else if (d.t === 'lobby') { if (!running) { seats = d.seats; lobbyUI(); } }
    else if (d.t === 'go') { running = true; P.forEach((p) => { p.out = true; }); render(); ovHide(); }
    else if (d.t === 'st') apply(d);
    else if (d.t === 'full') { stop(); friends(); note('Room full or game already started.'); }
  }

  function start() {
    if (seats.filter(Boolean).length < 2) return;
    P.forEach((p, i) => { if (i === 0) p.n = 'Host'; else if (seats[i]) { p.n = 'Player' + (i + 1); p.human = true; } else { p.absent = true; p.out = true; p.chips = 0; p.folded = true; } });
    running = true;
    conns.forEach((c) => c.open && c.send({ t: 'go' }));
    ovHide(); main();
  }

  // host: ask a remote player for an action (auto-fold or check after 45 s)
  TX.ask = (k) => new Promise((res) => {
    pend[k] = res;
    setTimeout(() => { if (pend[k] === res) { delete pend[k]; res(P[k].bet >= cur ? { t: 'c' } : { t: 'f' }); } }, 45000);
  });

  // host: send each player a view with the table rotated so they sit at the bottom
  function view(s) {
    const rot = (i) => (i - s + 5) % 5;
    return {
      t: 'st', d: rot(dealer), tn: turn < 0 ? -1 : rot(turn), cur, mr: minRaise, rz: raises, st: street,
      msg, sa: showAll, b: board, lg: logs,
      P: [0, 1, 2, 3, 4].map((j) => {
        const q = (s + j) % 5, p = P[q], vis = q === s || (showAll && !p.folded);
        return { n: p.n, chips: p.chips, bet: p.bet, tot: p.tot, f: p.folded, ai: p.allin, w: p.win, o: p.out, nt: p.note, h: p.hole.map((c) => vis ? c : null) };
      }),
    };
  }
  TX.sync = () => {
    if (!isHost || !running) return;
    conns.forEach((c) => { if (c.open && c.seat != null) c.send(view(c.seat)); });
  };

  // client: rebuild the shared globals from the host's snapshot, then reuse the normal render
  function apply(d) {
    P = d.P.map((x) => ({ n: x.n, chips: x.chips, bet: x.bet, tot: x.tot, folded: x.f, allin: x.ai, win: x.w, out: x.o, note: x.nt, hole: x.h.map((c) => c || { r: 2, s: 0 }) }));
    board = d.b; dealer = d.d; turn = d.tn; cur = d.cur; minRaise = d.mr; raises = d.rz; street = d.st; msg = d.msg; showAll = d.sa; logs = d.lg;
    render();
    if (turn === 0) {
      if (!asking) { asking = true; getHuman().then((a) => { if (hc && hc.open) hc.send({ t: 'a', a }); }); }
    } else { asking = false; $('ctl').classList.add('off'); }
  }
})();
