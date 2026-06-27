import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import fs from "fs/promises";
import path from "path";

// ───────────────────────── CONFIG ─────────────────────────
const CLINIC = {
  name: "BrightSmile Dental Clinic",
  address: "123 Main Street, Bandra West, Mumbai 400050",
  phone: "+91 98765 43210",
  hours: "Mon–Sat 9:00 AM – 8:00 PM | Sun 10:00 AM – 4:00 PM",
  email: "care@brightsmile.in",
};

const SERVICES = [
  { id: 1, name: "General Consultation", price: "₹500" },
  { id: 2, name: "Teeth Cleaning & Scaling", price: "₹1,500" },
  { id: 3, name: "Teeth Whitening", price: "₹8,000" },
  { id: 4, name: "Root Canal Treatment", price: "₹6,500" },
  { id: 5, name: "Dental Filling", price: "₹1,200" },
  { id: 6, name: "Tooth Extraction", price: "₹1,000" },
  { id: 7, name: "Braces Consultation", price: "₹800" },
  { id: 8, name: "Dental Implants", price: "₹25,000" },
];

const PRODUCTS = [
  { id: 1, name: "Premium Electric Toothbrush", price: "₹2,499" },
  { id: 2, name: "Whitening Toothpaste (Pack of 2)", price: "₹599" },
  { id: 3, name: "Antibacterial Mouthwash 500ml", price: "₹349" },
  { id: 4, name: "Dental Floss (Pack of 3)", price: "₹199" },
  { id: 5, name: "Sensitive-Teeth Relief Gel", price: "₹450" },
  { id: 6, name: "Custom Night Guard", price: "₹3,500" },
];

const DATA_DIR = "data";
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// in-memory conversation state, keyed by user JID
const sessions = new Map();

// ───────────────────────── STORAGE ─────────────────────────
async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const file of [BOOKINGS_FILE, ORDERS_FILE]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, "[]");
    }
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf-8"));
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function newId(prefix) {
  return (
    prefix +
    Date.now().toString().slice(-6) +
    Math.floor(Math.random() * 90 + 10)
  );
}

// ───────────────────────── MESSAGE TEMPLATES ─────────────────────────
function mainMenu() {
  return `🦷 *Welcome to ${CLINIC.name}* 🦷

I'm here to help you 24/7.

*How may I assist you today?*

*1.* 📅 Book an Appointment
*2.* 🛒 Buy Dental Products
*3.* 🔍 Check Appointment Status
*4.* ❌ Cancel an Appointment
*5.* 💉 Services & Pricing
*6.* 📍 Clinic Location & Hours
*7.* 👨‍⚕️ Talk to a Receptionist

_Reply with the number of your choice (1–7)._
_Type *menu* anytime to return here._`;
}

function servicesList() {
  let txt = `💉 *Our Services & Pricing*\n\n`;
  SERVICES.forEach((s) => {
    txt += `*${s.id}.* ${s.name} — ${s.price}\n`;
  });
  return txt;
}

function productsList() {
  let txt = `🛒 *Dental Care Products*\n\n`;
  PRODUCTS.forEach((p) => {
    txt += `*${p.id}.* ${p.name} — ${p.price}\n`;
  });
  txt += `\n_Reply with the product number to order, or *menu* to go back._`;
  return txt;
}

function bookingSummary(b) {
  return `📋 *Please Confirm Your Booking*

👤 *Name:* ${b.name}
💉 *Service:* ${b.service}
📅 *Date:* ${b.date}
⏰ *Time:* ${b.time}

Reply *yes* to confirm or *no* to cancel.`;
}

function clinicInfo() {
  return `📍 *${CLINIC.name}*

🏠 ${CLINIC.address}
📞 ${CLINIC.phone}
📧 ${CLINIC.email}
🕒 ${CLINIC.hours}

_Type *menu* to go back._`;
}

// ───────────────────────── VALIDATION ─────────────────────────
function isValidDate(s) {
  return /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(s.trim());
}

function isValidTime(s) {
  return /^\d{1,2}([:.]\d{2})?\s?(am|pm)?$/i.test(s.trim());
}

// ───────────────────────── MESSAGE HANDLER ─────────────────────────
async function send(sock, jid, text) {
  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {}
  await sock.sendMessage(jid, { text });
}

