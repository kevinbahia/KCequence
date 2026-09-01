import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getDatabase, ref, set, get, update, remove, onValue, runTransaction, onDisconnect, query, orderByChild, limitToFirst } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const views = ['authView','lobbyView','roomView','gameView'];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let me = null;
let displayName = localStorage.getItem('kc_name') || '';
let currentRoomCode = null;
let roomUnsub = null;
let selectedCardIndex = null;
let currentRoom = null;

const SUITS = ['H','D','C','S'];
const SUIT_SYMBOL = {H:'♥',D:'♦',C:'♣',S:'♠'};
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const FREE = 'FREE';

function showView(id){ views.forEach(v => $(v).classList.toggle('hidden', v !== id)); }
function status(el,msg){ $(el).textContent = msg || ''; }
function normalizeName(v){ return v.trim().replace(/\s+/g,' ').slice(0,18); }
function randomCode(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }
function cardId(suit,rank){ return `${rank}${suit}`; }
function cardText(id){ if(id===FREE) return '★'; const suit=id.slice(-1); const rank=id.slice(0,-1); return `${rank}${SUIT_SYMBOL[suit]}`; }
function isRedSuit(id){ return ['H','D'].includes(id.slice(-1)); }
function isJack(id){ return id.startsWith('J'); }
function jackType(id){ if(!isJack(id)) return null; return ['H','D'].includes(id.slice(-1)) ? 'wild' : 'remove'; }
function shuffle(a){ const b=[...a]; for(let i=b.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; } return b; }
function makeDeck(){ const d=[]; for(let x=0;x<2;x++) for(const s of SUITS) for(const r of RANKS) d.push(cardId(s,r)); return shuffle(d); }
function makeBoard(){ const cards=[]; for(let x=0;x<2;x++) for(const s of SUITS) for(const r of RANKS) if(r!=='J') cards.push(cardId(s,r)); const mixed=shuffle(cards); const out=[]; let k=0; for(let i=0;i<100;i++){ if([0,9,90,99].includes(i)) out.push(FREE); else out.push(mixed[k++]); } return out; }

function playerColor(room,uid){ const ids=Object.keys(room.players||{}); return ids.indexOf(uid)===0?'red':'blue'; }
function playerName(room,uid){ return room.players?.[uid]?.name || 'Jugador'; }

async function ensureProfile(){
  if(!me || !displayName) return;
  await set(ref(db,`users/${me.uid}`),{name:displayName,lastSeen:Date.now()});
}

async function bootstrap(){
  try{ await signInAnonymously(auth); }
  catch(e){ status('lobbyStatus','No se pudo conectar con Firebase. Revisa firebase-config.js y activa Anonymous Authentication.'); console.error(e); }
}

onAuthStateChanged(auth, async user => {
  me=user;
  if(!user) return;
  $('playerPill').textContent = displayName ? displayName : 'Invitado conectado';
  if(displayName){ await ensureProfile(); showView('lobbyView'); }
  else showView('authView');
});

$('nameForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const n=normalizeName($('nameInput').value);
  if(n.length<2) return;
  displayName=n; localStorage.setItem('kc_name',n); $('playerPill').textContent=n; await ensureProfile(); showView('lobbyView');
});

$('roomCodeInput').addEventListener('input',e=> e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));

$('createRoomBtn').addEventListener('click', async()=>{
  if(!me) return;
  status('lobbyStatus','Creando sala…');
  let code;
  for(let i=0;i<8;i++){ const c=randomCode(); if(!(await get(ref(db,`rooms/${c}`))).exists()){ code=c; break; } }
  if(!code) return status('lobbyStatus','No se pudo generar la sala. Intenta otra vez.');
  const room={code,host:me.uid,status:'waiting',createdAt:Date.now(),players:{[me.uid]:{name:displayName,joinedAt:Date.now()}}};
  await set(ref(db,`rooms/${code}`),room);
  enterRoom(code);
});

