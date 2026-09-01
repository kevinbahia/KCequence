Quiero que mejores mi videojuego web llamado KCequence. Es un juego de estrategia de cartas y fichas inspirado en la idea general de formar líneas de cinco, pero debe tener identidad gráfica, terminología, interfaz y recursos propios.

TECNOLOGÍA OBLIGATORIA:
- Debe funcionar en GitHub Pages.
- HTML5, CSS3 y JavaScript ES Modules.
- Firebase Authentication con inicio anónimo.
- Firebase Realtime Database para sincronización multijugador.
- No PHP.
- No MySQL.
- No Node.js obligatorio para ejecutar la web.
- No frameworks que requieran build, salvo que se entregue también el build estático listo para GitHub Pages.

FUNCIONES:
- Nombre de jugador.
- Lobby profesional.
- Crear sala privada con código corto.
- Unirse a sala mediante código.
- Matchmaking contra jugadores aleatorios.
- Juego online en tiempo real para 2 jugadores.
- Tablero 10x10.
- Mano de cartas.
- Colocar fichas únicamente en ubicaciones permitidas por la carta.
- Cartas especiales equivalentes conceptualmente a colocar libre y retirar una ficha rival, pero con nombres/estilo propios de KCequence.
- Esquinas libres.
- Detección automática de líneas de cinco.
- Victoria al completar la cantidad configurada de líneas.
- Carta muerta/reemplazo.
- Estado de turnos.
- Pantalla de victoria/derrota.
- Reconexión básica.
- Responsive para PC y teléfono.

DISEÑO:
- Videojuego competitivo moderno, no página administrativa.
- Marca KCequence, destacando visualmente KC.
- Fondo azul muy oscuro/negro.
- Detalles dorados y azul eléctrico.
- Cartas elegantes.
- Fichas con volumen.
- Animaciones suaves.
- Estados hover/touch claros.
- Tablero protagonista.
- Interfaz móvil excelente.

SEGURIDAD/ARQUITECTURA:
- No confiar en datos del DOM.
- Usar Firebase transactions para movimientos concurrentes.
- Proponer Firebase Security Rules más estrictas.
- Explicar las limitaciones de una arquitectura completamente client-side.
- Si se implementa ranking competitivo, proponer Cloud Functions o backend autoritativo.

ENTREGA:
- Entrega todos los archivos completos, no fragmentos.
- index.html
- styles.css
- app.js o módulos JS separados
- firebase-config.example.js
- database.rules.json
- README.md con configuración de Firebase y GitHub Pages.
- No dejar botones decorativos sin funcionar.
- No usar datos simulados en las funciones online principales.
