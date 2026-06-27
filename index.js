import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";

// in-memory booking sessions — keyed by user JID
const bookingSessions = new Map();

const newBookingId = () =>
  "BK" + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);

const SERVICES_MAP = {
  1: "General Consultation (₹500)",
  2: "Teeth Cleaning & Scaling (₹1,500)",
  3: "Teeth Whitening (₹8,000)",
  4: "Root Canal Treatment (₹6,500)",
  5: "Dental Filling (₹1,200)",
  6: "Tooth Extraction (₹1,000)",
  7: "Braces Consultation (₹800)",
  8: "Dental Implants (₹25,000)",
};

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
          const rawBody =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            "";
          const body = rawBody.toLowerCase().trim();
          const id = message.key.remoteJid;

          // ───────────────────────── TEMPLATE MESSAGES ─────────────────────────
          const WELCOME = `🦷 *Welcome to BrightSmile Dental Clinic*

I'm here to help you 24/7.

Reply with a *number* or *keyword*:

1. 📅Book an appointment
2. ❌Cancel an appointment
3. 💉View services & pricing
4. 🛒Browse dental products
5. 📍Clinic address & hours

📞 Or call us directly at +91 98765 43210`;

          const CANCEL = `❌ *Cancel an Appointment*

We're sorry to see you go. To cancel, please share:

🎟️ Your *Booking ID* (e.g., BK123456)
   _OR_
📞 The *phone number* used for booking

Our team will confirm the cancellation within 15 minutes.

💡 *Refund Policy:* Cancellations made 24+ hours in advance are eligible for a full refund (if prepaid).

Want to reschedule instead? Just reply *book* with your existing Booking ID.`;

          const SERVICES = `💉 *Our Services & Pricing*

1. General Consultation — *₹500* (30 min)
2. Teeth Cleaning & Scaling — *₹1,500* (45 min)
3. Teeth Whitening — *₹8,000* (60 min)
4. Root Canal Treatment — *₹6,500* (90 min)
5. Dental Filling — *₹1,200* (30 min)
6. Tooth Extraction — *₹1,000* (30 min)
7. Braces Consultation — *₹800* (45 min)
8. Dental Implants — *₹25,000* (multiple visits)

✨ All procedures performed by certified specialists.
🏥 State-of-the-art sterilization & equipment.

To book any service, reply *book*.
For premium packages, call +91 98765 43210.`;

          const PRODUCTS = `🛒 *Dental Care Products*

1. Premium Electric Toothbrush — *₹2,499*
2. Whitening Toothpaste (Pack of 2) — *₹599*
3. Antibacterial Mouthwash 500ml — *₹349*
4. Dental Floss (Pack of 3) — *₹199*
5. Sensitive-Teeth Relief Gel — *₹450*
6. Custom Night Guard — *₹3,500*

🚚 Free delivery on orders above ₹999
💳 Cash on Delivery / UPI / Card accepted
📦 Delivered within 2–3 business days

To order, reply with the *product number(s)* and your *delivery address*.`;

          const LOCATION = `📍 *BrightSmile Dental Clinic*

🏠 123 Main Street, Bandra West, Mumbai 400050
📞 +91 98765 43210
📧 care@brightsmile.in

🕒 *Clinic Hours*
   Mon–Sat: 9:00 AM – 8:00 PM
   Sun:     10:00 AM – 4:00 PM

🚗 Free parking available
♿ Wheelchair accessible
🚇 5 min walk from Bandra Station`;

          // ───────────────────────── BOOKING FLOW ─────────────────────────
          const session = bookingSessions.get(id);

          // global escape — abandons a mid-flow booking
          if (
            session &&
            ["exit", "menu", "stop", "abort", "quit"].includes(body)
          ) {
            bookingSessions.delete(id);
            await sock.sendMessage(id, {
              text: `Booking cancelled. ${WELCOME}`,
            });
            continue;
          }

          if (session) {
            if (session.step === "name") {
              session.name = rawBody.trim();
              session.step = "service";
              await sock.sendMessage(id, {
                text: `Lovely to meet you, *${session.name.split(" ")[0]}*! 🙌

Which service would you like to book?

1. General Consultation — ₹500
2. Teeth Cleaning & Scaling — ₹1,500
3. Teeth Whitening — ₹8,000
4. Root Canal Treatment — ₹6,500
5. Dental Filling — ₹1,200
6. Tooth Extraction — ₹1,000
7. Braces Consultation — ₹800
8. Dental Implants — ₹25,000

_Reply with the service number (1–8) or type the service name._`,
              });
              continue;
            }

            if (session.step === "service") {
              const num = parseInt(body, 10);
              session.service = SERVICES_MAP[num] || rawBody.trim();
              session.step = "datetime";
              await sock.sendMessage(id, {
                text: `Great choice! ✅
You've selected: *${session.service}*

📅 *When would you like to visit?*
Please share your preferred *date and time*.

_e.g., 30 June, 11:00 AM_
_or:   Tomorrow at 4:30 PM_`,
              });
              continue;
            }

            if (session.step === "datetime") {
              session.datetime = rawBody.trim();
              session.step = "phone";
              await sock.sendMessage(id, {
                text: `📞 *Almost there!*

Please share your *contact number* so we can send confirmation and reminders.

_e.g., +91 98765 43210_`,
              });
              continue;
            }

            if (session.step === "phone") {
              session.phone = rawBody.trim();
              const bookingId = newBookingId();
              bookingSessions.delete(id);
              await sock.sendMessage(id, {
                text: `✅ *Appointment Confirmed!* 🦷

🎟️ *Booking ID:* ${bookingId}
👤 *Name:* ${session.name}
💉 *Service:* ${session.service}
📅 *Date & Time:* ${session.datetime}
📞 *Contact:* ${session.phone}

━━━━━━━━━━━━━━━━━━━━
We've sent your booking to our front-desk team. You'll receive a confirmation call within 15 minutes (during clinic hours).

💡 *Save your Booking ID* — you'll need it to reschedule or cancel.

🔔 We'll send a reminder 24 hours before your visit.

Thank you for choosing BrightSmile! 😊
📍 ${`123 Main Street, Bandra West, Mumbai`}
📞 +91 98765 43210`,
              });
              continue;
            }
          }

          // ───────────────────────── KEYWORD / NUMBER ROUTING ─────────────────────────
          let templateMessage = WELCOME;
          if (body === "1" || body.includes("book")) {
            // start the booking flow
            bookingSessions.set(id, { step: "name" });
            templateMessage = `📅 *Book an Appointment*

Wonderful! Let's get you booked in. 🦷

To start, please share your *full name*.

_Type *exit* anytime to cancel._`;
          } else if (body === "2" || body.includes("cancel"))
            templateMessage = CANCEL;
          else if (
            body === "3" ||
            body.includes("service") ||
            body.includes("price")
          )
            templateMessage = SERVICES;
          else if (body === "4" || body.includes("product"))
            templateMessage = PRODUCTS;
          else if (
            body === "5" ||
            body.includes("location") ||
            body.includes("address") ||
            body.includes("hour")
          )
            templateMessage = LOCATION;

          setTimeout(async () => {
            await sock.sendMessage(id, { text: templateMessage });
          }, 3000);
        }
      }
    }
  });
}

start();
