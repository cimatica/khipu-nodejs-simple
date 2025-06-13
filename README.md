# Khipu Integration
- Este es un proyecto de prueba para realizar una integracion de la API de Khipu en modo desarrollador utilizando Node.js.

## package.json
- Achivo que define el proyecto Node.js y sus dependencias
- Para instalar las dependencias, ejecutar: npm install
- "axios": "^1.7.2",       // Para hacer solicitudes HTTP a Khipu
- "body-parser": "^1.20.2",// Para parsear el cuerpo de las solicitudes POST (ej. webhooks)
- "dotenv": "^16.4.5",     // Para cargar variables de entorno desde un archivo .env
- "express": "^4.19.2"     // El framework web para Node.js

# server.js
- Archivo principal de la aplicación Node.js con Express.js
- Contiene la lógica del servidor, las rutas y la interacción con la API de Khipu

## index.html
- Página principal que muestra un formulario con un botón de pago
- El usuario ingresa un monto y una descripción para el pago
- Contiene JavaScript para manejar los mensajes flash (temporales)

## success.html
- Página que se muestra al usuario después de un pago exitoso en Khipu

## cancel.html
- Página que se muestra al usuario si el pago en Khipu es cancelado

## style.css
- Estilos básicos para la interfaz web


