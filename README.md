# KCequence — versión GitHub Pages + Firebase

Esta edición está hecha para publicarse directamente con GitHub Pages. No usa PHP, XAMPP, Node.js ni MySQL.

## Qué incluye

- Nombre de jugador guardado en el navegador.
- Firebase Anonymous Authentication.
- Salas privadas con código de 6 caracteres.
- Partidas de 2 jugadores en tiempo real.
- Matchmaking público básico.
- Tablero 10x10 inspirado en juegos de secuencias de cartas.
- Mano de 7 cartas.
- Jotas especiales: corazones/diamantes = colocar libre; tréboles/picas = quitar ficha rival.
- Esquinas libres.
- Detección de líneas de 5 y victoria al completar 2.
- Cambio de carta muerta.
- Diseño responsive.

## 1. Crear proyecto Firebase

1. Entra a https://console.firebase.google.com/
2. Crea un proyecto nuevo, por ejemplo `kcequence-online`.
3. En "Project settings" agrega una app Web (`</>`).
4. Firebase te mostrará un objeto `firebaseConfig`.
5. Abre `firebase-config.js` y reemplaza los valores de ejemplo con los tuyos.

## 2. Activar autenticación anónima

Firebase Console > Build > Authentication > Get started > Sign-in method > Anonymous > Enable.

## 3. Crear Realtime Database

Firebase Console > Build > Realtime Database > Create Database.

Para empezar puedes seleccionar una región cercana a tus jugadores.

En la pestaña Rules, pega el contenido de `database.rules.json`:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Pulsa Publish.

> Estas reglas son adecuadas para una beta/prueba con amigos, no para un lanzamiento competitivo. Para producción conviene endurecerlas o mover la autoridad de la partida a Cloud Functions/servidor.

## 4. Probar antes de GitHub

Como el proyecto usa módulos ES, evita abrir `index.html` haciendo doble clic si el navegador bloquea módulos locales. Puedes probarlo con VS Code + Live Server o directamente publicarlo en GitHub Pages.

## 5. Subir a GitHub

Crea un repositorio llamado `KCequence` y sube estos archivos en la raíz:

- index.html
- styles.css
- app.js
- firebase-config.js
- database.rules.json
- README.md

## 6. Activar GitHub Pages

Repositorio > Settings > Pages.

En "Build and deployment":

- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

Guarda. GitHub te dará una URL similar a:

`https://TU-USUARIO.github.io/KCequence/`

## 7. Probar online

1. Abre la URL de GitHub Pages.
2. Escribe un nombre.
3. Crea una sala.
4. Copia el código.
5. Tu amigo abre la misma URL desde su teléfono/PC y usa "Unirse".
6. El anfitrión pulsa "Iniciar partida" cuando estén los dos.

Para matchmaking, ambos pueden pulsar "Buscar oponente".

## Importante

Firebase `apiKey` de una app web no funciona como una contraseña del servidor; Firebase espera que esta configuración esté en el frontend. La seguridad real debe venir de Authentication y Database Security Rules.

Esta versión es un MVP para pruebas. Al ser completamente client-side, un usuario con conocimientos técnicos podría intentar manipular datos. Para una versión competitiva/ranked conviene implementar validación autoritativa en un backend o Cloud Functions.
"# KCequence" 
