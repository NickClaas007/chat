// === Supabase Konfiguration ===
const SUPABASE_URL = "https://cnognczziitfzvnzcdmv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNub2duY3p6aWl0Znp2bnpjZG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3NjA5NzQsImV4cCI6MjA3OTMzNjk3NH0.RCbo1DPG7sHTeKoos3YXkN6-7E7C-irTJIK1eAKeTNI";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentChat = null;
let subscription = null;

// ---------------- LOGIN ----------------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUser").value;
  const password = document.getElementById("loginPass").value;

  // Hole User aus eigener Tabelle (nicht Supabase Auth)
  const { data, error } = await client
    .from("user")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data) {
    document.getElementById("loginStatus").textContent = "❌ Benutzer nicht gefunden.";
    return;
  }

  // Simple Passwortprüfung (achte in Produktion auf Hashing!)
  if (password !== data.password_hash) {
    document.getElementById("loginStatus").textContent = "❌ Passwort falsch.";
    return;
  }

  currentUser = data;
  localStorage.setItem("user_id", data.id);

  document.getElementById("loginStatus").textContent = "✅ Eingeloggt als " + username;
  document.getElementById("loginblock").style.display = "none";
  document.getElementById("chatblock").style.display = "block";
  document.getElementById("sidebar").style.display = "block";
  document.getElementById("main").style.display = "flex";

  loadChatList();
});

// ---------------- CHATLISTE LADEN ----------------
// Die Policies lassen alle registrierten User "Infos" und "Fragen" sehen.
// Andere Chats können optional per Members gefiltert werden (hier: alle anzeigen).
async function loadChatList() {
  const { data, error } = await client
    .from("chats")
    .select("id, name")
    .order("name");

  if (error) { console.error(error); return; }

  const list = document.getElementById("chatList");
  list.innerHTML = "";

  data.forEach(chat => {
    const li = document.createElement("li");
    li.textContent = chat.name;
    li.dataset.chat = chat.id;   // echte UUID
    list.appendChild(li);
  });

  // Optional: automatisch "Infos" auswählen, falls vorhanden
  const infosLi = Array.from(list.querySelectorAll("li")).find(li => li.textContent === "Infos");
  if (infosLi) {
    infosLi.click();
  }
}

// ---------------- CHAT WECHSEL ----------------
document.getElementById("chatList").addEventListener("click", (e) => {
  if (e.target.tagName === "LI") {
    currentChat = e.target.dataset.chat;
    loadMessages();
    subscribeToMessages(currentChat);

    // aktive Klasse setzen
    document.querySelectorAll("#chatList li").forEach(li => li.classList.remove("activeChat"));
    e.target.classList.add("activeChat");
  }
});

// ---------------- NACHRICHTEN LADEN ----------------
async function loadMessages() {
  if (!currentChat) return;
  const { data, error } = await client
    .from("messages")
    .select("id, time, message, user:user_id(username)")
    .eq("chat_id", currentChat)
    .order("time", { ascending: true });

  if (error) { console.error(error); return; }

  const container = document.getElementById("messages");
  container.innerHTML = "";

  data.forEach(row => appendMessage(row));
}

// ---------------- Nachricht ins DOM ----------------
function appendMessage(row) {
  const time = new Date(row.time).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  const username = row.user?.username ?? (row.user_id === currentUser?.id ? currentUser.username : "User");
  const line = document.createElement("div");
  line.textContent = `${time} ${username}: ${row.message}`;
  document.getElementById("messages").appendChild(line);
}

// ---------------- REALTIME ----------------
function subscribeToMessages(chatId) {
  if (subscription) client.removeChannel(subscription);

  subscription = client
    .channel('chat-room-' + chatId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => {
        // Direkt anhängen, damit Nachricht sofort sichtbar ist
        const row = payload.new;
        appendMessage(row);
      }
    )
    .subscribe();
}

// ---------------- NACHRICHT SENDEN ----------------
document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || !currentChat) {
    document.getElementById("chatStatus").textContent = "❌ Bitte zuerst einloggen und Chat auswählen.";
    return;
  }

  const msgInput = document.getElementById("chatMessage");
  const msg = msgInput.value.trim();
  if (!msg) return;

  const payload = { message: msg, user_id: currentUser.id, chat_id: currentChat };
  const { error } = await client.from("messages").insert(payload);

  if (error) {
    // Policies liefern hier sinnvolle Fehler (z.B. keine Schreibrechte in Infos)
    document.getElementById("chatStatus").textContent = "❌ Fehler: " + error.message;
  } else {
    msgInput.value = "";
    document.getElementById("chatStatus").textContent = "";
    // appendMessage passiert durch Realtime automatisch
  }
});

// ---------------- CREATE CHAT POPUP ----------------
document.getElementById("createChatBtn").addEventListener("click", () => {
  document.getElementById("createChatPopup").style.display = "block";
});

document.getElementById("addUserBtn").addEventListener("click", (e) => {
  e.preventDefault();
  const div = document.createElement("div");
  div.innerHTML = `<input type="text" class="usernameInput" placeholder="Username eingeben">`;
  document.getElementById("userInputs").appendChild(div);
});

document.getElementById("confirmCreateChatBtn").addEventListener("click", async () => {
  const usernames = Array.from(document.querySelectorAll(".usernameInput"))
    .map(input => input.value.trim())
    .filter(v => v !== "");

  if (usernames.length === 0) {
    alert("Bitte mindestens einen User eingeben!");
    return;
  }

  const chatName = usernames.join(", ");

  // Chat erstellen
  const { data: chatData, error: chatErr } = await client
    .from("chats")
    .insert({ name: chatName })
    .select();

  if (chatErr || !chatData || chatData.length === 0) {
    console.error(chatErr);
    alert("Fehler beim Erstellen des Chats");
    return;
  }

  const newChatId = chatData[0].id;

  // Admin (id=1) automatisch als Mitglied hinzufügen (für andere Chats-Policies)
  await client.from("members").insert({ chat_id: newChatId, user_id: 1 });

  // Alle angegebenen User hinzufügen (sofern in user vorhanden)
  for (const uname of usernames) {
    const { data: u } = await client.from("user").select("id").eq("username", uname).single();
    if (u?.id) {
      await client.from("members").insert({ chat_id: newChatId, user_id: u.id });
    }
  }

  // Sidebar neu laden
  await loadChatList();

  // Popup schließen
  document.getElementById("createChatPopup").style.display = "none";
});

// ---------------- INITIALISIERUNG NACH RELOAD ----------------
window.addEventListener("DOMContentLoaded", async () => {
  const storedUserId = localStorage.getItem("user_id");
  if (!storedUserId) return;

  // Versuche den User erneut zu laden
  const { data, error } = await client.from("user").select("*").eq("id", storedUserId).single();
  if (error || !data) return;

  currentUser = data;
  document.getElementById("loginblock").style.display = "none";
  document.getElementById("chatblock").style.display = "block";
  document.getElementById("sidebar").style.display = "block";
  document.getElementById("main").style.display = "flex";

  loadChatList();
});
