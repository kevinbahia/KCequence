import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';

import {
  getDatabase,
  ref,
  set,
  get,
  remove,
  update,
  onValue,
  runTransaction,
  onDisconnect,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js';

import { firebaseConfig } from './firebase-config.js';


/* =========================================================
   FIREBASE
========================================================= */

const $ = id => document.getElementById(id);

const views = [
  'authView',
  'lobbyView',
  'roomView',
  'gameView'
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);


/* =========================================================
   ESTADO LOCAL
========================================================= */

let me = null;

let displayName =
  localStorage.getItem('kc_name') || '';

let currentRoomCode = null;
let currentRoom = null;

let roomUnsub = null;
let matchUnsub = null;

let selectedCardIndex = null;
let moveInFlight = false;

let connectionUnsub = null;
let reconnectRoomCode = null;
let resultRecordedForRoom = null;
let presenceDisconnect = null;
let quickChatHideTimer = null;
let lastQuickChatId = null;
let lastQuickChatSentAt = 0;

/*
  Una desconexión NO significa abandonar.
  El jugador conserva su lugar hasta que pulse Salir de partida.
*/
const RECONNECT_GRACE_MS = 30000;
const ACTIVE_ROOM_KEY = 'kc_active_room';

const QUICK_CHAT_MESSAGES = [
  { id: 'good_luck', emoji: '🍀', text: '¡Buena suerte!' },
  { id: 'good_play', emoji: '👏', text: '¡Buena jugada!' },
  { id: 'play_fast', emoji: '⏱️', text: '¡Juega rápido!' },
  { id: 'haha', emoji: '😂', text: 'Jajaja' },
  { id: 'wow', emoji: '😮', text: '¡Wow!' },
  { id: 'lets_go', emoji: '🔥', text: '¡Vamos!' },
  { id: 'thanks', emoji: '👍', text: '¡Gracias!' },
  { id: 'nice', emoji: '😎', text: 'Buena esa' },
  { id: 'well_played', emoji: '👑', text: '¡Bien jugado!' },
  { id: 'good_game', emoji: '👋', text: '¡Buena partida!' }
];


/* =========================================================
   CARTAS
========================================================= */

const SUITS = [
  'H',
  'D',
  'C',
  'S'
];

const SUIT_SYMBOL = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠'
};

const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K'
];

const FREE = 'FREE';


/* =========================================================
   UTILIDADES
========================================================= */

function showView(id) {

  views.forEach(view => {

    const element =
      $(view);

    if (!element) {
      return;
    }

    element.classList.toggle(
      'hidden',
      view !== id
    );

  });


  const changePlayerBtn =
    $('changePlayerBtn');

  if (changePlayerBtn) {

    changePlayerBtn.classList.toggle(
      'hidden',
      id !== 'lobbyView'
    );

  }

}


function status(
  elementId,
  message
) {

  const element =
    $(elementId);

  if (element) {

    element.textContent =
      message || '';

  }

}


/* =========================================================
   NORMALIZAR NOMBRE
========================================================= */

function normalizeName(value) {

  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 18);

}


/* =========================================================
   ESCAPAR HTML
========================================================= */

function escapeHtml(str = '') {

  return String(str).replace(

    /[&<>'"]/g,

    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]

  );

}


/* =========================================================
   JUGADOR HEADER
========================================================= */

function updatePlayerPill(name) {

  const pill =
    $('playerPill');

  if (!pill) {
    return;
  }

  const label =
    name ||
    'Invitado conectado';

  pill.innerHTML = `
    <span class="player-status-dot"></span>
    <span>${escapeHtml(label)}</span>
  `;

}


/* =========================================================
   SONIDOS
========================================================= */

let audioContext = null;


function playSound(
  type = 'move'
) {

  try {

    const AudioCtx =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioCtx) {
      return;
    }


    audioContext =
      audioContext ||
      new AudioCtx();


    const oscillator =
      audioContext.createOscillator();


    const gain =
      audioContext.createGain();


    const frequencies = {

      move: 420,

      sequence: 720,

      win: 880,

      lose: 220

    };


    oscillator.type =
      type === 'lose'
        ? 'sine'
        : 'triangle';


    oscillator.frequency.value =
      frequencies[type] ||
      frequencies.move;


    gain.gain.setValueAtTime(
      0.0001,
      audioContext.currentTime
    );


    gain.gain.exponentialRampToValueAtTime(
      0.12,
      audioContext.currentTime + 0.01
    );


    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.18
    );


    oscillator.connect(
      gain
    );


    gain.connect(
      audioContext.destination
    );


    oscillator.start();


    oscillator.stop(
      audioContext.currentTime +
      0.2
    );


  } catch (error) {

    console.warn(
      'No se pudo reproducir sonido:',
      error
    );

  }

}


/* =========================================================
   CONEXIÓN FIREBASE
========================================================= */

function startConnectionListener() {

  if (connectionUnsub) {

    connectionUnsub();

    connectionUnsub =
      null;

  }


  const connectionRef =
    ref(
      db,
      '.info/connected'
    );


  connectionUnsub =
    onValue(

      connectionRef,

      snap => {

        const connected =
          snap.val() === true;


        const indicator =
          $('connectionIndicator');


        const dot =
          $('connectionDot');


        const text =
          $('connectionText');


        if (indicator) {

          indicator.classList.toggle(
            'is-online',
            connected
          );


          indicator.classList.toggle(
            'is-offline',
            !connected
          );

        }


        if (dot) {

          dot.classList.toggle(
            'offline',
            !connected
          );

        }


        if (text) {

          text.textContent =
            connected
              ? 'Online'
              : 'Reconectando…';

        }

      }

    );

}


/* =========================================================
   GUARDAR PARTIDA ACTIVA
========================================================= */

function rememberActiveRoom(code) {

  if (!code) {
    return;
  }


  localStorage.setItem(
    ACTIVE_ROOM_KEY,
    code
  );

}


/* =========================================================
   OLVIDAR PARTIDA ACTIVA
========================================================= */

function forgetActiveRoom() {

  localStorage.removeItem(
    ACTIVE_ROOM_KEY
  );


  reconnectRoomCode =
    null;


  const panel =
    $('reconnectPanel');


  panel?.classList.add(
    'hidden'
  );

}


/* =========================================================
   COMPROBAR RECONEXIÓN
========================================================= */

async function checkReconnectOption() {

  const panel =
    $('reconnectPanel');


  if (
    !panel ||
    !me
  ) {

    return;

  }


  panel.classList.add(
    'hidden'
  );


  reconnectRoomCode =
    null;


  const savedCode =
    localStorage.getItem(
      ACTIVE_ROOM_KEY
    );


  if (!savedCode) {
    return;
  }


  try {

    const snap =
      await get(

        ref(
          db,
          `rooms/${savedCode}`
        )

      );


    if (!snap.exists()) {

      forgetActiveRoom();

      return;

    }


    const room =
      snap.val();


    const wasPlayer =
      !!room.players?.[
        me.uid
      ] ||

      (
        Array.isArray(
          room.game?.turnOrder
        )

        &&

        room.game.turnOrder.includes(
          me.uid
        )
      );


    if (
      !wasPlayer ||

      ![
        'waiting',
        'playing',
        'finished'
      ].includes(
        room.status
      )
    ) {

      forgetActiveRoom();

      return;

    }


    /*
      Si la sala sigue esperando o la partida sigue en curso,
      recuperar automáticamente. No obligamos al usuario a
      pulsar un botón después de cerrar/reabrir la app.
    */
    if (
      room.status === 'waiting' ||
      room.status === 'playing'
    ) {

      reconnectRoomCode =
        savedCode;

      await enterRoom(
        savedCode
      );

      return;

    }


    reconnectRoomCode =
      savedCode;


    const text =
      $('reconnectText');


    if (text) {

      text.textContent =

        room.status ===
          'playing'

          ? `La partida ${savedCode} sigue en curso.`

          : room.status ===
              'finished'

            ? `La partida ${savedCode} terminó mientras estabas fuera.`

            : `La sala ${savedCode} sigue disponible.`;

    }


    panel.classList.remove(
      'hidden'
    );


  } catch (error) {

    console.warn(
      'No se pudo comprobar la partida activa:',
      error
    );

  }

}

/* =========================================================
   BOTÓN RECONECTAR
========================================================= */

const reconnectBtn =
  $('reconnectBtn');


if (reconnectBtn) {

  reconnectBtn.addEventListener(

    'click',

    async () => {

      if (
        !reconnectRoomCode ||
        !me
      ) {

        return;

      }


      const code =
        reconnectRoomCode;


      reconnectBtn.disabled =
        true;


      try {

        const roomRef =
          ref(
            db,
            `rooms/${code}`
          );


        const snap =
          await get(
            roomRef
          );


        if (!snap.exists()) {

          forgetActiveRoom();


          status(
            'lobbyStatus',
            'La partida ya no existe.'
          );


          return;

        }


        const room =
          snap.val();


        /*
          Puede reconectar si todavía existe
          en players O si pertenecía al turnOrder
          original de la partida.
        */
        const allowed =

          !!room.players?.[
            me.uid
          ]

          ||

          (
            Array.isArray(
              room.game?.turnOrder
            )

            &&

            room.game.turnOrder.includes(
              me.uid
            )
          );


        if (!allowed) {

          forgetActiveRoom();


          status(
            'lobbyStatus',
            'Ya no perteneces a esa partida.'
          );


          return;

        }


        /*
          Por compatibilidad con partidas antiguas:
          si una versión anterior eliminó al jugador
          de room.players, pero sigue dentro de
          game.turnOrder, recuperamos su registro.
        */
        if (
          !room.players?.[
            me.uid
          ]

          &&

          room.status !==
            'finished'
        ) {

          await set(

            ref(
              db,
              `rooms/${code}/players/${me.uid}`
            ),

            {

              name:
                displayName ||

                room.game?.playerNames?.[
                  me.uid
                ] ||

                'Jugador',


              /*
                Conservamos un orden razonable.
                En partidas ya iniciadas el orden
                verdadero está en game.turnOrder.
              */
              joinedAt:
                Date.now(),


              connected:
                true,


              lastSeen:
                serverTimestamp(),


              disconnectedAt:
                null

            }

          );

        }


        await enterRoom(
          code
        );


      } catch (error) {

        console.error(
          'ERROR RECONECTANDO:',
          error
        );


        status(
          'lobbyStatus',
          'No se pudo recuperar la partida.'
        );


      } finally {

        reconnectBtn.disabled =
          false;

      }

    }

  );

}


/* =========================================================
   GUARDAR RESULTADO
========================================================= */

async function recordFinishedGame(room) {

  if (
    !me ||
    !room?.game?.winner ||
    !currentRoomCode
  ) {

    return;

  }


  const code =
    currentRoomCode;


  /*
    Cada revancha tiene startedAt diferente.

    Antes se utilizaba solamente el código
    de sala y una revancha podía sobrescribir
    el resultado anterior.
  */
  const gameId =
    `${code}_${room.game.startedAt || 0}`;


  if (
    resultRecordedForRoom ===
      gameId
  ) {

    return;

  }


  resultRecordedForRoom =
    gameId;


  const resultRef =
    ref(
      db,
      `users/${me.uid}/results/${gameId}`
    );


  try {

    await runTransaction(

      resultRef,

      current => {

        /*
          Ya se guardó.
        */
        if (current) {
          return;
        }


        const winnerUid =
          room.game.winner;


        const order =
          getTurnOrder(
            room
          );


        return {

          roomCode:
            code,


          gameId,


          won:
            winnerUid ===
              me.uid,


          winnerUid,


          winnerName:
            playerName(
              room,
              winnerUid
            ),


          players:
            order.length,


          moves:
            room.game.moveCount ||
            0,


          sequences:
            room.game.sequences?.[
              me.uid
            ] || 0,


          finishReason:
            room.game.finishReason ||
            'unknown',


          startedAt:
            room.game.startedAt ||
            room.createdAt ||
            Date.now(),


          finishedAt:
            room.game.finishedAt ||
            room.game.updatedAt ||
            Date.now()

        };

      }

    );


  } catch (error) {

    console.warn(
      'No se pudo guardar el resultado:',
      error
    );

  }

}


/* =========================================================
   CARGAR ESTADÍSTICAS
========================================================= */

async function loadStats() {

  if (!me) {
    return;
  }


  try {

    const snap =
      await get(

        ref(
          db,
          `users/${me.uid}/results`
        )

      );


    const results =
      snap.exists()

        ? Object.values(
            snap.val() ||
            {}
          )

        : [];


    results.sort(

      (a, b) =>

        (b.finishedAt || 0) -
        (a.finishedAt || 0)

    );


    const played =
      results.length;


    const wins =
      results.filter(

        item =>
          item.won === true

      ).length;


    const winRate =

      played

        ? Math.round(
            (
              wins /
              played
            ) * 100
          )

        : 0;


    let streak =
      0;


    for (
      const item
      of results
    ) {

      if (!item.won) {
        break;
      }


      streak++;

    }


    if (
      $('statGames')
    ) {

      $('statGames')
        .textContent =
          played;

    }


    if (
      $('statWins')
    ) {

      $('statWins')
        .textContent =
          wins;

    }


    if (
      $('statWinRate')
    ) {

      $('statWinRate')
        .textContent =
          `${winRate}%`;

    }


    if (
      $('statStreak')
    ) {

      $('statStreak')
        .textContent =
          streak;

    }


    const list =
      $('recentGamesList');


    if (!list) {
      return;
    }


    const recent =
      results.slice(
        0,
        5
      );


    if (!recent.length) {

      list.innerHTML = `

        <p class="empty-history">
          Todavía no hay partidas registradas.
        </p>

      `;


      return;

    }


    list.innerHTML =

      recent.map(

        item => {

          const won =
            item.won === true;


          const opponent =
            item.winnerName ||
            'Jugador';


          return `

            <div
              class="recent-game-item ${
                won
                  ? 'win'
                  : 'loss'
              }"
            >

              <span>
                ${
                  won
                    ? '✓'
                    : '✕'
                }
              </span>


              <div>

                <strong>
                  ${
                    won
                      ? 'Victoria'
                      : 'Derrota'
                  }
                </strong>


                <small>

                  ${
                    won

                      ? `${
                          item.sequences ||
                          0
                        }/2 secuencias`

                      : `Ganó ${
                          escapeHtml(
                            opponent
                          )
                        }`
                  }

                </small>

              </div>

            </div>

          `;

        }

      ).join('');


  } catch (error) {

    console.warn(
      'No se pudieron cargar estadísticas:',
      error
    );

  }

}


/* =========================================================
   DURACIÓN
========================================================= */

function formatDuration(ms) {

  const totalSeconds =
    Math.max(

      0,

      Math.floor(
        Number(ms || 0) /
        1000
      )

    );


  const minutes =
    Math.floor(
      totalSeconds /
      60
    );


  const seconds =
    totalSeconds %
    60;


  return `${
    String(minutes)
      .padStart(
        2,
        '0'
      )
  }:${
    String(seconds)
      .padStart(
        2,
        '0'
      )
  }`;

}


/* =========================================================
   NICKNAME ALEATORIO
========================================================= */

