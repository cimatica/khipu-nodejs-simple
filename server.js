// Archivo principal de la aplicación Node.js con Express.js.
// Contiene la lógica del servidor, las rutas y la interacción con la API de Khipu.

// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser'); // Para parsear cuerpos de solicitudes POST
const axios = require('axios');             // Cliente HTTP para hacer solicitudes
const crypto = require('crypto');           // Módulo para criptografía (HMAC)
const path = require('path');               // Para trabajar con rutas de archivos

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuración de Khipu desde variables de entorno ---
const KHIPU_RECEIVER_ID = process.env.KHIPU_RECEIVER_ID;
const KHIPU_SECRET = process.env.KHIPU_SECRET;
const KHIPU_API_BASE_URL = "https://khipu.com/api/2.0"; // URL de la API de Khipu para entorno de pruebas
const NGROK_PUBLIC_URL = process.env.NGROK_PUBLIC_URL || `http://localhost:${PORT}`; // Tu URL pública para callbacks

// Verificar que las credenciales de Khipu estén configuradas
if (!KHIPU_RECEIVER_ID || !KHIPU_SECRET) {
    console.error("ERROR: Las variables de entorno KHIPU_RECEIVER_ID y KHIPU_SECRET deben estar configuradas en el archivo .env");
    process.exit(1); // Sale de la aplicación si no hay credenciales
}
if (!NGROK_PUBLIC_URL) {
    console.warn("ADVERTENCIA: NGROK_PUBLIC_URL no está configurada. Las notificaciones de Khipu (webhooks) no funcionarán correctamente en tu entorno local.");
}

// --- Middleware de Express ---
// Sirve archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));
// Parsear solicitudes con body en formato x-www-form-urlencoded (Khipu webhooks)
app.use(bodyParser.urlencoded({ extended: true }));
// Parsear solicitudes con body en formato JSON (si lo necesitaras en el futuro)
app.use(bodyParser.json());

// --- Función auxiliar para URL-encoding compatible con Khipu ---
// Esta función codifica un string para usarlo en un cuerpo de solicitud x-www-form-urlencoded
// o en la cadena a firmar, asegurando que los espacios sean '+' y no '%20',
// y que otros caracteres se codifiquen como `encodeURIComponent`.
function khipuUrlEncode(str) {
    // Asegura que el valor sea una cadena
    let s = String(str);
    // Usa encodeURIComponent para la mayoría de la codificación
    // y luego reemplaza '%20' por '+' para los espacios, como Khipu espera.
    return encodeURIComponent(s).replace(/%20/g, '+');
}

// --- Función para generar la firma HMAC de Khipu ---
function generateKhipuSignature(params, secret) {
    // 1. Ordenar los parámetros alfabéticamente por nombre de clave.
    const sortedKeys = Object.keys(params).sort();

    // 2. Construir la cadena de datos a firmar.
    //    Cada par clave=valor se une con '&'. Los valores se codifican con khipuUrlEncode.
    //    Importante: 'hash' no se incluye en la cadena para la firma.
    let dataToSign = [];
    for (const key of sortedKeys) {
        if (key === 'hash') { // 'hash' no se incluye en la cadena para la firma
            continue;
        }
        let value = params[key];
        // Los valores booleanos se serializan a 'true' o 'false' en minúsculas
        if (typeof value === 'boolean') {
            value = String(value).toLowerCase();
        } else if (value === null || value === undefined) {
            value = ""; // Los valores nulos/indefinidos se tratan como cadena vacía
        }
        // Codificar el valor usando la función khipuUrlEncode
        dataToSign.push(`${key}=${khipuUrlEncode(value)}`);
    }

    const signedDataString = dataToSign.join('&');
    
    console.log("String a firmar (signedDataString):", signedDataString); // Debugging
    
    // 3. Calcular el HMAC-SHA256.
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(signedDataString);
    const generatedHash = hmac.digest('hex'); // Retorna el digest en formato hexadecimal
    
    console.log("Hash HMAC generado (generatedHash):", generatedHash); // Debugging
    return generatedHash;
}

// --- Rutas de la Aplicación ---