$('joinRoomBtn').addEventListener('click', async()=>{
  const code=$('roomCodeInput').value.trim().toUpperCase();
  if(code.length!==6) return status('lobbyStatus','Escribe un código de 6 caracteres.');
  const r=ref(db,`rooms/${code}`);
  const snap=await get(r);
  if(!snap.exists()) return status('lobbyStatus','No existe esa sala.');
  const room=snap.val();
  if(room.status!=='waiting') return status('lobbyStatus','Esa partida ya comenzó.');
  if(Object.keys(room.players||{}).length>=2 && !room.players?.[me.uid]) return status('lobbyStatus','La sala está llena.');
  await update(ref(db,`rooms/${code}/players/${me.uid}`),{name:displayName,joinedAt:Date.now()});
  enterRoom(code);
});

async function enterRoom(code){
  await cancelMatch();
  currentRoomCode=code; selectedCardIndex=null; showView('roomView');
  $('roomTitle').textContent=code;
  const playerRef=ref(db,`rooms/${code}/players/${me.uid}`);
  onDisconnect(playerRef).remove();
  if(roomUnsub) roomUnsub();
  roomUnsub=onValue(ref(db,`rooms/${code}`),snap=>{
    if(!snap.exists()){ leaveToLobby('La sala fue cerrada.'); return; }
    currentRoom=snap.val(); renderRoom(currentRoom);
    if(currentRoom.status==='playing') renderGame(currentRoom);
    if(currentRoom.status==='finished') showResult(currentRoom);
  });
}

function renderRoom(room){
  const ids=Object.keys(room.players||{});
  $('playersList').innerHTML='';
  ids.forEach((uid,i)=>{
    const div=document.createElement('div'); div.className='player-card'+(uid===me.uid?' me':'');
    div.innerHTML=`<strong><span class="player-dot ${i===0?'dot-red':'dot-blue'}"></span>${escapeHtml(room.players[uid].name)}</strong><p>${uid===room.host?'Anfitrión':'Invitado'}${uid===me.uid?' · Tú':''}</p>`;
    $('playersList').appendChild(div);
  });
  $('roomSubtitle').textContent = ids.length<2 ? 'Comparte este código con un amigo.' : 'Dos jugadores conectados.';
  $('startBtn').classList.toggle('hidden', !(room.host===me.uid && ids.length===2 && room.status==='waiting'));
  if(room.status==='waiting') showView('roomView');
}

$('startBtn').addEventListener('click', async()=>{
  if(!currentRoomCode) return;
  const snap=await get(ref(db,`rooms/${currentRoomCode}`)); if(!snap.exists()) return;
  const room=snap.val(); const ids=Object.keys(room.players||{}); if(ids.length!==2||room.host!==me.uid) return;
  const deck=makeDeck(); const hands={};
  hands[ids[0]]=deck.splice(0,7); hands[ids[1]]=deck.splice(0,7);
  await update(ref(db,`rooms/${currentRoomCode}`),{status:'playing',game:{board:makeBoard(),deck,hands,chips:{},turn:ids[0],winner:null,sequences:{[ids[0]]:0,[ids[1]]:0},moveCount:0,updatedAt:Date.now()}});
});

$('leaveBtn').addEventListener('click',()=>leaveRoom()); $('exitGameBtn').addEventListener('click',()=>leaveRoom());
async function leaveRoom(){
  if(!currentRoomCode) return leaveToLobby();
  const code=currentRoomCode; const snap=await get(ref(db,`rooms/${code}`));
  if(snap.exists()){
    const room=snap.val();
    if(room.host===me.uid) await remove(ref(db,`rooms/${code}`));
    else await remove(ref(db,`rooms/${code}/players/${me.uid}`));
  }
  leaveToLobby();
}
function leaveToLobby(msg=''){ if(roomUnsub){roomUnsub();roomUnsub=null;} currentRoomCode=null; currentRoom=null; selectedCardIndex=null; showView('lobbyView'); status('lobbyStatus',msg); }

