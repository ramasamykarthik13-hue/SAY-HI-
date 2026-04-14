// ===================== FIREBASE SETUP =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  onValue,
  off,
  serverTimestamp,
  query,
  orderByChild
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ===================== FIREBASE CONFIG =====================
const firebaseConfig = {
  apiKey: "AIzaSyCy5BpI0KalmsAF71wW7v4rrKcuskmfixU",
  authDomain: "chat-app-2bc12.firebaseapp.com",
  databaseURL: "https://chat-app-2bc12-default-rtdb.firebaseio.com",
  projectId: "chat-app-2bc12",
  storageBucket: "chat-app-2bc12.firebasestorage.app",
  messagingSenderId: "279475099895",
  appId: "1:279475099895:web:bdcbed6f85265a57919bf2",
  measurementId: "G-47TJP6RB24"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===================== STATE =====================
let currentUser = null;     // { userId, username }
let activeChatId = null;
let activeOtherUser = null; // { userId, username }
let messagesListener = null;
let chatListListener = null;

// ===================== DOM REFS =====================
const authScreen        = document.getElementById("authScreen");
const appEl             = document.getElementById("app");
const usernameInput     = document.getElementById("usernameInput");
const passwordInput     = document.getElementById("passwordInput");
const loginBtn          = document.getElementById("loginBtn");
const signupBtn         = document.getElementById("signupBtn");
const authError         = document.getElementById("authError");
const currentUsernameEl = document.getElementById("currentUsername");
const currentUserAvatar = document.getElementById("currentUserAvatar");
const logoutBtn         = document.getElementById("logoutBtn");
const searchInput       = document.getElementById("searchInput");
const searchResults     = document.getElementById("searchResults");
const chatList          = document.getElementById("chatList");
const emptyState        = document.getElementById("emptyState");
const chatHeader        = document.getElementById("chatHeader");
const chatHeaderAvatar  = document.getElementById("chatHeaderAvatar");
const chatHeaderName    = document.getElementById("chatHeaderName");
const messagesEl        = document.getElementById("messages");
const messageInputArea  = document.getElementById("messageInputArea");
const messageInput      = document.getElementById("messageInput");
const sendBtn           = document.getElementById("sendBtn");
const backBtn           = document.getElementById("backBtn");
const sidebarEl         = document.getElementById("sidebar");
const chatWindowEl      = document.getElementById("chatWindow");
const sidebarOverlay    = document.getElementById("sidebarOverlay");

// ===================== MOBILE NAV HELPERS =====================
function isMobile() {
  return window.innerWidth < 992;
}

function showChatPanel() {
  if (!isMobile()) return;
  sidebarEl.classList.add("sidebar-hidden");
  chatWindowEl.classList.add("chat-open");
  // iPad overlay
  if (sidebarOverlay) {
    sidebarOverlay.classList.remove("visible");
  }
}

function showSidebarPanel() {
  if (!isMobile()) return;
  sidebarEl.classList.remove("sidebar-hidden");
  chatWindowEl.classList.remove("chat-open");
}

// On resize back to desktop — reset panel states
window.addEventListener("resize", () => {
  if (!isMobile()) {
    sidebarEl.classList.remove("sidebar-hidden");
    chatWindowEl.classList.remove("chat-open");
    if (sidebarOverlay) sidebarOverlay.classList.remove("visible");
  }
});

// ===================== HELPERS =====================
function showError(msg) {
  authError.textContent = msg;
  setTimeout(() => authError.textContent = "", 3500);
}

function getInitial(name) {
  return name ? name[0].toUpperCase() : "?";
}

function setAvatar(el, username) {
  el.textContent = getInitial(username);
  const colors = [
    "linear-gradient(135deg,#f59e0b,#fb923c)",
    "linear-gradient(135deg,#ef4444,#f97316)",
    "linear-gradient(135deg,#10b981,#34d399)",
    "linear-gradient(135deg,#38bdf8,#818cf8)",
    "linear-gradient(135deg,#a855f7,#ec4899)",
  ];
  const idx = username ? username.charCodeAt(0) % colors.length : 0;
  el.style.background = colors[idx];
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function showApp() {
  authScreen.style.display = "none";
  appEl.style.display = "flex";
  currentUsernameEl.textContent = currentUser.username;
  setAvatar(currentUserAvatar, currentUser.username);
  loadChatList();
}

function showAuth() {
  authScreen.style.display = "flex";
  appEl.style.display = "none";
}

// ===================== SESSION =====================
function saveSession(userId, username) {
  localStorage.setItem("sayhi_userId", userId);
  localStorage.setItem("sayhi_username", username);
}

function clearSession() {
  localStorage.removeItem("sayhi_userId");
  localStorage.removeItem("sayhi_username");
}

function loadSession() {
  const userId = localStorage.getItem("sayhi_userId");
  const username = localStorage.getItem("sayhi_username");
  if (userId && username) {
    currentUser = { userId, username };
    showApp();
  }
}

// ===================== AUTH: SIGN UP =====================
async function handleSignup() {
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!username || !password) return showError("Please fill in all fields.");
  if (username.length < 3) return showError("Username must be at least 3 characters.");
  if (password.length < 4) return showError("Password must be at least 4 characters.");
  if (!/^[a-z0-9_]+$/.test(username)) return showError("Username: letters, numbers, underscore only.");

  try {
    const snap = await get(ref(db, "usernames/" + username));
    if (snap.exists()) return showError("Username already taken.");

    const newRef = push(ref(db, "users"));
    const userId = newRef.key;

    await set(ref(db, "users/" + userId), { username, password, createdAt: Date.now() });
    await set(ref(db, "usernames/" + username), userId);

    currentUser = { userId, username };
    saveSession(userId, username);
    showApp();
  } catch (e) {
    showError("Sign up failed. Check your Firebase config.");
    console.error(e);
  }
}

// ===================== AUTH: LOGIN =====================
async function handleLogin() {
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!username || !password) return showError("Please fill in all fields.");

  try {
    const snap = await get(ref(db, "usernames/" + username));
    if (!snap.exists()) return showError("Username not found.");

    const userId = snap.val();
    const userSnap = await get(ref(db, "users/" + userId));
    if (!userSnap.exists()) return showError("User data missing.");

    const userData = userSnap.val();
    if (userData.password !== password) return showError("Wrong password.");

    currentUser = { userId, username };
    saveSession(userId, username);
    showApp();
  } catch (e) {
    showError("Login failed. Check your Firebase config.");
    console.error(e);
  }
}