function randomNickname() {

  const first = [

    'Nova',
    'Shadow',
    'Turbo',
    'Pixel',
    'Neo',
    'Night',
    'Fire',
    'Frost',
    'Royal',
    'Dark',
    'Lucky',
    'Rapid',
    'Golden',
    'Epic',
    'Mystic',
    'Cyber',
    'Ultra',
    'Alpha',
    'Omega'

  ];


  const second = [

    'Fox',
    'Wolf',
    'Ace',
    'King',
    'Ninja',
    'Player',
    'Knight',
    'Tiger',
    'Storm',
    'Dragon',
    'Ghost',
    'Hunter',
    'Raven',
    'Falcon',
    'Legend',
    'Shark',
    'Lion',
    'Eagle',
    'Master',
    'Gamer'

  ];


  const number =
    Math.floor(
      Math.random() *
      90
    ) + 10;


  const a =
    first[

      Math.floor(
        Math.random() *
        first.length
      )

    ];


  const b =
    second[

      Math.floor(
        Math.random() *
        second.length
      )

    ];


  return `${
    a
  }${
    b
  }${
    number
  }`
    .slice(
      0,
      18
    );

}


/* =========================================================
   BOTÓN NICKNAME ALEATORIO
========================================================= */

const randomNameBtn =
  $('randomNameBtn');


if (randomNameBtn) {

  randomNameBtn.addEventListener(

    'click',

    () => {

      const input =
        $('nameInput');


      if (!input) {
        return;
      }


      const nickname =
        randomNickname();


      input.value =
        nickname;


      input.setCustomValidity(
        ''
      );


      input.focus();

    }

  );

}


/* =========================================================
   CÓDIGO DE SALA
========================================================= */

function randomCode() {

  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';


  let code =
    '';


  for (
    let i = 0;
    i < 6;
    i++
  ) {

    code +=
      chars[

        Math.floor(
          Math.random() *
          chars.length
        )

      ];

  }


  return code;

}


/* =========================================================
   FUNCIONES DE CARTAS
========================================================= */

function cardId(
  suit,
  rank
) {

  return `${rank}${suit}`;

}


function getCardParts(id) {

  if (
    id === FREE
  ) {

    return {
      rank: '★',
      suit: '',
      symbol: '★'
    };

  }


  const suit =
    id.slice(
      -1
    );


  const rank =
    id.slice(
      0,
      -1
    );


  return {

    rank,

    suit,

    symbol:
      SUIT_SYMBOL[
        suit
      ] || ''

  };

}


function cardText(id) {

  if (
    id === FREE
  ) {

    return '★';

  }


  const {
    rank,
    symbol
  } =
    getCardParts(
      id
    );


  return `${
    rank
  }${
    symbol
  }`;

}


function isRedSuit(id) {

  if (
    !id ||
    id === FREE
  ) {

    return false;

  }


  return [
    'H',
    'D'
  ].includes(
    id.slice(
      -1
    )
  );

}


function isJack(id) {

  return (

    !!id &&

    id !== FREE &&

    id.startsWith(
      'J'
    )

  );

}


function jackType(id) {

  if (!isJack(id)) {
    return null;
  }


  /*
    J♥ y J♦ = libre.
    J♣ y J♠ = quitar.
  */

  return [

    'H',
    'D'

  ].includes(
    id.slice(
      -1
    )
  )

    ? 'wild'

    : 'remove';

}


/* =========================================================
   MEZCLAR
========================================================= */

function shuffle(array) {

  const copy =
    [...array];


  for (
    let i =
      copy.length - 1;

    i > 0;

    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (
          i + 1
        )
      );


    [
      copy[i],
      copy[j]
    ] = [
      copy[j],
      copy[i]
    ];

  }


  return copy;

}


/* =========================================================
   CREAR BARAJA
========================================================= */

function makeDeck() {

  const deck =
    [];


  for (
    let x = 0;
    x < 2;
    x++
  ) {

    for (
      const suit
      of SUITS
    ) {

      for (
        const rank
        of RANKS
      ) {

        deck.push(

          cardId(
            suit,
            rank
          )

        );

      }

    }

  }


  return shuffle(
    deck
  );

}


/* =========================================================
   CREAR TABLERO
========================================================= */

function makeBoard() {

  const cards =
    [];


  /*
    Dos copias de cada carta
    excepto las Jotas.
  */

  for (
    let x = 0;
    x < 2;
    x++
  ) {

    for (
      const suit
      of SUITS
    ) {

      for (
        const rank
        of RANKS
      ) {

        if (
          rank !==
            'J'
        ) {

          cards.push(

            cardId(
              suit,
              rank
            )

          );

        }

      }

    }

  }


  const mixed =
    shuffle(
      cards
    );


  const board =
    [];


  let cardIndex =
    0;


  for (
    let i = 0;
    i < 100;
    i++
  ) {

    if (

      i === 0 ||

      i === 9 ||

      i === 90 ||

      i === 99

    ) {

      board.push(
        FREE
      );

    } else {

      board.push(
        mixed[
          cardIndex++
        ]
      );

    }

  }


  return board;

}


/* =========================================================
   JUGADORES
========================================================= */

function getPlayerIds(room) {

  return Object.entries(
    room.players ||
    {}
  )

    .sort(

      (
        [, a],
        [, b]
      ) =>

        (
          a.joinedAt ||
          0
        )

        -

        (
          b.joinedAt ||
          0
        )

    )

    .map(
      ([uid]) =>
        uid
    );

}


/*
  IMPORTANTÍSIMO PARA 3 Y 4 JUGADORES:

  Una vez iniciada la partida,
  game.turnOrder manda.

  NO reconstruimos el orden usando
  conexión/desconexión.
*/
function getTurnOrder(room) {

  if (

    Array.isArray(
      room.game?.turnOrder
    )

    &&

    room.game.turnOrder.length

  ) {

    return [
      ...room.game.turnOrder
    ];

  }


  return getPlayerIds(
    room
  );

}


/*
  Un jugador pertenece a la partida
  mientras exista en players.

  connected:false NO lo elimina.
*/
function getActivePlayerIds(room) {

  const members =
    new Set(

      Object.keys(
        room.players ||
        {}
      )

    );


  return getTurnOrder(
    room
  )

    .filter(

      uid =>
        members.has(
          uid
        )

    );

}


function playerName(
  room,
  uid
) {

  return (

    room.players?.[
      uid
    ]?.name

    ||

    room.game?.playerNames?.[
      uid
    ]

    ||

    'Jugador'

  );

}


function playerColor(
  room,
  uid
) {

  const order =
    getTurnOrder(
      room
    );


  const colors = [

    'red',
    'blue',
    'green',
    'gold'

  ];


  const index =
    order.indexOf(
      uid
    );


  return (
    colors[index] ||
    'blue'
  );

}


function playerDot(
  room,
  uid
) {

  return `dot-${
    playerColor(
      room,
      uid
    )
  }`;

}


/* =========================================================
   SIGUIENTE TURNO - 2, 3 O 4 JUGADORES
========================================================= */

function getNextActivePlayer(
  room,
  currentUid
) {

  const order =
    getTurnOrder(
      room
    );


  if (!order.length) {
    return null;
  }


  /*
    Solamente se omite a alguien si
    abandonó realmente y ya no existe
    dentro de room.players.

    connected:false sigue contando.
  */
  const members =
    new Set(

      Object.keys(
        room.players ||
        {}
      )

    );


  let currentIndex =
    order.indexOf(
      currentUid
    );


  if (
    currentIndex <
      0
  ) {

    currentIndex =
      -1;

  }


  for (
    let step = 1;
    step <= order.length;
    step++
  ) {

    const index =

      (
        currentIndex +
        step
      )

      %

      order.length;


    const candidate =
      order[index];


    if (
      members.has(
        candidate
      )
    ) {

      return candidate;

    }

  }


  return null;

}


/* =========================================================
   PERFIL FIREBASE
========================================================= */

async function ensureProfile() {

  if (
    !me ||
    !displayName
  ) {

    return;

  }


  /*
    UPDATE y no SET para conservar
    estadísticas anteriores.
  */
  await update(

    ref(
      db,
      `users/${me.uid}`
    ),

    {

      name:
        displayName,


      lastSeen:
        serverTimestamp()

    }

  );

}


/* =========================================================
   INICIAR FIREBASE
========================================================= */

/*
  NO llamamos signInAnonymously inmediatamente.

  Primero esperamos a que Firebase nos diga
  si ya existe una sesión anónima guardada.

  Esto es importante porque si creamos otro UID
  al recargar, la partida anterior pertenece
  al UID viejo.
*/

let authInitialized =
  false;


async function bootstrap() {

  startConnectionListener();


  /*
    onAuthStateChanged se encargará de decidir
    si ya existe usuario o necesitamos crear uno.
  */

}


/* =========================================================
   USUARIO FIREBASE
========================================================= */

onAuthStateChanged(

  auth,

  async user => {

    /*
      Primera comprobación:
      si Firebase no restauró ningún usuario,
      ahora sí creamos el anónimo.
    */
    if (
      !user &&
      !authInitialized
    ) {

      authInitialized =
        true;


      try {

        await signInAnonymously(
          auth
        );


      } catch (error) {

        console.error(
          'ERROR FIREBASE:',
          error
        );


        updatePlayerPill(
          'Error de conexión'
        );


        status(
          'lobbyStatus',
          'No se pudo conectar con Firebase.'
        );

      }


      return;

    }


    authInitialized =
      true;


    me =
      user;


    if (!user) {
      return;
    }


    updatePlayerPill(

      displayName

        ? displayName

        : 'Invitado conectado'

    );


    startMatchListener();


    if (displayName) {

      try {

        await ensureProfile();

      } catch (error) {

        console.error(
          'ERROR PERFIL:',
          error
        );

      }


      showView(
        'lobbyView'
      );


      await Promise.allSettled(
        [
          loadStats(),
          checkReconnectOption()
        ]
      );


    } else {

      showView(
        'authView'
      );

    }

  }

);


/* =========================================================
   FORMULARIO NOMBRE
========================================================= */

const nameForm =
  $('nameForm');


if (nameForm) {

  nameForm.addEventListener(

    'submit',

    async event => {

      event.preventDefault();


      const input =
        $('nameInput');


      if (!input) {
        return;
      }


      const name =
        normalizeName(
          input.value
        );


      input.setCustomValidity(
        ''
      );


      if (
        name.length <
          2
      ) {

        input.setCustomValidity(
          'Escribe al menos 2 caracteres.'
        );


        input.reportValidity();


        input.focus();


        return;

      }


      displayName =
        name;


      localStorage.setItem(
        'kc_name',
        name
      );


      updatePlayerPill(
        name
      );


      status(
        'lobbyStatus',
        ''
      );


      showView(
        'lobbyView'
      );


      await Promise.allSettled(
        [
          loadStats(),
          checkReconnectOption()
        ]
      );


      try {

        await ensureProfile();

      } catch (error) {

        console.error(
          'No se pudo guardar el perfil:',
          error
        );


        status(
          'lobbyStatus',
          'Entraste al lobby, pero hubo un problema sincronizando tu perfil.'
        );

      }

    }

  );

}


/* =========================================================
   LIMPIAR VALIDACIÓN NOMBRE
========================================================= */

const nameInput =
  $('nameInput');


if (nameInput) {

  nameInput.addEventListener(

    'input',

    () => {

      nameInput.setCustomValidity(
        ''
      );

    }

  );

}


/* =========================================================
   INPUT CÓDIGO SALA
========================================================= */

const roomCodeInput =
  $('roomCodeInput');


if (roomCodeInput) {

  roomCodeInput.addEventListener(

    'input',

    event => {

      event.target.value =
        event.target.value

          .toUpperCase()

          .replace(
            /[^A-Z0-9]/g,
            ''
          )

          .slice(
            0,
            6
          );

    }

  );


  roomCodeInput.addEventListener(

    'keydown',

    event => {

      if (
        event.key ===
          'Enter'
      ) {

        event.preventDefault();


        $('joinRoomBtn')
          ?.click();

      }

    }

  );

}


/* =========================================================
   CREAR SALA PRIVADA
========================================================= */

const createRoomBtn =
  $('createRoomBtn');


if (createRoomBtn) {

  createRoomBtn.addEventListener(

    'click',

    async () => {

      if (
        !me ||
        !displayName
      ) {

        status(
          'lobbyStatus',
          'Primero selecciona un nickname.'
        );

        return;

      }


      status(
        'lobbyStatus',
        'Creando sala…'
      );


      try {

        let code =
          null;


        for (
          let i = 0;
          i < 10;
          i++
        ) {

          const possibleCode =
            randomCode();


          const snap =
            await get(

              ref(
                db,
                `rooms/${possibleCode}`
              )

            );


          if (
            !snap.exists()
          ) {

            code =
              possibleCode;

            break;

          }

        }


        if (!code) {

          status(
            'lobbyStatus',
            'No se pudo generar la sala. Intenta otra vez.'
          );

          return;

        }


        const now =
          Date.now();


        const room = {

          code,

          host:
            me.uid,

          status:
            'waiting',

          maxPlayers:
            4,

          matchType:
            'private',

          createdAt:
            now,

          updatedAt:
            now,

          players: {

            [me.uid]: {

              name:
                displayName,

              joinedAt:
                now,

              connected:
                true,

              lastSeen:
                now

            }

          }

        };


        await set(

          ref(
            db,
            `rooms/${code}`
          ),

          room

        );


        rememberActiveRoom(
          code
        );


        await enterRoom(
          code
        );


      } catch (error) {

        console.error(
          'ERROR CREANDO SALA:',
          error
        );


        status(
          'lobbyStatus',
          'No se pudo crear la sala.'
        );

      }

    }

  );

}


/* =========================================================
   UNIRSE A SALA
========================================================= */

const joinRoomBtn =
  $('joinRoomBtn');


