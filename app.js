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

const RECONNECT_GRACE_MS = 30000;
const ACTIVE_ROOM_KEY = 'kc_active_room';


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


        /*
          Si Firebase ya quitó temporalmente
          al jugador, lo volvemos a registrar.
        */

        if (
          !room.players?.[
            me.uid
          ] &&

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
                serverTimestamp()

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
    Evitar grabarlo varias veces
    debido al listener de Firebase.
  */

  if (
    resultRecordedForRoom ===
      code
  ) {

    return;

  }


  resultRecordedForRoom =
    code;


  const resultRef =
    ref(
      db,
      `users/${me.uid}/results/${code}`
    );


  try {

    await runTransaction(

      resultRef,

      current => {

        /*
          Ya registrado.
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


function cardText(id) {

  if (
    id === FREE
  ) {

    return '★';

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


  return `${
    rank
  }${
    SUIT_SYMBOL[
      suit
    ]
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


function getTurnOrder(room) {

  if (

    Array.isArray(
      room.game?.turnOrder
    )

    &&

    room.game.turnOrder.length

  ) {

    return room.game.turnOrder;

  }


  return getPlayerIds(
    room
  );

}


function getActivePlayerIds(room) {

  const active =
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
        active.has(
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


function getNextActivePlayer(
  room,
  currentUid
) {

  const order =
    getTurnOrder(
      room
    );


  const active =
    new Set(

      Object.keys(
        room.players ||
        {}
      )

    );


  if (!order.length) {
    return null;
  }


  const startIndex =
    order.indexOf(
      currentUid
    );


  for (
    let step = 1;

    step <=
      order.length;

    step++
  ) {

    const index =

      (
        Math.max(
          startIndex,
          -1
        )

        +

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
    UPDATE y no SET para no borrar
    estadísticas guardadas.
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

async function bootstrap() {

  startConnectionListener();


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

}


/* =========================================================
   USUARIO FIREBASE
========================================================= */

onAuthStateChanged(

  auth,

  async user => {

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

        let code = null;


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


        if (
          room.status !==
            'waiting'
        ) {

          status(
            'lobbyStatus',
            'La partida ya comenzó.'
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

async function registerPlayerPresence(
  code
) {

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

    await update(

      playerRef,

      {

        name:
          displayName,

        connected:
          true,

        lastSeen:
          serverTimestamp()

      }

    );


    /*
      IMPORTANTE:
      NO borramos inmediatamente al jugador
      cuando pierde conexión.

      Guardamos timestamp de desconexión para
      permitir una ventana de reconexión.
    */

    const disconnectRef =
      ref(
        db,
        `rooms/${code}/players/${me.uid}`
      );


    await onDisconnect(
      disconnectRef
    ).update(
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

        if (
          !snap.exists()
        ) {

          forgetActiveRoom();


          leaveToLobby(
            'La sala fue cerrada.'
          );


          return;

        }


        currentRoom =
          snap.val();


        renderRoom(
          currentRoom
        );


        if (
          currentRoom.status ===
            'playing'
        ) {

          await reconcileActiveGame(
            code
          );


          renderGame(
            currentRoom
          );

        }


        if (
          currentRoom.status ===
            'finished'
        ) {

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

      }

    );

}


/* =========================================================
   JUGADOR SIGUE REALMENTE ACTIVO
========================================================= */

function isPlayerStillActive(
  player
) {

  if (!player) {
    return false;
  }


  if (
    player.connected !==
      false
  ) {

    return true;

  }


  const disconnectedAt =
    Number(
      player.disconnectedAt ||
      0
    );


  if (!disconnectedAt) {

    return false;

  }


  return (
    Date.now() -
      disconnectedAt
  ) <
    RECONNECT_GRACE_MS;

}


/* =========================================================
   JUGADORES ACTIVOS CON TOLERANCIA DE RECONEXIÓN
========================================================= */

function getConnectedPlayerIds(
  room
) {

  const players =
    room.players ||
    {};


  const valid =
    new Set(

      Object.entries(
        players
      )

        .filter(

          (
            [, player]
          ) =>

            isPlayerStillActive(
              player
            )

        )

        .map(
          ([uid]) =>
            uid
        )

    );


  return getTurnOrder(
    room
  ).filter(
    uid =>
      valid.has(
        uid
      )
  );

}


/* =========================================================
   RECONCILIAR DESCONEXIONES
========================================================= */

async function reconcileActiveGame(code) {

  if (!me) {
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


        const players =
          room.players ||
          {};


        let changed =
          false;


        /*
          Eliminar jugadores que superaron
          el margen de 30 segundos.
        */

        Object.entries(
          players
        ).forEach(

          (
            [
              uid,
              player
            ]
          ) => {

            if (
              player.connected ===
                false
            ) {

              const disconnectedAt =
                Number(
                  player.disconnectedAt ||
                  0
                );


              if (

                disconnectedAt &&

                (
                  Date.now() -
                  disconnectedAt
                ) >=
                  RECONNECT_GRACE_MS

              ) {

                delete room.players[
                  uid
                ];


                changed =
                  true;

              }

            }

          }

        );


        const active =
          getConnectedPlayerIds(
            room
          );


        if (
          !active.length
        ) {

          return changed
            ? room
            : undefined;

        }


        if (
          active.length ===
            1
        ) {

          room.game.winner =
            active[0];


          room.game.finishReason =
            'disconnect';


          room.game.finishedAt =
            Date.now();


          room.game.updatedAt =
            Date.now();


          room.status =
            'finished';


          return room;

        }


        if (
          !active.includes(
            room.game.turn
          )
        ) {

          const next =
            getNextActivePlayerFromList(
              room,
              room.game.turn,
              active
            );


          if (next) {

            room.game.turn =
              next;


            room.game.updatedAt =
              Date.now();


            changed =
              true;

          }

        }


        return changed
          ? room
          : undefined;

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


  const startIndex =
    order.indexOf(
      currentUid
    );


  for (
    let step = 1;
    step <= order.length;
    step++
  ) {

    const index =

      (
        Math.max(
          startIndex,
          -1
        ) +
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


        const connected =
          isPlayerStillActive(
            player
          );


        div.className =
          'player-card' +

          (
            uid ===
              me.uid

              ? ' me'

              : ''
          ) +

          (
            connected
              ? ''
              : ' disconnected'
          );


        div.innerHTML = `

          <strong>

            <span
              class="player-dot ${
                playerDot(
                  room,
                  uid
                )
              }"
            ></span>

            ${
              escapeHtml(
                playerName(
                  room,
                  uid
                )
              )
            }

          </strong>


          <p>

            ${
              uid ===
                room.host

                ? 'Anfitrión'

                : 'Jugador'
            }

            ${
              uid ===
                me.uid

                ? ' · Tú'

                : ''
            }

            ${
              connected

                ? ''

                : ' · Reconectando…'
            }

          </p>

        `;


        playersList.appendChild(
          div
        );

      }
    );

  }


  if (
    room.status !==
      'waiting'
  ) {

    return;

  }


  const maxPlayers =
    room.maxPlayers ||
    4;


  const roomSubtitle =
    $('roomSubtitle');


  if (roomSubtitle) {

    roomSubtitle.textContent =

      ids.length ===
        1

        ? `Esperando jugadores · 1/${maxPlayers}`

        : `${ids.length}/${maxPlayers} jugadores conectados.`;

  }


  const startBtn =
    $('startBtn');


  if (startBtn) {

    startBtn.classList.toggle(

      'hidden',

      !(

        room.host ===
          me.uid

        &&

        ids.length >=
          2

        &&

        ids.length <=
          maxPlayers

      )

    );

  }


  showView(
    'roomView'
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

        const roomRef =
          ref(
            db,
            `rooms/${currentRoomCode}`
          );


        const snap =
          await get(
            roomRef
          );


        if (
          !snap.exists()
        ) {

          status(
            'roomStatus',
            'La sala ya no existe.'
          );

          return;

        }


        const room =
          snap.val();


        const ids =
          getPlayerIds(
            room
          );


        const maxPlayers =
          room.maxPlayers ||
          4;


        if (

          room.host !==
            me.uid

          ||

          room.status !==
            'waiting'

          ||

          ids.length <
            2

          ||

          ids.length >
            maxPlayers

        ) {

          status(
            'roomStatus',
            'Se necesitan entre 2 y 4 jugadores para iniciar.'
          );

          return;

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


        const game = {

          board:
            makeBoard(),

          deck,

          hands,

          chips:
            {},

          turnOrder:
            ids,

          playerNames,

          turn:
            ids[0],

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

          startedAt,

          finishedAt:
            null,

          lastMove:
            null,

          updatedAt:
            startedAt

        };


        const result =
          await runTransaction(

            roomRef,

            current => {

              if (!current) {
                return;
              }


              const currentIds =
                getPlayerIds(
                  current
                );


              if (

                current.host !==
                  me.uid

                ||

                current.status !==
                  'waiting'

                ||

                currentIds.length <
                  2

                ||

                currentIds.length >
                  (
                    current.maxPlayers ||
                    4
                  )

              ) {

                return;

              }


              if (

                currentIds.join(
                  '|'
                ) !==

                ids.join(
                  '|'
                )

              ) {

                return;

              }


              current.status =
                'playing';


              current.game =
                game;


              current.updatedAt =
                Date.now();


              return current;

            }

          );


        if (
          !result.committed
        ) {

          status(
            'roomStatus',
            'La sala cambió antes de iniciar. Intenta otra vez.'
          );

        }


      } catch (error) {

        console.error(
          'ERROR INICIANDO PARTIDA:',
          error
        );


        status(
          'roomStatus',
          'No se pudo iniciar la partida.'
        );


      } finally {

        startBtn.disabled =
          false;

      }

    }

  );

}


/* =========================================================
   COMPARTIR SALA
========================================================= */

const shareRoomBtn =
  $('shareRoomBtn');


if (shareRoomBtn) {

  shareRoomBtn.addEventListener(

    'click',

    async () => {

      if (
        !currentRoomCode
      ) {

        status(
          'roomStatus',
          'No hay código de sala para compartir.'
        );

        return;

      }


      const code =
        currentRoomCode;


      const url =
        `${window.location.origin}${window.location.pathname}`;


      const text =
        `Únete a mi partida de KCequence\nCódigo: ${code}\n${url}`;


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


          status(
            'roomStatus',
            'Invitación compartida.'
          );


          return;

        }


        if (
          navigator.clipboard &&
          window.isSecureContext
        ) {

          await navigator.clipboard.writeText(
            text
          );


          status(
            'roomStatus',
            'Invitación copiada.'
          );


          return;

        }


        status(
          'roomStatus',
          `Código: ${code}`
        );


      } catch (error) {

        /*
          Si el usuario cancela el
          diálogo de compartir,
          no mostrar como error.
        */

        if (
          error?.name ===
            'AbortError'
        ) {

          return;

        }


        console.warn(
          'No se pudo compartir:',
          error
        );


        status(
          'roomStatus',
          `Código: ${code}`
        );

      }

    }

  );

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

      if (
        !currentRoomCode
      ) {

        status(
          'roomStatus',
          'No hay código de sala para copiar.'
        );

        return;

      }


      const code =
        currentRoomCode;


      const originalText =
        copyRoomCodeBtn
          .textContent;


      try {

        if (

          navigator.clipboard &&

          window.isSecureContext

        ) {

          await navigator.clipboard.writeText(
            code
          );


        } else {

          const textarea =
            document.createElement(
              'textarea'
            );


          textarea.value =
            code;


          textarea.style.position =
            'fixed';


          textarea.style.opacity =
            '0';


          document.body.appendChild(
            textarea
          );


          textarea.focus();


          textarea.select();


          document.execCommand(
            'copy'
          );


          textarea.remove();

        }


        copyRoomCodeBtn.textContent =
          '✓ Copiado';


        status(
          'roomStatus',
          `Código ${code} copiado.`
        );


        setTimeout(

          () => {

            copyRoomCodeBtn.textContent =
              originalText ||
              'Copiar código';

          },

          1500

        );


      } catch (error) {

        console.error(
          'Error copiando código:',
          error
        );


        status(
          'roomStatus',
          `Código de sala: ${code}`
        );

      }

    }

  );

}


/* =========================================================
   SALIR DE SALA
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


/* =========================================================
   BOTÓN SALIR DE PARTIDA
========================================================= */

const leaveGameBtn =
  $('leaveGameBtn');


if (leaveGameBtn) {

  leaveGameBtn.addEventListener(

    'click',

    () => {

      const modal =
        $('leaveConfirmModal');


      modal?.classList.remove(
        'hidden'
      );

    }

  );

}


/* =========================================================
   CANCELAR SALIDA
========================================================= */

const cancelLeaveGameBtn =
  $('cancelLeaveGameBtn');


if (cancelLeaveGameBtn) {

  cancelLeaveGameBtn.addEventListener(

    'click',

    () => {

      $('leaveConfirmModal')
        ?.classList.add(
          'hidden'
        );

    }

  );

}


/* =========================================================
   CONFIRMAR SALIDA
========================================================= */

const confirmLeaveGameBtn =
  $('confirmLeaveGameBtn');


if (confirmLeaveGameBtn) {

  confirmLeaveGameBtn.addEventListener(

    'click',

    async () => {

      confirmLeaveGameBtn.disabled =
        true;


      try {

        $('leaveConfirmModal')
          ?.classList.add(
            'hidden'
          );


        await leaveRoom();


      } finally {

        confirmLeaveGameBtn.disabled =
          false;

      }

    }

  );

}


/* =========================================================
   SALIR DE SALA / PARTIDA
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


  if (roomUnsub) {

    roomUnsub();


    roomUnsub =
      null;

  }


  try {

    const roomRef =
      ref(
        db,
        `rooms/${code}`
      );


    const result =
      await runTransaction(

        roomRef,

        room => {

          if (!room) {

            return null;

          }


          const wasHost =
            room.host ===
              uid;


          const gameWasActive =

            room.status ===
              'playing'

            &&

            room.game

            &&

            !room.game.winner;


          if (
            room.players
          ) {

            delete room.players[
              uid
            ];

          }


          const remaining =
            Object.keys(
              room.players ||
              {}
            );


          if (
            remaining.length ===
              0
          ) {

            return null;

          }


          if (wasHost) {

            const ordered =
              Object.entries(
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
                  ([playerUid]) =>
                    playerUid
                );


            room.host =
              ordered[0] ||
              remaining[0];

          }


          if (
            gameWasActive
          ) {

            const active =
              getActivePlayerIds(
                room
              );


            if (
              active.length ===
                1
            ) {

              room.game.winner =
                active[0];


              room.game.finishReason =
                'forfeit';


              room.game.finishedAt =
                Date.now();


              room.game.updatedAt =
                Date.now();


              room.status =
                'finished';


            } else if (
              active.length >=
                2
            ) {

              if (
                room.game.turn ===
                  uid
              ) {

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

          }


          room.updatedAt =
            Date.now();


          return room;

        }

      );


    if (
      !result.committed
    ) {

      try {

        await remove(

          ref(
            db,
            `rooms/${code}/players/${uid}`
          )

        );


      } catch (error) {

        console.warn(
          'No se pudo realizar limpieza secundaria:',
          error
        );

      }

    }


    forgetActiveRoom();


    leaveToLobby(
      'Saliste de la sala.'
    );


    await loadStats();


  } catch (error) {

    console.error(
      'Error al salir de la sala:',
      error
    );


    forgetActiveRoom();


    leaveToLobby(
      'Saliste de la sala.'
    );

  }

}


/* =========================================================
   VOLVER AL LOBBY
========================================================= */

function leaveToLobby(
  message = ''
) {

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


  const modal =
    $('modal');


  modal?.classList.add(
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


  checkReconnectOption();

}


/* =========================================================
   CAMBIAR JUGADOR
========================================================= */

async function changePlayer() {

  const button =
    $('changePlayerBtn');


  if (button) {

    button.disabled =
      true;

  }


  try {

    await cancelMatch();


    if (
      currentRoomCode
    ) {

      await leaveRoom();

    }


    forgetActiveRoom();


    localStorage.removeItem(
      'kc_name'
    );


    displayName =
      '';


    const input =
      $('nameInput');


    if (input) {

      input.value =
        '';


      input.setCustomValidity(
        ''
      );

    }


    status(
      'lobbyStatus',
      ''
    );


    status(
      'roomStatus',
      ''
    );


    status(
      'gameStatus',
      ''
    );


    updatePlayerPill(
      'Invitado conectado'
    );


    showView(
      'authView'
    );


    setTimeout(

      () => {

        input?.focus();

      },

      60

    );


  } catch (error) {

    console.error(
      'Error al cambiar jugador:',
      error
    );


    localStorage.removeItem(
      'kc_name'
    );


    displayName =
      '';


    updatePlayerPill(
      'Invitado conectado'
    );


    showView(
      'authView'
    );


  } finally {

    if (button) {

      button.disabled =
        false;

    }

  }

}


/* =========================================================
   EVENTO CAMBIAR JUGADOR
========================================================= */

const changePlayerBtn =
  $('changePlayerBtn');


if (changePlayerBtn) {

  changePlayerBtn.addEventListener(

    'click',

    changePlayer

  );

}

/* =========================================================
   RENDER PARTIDA
========================================================= */

function renderGame(room) {

  if (
    !room ||
    !room.game ||
    !me
  ) {

    return;

  }


  showView(
    'gameView'
  );


  currentRoom =
    room;


  rememberActiveRoom(
    currentRoomCode
  );


  const game =
    room.game;


  const myTurn =

    game.turn ===
      me.uid

    &&

    !game.winner;


  /*
    Si ya no es nuestro turno,
    quitar selección.
  */

  if (
    !myTurn
  ) {

    selectedCardIndex =
      null;

  }


  /* =======================================================
     PANEL DEL TURNO
  ======================================================= */

  const turnPanel =
    $('gameTurnPanel');


  const turnBadge =
    $('turnStatusBadge');


  const turnLabel =
    $('turnLabel');


  const turnSubLabel =
    $('turnSubLabel');


  if (turnPanel) {

    turnPanel.classList.toggle(
      'my-turn',
      myTurn
    );


    turnPanel.classList.toggle(
      'waiting-turn',
      !myTurn &&
      !game.winner
    );


    turnPanel.classList.toggle(
      'game-finished',
      !!game.winner
    );

  }


  if (
    game.winner
  ) {

    if (turnBadge) {

      turnBadge.textContent =
        'FINALIZADA';

    }


    if (turnLabel) {

      turnLabel.textContent =
        'Partida terminada';

    }


    if (turnSubLabel) {

      turnSubLabel.textContent =
        `${playerName(
          room,
          game.winner
        )} ganó la partida`;

    }


  } else if (
    myTurn
  ) {

    if (turnBadge) {

      turnBadge.textContent =
        'TU TURNO';

    }


    if (turnLabel) {

      turnLabel.textContent =
        'Es tu momento';

    }


    if (turnSubLabel) {

      const next =
        getNextActivePlayer(
          room,
          me.uid
        );


      turnSubLabel.textContent =
        next

          ? `${playerName(
              room,
              next
            )} juega después de ti`

          : 'Selecciona una carta para continuar';

    }


  } else {

    const currentPlayer =
      playerName(
        room,
        game.turn
      );


    if (turnBadge) {

      turnBadge.textContent =
        'ESPERANDO';

    }


    if (turnLabel) {

      turnLabel.textContent =
        `Turno de ${currentPlayer}`;

    }


    if (turnSubLabel) {

      turnSubLabel.textContent =
        `${currentPlayer} está realizando su movimiento`;

    }

  }


  /* =======================================================
     MARCADOR
  ======================================================= */

  const order =
    getTurnOrder(
      room
    );


  const scoreLabel =
    $('scoreLabel');


  if (scoreLabel) {

    scoreLabel.textContent =

      order

        .map(

          uid => {

            const score =
              game.sequences?.[
                uid
              ] || 0;


            const active =
              !!room.players?.[
                uid
              ];


            return `${
              playerName(
                room,
                uid
              )
            }: ${
              score
            }/2${
              active
                ? ''
                : ' · salió'
            }`;

          }

        )

        .join(
          ' · '
        );

  }


  renderBoard(
    room
  );


  renderHand(
    room
  );


  /* =======================================================
     MENSAJE INFERIOR
  ======================================================= */

  if (
    game.winner
  ) {

    status(
      'gameStatus',
      'La partida terminó.'
    );


  } else if (
    myTurn
  ) {

    status(
      'gameStatus',
      selectedCardIndex ===
        null

        ? 'Tu turno: selecciona una carta.'

        : 'Ahora selecciona una de las casillas iluminadas.'
    );


  } else {

    status(

      'gameStatus',

      `Espera a que ${
        playerName(
          room,
          game.turn
        )
      } realice su movimiento.`

    );

  }

}


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
    Celdas que ya forman
    parte de una secuencia.
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
         CARTA DEL TABLERO
      ===================================================== */

      button.innerHTML = `

        <span
          class="${
            isRedSuit(
              card
            )
              ? 'suit-red'
              : ''
          }"
        >
          ${cardText(card)}
        </span>

      `;


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
          La ficha pertenece a una
          secuencia completada.
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
        Las esquinas también pueden
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
        apagar ligeramente casillas
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
          ${cardText(id)}
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
            SUIT_SYMBOL[
              id.slice(
                -1
              )
            ] || ''
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
            Tocar nuevamente la misma
            carta cancela selección.
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
   BUSCAR SECUENCIAS CREADAS POR LA ÚLTIMA FICHA
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


  /*
    Esquinas libres cuentan
    para cualquier jugador.
  */

  const own =
    index => {

      return (

        [
          0,
          9,
          90,
          99
        ].includes(
          index
        )

        ||

        game.chips?.[
          index
        ] ===
          uid

      );

    };


  const row =
    Math.floor(
      placedIndex /
      10
    );


  const column =
    placedIndex %
    10;


  const sequences =
    [];


  for (
    const [
      dr,
      dc
    ]
    of directions
  ) {

    /*
      La línea de cinco debe
      contener la última ficha.
    */

    for (
      let offset = -4;
      offset <= 0;
      offset++
    ) {

      const cells =
        [];


      let valid =
        true;


      let containsMove =
        false;


      for (
        let step = 0;
        step < 5;
        step++
      ) {

        const r =
          row +

          dr *
          (
            offset +
            step
          );


        const c =
          column +

          dc *
          (
            offset +
            step
          );


        if (
          r < 0 ||
          r >= 10 ||
          c < 0 ||
          c >= 10
        ) {

          valid =
            false;

          break;

        }


        const cellIndex =
          r * 10 +
          c;


        if (
          cellIndex ===
            placedIndex
        ) {

          containsMove =
            true;

        }


        if (
          !own(
            cellIndex
          )
        ) {

          valid =
            false;

          break;

        }


        cells.push(
          cellIndex
        );

      }


      if (

        valid

        &&

        containsMove

        &&

        cells.length ===
          5

      ) {

        const id =
          [...cells]

            .sort(
              (a, b) =>
                a - b
            )

            .join(
              '-'
            );


        sequences.push(
          {
            id,
            cells
          }
        );

      }

    }

  }


  /*
    Eliminar líneas repetidas.
  */

  return [

    ...new Map(

      sequences.map(

        sequence => [

          sequence.id,
          sequence

        ]

      )

    ).values()

  ];

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


  game.sequences =
    game.sequences ||
    {};


  const registered =

    Array.isArray(
      game.completedSequences[
        uid
      ]
    )

      ? [
          ...game.completedSequences[
            uid
          ]
        ]

      : [];


  const candidates =
    findSequencesCreatedByMove(
      game,
      uid,
      placedIndex
    );


  for (
    const candidate
    of candidates
  ) {

    /*
      No registrar exactamente
      la misma secuencia.
    */

    const duplicate =
      registered.some(

        previous =>
          previous.id ===
            candidate.id

      );


    if (
      duplicate
    ) {

      continue;

    }


    /*
      Dos secuencias reconocidas
      solo pueden compartir una ficha.

      Esto evita contar una línea de
      seis como dos secuencias.
    */

    const valid =
      registered.every(

        previous => {

          const previousCells =

            Array.isArray(
              previous.cells
            )

              ? previous.cells

              : [];


          const overlap =
            candidate.cells.filter(

              cell =>
                previousCells.includes(
                  cell
                )

            ).length;


          return overlap <=
            1;

        }

      );


    if (
      !valid
    ) {

      continue;

    }


    registered.push(
      candidate
    );

  }


  game.completedSequences[
    uid
  ] =
    registered;


  game.sequences[
    uid
  ] =
    registered.length;


  return registered.length;

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
    Necesitamos una carta
    seleccionada.
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
            de la transacción.
          */

          if (
            txGame.turn !==
              me.uid
          ) {

            return;

          }


          /*
            El jugador todavía debe
            pertenecer a la partida.
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
            La carta debe seguir
            siendo la misma.
          */

          if (
            !card ||
            card !==
              selectedCard
          ) {

            return;

          }


          /*
            Validar de nuevo contra
            estado real de Firebase.
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
            Robar una nueva.
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
              Se necesitan dos
              secuencias para ganar.
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


    const sequencesAfter =
      updatedRoom?.game
        ?.sequences?.[
          me.uid
        ] || 0;


    /*
      Sonidos según el resultado.
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
      Si acabamos de completar
      secuencia, mostrar aviso.
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
        Buscar si todavía queda
        una casilla libre de esa carta.
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
                de Firebase.
              */

              const stillDead =

                !txGame.board.some(

                  (
                    boardCard,
                    boardIndex
                  ) =>

                    boardCard ===
                      oldCard

                    &&

                    !txGame.chips?.[
                      boardIndex
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


              /*
                Cambiar carta muerta
                NO consume turno.
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

          selectedCardIndex =
            null;


          playSound(
            'move'
          );


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
          'forfeit'
      ) {

        text.textContent =
          'Ganaste porque los demás jugadores abandonaron la partida.';


      } else if (
        game.finishReason ===
          'disconnect'
      ) {

        text.textContent =
          'Ganaste porque los demás jugadores se desconectaron.';


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
          'forfeit'
      ) {

        text.textContent =
          `${winnerName} ganó porque los demás jugadores abandonaron.`;


      } else if (
        game.finishReason ===
          'disconnect'
      ) {

        text.textContent =
          `${winnerName} ganó porque los demás jugadores se desconectaron.`;


      } else {

        text.textContent =
          `${winnerName} ganó la partida.`;

      }

    }

  }


  /* =======================================================
     ESTADÍSTICAS DEL RESULTADO
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
    Revancha solamente tiene sentido
    si todavía hay por lo menos
    dos jugadores en la sala.
  */

  const rematchBtn =
    $('rematchBtn');


  if (rematchBtn) {

    const remainingPlayers =
      Object.keys(
        room.players ||
        {}
      ).length;


    rematchBtn.classList.toggle(
      'hidden',
      remainingPlayers <
        2
    );


    rematchBtn.disabled =
      !!room.rematchVotes?.[
        me?.uid
      ];


    rematchBtn.textContent =
      room.rematchVotes?.[
        me?.uid
      ]

        ? '✓ Revancha solicitada'

        : '↻ Revancha';

  }


  /*
    Sonido solamente una vez
    por resultado visible.
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
   CERRAR RESULTADO / VOLVER LOBBY
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


  return {

    board:
      makeBoard(),

    deck,

    hands,

    chips:
      {},

    turnOrder:
      ids,

    playerNames,

    /*
      Para que una revancha no siempre
      comience con el mismo jugador,
      rotamos el primer turno.
    */

    turn:
      ids[
        (
          (
            room.game
              ?.rematchNumber ||
            0
          ) + 1
        ) %
        ids.length
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
      (
        room.game
          ?.rematchNumber ||
        0
      ) + 1,

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


              const allAccepted =
                players.every(

                  uid =>
                    room.rematchVotes?.[
                      uid
                    ] === true

                );


              /*
                Cuando todos aceptan,
                iniciar automáticamente
                la revancha.
              */

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
    Solo uno de los dos clientes
    crea la sala.

    Así evitamos crear dos salas
    simultáneamente.
  */

  if (

    me.uid.localeCompare(
      other.uid
    ) > 0

  ) {

    return;

  }


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
    Sacar jugadores
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
      NO borramos kc_active_room.

      Eso permite recuperar
      la partida al volver.
    */

    selectedCardIndex =
      null;


    moveInFlight =
      false;

  }

);


/* =========================================================
   INICIAR APP
========================================================= */

bootstrap();