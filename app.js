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

/* =========================================================
   JUGADA AUTOMÁTICA
========================================================= */

/*
  Si un jugador todavía está en modo manual:
  tiene 20 segundos para tocar una carta.

  Si no toca nada:
  entra en modo AUTO.

  Cuando ya está en AUTO:
  en sus siguientes turnos solamente esperamos
  5 segundos antes de jugar automáticamente.

  Si toca una carta:
  recupera el control manual inmediatamente.
*/

const AUTO_PLAY_IDLE_DELAY_MS =
  20000;

const AUTO_PLAY_ACTIVE_DELAY_MS =
  5000;


let autoPlayTimer =
  null;

let autoPlayKey =
  null;

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
    !room?.game ||
    room.status !== 'finished' ||
    !currentRoomCode
  ) {

    return;

  }


  const code =
    currentRoomCode;


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

        if (current) {
          return;
        }


        const winnerUid =
          room.game.winner ||
          null;


        const isDraw =
          room.game.finishReason ===
            'draw';


        const order =
          getTurnOrder(
            room
          );


        return {

          roomCode:
            code,

          gameId,

          won:
            !isDraw &&
            winnerUid ===
              me.uid,

          draw:
            isDraw,

          winnerUid,

          winnerName:
            isDraw
              ? 'Empate'
              : playerName(
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


    if ($('statGames')) {
      $('statGames').textContent = played;
    }


    if ($('statWins')) {
      $('statWins').textContent = wins;
    }


    if ($('statWinRate')) {
      $('statWinRate').textContent = `${winRate}%`;
    }


    if ($('statStreak')) {
      $('statStreak').textContent = streak;
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


          const draw =
            item.draw === true ||
            item.finishReason ===
              'draw';


          const opponent =
            item.winnerName ||
            'Jugador';


          return `

            <div
              class="recent-game-item ${
                draw
                  ? 'draw'
                  : won
                    ? 'win'
                    : 'loss'
              }"
            >

              <span>
                ${
                  draw
                    ? '='
                    : won
                      ? '✓'
                      : '✕'
                }
              </span>


              <div>

                <strong>
                  ${
                    draw
                      ? 'Empate'
                      : won
                        ? 'Victoria'
                        : 'Derrota'
                  }
                </strong>


                <small>

                  ${
                    draw

                      ? 'Nadie tenía movimientos posibles'

                      : won

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

function makeDeck(
  playerCount = 2
) {

  const deck =
    [];


  /*
    CARTAS NORMALES

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
          rank ===
            'J'
        ) {

          continue;

        }


        deck.push(
          cardId(
            suit,
            rank
          )
        );

      }

    }

  }


  /*
    JOTAS SEGÚN JUGADORES

    2 jugadores:
      2 J♥
      2 J♦
      2 J♣
      2 J♠

      TOTAL = 8
      4 libres
      4 para quitar.


    3 o 4 jugadores:
      3 J♥
      3 J♦
      3 J♣
      3 J♠

      TOTAL = 12
      6 libres
      6 para quitar.
  */

  const jackCopiesPerSuit =

    Number(
      playerCount
    ) >= 3

      ? 3

      : 2;


  for (
    let x = 0;
    x <
      jackCopiesPerSuit;
    x++
  ) {

    deck.push(

      cardId(
        'H',
        'J'
      ),

      cardId(
        'D',
        'J'
      ),

      cardId(
        'C',
        'J'
      ),

      cardId(
        'S',
        'J'
      )

    );

  }


  return shuffle(
    deck
  );

}


/* =========================================================
   TABLERO OFICIAL KCEQUENCE
   DISTRIBUCIÓN FIJA 10 x 10
========================================================= */

/*
  La distribución sigue el tablero físico
  de referencia que elegimos.

  S = ♠
  H = ♥
  D = ♦
  C = ♣

  Las cuatro esquinas son libres.
*/

/* =========================================================
   TABLERO OFICIAL KCEQUENCE
   Basado en la distribución del tablero físico
   10 x 10 = 100 posiciones
========================================================= */

/*
  PALOS:

  S = ♠ Espadas
  H = ♥ Corazones
  D = ♦ Diamantes
  C = ♣ Tréboles

  FREE = esquina libre / comodín

  IMPORTANTE:
  - El tablero NO se mezcla.
  - Siempre mantiene esta distribución.
  - Las Jotas NO aparecen impresas en el tablero.
  - Las cuatro esquinas son libres.
*/

const KCEQUENCE_BOARD = [

  /* =====================================================
     FILA 1
     ★  2♠  3♠  4♠  5♠  6♠  7♠  8♠  9♠  ★
  ===================================================== */

  FREE,
  '2S',
  '3S',
  '4S',
  '5S',
  '6S',
  '7S',
  '8S',
  '9S',
  FREE,


  /* =====================================================
     FILA 2
     6♣  5♣  4♣  3♣  2♣  A♥  K♥  Q♥  10♥  10♠
  ===================================================== */

  '6C',
  '5C',
  '4C',
  '3C',
  '2C',
  'AH',
  'KH',
  'QH',
  '10H',
  '10S',


  /* =====================================================
     FILA 3
     7♣  A♠  2♦  3♦  4♦  5♦  6♦  7♦  9♥  Q♠
  ===================================================== */

  '7C',
  'AS',
  '2D',
  '3D',
  '4D',
  '5D',
  '6D',
  '7D',
  '9H',
  'QS',


  /* =====================================================
     FILA 4
     8♣  K♠  6♣  5♣  4♣  3♣  2♣  8♦  8♥  K♠
  ===================================================== */

  '8C',
  'KS',
  '6C',
  '5C',
  '4C',
  '3C',
  '2C',
  '8D',
  '8H',
  'KS',


  /* =====================================================
     FILA 5
     9♣  Q♠  7♣  6♥  5♥  4♥  A♥  9♦  7♥  A♠
  ===================================================== */

  '9C',
  'QS',
  '7C',
  '6H',
  '5H',
  '4H',
  'AH',
  '9D',
  '7H',
  'AS',


  /* =====================================================
     FILA 6
     10♣  10♠  8♣  7♥  2♥  3♥  K♥  10♦  6♥  2♦
  ===================================================== */

  '10C',
  '10S',
  '8C',
  '7H',
  '2H',
  '3H',
  'KH',
  '10D',
  '6H',
  '2D',


  /* =====================================================
     FILA 7
     Q♣  9♠  9♣  8♥  9♥  10♥  Q♥  Q♦  5♥  3♦
  ===================================================== */

  'QC',
  '9S',
  '9C',
  '8H',
  '9H',
  '10H',
  'QH',
  'QD',
  '5H',
  '3D',


  /* =====================================================
     FILA 8
     K♣  8♠  10♣  Q♣  K♣  A♣  A♦  K♦  4♥  4♦
  ===================================================== */

  'KC',
  '8S',
  '10C',
  'QC',
  'KC',
  'AC',
  'AD',
  'KD',
  '4H',
  '4D',


  /* =====================================================
     FILA 9
     A♣  7♠  6♠  5♠  4♠  3♠  2♠  2♥  3♥  5♦
  ===================================================== */

  'AC',
  '7S',
  '6S',
  '5S',
  '4S',
  '3S',
  '2S',
  '2H',
  '3H',
  '5D',


  /* =====================================================
     FILA 10
     ★  A♦  K♦  Q♦  10♦  9♦  8♦  7♦  6♦  ★
  ===================================================== */

  FREE,
  'AD',
  'KD',
  'QD',
  '10D',
  '9D',
  '8D',
  '7D',
  '6D',
  FREE

];


/* =========================================================
   CREAR TABLERO
========================================================= */

function makeBoard() {

  /*
    Se crea una copia para que Firebase
    pueda guardar el tablero sin modificar
    KCEQUENCE_BOARD.
  */

  return [
    ...KCEQUENCE_BOARD
  ];

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
      Cerrar navegador o perder conexión
      NO elimina al jugador.
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


        if (
          currentRoomCode !==
            code
        ) {
          return;
        }


        currentRoom =
          snap.val();


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
            IMPORTANTE:
            Si Firebase cambió de finished a playing
            porque TODOS aceptaron la revancha,
            cerramos el resultado en TODOS los jugadores.
          */
          hideResult();

          selectedCardIndex =
            null;

          moveInFlight =
            false;

          await reconcileActiveGame(
            code
          );

          showView(
            'gameView'
          );

          renderGame(
            currentRoom
          );

          scheduleAutomaticPlay(
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

function isPlayerStillActive(player) {

  return !!player;

}


/* =========================================================
   JUGADORES QUE SIGUEN EN LA PARTIDA
========================================================= */

function getConnectedPlayerIds(room) {

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


        if (!members.length) {

          return;

        }


        if (
          members.length >= 2 &&
          finishAsDrawIfNobodyCanMove(
            room
          )
        ) {

          return room;

        }


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


  const roomCount =
    $('roomCount');


  if (roomCount) {

    roomCount.textContent =
      `${ids.length}/${
        room.maxPlayers ||
        4
      }`;

  }


  const roomCode =
    $('roomCode');


  if (roomCode) {

    roomCode.textContent =
      room.code ||
      currentRoomCode ||
      '------';

  }


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
                makeDeck(
                  ids.length
                );


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

                turnOrder:
                  [...ids],

                playerNames,

                turn:
                  ids[0],

                winner:
                  null,

                finishReason:
                  null,

                sequences,

                completedSequences:
                  {},

                autoPlayers:
                  {},

                manualTurnClaims:
                  {},

                winningSequence:
                  null,

                winningSequenceCells:
                  [],

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


  const gameRoomCode =
    $('gameRoomCode');


  if (gameRoomCode) {

    gameRoomCode.textContent =
      currentRoomCode ||
      room.code ||
      '------';

  }


  renderTurnPanel(
    room
  );


  renderBoard(
    room
  );


  renderHand(
    room
  );


  ensureQuickChatUI();


  renderQuickChatMessage(
    room
  );


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


      if (
        lastMoveIndex ===
          index
      ) {

        button.classList.add(
          'last-move'
        );

      }


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


      if (
        sequenceCells.has(
          index
        )
      ) {

        button.classList.add(
          'sequence-complete'
        );

      }


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

        async () => {

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
            El jugador ya tocó una carta.
            Cancelamos INMEDIATAMENTE cualquier
            jugada automática pendiente en este navegador.
          */
          if (autoPlayTimer) {
            clearTimeout(autoPlayTimer);
            autoPlayTimer = null;
          }

          autoPlayKey = null;


          /*
            Marcamos visualmente la carta primero
            para que la respuesta sea instantánea.
          */
          const previousSelectedCardIndex =
            selectedCardIndex;

          selectedCardIndex =
            index;

          renderBoard(room);
          renderHand(room);


          /*
            Ahora sincronizamos con Firebase
            que el jugador tomó control manual.
          */
          const manualControl =
            await claimManualTurn();

          if (!manualControl) {

            selectedCardIndex =
              previousSelectedCardIndex;

            renderBoard(room);
            renderHand(room);

            return;
          }


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


  if (
    type ===
      'wild'
  ) {

    return !occupied;

  }


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


  return (

    !occupied

    &&

    boardCard ===
      card

  );

}


/* =========================================================
   VALIDAR CASILLA PARA CUALQUIER JUGADOR
========================================================= */

function isLegalTargetForPlayer(
  room,
  card,
  index,
  uid
) {

  const game =
    room?.game;


  if (
    !game ||
    !uid ||
    !Number.isInteger(index)
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
    game.board[index];


  const chipUid =
    game.chips?.[index];


  const occupied =
    !!chipUid;


  if (
    boardCard === FREE
  ) {

    return false;

  }


  const type =
    jackType(card);


  if (
    type === 'wild'
  ) {

    return !occupied;

  }


  if (
    type === 'remove'
  ) {

    if (
      !occupied ||
      chipUid === uid
    ) {

      return false;

    }


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


  return (
    !occupied &&
    boardCard === card
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


      if (
        existingKeys.has(
          key
        )
      ) {

        return;

      }


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
   GUARDAR DÓNDE SE GANÓ
========================================================= */

function saveWinningSequence(
  game,
  uid,
  placedIndex
) {

  const completed =
    game.completedSequences?.[
      uid
    ] || [];


  const sequences =
    completed

      .filter(
        sequence =>
          Array.isArray(
            sequence?.cells
          )
      )

      .map(
        sequence => ({
          key:
            sequence.key ||
            sequenceKey(
              sequence.cells
            ),

          cells:
            [...sequence.cells]
        })
      );


  const cells =
    [
      ...new Set(
        sequences.flatMap(
          sequence =>
            sequence.cells
        )
      )
    ];


  game.winningSequence = {

    uid,

    placedIndex,

    cells,

    sequences

  };


  game.winningSequenceCells =
    cells;

}


/* =========================================================
   COMPROBAR SI UN JUGADOR TODAVÍA PUEDE HACER ALGO
========================================================= */

function playerCanStillAct(
  room,
  uid
) {

  const game =
    room?.game;


  if (
    !game ||
    !uid
  ) {

    return false;

  }


  const hand =
    game.hands?.[
      uid
    ] || [];


  for (
    const card
    of hand
  ) {

    for (
      let index = 0;
      index < game.board.length;
      index++
    ) {

      if (
        isLegalTargetForPlayer(
          room,
          card,
          index,
          uid
        )
      ) {

        return true;

      }

    }

  }


  if (
    Array.isArray(
      game.deck
    ) &&
    game.deck.length
  ) {

    for (
      const card
      of hand
    ) {

      if (
        isJack(
          card
        )
      ) {

        continue;

      }


      let hasLegalTarget =
        false;


      for (
        let index = 0;
        index < game.board.length;
        index++
      ) {

        if (
          isLegalTargetForPlayer(
            room,
            card,
            index,
            uid
          )
        ) {

          hasLegalTarget =
            true;

          break;

        }

      }


      if (
        !hasLegalTarget
      ) {

        return true;

      }

    }

  }


  return false;

}


/* =========================================================
   EMPATE: NADIE PUEDE REALIZAR OTRA ACCIÓN
========================================================= */

function finishAsDrawIfNobodyCanMove(
  room
) {

  if (
    !room ||
    room.status !== 'playing' ||
    !room.game ||
    room.game.winner
  ) {

    return false;

  }


  const players =
    getActivePlayerIds(
      room
    );


  if (
    players.length < 2
  ) {

    return false;

  }


  const somebodyCanAct =
    players.some(
      uid =>
        playerCanStillAct(
          room,
          uid
        )
    );


  if (
    somebodyCanAct
  ) {

    return false;

  }


  const now =
    Date.now();


  room.game.winner =
    null;


  room.game.finishReason =
    'draw';


  room.game.finishedAt =
    now;


  room.game.updatedAt =
    now;


  room.status =
    'finished';


  room.updatedAt =
    now;


  return true;

}


/* =========================================================
   CONTROLADOR DE JUGADAS AUTOMÁTICAS
========================================================= */

function getAutoPlayController(room) {

  if (
    !room ||
    !me
  ) {

    return null;

  }


  const players =
    room.players || {};


  const hostUid =
    room.host;


  if (
    hostUid &&
    players[hostUid]?.connected === true
  ) {

    return hostUid;

  }


  const order =
    getTurnOrder(room);


  return (
    order.find(
      uid =>
        players[uid]?.connected === true
    ) || null
  );

}


/* =========================================================
   BUSCAR JUGADAS LEGALES DEL BOT
========================================================= */

function getAutomaticMoves(
  room,
  uid
) {

  const game =
    room?.game;


  if (
    !game ||
    !uid
  ) {

    return [];

  }


  const hand =
    game.hands?.[uid] || [];


  const moves =
    [];


  hand.forEach(
    (card, cardIndex) => {

      for (
        let boardIndex = 0;
        boardIndex < game.board.length;
        boardIndex++
      ) {

        if (
          isLegalTargetForPlayer(
            room,
            card,
            boardIndex,
            uid
          )
        ) {

          moves.push({
            card,
            cardIndex,
            boardIndex
          });

        }

      }

    }
  );


  return moves;

}


/* =========================================================
   ELEGIR JUGADA DEL BOT
========================================================= */

function chooseAutomaticMove(
  room,
  uid
) {

  const moves =
    getAutomaticMoves(
      room,
      uid
    );


  if (!moves.length) {

    return null;

  }


  const moveCount =
    Number(
      room.game?.moveCount || 0
    );


  const position =
    moveCount %
    moves.length;


  return moves[position];

}


/* =========================================================
   REALIZAR JUGADA AUTOMÁTICA
========================================================= */

async function performAutomaticMove(
  code,
  expectedUid,
  activateAuto = false,
  expectedMoveCount = null
) {

  if (
    !code ||
    !expectedUid ||
    !me
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
          room.status !== 'playing' ||
          !room.game ||
          room.game.winner
        ) {

          return;

        }


        if (
          room.game.turn !==
            expectedUid
        ) {

          return;

        }


        const player =
          room.players?.[
            expectedUid
          ];

        if (!player) {
          return;
        }


        const controller =
          getAutoPlayController(
            room
          );


        if (
          controller !==
            me.uid
        ) {

          return;

        }


        const game =
          room.game;

          const currentMoveCount =
            Number(
              game.moveCount ||
              0
            );


          /*
            Si el turno ya cambió desde que
            comenzó el temporizador,
            no hacemos absolutamente nada.
          */
          if (
            Number.isInteger(
              expectedMoveCount
            ) &&
            currentMoveCount !==
              expectedMoveCount
          ) {

            return;

          }


          /*
            Si el jugador tocó una carta
            durante este turno,
            tomó control manual.

            El AUTO queda cancelado.
          */
          if (
            Number(
              game.manualTurnClaims?.[
                expectedUid
              ]
            ) ===
              currentMoveCount
          ) {

            return;

          }


          game.autoPlayers =
            game.autoPlayers ||
            {};


          /*
            Llegó a 20 segundos sin tocar nada:
            entra oficialmente en AUTO.
          */
          if (
            activateAuto
          ) {

            game.autoPlayers[
              expectedUid
            ] =
              true;

          }


          /*
            Si este era un turno de 5 segundos
            pero el jugador ya salió del AUTO,
            no hacemos la jugada.
          */
          else if (
            game.autoPlayers?.[
              expectedUid
            ] !== true
          ) {

            return;

          }

        const hand =
          game.hands?.[
            expectedUid
          ];


        if (
          !Array.isArray(hand) ||
          !hand.length
        ) {

          return;

        }


        const move =
          chooseAutomaticMove(
            room,
            expectedUid
          );


        if (!move) {

          const removedCard =
            hand.shift();


          if (
            Array.isArray(
              game.deck
            ) &&
            game.deck.length
          ) {

            const newCard =
              game.deck.shift();


            if (newCard) {

              hand.push(
                newCard
              );

            }

          }


          game.hands[
            expectedUid
          ] =
            hand;


          game.lastAutoAction = {

            uid:
              expectedUid,

            type:
              'dead-card',

            card:
              removedCard || null,

            at:
              Date.now()

          };


          game.updatedAt =
            Date.now();


          room.updatedAt =
            Date.now();


          return room;

        }


        const {
          card,
          cardIndex,
          boardIndex
        } =
          move;


        if (
          hand[cardIndex] !==
            card
        ) {

          return;

        }


        if (
          !isLegalTargetForPlayer(
            room,
            card,
            boardIndex,
            expectedUid
          )
        ) {

          return;

        }


        game.chips =
          game.chips || {};


        const type =
          jackType(card);


        if (
          type === 'remove'
        ) {

          delete game.chips[
            boardIndex
          ];

        } else {

          game.chips[
            boardIndex
          ] =
            expectedUid;

        }


        game.lastMove = {

          index:
            boardIndex,

          uid:
            expectedUid,

          card,

          type:
            type || 'normal',

          automatic:
            true,

          at:
            Date.now()

        };


        hand.splice(
          cardIndex,
          1
        );


        if (
          Array.isArray(
            game.deck
          ) &&
          game.deck.length
        ) {

          const newCard =
            game.deck.shift();


          if (newCard) {

            hand.push(
              newCard
            );

          }

        }


        game.hands[
          expectedUid
        ] =
          hand;


        if (
          type !== 'remove'
        ) {

          const sequenceCount =
            registerNewSequences(
              game,
              expectedUid,
              boardIndex
            );


          if (
            sequenceCount >= 2
          ) {

            game.winner =
              expectedUid;


            game.finishReason =
              'sequences';


            saveWinningSequence(
              game,
              expectedUid,
              boardIndex
            );


            game.finishedAt =
              Date.now();


            room.status =
              'finished';

          }

        }


        if (
          !game.winner
        ) {

          const next =
            getNextActivePlayer(
              room,
              expectedUid
            );


          if (next) {

            game.turn =
              next;

          }

        }


        game.moveCount =
          (
            game.moveCount || 0
          ) + 1;


        game.updatedAt =
          Date.now();


        room.updatedAt =
          Date.now();


        return room;

      }

    );


  } catch (error) {

    console.error(
      'ERROR JUGADA AUTOMÁTICA:',
      error
    );

  }

}

/* =========================================================
   RECUPERAR CONTROL MANUAL
========================================================= */

async function claimManualTurn() {

  if (
    !currentRoomCode ||
    !me
  ) {

    return false;

  }


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
              'playing' ||
            !room.game ||
            room.game.winner
          ) {

            return;

          }


          /*
            Solo el jugador que tiene
            actualmente el turno puede
            reclamar el control manual.
          */
          if (
            room.game.turn !==
              me.uid
          ) {

            return;

          }


          const moveCount =
            Number(
              room.game.moveCount ||
              0
            );


          room.game.autoPlayers =
            room.game.autoPlayers ||
            {};


          room.game.manualTurnClaims =
            room.game.manualTurnClaims ||
            {};


          /*
            Quitarlo del modo automático.
          */
          delete room.game
            .autoPlayers[
              me.uid
            ];


          /*
            Marcamos que YA interactuó
            durante este turno.

            Esto significa que después de
            tocar una carta puede tardarse
            lo que quiera en terminar
            esa jugada.
          */
          room.game.manualTurnClaims[
            me.uid
          ] =
            moveCount;


          room.game.updatedAt =
            Date.now();


          room.updatedAt =
            Date.now();


          return room;

        }

      );


    if (
      result.committed
    ) {

      currentRoom =
        result.snapshot.val();

      return true;

    }


  } catch (error) {

    console.error(
      'ERROR RECUPERANDO CONTROL MANUAL:',
      error
    );

  }


  return false;

}

/* =========================================================
   PROGRAMAR BOT PARA DESCONECTADO
========================================================= */

function scheduleAutomaticPlay(
  room
) {

  if (
    !room ||
    room.status !==
      'playing' ||
    !room.game ||
    room.game.winner ||
    !currentRoomCode ||
    !me
  ) {

    if (
      autoPlayTimer
    ) {

      clearTimeout(
        autoPlayTimer
      );

    }


    autoPlayTimer =
      null;

    autoPlayKey =
      null;


    return;

  }


  const game =
    room.game;


  const turnUid =
    game.turn;


  const turnPlayer =
    room.players?.[
      turnUid
    ];


  if (
    !turnPlayer
  ) {

    return;

  }


  const controller =
    getAutoPlayController(
      room
    );


  /*
    Solamente un navegador controla
    las jugadas automáticas para evitar
    que dos clientes jueguen a la vez.
  */
  if (
    controller !==
      me.uid
  ) {

    if (
      autoPlayTimer
    ) {

      clearTimeout(
        autoPlayTimer
      );

    }


    autoPlayTimer =
      null;

    autoPlayKey =
      null;


    return;

  }


  const moveCount =
    Number(
      game.moveCount ||
      0
    );


  /*
    ¿El jugador ya tocó una carta
    durante ESTE turno?
  */
  const claimedManual =
    Number(
      game.manualTurnClaims?.[
        turnUid
      ]
    ) ===
      moveCount;


  /*
    Si ya tomó control manual,
    no existe temporizador para
    este turno.

    Puede tardarse lo que quiera.
  */
  if (
    claimedManual
  ) {

    if (
      autoPlayTimer
    ) {

      clearTimeout(
        autoPlayTimer
      );

    }


    autoPlayTimer =
      null;

    autoPlayKey =
      null;


    return;

  }


  const playerIsAuto =
    game.autoPlayers?.[
      turnUid
    ] === true;


  /*
    Manual:
      20 segundos.

    Ya en AUTO:
      5 segundos.
  */
  const delay =
    playerIsAuto

      ? AUTO_PLAY_ACTIVE_DELAY_MS

      : AUTO_PLAY_IDLE_DELAY_MS;


  const mode =
    playerIsAuto

      ? 'auto'

      : 'manual';


  const key =
    `${currentRoomCode}:${
      turnUid
    }:${
      moveCount
    }:${
      mode
    }`;


  if (
    autoPlayTimer &&
    autoPlayKey ===
      key
  ) {

    return;

  }


  if (
    autoPlayTimer
  ) {

    clearTimeout(
      autoPlayTimer
    );

  }


  autoPlayKey =
    key;


  autoPlayTimer =
    setTimeout(

      async () => {

        const code =
          currentRoomCode;


        const uid =
          turnUid;


        const expectedCount =
          moveCount;


        const shouldActivateAuto =
          !playerIsAuto;


        autoPlayTimer =
          null;


        autoPlayKey =
          null;


        await performAutomaticMove(
          code,
          uid,
          shouldActivateAuto,
          expectedCount
        );

      },

      delay

    );

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


          if (
            txGame.turn !==
              me.uid
          ) {

            return;

          }


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


          if (
            !card ||
            card !==
              selectedCard
          ) {

            return;

          }


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


          if (
            type ===
              'remove'
          ) {

            delete txGame.chips[
              index
            ];


          } else {

            txGame.chips[
              index
            ] =
              me.uid;

          }


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


          txHand.splice(
            selectedCardIndex,
            1
          );


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


            if (
              sequenceCount >=
                2
            ) {

              txGame.winner =
                me.uid;


              txGame.finishReason =
                'sequences';


              saveWinningSequence(
                txGame,
                me.uid,
                index
              );


              txGame.finishedAt =
                Date.now();


              room.status =
                'finished';

            }

          }


          if (
            !txGame.winner
          ) {

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


              txHand[
                oldIndex
              ] =
                replacement;


              txGame.hands[
                me.uid
              ] =
                txHand;


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

function getWinningSequenceCells(game) {

  if (!game) {
    return [];
  }

  const winnerUid =
    game.winner;

  if (!winnerUid) {
    return [];
  }

  const cells =
    [];

  if (
    Array.isArray(
      game.winningSequenceCells
    )
  ) {

    cells.push(
      ...game.winningSequenceCells
    );

  }

  if (
    Array.isArray(
      game.winningSequence?.cells
    )
  ) {

    cells.push(
      ...game.winningSequence.cells
    );

  }

  const completed =
    game.completedSequences?.[
      winnerUid
    ] || [];

  if (Array.isArray(completed)) {

    completed.forEach(
      sequence => {

        if (
          Array.isArray(
            sequence?.cells
          )
        ) {

          cells.push(
            ...sequence.cells
          );

        }

      }
    );

  }

  return [
    ...new Set(
      cells
        .map(Number)
        .filter(Number.isInteger)
    )
  ];

}


/* =========================================================
   TABLERO DE LA JUGADA GANADORA
========================================================= */

function renderWinningSequenceResult(room) {

  const panel =
    $('winningSequencePanel');


  const board =
    $('resultWinningBoard');


  if (
    !panel ||
    !board
  ) {

    return;

  }


  const game =
    room?.game;


  if (
    !game ||
    !game.winner
  ) {

    panel.classList.add(
      'hidden'
    );


    board.innerHTML =
      '';


    return;

  }


  const winningCells =
    new Set(
      getWinningSequenceCells(
        game
      )
    );


  if (
    !winningCells.size
  ) {

    panel.classList.add(
      'hidden'
    );


    board.innerHTML =
      '';


    return;

  }


  panel.classList.remove(
    'hidden'
  );


  board.innerHTML =
    '';


  const placedIndex =

    Number.isInteger(
      game.winningSequence?.placedIndex
    )

      ? game.winningSequence.placedIndex

      : Number.isInteger(
          game.lastMove?.index
        )

        ? game.lastMove.index

        : null;


  game.board.forEach(

    (
      card,
      index
    ) => {

      const cell =
        document.createElement(
          'div'
        );


      cell.className =
        'result-board-cell';


      if (
        card === FREE
      ) {

        cell.classList.add(
          'free'
        );


        cell.innerHTML = `

          <span
            class="result-board-free-star"
          >
            ★
          </span>

        `;


      } else {

        const parts =
          getCardParts(
            card
          );


        cell.innerHTML = `

          <span
            class="${
              isRedSuit(card)
                ? 'suit-red'
                : ''
            }"
          >

            ${
              escapeHtml(
                parts.rank
              )
            }${
              escapeHtml(
                parts.symbol
              )
            }

          </span>

        `;

      }


      if (
        winningCells.has(
          index
        )
      ) {

        cell.classList.add(
          'winning'
        );

      }


      if (
        placedIndex ===
          index
      ) {

        cell.classList.add(
          'winning-last'
        );

      }


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
          `result-board-chip ${
            playerColor(
              room,
              chipUid
            )
          }`;


        cell.appendChild(
          chip
        );

      }


      board.appendChild(
        cell
      );

    }

  );

}


/* =========================================================
   MOSTRAR VOTOS DE REVANCHA
========================================================= */

function renderRematchVotes(room) {

  const panel =
    $('rematchVotePanel');


  const count =
    $('rematchVoteCount');


  const list =
    $('rematchVoteList');


  const bar =
    $('rematchVoteBar');


  if (
    !panel ||
    !room
  ) {

    return;

  }


  if (
    room.status !==
      'finished'
  ) {

    panel.classList.add(
      'hidden'
    );


    return;

  }


  panel.classList.remove(
    'hidden'
  );


  /*
    Todos los jugadores que SIGUEN dentro de
    room.players deben aceptar la revancha.

    Un jugador desconectado temporalmente sigue
    perteneciendo a la sala, así que su voto
    todavía cuenta como pendiente.

    Solamente deja de contar si pulsa Salir y
    es eliminado de room.players.
  */
  const players =
    Object.keys(
      room.players ||
      {}
    );


  const votes =
    room.rematchVotes ||
    {};


  const voted =
    players.filter(
      uid =>
        votes[
          uid
        ] === true
    );


  if (count) {

    count.textContent =
      `${voted.length} / ${players.length}`;

  }


  if (bar) {

    const percent =

      players.length

        ? Math.round(
            (
              voted.length /
              players.length
            ) * 100
          )

        : 0;


    bar.style.width =
      `${percent}%`;

  }


  if (list) {

    list.innerHTML =
      players.map(

        uid => {

          const player =
            room.players?.[
              uid
            ];


          const hasVoted =
            votes[
              uid
            ] === true;


          const connected =
            player?.connected !==
              false;


          let state =
            'Esperando';


          if (hasVoted) {

            state =
              'Listo';


          } else if (
            !connected
          ) {

            state =
              'Desconectado';

          }


          return `

            <div
              class="rematch-vote-player ${
                hasVoted
                  ? 'ready'
                  : ''
              }"
            >

              <span
                class="rematch-vote-dot ${
                  hasVoted
                    ? 'ready'
                    : connected
                      ? 'waiting'
                      : 'offline'
                }"
              ></span>


              <span
                class="rematch-vote-name"
              >

                ${
                  escapeHtml(
                    playerName(
                      room,
                      uid
                    )
                  )
                }

                ${
                  uid ===
                    me?.uid
                    ? ' (Tú)'
                    : ''
                }

              </span>


              <strong>
                ${state}
              </strong>

            </div>

          `;

        }

      ).join('');

  }


  const rematchBtn =
    $('rematchBtn');


  if (
    rematchBtn &&
    me
  ) {

    const alreadyVoted =
      votes[
        me.uid
      ] === true;


    rematchBtn.disabled =
      alreadyVoted;


    rematchBtn.textContent =

      alreadyVoted

        ? '✓ Esperando a los demás'

        : '↻ Revancha';

  }

}


/* =========================================================
   MODAL RESULTADO
========================================================= */

function showResult(room) {

  if (
    !room?.game ||
    room.status !==
      'finished'
  ) {

    return;

  }


  const modal =
    $('resultModal');


  if (!modal) {
    return;
  }


  const game =
    room.game;


  const winnerUid =
    game.winner ||
    null;


  const isDraw =
    game.finishReason ===
      'draw';


  const isWinner =
    !!winnerUid &&
    winnerUid ===
      me?.uid;


  const icon =
    $('resultIcon');


  const title =
    $('resultTitle');


  const text =
    $('resultText');


  if (isDraw) {

    if (icon) {

      icon.textContent =
        '🤝';

    }


    if (title) {

      title.textContent =
        '¡Empate!';

    }


    if (text) {

      text.textContent =
        'Ningún jugador puede realizar otra jugada. La partida terminó en empate.';

    }


  } else if (isWinner) {

    if (icon) {

      icon.textContent =
        '🏆';

    }


    if (title) {

      title.textContent =
        '¡Ganaste!';

    }


    if (text) {

      text.textContent =
        'Completaste 2 secuencias antes que los demás jugadores.';

    }


  } else {

    if (icon) {

      icon.textContent =
        '🎯';

    }


    if (title) {

      title.textContent =
        'Partida terminada';

    }


    if (text) {

      text.textContent =
        winnerUid

          ? `${
              playerName(
                room,
                winnerUid
              )
            } completó 2 secuencias y ganó la partida.`

          : 'La partida terminó.';

    }

  }

  /* =========================================================
   ESTADÍSTICAS DEL RESULTADO
========================================================= */

const mySequences =
  Number(
    game.sequences?.[
      me?.uid
    ] || 0
  );


const totalMoves =
  Number(
    game.moveCount || 0
  );


const totalPlayers =
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
  startedAt > 0
    ? Math.max(
        0,
        finishedAt - startedAt
      )
    : 0;


const resultSequences =
  $('resultSequences');


const resultMoves =
  $('resultMoves');


const resultPlayers =
  $('resultPlayers');


const resultDuration =
  $('resultDuration');


if (resultSequences) {

  resultSequences.textContent =
    `${mySequences}/2`;

}


if (resultMoves) {

  resultMoves.textContent =
    totalMoves;

}


if (resultPlayers) {

  resultPlayers.textContent =
    totalPlayers;

}


if (resultDuration) {

  resultDuration.textContent =
    formatDuration(
      duration
    );

}

  if (isDraw) {

    const winningPanel =
      $('winningSequencePanel');


    if (winningPanel) {

      winningPanel.classList.add(
        'hidden'
      );

    }


    const winningBoard =
      $('resultWinningBoard');


    if (winningBoard) {

      winningBoard.innerHTML =
        '';

    }


  } else {

    renderWinningSequenceResult(
      room
    );

  }


  renderRematchVotes(
    room
  );


  modal.classList.remove(
    'hidden'
  );


  modal.setAttribute(
    'aria-hidden',
    'false'
  );


  if (isDraw) {

    playSound(
      'sequence'
    );


  } else if (
    isWinner
  ) {

    playSound(
      'win'
    );


  } else {

    playSound(
      'lose'
    );

  }

}


/* =========================================================
   CERRAR RESULTADO
========================================================= */

function hideResult() {

  const modal =
    $('resultModal');


  if (!modal) {
    return;
  }


  modal.classList.add(
    'hidden'
  );


  modal.setAttribute(
    'aria-hidden',
    'true'
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

      hideResult();


      await leaveRoom();

    }

  );

}


/* =========================================================
   CREAR PARTIDA DE REVANCHA
========================================================= */

function createRematchGame(room) {

  const ids =
    getPlayerIds(
      room
    );


  if (
    ids.length < 2 ||
    ids.length > 4
  ) {

    return null;

  }


  const deck =
    makeDeck(
      ids.length
    );


  const hands =
    {};


  const handSize =

    ids.length === 2

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


  const previousOrder =
    getTurnOrder(
      room
    ).filter(
      uid =>
        ids.includes(
          uid
        )
    );


  const missing =
    ids.filter(
      uid =>
        !previousOrder.includes(
          uid
        )
    );


  let order = [
    ...previousOrder,
    ...missing
  ];


  /*
    Para que no empiece siempre la misma persona,
    rotamos el orden una posición en cada revancha.
  */
  if (
    order.length > 1
  ) {

    order = [
      ...order.slice(1),
      order[0]
    ];

  }


  const playerNames =
    Object.fromEntries(

      order.map(

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

      order.map(

        uid => [
          uid,
          0
        ]

      )

    );


  const now =
    Date.now();


  const previousRematch =
    Number(
      room.game?.rematchNumber ||
      0
    );


  return {

    board:
      makeBoard(),

    deck,

    hands,

    chips:
      {},

    turnOrder:
      order,

    playerNames,

    turn:
      order[0],

    winner:
      null,

    finishReason:
      null,

    sequences,

    completedSequences:
      {},

    autoPlayers:
      {},

    manualTurnClaims:
      {},

    winningSequence:
      null,

    winningSequenceCells:
      [],

    moveCount:
      0,

    rematchNumber:
      previousRematch + 1,

    startedAt:
      now,

    finishedAt:
      null,

    lastMove:
      null,

    updatedAt:
      now

  };

}


/* =========================================================
   BOTÓN REVANCHA
========================================================= */

const rematchBtn =
  $('rematchBtn');


if (rematchBtn) {

  rematchBtn.addEventListener(

    'click',

    async () => {

      if (
        !currentRoomCode ||
        !me
      ) {

        return;

      }


      rematchBtn.disabled =
        true;


      rematchBtn.textContent =
        'Registrando voto…';


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
                  'finished' ||
                !room.game
              ) {

                return;

              }


              /*
                Solamente jugadores que siguen dentro
                de la sala pueden votar.
              */
              if (
                !room.players?.[
                  me.uid
                ]
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


              const players =
                Object.keys(
                  room.players ||
                  {}
                );


              if (
                players.length < 2
              ) {

                room.updatedAt =
                  Date.now();


                return room;

              }


              const everybodyAccepted =
                players.every(

                  uid =>
                    room.rematchVotes?.[
                      uid
                    ] === true

                );


              if (
                everybodyAccepted
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

              } else {

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
            'No se pudo registrar tu voto de revancha.'
          );


          return;

        }


        const room =
          result.snapshot.val();


        if (room) {

          currentRoom =
            room;


          if (
            room.status ===
              'playing'
          ) {

            hideResult();


            selectedCardIndex =
              null;


            moveInFlight =
              false;


            showView(
              'gameView'
            );


            renderGame(
              room
            );


          } else {

            renderRematchVotes(
              room
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
          'No se pudo registrar la revancha.'
        );

      }

    }

  );

}

/* =========================================================
   SALIR AL LOBBY
========================================================= */

function leaveToLobby(message = '') {

  if (roomUnsub) {

    roomUnsub();

    roomUnsub =
      null;

  }


  if (autoPlayTimer) {

    clearTimeout(
      autoPlayTimer
    );

    autoPlayTimer =
      null;

  }


  autoPlayKey =
    null;


  if (quickChatHideTimer) {

    clearTimeout(
      quickChatHideTimer
    );

    quickChatHideTimer =
      null;

  }


  setQuickChatVisible(
    false
  );


  currentRoomCode =
    null;


  currentRoom =
    null;


  selectedCardIndex =
    null;


  moveInFlight =
    false;


  resultRecordedForRoom =
    null;


  hideResult();


  showView(
    'lobbyView'
  );


  status(
    'gameStatus',
    ''
  );


  status(
    'roomStatus',
    ''
  );


  status(
    'lobbyStatus',
    message
  );


  loadStats();


  checkReconnectOption();

}


/* =========================================================
   SALIR EXPLÍCITAMENTE DE LA SALA
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


  const uid =
    me.uid;


  /*
    Solamente aquí olvidamos la partida.

    Cerrar navegador, recargar o perder internet
    NO ejecuta esta función.
  */
  forgetActiveRoom();


  try {

    if (presenceDisconnect) {

      try {

        await presenceDisconnect.cancel();

      } catch (error) {

        console.warn(
          'No se pudo cancelar onDisconnect:',
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


        if (
          room.players?.[
            uid
          ]
        ) {

          delete room.players[
            uid
          ];

        }


        if (
          room.rematchVotes?.[
            uid
          ]
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


        /*
          Nadie queda en la sala:
          Firebase elimina completamente
          la habitación.
        */
        if (
          !remaining.length
        ) {

          return null;

        }


        /*
          Si salió el host, transferimos
          el control al siguiente jugador
          que todavía pertenece a la sala.
        */
        if (
          room.host ===
            uid
        ) {

          const order =
            getTurnOrder(
              room
            );


          room.host =

            order.find(
              playerUid =>
                remaining.includes(
                  playerUid
                )
            )

            ||

            remaining[0];

        }


        /*
          Si la partida estaba en curso
          y solamente queda un jugador,
          ese jugador gana por abandono.
        */
        if (
          room.status ===
            'playing' &&
          room.game
        ) {

          if (
            remaining.length ===
              1
          ) {

            const winner =
              remaining[0];


            room.game.winner =
              winner;


            room.game.finishReason =
              'abandon';


            room.game.finishedAt =
              Date.now();


            room.game.updatedAt =
              Date.now();


            room.status =
              'finished';

          } else if (
            room.game.turn ===
              uid
          ) {

            const next =
              getNextActivePlayerFromList(
                room,
                uid,
                remaining
              );


            if (next) {

              room.game.turn =
                next;

            }

          }

        }


        /*
          Si estamos en pantalla final,
          quitar a un jugador también puede
          completar los votos de revancha.

          Ejemplo:
          3 jugadores.
          2 votan revancha.
          El tercero pulsa Salir.
          Los 2 restantes ya aceptaron,
          así que comienza la revancha.
        */
        if (
          room.status ===
            'finished' &&
          room.game &&
          remaining.length >=
            2
        ) {

          const everybodyAccepted =
            remaining.every(

              playerUid =>
                room.rematchVotes?.[
                  playerUid
                ] === true

            );


          if (
            everybodyAccepted
          ) {

            const newGame =
              createRematchGame(
                room
              );


            if (newGame) {

              room.game =
                newGame;


              room.status =
                'playing';


              room.rematchVotes =
                {};

            }

          }

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

    /*
      Repetimos por seguridad porque
      leaveToLobby() llama checkReconnectOption().
    */
    forgetActiveRoom();


    leaveToLobby();

  }

}


/* =========================================================
   BOTONES SALIR
========================================================= */

const leaveRoomBtn =
  $('leaveRoomBtn');


if (leaveRoomBtn) {

  leaveRoomBtn.addEventListener(

    'click',

    async () => {

      await leaveRoom();

    }

  );

}


const leaveGameBtn =
  $('leaveGameBtn');


if (leaveGameBtn) {

  leaveGameBtn.addEventListener(

    'click',

    async () => {

      await leaveRoom();

    }

  );

}


/* =========================================================
   CAMBIAR JUGADOR / NICKNAME
========================================================= */

const changePlayerBtn =
  $('changePlayerBtn');


if (changePlayerBtn) {

  changePlayerBtn.addEventListener(

    'click',

    async () => {

      /*
        No permitimos cambiar de jugador
        mientras exista una sala abierta.
      */
      if (
        currentRoomCode
      ) {

        return;

      }


      displayName =
        '';


      localStorage.removeItem(
        'kc_name'
      );


      updatePlayerPill(
        'Invitado conectado'
      );


      const input =
        $('nameInput');


      if (input) {

        input.value =
          '';

      }


      status(
        'lobbyStatus',
        ''
      );


      showView(
        'authView'
      );


      setTimeout(

        () => {

          input?.focus();

        },

        50

      );

    }

  );

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
        !displayName ||
        currentRoomCode
      ) {

        return;

      }


      matchBtn.disabled =
        true;


      const cancelBtn =
        $('cancelMatchBtn');


      if (cancelBtn) {

        cancelBtn.classList.remove(
          'hidden'
        );

      }


      status(
        'matchStatus',
        'Buscando rival…'
      );


      try {

        await set(

          ref(
            db,
            `matchmaking/${me.uid}`
          ),

          {

            uid:
              me.uid,

            name:
              displayName,

            createdAt:
              Date.now(),

            searching:
              true

          }

        );


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


        matchBtn.disabled =
          false;


        if (cancelBtn) {

          cancelBtn.classList.add(
            'hidden'
          );

        }

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


async function cancelMatch() {

  if (!me) {
    return;
  }


  try {

    await remove(

      ref(
        db,
        `matchmaking/${me.uid}`
      )

    );


  } catch (error) {

    console.warn(
      'No se pudo cancelar matchmaking:',
      error
    );

  }


  const matchButton =
    $('matchBtn');


  if (matchButton) {

    matchButton.disabled =
      false;

  }


  const cancelButton =
    $('cancelMatchBtn');


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
   INTENTAR ENCONTRAR RIVAL
========================================================= */

async function tryMatch() {

  if (
    !me ||
    currentRoomCode
  ) {

    return;

  }


  try {

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

            player?.uid &&

            player.uid !==
              me.uid &&

            player.searching !==
              false

        )

        .sort(

          (a, b) =>

            (
              a.createdAt ||
              0
            )

            -

            (
              b.createdAt ||
              0
            )

        );


    if (
      !opponents.length
    ) {

      return;

    }


    const opponent =
      opponents[0];


    const pair =
      [
        me.uid,
        opponent.uid
      ].sort();


    /*
      Solamente uno de los dos crea la partida.
      Así evitamos que ambos creen salas distintas.
    */
    if (
      pair[0] !==
        me.uid
    ) {

      return;

    }


    const lockId =
      `${pair[0]}_${pair[1]}`;


    const lockRef =
      ref(
        db,
        `matchLocks/${lockId}`
      );


    const lockResult =
      await runTransaction(

        lockRef,

        current => {

          if (current) {

            return;

          }


          return {

            creator:
              me.uid,

            createdAt:
              Date.now()

          };

        }

      );


    if (
      !lockResult.committed
    ) {

      return;

    }


    /*
      Volvemos a revisar que ambos
      sigan buscando.
    */
    const latestSnap =
      await get(

        ref(
          db,
          'matchmaking'
        )

      );


    const latest =
      latestSnap.val() ||
      {};


    const myself =
      latest[
        me.uid
      ];


    const other =
      latest[
        opponent.uid
      ];


    if (
      !myself ||
      !other ||
      myself.searching === false ||
      other.searching === false
    ) {

      await remove(
        lockRef
      );


      return;

    }


    await createPublicMatch(
      opponent.uid,
      opponent.name ||
      'Jugador'
    );


    await remove(
      lockRef
    );


  } catch (error) {

    console.error(
      'ERROR BUSCANDO MATCH:',
      error
    );

  }

}


/* =========================================================
   CREAR PARTIDA PÚBLICA 1 VS 1
========================================================= */

async function createPublicMatch(
  opponentUid,
  opponentName
) {

  if (
    !me ||
    !opponentUid ||
    opponentUid ===
      me.uid
  ) {

    return;

  }


  let code =
    null;


  for (
    let i = 0;
    i < 10;
    i++
  ) {

    const possible =
      randomCode();


    const snap =
      await get(

        ref(
          db,
          `rooms/${possible}`
        )

      );


    if (
      !snap.exists()
    ) {

      code =
        possible;

      break;

    }

  }


  if (!code) {

    throw new Error(
      'No se pudo generar código para matchmaking.'
    );

  }


  const now =
    Date.now();


  const players = {

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


    [opponentUid]: {

      name:
        normalizeName(
          opponentName
        ) || 'Jugador',

      joinedAt:
        now + 1,

      connected:
        true,

      lastSeen:
        now

    }

  };


  const temporaryRoom = {

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

    players

  };


  const ids =
    getPlayerIds(
      temporaryRoom
    );


  const deck =
    makeDeck(
      ids.length
    );


  const hands =
    {};


  ids.forEach(

    uid => {

      hands[
        uid
      ] =
        deck.splice(
          0,
          7
        );

    }

  );


  const playerNames =
    Object.fromEntries(

      ids.map(

        uid => [

          uid,

          playerName(
            temporaryRoom,
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


  temporaryRoom.status =
    'playing';


  temporaryRoom.game = {

    board:
      makeBoard(),

    deck,

    hands,

    chips:
      {},

    turnOrder:
      [...ids],

    playerNames,

    turn:
      ids[0],

    winner:
      null,

    finishReason:
      null,

    sequences,

    completedSequences:
      {},

    autoPlayers:
      {},

    manualTurnClaims:
      {},

    winningSequence:
      null,

    winningSequenceCells:
      [],

    moveCount:
      0,

    rematchNumber:
      0,

    startedAt:
      now,

    finishedAt:
      null,

    lastMove:
      null,

    updatedAt:
      now

  };


  const updates = {};


  updates[
    `rooms/${code}`
  ] =
    temporaryRoom;


  updates[
    `matchesByUser/${me.uid}`
  ] = {

    roomCode:
      code,

    createdAt:
      now

  };


  updates[
    `matchesByUser/${opponentUid}`
  ] = {

    roomCode:
      code,

    createdAt:
      now

  };


  updates[
    `matchmaking/${me.uid}`
  ] =
    null;


  updates[
    `matchmaking/${opponentUid}`
  ] =
    null;


  await update(
    ref(db),
    updates
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


  const style =
    document.createElement(
      'style'
    );


  style.id =
    'kc-quick-chat-styles';


  style.textContent = `

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

      display:flex;
      align-items:center;

      gap:11px;

      padding:
        11px 14px;

      border:
        1px solid
        rgba(244,191,79,.24);

      border-radius:16px;

      background:
        rgba(
          11,
          18,
          32,
          .96
        );

      box-shadow:
        0 18px 45px
        rgba(0,0,0,.46);

      opacity:0;

      pointer-events:none;

      z-index:9998;

      transition:
        opacity .2s ease,
        transform .2s ease;
    }


    .quick-chat-toast.show{
      opacity:1;

      transform:
        translateX(-50%)
        translateY(0);
    }


    .quick-chat-toast-emoji{
      flex:0 0 auto;

      width:38px;
      height:38px;

      display:flex;
      align-items:center;
      justify-content:center;

      border-radius:12px;

      background:
        rgba(244,191,79,.10);

      font-size:22px;
    }


    .quick-chat-toast-text{
      min-width:0;
      flex:1;
    }


    .quick-chat-toast-text strong{
      display:block;

      margin-bottom:2px;

      color:#f6c453;

      font-size:11px;

      overflow:hidden;

      white-space:nowrap;

      text-overflow:ellipsis;
    }


    .quick-chat-toast-text span{
      display:block;

      color:#f8fafc;

      font-size:12px;
      font-weight:700;

      overflow:hidden;

      white-space:nowrap;

      text-overflow:ellipsis;
    }


    @media(max-width:600px){

      .quick-chat-button{
        right:12px;
        bottom:12px;

        width:49px;
        height:49px;

        font-size:20px;
      }


      .quick-chat-menu{
        right:12px;
        bottom:68px;

        width:
          min(
            300px,
            calc(
              100vw - 24px
            )
          );
      }


      .quick-chat-toast{
        top:72px;
      }

    }

  `;


  document.head.appendChild(
    style
  );


  const button =
    document.createElement(
      'button'
    );


  button.type =
    'button';


  button.id =
    'quickChatButton';


  button.className =
    'quick-chat-button hidden';


  button.title =
    'Chat rápido';


  button.setAttribute(
    'aria-label',
    'Abrir chat rápido'
  );


  button.textContent =
    '💬';


  const menu =
    document.createElement(
      'div'
    );


  menu.id =
    'quickChatMenu';


  menu.className =
    'quick-chat-menu hidden';


  menu.innerHTML = `

    <div
      class="quick-chat-header"
    >

      <div>

        <strong>
          Chat rápido
        </strong>

        <small>
          Mensajes predeterminados
        </small>

      </div>

    </div>


    <div
      class="quick-chat-grid"
    >

      ${
        QUICK_CHAT_MESSAGES.map(

          item => `

            <button
              type="button"
              class="quick-chat-option"
              data-quick-chat="${
                escapeHtml(
                  item.id
                )
              }"
            >

              <span>
                ${
                  escapeHtml(
                    item.emoji
                  )
                }
              </span>

              <span>
                ${
                  escapeHtml(
                    item.text
                  )
                }
              </span>

            </button>

          `

        ).join('')
      }

    </div>

  `;


  const toast =
    document.createElement(
      'div'
    );


  toast.id =
    'quickChatToast';


  toast.className =
    'quick-chat-toast';


  toast.innerHTML = `

    <div
      class="quick-chat-toast-emoji"
      id="quickChatToastEmoji"
    >
      💬
    </div>


    <div
      class="quick-chat-toast-text"
    >

      <strong
        id="quickChatToastName"
      >
        Jugador
      </strong>


      <span
        id="quickChatToastMessage"
      >
        Mensaje
      </span>

    </div>

  `;


  document.body.appendChild(
    button
  );


  document.body.appendChild(
    menu
  );


  document.body.appendChild(
    toast
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

    async event => {

      const option =
        event.target.closest(
          '[data-quick-chat]'
        );


      if (!option) {
        return;
      }


      const messageId =
        option.dataset.quickChat;


      menu.classList.add(
        'hidden'
      );


      await sendQuickChat(
        messageId
      );

    }

  );


  document.addEventListener(

    'click',

    event => {

      if (
        !menu.contains(
          event.target
        )

        &&

        !button.contains(
          event.target
        )
      ) {

        menu.classList.add(
          'hidden'
        );

      }

    }

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

async function sendQuickChat(messageId) {

  if (
    !currentRoomCode ||
    !currentRoom?.game ||
    !me
  ) {
    return;
  }


  if (
    currentRoom.status !== 'playing' ||
    currentRoom.game.winner
  ) {
    return;
  }


  const message =
    QUICK_CHAT_MESSAGES.find(
      item =>
        item.id === messageId
    );


  if (!message) {
    return;
  }


  const now =
    Date.now();


  if (
    now - lastQuickChatSentAt < 700
  ) {
    return;
  }


  lastQuickChatSentAt =
    now;


  const chatData = {

    id:
      `${now}_${me.uid}`,

    uid:
      me.uid,

    messageId:
      message.id,

    clientAt:
      now

  };


  /*
    MOSTRARLO LOCALMENTE SIN DEPENDER
    DE FIREBASE.
  */

  showQuickChatToast(
    chatData,
    currentRoom
  );


  /*
    Guardamos el ID para que cuando
    Firebase nos devuelva nuestro mismo
    mensaje no aparezca dos veces.
  */

  lastQuickChatId =
    chatData.id;


  try {

    await set(

      ref(
        db,
        `rooms/${currentRoomCode}/quickChat`
      ),

      {
        ...chatData,

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
function showQuickChatToast(
  chat,
  room
) {

  ensureQuickChatUI();


  const message =
    QUICK_CHAT_MESSAGES.find(
      item =>
        item.id ===
          chat.messageId
    );


  if (!message) {
    return;
  }


  const toast =
    $('quickChatToast');

  const emoji =
    $('quickChatToastEmoji');

  const name =
    $('quickChatToastName');

  const text =
    $('quickChatToastMessage');


  if (
    !toast ||
    !emoji ||
    !name ||
    !text
  ) {

    console.error(
      'No se encontraron los elementos del chat rápido.'
    );

    return;
  }


  emoji.textContent =
    message.emoji;


  name.textContent =

    chat.uid === me?.uid

      ? 'Tú'

      : playerName(
          room,
          chat.uid
        );


  text.textContent =
    message.text;


  if (quickChatHideTimer) {

    clearTimeout(
      quickChatHideTimer
    );

  }


  /*
    Reinicia animación aunque hubiera
    otro mensaje visible.
  */

  toast.classList.remove(
    'show'
  );


  void toast.offsetWidth;


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

function renderQuickChatMessage(room) {

  if (
    !room?.quickChat
  ) {
    return;
  }


  const chat =
    room.quickChat;


  if (
    !chat.id ||
    chat.id ===
      lastQuickChatId
  ) {

    return;
  }


  const messageTime =
    Number(
      chat.clientAt ||
      chat.at ||
      0
    );


  /*
    No enseñar mensajes viejos cuando
    alguien entra o recarga la partida.
  */

  if (
    messageTime &&
    Date.now() - messageTime > 8000
  ) {

    lastQuickChatId =
      chat.id;

    return;
  }


  lastQuickChatId =
    chat.id;


  showQuickChatToast(
    chat,
    room
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