if (joinRoomBtn) {

  joinRoomBtn.addEventListener(

    'click',

    async () => {

      if (
        !me ||
        !displayName
      ) {

        status(
          'lobbyStatus',
          'Primero selecciona un nickname.'
        );

        return;

      }


      const input =
        $('roomCodeInput');


      if (!input) {
        return;
      }


      const code =
        input.value
          .trim()
          .toUpperCase();


      if (
        code.length !==
          6
      ) {

        status(
          'lobbyStatus',
          'Escribe un código de 6 caracteres.'
        );

        return;

      }


      status(
        'lobbyStatus',
        'Entrando a la sala…'
      );


      try {

        const roomRef =
          ref(
            db,
            `rooms/${code}`
          );


        const roomSnap =
          await get(
            roomRef
          );


        if (
          !roomSnap.exists()
        ) {

          status(
            'lobbyStatus',
            'No existe esa sala.'
          );

          return;

        }


        const room =
          roomSnap.val();


        /*
          Si ya pertenecía a una partida
          iniciada, permitimos reconectar.
        */
        const isExistingPlayer =

          !!room.players?.[
            me.uid
          ]

          ||

          (
            Array.isArray(
              room.game?.turnOrder
            )

            &&

            room.game.turnOrder.includes(
              me.uid
            )
          );


        if (
          room.status ===
            'playing'
        ) {

          if (
            isExistingPlayer
          ) {

            rememberActiveRoom(
              code
            );


            await enterRoom(
              code
            );


            return;

          }


          status(
            'lobbyStatus',
            'La partida ya comenzó.'
          );

          return;

        }


        if (
          room.status !==
            'waiting'
        ) {

          status(
            'lobbyStatus',
            'Esta sala ya no está disponible.'
          );

          return;

        }


        const players =
          room.players ||
          {};


        if (
          players[
            me.uid
          ]
        ) {

          rememberActiveRoom(
            code
          );


          await enterRoom(
            code
          );


          return;

        }


        if (

          Object.keys(
            players
          ).length >=
            (
              room.maxPlayers ||
              4
            )

        ) {

          status(
            'lobbyStatus',
            'La sala está llena.'
          );

          return;

        }


        await set(

          ref(
            db,
            `rooms/${code}/players/${me.uid}`
          ),

          {

            name:
              displayName,

            joinedAt:
              Date.now(),

            connected:
              true,

            lastSeen:
              serverTimestamp()

          }

        );


        const checkSnap =
          await get(
            roomRef
          );


        if (
          !checkSnap.exists()
        ) {

          status(
            'lobbyStatus',
            'La sala fue cerrada.'
          );

          return;

        }


        const updatedRoom =
          checkSnap.val();


        const updatedPlayers =
          updatedRoom.players ||
          {};


        const maxPlayers =
          updatedRoom.maxPlayers ||
          4;


        const ids =
          Object.entries(
            updatedPlayers
          )

            .sort(

              (
                [, a],
                [, b]
              ) =>

                (
                  a.joinedAt ||
                  0
                )

                -

                (
                  b.joinedAt ||
                  0
                )

            )

            .map(
              ([uid]) =>
                uid
            );


        if (

          ids.length >
            maxPlayers

          &&

          !ids
            .slice(
              0,
              maxPlayers
            )
            .includes(
              me.uid
            )

        ) {

          await remove(

            ref(
              db,
              `rooms/${code}/players/${me.uid}`
            )

          );


          status(
            'lobbyStatus',
            'La sala se llenó justo antes de que entraras.'
          );


          return;

        }


        rememberActiveRoom(
          code
        );


        await enterRoom(
          code
        );


      } catch (error) {

        console.error(
          'ERROR AL ENTRAR:',
          error
        );


        status(
          'lobbyStatus',
          'Error al entrar a la sala.'
        );

      }

    }

  );

}


/* =========================================================
   ESCUCHAR MATCHMAKING PERSONAL
========================================================= */

function startMatchListener() {

  if (!me) {
    return;
  }


  if (matchUnsub) {

    matchUnsub();

    matchUnsub =
      null;

  }


  const myMatchRef =
    ref(
      db,
      `matchesByUser/${me.uid}`
    );


  matchUnsub =
    onValue(

      myMatchRef,

      async snap => {

        if (
          !snap.exists() ||
          currentRoomCode
        ) {

          return;

        }


        const match =
          snap.val();


        await remove(
          myMatchRef
        );


        if (
          !match?.roomCode
        ) {

          return;

        }


        const roomSnap =
          await get(

            ref(
              db,
              `rooms/${match.roomCode}`
            )

          );


        if (
          !roomSnap.exists()
        ) {

          return;

        }


        rememberActiveRoom(
          match.roomCode
        );


        await enterRoom(
          match.roomCode
        );

      }

    );

}

/* =========================================================
   REGISTRAR PRESENCIA
========================================================= */

async function registerPlayerPresence(code) {

  if (
    !code ||
    !me
  ) {
    return;
  }


  const playerRef =
    ref(
      db,
      `rooms/${code}/players/${me.uid}`
    );


  try {

    /*
      IMPORTANTE:

      Al volver a conectarse solamente actualizamos
      el estado de presencia.

      NO cambiamos:
      - joinedAt
      - mano
      - color
      - turnOrder
      - secuencias
    */
    await update(

      playerRef,

      {
        name:
          displayName,

        connected:
          true,

        lastSeen:
          serverTimestamp(),

        disconnectedAt:
          null
      }

    );


    /*
      Si ya existía un onDisconnect anterior,
      cancelamos esa operación antes de registrar
      la nueva.
    */
    if (presenceDisconnect) {

      try {

        await presenceDisconnect.cancel();

      } catch (error) {

        console.warn(
          'No se pudo cancelar presencia anterior:',
          error
        );

      }

      presenceDisconnect =
        null;

    }


    /*
      Al cerrar navegador, perder señal,
      cambiar de WiFi/datos, bloquear el teléfono,
      etc.:

      NO ELIMINAMOS AL JUGADOR.

      Únicamente Firebase lo marca como desconectado.
    */
    presenceDisconnect =
      onDisconnect(
        playerRef
      );


    await presenceDisconnect.update(
      {
        connected:
          false,

        disconnectedAt:
          serverTimestamp()
      }
    );


  } catch (error) {

    console.warn(
      'No se pudo registrar presencia:',
      error
    );

  }

}


/* =========================================================
   ENTRAR Y ESCUCHAR SALA
========================================================= */

async function enterRoom(code) {

  if (
    !code ||
    !me
  ) {
    return;
  }


  await cancelMatch();


  currentRoomCode =
    code;


  currentRoom =
    null;


  selectedCardIndex =
    null;


  moveInFlight =
    false;


  resultRecordedForRoom =
    null;


  rememberActiveRoom(
    code
  );


  showView(
    'roomView'
  );


  const roomTitle =
    $('roomTitle');


  if (roomTitle) {

    roomTitle.textContent =
      code;

  }


  /*
    Primero verificamos que la sala siga existiendo
    y que realmente pertenezcamos a ella.
  */
  try {

    const initialSnap =
      await get(

        ref(
          db,
          `rooms/${code}`
        )

      );


    if (!initialSnap.exists()) {

      forgetActiveRoom();


      leaveToLobby(
        'La sala ya no existe.'
      );


      return;

    }


    const initialRoom =
      initialSnap.val();


    const belongsToGame =

      !!initialRoom.players?.[
        me.uid
      ]

      ||

      (
        Array.isArray(
          initialRoom.game?.turnOrder
        )

        &&

        initialRoom.game.turnOrder.includes(
          me.uid
        )
      );


    if (!belongsToGame) {

      forgetActiveRoom();


      leaveToLobby(
        'Ya no perteneces a esta partida.'
      );


      return;

    }


    /*
      Compatibilidad con partidas creadas antes
      de esta corrección.

      Si el código antiguo eliminó players/uid,
      pero el UID todavía existe en turnOrder,
      recuperamos solamente su registro de jugador.
    */
    if (
      !initialRoom.players?.[
        me.uid
      ]

      &&

      Array.isArray(
        initialRoom.game?.turnOrder
      )

      &&

      initialRoom.game.turnOrder.includes(
        me.uid
      )

      &&

      initialRoom.status !==
        'finished'
    ) {

      await set(

        ref(
          db,
          `rooms/${code}/players/${me.uid}`
        ),

        {
          name:
            displayName ||

            initialRoom.game?.playerNames?.[
              me.uid
            ] ||

            'Jugador',

          /*
            joinedAt ya no controla el turno
            una vez iniciada la partida porque
            usamos game.turnOrder.
          */
          joinedAt:
            Date.now(),

          connected:
            true,

          lastSeen:
            serverTimestamp(),

          disconnectedAt:
            null
        }

      );

    }


  } catch (error) {

    console.error(
      'ERROR VALIDANDO SALA:',
      error
    );


    leaveToLobby(
      'No se pudo abrir la sala.'
    );


    return;

  }


  await registerPlayerPresence(
    code
  );


  if (roomUnsub) {

    roomUnsub();

    roomUnsub =
      null;

  }


  /*
    Escuchar sala en tiempo real.
  */
  roomUnsub =
    onValue(

      ref(
        db,
        `rooms/${code}`
      ),

      async snap => {

        if (!snap.exists()) {

          forgetActiveRoom();


          leaveToLobby(
            'La sala fue cerrada.'
          );


          return;

        }


        /*
          Evita que un listener viejo actualice
          otra sala después de salir.
        */
        if (
          currentRoomCode !==
            code
        ) {
          return;
        }


        currentRoom =
          snap.val();


        /*
          Si explícitamente salimos y ya no estamos
          en players, no intentamos regresar solos.
        */
        const stillMember =

          !!currentRoom.players?.[
            me.uid
          ]

          ||

          (
            Array.isArray(
              currentRoom.game?.turnOrder
            )

            &&

            currentRoom.game.turnOrder.includes(
              me.uid
            )

            &&

            currentRoom.status ===
              'finished'
          );


        if (
          !stillMember &&
          currentRoom.status !==
            'finished'
        ) {

          forgetActiveRoom();


          leaveToLobby(
            'Ya no perteneces a esta partida.'
          );


          return;

        }


        renderRoom(
          currentRoom
        );


        if (
          currentRoom.status ===
            'waiting'
        ) {

          showView(
            'roomView'
          );

        }


        if (
          currentRoom.status ===
            'playing'
        ) {

          /*
            Ya NO eliminamos jugadores
            desconectados.

            Esta función ahora únicamente
            arreglará el turno si alguien
            abandonó explícitamente.
          */
          await reconcileActiveGame(
            code
          );


          showView(
            'gameView'
          );


          renderGame(
            currentRoom
          );

        }


        if (
          currentRoom.status ===
            'finished'
        ) {

          showView(
            'gameView'
          );


          renderGame(
            currentRoom
          );


          await recordFinishedGame(
            currentRoom
          );


          await loadStats();


          showResult(
            currentRoom
          );

        }

      },

      error => {

        console.error(
          'ERROR ESCUCHANDO SALA:',
          error
        );


        status(
          'gameStatus',
          'Reconectando con la partida…'
        );

      }

    );

}


/* =========================================================
   PRESENCIA / JUGADOR PERTENECE A PARTIDA
========================================================= */

/*
  Antes esta función consideraba que un jugador
  dejaba de estar activo después de 30 segundos.

  AHORA:
  connected:false NO significa abandono.

  Mientras el jugador exista dentro de room.players,
  sigue perteneciendo a la partida.
*/
function isPlayerStillActive(player) {

  return !!player;

}


/* =========================================================
   JUGADORES QUE SIGUEN EN LA PARTIDA
========================================================= */

function getConnectedPlayerIds(room) {

  /*
    Conservamos este nombre para no tener que
    modificar llamadas antiguas.

    Pero ahora devuelve MIEMBROS de la partida,
    no solamente personas con conexión activa.
  */

  const players =
    room.players ||
    {};


  const members =
    new Set(

      Object.keys(
        players
      )

    );


  return getTurnOrder(
    room
  ).filter(

    uid =>
      members.has(
        uid
      )

  );

}


/* =========================================================
   RECONCILIAR PARTIDA
========================================================= */

async function reconcileActiveGame(code) {

  if (
    !me ||
    !code
  ) {
    return;
  }


  try {

    await runTransaction(

      ref(
        db,
        `rooms/${code}`
      ),

      room => {

        if (
          !room ||
          room.status !==
            'playing' ||
          !room.game ||
          room.game.winner
        ) {

          return;

        }


        const members =
          getActivePlayerIds(
            room
          );


        /*
          IMPORTANTE:

          NO hacemos esto:
          delete room.players[uid]

          aunque connected sea false.

          Un jugador desconectado puede regresar
          minutos u horas después mientras la
          partida todavía exista.
        */


        /*
          Si por alguna razón ya no queda nadie,
          no modificamos la partida.
        */
        if (!members.length) {

          return;

        }


        /*
          Si solamente queda un miembro porque
          los demás PRESIONARON SALIR y fueron
          removidos explícitamente, ese jugador
          gana por abandono.

          Esto NO ocurre por perder conexión.
        */
        if (
          members.length ===
            1
        ) {

          room.game.winner =
            members[0];


          room.game.finishReason =
            'abandon';


          room.game.finishedAt =
            Date.now();


          room.game.updatedAt =
            Date.now();


          room.updatedAt =
            Date.now();


          room.status =
            'finished';


          return room;

        }


        /*
          Si el jugador cuyo turno estaba activo
          YA NO EXISTE en room.players, significa
          que abandonó explícitamente.

          Entonces avanzamos al siguiente.

          connected:false NO afecta esta condición
          porque sigue existiendo en room.players.
        */
        if (
          !members.includes(
            room.game.turn
          )
        ) {

          const next =
            getNextActivePlayerFromList(
              room,
              room.game.turn,
              members
            );


          if (next) {

            room.game.turn =
              next;


            room.game.updatedAt =
              Date.now();


            room.updatedAt =
              Date.now();


            return room;

          }

        }


        /*
          No hubo nada que corregir.
          En una transacción Firebase retornar
          undefined cancela la escritura.
        */
        return;

      }

    );


  } catch (error) {

    console.error(
      'ERROR RECONCILIANDO PARTIDA:',
      error
    );

  }

}


/* =========================================================
   SIGUIENTE JUGADOR DE UNA LISTA
========================================================= */

function getNextActivePlayerFromList(
  room,
  currentUid,
  activeList
) {

  const order =
    getTurnOrder(
      room
    );


  const active =
    new Set(
      activeList ||
      []
    );


  if (!order.length) {
    return null;
  }


  let startIndex =
    order.indexOf(
      currentUid
    );


  if (
    startIndex <
      0
  ) {

    startIndex =
      -1;

  }


  /*
    Ejemplo 4 jugadores:

    actual J1:
      step 1 -> J2
      step 2 -> J3
      step 3 -> J4
      step 4 -> J1

    actual J4:
      step 1 -> J1

    Esto evita cualquier lógica limitada
    solamente a jugador 1 y jugador 2.
  */
  for (
    let step = 1;
    step <= order.length;
    step++
  ) {

    const index =

      (
        startIndex +
        step
      )

      %

      order.length;


    const candidate =
      order[index];


    if (
      active.has(
        candidate
      )
    ) {

      return candidate;

    }

  }


  return null;

}


/* =========================================================
   RENDER SALA
========================================================= */

