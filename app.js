// === Supabase Konfiguration ===
const SUPABASE_URL = "https://cnognczziitfzvnzcdmv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzYSIsInJlZiI6ImNub2duY3p6aWl0Znp2cnpjZG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3NjA5NzQsImV4cCI6MjA3OTMzNjk3NH0.RCbo1DPG7sHTeKoos3YXkN6-7E7C-irTJIK1eAKeTNI";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentChat = null;

// ---------------- Funktion: current_user setzen für RLS ----------------
async function setCurrentUser(userId) {
  await client.rpc('set_current_user', { user_id: userId });
}

// ---------------- LOGIN ----------------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;

  console.log("Login-Versuch für User:", username);

  const { data, error } = await client
    .from("users")
    .select("*")
    .ilike("username", username) // case-insensitive
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
  await setCurrentUser(currentUser.id); // RLS korrekt setzen
  showChatUI();
  loadChatList();
});

function showChatUI() {
  document.getElementById("loginStatus").textContent = "✅ Eingeloggt als " + currentUser.username;
  document.getElementById("loginblock").style.display = "none";
  document.getElementById("chatblock").style.display = "block";
  document.getElementById("sidebar").style.display = "block";
  document.getElementById("main").style.display = "flex";
}

// ---------------- CHATLISTE LADEN ----------------
async function loadChatList() {
  if (!currentUser) return;

  const { data, error } = await client
    .from("members")
    .select("chat_id, chats(name)")
    .eq("user_id", currentUser.id)
    .order("chat_id");

  if (error) { console.error(error); return; }

  let visibleChats = data.map(m => ({ id: m.chat_id, name: m.chats.name }));

  // Admin sieht alle Chats
  if (currentUser.is_admin) {
    const { data: allChats } = await client.from("chats").select("id, name");
    visibleChats = allChats;
  }

  const list = document.getElementById("chatList");
  list.innerHTML = "";

  visibleChats.forEach(chat => {
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

    document.querySelectorAll("#chatList li").forEach(li => li.classList.remove("activeChat"));
    e.target.classList.add("activeChat");
  }
});

// ---------------- NACHRICHTEN LADEN ----------------
async function loadMessages() {
  if (!currentChat) return;

  const { data, error } = await client
    .from("messages")
    .select("id, created_at, content, user:user_id(username)")
    .eq("chat_id", currentChat)
    .order("created_at", { ascending: true });

  if (error) { console.error(error); return; }

  const container = document.getElementById("messages");
  container.innerHTML = "";

  data.forEach(row => appendMessage(row));
}

// ---------------- Nachricht ins DOM ----------------
function appendMessage(row) {
  const time = new Date(row.created_at).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  const username = row.user?.username ?? "User";
  const line = document.createElement("div");
  line.textContent = `${time} ${username}: ${row.content}`;
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

  const payload = { content: msg, user_id: currentUser.id, chat_id: currentChat };
  const { error } = await client.from("messages").insert(payload);

  if (error) {
    document.getElementById("chatStatus").textContent = "❌ Keine Berechtigung oder Fehler: " + error.message;
  } else {
    msgInput.value = "";
    document.getElementById("chatStatus").textContent = "";
    loadMessages();
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

  // Admin automatisch hinzufügen
  await client.from("members").insert({ chat_id: newChatId, user_id: 1 });

  // Alle angegebenen User hinzufügen
  for (const uname of usernames) {
    const { data: u } = await client.from("users").select("id").ilike("username", uname).single();
    if (u?.id) {
      await client.from("members").insert({ chat_id: newChatId, user_id: u.id });
    }
  }

  await loadChatList();
  document.getElementById("createChatPopup").style.display = "none";
});

// ---------------- AUTO-REFRESH alle 500ms ----------------
setInterval(() => {
  if (currentChat) {
    loadMessages();
  }
}, 500);