function renderGame(room){

  showView('gameView');

  currentRoom = room;

  const game = room.game;

  if (!game) return;


  const myTurn =
    game.turn === me.uid;


  /* Si cambió el turno, borrar selección anterior */

  if (!myTurn) {

    selectedCardIndex = null;

  }


  if (game.winner) {

    $('turnLabel').textContent =
      'Partida terminada';

  }

  else if (myTurn) {

    $('turnLabel').textContent =
      '🟢 TU TURNO';

  }

  else {

    $('turnLabel').textContent =
      `⏳ Turno de ${playerName(
        room,
        game.turn
      )}`;

  }


  const ids =
    Object.keys(
      room.players || {}
    );


  $('scoreLabel').textContent =
    ids
      .map(
        uid =>
          `${playerName(room, uid)}: ${
            game.sequences?.[uid] || 0
          }/2`
      )
      .join(' · ');


  renderBoard(room);

  renderHand(room);


  if (game.winner) {

    status(
      'gameStatus',
      'La partida terminó.'
    );

  }

  else if (myTurn) {

    status(
      'gameStatus',
      'Tu turno: selecciona una carta y después una casilla.'
    );

  }

  else {

    status(
      'gameStatus',
      `Espera a que ${playerName(
        room,
        game.turn
      )} realice su movimiento.`
    );

  }
}

function renderBoard(room){
  const boardEl=$('board'); boardEl.innerHTML=''; const g=room.game; const myHand=g.hands?.[me.uid]||[]; const sel=myHand[selectedCardIndex];
  g.board.forEach((card,index)=>{
    const btn=document.createElement('button'); btn.type='button'; btn.className='cell'+(card===FREE?' free':''); btn.dataset.index=index; btn.innerHTML=`<span class="${isRedSuit(card)?'suit-red':''}">${cardText(card)}</span>`;
    const chipUid=g.chips?.[index]; if(chipUid){ const chip=document.createElement('span'); chip.className=`chip ${playerColor(room,chipUid)}`; btn.appendChild(chip); }
    if(sel && g.turn===me.uid && isLegalTarget(room,sel,index)) btn.classList.add('legal');
    btn.addEventListener('click',()=>playAt(index)); boardEl.appendChild(btn);
  });
}

function renderHand(room){
  const hand = $('hand');
  hand.innerHTML = '';

  const game = room.game;
  const cards = game.hands?.[me.uid] || [];

  const myTurn = game.turn === me.uid && !game.winner;

  cards.forEach((id, i) => {

    const b = document.createElement('button');

    b.type = 'button';

    b.className =
      'card' +
      (selectedCardIndex === i ? ' selected' : '') +
      (!myTurn ? ' not-my-turn' : '');

    const jt = jackType(id);

    b.innerHTML = `
      <span>${cardText(id)}</span>

      <span class="big ${isRedSuit(id) ? 'suit-red' : ''}">
        ${SUIT_SYMBOL[id.slice(-1)] || ''}
      </span>

      <span class="special">
        ${
          jt === 'wild'
            ? 'Jota libre'
            : jt === 'remove'
            ? 'Quita ficha'
            : 'Carta de tablero'
        }
      </span>
    `;

    /* Click de computadora */
    b.addEventListener('click', () => {

      if (!myTurn) {
        status(
          'gameStatus',
          `Espera. Es turno de ${playerName(room, game.turn)}.`
        );
        return;
      }

      selectedCardIndex = i;

      renderBoard(room);
      renderHand(room);

      status(
        'gameStatus',
        `Seleccionaste ${cardText(id)}. Ahora toca una casilla válida.`
      );
    });

    hand.appendChild(b);
  });

  if (!myTurn) {

    selectedCardIndex = null;

    $('handHelp').textContent =
      `Espera el turno de ${playerName(room, game.turn)}`;

  } else if (selectedCardIndex === null) {

    $('handHelp').textContent =
      'Selecciona una carta';

  } else {

    $('handHelp').textContent =
      `Elegiste ${cardText(cards[selectedCardIndex])}`;
  }
}

