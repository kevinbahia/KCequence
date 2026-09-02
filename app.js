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


  /*
    El botón "Cambiar jugador"
    solamente aparece en el lobby.
  */

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

    <span>
      ${escapeHtml(label)}
    </span>
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
    'Super',
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

      const nickname =
        randomNickname();


      const input =
        $('nameInput');


      if (!input) {
        return;
      }


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
   GENERAR CÓDIGO DE SALA
========================================================= */

function randomCode() {

  /*
    Quitamos caracteres que pueden
    confundirse visualmente:
    I, O, 0 y 1.
  */

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
   CARTAS
========================================================= */

function cardId(
  suit,
  rank
) {

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
    J♥ y J♦
    = Jota libre

    J♣ y J♠
    = quitar ficha rival
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
   MEZCLAR CARTAS
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


  /*
    KCequence utiliza
    dos barajas completas.
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
    Dos copias de cada carta,
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

    /*
      Las cuatro esquinas
      son espacios libres.
    */

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
   JUGADORES / ORDEN
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


  return getPlayerIds(
    room
  );

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
      'Error Firebase:',
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
   USUARIO AUTENTICADO
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
   REGISTRO DE NOMBRE / NICKNAME
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


      /*
        Validación del nickname.
      */

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


      input.setCustomValidity(
        ''
      );


      /*
        Guardar nombre.
      */

      displayName =
        name;


      localStorage.setItem(
        'kc_name',
        name
      );


      /*
        Actualizar encabezado.
      */

      updatePlayerPill(
        name
      );


      /*
        Guardar perfil Firebase.
      */

      try {

        await ensureProfile();

      } catch (error) {

        console.error(
          'No se pudo actualizar el perfil:',
          error
        );

      }


      /*
        Limpiar mensajes anteriores.
      */

      status(
        'lobbyStatus',
        ''
      );


      /*
        Entrar al lobby.
      */

      showView(
        'lobbyView'
      );

    }

  );

}


/* =========================================================
   LIMPIAR VALIDACIÓN AL ESCRIBIR
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
   INPUT DEL CÓDIGO DE SALA
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


  /*
    Permitir presionar ENTER
    para entrar a una sala.
  */

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


  /*
    El botón "Cambiar jugador"
    solamente aparece en el lobby.
  */

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

    <span>
      ${escapeHtml(label)}
    </span>
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
    'Super',
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

      const nickname =
        randomNickname();


      const input =
        $('nameInput');


      if (!input) {
        return;
      }


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
   GENERAR CÓDIGO DE SALA
========================================================= */

function randomCode() {

  /*
    Quitamos caracteres que pueden
    confundirse visualmente:
    I, O, 0 y 1.
  */

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
   CARTAS
========================================================= */

function cardId(
  suit,
  rank
) {

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
    J♥ y J♦
    = Jota libre

    J♣ y J♠
    = quitar ficha rival
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
   MEZCLAR CARTAS
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


  /*
    KCequence utiliza
    dos barajas completas.
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
    Dos copias de cada carta,
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

    /*
      Las cuatro esquinas
      son espacios libres.
    */

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
   JUGADORES / ORDEN
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


  return getPlayerIds(
    room
  );

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
      'Error Firebase:',
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
   USUARIO AUTENTICADO
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
   REGISTRO DE NOMBRE / NICKNAME
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


      /*
        Validación del nickname.
      */

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


      input.setCustomValidity(
        ''
      );


      /*
        Guardar nombre.
      */

      displayName =
        name;


      localStorage.setItem(
        'kc_name',
        name
      );


      /*
        Actualizar encabezado.
      */

      updatePlayerPill(
        name
      );


      /*
        Guardar perfil Firebase.
      */

      try {

        await ensureProfile();

      } catch (error) {

        console.error(
          'No se pudo actualizar el perfil:',
          error
        );

      }


      /*
        Limpiar mensajes anteriores.
      */

      status(
        'lobbyStatus',
        ''
      );


      /*
        Entrar al lobby.
      */

      showView(
        'lobbyView'
      );

    }

  );

}


