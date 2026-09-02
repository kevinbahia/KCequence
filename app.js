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
  onValue,
  runTransaction,
  onDisconnect
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


/* =========================================================
   CARTAS
========================================================= */

const SUITS = ['H', 'D', 'C', 'S'];

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

    const element = $(view);

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


function status(elementId, message) {

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
   MOSTRAR JUGADOR EN HEADER
========================================================= */

function updatePlayerPill(name) {

  const pill =
    $('playerPill');

  if (!pill) {
    return;
  }

  const label =
    name || 'Invitado conectado';

  pill.innerHTML = `
    <span class="player-status-dot"></span>
    <span>${escapeHtml(label)}</span>
  `;

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
      Math.random() * 90
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

  return `${a}${b}${number}`
    .slice(0, 18);

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

      input.setCustomValidity('');

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

  let code = '';

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

function cardId(suit, rank) {

  return `${rank}${suit}`;

}


function cardText(id) {

  if (id === FREE) {
    return '★';
  }

  const suit =
    id.slice(-1);

  const rank =
    id.slice(0, -1);

  return `${rank}${SUIT_SYMBOL[suit]}`;

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
    id.slice(-1)
  );

}


function isJack(id) {

  return (
    !!id &&
    id !== FREE &&
    id.startsWith('J')
  );

}


function jackType(id) {

  if (!isJack(id)) {
    return null;
  }

  /*
    J♥ y J♦ = Jota libre.
    J♣ y J♠ = quitar ficha.
  */

  return [
    'H',
    'D'
  ].includes(
    id.slice(-1)
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
    let i = copy.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
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

  const deck = [];

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

  return shuffle(deck);

}


/* =========================================================
   CREAR TABLERO
========================================================= */

function makeBoard() {

  const cards = [];

  /*
    Dos copias de cada carta
    excepto Jotas.
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
          rank !== 'J'
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
    shuffle(cards);

  const board = [];

  let cardIndex = 0;

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

      board.push(FREE);

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
    room.players || {}
  )

    .sort(
      ([, a], [, b]) => {

        return (
          (a.joinedAt || 0) -
          (b.joinedAt || 0)
        );

      }
    )

    .map(
      ([uid]) => uid
    );

}


function getTurnOrder(room) {

  if (
    Array.isArray(
      room.game?.turnOrder
    ) &&
    room.game.turnOrder.length
  ) {

    return room.game.turnOrder;

  }

  return getPlayerIds(room);

}


function getActivePlayerIds(room) {

  const active =
    new Set(
      Object.keys(
        room.players || {}
      )
    );

  return getTurnOrder(room)
    .filter(
      uid =>
        active.has(uid)
    );

}


function playerName(
  room,
  uid
) {

  return (
    room.players?.[uid]?.name ||
    room.game?.playerNames?.[uid] ||
    'Jugador'
  );

}


function playerColor(
  room,
  uid
) {

  const order =
    getTurnOrder(room);

  const colors = [
    'red',
    'blue',
    'green',
    'gold'
  ];

  const index =
    order.indexOf(uid);

  return (
    colors[index] ||
    'blue'
  );

}


function playerDot(
  room,
  uid
) {

  return `dot-${playerColor(
    room,
    uid
  )}`;

}


function getNextActivePlayer(
  room,
  currentUid
) {

  const order =
    getTurnOrder(room);

  const active =
    new Set(
      Object.keys(
        room.players || {}
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
      ) %
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

  await set(

    ref(
      db,
      `users/${me.uid}`
    ),

    {
      name:
        displayName,

      lastSeen:
        Date.now()
    }

  );

}


/* =========================================================
   INICIAR FIREBASE
========================================================= */

async function bootstrap() {

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

    me = user;

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

    } else {

      showView(
        'authView'
      );

    }

  }

);


/* =========================================================
   FORMULARIO NOMBRE / NICKNAME
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

      input.setCustomValidity('');

      if (
        name.length < 2
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

      /*
        Entramos al lobby primero.

        Así, incluso si Firebase tarda
        en guardar el perfil, el botón
        sí responde.
      */

      status(
        'lobbyStatus',
        ''
      );

      showView(
        'lobbyView'
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
   LIMPIAR VALIDACIÓN DEL NOMBRE
========================================================= */

const nameInput =
  $('nameInput');

if (nameInput) {

  nameInput.addEventListener(
    'input',
    () => {

      nameInput.setCustomValidity('');

    }
  );

}


/* =========================================================
   INPUT CÓDIGO DE SALA
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

          players: {

            [me.uid]: {

              name:
                displayName,

              joinedAt:
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
        code.length !== 6
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
          room.players || {};

        /*
          Ya pertenecemos a la sala.
        */

        if (
          players[me.uid]
        ) {

          await enterRoom(
            code
          );

          return;

        }

        if (
          Object.keys(
            players
          ).length >=
          (room.maxPlayers || 4)
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
              Date.now()
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
              ([, a], [, b]) =>
                (a.joinedAt || 0) -
                (b.joinedAt || 0)
            )

            .map(
              ([uid]) => uid
            );

        /*
          Evitar que entren más jugadores
          si dos personas se unen exactamente
          al mismo tiempo.
        */

        if (
          ids.length >
            maxPlayers &&
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

        await enterRoom(
          match.roomCode
        );

      }

    );

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

  showView(
    'roomView'
  );

  const roomTitle =
    $('roomTitle');

  if (roomTitle) {

    roomTitle.textContent =
      code;

  }

  const playerRef =
    ref(
      db,
      `rooms/${code}/players/${me.uid}`
    );

  try {

    await onDisconnect(
      playerRef
    ).remove();

  } catch (error) {

    console.warn(
      'No se pudo registrar onDisconnect:',
      error
    );

  }

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

      snap => {

        if (
          !snap.exists()
        ) {

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

          reconcileActiveGame(
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

          showResult(
            currentRoom
          );

        }

      }

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

        const active =
          getActivePlayerIds(
            room
          );

        if (
          !active.length
        ) {
          return;
        }

        if (
          active.length === 1
        ) {

          room.game.winner =
            active[0];

          room.game.finishReason =
            'disconnect';

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
            getNextActivePlayer(
              room,
              room.game.turn
            );

          if (next) {

            room.game.turn =
              next;

            room.game.updatedAt =
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
   RENDER SALA
========================================================= */

function renderRoom(room) {

  const ids =
    getPlayerIds(room);

  const playersList =
    $('playersList');

  if (playersList) {

    playersList.innerHTML =
      '';

    ids.forEach(uid => {

      const div =
        document.createElement(
          'div'
        );

      div.className =
        'player-card' +
        (
          uid === me.uid
            ? ' me'
            : ''
        );

      div.innerHTML = `
        <strong>
          <span class="player-dot ${playerDot(
            room,
            uid
          )}"></span>

          ${escapeHtml(
            playerName(
              room,
              uid
            )
          )}
        </strong>

        <p>
          ${
            uid === room.host
              ? 'Anfitrión'
              : 'Jugador'
          }

          ${
            uid === me.uid
              ? ' · Tú'
              : ''
          }
        </p>
      `;

      playersList.appendChild(
        div
      );

    });

  }

  if (
    room.status !==
    'waiting'
  ) {
    return;
  }

  const maxPlayers =
    room.maxPlayers || 4;

  const roomSubtitle =
    $('roomSubtitle');

  if (roomSubtitle) {

    roomSubtitle.textContent =
      ids.length === 1
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
          me.uid &&
        ids.length >= 2 &&
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
          room.maxPlayers || 4;

        if (
          room.host !== me.uid ||
          room.status !==
            'waiting' ||
          ids.length < 2 ||
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

        /*
          2 jugadores = 7 cartas.
          3-4 jugadores = 6.
        */

        const handSize =
          ids.length === 2
            ? 7
            : 6;

        ids.forEach(uid => {

          hands[uid] =
            deck.splice(
              0,
              handSize
            );

        });

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

        const game = {

          board:
            makeBoard(),

          deck,

          hands,

          chips: {},

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

          updatedAt:
            Date.now()

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
                  me.uid ||
                current.status !==
                  'waiting' ||
                currentIds.length <
                  2 ||
                currentIds.length >
                  (current.maxPlayers || 4)
              ) {

                return;

              }

              if (
                currentIds.join('|') !==
                ids.join('|')
              ) {

                return;

              }

              current.status =
                'playing';

              current.game =
                game;

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
   SALIR DE SALA / PARTIDA
========================================================= */

const leaveRoomBtn =
  $('leaveRoomBtn');

if (leaveRoomBtn) {

  leaveRoomBtn.addEventListener(
    'click',
    leaveRoom
  );

}


const leaveGameBtn =
  $('leaveGameBtn');

if (leaveGameBtn) {

  leaveGameBtn.addEventListener(
    'click',
    leaveRoom
  );

}


/* =========================================================
   SALIR DE SALA
========================================================= */

async function leaveRoom() {

  if (
    !currentRoomCode ||
    !me
  ) {

    leaveToLobby();

    return;

  }


  const code =
    currentRoomCode;


  const uid =
    me.uid;


  /*
    Detener listener local primero.
  */

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


    /*
      Modificamos toda la sala con
      transacción para evitar conflictos.
    */

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
              'playing' &&
            room.game &&
            !room.game.winner;


          /*
            Quitar jugador.
          */

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


          /*
            Nadie quedó:
            eliminar sala.
          */

          if (
            remaining.length ===
            0
          ) {

            return null;

          }


          /*
            Si era anfitrión,
            transferir host.
          */

          if (wasHost) {

            const ordered =
              Object.entries(
                room.players ||
                {}
              )

                .sort(
                  ([, a], [, b]) =>
                    (a.joinedAt || 0) -
                    (b.joinedAt || 0)
                )

                .map(
                  ([playerUid]) =>
                    playerUid
                );


            room.host =
              ordered[0] ||
              remaining[0];

          }


          /*
            Si la partida estaba activa,
            revisar quién sigue jugando.
          */

          if (
            gameWasActive
          ) {

            const active =
              getActivePlayerIds(
                room
              );


            /*
              Solo queda uno:
              gana automáticamente.
            */

            if (
              active.length ===
              1
            ) {

              room.game.winner =
                active[0];


              room.game.finishReason =
                'forfeit';


              room.game.updatedAt =
                Date.now();


              room.status =
                'finished';

            } else if (
              active.length >=
              2
            ) {

              /*
                Si quien salió tenía
                el turno, avanzar.
              */

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


          return room;

        }

      );


    /*
      Si la transacción no se pudo
      completar, intentamos por lo menos
      borrar nuestra entrada.
    */

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


    leaveToLobby(
      'Saliste de la sala.'
    );


  } catch (error) {

    console.error(
      'Error al salir de la sala:',
      error
    );


    /*
      Aunque Firebase falle,
      liberar interfaz local.
    */

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


  if (modal) {

    modal.classList.add(
      'hidden'
    );

  }


  showView(
    'lobbyView'
  );


  status(
    'lobbyStatus',
    message
  );

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

    /*
      Cancelar matchmaking.
    */

    await cancelMatch();


    /*
      Si está en una sala,
      salir primero.
    */

    if (
      currentRoomCode
    ) {

      await leaveRoom();

    }


    /*
      Eliminar nickname local.
    */

    localStorage.removeItem(
      'kc_name'
    );


    displayName =
      '';


    /*
      Limpiar input.
    */

    const input =
      $('nameInput');


    if (input) {

      input.value =
        '';


      input.setCustomValidity(
        ''
      );

    }


    /*
      Limpiar mensajes.
    */

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


    /*
      Actualizar encabezado.
    */

    updatePlayerPill(
      'Invitado conectado'
    );


    /*
      Regresar solamente al registro
      de nickname.

      NO cerramos la sesión anónima
      de Firebase.
    */

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


    /*
      Incluso si falla una limpieza de
      Firebase, permitir cambiar nickname.
    */

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
        copyRoomCodeBtn.textContent;


      try {

        /*
          Método moderno.
        */

        if (
          navigator.clipboard &&
          window.isSecureContext
        ) {

          await navigator.clipboard.writeText(
            code
          );

        } else {

          /*
            Respaldo para navegadores
            donde Clipboard API no esté
            disponible.
          */

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


  const game =
    room.game;


  const myTurn =
    (
      game.turn ===
        me.uid &&
      !game.winner
    );


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
     TURNO
  ======================================================= */

  const turnLabel =
    $('turnLabel');


  if (turnLabel) {

    if (
      game.winner
    ) {

      turnLabel.textContent =
        'Partida terminada';

    } else if (
      myTurn
    ) {

      turnLabel.textContent =
        '🟢 TU TURNO';

    } else {

      turnLabel.textContent =
        `⏳ Turno de ${playerName(
          room,
          game.turn
        )}`;

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


            return `${playerName(
              room,
              uid
            )}: ${score}/2${
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


  /*
    Dibujar tablero y mano.
  */

  renderBoard(
    room
  );


  renderHand(
    room
  );


  /*
    Mensaje inferior.
  */

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
      'Tu turno: selecciona una carta y después una casilla resaltada.'
    );

  } else {

    status(
      'gameStatus',
      `Espera a que ${playerName(
        room,
        game.turn
      )} realice su movimiento.`
    );

  }

}


/* =========================================================
   TABLERO
========================================================= */

function renderBoard(room) {

  const boardElement =
    $('board');


  if (
    !boardElement ||
    !room?.game
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
    Crear las 100 casillas.
  */

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

          : `Casilla ${cardText(
              card
            )}`

      );


      /*
        Carta del tablero.
      */

      button.innerHTML = `

        <span
          class="${
            isRedSuit(card)
              ? 'suit-red'
              : ''
          }"
        >
          ${cardText(card)}
        </span>

      `;


      /*
        Ficha colocada.
      */

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
          `chip ${playerColor(
            room,
            chipUid
          )}`;


        chip.title =
          playerName(
            room,
            chipUid
          );


        button.appendChild(
          chip
        );

      }


      /*
        ¿Es una casilla válida para
        la carta seleccionada?
      */

      const legal =
        !!selectedCard &&
        game.turn ===
          me.uid &&
        !game.winner &&
        isLegalTarget(
          room,
          selectedCard,
          index
        );


      if (legal) {

        button.classList.add(
          'legal'
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
    !room?.game
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
    (
      game.turn ===
        me.uid &&
      !game.winner
    );


  cards.forEach(

    (
      id,
      index
    ) => {

      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.setAttribute(

        'aria-pressed',

        selectedCardIndex ===
          index

          ? 'true'

          : 'false'

      );


      button.setAttribute(

        'aria-label',

        `Carta ${cardText(
          id
        )}`

      );


      button.className =
        'card' +

        (
          selectedCardIndex ===
            index

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

        <span>
          ${cardText(id)}
        </span>

        <span
          class="big ${
            isRedSuit(id)
              ? 'suit-red'
              : ''
          }"
        >
          ${
            SUIT_SYMBOL[
              id.slice(-1)
            ] || ''
          }
        </span>

        <span class="special">
          ${
            type === 'wild'

              ? 'Jota libre'

              : type === 'remove'

                ? 'Quita ficha'

                : 'Carta de tablero'
          }
        </span>

      `;


      button.addEventListener(

        'click',

        () => {

          /*
            No permitir seleccionar
            cartas fuera de turno.
          */

          if (
            !myTurn
          ) {

            status(

              'gameStatus',

              `Espera. Es turno de ${playerName(
                room,
                game.turn
              )}.`

            );


            return;

          }


          /*
            Si toca la misma carta,
            cancelar selección.
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


          /*
            Seleccionar carta.
          */

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

            `Seleccionaste ${cardText(
              id
            )}. Ahora toca una casilla resaltada.`

          );

        }

      );


      handElement.appendChild(
        button
      );

    }

  );


  /* =======================================================
     TEXTO DE AYUDA DE LA MANO
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

        : `Espera el turno de ${playerName(
            room,
            game.turn
          )}`;


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

        ? `Elegiste ${cardText(
            selected
          )}`

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
      ) &&

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
    Las esquinas libres no se
    seleccionan.
  */

  if (
    boardCard === FREE
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

    /*
      Debe haber una ficha
      y debe ser rival.
    */

    if (
      !occupied ||
      chipUid ===
        me.uid
    ) {

      return false;

    }


    /*
      Una ficha que ya pertenece
      a una secuencia reconocida
      queda protegida.
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
    Carta normal:
    casilla libre y carta idéntica.
  */

  return (
    !occupied &&
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
    Las cuatro esquinas libres
    cuentan para cualquier jugador.
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
        ] === uid

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


  /*
    Revisar horizontal, vertical
    y las dos diagonales.
  */

  for (
    const [dr, dc]
    of directions
  ) {

    /*
      La secuencia encontrada debe
      contener la ficha recién puesta.
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


        /*
          Fuera del tablero.
        */

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


        const index =
          r * 10 +
          c;


        if (
          index ===
            placedIndex
        ) {

          containsMove =
            true;

        }


        /*
          Cada posición debe ser
          nuestra o una esquina libre.
        */

        if (
          !own(
            index
          )
        ) {

          valid =
            false;

          break;

        }


        cells.push(
          index
        );

      }


      if (
        valid &&
        containsMove &&
        cells.length === 5
      ) {

        /*
          Crear ID estable.
        */

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
    Eliminar duplicados.
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


  /*
    Secuencias ya reconocidas
    anteriormente.
  */

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
      la misma línea.
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
      Una secuencia nueva solamente
      puede compartir UNA ficha con
      una secuencia ya registrada.

      Esto evita que una línea de
      seis fichas se cuente como
      dos secuencias distintas.
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


          return overlap <= 1;

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


  /*
    Guardar secuencias completas.
  */

  game.completedSequences[
    uid
  ] =
    registered;


  /*
    El marcador es el número
    de secuencias registradas.
  */

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


  /*
    Partida terminada.
  */

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
      `Espera. Es turno de ${playerName(
        currentRoom,
        game.turn
      )}.`
    );

    return;

  }


  /*
    Debemos tener una carta
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
    Revisar localmente antes
    de mandar la transacción.
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


          /*
            La partida pudo haber terminado
            mientras realizábamos la jugada.
          */

          if (
            txGame.winner
          ) {

            return;

          }


          /*
            Verificar otra vez el turno
            dentro de Firebase.
          */

          if (
            txGame.turn !==
              me.uid
          ) {

            return;

          }


          /*
            Verificar que seguimos
            siendo jugador activo.
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


          /*
            La posición de la carta
            puede haber cambiado.
          */

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


          /*
            Validar casilla usando
            el estado real de Firebase.
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


          /*
            =================================================
            JOTA PARA QUITAR FICHA
            =================================================
          */

          if (
            type ===
              'remove'
          ) {

            delete txGame.chips[
              index
            ];

          } else {

            /*
              Carta normal o Jota libre:
              colocar nuestra ficha.
            */

            txGame.chips[
              index
            ] =
              me.uid;

          }


          /*
            =================================================
            GASTAR CARTA
            =================================================
          */

          txHand.splice(
            selectedCardIndex,
            1
          );


          /*
            Robar carta nueva si aún
            quedan cartas en el mazo.
          */

          if (
            Array.isArray(
              txGame.deck
            ) &&
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


          /*
            =================================================
            REVISAR SECUENCIAS

            Solo ocurre cuando pusimos
            una ficha.

            Una Jota que quita ficha
            no crea secuencia.
            =================================================
          */

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


              room.status =
                'finished';

            }

          }


          /*
            =================================================
            SIGUIENTE TURNO
            =================================================
          */

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


          return room;

        }

      );


    /*
      Si Firebase rechazó la jugada.
    */

    if (
      !result.committed
    ) {

      status(
        'gameStatus',
        'La jugada no pudo realizarse. El tablero pudo haber cambiado.'
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
        Debe ser nuestro turno.
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


      if (
        !card
      ) {

        return;

      }


      /*
        Las Jotas nunca se consideran
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


      /*
        Debe quedar por lo menos una
        carta en el mazo.
      */

      if (
        !Array.isArray(
          game.deck
        ) ||
        !game.deck.length
      ) {

        status(
          'gameStatus',
          'No quedan cartas en el mazo.'
        );

        return;

      }


      /*
        Buscar si aún existe alguna
        casilla disponible de esa carta.
      */

      let hasAvailableCell =
        false;


      for (
        let index = 0;
        index <
          game.board.length;
        index++
      ) {

        if (
          game.board[
            index
          ] === card &&
          !game.chips?.[
            index
          ]
        ) {

          hasAvailableCell =
            true;

          break;

        }

      }


      /*
        Si existe por lo menos una
        casilla disponible, NO está muerta.
      */

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
                !room ||
                room.status !==
                  'playing' ||
                !room.game ||
                room.game.winner ||
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
                ) ||
                txHand[
                  oldIndex
                ] !== oldCard
              ) {

                return;

              }


              /*
                Volver a comprobar que no
                apareció una casilla libre.
              */

              const stillDead =
                !txGame.board.some(

                  (
                    boardCard,
                    boardIndex
                  ) =>

                    boardCard ===
                      oldCard &&

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
                ) ||
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


              return room;

            }

          );


        if (
          result.committed
        ) {

          selectedCardIndex =
            null;


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


  const title =
    $('modalTitle');


  const text =
    $('modalText');


  const winnerUid =
    room.game.winner;


  const winnerName =
    playerName(
      room,
      winnerUid
    );


  const iWon =
    me &&
    winnerUid ===
      me.uid;


  if (title) {

    title.textContent =
      iWon
        ? '🏆 ¡Ganaste!'
        : 'Partida terminada';

  }


  if (text) {

    if (
      iWon
    ) {

      if (
        room.game.finishReason ===
          'sequences'
      ) {

        text.textContent =
          '¡Conseguiste 2 secuencias y ganaste la partida!';

      } else if (
        room.game.finishReason ===
          'forfeit'
      ) {

        text.textContent =
          'Ganaste porque los demás jugadores abandonaron la partida.';

      } else if (
        room.game.finishReason ===
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
        room.game.finishReason ===
          'sequences'
      ) {

        text.textContent =
          `${winnerName} consiguió 2 secuencias y ganó la partida.`;

      } else if (
        room.game.finishReason ===
          'forfeit'
      ) {

        text.textContent =
          `${winnerName} ganó porque los demás jugadores abandonaron.`;

      } else if (
        room.game.finishReason ===
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


  modal.classList.remove(
    'hidden'
  );

}


/* =========================================================
   CERRAR MODAL DE RESULTADO
========================================================= */

const modalOk =
  $('modalOk');


if (modalOk) {

  modalOk.addEventListener(

    'click',

    async () => {

      const modal =
        $('modal');


      if (modal) {

        modal.classList.add(
          'hidden'
        );

      }


      await leaveRoom();

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


      /*
        Ya estamos en una sala.
      */

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


      if (cancelBtn) {

        cancelBtn.classList.remove(
          'hidden'
        );

      }


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


        /*
          Añadirnos a la cola.
        */

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
          Si cerramos pestaña o perdemos
          conexión, Firebase nos quita
          de la cola.
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


        /*
          Intentar encontrar rival
          inmediatamente.
        */

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


async function cancelMatch() {

  if (
    me
  ) {

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
    Confirmar que todavía estamos
    dentro de la cola.
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


  /*
    Obtener rivales,
    excluyéndonos.
  */

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

          (a.joinedAt || 0) -
          (b.joinedAt || 0)

      );


  if (
    !opponents.length
  ) {

    return;

  }


  const other =
    opponents[0];


  /*
    Para impedir que LOS DOS jugadores
    creen una sala simultáneamente,
    solamente el UID alfabéticamente
    menor crea la partida.
  */

  if (
    me.uid.localeCompare(
      other.uid
    ) > 0
  ) {

    return;

  }


  /*
    Comprobar que el rival todavía
    está esperando.
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
    Crear código único.
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


  if (
    !code
  ) {

    return;

  }


  const now =
    Date.now();


  /*
    Crear sala pública 1 vs 1.
  */

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

    players: {

      [me.uid]: {

        name:
          displayName,

        joinedAt:
          now

      },


      [other.uid]: {

        name:
          other.name ||
          'Jugador',

        joinedAt:
          now + 1

      }

    }

  };


  /*
    Antes de crear la sala volvemos
    a confirmar que ambos siguen
    en la cola.
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
    Sacar ambos jugadores
    de la cola.
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
    Avisar al rival de la sala
    que debe abrir.
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


  /*
    Entrar nosotros.
  */

  await enterRoom(
    code
  );

}


/* =========================================================
   REINTENTAR MATCHMAKING
========================================================= */

setInterval(

  async () => {

    /*
      Si el botón cancelar está visible,
      significa que estamos buscando.
    */

    const cancelButton =
      $('cancelMatchBtn');


    if (
      !cancelButton ||
      cancelButton.classList.contains(
        'hidden'
      ) ||
      !me ||
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
   LIMPIEZA LOCAL AL CERRAR PÁGINA
========================================================= */

window.addEventListener(

  'beforeunload',

  () => {

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