function isLegalTarget(room,card,index){
  const g=room.game; const boardCard=g.board[index]; const occupied=!!g.chips?.[index];
  if(boardCard===FREE) return false;
  const jt=jackType(card);
  if(jt==='wild') return !occupied;
  if(jt==='remove') return occupied && g.chips[index]!==me.uid;
  return !occupied && boardCard===card;
}

async function playAt(index){

  if (!currentRoomCode) return;

  if (!currentRoom?.game) return;

  /* BLOQUEO DE TURNO */
  if (currentRoom.game.turn !== me.uid) {

    selectedCardIndex = null;

    status(
      'gameStatus',
      `Espera. Es turno de ${playerName(
        currentRoom,
        currentRoom.game.turn
      )}.`
    );

    renderHand(currentRoom);

    return;
  }

  if (selectedCardIndex === null) {

    status(
      'gameStatus',
      'Primero selecciona una carta.'
    );

    return;
  }


  const cardIndex = selectedCardIndex;

  const roomRef =
    ref(db, `rooms/${currentRoomCode}`);


  let moveWasMade = false;


  await runTransaction(roomRef, room => {

    if (!room) return room;

    if (room.status !== 'playing')
      return room;

    if (!room.game)
      return room;

    if (room.game.winner)
      return room;


    /* VALIDACIÓN REAL EN FIREBASE */

    if (room.game.turn !== me.uid)
      return room;


    const hand =
      room.game.hands?.[me.uid] || [];


    const card = hand[cardIndex];


    if (!card)
      return room;


    if (!isLegalTarget(room, card, index))
      return room;


    const jt = jackType(card);


    room.game.chips =
      room.game.chips || {};


    /* JOTA PARA QUITAR */

    if (jt === 'remove') {

      delete room.game.chips[index];

    }

    /* CARTA NORMAL / JOTA LIBRE */

    else {

      room.game.chips[index] = me.uid;

    }


    /* QUITAR CARTA UTILIZADA */

    hand.splice(cardIndex, 1);


    /* SACAR NUEVA CARTA */

    if (room.game.deck?.length) {

      hand.push(
        room.game.deck.shift()
      );

    }


    room.game.hands[me.uid] = hand;


    /* CONTAR SECUENCIAS */

    const sequences =
      countSequences(
        room.game,
        me.uid
      );


    room.game.sequences[me.uid] =
      sequences;


    /* VICTORIA */

    if (sequences >= 2) {

      room.game.winner =
        me.uid;

      room.status =
        'finished';

    }

    else {

      /* CAMBIAR TURNO */

      const ids =
        Object.keys(
          room.players || {}
        );


      const opponent =
        ids.find(
          uid => uid !== me.uid
        );


      if (opponent) {

        room.game.turn =
          opponent;

      }

    }


    room.game.moveCount =
      (room.game.moveCount || 0) + 1;


    room.game.updatedAt =
      Date.now();


    moveWasMade = true;


    return room;
  });


  if (moveWasMade) {

    selectedCardIndex = null;

    status(
      'gameStatus',
      'Movimiento realizado. Esperando al oponente…'
    );

  }

  else {

    status(
      'gameStatus',
      'Esa casilla no es válida para la carta seleccionada.'
    );

  }
}

function countSequences(game,uid){
  const own=(idx)=> [0,9,90,99].includes(idx) || game.chips?.[idx]===uid;
  const dirs=[[0,1],[1,0],[1,1],[1,-1]]; let found=[];
  for(let r=0;r<10;r++) for(let c=0;c<10;c++) for(const [dr,dc] of dirs){
    const cells=[]; for(let k=0;k<5;k++){ const rr=r+dr*k,cc=c+dc*k; if(rr<0||rr>=10||cc<0||cc>=10){cells.length=0;break;} cells.push(rr*10+cc); }
    if(cells.length===5 && cells.every(own)) found.push(cells.join('-'));
  }
  return Math.min(2,found.length);
}