function renderRoom(room) {

  const ids =
    getPlayerIds(
      room
    );


  const playersList =
    $('playersList');


  if (playersList) {

    playersList.innerHTML =
      '';


    ids.forEach(

      uid => {

        const div =
          document.createElement(
            'div'
          );


        const player =
          room.players?.[
            uid
          ];


        const isMe =
          uid ===
            me?.uid;


        const isHost =
          uid ===
            room.host;


        const connected =
          player?.connected !==
            false;


        div.className =
          'player-row';


        div.innerHTML = `

          <div
            class="player-row-main"
          >

            <span
              class="player-dot ${
                playerDot(
                  room,
                  uid
                )
              }"
            ></span>


            <div>

              <strong>
                ${
                  escapeHtml(
                    playerName(
                      room,
                      uid
                    )
                  )
                }
              </strong>


              <small>

                ${
                  isMe
                    ? 'Tú'
                    : 'Jugador'
                }

                ${
                  isHost
                    ? ' · Anfitrión'
                    : ''
                }

              </small>

            </div>

          </div>


          <span
            class="player-connection ${
              connected
                ? 'online'
                : 'offline'
            }"
            title="${
              connected
                ? 'Conectado'
                : 'Desconectado temporalmente'
            }"
          >

            ${
              connected
                ? '●'
                : '○'
            }

          </span>

        `;


        playersList.appendChild(
          div
        );

      }

    );

  }


  /*
    Cantidad de jugadores.
  */
  const roomCount =
    $('roomCount');


  if (roomCount) {

    roomCount.textContent =
      `${ids.length}/${
        room.maxPlayers ||
        4
      }`;

  }


  /*
    Código de sala.
  */
  const roomCode =
    $('roomCode');


  if (roomCode) {

    roomCode.textContent =
      room.code ||
      currentRoomCode ||
      '------';

  }


  /*
    Botón comenzar.
  */
  const startBtn =
    $('startBtn');


  if (startBtn) {

    const isHost =
      room.host ===
        me?.uid;


    startBtn.classList.toggle(
      'hidden',
      !isHost ||
      room.status !==
        'waiting'
    );


    startBtn.disabled =
      ids.length <
        2;


    startBtn.textContent =

      ids.length <
        2

        ? 'Esperando jugadores…'

        : `Comenzar partida · ${ids.length} jugadores`;

  }


  /*
    Información de sala.
  */
  const roomStatus =
    $('roomStatus');


  if (roomStatus) {

    if (
      room.status ===
        'waiting'
    ) {

      roomStatus.textContent =

        ids.length <
          2

          ? 'Esperando al menos un jugador más.'

          : room.host ===
              me?.uid

            ? 'Ya puedes comenzar la partida.'

            : 'Esperando a que el anfitrión inicie.';

    }

  }

}


/* =========================================================
   COPIAR CÓDIGO DE SALA
========================================================= */

const copyRoomCodeBtn =
  $('copyRoomCodeBtn');


if (copyRoomCodeBtn) {

  copyRoomCodeBtn.addEventListener(

    'click',

    async () => {

      if (!currentRoomCode) {
        return;
      }


      try {

        await navigator.clipboard.writeText(
          currentRoomCode
        );


        status(
          'roomStatus',
          'Código copiado.'
        );


      } catch (error) {

        console.warn(
          'No se pudo copiar:',
          error
        );


        status(
          'roomStatus',
          `Código: ${currentRoomCode}`
        );

      }

    }

  );

}


/* =========================================================
   COMPARTIR INVITACIÓN
========================================================= */

const shareRoomBtn =
  $('shareRoomBtn');


if (shareRoomBtn) {

  shareRoomBtn.addEventListener(

    'click',

    async () => {

      if (!currentRoomCode) {
        return;
      }


      const text =
        `Únete a mi partida de KCequence. Código: ${currentRoomCode}`;


      const url =
        window.location.href
          .split('?')[0]
          .split('#')[0];


      try {

        if (
          navigator.share
        ) {

          await navigator.share(
            {
              title:
                'KCequence',

              text,

              url
            }
          );


        } else {

          await navigator.clipboard.writeText(
            `${text} ${url}`
          );


          status(
            'roomStatus',
            'Invitación copiada.'
          );

        }


      } catch (error) {

        /*
          Si el usuario cancela el menú
          de compartir no mostramos error.
        */
        if (
          error?.name !==
            'AbortError'
        ) {

          console.warn(
            'No se pudo compartir:',
            error
          );

        }

      }

    }

  );

}


/* =========================================================
   INICIAR PARTIDA
========================================================= */

const startBtn =
  $('startBtn');


if (startBtn) {

  startBtn.addEventListener(

    'click',

    async () => {

      if (
        !currentRoomCode ||
        !me
      ) {

        return;

      }


      startBtn.disabled =
        true;


      status(
        'roomStatus',
        'Preparando partida…'
      );


      try {

        const result =
          await runTransaction(

            ref(
              db,
              `rooms/${currentRoomCode}`
            ),

            room => {

              if (
                !room ||
                room.status !==
                  'waiting'
              ) {

                return;

              }


              if (
                room.host !==
                  me.uid
              ) {

                return;

              }


              /*
                Se fija el orden EXACTO
                de todos los jugadores.

                Este array será utilizado durante
                toda la partida y no dependerá
                del estado connected.
              */
              const ids =
                getPlayerIds(
                  room
                );


              if (
                ids.length <
                  2 ||
                ids.length >
                  4
              ) {

                return;

              }


              const deck =
                makeDeck();


              const hands =
                {};


              /*
                2 jugadores = 7 cartas
                3-4 jugadores = 6 cartas
              */
              const handSize =

                ids.length ===
                  2

                  ? 7

                  : 6;


              ids.forEach(

                uid => {

                  hands[
                    uid
                  ] =
                    deck.splice(
                      0,
                      handSize
                    );

                }

              );


              const playerNames =
                Object.fromEntries(

                  ids.map(

                    uid => [

                      uid,

                      playerName(
                        room,
                        uid
                      )

                    ]

                  )

                );


              const sequences =
                Object.fromEntries(

                  ids.map(

                    uid => [
                      uid,
                      0
                    ]

                  )

                );


              const startedAt =
                Date.now();


              room.status =
                'playing';


              room.game = {

                board:
                  makeBoard(),

                deck,

                hands,

                chips:
                  {},


                /*
                  CORRECCIÓN 3/4 JUGADORES.
                */
                turnOrder:
                  [...ids],


                playerNames,


                /*
                  Comienza jugador 1.
                */
                turn:
                  ids[0],


                winner:
                  null,


                finishReason:
                  null,


                sequences,


                completedSequences:
                  {},


                moveCount:
                  0,


                rematchNumber:
                  0,


                startedAt,


                finishedAt:
                  null,


                lastMove:
                  null,


                updatedAt:
                  startedAt

              };


              room.updatedAt =
                startedAt;


              return room;

            }

          );


        if (
          !result.committed
        ) {

          status(
            'roomStatus',
            'No se pudo iniciar la partida.'
          );

        }


      } catch (error) {

        console.error(
          'ERROR INICIANDO PARTIDA:',
          error
        );


        status(
          'roomStatus',
          'Ocurrió un error al iniciar.'
        );


      } finally {

        startBtn.disabled =
          false;

      }

    }

  );

}


/* =========================================================
   RENDER GENERAL DEL JUEGO
========================================================= */

function renderGame(room) {

  if (
    !room?.game ||
    !me
  ) {

    return;

  }


  const game =
    room.game;


  /*
    Código de sala dentro del juego.
  */
  const gameRoomCode =
    $('gameRoomCode');


  if (gameRoomCode) {

    gameRoomCode.textContent =
      currentRoomCode ||
      room.code ||
      '------';

  }


  /*
    Panel de turno.
  */
  renderTurnPanel(
    room
  );


  /*
    Tablero.
  */
  renderBoard(
    room
  );


  /*
    Mano.
  */
  renderHand(
    room
  );


  /*
    Chat rápido.
  */
  ensureQuickChatUI();


  renderQuickChatMessage(
    room
  );


  /*
    Estado general.
  */
  if (
    !game.winner
  ) {

    if (
      game.turn ===
        me.uid
    ) {

      status(
        'gameStatus',
        'Selecciona una carta y luego una casilla válida.'
      );


    } else {

      status(

        'gameStatus',

        `Esperando a ${
          playerName(
            room,
            game.turn
          )
        }…`

      );

    }

  }

}


/* =========================================================
   PANEL DE TURNO
========================================================= */

function renderTurnPanel(room) {

  if (
    !room?.game
  ) {
    return;
  }


  const game =
    room.game;


  const panel =
    $('gameTurnPanel');


  const badge =
    $('turnStatusBadge');


  const label =
    $('turnLabel');


  const subLabel =
    $('turnSubLabel');


  const score =
    $('scoreLabel');


  const isMyTurn =
    game.turn ===
      me?.uid;


  const finished =
    !!game.winner;


  if (panel) {

    panel.classList.toggle(
      'my-turn',
      isMyTurn &&
      !finished
    );


    panel.classList.toggle(
      'waiting-turn',
      !isMyTurn &&
      !finished
    );


    panel.classList.toggle(
      'game-finished',
      finished
    );

  }


  if (badge) {

    badge.textContent =

      finished

        ? 'PARTIDA TERMINADA'

        : isMyTurn

          ? 'TU TURNO'

          : 'ESPERANDO';

  }


  if (label) {

    label.textContent =

      finished

        ? `Ganó ${
            playerName(
              room,
              game.winner
            )
          }`

        : isMyTurn

          ? 'Es tu turno'

          : `Turno de ${
              playerName(
                room,
                game.turn
              )
            }`;

  }


  if (subLabel) {

    if (finished) {

      subLabel.textContent =
        'La partida ha terminado.';


    } else if (
      isMyTurn
    ) {

      subLabel.textContent =
        'Elige una carta de tu mano.';


    } else {

      subLabel.textContent =
        `${
          playerName(
            room,
            game.turn
          )
        } está jugando.`;

    }

  }


  if (score) {

    const order =
      getTurnOrder(
        room
      );


    score.innerHTML =

      order.map(

        uid => {

          const count =
            game.sequences?.[
              uid
            ] || 0;


          return `

            <span
              class="score-player ${
                uid ===
                  game.turn
                  ? 'active'
                  : ''
              }"
            >

              <i
                class="score-dot ${
                  playerDot(
                    room,
                    uid
                  )
                }"
              ></i>

              ${
                escapeHtml(
                  playerName(
                    room,
                    uid
                  )
                )
              }

              ${count}/2

            </span>

          `;

        }

      ).join('');

  }

}

/* =========================================================
   ESTILOS EXTRA GENERADOS POR APP.JS
========================================================= */

function ensureGameEnhancementStyles() {

  if (
    document.getElementById(
      'kc-game-extra-styles'
    )
  ) {
    return;
  }


  const style =
    document.createElement(
      'style'
    );


  style.id =
    'kc-game-extra-styles';


  style.textContent = `

    /* ==========================================
       CARTAS DEL TABLERO MÁS LEGIBLES
    ========================================== */

    .board-card-content{
      width:100%;
      height:100%;

      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;

      gap:1px;

      position:relative;

      z-index:1;

      pointer-events:none;

      line-height:1;
    }


    .board-rank{
      display:block;

      font-size:
        clamp(
          10px,
          1.65vw,
          18px
        );

      font-weight:950;

      line-height:.9;

      letter-spacing:-.04em;
    }


    .board-suit{
      display:block;

      font-size:
        clamp(
          12px,
          1.9vw,
          21px
        );

      font-weight:950;

      line-height:.85;
    }


    .cell.free
    .board-rank{
      font-size:
        clamp(
          13px,
          2vw,
          22px
        );
    }


    /* ==========================================
       JUGADORES DE SALA
    ========================================== */

    .player-row{
      min-height:78px;

      display:flex;
      align-items:center;
      justify-content:space-between;

      gap:12px;

      padding:15px 16px;

      border:
        1px solid
        rgba(148,163,184,.14);

      border-radius:15px;

      background:
        linear-gradient(
          145deg,
          rgba(20,31,50,.95),
          rgba(11,18,32,.95)
        );
    }


    .player-row-main{
      display:flex;
      align-items:center;

      gap:10px;

      min-width:0;
    }


    .player-row-main strong{
      display:block;

      max-width:180px;

      overflow:hidden;

      text-overflow:ellipsis;

      white-space:nowrap;

      color:#f8fafc;

      font-size:14px;
    }


    .player-row-main small{
      display:block;

      margin-top:3px;

      color:#8290a8;

      font-size:10px;
    }


    .player-connection{
      flex:0 0 auto;

      font-size:18px;
    }


    .player-connection.online{
      color:#22c55e;
    }


    .player-connection.offline{
      color:#f59e0b;
    }


    /* ==========================================
       MARCADOR
    ========================================== */

    .score-player{
      display:inline-flex;
      align-items:center;

      gap:5px;

      margin:
        3px 8px
        3px 0;

      padding:
        4px 7px;

      border-radius:999px;

      border:
        1px solid
        rgba(148,163,184,.12);

      background:
        rgba(255,255,255,.025);

      white-space:nowrap;
    }


    .score-player.active{
      border-color:
        rgba(56,189,248,.30);

      background:
        rgba(56,189,248,.07);
    }


    .score-dot{
      display:inline-block;

      width:8px;
      height:8px;

      border-radius:50%;
    }


    /* ==========================================
       MÓVIL
    ========================================== */

    @media(max-width:600px){

      .board-rank{
        font-size:
          clamp(
            8px,
            2.7vw,
            12px
          );
      }


      .board-suit{
        font-size:
          clamp(
            10px,
            3.2vw,
            15px
          );
      }


      .cell.free
      .board-rank{
        font-size:
          clamp(
            11px,
            3.6vw,
            17px
          );
      }

    }


    @media(max-width:380px){

      .board-rank{
        font-size:
          clamp(
            7px,
            2.8vw,
            10px
          );
      }


      .board-suit{
        font-size:
          clamp(
            9px,
            3.4vw,
            13px
          );
      }

    }

  `;


  document.head.appendChild(
    style
  );

}


/*
  Inyectamos los estilos una sola vez.
*/
ensureGameEnhancementStyles();


/* =========================================================
   OBTENER CELDAS DE SECUENCIAS COMPLETADAS
========================================================= */

function getCompletedSequenceCells(
  game
) {

  const result =
    new Map();


  const completed =
    game.completedSequences ||
    {};


  Object.entries(
    completed
  ).forEach(

    (
      [
        uid,
        sequences
      ]
    ) => {

      if (
        !Array.isArray(
          sequences
        )
      ) {

        return;

      }


      sequences.forEach(

        sequence => {

          if (
            !Array.isArray(
              sequence?.cells
            )
          ) {

            return;

          }


          sequence.cells.forEach(

            index => {

              if (
                !result.has(
                  index
                )
              ) {

                result.set(
                  index,
                  new Set()
                );

              }


              result
                .get(
                  index
                )
                .add(
                  uid
                );

            }

          );

        }

      );

    }

  );


  return result;

}


/* =========================================================
   TABLERO
========================================================= */

