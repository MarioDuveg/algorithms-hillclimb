# Summit Lab 3D — Arena multijugador de Hill Climbing

**Sitio web en español, con backend Node.js y motor 3D WebGL con alternativa Canvas 2D, listo para desplegar como Web Service en Render.** No requiere bases de datos, servicios de terceros ni recursos de CDN. Toda la implementación viene dentro de este proyecto.

## Características

- Registro mediante nombre de usuario (2–24 caracteres), con control de nombres duplicados.
- Usuario reservado **`admin`** con contraseña inicial de demostración **`Admin2026`**. En Render se recomienda establecer `ADMIN_PASSWORD` como variable de entorno.
- Todos los exploradores ven el **mismo relieve tridimensional**, los agentes, sus recorridos y el ranking en tiempo real.
- Mapa matemático multicolina con una **cumbre global dominante (~41.8 m)**, máximos locales y **ocho cuencas de mínimo global a altura 0**.
- Posición inicial aleatoria cuando se confirma un algoritmo (antes de pulsar Start).
- El ranking se ordena por la **máxima altura alcanzada históricamente** por cada jugador, no por su altura actual (importante para reinicios aleatorios y recocido).
- Animación de agentes y trazas de trayectoria, cámara orbital (arrastrar), zoom con rueda, autorrotación, marcadores de la cumbre y de los mínimos.
- El administrador tiene los mismos controles de algoritmo que los demás y, adicionalmente, **Start** y **Reset**.
- **Start:** inicia simultáneamente a todos los participantes conectados que hayan confirmado un algoritmo. Usuarios sin elección son espectadores hasta la siguiente ronda.
- **Reset:** limpia estrategias, posiciones, puntuaciones, rutas y ranking de **todos**; mantiene las sesiones abiertas para que vuelvan a elegir estrategia sin escribir el nombre otra vez.
- Cálculo de los agentes y de las puntuaciones **autoritativo en el servidor** (no acepta posiciones proporcionadas por el navegador).

### Estrategias implementadas

| Algoritmo | Regla de movimiento | Configurables |
| --- | --- | --- |
| Escalada simple | Primer vecino que mejora, en orden fijo. | Paso, vecinos |
| Máxima pendiente | Mejor vecino del conjunto. | Paso, vecinos |
| Escalada estocástica | Mejora elegida al azar, ponderada por magnitud de mejora. | Paso, vecinos |
| Primera elección aleatoria | Primera mejora tras barajar las direcciones de exploración. | Paso, vecinos |
| Reinicios aleatorios | Máxima pendiente; reinicia al atascarse. Conserva récord histórico. | Paso, vecinos, reinicios máximos |
| Movimientos laterales | Mejor vecino ascendente; si no hay, permite movimientos casi horizontales con tolerancia de altura 0.06. | Paso, vecinos, límite lateral |
| Recocido simulado | Acepta ascensos y descensos con probabilidad `exp((h_nueva - h_actual)/T)`. | Paso, vecinos, temperatura inicial, factor de enfriamiento, temperatura mínima, pasos por temperatura, iteraciones máximas |

> Nota matemática: la altura se limita inferiormente a 0, lo que crea **múltiples cuencas de mínimos globales**. El máximo global mostrado en la interfaz es una aproximación numérica sobre una malla de 0.2 unidades; el terreno se evalúa de forma continua durante los movimientos. El objetivo es **maximizar** la altura. `Movimientos laterales` usa una tolerancia práctica para mesetas continuas.

## Ejecución local

Requiere Node.js **20 o superior**.

```bash
npm install
npm start
```

Abrir **http://localhost:10000** en el navegador. Es posible utilizar varios navegadores, ventanas privadas o computadoras conectadas al mismo servidor para representar diferentes usuarios.

Si quieres otro puerto:

```bash
PORT=3000 npm start
```

Pruebas:

```bash
npm test
npm run check
```

No hay dependencias externas: `npm install` es suficiente y no descargará librerías.

## Publicación en Render