async function handleMessage(sock, jid, text) {
  const isNew = !sessions.has(jid);
  const session = sessions.get(jid) || { state: "MENU" };
  sessions.set(jid, session);

  // first-time greeting — always show the welcome
  if (isNew) {
    await send(sock, jid, mainMenu());
    return;
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // global keywords — reset to menu
  if (
    ["menu", "back", "hi", "hello", "hey", "start", "restart"].includes(lower)
  ) {
    session.state = "MENU";
    session.booking = undefined;
    session.product = undefined;
    await send(sock, jid, mainMenu());
    return;
  }

  switch (session.state) {
    case "MENU": {
      switch (lower) {
        case "1":
          session.state = "BOOK_NAME";
          session.booking = {};
          await send(
            sock,
            jid,
            `📅 *Book an Appointment*\n\nLet's get you booked in! 🦷\n\nFirst, what's your *full name*?`
          );
          break;
        case "2":
          session.state = "PRODUCT_PICK";
          await send(sock, jid, productsList());
          break;
        case "3":
          session.state = "STATUS_LOOKUP";
          await send(
            sock,
            jid,
            `🔍 *Check Appointment Status*\n\nPlease share your *Booking ID* (e.g., BK123456).`
          );
          break;
        case "4":
          session.state = "CANCEL_LOOKUP";
          await send(
            sock,
            jid,
            `❌ *Cancel an Appointment*\n\nPlease share your *Booking ID* (e.g., BK123456).`
          );
          break;
        case "5":
          await send(
            sock,
            jid,
            `${servicesList()}\n_Type *1* to book an appointment, or *menu* to go back._`
          );
          break;
        case "6":
          await send(sock, jid, clinicInfo());
          break;
        case "7":
          await send(
            sock,
            jid,
            `👨‍⚕️ *Talk to a Receptionist*\n\nOur team will reach out to you shortly. You can also call us directly at *${CLINIC.phone}*.\n\n_Type *menu* to go back._`
          );
          break;
        default:
          await send(
            sock,
            jid,
            `Sorry, I didn't catch that. Please reply with a number *1–7*, or type *menu* to see the options again.`
          );
      }
      break;
    }

    case "BOOK_NAME": {
      if (raw.length < 2) {
        await send(sock, jid, "Please share your full name to continue.");
        return;
      }
      session.booking.name = raw;
      session.state = "BOOK_SERVICE";
      const firstName = raw.split(" ")[0];
      await send(
        sock,
        jid,
        `Lovely to meet you, *${firstName}*! 🙌\n\n${servicesList()}\n_Reply with the service number (1–${SERVICES.length})._`
      );
      break;
    }

    case "BOOK_SERVICE": {
      const idx = parseInt(lower, 10);
      const svc = SERVICES.find((s) => s.id === idx);
      if (!svc) {
        await send(
          sock,
          jid,
          `Please pick a valid service number (1–${SERVICES.length}).`
        );
        return;
      }
      session.booking.service = `${svc.name} (${svc.price})`;
      session.state = "BOOK_DATE";
      await send(
        sock,
        jid,
        `Great choice! 👍\n\n📅 *Preferred date?*\n_Format: DD/MM or DD-MM-YYYY (e.g., 30/06 or 30-06-2026)._`
      );
      break;
    }

    case "BOOK_DATE": {
      if (!isValidDate(raw)) {
        await send(
          sock,
          jid,
          `Hmm, that didn't look right. Please use a format like *30/06* or *30-06-2026*.`
        );
        return;
      }
      session.booking.date = raw;
      session.state = "BOOK_TIME";
      await send(
        sock,
        jid,
        `⏰ *Preferred time?*\n_e.g., 11:00 AM, 4:30 PM. Our hours: ${CLINIC.hours}._`
      );
      break;
    }

    case "BOOK_TIME": {
      if (!isValidTime(raw)) {
        await send(
          sock,
          jid,
          `Please share a valid time like *11:00 AM* or *4:30 PM*.`
        );
        return;
      }
      session.booking.time = raw;
      session.state = "BOOK_CONFIRM";
      await send(sock, jid, bookingSummary(session.booking));
      break;
    }

    case "BOOK_CONFIRM": {
      if (["yes", "y", "confirm", "ok", "okay"].includes(lower)) {
        const bookings = await readJson(BOOKINGS_FILE);
        const id = newId("BK");
        const booking = {
          id,
          jid,
          ...session.booking,
          status: "Confirmed",
          createdAt: new Date().toISOString(),
        };
        bookings.push(booking);
        await writeJson(BOOKINGS_FILE, bookings);
        session.state = "MENU";
        session.booking = undefined;
        await send(
          sock,
          jid,
          `✅ *Appointment Confirmed!*

🎟️ *Booking ID:* ${id}
👤 ${booking.name}
💉 ${booking.service}
📅 ${booking.date}
⏰ ${booking.time}

We'll send a friendly reminder 24 hours before your visit. Please save your Booking ID — you can check status anytime by replying *3* on the menu.

_Type *menu* for more options._`
        );
      } else if (["no", "n", "cancel"].includes(lower)) {
        session.state = "MENU";
        session.booking = undefined;
        await send(
          sock,
          jid,
          `No problem — booking cancelled. Type *menu* to start over.`
        );
      } else {
        await send(
          sock,
          jid,
          `Please reply *yes* to confirm or *no* to cancel.`
        );
      }
      break;
    }

    case "PRODUCT_PICK": {
      const idx = parseInt(lower, 10);
      const prod = PRODUCTS.find((p) => p.id === idx);
      if (!prod) {
        await send(
          sock,
          jid,
          `Please pick a valid product number (1–${PRODUCTS.length}).`
        );
        return;
      }
      session.product = prod;
      session.state = "PRODUCT_CONFIRM";
      await send(
        sock,
        jid,
        `🛒 *Order Summary*

📦 ${prod.name}
💰 ${prod.price}
🚚 Delivery: 2–3 business days
💳 Payment: Cash on Delivery / UPI

Reply *yes* to place the order or *no* to cancel.`
      );
      break;
    }

    case "PRODUCT_CONFIRM": {
      if (["yes", "y", "confirm", "ok", "okay"].includes(lower)) {
        const orders = await readJson(ORDERS_FILE);
        const id = newId("OD");
        const order = {
          id,
          jid,
          item: session.product.name,
          price: session.product.price,
          status: "Placed",
          createdAt: new Date().toISOString(),
        };
        orders.push(order);
        await writeJson(ORDERS_FILE, orders);
        session.state = "MENU";
        session.product = undefined;
        await send(
          sock,
          jid,
          `✅ *Order Placed!*

🎟️ *Order ID:* ${id}
📦 ${order.item}
💰 ${order.price}
🚚 Delivery in 2–3 business days.

Our team will reach out to confirm your address shortly.

_Type *menu* to continue._`
        );
      } else if (["no", "n", "cancel"].includes(lower)) {
        session.state = "MENU";
        session.product = undefined;
        await send(
          sock,
          jid,
          `Order cancelled. Type *menu* to browse again.`
        );
      } else {
        await send(
          sock,
          jid,
          `Please reply *yes* to confirm or *no* to cancel.`
        );
      }
      break;
    }

    case "STATUS_LOOKUP": {
      const bid = raw.toUpperCase();
      const bookings = await readJson(BOOKINGS_FILE);
      const found = bookings.find((b) => b.id === bid);
      if (found) {
        await send(
          sock,
          jid,
          `🔎 *Booking Found*

🎟️ *ID:* ${found.id}
👤 ${found.name}
💉 ${found.service}
📅 ${found.date}
⏰ ${found.time}
📌 *Status:* ${found.status}

_Type *menu* to go back._`
        );
      } else {
        await send(
          sock,
          jid,
          `❌ No booking found for *${bid}*.\n\nDouble-check the ID, or type *menu* to go back.`
        );
      }
      session.state = "MENU";
      break;
    }

    case "CANCEL_LOOKUP": {
      const bid = raw.toUpperCase();
      const bookings = await readJson(BOOKINGS_FILE);
      const found = bookings.find((b) => b.id === bid);
      if (!found) {
        await send(
          sock,
          jid,
          `❌ No booking found for *${bid}*.\n\nDouble-check the ID, or type *menu* to go back.`
        );
        session.state = "MENU";
        return;
      }
      if (found.status === "Cancelled") {
        await send(
          sock,
          jid,
          `ℹ️ Booking *${bid}* is already cancelled.\n\n_Type *menu* to go back._`
        );
        session.state = "MENU";
        return;
      }
      session.cancelId = found.id;
      session.state = "CANCEL_CONFIRM";
      await send(
        sock,
        jid,
        `⚠️ *Confirm Cancellation*

🎟️ *ID:* ${found.id}
👤 ${found.name}
💉 ${found.service}
📅 ${found.date}
⏰ ${found.time}

Are you sure you want to cancel this appointment?
Reply *yes* to cancel or *no* to keep it.`
      );
      break;
    }

    case "CANCEL_CONFIRM": {
      if (["yes", "y", "confirm", "ok", "okay"].includes(lower)) {
        const bookings = await readJson(BOOKINGS_FILE);
        const idx = bookings.findIndex((b) => b.id === session.cancelId);
        if (idx === -1) {
          await send(
            sock,
            jid,
            `Something went wrong — booking not found. Type *menu* to go back.`
          );
        } else {
          bookings[idx].status = "Cancelled";
          bookings[idx].cancelledAt = new Date().toISOString();
          await writeJson(BOOKINGS_FILE, bookings);
          await send(
            sock,
            jid,
            `✅ *Appointment Cancelled*

🎟️ *Booking ID:* ${bookings[idx].id}
📌 *Status:* Cancelled

We're sorry to see you go — feel free to rebook anytime by replying *1* on the menu. 🦷

_Type *menu* for more options._`
          );
        }
        session.state = "MENU";
        session.cancelId = undefined;
      } else if (["no", "n"].includes(lower)) {
        session.state = "MENU";
        session.cancelId = undefined;
        await send(
          sock,
          jid,
          `Great — your appointment is still on. Type *menu* for more options.`
        );
      } else {
        await send(
          sock,
          jid,
          `Please reply *yes* to cancel or *no* to keep the appointment.`
        );
      }
      break;
    }

    default:
      session.state = "MENU";
      await send(sock, jid, mainMenu());
  }
}

// ───────────────────────── BAILEYS BOOTSTRAP (UNCHANGED INFRA) ─────────────────────────
async function start() {
  await ensureDataFiles();
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
      console.log(`🦷 ${CLINIC.name} bot is live!`);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const message of messages) {
      try {
        if (message.key.fromMe) continue;
        const jid = message.key.remoteJid;
        if (!jid || jid.endsWith("@g.us")) continue; // skip groups

        const body =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text ||
          message.message?.imageMessage?.caption ||
          "";

        if (!body) continue;

        await handleMessage(sock, jid, body);
      } catch (err) {
        console.error("Error handling message:", err);
      }
    }
  });
}

start();
