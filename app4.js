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

  const { data, error } = await client
    .from("users")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data) {
    document.getElementById("loginStatus").textContent = "❌ Benutzer nicht gefunden.";
    return;
  }

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
async function loadChatList() {
  const { data, error } = await client
    .from("chats")
    .select("id, name")
    .order("name");

  if (error) { console.error("ChatList Error:", error.message); return; }

  const list = document.getElementById("chatList");
  list.innerHTML = "";

  data.forEach(chat => {
    const li = document.createElement("li");
    li.textContent = chat.name;
    li.dataset.chat = chat.id;
    list.appendChild(li);
  });
}

// ---------------- CHAT WECHSEL ----------------
document.getElementById("chatList").addEventListener("click", (e) => {
  if (e.target.tagName === "LI") {
    currentChat = e.target.dataset.chat;
    loadMessages();
    subscribeToMessages(currentChat);

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

  if (error) { console.error("LoadMessages Error:", error.message); return; }

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
  const username = row.user?.username ?? "User";
  const line = document.createElement("div");
  line.textContent = `${time} ${username}: ${row.message}`;
  document.getElementById("messages").appendChild(line);
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
    document.getElementById("chatStatus").textContent = "❌ Fehler: " + error.message;
  } else {
    msgInput.value = "";
    document.getElementById("chatStatus").textContent = "";
  }
  loadChatList();
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

  const { data: chatData, error: chatErr } = await client
    .from("chats")
    .insert({ name: chatName })
    .select();

  if (chatErr || !chatData || chatData.length === 0) {
    console.error("Chat Insert Error:", chatErr?.message);
    alert("Fehler beim Erstellen des Chats: " + (chatErr?.message ?? "unbekannt"));
    return;
  }

  const newChatId = chatData[0].id;

  // Admin (id=1) automatisch hinzufügen
  const { error: memberErr1 } = await client.from("members").insert({ chat_id: newChatId, user_id: 1 });
  if (memberErr1) console.error("Member Insert Error (Admin):", memberErr1.message);

  // Alle angegebenen User hinzufügen
  for (const uname of usernames) {
    const { data: u, error: uErr } = await client.from("users").select("id").ilike("username", uname).single();
    if (uErr) {
      console.error("User Lookup Error:", uErr.message);
      continue;
    }
    if (u?.id) {
      const { error: memberErr2 } = await client.from("members").insert({ chat_id: newChatId, user_id: u.id });
      if (memberErr2) console.error("Member Insert Error:", memberErr2.message);
    }
  }

  await loadChatList();
  document.getElementById("createChatPopup").style.display = "none";
});

// ---------------- AUTO-LOGIN NACH RELOAD ----------------
window.addEventListener("DOMContentLoaded", async () => {
  const storedUserId = localStorage.getItem("user_id");
  if (!storedUserId) return;

  const { data, error } = await client.from("users").select("*").eq("id", storedUserId).single();
  if (error || !data) return;

  currentUser = data;
  document.getElementById("loginblock").style.display = "none";
  document.getElementById("chatblock").style.display = "flex";
  document.getElementById("sidebar").style.display = "block";
  document.getElementById("main").style.display = "flex";

  loadChatList();
});

// ---------------- AUTO-REFRESH alle 500ms ----------------
setInterval(() => {
  if (currentChat) {
    loadMessages();
  }
}, 500);