// ===================== LOGOUT =====================
function handleLogout() {
  if (messagesListener) {
    off(ref(db, "chats/" + activeChatId + "/messages"));
    messagesListener = null;
  }
  clearSession();
  currentUser = null;
  activeChatId = null;
  activeOtherUser = null;
  chatList.innerHTML = "";
  messagesEl.innerHTML = "";
  searchInput.value = "";
  showAuth();
}

// ===================== USER SEARCH =====================
let searchTimeout = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim().toLowerCase();

  if (!q) {
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");
    return;
  }

  searchTimeout = setTimeout(() => doSearch(q), 300);
});

async function doSearch(q) {
  try {
    const snap = await get(ref(db, "usernames"));
    if (!snap.exists()) {
      searchResults.innerHTML = "";
      searchResults.classList.add("hidden");
      return;
    }

    const all = snap.val();
    const matches = Object.keys(all).filter(u =>
      u !== currentUser.username && u.includes(q)
    );

    searchResults.innerHTML = "";

    if (matches.length === 0) {
      searchResults.innerHTML = `<div style="padding:12px 18px;color:var(--text-dim);font-size:0.82rem;">No users found</div>`;
      searchResults.classList.remove("hidden");
      return;
    }

    matches.slice(0, 8).forEach(username => {
      const item = document.createElement("div");
      item.className = "search-result-item";

      const av = document.createElement("div");
      av.className = "user-avatar";
      setAvatar(av, username);

      const info = document.createElement("div");
      info.innerHTML = `<div class="username-text">${username}</div><div class="start-chat-hint">Click to chat</div>`;

      item.appendChild(av);
      item.appendChild(info);
      item.addEventListener("click", () => {
        searchInput.value = "";
        searchResults.innerHTML = "";
        searchResults.classList.add("hidden");
        const userId = all[username];
        startChatWith(userId, username);
      });

      searchResults.appendChild(item);
    });

    searchResults.classList.remove("hidden");
  } catch (e) {
    console.error("Search error:", e);
  }
}