function renderBoard(room) {

  const boardElement =
    $('board');


  if (
    !boardElement ||
    !room?.game ||
    !me
  ) {

    return;

  }


  boardElement.innerHTML =
    '';


  const game =
    room.game;


  const myHand =
    game.hands?.[
      me.uid
    ] || [];


  const selectedCard =

    selectedCardIndex ===
      null

      ? null

      : myHand[
          selectedCardIndex
        ];


  /*
    Celdas que forman parte
    de secuencias completadas.
  */
  const sequenceCells =
    getCompletedSequenceCells(
      game
    );


  const lastMoveIndex =

    Number.isInteger(
      game.lastMove?.index
    )

      ? game.lastMove.index

      : null;


  game.board.forEach(

    (
      card,
      index
    ) => {

      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.className =
        'cell' +

        (
          card === FREE

            ? ' free'

            : ''
        );


      button.dataset.index =
        index;


      button.setAttribute(

        'aria-label',

        card === FREE

          ? 'Esquina libre'

          : `Casilla ${
              cardText(
                card
              )
            }`

      );


      /* =====================================================
         CARTA DEL TABLERO MÁS GRANDE
      ===================================================== */

      if (
        card === FREE
      ) {

        button.innerHTML = `

          <span
            class="board-card-content"
          >

            <span
              class="board-rank"
            >
              ★
            </span>

          </span>

        `;


      } else {

        const parts =
          getCardParts(
            card
          );


        const redClass =
          isRedSuit(
            card
          )

            ? ' suit-red'

            : '';


        button.innerHTML = `

          <span
            class="board-card-content${redClass}"
          >

            <span
              class="board-rank"
            >
              ${
                escapeHtml(
                  parts.rank
                )
              }
            </span>


            <span
              class="board-suit"
            >
              ${
                escapeHtml(
                  parts.symbol
                )
              }
            </span>

          </span>

        `;

      }


      /* =====================================================
         ÚLTIMA JUGADA
      ===================================================== */

      if (
        lastMoveIndex ===
          index
      ) {

        button.classList.add(
          'last-move'
        );

      }


      /* =====================================================
         FICHA
      ===================================================== */

      const chipUid =
        game.chips?.[
          index
        ];


      if (chipUid) {

        const chip =
          document.createElement(
            'span'
          );


        chip.className =
          `chip ${
            playerColor(
              room,
              chipUid
            )
          }`;


        chip.title =
          playerName(
            room,
            chipUid
          );


        /*
          Si la ficha pertenece a
          una secuencia completada,
          queda protegida y resaltada.
        */
        if (
          sequenceCells.has(
            index
          )
        ) {

          chip.classList.add(
            'sequence-chip'
          );


          button.classList.add(
            'sequence-complete'
          );


          button.setAttribute(
            'data-sequence',
            'true'
          );

        }


        button.appendChild(
          chip
        );

      }


      /*
        Las esquinas libres pueden
        formar parte visual de secuencias.
      */
      if (
        sequenceCells.has(
          index
        )
      ) {

        button.classList.add(
          'sequence-complete'
        );

      }


      /* =====================================================
         CASILLA LEGAL
      ===================================================== */

      const legal =

        !!selectedCard

        &&

        game.turn ===
          me.uid

        &&

        !game.winner

        &&

        isLegalTarget(
          room,
          selectedCard,
          index
        );


      if (legal) {

        button.classList.add(
          'legal',
          'legal-pulse'
        );


        button.setAttribute(

          'aria-label',

          `${
            button.getAttribute(
              'aria-label'
            )
          } · movimiento válido`

        );

      }


      /*
        Si existe carta seleccionada,
        apagamos ligeramente casillas
        que no pueden utilizarse.
      */
      if (
        selectedCard &&
        !legal &&
        card !== FREE
      ) {

        button.classList.add(
          'not-legal'
        );

      }


      button.addEventListener(

        'click',

        () => {

          playAt(
            index
          );

        }

      );


      boardElement.appendChild(
        button
      );

    }

  );

}


/* =========================================================
   MANO DEL JUGADOR
========================================================= */

function renderHand(room) {

  const handElement =
    $('hand');


  if (
    !handElement ||
    !room?.game ||
    !me
  ) {

    return;

  }


  handElement.innerHTML =
    '';


  const game =
    room.game;


  const cards =
    game.hands?.[
      me.uid
    ] || [];


  const myTurn =

    game.turn ===
      me.uid

    &&

    !game.winner;


  cards.forEach(

    (
      id,
      index
    ) => {

      const button =
        document.createElement(
          'button'
        );


      const selected =
        selectedCardIndex ===
          index;


      button.type =
        'button';


      button.setAttribute(

        'aria-pressed',

        selected
          ? 'true'
          : 'false'

      );


      button.setAttribute(

        'aria-label',

        `Carta ${
          cardText(
            id
          )
        }`

      );


      button.className =
        'card' +

        (
          selected

            ? ' selected'

            : ''
        ) +

        (
          !myTurn

            ? ' not-my-turn'

            : ''
        );


      const type =
        jackType(
          id
        );


      button.innerHTML = `

        ${
          selected

            ? `

              <span
                class="selected-card-badge"
              >
                SELECCIONADA
              </span>

            `

            : ''
        }


        <span class="card-corner">

          ${
            escapeHtml(
              cardText(
                id
              )
            )
          }

        </span>


        <span
          class="big ${
            isRedSuit(
              id
            )
              ? 'suit-red'
              : ''
          }"
        >

          ${
            escapeHtml(

              SUIT_SYMBOL[
                id.slice(
                  -1
                )
              ] || ''

            )
          }

        </span>


        <span class="special">

          ${
            type ===
              'wild'

              ? 'Jota libre'

              : type ===
                  'remove'

                ? 'Quita ficha'

                : 'Carta de tablero'
          }

        </span>

      `;


      button.addEventListener(

        'click',

        () => {

          /*
            Fuera de turno.
          */
          if (
            !myTurn
          ) {

            status(

              'gameStatus',

              `Espera. Es turno de ${
                playerName(
                  room,
                  game.turn
                )
              }.`

            );


            return;

          }


          /*
            Tocar la carta seleccionada
            nuevamente cancela selección.
          */
          if (
            selectedCardIndex ===
              index
          ) {

            selectedCardIndex =
              null;


            renderBoard(
              room
            );


            renderHand(
              room
            );


            status(
              'gameStatus',
              'Selección cancelada.'
            );


            return;

          }


          selectedCardIndex =
            index;


          renderBoard(
            room
          );


          renderHand(
            room
          );


          status(

            'gameStatus',

            `Seleccionaste ${
              cardText(
                id
              )
            }. Ahora toca una casilla iluminada.`

          );

        }

      );


      handElement.appendChild(
        button
      );

    }

  );


  /* =======================================================
     AYUDA DE LA MANO
  ======================================================= */

  const handHelp =
    $('handHelp');


  if (!handHelp) {
    return;
  }


  if (
    !myTurn
  ) {

    selectedCardIndex =
      null;


    handHelp.textContent =

      game.winner

        ? 'Partida terminada'

        : `Espera el turno de ${
            playerName(
              room,
              game.turn
            )
          }`;


  } else if (
    selectedCardIndex ===
      null
  ) {

    handHelp.textContent =
      'Selecciona una carta';


  } else {

    const selected =
      cards[
        selectedCardIndex
      ];


    handHelp.textContent =

      selected

        ? `Carta seleccionada: ${
            cardText(
              selected
            )
          }`

        : 'Selecciona una carta';

  }

}


/* =========================================================
   SECUENCIAS PROTEGIDAS
========================================================= */

function isChipProtectedBySequence(
  game,
  ownerUid,
  index
) {

  const sequences =
    game.completedSequences?.[
      ownerUid
    ] || [];


  return sequences.some(

    sequence =>

      Array.isArray(
        sequence.cells
      )

      &&

      sequence.cells.includes(
        index
      )

  );

}


/* =========================================================
   VALIDAR CASILLA
========================================================= */

function isLegalTarget(
  room,
  card,
  index
) {

  const game =
    room?.game;


  if (!game) {
    return false;
  }


  if (
    !Number.isInteger(
      index
    )
  ) {

    return false;

  }


  if (
    index < 0 ||
    index >= game.board.length
  ) {

    return false;

  }


  const boardCard =
    game.board[
      index
    ];


  const chipUid =
    game.chips?.[
      index
    ];


  const occupied =
    !!chipUid;


  /*
    Las esquinas libres
    no se seleccionan.
  */
  if (
    boardCard ===
      FREE
  ) {

    return false;

  }


  const type =
    jackType(
      card
    );


  /*
    Jota libre:
    cualquier espacio vacío.
  */
  if (
    type ===
      'wild'
  ) {

    return !occupied;

  }


  /*
    Jota para quitar ficha.
  */
  if (
    type ===
      'remove'
  ) {

    if (
      !occupied ||
      chipUid ===
        me.uid
    ) {

      return false;

    }


    /*
      No permitir quitar una ficha
      protegida por secuencia.
    */
    if (

      isChipProtectedBySequence(
        game,
        chipUid,
        index
      )

    ) {

      return false;

    }


    return true;

  }


  /*
    Carta normal.
  */
  return (

    !occupied

    &&

    boardCard ===
      card

  );

}


/* =========================================================
   VERIFICAR POSICIÓN DENTRO DEL TABLERO
========================================================= */

function boardIndex(
  row,
  col
) {

  if (
    row < 0 ||
    row >= 10 ||
    col < 0 ||
    col >= 10
  ) {

    return null;

  }


  return (
    row * 10 +
    col
  );

}


/* =========================================================
   UNA CELDA CUENTA PARA EL JUGADOR
========================================================= */

function cellBelongsToPlayer(
  game,
  uid,
  index
) {

  if (
    index === null
  ) {

    return false;

  }


  const boardCard =
    game.board?.[
      index
    ];


  /*
    Las cuatro esquinas son comodines
    para cualquier jugador.
  */
  if (
    boardCard === FREE
  ) {

    return true;

  }


  return (
    game.chips?.[
      index
    ] ===
      uid
  );

}


/* =========================================================
   CLAVE ÚNICA DE SECUENCIA
========================================================= */

function sequenceKey(cells) {

  return [...cells]
    .sort(
      (a, b) =>
        a - b
    )
    .join('-');

}


/* =========================================================
   BUSCAR SECUENCIAS CREADAS POR ÚLTIMA FICHA
========================================================= */

function findSequencesCreatedByMove(
  game,
  uid,
  placedIndex
) {

  const directions = [

    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]

  ];


  const result =
    [];


  const placedRow =
    Math.floor(
      placedIndex /
      10
    );


  const placedCol =
    placedIndex %
    10;


  directions.forEach(

    (
      [
        dr,
        dc
      ]
    ) => {

      /*
        Buscamos una línea larga alrededor
        de la ficha recién colocada.
      */
      const line =
        [];


      for (
        let offset = -9;
        offset <= 9;
        offset++
      ) {

        const row =
          placedRow +
          dr * offset;


        const col =
          placedCol +
          dc * offset;


        const index =
          boardIndex(
            row,
            col
          );


        if (
          index === null
        ) {

          continue;

        }


        line.push(
          {
            index,
            offset,
            belongs:
              cellBelongsToPlayer(
                game,
                uid,
                index
              )
          }
        );

      }


      /*
        Dividir la línea en grupos consecutivos
        pertenecientes al jugador.
      */
      let segment =
        [];


      function inspectSegment() {

        if (
          segment.length <
            5
        ) {

          segment =
            [];

          return;

        }


        /*
          Generar ventanas de 5.
          Solamente interesan ventanas que
          contienen placedIndex.
        */
        for (
          let start = 0;
          start <=
            segment.length - 5;
          start++
        ) {

          const windowCells =
            segment
              .slice(
                start,
                start + 5
              )
              .map(
                item =>
                  item.index
              );


          if (
            !windowCells.includes(
              placedIndex
            )
          ) {

            continue;

          }


          result.push(
            windowCells
          );

        }


        segment =
          [];

      }


      line.forEach(

        item => {

          if (
            item.belongs
          ) {

            segment.push(
              item
            );

          } else {

            inspectSegment();

          }

        }

      );


      inspectSegment();

    }

  );


  /*
    Eliminar duplicados.
  */
  const unique =
    new Map();


  result.forEach(

    cells => {

      unique.set(
        sequenceKey(
          cells
        ),
        cells
      );

    }

  );


  return [
    ...unique.values()
  ];

}


/* =========================================================
   CUÁNTAS CELDAS COMPARTEN DOS SECUENCIAS
========================================================= */

function countSequenceOverlap(
  first,
  second
) {

  const set =
    new Set(
      first
    );


  return second.filter(
    cell =>
      set.has(
        cell
      )
  ).length;

}


/* =========================================================
   REGISTRAR NUEVAS SECUENCIAS
========================================================= */

function registerNewSequences(
  game,
  uid,
  placedIndex
) {

  game.completedSequences =
    game.completedSequences ||
    {};


  game.completedSequences[
    uid
  ] =
    game.completedSequences[
      uid
    ] || [];


  const existing =
    game.completedSequences[
      uid
    ];


  const candidates =
    findSequencesCreatedByMove(
      game,
      uid,
      placedIndex
    );


  const existingKeys =
    new Set(

      existing.map(

        sequence =>
          sequence.key ||
          sequenceKey(
            sequence.cells ||
            []
          )

      )

    );


  const registered =
    [];


  candidates.forEach(

    cells => {

      const key =
        sequenceKey(
          cells
        );


      /*
        Ya estaba registrada.
      */
      if (
        existingKeys.has(
          key
        )
      ) {

        return;

      }


      /*
        Una nueva secuencia solamente puede
        compartir como máximo una ficha con
        una secuencia previa.

        Esto evita que una misma línea de 5
        se cuente dos veces.
      */
      const invalidOverlap =
        existing.some(

          sequence =>

            countSequenceOverlap(
              sequence.cells ||
              [],
              cells
            ) > 1

        )

        ||

        registered.some(

          sequence =>

            countSequenceOverlap(
              sequence.cells ||
              [],
              cells
            ) > 1

        );


      if (
        invalidOverlap
      ) {

        return;

      }


      const sequence = {

        key,

        cells:
          [...cells],

        createdAt:
          Date.now()

      };


      existing.push(
        sequence
      );


      registered.push(
        sequence
      );


      existingKeys.add(
        key
      );

    }

  );


  game.sequences =
    game.sequences ||
    {};


  game.sequences[
    uid
  ] =
    existing.length;


  return existing.length;

}

/* =========================================================
   REALIZAR JUGADA
========================================================= */