// Ruta principal: sirve el index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para crear un pago en Khipu
app.post('/create_payment', async (req, res) => {
    const { subject, amount: amountStr } = req.body;

    if (!subject || !amountStr) {
        console.error("Error: Falta descripción o monto para el pago.");
        return res.redirect('/?message=Error: descripción o monto faltante&type=error');
    }

    let amount;
    try {
        amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
            throw new Error("El monto debe ser un número positivo.");
        }
        if (amount > 5000) { // Límite de DemoBank
            console.warn("Advertencia: Monto excede el límite de DemoBank ($5.000 CLP).");
            return res.redirect('/?message=El monto máximo para DemoBank es $5.000 CLP. Por favor, ingresa un monto menor.&type=warning');
        }
    } catch (error) {
        console.error("Error al parsear el monto:", error.message);
        return res.redirect(`/?message=Error: ${error.message}&type=error`);
    }

    console.log(`Intentando crear pago: ${subject}, $${amount} CLP`);

    // Definir las URLs de retorno, cancelación y notificación
    const returnUrl = `${NGROK_PUBLIC_URL}/khipu/success`;
    const cancelUrl = `${NGROK_PUBLIC_URL}/khipu/cancel`;
    const notifyUrl = `${NGROK_PUBLIC_URL}/khipu/notify`;

    const payload = {
        receiver_id: KHIPU_RECEIVER_ID,
        subject: subject,
        currency: "CLP",
        // Asegura que el monto se envía con dos decimales, como cadena.
        amount: amount.toFixed(2), 
        return_url: returnUrl,
        cancel_url: cancelUrl,
        notify_url: notifyUrl,
        // Un ID único para tu sistema; puede ser algo más robusto en producción
        transaction_id: `ORDER_${crypto.createHash('md5').update(subject + Date.now()).digest('hex').substring(0, 8)}`,
        body: `Pago por ${subject} de $${amount} CLP`,
        bank_id: "demobank" // Usar "demobank" para el entorno de pruebas de Khipu
    };

    console.log("Payload antes de firmar:", JSON.stringify(payload, null, 2)); // Debugging

    // Generar la firma HMAC para el payload.
    // Khipu requiere que la firma se agregue al payload antes de enviar.
    payload.hash = generateKhipuSignature(payload, KHIPU_SECRET);

    // Construir el payload codificado para la solicitud POST,
    // asegurando que cada valor se codifique con khipuUrlEncode
    const encodedPayloadParts = [];
    const sortedPayloadKeys = Object.keys(payload).sort(); // Khipu espera orden alfabético incluso en el envío
    for (const key of sortedPayloadKeys) {
        encodedPayloadParts.push(`${key}=${khipuUrlEncode(payload[key])}`);
    }
    const encodedPayload = encodedPayloadParts.join('&');

    console.log("Payload codificado para envío (encodedPayload):", encodedPayload); // Debugging

    try {
        const response = await axios.post(`${KHIPU_API_BASE_URL}/payments`, encodedPayload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        });

        const khipuResponse = response.data;
        console.log("Respuesta de Khipu (éxito):", khipuResponse);

        if (khipuResponse && khipuResponse.khipu_url) {
            // Redirigir al usuario a la URL de Khipu para completar el pago
            res.redirect(khipuResponse.khipu_url);
        } else {
            console.error("Error: Khipu no devolvió una URL de pago válida.", khipuResponse);
            res.redirect('/?message=Error al iniciar el pago con Khipu. Por favor, intenta de nuevo.&type=error');
        }
    } catch (error) {
        console.error("Error al conectar con la API de Khipu:", error.message);
        if (error.response) {
            console.error("Respuesta de error de Khipu:", error.response.data);
            // Mostrar el mensaje de error de Khipu si está disponible
            res.redirect(`/?message=Error al conectar con Khipu: ${error.response.data.message || error.response.statusText}&type=error`);
        } else {
            res.redirect(`/?message=Error de red o desconocido: ${error.message}&type=error`);
        }
    }
});

// Ruta de retorno para un pago exitoso
app.get('/khipu/success', (req, res) => {
    const paymentId = req.query.payment_id || 'N/A';
    console.log(`Redirigido a /khipu/success para payment_id: ${paymentId}`);
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Ruta de retorno para un pago cancelado
app.get('/khipu/cancel', (req, res) => {
    const paymentId = req.query.payment_id || 'N/A';
    console.log(`Redirigido a /khipu/cancel para payment_id: ${paymentId}`);
    res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// Ruta para recibir notificaciones (webhooks) de Khipu
app.post('/khipu/notify', (req, res) => {
    const notificationParams = req.body; // body-parser ya ha parseado esto
    console.log("Notificación de Khipu recibida:", notificationParams);

    if (!notificationParams || !notificationParams.hash) {
        console.warn("Notificación de Khipu inválida o sin hash.");
        return res.status(400).send("Bad Request: Missing hash or parameters");
    }

    // Verificar la firma de la notificación para asegurar que proviene de Khipu
    const receivedHash = notificationParams.hash;
    // Crea una copia de los parámetros y elimina el 'hash' para generar la firma.
    const paramsForSignature = { ...notificationParams };
    delete paramsForSignature.hash;

    const calculatedHash = generateKhipuSignature(paramsForSignature, KHIPU_SECRET);

    if (calculatedHash === receivedHash) {
        console.log(`Firma de notificación verificada con éxito para payment_id: ${notificationParams.payment_id}`);
        // La notificación es válida. Ahora procesa el estado del pago.
        const paymentId = notificationParams.payment_id;
        const status = notificationParams.status;

        // --- Aquí es donde actualizarías tu base de datos o sistema interno ---
        // Por ejemplo:
        if (status === 'done') {
            console.log(`El pago ${paymentId} ha sido completado exitosamente.`);
            // Lógica para marcar el pedido como pagado en tu sistema
        } else if (status === 'reversed') {
            console.log(`El pago ${paymentId} ha sido revertido.`);
            // Lógica para revertir el pedido en tu sistema
        } else {
            console.log(`El pago ${paymentId} tiene el estado: ${status}.`);
            // Lógica para otros estados (pending, failed, etc.)
        }
        // ----------------------------------------------------------------------

        // Khipu espera una respuesta HTTP 200 OK para confirmar que la notificación fue recibida.
        return res.status(200).send("Notification received and processed");
    } else {
        console.error("Firma de notificación de Khipu inválida.");
        console.error(`Calculado: ${calculatedHash}, Recibido: ${receivedHash}`);
        return res.status(401).send("Unauthorized: Invalid Khipu signature");
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor Express.js iniciado en el puerto ${PORT}`);
    console.log(`Abre tu navegador en: http://localhost:${PORT}`);
    console.log(`Para notificaciones Khipu, asegúrate de que NGROK_PUBLIC_URL (${NGROK_PUBLIC_URL}) sea una URL pública si estás en desarrollo local.`);
});