$('deadCardBtn').addEventListener('click', async()=>{
  if(selectedCardIndex===null||!currentRoomCode||!currentRoom?.game) return status('gameStatus','Selecciona primero una carta.');
  const card=currentRoom.game.hands?.[me.uid]?.[selectedCardIndex]; if(!card||isJack(card)) return status('gameStatus','Esa carta no puede cambiarse como carta muerta.');
  const stillAvailable=currentRoom.game.board.some((b,i)=>b===card && !currentRoom.game.chips?.[i]);
  if(stillAvailable) return status('gameStatus','Todavía existe una casilla libre para esa carta.');
  const idx=selectedCardIndex; await runTransaction(ref(db,`rooms/${currentRoomCode}`),room=>{
    if(!room?.game||room.game.turn!==me.uid) return room; const hand=room.game.hands?.[me.uid]||[]; if(!hand[idx]||room.game.deck.length===0) return room;
    hand.splice(idx,1,room.game.deck.shift()); room.game.hands[me.uid]=hand; room.game.updatedAt=Date.now(); return room;
  }); selectedCardIndex=null;
});

function showResult(room){
  if(!$('modal').classList.contains('hidden')) return;
  const win=room.game?.winner; $('modalTitle').textContent=win===me.uid?'¡Ganaste!':'Partida terminada'; $('modalText').textContent=win?`${playerName(room,win)} completó 2 líneas de cinco.`:'La partida terminó.'; $('modal').classList.remove('hidden');
}
$('modalOk').addEventListener('click',()=>{ $('modal').classList.add('hidden'); leaveRoom(); });

// Matchmaking simple: cada jugador crea una entrada en /queue. El segundo toma al primero y crea una sala.
$('matchBtn').addEventListener('click', async()=>{
  if(!me) return; status('lobbyStatus','Buscando oponente…'); $('matchBtn').classList.add('hidden'); $('cancelMatchBtn').classList.remove('hidden');
  const qRef=ref(db,`queue/${me.uid}`); await set(qRef,{uid:me.uid,name:displayName,createdAt:Date.now()}); onDisconnect(qRef).remove();
  await tryMatch();
});
$('cancelMatchBtn').addEventListener('click',cancelMatch);
async function cancelMatch(){ if(me) await remove(ref(db,`queue/${me.uid}`)); $('matchBtn').classList.remove('hidden'); $('cancelMatchBtn').classList.add('hidden'); if(!currentRoomCode) status('lobbyStatus',''); }

onValue(ref(db,'matches'),snap=>{
  if(!me||!snap.exists()) return; const all=snap.val();
  for(const [id,m] of Object.entries(all)){ if((m.a===me.uid||m.b===me.uid)&&m.roomCode&&!currentRoomCode){ remove(ref(db,`matches/${id}`)); enterRoom(m.roomCode); break; } }
});

async function tryMatch(){
  const snap=await get(ref(db,'queue')); if(!snap.exists()) return;
  const entries=Object.values(snap.val()).filter(x=>x.uid!==me.uid).sort((a,b)=>a.createdAt-b.createdAt); if(!entries.length) return;
  const other=entries[0]; const claimRef=ref(db,`queue/${other.uid}`);
  const claim=await runTransaction(claimRef,val=>val?null:val); if(!claim.committed) return;
  await remove(ref(db,`queue/${me.uid}`));
  let code=randomCode(); while((await get(ref(db,`rooms/${code}`))).exists()) code=randomCode();
  await set(ref(db,`rooms/${code}`),{code,host:me.uid,status:'waiting',createdAt:Date.now(),players:{[me.uid]:{name:displayName,joinedAt:Date.now()},[other.uid]:{name:other.name,joinedAt:Date.now()}}});
  const matchId=`${Date.now()}_${Math.random().toString(36).slice(2,7)}`; await set(ref(db,`matches/${matchId}`),{a:me.uid,b:other.uid,roomCode:code,createdAt:Date.now()}); enterRoom(code);
}

// Cada pocos segundos, si sigues en cola, intenta tomar a un rival recién llegado.
setInterval(()=>{ if(me && !currentRoomCode && !$('cancelMatchBtn').classList.contains('hidden')) tryMatch(); },2500);

function escapeHtml(str=''){ return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

bootstrap();
