import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(await QRCode.toString(qr, { type: "terminal" }));
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode !==
            DisconnectReason.loggedOut
          : true;

      console.log("Connection closed. Reconnecting...", shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => {
          start();
        }, 5000);
      }
    } else if (connection === "open") {
      console.log("✅ Baileys client connected successfully!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type === "notify") {
      for (const message of messages) {
        const specificID = message.key.remoteJidAlt;
        if (specificID == "917014405433@s.whatsapp.net") {
          const body = message.message.conversation;
          const id = message.key.remoteJid;
          let templateMessage = "";
          if (body.toLowerCase() == "") {
            templateMessage = "";
          } else {
            templateMessage =
              "Hi, how can i help you today? Mention the required service - ";
          }
          setTimeout(async () => {
            await sock.sendMessage(id, { text: templateMessage });
          }, 10000);
        }
      }
    }
  });
}

start();
