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
    $(view).classList.toggle(
      'hidden',
      view !== id
    );
  });
}


function status(elementId, message) {
  const element = $(elementId);

  if (element) {
    element.textContent = message || '';
  }
}


function normalizeName(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 18);
}


function randomCode() {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';

  for (let i = 0; i < 6; i++) {
    code += chars[
      Math.floor(
        Math.random() * chars.length
      )
    ];
  }

  return code;
}


function cardId(suit, rank) {
  return `${rank}${suit}`;
}


function cardText(id) {
  if (id === FREE) {
    return '★';
  }

  const suit = id.slice(-1);
  const rank = id.slice(0, -1);

  return `${rank}${SUIT_SYMBOL[suit]}`;
}


function isRedSuit(id) {
  if (!id || id === FREE) {
    return false;
  }

  return ['H', 'D'].includes(
    id.slice(-1)
  );
}


function isJack(id) {
  return !!id &&
    id !== FREE &&
    id.startsWith('J');
}


function jackType(id) {
  if (!isJack(id)) {
    return null;
  }

  /*
   J♥ y J♦ = Jota libre.
   J♣ y J♠ = quitar ficha rival.
  */

  return ['H', 'D'].includes(
    id.slice(-1)
  )
    ? 'wild'
    : 'remove';
}


function shuffle(array) {
  const copy = [...array];

  for (
    let i = copy.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() * (i + 1)
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


function makeDeck() {
  const deck = [];

  /*
   Dos barajas completas.
  */

  for (let x = 0; x < 2; x++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push(
          cardId(suit, rank)
        );
      }
    }
  }

  return shuffle(deck);
}


function makeBoard() {
  const cards = [];

  /*
   Dos copias de cada carta
   que no sea Jota.
  */

  for (let x = 0; x < 2; x++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (rank !== 'J') {
          cards.push(
            cardId(suit, rank)
          );
        }
      }
    }
  }

  const mixed = shuffle(cards);

  const board = [];

  let cardIndex = 0;

  for (let i = 0; i < 100; i++) {
    if (
      i === 0 ||
      i === 9 ||
      i === 90 ||
      i === 99
    ) {
      board.push(FREE);
    } else {
      board.push(
        mixed[cardIndex++]
      );
    }
  }

  return board;
}


/* =========================================================
   JUGADORES / ORDEN
========================================================= */

function getPlayerIds(room) {
  return Object.entries(
    room.players || {}
  )
    .sort(([, a], [, b]) => {
      return (
        (a.joinedAt || 0) -
        (b.joinedAt || 0)
      );
    })
    .map(([uid]) => uid);
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
    .filter(uid => active.has(uid));
}


function playerName(room, uid) {
  return (
    room.players?.[uid]?.name ||
    room.game?.playerNames?.[uid] ||
    'Jugador'
  );
}


function playerColor(room, uid) {
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

  return colors[index] || 'blue';
}


function playerDot(room, uid) {
  return `dot-${playerColor(room, uid)}`;
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
    order.indexOf(currentUid);

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
        ) + step
      ) % order.length;

    const candidate =
      order[index];

    if (active.has(candidate)) {
      return candidate;
    }
  }

  return null;
}


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
   PERFIL
========================================================= */

async function ensureProfile() {
  if (!me || !displayName) {
    return;
  }

  await set(
    ref(
      db,
      `users/${me.uid}`
    ),
    {
      name: displayName,
      lastSeen: Date.now()
    }
  );
}


/* =========================================================
   INICIAR FIREBASE
========================================================= */

async function bootstrap() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error(error);

    $('playerPill').textContent =
      'Error de conexión';

    status(
      'lobbyStatus',
      'No se pudo conectar con Firebase. Revisa firebase-config.js y activa Anonymous Authentication.'
    );
  }
}


