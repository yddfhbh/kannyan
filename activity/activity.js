import { Chess } from 'chess.js';

const files = 'abcdefgh';
const pieceNames = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };
const tokenKey = 'chessle_session_token';
function safeSessionGet() { try { return sessionStorage.getItem(tokenKey); } catch { return null; } }
function safeSessionSet(value) { try { sessionStorage.setItem(tokenKey, value); } catch {} }
function safeSessionRemove() { try { sessionStorage.removeItem(tokenKey); } catch {} }
let discordSdk = null; let sessionToken = safeSessionGet(); let puzzle = null; let chess = new Chess(); let selected = null; let history = []; let lastMove = null; let rows = [];
const $ = (id) => document.getElementById(id); const boardEl = $('board');
function measureLayout() {
  const app = document.querySelector('.app');
  const masthead = document.querySelector('.masthead');
  const column = document.querySelector('.board-column');
  const status = $('status');
  const actions = document.querySelector('.actions');

  if (
    !app || !masthead || !column ||
    !status || !actions || $('game').hidden
  ) return;

  const px = value => parseFloat(value) || 0;

  const appStyle = getComputedStyle(app);
  const headerStyle = getComputedStyle(masthead);
  const columnStyle = getComputedStyle(column);

  const width = column.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) return;

  // Total viewport height occupied by elements other
  // than the chessboard.
  const fixedHeight =
    px(appStyle.paddingTop) +
    px(appStyle.paddingBottom) +
    masthead.getBoundingClientRect().height +
    px(headerStyle.marginBottom) +
    status.getBoundingClientRect().height +
    actions.getBoundingClientRect().height +
    2 * px(columnStyle.rowGap || columnStyle.gap) +
    16;

  // Fit normal windows, but maintain a readable board
  // on short windows and allow vertical scrolling.
  const availableHeight =
    Math.max(0, app.clientHeight - fixedHeight);

  const minBoardSize = 360;
  const maxBoardSize = 480;

  const size = Math.floor(Math.min(
    width,
    maxBoardSize,
    Math.max(minBoardSize, availableHeight)
  ));

  const value = `${size}px`;

  if (boardEl.style.getPropertyValue('--board-size') !== value) {
    boardEl.style.setProperty('--board-size', value);
  }
}

const layoutObserver = new ResizeObserver(measureLayout);