/* =========================================================
   LIMPIAR VALIDACIÓN AL ESCRIBIR
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
   INPUT DEL CÓDIGO DE SALA
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


  /*
    Permitir presionar ENTER
    para entrar a una sala.
  */

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
      Cancelar matchmaking
      por seguridad.
    */

    await cancelMatch();


    /*
      Si todavía está asociado
      a una sala, salir bien.
    */

    if (
      currentRoomCode
    ) {

      await leaveRoom();

    }


    /*
      Borrar nickname guardado.
    */

    localStorage.removeItem(
      'kc_name'
    );


    displayName =
      '';


    /*
      Limpiar formulario.
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
      Limpiar estados.
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
      Mostrar como invitado.
    */

    updatePlayerPill(
      'Invitado conectado'
    );


    /*
      Regresar al registro
      del nickname.
    */

    showView(
      'authView'
    );


    /*
      Llevar cursor al campo.
    */

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


    status(
      'lobbyStatus',
      'No se pudo cambiar de jugador.'
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


  const game =
    room.game;


  const myTurn =
    (
      game.turn ===
        me.uid &&
      !game.winner
    );


  /*
    Si no es nuestro turno,
    cancelar selección.
  */

  if (
    !myTurn
  ) {

    selectedCardIndex =
      null;

  }


  /*
    Mostrar turno.
  */

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


  /*
    Marcador.
  */

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
    Render visual.
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
    Construir las 100 casillas.
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


        /*
          Tooltip con jugador.
        */

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
        Casilla válida para la carta
        que tenemos seleccionada.
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


      /*
        Solo mandar jugada cuando
        realmente se toca la casilla.
      */

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
   MANO
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


      /*
        Contenido carta.
      */

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


      /*
        Seleccionar carta.
      */

      button.addEventListener(

        'click',

        () => {

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
            Si toca la misma carta
            seleccionada, cancelar.
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
            Seleccionar.
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


  /*
    Ayuda inferior de la mano.
  */

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
    Las esquinas libres
    no se pueden seleccionar.
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
    Jota de quitar.
  */

  if (
    type ===
    'remove'
  ) {

    /*
      Tiene que existir una ficha
      y no puede ser propia.
    */

    if (
      !occupied ||
      chipUid === me.uid
    ) {

      return false;

    }


    /*
      No quitar fichas que forman
      una secuencia reconocida.
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
    la casilla debe estar libre y
    coincidir exactamente con
    la carta de la mano.
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

  /*
    Horizontal
    Vertical
    Diagonal descendente
    Diagonal ascendente
  */

  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];


  /*
    Una esquina libre cuenta
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
    Revisar cada dirección.
  */

  for (
    const [dr, dc]
    of directions
  ) {

    /*
      Una nueva secuencia debe
      incluir la ficha que acaba
      de colocarse.

      Probamos todas las ventanas
      posibles de 5 casillas que
      contienen esa posición.
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
          Salió del tablero.
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
          Tiene que pertenecer
          al jugador o ser esquina.
        */

        if (
          !own(index)
        ) {

          valid =
            false;

          break;

        }


        cells.push(
          index
        );

      }


      /*
        Línea completa.
      */

      if (
        valid &&
        containsMove &&
        cells.length === 5
      ) {

        /*
          ID estable de la línea.
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
    Eliminar resultados
    duplicados.
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
    Copiamos las que ya estaban
    registradas.
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
      No contar exactamente
      la misma línea dos veces.
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
      Dos secuencias válidas pueden
      compartir como máximo una casilla.

      Con esto una línea de 6 fichas
      no se interpreta como dos
      secuencias completas.
    */

    const valid =
      registered.every(

        previous => {

          const previousCells =
            new Set(
              previous.cells ||
              []
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


          return (
            overlap <= 1
          );

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


    /*
      Solo se necesitan dos
      secuencias para ganar.
    */

    if (
      registered.length >=
      2
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


  /*
    Debe haber una carta seleccionada.
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
            Deben seguir por lo menos
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


          /*
            Obtener nuestra mano.
          */

          const hand =
            room.game.hands?.[
              me.uid
            ];


          if (
            !Array.isArray(
              hand
            )
          ) {

            return;

          }


          /*
            Carta seleccionada.
          */

          const card =
            hand[
              cardIndex
            ];


          if (!card) {

            return;

          }


          /*
            Verificar nuevamente la jugada
            dentro de Firebase.
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


          const type =
            jackType(
              card
            );


          room.game.chips =
            room.game.chips ||
            {};


          /* =================================================
             JOTA PARA QUITAR
          ================================================== */

          if (
            type ===
            'remove'
          ) {

            delete room.game.chips[
              index
            ];

          } else {

            /* ===============================================
               CARTA NORMAL O JOTA LIBRE
            ================================================ */

            room.game.chips[
              index
            ] =
              me.uid;

          }


          /*
            Gastar carta seleccionada.
          */

          hand.splice(
            cardIndex,
            1
          );


          /*
            Robar una carta del mazo.
          */

          if (
            room.game.deck?.length
          ) {

            hand.push(
              room.game.deck.shift()
            );

          }


          /*
            Guardar mano actualizada.
          */

          room.game.hands[
            me.uid
          ] =
            hand;


          /*
            Una Jota para quitar
            NO crea secuencia.

            Solamente una ficha que
            acaba de colocarse puede
            crear una secuencia.
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


          /* =================================================
             VICTORIA
          ================================================== */

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

            /* ===============================================
               PASAR TURNO
            ================================================ */

            const nextPlayer =
              getNextActivePlayer(
                room,
                me.uid
              );


            if (
              !nextPlayer
            ) {

              return;

            }


            room.game.turn =
              nextPlayer;

          }


          /*
            Estadísticas básicas.
          */

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


    /*
      Resultado de la transacción.
    */

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

    console.error(
      'Error realizando jugada:',
      error
    );


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

const deadCardBtn =
  $('deadCardBtn');


if (deadCardBtn) {

  deadCardBtn.addEventListener(

    'click',

    async () => {

      /*
        Debe haber una carta
        seleccionada.
      */

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


      /*
        Solo durante nuestro turno.
      */

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


      if (
        moveInFlight
      ) {

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
                !Array.isArray(
                  hand
                )
              ) {

                return;

              }


              const card =
                hand[
                  selectedIndex
                ];


              /*
                Las Jotas nunca son
                cartas muertas.

                También debe quedar
                al menos una carta
                en el mazo.
              */

              if (
                !card ||
                isJack(card) ||
                !room.game.deck?.length
              ) {

                return;

              }


              /*
                Revisar si todavía existe
                alguna casilla libre para
                esa carta.
              */

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


              /*
                Si existe una posición libre,
                la carta NO está muerta.
              */

              if (
                stillAvailable
              ) {

                return;

              }


              /*
                Sustituir carta.

                Esto NO consume turno.
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


        if (
          result.committed
        ) {

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

        console.error(
          'Error cambiando carta muerta:',
          error
        );


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

}


/* =========================================================
   RESULTADO DE LA PARTIDA
========================================================= */

function showResult(room) {

  const modal =
    $('modal');


  if (!modal) {

    return;

  }


  /*
    Si ya está abierto,
    no volver a modificarlo.
  */

  if (
    !modal.classList
      .contains(
        'hidden'
      )
  ) {

    return;

  }


  const winner =
    room.game?.winner;


  const reason =
    room.game?.finishReason;


  const modalTitle =
    $('modalTitle');


  const modalText =
    $('modalText');


  /*
    Título.
  */

  if (
    modalTitle
  ) {

    if (
      winner ===
      me.uid
    ) {

      modalTitle.textContent =
        '🏆 ¡Ganaste!';

    } else {

      modalTitle.textContent =
        'Partida terminada';

    }

  }


  /*
    Explicación.
  */

  if (
    modalText
  ) {

    if (!winner) {

      modalText.textContent =
        'La partida terminó.';


    } else if (
      reason ===
      'forfeit'
    ) {

      modalText.textContent =
        `${playerName(
          room,
          winner
        )} ganó porque quedó como último jugador en la partida.`;


    } else if (
      reason ===
      'disconnect'
    ) {

      modalText.textContent =
        `${playerName(
          room,
          winner
        )} ganó porque los demás jugadores se desconectaron.`;


    } else {

      modalText.textContent =
        `${playerName(
          room,
          winner
        )} completó 2 secuencias de cinco.`;

    }

  }


  /*
    Abrir modal.
  */

  modal.classList.remove(
    'hidden'
  );

}


/* =========================================================
   VOLVER AL LOBBY DESDE RESULTADO
========================================================= */

const modalOk =
  $('modalOk');


if (modalOk) {

  modalOk.addEventListener(

    'click',

    () => {

      const modal =
        $('modal');


      if (modal) {

        modal.classList.add(
          'hidden'
        );

      }


      leaveRoom();

    }

  );

}


/* =========================================================
   MATCHMAKING 1 VS 1
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
          'lobbyStatus',
          'Primero elige un nickname.'
        );


        return;

      }


      status(
        'lobbyStatus',
        'Buscando oponente…'
      );


      matchBtn.classList.add(
        'hidden'
      );


      const cancelButton =
        $('cancelMatchBtn');


      if (
        cancelButton
      ) {

        cancelButton.classList.remove(
          'hidden'
        );

      }


      const queueRef =
        ref(
          db,
          `queue/${me.uid}`
        );


      try {

        /*
          Agregarnos a la cola.
        */

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


        /*
          Si cierra pestaña,
          salir de la cola.
        */

        try {

          await onDisconnect(
            queueRef
          ).remove();

        } catch (error) {

          console.warn(
            'No se pudo registrar onDisconnect en matchmaking:',
            error
          );

        }


        /*
          Intentar encontrar rival.
        */

        await tryMatch();


      } catch (error) {

        console.error(
          'Error iniciando matchmaking:',
          error
        );


        status(
          'lobbyStatus',
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
    cancelMatch
  );

}


async function cancelMatch() {

  /*
    Quitar al usuario de la cola.
  */

  if (me) {

    try {

      await remove(

        ref(
          db,
          `queue/${me.uid}`
        )

      );

    } catch (error) {

      console.warn(
        'No se pudo eliminar de la cola:',
        error
      );

    }

  }


  /*
    Restaurar botones.
  */

  const matchButton =
    $('matchBtn');


  const cancelButton =
    $('cancelMatchBtn');


  if (
    matchButton
  ) {

    matchButton.classList.remove(
      'hidden'
    );

  }


  if (
    cancelButton
  ) {

    cancelButton.classList.add(
      'hidden'
    );

  }


  /*
    Limpiar mensaje solamente
    cuando no estamos entrando
    a una sala.
  */

  if (
    !currentRoomCode
  ) {

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
      Confirmar que nosotros
      todavía seguimos en cola.
    */

    const myQueueRef =
      ref(
        db,
        `queue/${me.uid}`
      );


    const myQueueSnap =
      await get(
        myQueueRef
      );


    if (
      !myQueueSnap.exists()
    ) {

      return;

    }


    /*
      Obtener jugadores buscando.
    */

    const queueSnap =
      await get(

        ref(
          db,
          'queue'
        )

      );


    if (
      !queueSnap.exists()
    ) {

      status(
        'lobbyStatus',
        'Buscando oponente…'
      );


      return;

    }


    const queue =
      queueSnap.val();


    /*
      Excluirnos.
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
            (a.createdAt || 0) -
            (b.createdAt || 0)
        );


    /*
      Nadie disponible todavía.
    */

    if (
      !opponents.length
    ) {

      status(
        'lobbyStatus',
        'Buscando oponente…'
      );


      return;

    }


    const other =
      opponents[0];


    /*
      Para evitar que ambos jugadores
      creen dos salas diferentes,
      solo el UID alfabéticamente menor
      crea la sala.
    */

    const creatorUid =
      [
        me.uid,
        other.uid
      ]

        .sort()[0];


    /*
      El rival será quien
      cree la sala.
    */

    if (
      creatorUid !==
      me.uid
    ) {

      status(
        'lobbyStatus',
        'Oponente encontrado. Preparando partida…'
      );


      return;

    }


    /*
      Confirmar que el rival
      siga en cola.
    */

    const rivalSnap =
      await get(

        ref(
          db,
          `queue/${other.uid}`
        )

      );


    if (
      !rivalSnap.exists()
    ) {

      return;

    }


    /* =====================================================
       GENERAR SALA ÚNICA
    ====================================================== */

    let code =
      randomCode();


    let roomExists =
      true;


    while (
      roomExists
    ) {

      const check =
        await get(

          ref(
            db,
            `rooms/${code}`
          )

        );


      roomExists =
        check.exists();


      if (
        roomExists
      ) {

        code =
          randomCode();

      }

    }


    const now =
      Date.now();


    /* =====================================================
       CREAR SALA 1 VS 1
    ====================================================== */

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
      Sacar a ambos jugadores
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
      Avisar al otro jugador.
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

    await enterRoom(
      code
    );


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
   REINTENTAR MATCHMAKING
========================================================= */

/*
  Mientras el botón cancelar siga
  visible significa que seguimos
  buscando rival.

  Reintentar cada 2.5 segundos.
*/

setInterval(

  () => {

    const cancelButton =
      $('cancelMatchBtn');


    if (
      me &&
      !currentRoomCode &&
      cancelButton &&
      !cancelButton.classList
        .contains(
          'hidden'
        )
    ) {

      tryMatch();

    }

  },

  2500

);


/* =========================================================
   LIMPIEZA AL CERRAR PÁGINA
========================================================= */

/*
  onDisconnect de Firebase se encarga
  de las salas y cola.

  Aquí solo limpiamos estado local
  cuando corresponde.
*/

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