onAuthStateChanged(
  auth,
  async user => {
    me = user;

    if (!user) {
      return;
    }

    $('playerPill').textContent =
      displayName
        ? displayName
        : 'Invitado conectado';

    startMatchListener();

    if (displayName) {
      await ensureProfile();

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
   NOMBRE
========================================================= */

$('nameForm').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    const name =
      normalizeName(
        $('nameInput').value
      );

    if (name.length < 2) {
      return;
    }

    displayName = name;

    localStorage.setItem(
      'kc_name',
      name
    );

    $('playerPill').textContent =
      name;

    await ensureProfile();

    showView(
      'lobbyView'
    );
  }
);


/* =========================================================
   INPUT CÓDIGO
========================================================= */

$('roomCodeInput').addEventListener(
  'input',
  event => {
    event.target.value =
      event.target.value
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ''
        )
        .slice(0, 6);
  }
);


/* =========================================================
   CREAR SALA PRIVADA
========================================================= */

$('createRoomBtn').addEventListener(
  'click',
  async () => {
    if (!me) {
      return;
    }

    status(
      'lobbyStatus',
      'Creando sala…'
    );

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

      if (!snap.exists()) {
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

    const room = {
      code,

      host:
        me.uid,

      status:
        'waiting',

      maxPlayers:
        4,

      createdAt:
        Date.now(),

      players: {
        [me.uid]: {
          name:
            displayName,

          joinedAt:
            Date.now()
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

    enterRoom(code);
  }
);


/* =========================================================
   UNIRSE A SALA - 2 A 4 JUGADORES
========================================================= */

$('joinRoomBtn').addEventListener(
  'click',
  async () => {

    if (!me) {
      return;
    }

    const code =
      $('roomCodeInput')
        .value
        .trim()
        .toUpperCase();

    if (code.length !== 6) {
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

      /*
       Primero comprobamos que exista.
      */
      const roomSnap =
        await get(roomRef);

      if (!roomSnap.exists()) {
        status(
          'lobbyStatus',
          'No existe esa sala.'
        );
        return;
      }

      const room =
        roomSnap.val();

      /*
       Solo se puede entrar mientras
       la partida no haya comenzado.
      */
      if (
        room.status !== 'waiting'
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
       Si ya estamos registrados,
       simplemente entramos.
      */
      if (players[me.uid]) {
        enterRoom(code);
        return;
      }

      /*
       Máximo 4 jugadores.
      */
      const playerCount =
        Object.keys(players).length;

      if (playerCount >= 4) {
        status(
          'lobbyStatus',
          'La sala ya tiene 4 jugadores.'
        );
        return;
      }

      /*
       Agregar únicamente nuestro jugador.

       No modificamos todo el objeto room.
      */
      await set(
        ref(
          db,
          `rooms/${code}/players/${me.uid}`
        ),
        {
          name: displayName,
          joinedAt: Date.now()
        }
      );

      /*
       Volvemos a comprobar por seguridad.
      */
      const checkSnap =
        await get(roomRef);

      if (!checkSnap.exists()) {
        status(
          'lobbyStatus',
          'La sala fue cerrada.'
        );
        return;
      }

      const updatedRoom =
        checkSnap.val();

      const updatedPlayers =
        updatedRoom.players || {};

      /*
       En el improbable caso de que dos
       personas hayan entrado exactamente
       al mismo tiempo y sean más de 4,
       quitamos al último que entró.
      */
      const ids =
        Object.entries(updatedPlayers)
          .sort(
            ([, a], [, b]) =>
              (a.joinedAt || 0) -
              (b.joinedAt || 0)
          )
          .map(([uid]) => uid);

      if (
        ids.length > 4 &&
        !ids.slice(0, 4).includes(me.uid)
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

      enterRoom(code);

    } catch (error) {

      console.error(
        'ERROR AL ENTRAR:',
        error
      );

      status(
        'lobbyStatus',
        'Error al entrar a la sala. Revisa tu conexión.'
      );
    }

  }
);


/* =========================================================
   MATCHMAKING PERSONAL
========================================================= */

function startMatchListener() {
  if (!me) {
    return;
  }

  if (matchUnsub) {
    matchUnsub();
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

        const roomSnap =
          await get(
            ref(
              db,
              `rooms/${match.roomCode}`
            )
          );

        if (!roomSnap.exists()) {
          return;
        }

        enterRoom(
          match.roomCode
        );
      }
    );
}


/* =========================================================
   ENTRAR / ESCUCHAR SALA
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

  $('roomTitle').textContent =
    code;

  const playerRef =
    ref(
      db,
      `rooms/${code}/players/${me.uid}`
    );

  /*
   Si pierde internet o cierra la pestaña,
   Firebase elimina a ese jugador.
  */

  onDisconnect(
    playerRef
  ).remove();

  if (roomUnsub) {
    roomUnsub();
  }

  roomUnsub =
    onValue(
      ref(
        db,
        `rooms/${code}`
      ),
      snap => {
        if (!snap.exists()) {
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
          reconcileActiveGame(code);

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
   RECONCILIAR DESCONEXIONES DURANTE PARTIDA
========================================================= */

async function reconcileActiveGame(code) {
  if (!me) {
    return;
  }

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
        getActivePlayerIds(room);

      /*
       Nadie activo.
      */

      if (!active.length) {
        return;
      }

      /*
       Si solo queda un jugador,
       ese jugador gana.
      */

      if (active.length === 1) {
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

      /*
       Si quien tenía el turno ya no está,
       avanzar al siguiente jugador activo.
      */

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

      /*
       No había nada que corregir.
      */

      return;
    }
  );
}


/* =========================================================
   RENDER SALA
========================================================= */

function renderRoom(room) {
  const ids =
    getPlayerIds(room);

  $('playersList').innerHTML =
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
        <span class="player-dot ${playerDot(room, uid)}"></span>
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

    $('playersList')
      .appendChild(div);
  });

  if (
    room.status ===
    'waiting'
  ) {
    $('roomSubtitle').textContent =
      ids.length === 1
        ? 'Esperando jugadores · 1/4'
        : `${ids.length}/4 jugadores conectados.`;

    $('startBtn')
      .classList
      .toggle(
        'hidden',
        !(
          room.host ===
            me.uid &&
          ids.length >= 2 &&
          ids.length <= 4
        )
      );

    showView(
      'roomView'
    );
  }
}


/* =========================================================
   INICIAR PARTIDA
========================================================= */

$('startBtn').addEventListener(
  'click',
  async () => {
    if (
      !currentRoomCode ||
      !me
    ) {
      return;
    }

    const button =
      $('startBtn');

    button.disabled =
      true;

    status(
      'roomStatus',
      'Preparando partida…'
    );

    const roomRef =
      ref(
        db,
        `rooms/${currentRoomCode}`
      );

    const snap =
      await get(roomRef);

    if (!snap.exists()) {
      button.disabled =
        false;

      status(
        'roomStatus',
        'La sala ya no existe.'
      );

      return;
    }

    const room =
      snap.val();

    const ids =
      getPlayerIds(room);

    if (
      room.host !== me.uid ||
      room.status !==
        'waiting' ||
      ids.length < 2 ||
      ids.length > 4
    ) {
      button.disabled =
        false;

      status(
        'roomStatus',
        'Se necesitan entre 2 y 4 jugadores para iniciar.'
      );

      return;
    }

    const deck =
      makeDeck();

    const hands = {};

    /*
     2 jugadores = 7 cartas.
     3 o 4 jugadores = 6 cartas.
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
        ids.map(uid => [
          uid,
          playerName(
            room,
            uid
          )
        ])
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
            uid => [uid, 0]
          )
        ),

      /*
       Aquí se guardan las líneas
       que YA fueron reconocidas.
      */

      completedSequences: {},

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
            current.host !== me.uid ||
            current.status !== 'waiting' ||
            currentIds.length < 2 ||
            currentIds.length > 4
            ) {
            return;
            }

          /*
           Si entró/salió alguien entre
           la lectura y la transacción,
           cancelamos para evitar inconsistencia.
          */

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

    button.disabled =
      false;

    if (!result.committed) {
      status(
        'roomStatus',
        'La sala cambió antes de iniciar. Revisa los jugadores e intenta otra vez.'
      );
    }
  }
);


/* =========================================================
   SALIR
========================================================= */

$('leaveBtn').addEventListener(
  'click',
  () => leaveRoom()
);

$('exitGameBtn').addEventListener(
  'click',
  () => leaveRoom()
);


async function leaveRoom() {
  if (!currentRoomCode) {
    leaveToLobby();

    return;
  }

  const code =
    currentRoomCode;

  const roomRef =
    ref(
      db,
      `rooms/${code}`
    );

  const snap =
    await get(roomRef);

  if (!snap.exists()) {
    leaveToLobby();

    return;
  }

  const room =
    snap.val();


  /* =======================================================
     SALA TODAVÍA EN ESPERA
  ======================================================= */

  if (
    room.status ===
    'waiting'
  ) {
    await runTransaction(
      roomRef,
      current => {
        if (
          !current ||
          current.status !==
            'waiting'
        ) {
          return;
        }

        current.players =
          current.players || {};

        delete current.players[
          me.uid
        ];

        const remaining =
          getPlayerIds(
            current
          );

        /*
         Ya no queda nadie.
         Eliminar sala completa.
        */

        if (!remaining.length) {
          return null;
        }

        /*
         Si salió el host,
         pasar host al siguiente.
        */

        if (
          current.host ===
          me.uid
        ) {
          current.host =
            remaining[0];
        }

        return current;
      }
    );

    leaveToLobby();

    return;
  }


  /* =======================================================
     PARTIDA ACTIVA
  ======================================================= */

  if (
    room.status ===
      'playing' &&
    room.game &&
    !room.game.winner
  ) {
    await runTransaction(
      roomRef,
      current => {
        if (
          !current ||
          current.status !==
            'playing' ||
          !current.game ||
          current.game.winner
        ) {
          return;
        }

        const oldTurn =
          current.game.turn;

        current.players =
          current.players || {};

        delete current.players[
          me.uid
        ];

        const active =
          getActivePlayerIds(
            current
          );

        /*
         Si queda solo uno,
         gana automáticamente.
        */

        if (
          active.length === 1
        ) {
          current.game.winner =
            active[0];

          current.game.finishReason =
            'forfeit';

          current.game.updatedAt =
            Date.now();

          current.status =
            'finished';

          return current;
        }

        /*
         Si todavía quedan 2 o más,
         la partida continúa.
        */

        if (
          active.length >= 2 &&
          oldTurn === me.uid
        ) {
          const next =
            getNextActivePlayer(
              current,
              me.uid
            );

          if (next) {
            current.game.turn =
              next;
          }
        }

        current.game.updatedAt =
          Date.now();

        return current;
      }
    );

    leaveToLobby(
      'Saliste de la partida.'
    );

    return;
  }


  /* =======================================================
     PARTIDA TERMINADA
  ======================================================= */

  await runTransaction(
    roomRef,
    current => {
      if (!current) {
        return;
      }

      current.players =
        current.players || {};

      delete current.players[
        me.uid
      ];

      if (
        !Object.keys(
          current.players
        ).length
      ) {
        return null;
      }

      return current;
    }
  );

  leaveToLobby();
}


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

  $('modal')
    .classList
    .add('hidden');

  showView(
    'lobbyView'
  );

  status(
    'lobbyStatus',
    message
  );
}


/* =========================================================
   RENDER PARTIDA
========================================================= */

function renderGame(room) {
  showView(
    'gameView'
  );

  currentRoom =
    room;

  const game =
    room.game;

  if (!game) {
    return;
  }

  const myTurn =
    game.turn === me.uid &&
    !game.winner;

  if (!myTurn) {
    selectedCardIndex =
      null;
  }

  if (game.winner) {
    $('turnLabel').textContent =
      'Partida terminada';
  } else if (myTurn) {
    $('turnLabel').textContent =
      '🟢 TU TURNO';
  } else {
    $('turnLabel').textContent =
      `⏳ Turno de ${playerName(
        room,
        game.turn
      )}`;
  }

  const order =
    getTurnOrder(room);

  $('scoreLabel').textContent =
    order
      .map(uid => {
        const score =
          game.sequences?.[uid] ||
          0;

        const active =
          !!room.players?.[uid];

        return `${playerName(
          room,
          uid
        )}: ${score}/2${
          active ? '' : ' · salió'
        }`;
      })
      .join(' · ');

  renderBoard(room);

  renderHand(room);

  if (game.winner) {
    status(
      'gameStatus',
      'La partida terminó.'
    );
  } else if (myTurn) {
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

  game.board.forEach(
    (card, index) => {
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
          : `Casilla ${cardText(card)}`
      );

      button.innerHTML = `
        <span class="${
          isRedSuit(card)
            ? 'suit-red'
            : ''
        }">
          ${cardText(card)}
        </span>
      `;

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

        button.appendChild(
          chip
        );
      }

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
          playAt(index);
        }
      );

      boardElement.appendChild(
        button
      );
    }
  );
}