1. **Descomprime este ZIP** y sube los archivos a un repositorio GitHub/GitLab. Render despliega desde un repositorio Git (no requiere enviar directamente el ZIP al servicio).
2. En [Render](https://dashboard.render.com), elige **New → Web Service**, conecta el repositorio y selecciona **Node**.
3. Configura **Build Command:** `npm install` y **Start Command:** `npm start`. Alternativamente, importa el `render.yaml` desde **New → Blueprint**.
4. Configura la variable de entorno `ADMIN_PASSWORD` con una contraseña segura de tu elección. Si deseas conservar la contraseña solicitada para una práctica cerrada, establece `Admin2026`; **no se recomienda usarla en una web pública**, porque es conocida.
5. Despliega y comparte la URL `https://<nombre>.onrender.com` entre los participantes. La verificación de salud está en `/api/health`.

Render define el puerto del servidor mediante `PORT` y admite conexiones HTTPS; no hace falta configurar un proxy WebSocket. Los clientes reciben eventos por **Server-Sent Events (SSE)** y envían acciones al backend por `POST`.

> El plan gratuito de Render puede entrar en suspensión por inactividad. El estado del juego está **en memoria**: se pierde al reiniciar, suspender o redesplegar el servidor. Para un evento en el aula, conviene mantener el servicio activo y operar una sola instancia. No incluye cuentas persistentes ni recuperación histórica de partidas.

## Guía rápida de clase

1. El docente entra con nombre **admin** y la contraseña establecida.
2. Los estudiantes entran con nombres diferentes, eligen uno de los 7 algoritmos y ajustan sus controles.
3. Cada estudiante pulsa **Confirmar estrategia** y aparece en una posición aleatoria de la escena.
4. El docente pulsa **Start** cuando quiera iniciar la ronda. Los agentes ejecutan sus algoritmos automáticamente, en el servidor, una iteración cada ~450 ms.
5. En el ranking se muestra el récord máximo de cada agente; el mapa dibuja las rutas y los marcadores.
6. El docente pulsa **Reset** para preparar una nueva ronda. Nadie necesita volver a iniciar sesión: todos vuelven a elegir.

## Estructura

```text
summit-lab-3d/
├── package.json           Scripts de inicio y de pruebas
├── render.yaml            Configuración Blueprint de Render
├── .env.example           Ejemplo de configuración (solo referencia)
├── server/
│   ├── index.js           Servidor HTTP nativo, sesiones, SSE, API
│   └── room.js            Estado y reglas de la ronda
├── shared/
│   ├── terrain.js         Superficie y landmarks matemáticos
│   └── algorithms.js      Siete algoritmos ejecutados por el servidor
├── client/
│   ├── index.html         Interfaz
│   ├── styles.css         Estilos responsivos
│   ├── app.js             Paneles, login, ranking y acciones
│   ├── terrain3d.js       Renderer 3D WebGL y Canvas 2D, sin CDN
│   └── favicon.svg
└── tests/
    ├── algorithms.test.js
    └── server.test.js
```

## API

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Salud del servicio |
| POST | `/api/login` | Registrar nombre / autenticar administrador |
| GET | `/api/me` | Sesión y estado actual |
| GET | `/api/events` | Eventos SSE de estado en vivo |
| POST | `/api/select` | Elegir algoritmo y parámetros, generar posición |
| POST | `/api/start` | Iniciar (solo administrador) |
| POST | `/api/reset` | Reiniciar (solo administrador) |
| POST | `/api/logout` | Cerrar sesión |

Las sesiones usan cookie HTTP-only. El navegador no puede manipular la puntuación enviando posiciones. Los parámetros se validan en servidor. Hay límite de ocho contraseñas incorrectas de admin por dirección IP y ventana de diez minutos, capacidad máxima de 100 usuarios y limpieza automática de sesiones desconectadas.

### Limitaciones deliberadas

- El navegador usará **WebGL** cuando esté disponible; si no, utilizará un **renderizador 3D alternativo en Canvas 2D** (más lento, pero con cámara orbital y marcadores). Funciona sin Three.js ni dependencias externas.
- El estado se mantiene en una única instancia Node.js y no se distribuye entre varias réplicas.
- No hay registro permanente de usuarios, base de datos ni perfiles.
- Se trata de una demostración educativa, no de un sistema de autenticación empresarial o antitrampas avanzado.

**Licencia:** ejemplo de uso educativo; puede modificarse para prácticas y demostraciones.