async function playAt(index) {

  if (
    !currentRoomCode ||
    !currentRoom ||
    !currentRoom.game ||
    !me ||
    moveInFlight
  ) {

    return;

  }


  const game =
    currentRoom.game;


  if (
    game.winner
  ) {

    return;

  }


  /*
    Debe ser nuestro turno.
  */
  if (
    game.turn !==
      me.uid
  ) {

    status(

      'gameStatus',

      `Espera. Es turno de ${
        playerName(
          currentRoom,
          game.turn
        )
      }.`

    );


    return;

  }


  /*
    Necesitamos una carta seleccionada.
  */
  if (
    selectedCardIndex ===
      null
  ) {

    status(
      'gameStatus',
      'Primero selecciona una carta.'
    );


    return;

  }


  const hand =
    game.hands?.[
      me.uid
    ] || [];


  const selectedCard =
    hand[
      selectedCardIndex
    ];


  if (
    !selectedCard
  ) {

    selectedCardIndex =
      null;


    renderHand(
      currentRoom
    );


    renderBoard(
      currentRoom
    );


    return;

  }


  /*
    Validación local.
  */
  if (

    !isLegalTarget(
      currentRoom,
      selectedCard,
      index
    )

  ) {

    status(
      'gameStatus',
      'No puedes jugar esa carta en esa casilla.'
    );


    return;

  }


  moveInFlight =
    true;


  status(
    'gameStatus',
    'Realizando jugada…'
  );


  const sequencesBefore =
    game.sequences?.[
      me.uid
    ] || 0;


  try {

    const roomRef =
      ref(
        db,
        `rooms/${currentRoomCode}`
      );


    const result =
      await runTransaction(

        roomRef,

        room => {

          if (
            !room ||
            room.status !==
              'playing' ||
            !room.game
          ) {

            return;

          }


          const txGame =
            room.game;


          if (
            txGame.winner
          ) {

            return;

          }


          /*
            Confirmar turno dentro
            de Firebase.
          */
          if (
            txGame.turn !==
              me.uid
          ) {

            return;

          }


          /*
            El jugador todavía debe pertenecer
            realmente a room.players.

            connected:false NO importa.
          */
          const active =
            getActivePlayerIds(
              room
            );


          if (
            !active.includes(
              me.uid
            )
          ) {

            return;

          }


          const txHand =
            txGame.hands?.[
              me.uid
            ];


          if (
            !Array.isArray(
              txHand
            )
          ) {

            return;

          }


          const card =
            txHand[
              selectedCardIndex
            ];


          /*
            La carta debe seguir siendo
            exactamente la seleccionada.
          */
          if (
            !card ||
            card !==
              selectedCard
          ) {

            return;

          }


          /*
            Validar de nuevo dentro
            de la transacción.
          */
          if (

            !isLegalTarget(
              room,
              card,
              index
            )

          ) {

            return;

          }


          txGame.chips =
            txGame.chips ||
            {};


          const type =
            jackType(
              card
            );


          /* =====================================================
             JOTA PARA QUITAR FICHA
          ===================================================== */

          if (
            type ===
              'remove'
          ) {

            delete txGame.chips[
              index
            ];


          } else {

            /* ===================================================
               CARTA NORMAL / JOTA LIBRE
            =================================================== */

            txGame.chips[
              index
            ] =
              me.uid;

          }


          /* =====================================================
             REGISTRAR ÚLTIMA JUGADA
          ===================================================== */

          txGame.lastMove = {

            index,

            uid:
              me.uid,

            card,

            type:
              type ||
              'normal',

            at:
              Date.now()

          };


          /* =====================================================
             GASTAR CARTA
          ===================================================== */

          txHand.splice(
            selectedCardIndex,
            1
          );


          /*
            Robar una carta nueva.
          */
          if (

            Array.isArray(
              txGame.deck
            )

            &&

            txGame.deck.length

          ) {

            const newCard =
              txGame.deck.shift();


            if (newCard) {

              txHand.push(
                newCard
              );

            }

          }


          txGame.hands[
            me.uid
          ] =
            txHand;


          /* =====================================================
             COMPROBAR SECUENCIAS
          ===================================================== */

          if (
            type !==
              'remove'
          ) {

            const sequenceCount =
              registerNewSequences(
                txGame,
                me.uid,
                index
              );


            /*
              Se necesitan 2 secuencias.
            */
            if (
              sequenceCount >=
                2
            ) {

              txGame.winner =
                me.uid;


              txGame.finishReason =
                'sequences';


              txGame.finishedAt =
                Date.now();


              room.status =
                'finished';

            }

          }


          /* =====================================================
             SIGUIENTE TURNO
          ===================================================== */

          if (
            !txGame.winner
          ) {

            /*
              CORRECCIÓN IMPORTANTE:

              El orden viene de:

              game.turnOrder

              Ejemplo:
              [J1, J2, J3, J4]

              getNextActivePlayer() recorre:

              J1 -> J2
              J2 -> J3
              J3 -> J4
              J4 -> J1

              Un disconnected:false sigue
              participando porque todavía existe
              en room.players.
            */
            const next =
              getNextActivePlayer(
                room,
                me.uid
              );


            if (next) {

              txGame.turn =
                next;

            }

          }


          txGame.moveCount =
            (
              txGame.moveCount ||
              0
            ) + 1;


          txGame.updatedAt =
            Date.now();


          room.updatedAt =
            Date.now();


          return room;

        }

      );


    if (
      !result.committed
    ) {

      status(
        'gameStatus',
        'La jugada no pudo realizarse. El tablero pudo haber cambiado.'
      );


      return;

    }


    /*
      Estado resultante de Firebase.
    */
    const updatedRoom =
      result.snapshot.val();


    if (updatedRoom) {

      currentRoom =
        updatedRoom;

    }


    const sequencesAfter =
      updatedRoom?.game
        ?.sequences?.[
          me.uid
        ] || 0;


    /*
      Sonidos.
    */
    if (
      updatedRoom?.game?.winner ===
        me.uid
    ) {

      playSound(
        'win'
      );


    } else if (
      sequencesAfter >
        sequencesBefore
    ) {

      playSound(
        'sequence'
      );


    } else {

      playSound(
        'move'
      );

    }


    /*
      Aviso de nueva secuencia.
    */
    if (

      sequencesAfter >
        sequencesBefore

      &&

      !updatedRoom?.game?.winner

    ) {

      status(

        'gameStatus',

        `✨ ¡Secuencia completada! Llevas ${
          sequencesAfter
        }/2.`

      );

    }


  } catch (error) {

    console.error(
      'ERROR REALIZANDO JUGADA:',
      error
    );


    status(
      'gameStatus',
      'Ocurrió un error al realizar la jugada.'
    );


  } finally {

    selectedCardIndex =
      null;


    moveInFlight =
      false;


    if (
      currentRoom?.game
    ) {

      renderHand(
        currentRoom
      );


      renderBoard(
        currentRoom
      );


      renderTurnPanel(
        currentRoom
      );

    }

  }

}


/* =========================================================
   CARTA MUERTA
========================================================= */

const deadCardBtn =
  $('deadCardBtn');


if (deadCardBtn) {

  deadCardBtn.addEventListener(

    'click',

    async () => {

      if (
        !currentRoomCode ||
        !currentRoom?.game ||
        !me
      ) {

        return;

      }


      const game =
        currentRoom.game;


      /*
        Solo durante nuestro turno.
      */
      if (
        game.turn !==
          me.uid
      ) {

        status(
          'gameStatus',
          'Solo puedes cambiar una carta muerta durante tu turno.'
        );


        return;

      }


      if (
        selectedCardIndex ===
          null
      ) {

        status(
          'gameStatus',
          'Selecciona primero la carta que quieres reemplazar.'
        );


        return;

      }


      const hand =
        game.hands?.[
          me.uid
        ] || [];


      const card =
        hand[
          selectedCardIndex
        ];


      if (!card) {

        return;

      }


      /*
        Las Jotas nunca son
        cartas muertas.
      */
      if (
        isJack(
          card
        )
      ) {

        status(
          'gameStatus',
          'Las Jotas no pueden cambiarse como carta muerta.'
        );


        return;

      }


      if (

        !Array.isArray(
          game.deck
        )

        ||

        !game.deck.length

      ) {

        status(
          'gameStatus',
          'No quedan cartas en el mazo.'
        );


        return;

      }


      /*
        Buscar si todavía existe alguna
        casilla libre para esa carta.
      */
      let hasAvailableCell =
        false;


      for (
        let index = 0;
        index < game.board.length;
        index++
      ) {

        if (

          game.board[
            index
          ] ===
            card

          &&

          !game.chips?.[
            index
          ]

        ) {

          hasAvailableCell =
            true;


          break;

        }

      }


      if (
        hasAvailableCell
      ) {

        status(
          'gameStatus',
          'Esa carta todavía tiene una casilla disponible en el tablero.'
        );


        return;

      }


      const oldIndex =
        selectedCardIndex;


      const oldCard =
        card;


      deadCardBtn.disabled =
        true;


      status(
        'gameStatus',
        'Cambiando carta muerta…'
      );


      try {

        const result =
          await runTransaction(

            ref(
              db,
              `rooms/${currentRoomCode}`
            ),

            room => {

              if (

                !room

                ||

                room.status !==
                  'playing'

                ||

                !room.game

                ||

                room.game.winner

                ||

                room.game.turn !==
                  me.uid

              ) {

                return;

              }


              const txGame =
                room.game;


              /*
                Confirmar que todavía
                pertenecemos a la partida.
              */
              const active =
                getActivePlayerIds(
                  room
                );


              if (
                !active.includes(
                  me.uid
                )
              ) {

                return;

              }


              const txHand =
                txGame.hands?.[
                  me.uid
                ];


              if (

                !Array.isArray(
                  txHand
                )

                ||

                txHand[
                  oldIndex
                ] !==
                  oldCard

              ) {

                return;

              }


              /*
                Revisar nuevamente dentro
                de Firebase si sigue muerta.
              */
              const stillDead =

                !txGame.board.some(

                  (
                    boardCard,
                    boardPosition
                  ) =>

                    boardCard ===
                      oldCard

                    &&

                    !txGame.chips?.[
                      boardPosition
                    ]

                );


              if (
                !stillDead
              ) {

                return;

              }


              if (

                !Array.isArray(
                  txGame.deck
                )

                ||

                !txGame.deck.length

              ) {

                return;

              }


              const replacement =
                txGame.deck.shift();


              if (
                !replacement
              ) {

                return;

              }


              /*
                Sustituir la carta en
                la misma posición.
              */
              txHand[
                oldIndex
              ] =
                replacement;


              txGame.hands[
                me.uid
              ] =
                txHand;


              /*
                IMPORTANTE:

                Cambiar carta muerta
                NO consume turno.

                Si era turno de J3,
                continúa siendo turno de J3.
              */
              txGame.updatedAt =
                Date.now();


              room.updatedAt =
                Date.now();


              return room;

            }

          );


        if (
          result.committed
        ) {

          const updatedRoom =
            result.snapshot.val();


          if (updatedRoom) {

            currentRoom =
              updatedRoom;

          }


          selectedCardIndex =
            null;


          playSound(
            'move'
          );


          if (
            currentRoom?.game
          ) {

            renderHand(
              currentRoom
            );


            renderBoard(
              currentRoom
            );


            renderTurnPanel(
              currentRoom
            );

          }


          status(
            'gameStatus',
            'Carta muerta reemplazada. Sigues teniendo el turno.'
          );


        } else {

          status(
            'gameStatus',
            'La carta no pudo reemplazarse.'
          );

        }


      } catch (error) {

        console.error(
          'ERROR CARTA MUERTA:',
          error
        );


        status(
          'gameStatus',
          'No se pudo reemplazar la carta.'
        );


      } finally {

        deadCardBtn.disabled =
          false;

      }

    }

  );

}

/* =========================================================
   MOSTRAR RESULTADO
========================================================= */

function showResult(room) {

  if (
    !room?.game ||
    !room.game.winner
  ) {

    return;

  }


  const modal =
    $('modal');


  if (!modal) {
    return;
  }


  const game =
    room.game;


  const winnerUid =
    game.winner;


  const winnerName =
    playerName(
      room,
      winnerUid
    );


  const iWon =

    !!me

    &&

    winnerUid ===
      me.uid;


  /* =======================================================
     ICONO
  ======================================================= */

  const resultIcon =
    $('resultIcon');


  if (resultIcon) {

    resultIcon.textContent =

      iWon
        ? '🏆'
        : '🎮';

  }


  /* =======================================================
     TÍTULO
  ======================================================= */

  const title =
    $('modalTitle');


  if (title) {

    title.textContent =

      iWon

        ? '¡Victoria!'

        : 'Partida terminada';

  }


  /* =======================================================
     TEXTO
  ======================================================= */

  const text =
    $('modalText');


  if (text) {

    if (
      iWon
    ) {

      if (
        game.finishReason ===
          'sequences'
      ) {

        text.textContent =
          '¡Conseguiste las 2 secuencias y ganaste la partida!';


      } else if (
        game.finishReason ===
          'abandon'
      ) {

        text.textContent =
          'Ganaste porque los demás jugadores abandonaron la partida.';


      } else {

        text.textContent =
          '¡Ganaste la partida!';

      }


    } else {

      if (
        game.finishReason ===
          'sequences'
      ) {

        text.textContent =
          `${winnerName} consiguió 2 secuencias y ganó la partida.`;


      } else if (
        game.finishReason ===
          'abandon'
      ) {

        text.textContent =
          `${winnerName} ganó porque los demás jugadores abandonaron.`;


      } else {

        text.textContent =
          `${winnerName} ganó la partida.`;

      }

    }

  }


  /* =======================================================
     ESTADÍSTICAS
  ======================================================= */

  const mySequences =
    game.sequences?.[
      me?.uid
    ] || 0;


  const playerCount =
    getTurnOrder(
      room
    ).length;


  const startedAt =
    Number(
      game.startedAt ||
      room.createdAt ||
      0
    );


  const finishedAt =
    Number(
      game.finishedAt ||
      game.updatedAt ||
      Date.now()
    );


  const duration =
    startedAt

      ? finishedAt -
          startedAt

      : 0;


  if (
    $('resultSequences')
  ) {

    $('resultSequences')
      .textContent =
        `${mySequences}/2`;

  }


  if (
    $('resultMoves')
  ) {

    $('resultMoves')
      .textContent =
        game.moveCount ||
        0;

  }


  if (
    $('resultPlayers')
  ) {

    $('resultPlayers')
      .textContent =
        playerCount;

  }


  if (
    $('resultDuration')
  ) {

    $('resultDuration')
      .textContent =
        formatDuration(
          duration
        );

  }


  /*
    Revancha solamente si quedan
    por lo menos 2 jugadores.
  */
  const rematchButton =
    $('rematchBtn');


  if (rematchButton) {

    const remainingPlayers =
      Object.keys(
        room.players ||
        {}
      ).length;


    rematchButton.classList.toggle(
      'hidden',
      remainingPlayers <
        2
    );


    rematchButton.disabled =
      !!room.rematchVotes?.[
        me?.uid
      ];


    rematchButton.textContent =

      room.rematchVotes?.[
        me?.uid
      ]

        ? '✓ Revancha solicitada'

        : '↻ Revancha';

  }


  /*
    Sonido solamente la primera vez
    que aparece el modal.
  */
  if (
    modal.classList.contains(
      'hidden'
    )
  ) {

    playSound(
      iWon
        ? 'win'
        : 'lose'
    );

  }


  modal.classList.remove(
    'hidden'
  );

}


/* =========================================================
   BOTÓN VOLVER AL LOBBY DESDE RESULTADO
========================================================= */

const modalOk =
  $('modalOk');


if (modalOk) {

  modalOk.addEventListener(

    'click',

    async () => {

      $('modal')
        ?.classList.add(
          'hidden'
        );


      await leaveRoom();

    }

  );

}


/* =========================================================
   CREAR NUEVA PARTIDA PARA REVANCHA
========================================================= */

function createRematchGame(
  room
) {

  /*
    Solamente los jugadores que
    todavía siguen en room.players.
  */
  const ids =
    getPlayerIds(
      room
    );


  if (
    ids.length <
      2
  ) {

    return null;

  }


  const deck =
    makeDeck();


  const hands =
    {};


  const handSize =

    ids.length ===
      2

      ? 7

      : 6;


  ids.forEach(

    uid => {

      hands[
        uid
      ] =
        deck.splice(
          0,
          handSize
        );

    }

  );


  const playerNames =
    Object.fromEntries(

      ids.map(

        uid => [

          uid,

          playerName(
            room,
            uid
          )

        ]

      )

    );


  const startedAt =
    Date.now();


  const nextRematchNumber =
    (
      room.game
        ?.rematchNumber ||
      0
    ) + 1;


  /*
    Rotar el jugador inicial.

    Partida original:
    J1 empieza

    Revancha 1:
    J2 empieza

    Revancha 2:
    J3 empieza

    etc.
  */
  const firstPlayerIndex =
    nextRematchNumber %
    ids.length;


  return {

    board:
      makeBoard(),


    deck,


    hands,


    chips:
      {},


    /*
      NUEVO ORDEN COMPLETO
      de quienes siguen en la sala.
    */
    turnOrder:
      [...ids],


    playerNames,


    turn:
      ids[
        firstPlayerIndex
      ],


    winner:
      null,


    finishReason:
      null,


    sequences:

      Object.fromEntries(

        ids.map(

          uid => [
            uid,
            0
          ]

        )

      ),


    completedSequences:
      {},


    moveCount:
      0,


    rematchNumber:
      nextRematchNumber,


    startedAt,


    finishedAt:
      null,


    lastMove:
      null,


    updatedAt:
      startedAt

  };

}