// ===================== CHAT CREATION =====================
async function createOrGetChat(userId1, userId2) {
  // Check existing chats for this user
  try {
    const snap = await get(ref(db, "userChats/" + userId1));
    if (snap.exists()) {
      const chats = snap.val();
      for (const chatId of Object.keys(chats)) {
        const chatSnap = await get(ref(db, "chats/" + chatId + "/participants"));
        if (chatSnap.exists()) {
          const p = chatSnap.val();
          if (p[userId2]) return chatId;
        }
      }
    }

    // Create new chat
    const newChatRef = push(ref(db, "chats"));
    const chatId = newChatRef.key;
    const participants = { [userId1]: true, [userId2]: true };

    await set(ref(db, "chats/" + chatId + "/participants"), participants);
    await set(ref(db, "chats/" + chatId + "/createdAt"), Date.now());
    await set(ref(db, "userChats/" + userId1 + "/" + chatId), true);
    await set(ref(db, "userChats/" + userId2 + "/" + chatId), true);

    return chatId;
  } catch (e) {
    console.error("Chat creation error:", e);
    return null;
  }
}

async function startChatWith(otherUserId, otherUsername) {
  const chatId = await createOrGetChat(currentUser.userId, otherUserId);
  if (!chatId) return;
  activeOtherUser = { userId: otherUserId, username: otherUsername };
  openChat(chatId);
  highlightActiveChatItem(chatId);
}

// ===================== CHAT LIST =====================
function loadChatList() {
  const userChatsRef = ref(db, "userChats/" + currentUser.userId);

  if (chatListListener) off(userChatsRef);

  chatListListener = onValue(userChatsRef, async (snap) => {
    if (!snap.exists()) {
      chatList.innerHTML = `<div class="sidebar-label">No conversations yet</div>`;
      return;
    }

    const chatIds = Object.keys(snap.val());
    const items = [];

    for (const chatId of chatIds) {
      try {
        // Get participants
        const partSnap = await get(ref(db, "chats/" + chatId + "/participants"));
        if (!partSnap.exists()) continue;

        const participants = partSnap.val();
        const otherUserId = Object.keys(participants).find(id => id !== currentUser.userId);
        if (!otherUserId) continue;

        // Get other user info
        const userSnap = await get(ref(db, "users/" + otherUserId));
        if (!userSnap.exists()) continue;
        const otherUser = userSnap.val();

        // Get last message
        const lastMsgSnap = await get(ref(db, "chats/" + chatId + "/lastMessage"));
        const lastMsg = lastMsgSnap.exists() ? lastMsgSnap.val() : null;

        items.push({ chatId, otherUserId, username: otherUser.username, lastMsg });
      } catch (e) {
        console.error(e);
      }
    }

    // Sort by last message time
    items.sort((a, b) => {
      const ta = a.lastMsg?.timestamp || 0;
      const tb = b.lastMsg?.timestamp || 0;
      return tb - ta;
    });

    chatList.innerHTML = "";

    if (items.length === 0) {
      chatList.innerHTML = `<div class="sidebar-label">Search for someone to chat with</div>`;
      return;
    }

    chatList.innerHTML = `<div class="sidebar-label">Messages</div>`;

    items.forEach(({ chatId, otherUserId, username, lastMsg }) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      item.dataset.chatId = chatId;
      if (chatId === activeChatId) item.classList.add("active");

      const av = document.createElement("div");
      av.className = "user-avatar";
      setAvatar(av, username);

      const info = document.createElement("div");
      info.className = "chat-item-info";

      const nameRow = document.createElement("div");
      nameRow.className = "chat-item-name";
      nameRow.textContent = username;

      const preview = document.createElement("div");
      preview.className = "chat-item-preview";
      preview.textContent = lastMsg
        ? (lastMsg.senderId === currentUser.userId ? "You: " : "") + lastMsg.text
        : "No messages yet";

      info.appendChild(nameRow);
      info.appendChild(preview);

      const timeEl = document.createElement("div");
      timeEl.className = "chat-item-time";
      timeEl.textContent = lastMsg ? formatTime(lastMsg.timestamp) : "";

      item.appendChild(av);
      item.appendChild(info);
      item.appendChild(timeEl);

      item.addEventListener("click", () => {
        activeOtherUser = { userId: otherUserId, username };
        openChat(chatId);
        highlightActiveChatItem(chatId);
      });

      chatList.appendChild(item);
    });
  });
}