/* =========================================================
   MANO
========================================================= */

function renderHand(room) {
  const handElement =
    $('hand');

  handElement.innerHTML =
    '';

  const game =
    room.game;

  const cards =
    game.hands?.[
      me.uid
    ] || [];

  const myTurn =
    game.turn === me.uid &&
    !game.winner;

  cards.forEach(
    (id, index) => {
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
        `Carta ${cardText(id)}`
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
        jackType(id);

      button.innerHTML = `
        <span>
          ${cardText(id)}
        </span>

        <span class="big ${
          isRedSuit(id)
            ? 'suit-red'
            : ''
        }">
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
          if (!myTurn) {
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
           Tocar la misma carta
           cancela la selección.
          */

          if (
            selectedCardIndex ===
            index
          ) {
            selectedCardIndex =
              null;

            renderBoard(room);

            renderHand(room);

            status(
              'gameStatus',
              'Selección cancelada.'
            );

            return;
          }

          selectedCardIndex =
            index;

          renderBoard(room);

          renderHand(room);

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

  if (!myTurn) {
    selectedCardIndex =
      null;

    $('handHelp').textContent =
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
    $('handHelp').textContent =
      'Selecciona una carta';
  } else {
    const selected =
      cards[
        selectedCardIndex
      ];

    $('handHelp').textContent =
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
    room.game;

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
    jackType(card);

  /*
   Jota libre.
  */

  if (
    type ===
    'wild'
  ) {
    return !occupied;
  }

  /*
   Jota para quitar.
  */

  if (
    type ===
    'remove'
  ) {
    if (
      !occupied ||
      chipUid === me.uid
    ) {
      return false;
    }

    /*
     No se permite quitar una ficha
     que ya forma parte de una secuencia.
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
    !occupied &&
    boardCard === card
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

  const own = index => {
    return (
      [
        0,
        9,
        90,
        99
      ].includes(index) ||
      game.chips?.[
        index
      ] === uid
    );
  };

  const row =
    Math.floor(
      placedIndex / 10
    );

  const column =
    placedIndex % 10;

  const sequences = [];

  for (
    const [dr, dc]
    of directions
  ) {
    /*
     Una secuencia recién creada
     necesariamente contiene la ficha
     que acaba de ponerse.

     Probamos todas las ventanas de 5
     que contienen esa ficha.
    */

    for (
      let offset = -4;
      offset <= 0;
      offset++
    ) {
      const cells = [];

      let valid = true;
      let containsMove = false;

      for (
        let step = 0;
        step < 5;
        step++
      ) {
        const r =
          row +
          dr * (
            offset + step
          );

        const c =
          column +
          dc * (
            offset + step
          );

        if (
          r < 0 ||
          r >= 10 ||
          c < 0 ||
          c >= 10
        ) {
          valid = false;

          break;
        }

        const index =
          r * 10 + c;

        if (
          index ===
          placedIndex
        ) {
          containsMove = true;
        }

        if (!own(index)) {
          valid = false;

          break;
        }

        cells.push(index);
      }

      if (
        valid &&
        containsMove &&
        cells.length === 5
      ) {
        const id =
          [...cells]
            .sort(
              (a, b) =>
                a - b
            )
            .join('-');

        sequences.push({
          id,
          cells
        });
      }
    }
  }

  /*
   Elimina resultados duplicados.
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
     Exactamente la misma secuencia
     ya fue contada.
    */

    const duplicate =
      registered.some(
        previous =>
          previous.id ===
          candidate.id
      );

    if (duplicate) {
      continue;
    }

    /*
     Dos secuencias distintas pueden
     compartir como máximo una casilla.

     Esto evita que una línea de 6 fichas
     se cuente como dos líneas.
    */

    const valid =
      registered.every(
        previous => {
          const previousCells =
            new Set(
              previous.cells || []
            );

          const overlap =
            candidate.cells
              .filter(
                cell =>
                  previousCells.has(
                    cell
                  )
              )
              .length;

          return overlap <= 1;
        }
      );

    if (!valid) {
      continue;
    }

    registered.push(
      candidate
    );

    /*
     Solo necesitamos hasta 2
     para ganar.
    */

    if (
      registered.length >= 2
    ) {
      break;
    }
  }

  game.completedSequences[
    uid
  ] =
    registered;

  game.sequences[
    uid
  ] =
    Math.min(
      2,
      registered.length
    );

  return game.sequences[
    uid
  ];
}


/* =========================================================
   REALIZAR JUGADA
========================================================= */

async function playAt(index) {
  if (
    !currentRoomCode ||
    !currentRoom?.game ||
    moveInFlight
  ) {
    return;
  }

  if (
    currentRoom.game.winner
  ) {
    return;
  }

  /*
   Verificación local de turno.
  */

  if (
    currentRoom.game.turn !==
    me.uid
  ) {
    selectedCardIndex =
      null;

    status(
      'gameStatus',
      `Espera. Es turno de ${playerName(
        currentRoom,
        currentRoom.game.turn
      )}.`
    );

    renderHand(
      currentRoom
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

  const cardIndex =
    selectedCardIndex;

  const roomRef =
    ref(
      db,
      `rooms/${currentRoomCode}`
    );

  moveInFlight =
    true;

  try {
    const result =
      await runTransaction(
        roomRef,
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

          /*
           Deben seguir al menos
           dos jugadores activos.
          */

          const active =
            getActivePlayerIds(
              room
            );

          if (
            active.length < 2
          ) {
            return;
          }

          const hand =
            room.game.hands?.[
              me.uid
            ];

          if (
            !Array.isArray(hand)
          ) {
            return;
          }

          const card =
            hand[
              cardIndex
            ];

          if (!card) {
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

          const type =
            jackType(card);

          room.game.chips =
            room.game.chips ||
            {};

          /*
           Jota para quitar.
          */

          if (
            type ===
            'remove'
          ) {
            delete room.game.chips[
              index
            ];
          } else {
            /*
             Carta normal o Jota libre.
            */

            room.game.chips[
              index
            ] =
              me.uid;
          }

          /*
           Gastar carta.
          */

          hand.splice(
            cardIndex,
            1
          );

          /*
           Robar carta.
          */

          if (
            room.game.deck?.length
          ) {
            hand.push(
              room.game.deck.shift()
            );
          }

          room.game.hands[
            me.uid
          ] =
            hand;

          /*
           IMPORTANTE:

           Una Jota de quitar NO crea
           secuencia para quien la juega.

           Solo una ficha recién colocada
           puede crear una nueva secuencia.
          */

          let sequences =
            room.game.sequences?.[
              me.uid
            ] || 0;

          if (
            type !==
            'remove'
          ) {
            sequences =
              registerNewSequences(
                room.game,
                me.uid,
                index
              );
          }

          /*
           SEGUNDA SECUENCIA = GANADOR.
          */

          if (
            sequences >= 2
          ) {
            room.game.winner =
              me.uid;

            room.game.finishReason =
              'sequences';

            room.status =
              'finished';
          } else {
            /*
             Pasar al siguiente jugador
             activo en orden circular.
            */

            const nextPlayer =
              getNextActivePlayer(
                room,
                me.uid
              );

            if (!nextPlayer) {
              return;
            }

            room.game.turn =
              nextPlayer;
          }

          room.game.moveCount =
            (
              room.game.moveCount ||
              0
            ) + 1;

          room.game.updatedAt =
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
        'Movimiento realizado. Esperando al siguiente jugador…'
      );
    } else {
      status(
        'gameStatus',
        'La jugada no fue válida o el turno ya cambió.'
      );
    }
  } catch (error) {
    console.error(error);

    status(
      'gameStatus',
      'No se pudo guardar la jugada. Revisa tu conexión e intenta otra vez.'
    );
  } finally {
    moveInFlight =
      false;
  }
}


/* =========================================================
   CARTA MUERTA
========================================================= */

$('deadCardBtn').addEventListener(
  'click',
  async () => {
    if (
      selectedCardIndex ===
        null ||
      !currentRoomCode ||
      !currentRoom?.game
    ) {
      status(
        'gameStatus',
        'Selecciona primero una carta.'
      );

      return;
    }

    if (
      currentRoom.game.turn !==
      me.uid
    ) {
      status(
        'gameStatus',
        'Solo puedes cambiar una carta muerta durante tu turno.'
      );

      return;
    }

    if (moveInFlight) {
      return;
    }

    moveInFlight =
      true;

    const selectedIndex =
      selectedCardIndex;

    try {
      const result =
        await runTransaction(
          ref(
            db,
            `rooms/${currentRoomCode}`
          ),
          room => {
            if (
              !room?.game ||
              room.status !==
                'playing' ||
              room.game.turn !==
                me.uid ||
              room.game.winner
            ) {
              return;
            }

            const hand =
              room.game.hands?.[
                me.uid
              ];

            if (
              !Array.isArray(hand)
            ) {
              return;
            }

            const card =
              hand[
                selectedIndex
              ];

            /*
             Una Jota jamás se considera
             carta muerta.
            */

            if (
              !card ||
              isJack(card) ||
              !room.game.deck?.length
            ) {
              return;
            }

            const stillAvailable =
              room.game.board.some(
                (
                  boardCard,
                  boardIndex
                ) => {
                  return (
                    boardCard ===
                      card &&
                    !room.game.chips?.[
                      boardIndex
                    ]
                  );
                }
              );

            if (stillAvailable) {
              return;
            }

            /*
             Cambiar carta.

             NO consume turno.
            */

            hand.splice(
              selectedIndex,
              1,
              room.game.deck.shift()
            );

            room.game.hands[
              me.uid
            ] =
              hand;

            room.game.updatedAt =
              Date.now();

            return room;
          }
        );

      if (result.committed) {
        selectedCardIndex =
          null;

        status(
          'gameStatus',
          'Carta muerta cambiada. Sigue siendo tu turno.'
        );
      } else {
        status(
          'gameStatus',
          'Esa carta no está muerta, es una Jota o ya no quedan cartas para robar.'
        );
      }
    } catch (error) {
      console.error(error);

      status(
        'gameStatus',
        'No se pudo cambiar la carta.'
      );
    } finally {
      moveInFlight =
        false;
    }
  }
);


/* =========================================================
   RESULTADO
========================================================= */

function showResult(room) {
  if (
    !$('modal')
      .classList
      .contains('hidden')
  ) {
    return;
  }

  const winner =
    room.game?.winner;

  const reason =
    room.game?.finishReason;

  if (
    winner ===
    me.uid
  ) {
    $('modalTitle').textContent =
      '🏆 ¡Ganaste!';
  } else {
    $('modalTitle').textContent =
      'Partida terminada';
  }

  if (!winner) {
    $('modalText').textContent =
      'La partida terminó.';
  } else if (
    reason ===
    'forfeit'
  ) {
    $('modalText').textContent =
      `${playerName(
        room,
        winner
      )} ganó porque quedó como último jugador en la partida.`;
  } else if (
    reason ===
    'disconnect'
  ) {
    $('modalText').textContent =
      `${playerName(
        room,
        winner
      )} ganó porque los demás jugadores se desconectaron.`;
  } else {
    $('modalText').textContent =
      `${playerName(
        room,
        winner
      )} completó 2 secuencias de cinco.`;
  }

  $('modal')
    .classList
    .remove('hidden');
}


/* =========================================================
   VOLVER AL LOBBY DESDE RESULTADO
========================================================= */

$('modalOk').addEventListener(
  'click',
  () => {
    $('modal')
      .classList
      .add('hidden');

    leaveRoom();
  }
);


/* =========================================================
   MATCHMAKING 1 VS 1
========================================================= */

$('matchBtn').addEventListener(
  'click',
  async () => {
    if (!me) {
      return;
    }

    status(
      'lobbyStatus',
      'Buscando oponente…'
    );

    $('matchBtn')
      .classList
      .add('hidden');

    $('cancelMatchBtn')
      .classList
      .remove('hidden');

    const queueRef =
      ref(
        db,
        `queue/${me.uid}`
      );

    await set(
      queueRef,
      {
        uid:
          me.uid,

        name:
          displayName,

        createdAt:
          Date.now()
      }
    );

    onDisconnect(
      queueRef
    ).remove();

    await tryMatch();
  }
);


/* =========================================================
   CANCELAR MATCH
========================================================= */

$('cancelMatchBtn').addEventListener(
  'click',
  cancelMatch
);


async function cancelMatch() {
  if (me) {
    await remove(
      ref(
        db,
        `queue/${me.uid}`
      )
    );
  }

  $('matchBtn')
    .classList
    .remove('hidden');

  $('cancelMatchBtn')
    .classList
    .add('hidden');

  if (!currentRoomCode) {
    status(
      'lobbyStatus',
      ''
    );
  }
}


/* =========================================================
   BUSCAR OPONENTE
========================================================= */
async function tryMatch() {

  if (
    !me ||
    currentRoomCode
  ) {
    return;
  }

  try {

    /*
     Confirmamos que YO sigo
     en la cola.
    */

    const myQueueRef =
      ref(
        db,
        `queue/${me.uid}`
      );

    const myQueueSnap =
      await get(myQueueRef);

    if (!myQueueSnap.exists()) {
      return;
    }


    /*
     Leer todos los jugadores
     que están buscando partida.
    */

    const queueSnap =
      await get(
        ref(
          db,
          'queue'
        )
      );

    if (!queueSnap.exists()) {
      status(
        'lobbyStatus',
        'Buscando oponente…'
      );
      return;
    }


    const queue =
      queueSnap.val();


    const opponents =
      Object.values(queue)
        .filter(
          player =>
            player &&
            player.uid &&
            player.uid !== me.uid
        )
        .sort(
          (a, b) =>
            (a.createdAt || 0) -
            (b.createdAt || 0)
        );


    if (!opponents.length) {
      status(
        'lobbyStatus',
        'Buscando oponente…'
      );
      return;
    }


    const other =
      opponents[0];


    /*
     Para evitar que los DOS creen
     una sala diferente:

     solamente el UID alfabéticamente
     menor crea la sala.
    */

    const creatorUid =
      [
        me.uid,
        other.uid
      ]
        .sort()[0];


    if (
      creatorUid !== me.uid
    ) {

      /*
       El otro jugador será quien
       cree la sala.

       Nosotros esperamos la notificación
       en matchesByUser.
      */

      status(
        'lobbyStatus',
        'Oponente encontrado. Preparando partida…'
      );

      return;
    }


    /*
     Antes de continuar comprobamos que
     el rival siga esperando.
    */

    const rivalSnap =
      await get(
        ref(
          db,
          `queue/${other.uid}`
        )
      );

    if (!rivalSnap.exists()) {
      return;
    }


    /*
     Crear código de sala único.
    */

    let code =
      randomCode();

    let roomExists =
      true;


    while (roomExists) {

      const check =
        await get(
          ref(
            db,
            `rooms/${code}`
          )
        );

      roomExists =
        check.exists();

      if (roomExists) {
        code =
          randomCode();
      }
    }


    const now =
      Date.now();


    /*
     Crear partida 1 VS 1.
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
            other.name || 'Jugador',
          joinedAt:
            now + 1
        }

      }

    };


    /*
     Primero crear la sala.
    */

    await set(
      ref(
        db,
        `rooms/${code}`
      ),
      room
    );


    /*
     Luego quitar a los dos
     de la cola.
    */

    await Promise.all([

      remove(
        ref(
          db,
          `queue/${me.uid}`
        )
      ),

      remove(
        ref(
          db,
          `queue/${other.uid}`
        )
      )

    ]);


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


    status(
      'lobbyStatus',
      '¡Oponente encontrado!'
    );


    /*
     Entrar nosotros.
    */

    enterRoom(code);

  } catch (error) {

    console.error(
      'ERROR MATCHMAKING:',
      error
    );

    status(
      'lobbyStatus',
      'Hubo un problema buscando oponente. Intentando nuevamente…'
    );

  }

}

/* =========================================================
   REINTENTAR MATCH
========================================================= */

setInterval(
  () => {
    if (
      me &&
      !currentRoomCode &&
      !$('cancelMatchBtn')
        .classList
        .contains('hidden')
    ) {
      tryMatch();
    }
  },
  2500
);


/* =========================================================
   INICIAR APP
========================================================= */

bootstrap();