/* =========================================================
   REVANCHA
========================================================= */

const rematchBtn =
  $('rematchBtn');


if (rematchBtn) {

  rematchBtn.addEventListener(

    'click',

    async () => {

      if (
        !currentRoomCode ||
        !currentRoom ||
        !me
      ) {

        return;

      }


      rematchBtn.disabled =
        true;


      rematchBtn.textContent =
        'Esperando jugadores…';


      status(
        'gameStatus',
        'Solicitaste una revancha.'
      );


      try {

        const roomRef =
          ref(
            db,
            `rooms/${currentRoomCode}`
          );


        const result =
          await runTransaction(

            roomRef,

            room => {

              if (
                !room ||
                room.status !==
                  'finished' ||
                !room.game
              ) {

                return;

              }


              const players =
                Object.keys(
                  room.players ||
                  {}
                );


              if (
                !players.includes(
                  me.uid
                )
              ) {

                return;

              }


              if (
                players.length <
                  2
              ) {

                return;

              }


              room.rematchVotes =
                room.rematchVotes ||
                {};


              room.rematchVotes[
                me.uid
              ] =
                true;


              /*
                Todos los jugadores actuales
                deben aceptar la revancha.
              */
              const allAccepted =
                players.every(

                  uid =>
                    room.rematchVotes?.[
                      uid
                    ] === true

                );


              if (
                allAccepted
              ) {

                const newGame =
                  createRematchGame(
                    room
                  );


                if (!newGame) {

                  return;

                }


                room.game =
                  newGame;


                room.status =
                  'playing';


                room.rematchVotes =
                  {};


                room.updatedAt =
                  Date.now();

              }


              return room;

            }

          );


        if (
          !result.committed
        ) {

          rematchBtn.disabled =
            false;


          rematchBtn.textContent =
            '↻ Revancha';


          status(
            'gameStatus',
            'No se pudo solicitar la revancha.'
          );


        } else {

          const updatedRoom =
            result.snapshot.val();


          if (updatedRoom) {

            currentRoom =
              updatedRoom;

          }


          if (
            updatedRoom?.status ===
              'playing'
          ) {

            $('modal')
              ?.classList.add(
                'hidden'
              );


            resultRecordedForRoom =
              null;


            selectedCardIndex =
              null;


            playSound(
              'move'
            );


            renderGame(
              updatedRoom
            );


            status(
              'gameStatus',
              '¡Comienza la revancha!'
            );

          }

        }


      } catch (error) {

        console.error(
          'ERROR REVANCHA:',
          error
        );


        rematchBtn.disabled =
          false;


        rematchBtn.textContent =
          '↻ Revancha';


        status(
          'gameStatus',
          'No se pudo solicitar la revancha.'
        );

      }

    }

  );

}


/* =========================================================
   MODAL CONFIRMAR SALIR
========================================================= */

function openLeaveConfirm() {

  const modal =
    $('leaveConfirmModal');


  if (!modal) {

    /*
      Fallback por si el HTML no contiene
      el modal todavía.
    */
    const accepted =
      window.confirm(
        '¿Salir de la partida? Si abandonas, la partida continuará sin ti.'
      );


    if (accepted) {

      leaveRoom();

    }


    return;

  }


  modal.classList.remove(
    'hidden'
  );

}


function closeLeaveConfirm() {

  $('leaveConfirmModal')
    ?.classList.add(
      'hidden'
    );

}


/* =========================================================
   BOTONES SALIR
========================================================= */

[
  'leaveRoomBtn',
  'leaveGameBtn'
].forEach(

  id => {

    const button =
      $(id);


    if (!button) {
      return;
    }


    button.addEventListener(

      'click',

      () => {

        openLeaveConfirm();

      }

    );

  }

);


/* =========================================================
   CANCELAR SALIDA
========================================================= */

const cancelLeaveBtn =
  $('cancelLeaveGameBtn');


if (cancelLeaveBtn) {

  cancelLeaveBtn.addEventListener(

    'click',

    () => {

      closeLeaveConfirm();

    }

  );

}


/* =========================================================
   CONFIRMAR SALIDA
========================================================= */

const confirmLeaveBtn =
  $('confirmLeaveGameBtn');


if (confirmLeaveBtn) {

  confirmLeaveBtn.addEventListener(

    'click',

    async () => {

      confirmLeaveBtn.disabled =
        true;


      try {

        closeLeaveConfirm();


        await leaveRoom();


      } finally {

        confirmLeaveBtn.disabled =
          false;

      }

    }

  );

}


/* =========================================================
   VOLVER AL LOBBY LOCALMENTE
========================================================= */

function leaveToLobby(message = '') {

  if (roomUnsub) {

    roomUnsub();

    roomUnsub =
      null;

  }


  currentRoomCode =
    null;


  currentRoom =
    null;


  selectedCardIndex =
    null;


  moveInFlight =
    false;


  reconnectRoomCode =
    null;


  lastQuickChatId =
    null;


  if (
    quickChatHideTimer
  ) {

    clearTimeout(
      quickChatHideTimer
    );


    quickChatHideTimer =
      null;

  }


  $('modal')
    ?.classList.add(
      'hidden'
    );


  $('leaveConfirmModal')
    ?.classList.add(
      'hidden'
    );


  showView(
    'lobbyView'
  );


  status(
    'lobbyStatus',
    message
  );


  loadStats();

}


/* =========================================================
   ABANDONAR SALA EXPLÍCITAMENTE
========================================================= */

async function leaveRoom() {

  if (
    !currentRoomCode ||
    !me
  ) {

    forgetActiveRoom();


    leaveToLobby();


    return;

  }


  const code =
    currentRoomCode;


  /*
    Guardamos antes porque leaveToLobby()
    limpia currentRoomCode.
  */
  const uid =
    me.uid;


  try {

    /*
      Cancelar onDisconnect de presencia.

      Aquí SÍ estamos abandonando
      de manera voluntaria.
    */
    if (presenceDisconnect) {

      try {

        await presenceDisconnect.cancel();

      } catch (error) {

        console.warn(
          'No se pudo cancelar presencia:',
          error
        );

      }


      presenceDisconnect =
        null;

    }


    await runTransaction(

      ref(
        db,
        `rooms/${code}`
      ),

      room => {

        if (!room) {
          return;
        }


        const players =
          room.players ||
          {};


        /*
          Si ya no está dentro,
          no tenemos nada que quitar.
        */
        if (
          !players[
            uid
          ]
        ) {

          return room;

        }


        /*
          BORRADO SOLO POR SALIDA EXPLÍCITA.
        */
        delete room.players[
          uid
        ];


        if (
          room.rematchVotes?.[
            uid
          ] !== undefined
        ) {

          delete room.rematchVotes[
            uid
          ];

        }


        const remaining =
          Object.keys(
            room.players ||
            {}
          );


        /* =====================================================
           YA NO QUEDA NADIE
        ===================================================== */

        if (
          !remaining.length
        ) {

          /*
            Firebase elimina la sala completa
            devolviendo null.
          */
          return null;

        }


        /* =====================================================
           TRANSFERIR HOST
        ===================================================== */

        if (
          room.host ===
            uid
        ) {

          const orderedRemaining =

            getTurnOrder(
              room
            ).filter(

              playerUid =>
                remaining.includes(
                  playerUid
                )

            );


          room.host =

            orderedRemaining[0]

            ||

            remaining[0];

        }


        /* =====================================================
           PARTIDA ACTIVA
        ===================================================== */

        if (
          room.status ===
            'playing' &&
          room.game &&
          !room.game.winner
        ) {

          if (
            remaining.length ===
              1
          ) {

            room.game.winner =
              remaining[0];


            room.game.finishReason =
              'abandon';


            room.game.finishedAt =
              Date.now();


            room.status =
              'finished';


          } else if (
            room.game.turn ===
              uid
          ) {

            /*
              El jugador que abandonó tenía
              el turno. Buscar el siguiente
              usando turnOrder original.
            */
            const next =
              getNextActivePlayer(
                room,
                uid
              );


            if (next) {

              room.game.turn =
                next;

            }

          }


          room.game.updatedAt =
            Date.now();

        }


        room.updatedAt =
          Date.now();


        return room;

      }

    );


  } catch (error) {

    console.error(
      'ERROR SALIENDO DE SALA:',
      error
    );


  } finally {

    forgetActiveRoom();


    leaveToLobby();

  }

}

/* =========================================================
   MATCHMAKING PÚBLICO
========================================================= */

const matchBtn =
  $('matchBtn');


if (matchBtn) {

  matchBtn.addEventListener(

    'click',

    async () => {

      if (
        !me ||
        !displayName
      ) {

        status(
          'matchStatus',
          'Primero selecciona un nickname.'
        );


        return;

      }


      if (
        currentRoomCode
      ) {

        status(
          'matchStatus',
          'Ya estás dentro de una sala.'
        );


        return;

      }


      matchBtn.classList.add(
        'hidden'
      );


      const cancelBtn =
        $('cancelMatchBtn');


      cancelBtn?.classList.remove(
        'hidden'
      );


      status(
        'matchStatus',
        'Buscando oponente…'
      );


      try {

        const queueRef =
          ref(
            db,
            `matchmaking/${me.uid}`
          );


        await set(

          queueRef,

          {

            uid:
              me.uid,


            name:
              displayName,


            joinedAt:
              Date.now()

          }

        );


        /*
          Si se cierra el navegador
          mientras busca partida,
          se elimina de la cola.
        */
        try {

          await onDisconnect(
            queueRef
          ).remove();


        } catch (error) {

          console.warn(
            'No se pudo registrar onDisconnect del matchmaking:',
            error
          );

        }


        await tryMatch();


      } catch (error) {

        console.error(
          'ERROR MATCHMAKING:',
          error
        );


        status(
          'matchStatus',
          'No se pudo iniciar la búsqueda.'
        );


        await cancelMatch();

      }

    }

  );

}


/* =========================================================
   CANCELAR MATCHMAKING
========================================================= */

const cancelMatchBtn =
  $('cancelMatchBtn');


if (cancelMatchBtn) {

  cancelMatchBtn.addEventListener(

    'click',

    async () => {

      await cancelMatch();

    }

  );

}


/* =========================================================
   CANCELAR MATCH
========================================================= */

async function cancelMatch() {

  if (me) {

    try {

      await remove(

        ref(
          db,
          `matchmaking/${me.uid}`
        )

      );


    } catch (error) {

      console.warn(
        'No se pudo quitar usuario de matchmaking:',
        error
      );

    }

  }


  const matchButton =
    $('matchBtn');


  const cancelButton =
    $('cancelMatchBtn');


  if (matchButton) {

    matchButton.classList.remove(
      'hidden'
    );

  }


  if (cancelButton) {

    cancelButton.classList.add(
      'hidden'
    );

  }


  status(
    'matchStatus',
    ''
  );

}


/* =========================================================
   INTENTAR FORMAR PARTIDA 1 VS 1
========================================================= */

async function tryMatch() {

  if (
    !me ||
    currentRoomCode
  ) {

    return;

  }


  /*
    Confirmar que todavía
    estamos esperando.
  */
  const myQueueSnap =
    await get(

      ref(
        db,
        `matchmaking/${me.uid}`
      )

    );


  if (
    !myQueueSnap.exists()
  ) {

    return;

  }


  const queueSnap =
    await get(

      ref(
        db,
        'matchmaking'
      )

    );


  if (
    !queueSnap.exists()
  ) {

    return;

  }


  const queue =
    queueSnap.val() ||
    {};


  const opponents =
    Object.values(
      queue
    )

      .filter(

        player =>

          player &&
          player.uid &&
          player.uid !==
            me.uid

      )

      .sort(

        (a, b) =>

          (
            a.joinedAt ||
            0
          )

          -

          (
            b.joinedAt ||
            0
          )

      );


  if (
    !opponents.length
  ) {

    return;

  }


  const other =
    opponents[0];


  /*
    Solo uno crea la sala.

    Esto evita que ambos clientes
    creen dos salas simultáneamente.
  */
  if (

    me.uid.localeCompare(
      other.uid
    ) > 0

  ) {

    return;

  }


  /*
    Confirmar que el otro jugador
    todavía sigue esperando.
  */
  const otherQueueSnap =
    await get(

      ref(
        db,
        `matchmaking/${other.uid}`
      )

    );


  if (
    !otherQueueSnap.exists()
  ) {

    return;

  }


  /*
    Generar código único.
  */
  let code =
    null;


  for (
    let i = 0;
    i < 10;
    i++
  ) {

    const candidate =
      randomCode();


    const roomSnap =
      await get(

        ref(
          db,
          `rooms/${candidate}`
        )

      );


    if (
      !roomSnap.exists()
    ) {

      code =
        candidate;


      break;

    }

  }


  if (!code) {

    return;

  }


  const now =
    Date.now();


  const room = {

    code,


    host:
      me.uid,


    status:
      'waiting',


    maxPlayers:
      2,


    matchType:
      'public',


    createdAt:
      now,


    updatedAt:
      now,


    players: {

      [me.uid]: {

        name:
          displayName,


        joinedAt:
          now,


        connected:
          true,


        lastSeen:
          now

      },


      [other.uid]: {

        name:
          other.name ||
          'Jugador',


        joinedAt:
          now + 1,


        connected:
          true,


        lastSeen:
          now

      }

    }

  };


  /*
    Volver a confirmar que ambos
    siguen en matchmaking.
  */
  const [
    mineCheck,
    otherCheck
  ] =
    await Promise.all(
      [

        get(
          ref(
            db,
            `matchmaking/${me.uid}`
          )
        ),


        get(
          ref(
            db,
            `matchmaking/${other.uid}`
          )
        )

      ]
    );


  if (
    !mineCheck.exists() ||
    !otherCheck.exists()
  ) {

    return;

  }


  /*
    Crear sala.
  */
  await set(

    ref(
      db,
      `rooms/${code}`
    ),

    room

  );


  /*
    Sacar a ambos
    de matchmaking.
  */
  await Promise.all(
    [

      remove(
        ref(
          db,
          `matchmaking/${me.uid}`
        )
      ),


      remove(
        ref(
          db,
          `matchmaking/${other.uid}`
        )
      )

    ]
  );


  /*
    Avisar al rival.
  */
  await set(

    ref(
      db,
      `matchesByUser/${other.uid}`
    ),

    {

      roomCode:
        code,


      createdAt:
        Date.now()

    }

  );


  rememberActiveRoom(
    code
  );


  await enterRoom(
    code
  );

}


/* =========================================================
   REINTENTAR MATCHMAKING
========================================================= */