function highlightActiveChatItem(chatId) {
  document.querySelectorAll(".chat-item").forEach(el => {
    el.classList.toggle("active", el.dataset.chatId === chatId);
  });
}

// ===================== OPEN CHAT =====================
function openChat(chatId) {
  // Detach previous listener
  if (messagesListener && activeChatId) {
    off(ref(db, "chats/" + activeChatId + "/messages"));
    messagesListener = null;
  }

  activeChatId = chatId;

  // Show chat UI
  emptyState.style.display = "none";
  chatHeader.classList.remove("hidden");
  messageInputArea.classList.remove("hidden");

  // Mobile: slide to chat panel
  showChatPanel();

  // Set header
  if (activeOtherUser) {
    chatHeaderName.textContent = activeOtherUser.username;
    setAvatar(chatHeaderAvatar, activeOtherUser.username);
  }

  // Load messages in real-time
  messagesEl.innerHTML = "";
  const msgsRef = ref(db, "chats/" + chatId + "/messages");

  messagesListener = onValue(msgsRef, (snap) => {
    messagesEl.innerHTML = "";

    if (!snap.exists()) return;

    const msgs = snap.val();
    const sorted = Object.values(msgs).sort((a, b) => a.timestamp - b.timestamp);

    let lastDate = null;

    sorted.forEach(msg => {
      const msgDate = formatDate(msg.timestamp);
      if (msgDate !== lastDate) {
        const divider = document.createElement("div");
        divider.className = "date-divider";
        divider.textContent = msgDate;
        messagesEl.appendChild(divider);
        lastDate = msgDate;
      }

      renderMessage(msg);
    });

    scrollToBottom();
  });

  messageInput.focus();
}

// ===================== RENDER MESSAGE =====================
function renderMessage(msg) {
  const isOwn = msg.senderId === currentUser.userId;

  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper " + (isOwn ? "own" : "other");

  const bubble = document.createElement("div");
  bubble.className = "message " + (isOwn ? "own" : "other");
  bubble.textContent = msg.text;

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = formatTime(msg.timestamp);

  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  messagesEl.appendChild(wrapper);
}

// ===================== SEND MESSAGE =====================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !activeChatId) return;

  messageInput.value = "";
  messageInput.focus();

  const msgData = {
    senderId: currentUser.userId,
    text,
    timestamp: Date.now()
  };

  try {
    const msgsRef = ref(db, "chats/" + activeChatId + "/messages");
    await push(msgsRef, msgData);

    // Update lastMessage
    await set(ref(db, "chats/" + activeChatId + "/lastMessage"), msgData);
  } catch (e) {
    console.error("Send error:", e);
  }
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===================== EVENT LISTENERS =====================
loginBtn.addEventListener("click", handleLogin);
signupBtn.addEventListener("click", handleSignup);
logoutBtn.addEventListener("click", handleLogout);
sendBtn.addEventListener("click", sendMessage);

// Back button — return to sidebar on mobile/tablet
if (backBtn) {
  backBtn.addEventListener("click", () => {
    showSidebarPanel();
  });
}

// iPad overlay tap — close sidebar
if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", () => {
    sidebarOverlay.classList.remove("visible");
    sidebarEl.classList.add("sidebar-hidden");
  });
}

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") passwordInput.focus();
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});

// Close search results on outside click
document.addEventListener("click", (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.innerHTML = "";
    searchResults.classList.add("hidden");
  }
});

// ===================== INIT =====================
loadSession();