[
  document.documentElement,
  document.querySelector('.app'),
  document.querySelector('.masthead'),
  document.querySelector('.game-layout'),
  document.querySelector('.board-column'),
  $('status'),
  document.querySelector('.actions')
].filter(Boolean).forEach(element => {
  layoutObserver.observe(element);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener(
    'resize',
    measureLayout
  );
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {}); headers.set('content-type', 'application/json');
  if (sessionToken && !path.startsWith('/api/auth/')) headers.set('authorization', `Bearer ${sessionToken}`);
  let response = await fetch(path, { ...options, headers });
  if (response.status === 401 && sessionToken && !path.startsWith('/api/auth/')) {
    const refresh = await fetch('/api/auth/refresh', { method:'POST', headers:{ authorization:`Bearer ${sessionToken}` } });
    if (refresh.ok) { const auth = await refresh.json(); await saveAuth(auth); headers.set('authorization', `Bearer ${sessionToken}`); response = await fetch(path, { ...options, headers }); }
    else { safeSessionRemove(); sessionToken = null; throw new Error('Discord 세션이 만료되었습니다. 인증을 다시 시도해 주세요.'); }
  }
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '요청을 처리하지 못했습니다.'); }
  return response.json();
}
async function saveAuth(auth) { sessionToken = auth.session_token; safeSessionSet(sessionToken); if (discordSdk && auth.access_token) await discordSdk.commands.authenticate({ access_token:auth.access_token }); }
async function authenticate() {
  const config = await request('/api/config');
  if (!config.clientId) return;
  const mod = await import('@discord/embedded-app-sdk'); discordSdk = new mod.DiscordSDK(config.clientId); await discordSdk.ready();
  const { code } = await discordSdk.commands.authorize({ client_id:config.clientId, response_type:'code', state:crypto.randomUUID(), prompt:'none', scope:['identify'] });
  const auth = await request('/api/auth/exchange', { method:'POST', body:JSON.stringify({ code }) }); await saveAuth(auth); document.body.dataset.discordReady = 'true';
}
function squareName(i) { return files[i % 8] + (8 - Math.floor(i / 8)); }
function pieceImage(piece) { const img = document.createElement('img'); img.className='piece'; img.alt = `${piece.color === 'w' ? '백' : '흑'} ${pieceNames[piece.type]}`; img.src = `/assets/chess-pieces/cburnett/${piece.color}${piece.type.toUpperCase()}.svg`; return img; }
function render() {
  boardEl.replaceChildren(); const legal = selected ? chess.moves({ square:selected, verbose:true }) : [];
  for (let i=0;i<64;i++) { const sq=squareName(i); const el=document.createElement('div'); const rank=Math.floor(i/8); el.className=`square ${((rank+i)%2?'dark':'light')}`; el.dataset.square=sq; if(selected===sq)el.classList.add('selected'); if(lastMove&&(lastMove.from===sq||lastMove.to===sq))el.classList.add('last-move'); const move=legal.find(item=>item.to===sq); if(move){el.classList.add('legal');if(chess.get(sq))el.classList.add('capture')} const piece=chess.get(sq); if(piece){el.append(pieceImage(piece));el.draggable=true;el.addEventListener('dragstart',()=>{selected=sq;render()})} el.addEventListener('click',()=>clickSquare(sq));el.addEventListener('dragover',(event)=>event.preventDefault());el.addEventListener('drop',()=>moveTo(sq));boardEl.append(el); }
  $('attempts').textContent=`${rows.length}/6`; renderRows();
}
function clickSquare(sq){if(selected&&moveTo(sq))return;if(chess.get(sq)?.color===chess.turn()){selected=sq;$('status').textContent='이동할 칸을 선택하세요.';render()}}
function moveTo(to){if(!selected)return false;try{const move=chess.move({from:selected,to,promotion:'q'});history.push(move);lastMove=move;selected=null;$('status').textContent=`${move.san} · ${history.length}/${puzzle.length}수`;render();return true}catch{return false}}
function normalizedRow(row) { return Array.isArray(row) ? { moves: [], result: row } : { moves: row?.moves || [], result: row?.result || [] }; }
function makeTile(text, state, empty = false) { const tile = document.createElement('span'); tile.className = `guess-tile${state ? ` ${state}` : ''}${empty ? ' empty' : ' filled'}`; tile.textContent = text || ''; tile.title = text ? `${text}${state ? ` · ${state}` : ''}` : '입력 대기'; return tile; }
function renderRows(){const container=$('rows');container.style.setProperty('--move-count',puzzle.length);container.replaceChildren();const active = rows.length < 6 && !puzzle?.finished; for(let index=0;index<6;index+=1){const saved=normalizedRow(rows[index]);const isActive=index===rows.length&&active;const moves=isActive?history.map((move)=>move.san):saved.moves;const line=document.createElement('div');line.className=`guess-row ${isActive?'active':''} ${index<rows.length?'submitted':''}`;const number=document.createElement('span');number.className='move-number';number.textContent=`${index+1}.`;line.append(number);for(let i=0;i<puzzle.length;i+=1){const state=isActive?'':saved.result[i];line.append(makeTile(moves[i] || '', state, !moves[i]));}container.append(line);}}
async function loadGame(mode, showMatching=false){puzzle=await request(`/api/puzzle?mode=${mode}`);rows=(puzzle.rows||[]).map(normalizedRow);$('date').textContent=`${puzzle.date} · ${puzzle.mode==='expert'?'익스퍼트 모드':'노멀 모드'}`;chess=new Chess();history=[];selected=null;lastMove=null;$('submit').disabled=puzzle.finished;$('status').textContent=puzzle.finished?(puzzle.opening?`오늘의 정답: ${puzzle.opening}`:'오늘의 게임이 종료되었습니다.'):'백의 첫 수를 선택하세요.';$('share').hidden=!puzzle.share;if(puzzle.share)$('share').dataset.share=puzzle.share;render();$('game').hidden=false;requestAnimationFrame(measureLayout);if(showMatching)$('matching').showModal()}
async function boot(){try{await authenticate();await chooseOrRestore()}catch(error){$('loading').hidden=true;$('auth-message').textContent=error.message;$('auth-error').hidden=false}}
async function chooseOrRestore(){const normal=await request('/api/puzzle?mode=normal');const expert=await request('/api/puzzle?mode=expert');$('loading').hidden=true;const saved=normal.rows.length||normal.matching||normal.finished?normal:expert.rows.length||expert.matching||expert.finished?expert:null;if(saved)await loadGame(saved.mode,false);else $('welcome').showModal()}
document.querySelectorAll('[data-mode]').forEach((button)=>button.addEventListener('click',async()=>{try{ $('welcome').close();await loadGame(button.dataset.mode,true)}catch(error){$('status').textContent=error.message}}));
document.querySelectorAll('[data-matching]').forEach((button)=>button.addEventListener('click',()=>{if(puzzle)puzzle.matching=button.dataset.matching;$('matching').close()}));
$('undo').onclick=()=>{if(history.length){chess.undo();history.pop();lastMove=history.at(-1)||null;selected=null;render()}};$('clear').onclick=()=>{chess=new Chess();history=[];selected=null;lastMove=null;$('status').textContent='입력을 초기화했습니다.';render()};
$('submit').onclick=async()=>{if(!puzzle.matching){$('matching').showModal();return}if(history.length!==puzzle.length){$('status').textContent=`${puzzle.length}수를 모두 입력하세요.`;return}try{const data=await request('/api/guess',{method:'POST',body:JSON.stringify({mode:puzzle.mode,matching:puzzle.matching,moves:history.map((move)=>move.san),instanceId:discordSdk?.instanceId||null,puzzleDate:puzzle.date})});rows.push(normalizedRow(data.row||{moves:history.map((move)=>move.san),result:data.result}));puzzle.matching=data.matching||puzzle.matching;$('status').textContent=data.solved?`정답입니다! ${data.opening}`:data.finished?`오늘의 정답: ${data.opening}`:'다음 추측을 시작하세요.';$('submit').disabled=data.finished;$('share').hidden=false;$('share').dataset.share=data.share;chess=new Chess();history=[];selected=null;lastMove=null;render()}catch(error){$('status').textContent=error.message}};
$('share').onclick=async()=>{try{await navigator.clipboard.writeText($('share').dataset.share);$('status').textContent='결과를 클립보드에 복사했습니다.'}catch{$('status').textContent='클립보드 복사에 실패했습니다.'}};$('help').onclick=()=>$('help-dialog').showModal();document.querySelectorAll('[data-close]').forEach((button)=>button.onclick=()=>$(button.dataset.close).close());$('retry-auth').onclick=async()=>{ $('auth-error').hidden=true;$('loading').hidden=false;try{await authenticate();await chooseOrRestore()}catch(error){$('loading').hidden=true;$('auth-message').textContent=error.message;$('auth-error').hidden=false}};boot();