setInterval(

  async () => {

    const cancelButton =
      $('cancelMatchBtn');


    if (
      !cancelButton

      ||

      cancelButton.classList.contains(
        'hidden'
      )

      ||

      !me

      ||

      currentRoomCode
    ) {

      return;

    }


    try {

      await tryMatch();


    } catch (error) {

      console.warn(
        'Reintento matchmaking:',
        error
      );

    }

  },

  2500

);


/* =========================================================
   REFRESCAR RECONEXIÓN
========================================================= */

/*
  Cuando el usuario vuelve a la pestaña,
  comprobar si tiene partida pendiente.
*/
document.addEventListener(

  'visibilitychange',

  () => {

    if (
      document.visibilityState ===
        'visible'

      &&

      me

      &&

      !currentRoomCode
    ) {

      checkReconnectOption();

    }

  }

);


/* =========================================================
   LIMPIEZA LOCAL AL CERRAR
========================================================= */

window.addEventListener(

  'beforeunload',

  () => {

    /*
      IMPORTANTE:

      NO borramos kc_active_room.

      NO llamamos leaveRoom().

      NO eliminamos al jugador.

      Firebase solamente ejecutará
      presenceDisconnect y pondrá:

      connected:false
    */

    selectedCardIndex =
      null;


    moveInFlight =
      false;

  }

);

/* =========================================================
   CHAT RÁPIDO
========================================================= */

function ensureQuickChatUI() {

  if (
    document.getElementById(
      'quickChatButton'
    )
  ) {
    return;
  }


  /* =======================================================
     ESTILOS
  ======================================================= */

  const style =
    document.createElement(
      'style'
    );


  style.id =
    'kc-quick-chat-styles';


  style.textContent = `

    /* ==========================================
       BOTÓN FLOTANTE
    ========================================== */

    .quick-chat-button{
      position:fixed;

      right:18px;
      bottom:18px;

      width:54px;
      height:54px;

      display:flex;
      align-items:center;
      justify-content:center;

      border:none;

      border-radius:50%;

      background:
        linear-gradient(
          145deg,
          #f6c453,
          #d99d28
        );

      color:#111827;

      font-size:23px;

      cursor:pointer;

      z-index:9995;

      box-shadow:
        0 12px 30px
        rgba(0,0,0,.40);

      transition:
        transform .18s ease,
        box-shadow .18s ease,
        opacity .18s ease;
    }


    .quick-chat-button:hover{
      transform:
        translateY(-2px)
        scale(1.04);

      box-shadow:
        0 14px 34px
        rgba(0,0,0,.46);
    }


    .quick-chat-button:active{
      transform:
        scale(.95);
    }


    .quick-chat-button.hidden{
      display:none !important;
    }


    /* ==========================================
       MENÚ
    ========================================== */

    .quick-chat-menu{
      position:fixed;

      right:18px;
      bottom:82px;

      width:
        min(
          310px,
          calc(
            100vw - 28px
          )
        );

      max-height:
        min(
          430px,
          calc(
            100vh - 130px
          )
        );

      overflow-y:auto;

      padding:12px;

      border:
        1px solid
        rgba(244,191,79,.22);

      border-radius:18px;

      background:
        rgba(
          10,
          17,
          30,
          .97
        );

      backdrop-filter:
        blur(16px);

      -webkit-backdrop-filter:
        blur(16px);

      box-shadow:
        0 22px 60px
        rgba(0,0,0,.50);

      z-index:9994;
    }


    .quick-chat-menu.hidden{
      display:none !important;
    }


    .quick-chat-header{
      display:flex;
      align-items:center;
      justify-content:space-between;

      gap:10px;

      margin-bottom:10px;

      padding:
        2px 3px
        8px;
    }


    .quick-chat-header strong{
      color:#f8fafc;

      font-size:13px;
    }


    .quick-chat-header small{
      color:#7f8da5;

      font-size:9px;

      letter-spacing:.08em;

      text-transform:uppercase;
    }


    .quick-chat-grid{
      display:grid;

      grid-template-columns:
        repeat(
          2,
          minmax(
            0,
            1fr
          )
        );

      gap:8px;
    }


    .quick-chat-option{
      min-height:48px;

      display:flex;
      align-items:center;

      gap:7px;

      padding:
        9px 10px;

      border:
        1px solid
        rgba(148,163,184,.14);

      border-radius:12px;

      background:
        rgba(255,255,255,.035);

      color:#e5e7eb;

      cursor:pointer;

      text-align:left;

      font-size:11px;

      font-weight:700;

      transition:
        background .16s ease,
        border-color .16s ease,
        transform .16s ease;
    }


    .quick-chat-option:hover{
      background:
        rgba(244,191,79,.09);

      border-color:
        rgba(244,191,79,.30);

      transform:
        translateY(-1px);
    }


    .quick-chat-option span:first-child{
      flex:0 0 auto;

      font-size:18px;
    }


    /* ==========================================
       BURBUJA MENSAJE
    ========================================== */

    .quick-chat-toast{
      position:fixed;

      left:50%;
      top:88px;

      transform:
        translateX(-50%)
        translateY(-8px);

      min-width:
        min(
          290px,
          calc(
            100vw - 32px
          )
        );

      max-width:
        min(
          430px,
          calc(
            100vw - 32px
          )
        );

      padding:
        11px 14px;

      display:flex;
      align-items:center;

      gap:10px;

      border:
        1px solid
        rgba(244,191,79,.22);

      border-radius:15px;

      background:
        rgba(
          10,
          17,
          30,
          .95
        );

      backdrop-filter:
        blur(15px);

      -webkit-backdrop-filter:
        blur(15px);

      box-shadow:
        0 16px 44px
        rgba(0,0,0,.40);

      z-index:9996;

      opacity:0;

      pointer-events:none;

      transition:
        opacity .20s ease,
        transform .20s ease;
    }


    .quick-chat-toast.show{
      opacity:1;

      transform:
        translateX(-50%)
        translateY(0);
    }


    .quick-chat-toast-emoji{
      flex:0 0 auto;

      width:36px;
      height:36px;

      display:flex;
      align-items:center;
      justify-content:center;

      border-radius:50%;

      background:
        rgba(244,191,79,.10);

      font-size:20px;
    }


    .quick-chat-toast-content{
      min-width:0;

      display:flex;
      flex-direction:column;

      gap:2px;
    }


    .quick-chat-toast-name{
      color:#f6c453;

      font-size:10px;

      font-weight:800;

      white-space:nowrap;

      overflow:hidden;

      text-overflow:ellipsis;
    }


    .quick-chat-toast-text{
      color:#f8fafc;

      font-size:13px;

      font-weight:800;
    }


    @media(max-width:600px){

      .quick-chat-button{
        right:12px;
        bottom:
          calc(
            12px +
            env(
              safe-area-inset-bottom
            )
          );

        width:50px;
        height:50px;

        font-size:21px;
      }


      .quick-chat-menu{
        right:10px;

        bottom:
          calc(
            72px +
            env(
              safe-area-inset-bottom
            )
          );

        width:
          calc(
            100vw - 20px
          );
      }


      .quick-chat-grid{
        grid-template-columns:
          repeat(
            2,
            minmax(
              0,
              1fr
            )
          );
      }


      .quick-chat-toast{
        top:
          calc(
            72px +
            env(
              safe-area-inset-top
            )
          );
      }

    }

  `;


  document.head.appendChild(
    style
  );


  /* =======================================================
     BOTÓN
  ======================================================= */

  const button =
    document.createElement(
      'button'
    );


  button.id =
    'quickChatButton';


  button.type =
    'button';


  button.className =
    'quick-chat-button hidden';


  button.setAttribute(
    'aria-label',
    'Abrir chat rápido'
  );


  button.textContent =
    '💬';


  document.body.appendChild(
    button
  );


  /* =======================================================
     MENÚ
  ======================================================= */

  const menu =
    document.createElement(
      'div'
    );


  menu.id =
    'quickChatMenu';


  menu.className =
    'quick-chat-menu hidden';


  menu.innerHTML = `

    <div class="quick-chat-header">

      <div>
        <strong>Chat rápido</strong>
        <br>
        <small>Mensajes predefinidos</small>
      </div>

    </div>


    <div
      class="quick-chat-grid"
      id="quickChatGrid"
    ></div>

  `;


  document.body.appendChild(
    menu
  );


  const grid =
    menu.querySelector(
      '#quickChatGrid'
    );


  QUICK_CHAT_MESSAGES.forEach(

    message => {

      const option =
        document.createElement(
          'button'
        );


      option.type =
        'button';


      option.className =
        'quick-chat-option';


      option.innerHTML = `

        <span>
          ${message.emoji}
        </span>

        <span>
          ${
            escapeHtml(
              message.text
            )
          }
        </span>

      `;


      option.addEventListener(

        'click',

        async () => {

          menu.classList.add(
            'hidden'
          );


          await sendQuickChat(
            message.id
          );

        }

      );


      grid.appendChild(
        option
      );

    }

  );


  button.addEventListener(

    'click',

    event => {

      event.stopPropagation();


      menu.classList.toggle(
        'hidden'
      );

    }

  );


  menu.addEventListener(

    'click',

    event => {

      event.stopPropagation();

    }

  );


  document.addEventListener(

    'click',

    () => {

      menu.classList.add(
        'hidden'
      );

    }

  );


  /* =======================================================
     BURBUJA
  ======================================================= */

  const toast =
    document.createElement(
      'div'
    );


  toast.id =
    'quickChatToast';


  toast.className =
    'quick-chat-toast';


  toast.innerHTML = `

    <span
      class="quick-chat-toast-emoji"
      id="quickChatToastEmoji"
    >
      💬
    </span>


    <div
      class="quick-chat-toast-content"
    >

      <span
        class="quick-chat-toast-name"
        id="quickChatToastName"
      ></span>


      <span
        class="quick-chat-toast-text"
        id="quickChatToastText"
      ></span>

    </div>

  `;


  document.body.appendChild(
    toast
  );

}


/* =========================================================
   MOSTRAR / OCULTAR CHAT
========================================================= */

function setQuickChatVisible(
  visible
) {

  ensureQuickChatUI();


  const button =
    $('quickChatButton');


  const menu =
    $('quickChatMenu');


  if (!button) {
    return;
  }


  button.classList.toggle(
    'hidden',
    !visible
  );


  if (!visible) {

    menu?.classList.add(
      'hidden'
    );

  }

}


/* =========================================================
   ENVIAR MENSAJE RÁPIDO
========================================================= */

async function sendQuickChat(
  messageId
) {

  if (
    !currentRoomCode ||
    !currentRoom?.game ||
    !me
  ) {

    return;

  }


  if (
    currentRoom.status !==
      'playing' ||
    currentRoom.game.winner
  ) {

    return;

  }


  const message =
    QUICK_CHAT_MESSAGES.find(

      item =>
        item.id ===
          messageId

    );


  if (!message) {
    return;
  }


  /*
    Anti-spam local sencillo.
  */
  const now =
    Date.now();


  if (
    now -
    lastQuickChatSentAt <
      900
  ) {

    status(
      'gameStatus',
      'Espera un momento antes de enviar otro mensaje.'
    );


    return;

  }


  lastQuickChatSentAt =
    now;


  try {

    await set(

      ref(
        db,
        `rooms/${currentRoomCode}/quickChat`
      ),

      {

        id:
          `${now}_${me.uid}`,


        uid:
          me.uid,


        messageId:
          message.id,


        clientAt:
          now,


        at:
          serverTimestamp()

      }

    );


  } catch (error) {

    console.error(
      'ERROR CHAT RÁPIDO:',
      error
    );


    status(
      'gameStatus',
      'No se pudo enviar el mensaje.'
    );

  }

}


/* =========================================================
   LEER CHAT RÁPIDO
========================================================= */

function renderQuickChatMessage(
  room
) {

  if (
    !room ||
    !room.quickChat
  ) {

    return;

  }


  ensureQuickChatUI();


  const chat =
    room.quickChat;


  if (
    !chat.id ||
    chat.id ===
      lastQuickChatId
  ) {

    return;

  }


  /*
    No mostrar mensajes demasiado viejos
    al reconectar.
  */
  const messageTime =
    Number(
      chat.clientAt ||
      chat.at ||
      0
    );


  if (

    messageTime

    &&

    Date.now() -
      messageTime >
      8000

  ) {

    lastQuickChatId =
      chat.id;


    return;

  }


  const message =
    QUICK_CHAT_MESSAGES.find(

      item =>
        item.id ===
          chat.messageId

    );


  if (!message) {

    lastQuickChatId =
      chat.id;


    return;

  }


  lastQuickChatId =
    chat.id;


  const toast =
    $('quickChatToast');


  const emoji =
    $('quickChatToastEmoji');


  const name =
    $('quickChatToastName');


  const text =
    $('quickChatToastText');


  if (
    !toast ||
    !emoji ||
    !name ||
    !text
  ) {

    return;

  }


  emoji.textContent =
    message.emoji;


  name.textContent =

    chat.uid ===
      me?.uid

      ? 'Tú'

      : playerName(
          room,
          chat.uid
        );


  text.textContent =
    message.text;


  /*
    Reiniciar temporizador si había
    otro mensaje mostrándose.
  */
  if (
    quickChatHideTimer
  ) {

    clearTimeout(
      quickChatHideTimer
    );

  }


  toast.classList.add(
    'show'
  );


  quickChatHideTimer =
    setTimeout(

      () => {

        toast.classList.remove(
          'show'
        );


        quickChatHideTimer =
          null;

      },

      4000

    );

}


/* =========================================================
   ALIAS PARA COMPATIBILIDAD
========================================================= */

/*
  En renderGame usamos este nombre.
*/
function renderQuickChat(
  room
) {

  renderQuickChatMessage(
    room
  );

}


/* =========================================================
   ACTUALIZAR VISIBILIDAD CHAT AL RENDERIZAR JUEGO
========================================================= */

const originalRenderGame =
  renderGame;


renderGame =
  function(room) {

    originalRenderGame(
      room
    );


    setQuickChatVisible(

      room?.status ===
        'playing'

      &&

      !room?.game?.winner

    );


    renderQuickChatMessage(
      room
    );

  };


/* =========================================================
   OCULTAR CHAT AL VOLVER AL LOBBY
========================================================= */

const originalLeaveToLobby =
  leaveToLobby;


leaveToLobby =
  function(message = '') {

    setQuickChatVisible(
      false
    );


    originalLeaveToLobby(
      message
    );

  };


/* =========================================================
   CAMBIAR JUGADOR / NICKNAME
========================================================= */

const changePlayerBtn =
  $('changePlayerBtn');


if (changePlayerBtn) {

  changePlayerBtn.addEventListener(

    'click',

    () => {

      if (
        currentRoomCode
      ) {

        status(
          'lobbyStatus',
          'Sal de la partida antes de cambiar de jugador.'
        );


        return;

      }


      const input =
        $('nameInput');


      if (input) {

        input.value =
          displayName ||
          '';

      }


      showView(
        'authView'
      );

    }

  );

}


/* =========================================================
   INICIALIZAR ELEMENTOS EXTRA
========================================================= */

ensureQuickChatUI();


setQuickChatVisible(
  false
);


/* =========================================================
   INICIAR APP
========================================================= */

bootstrap();