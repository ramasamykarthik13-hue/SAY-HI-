// ===================== FIREBASE SETUP =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, push, onValue, off, remove, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { initCalling, setCallTarget, setGroupCallTarget } from "./call.js";

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
const db  = getDatabase(app);

// ===================== STATE =====================
let currentUser     = null;
let activeChatId    = null;
let activeChatType  = null;
let activeOtherUser = null;
let activeGroupInfo = null;
let messagesListener = null;
let typingListener   = null;
let typingTimeout    = null;

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
const chatHeaderSub     = document.getElementById("chatHeaderSub");
const messagesEl        = document.getElementById("messages");
const messageInputArea  = document.getElementById("messageInputArea");
const messageInput      = document.getElementById("messageInput");
const sendBtn           = document.getElementById("sendBtn");
const backBtn           = document.getElementById("backBtn");
const sidebarEl         = document.getElementById("sidebar");
const chatWindowEl      = document.getElementById("chatWindow");
const sidebarOverlay    = document.getElementById("sidebarOverlay");
const newGroupBtn       = document.getElementById("newGroupBtn");
const typingIndicator   = document.getElementById("typingIndicator");
const callBtn           = document.getElementById("callBtn");
const groupCallBtn      = document.getElementById("groupCallBtn");

// ===================== EMOJI PICKER =====================
const EMOJI_LIST = ["😀","😎","🤩","🥳","😍","🤔","😅","😇","🥰","😜",
  "🦊","🐼","🐸","🐱","🦁","🐯","🐻","🐨","🦄","🐙",
  "🍕","🎮","🎸","⚽","🚀","🌈","🔥","💎","🎯","🌟"];
let selectedEmoji = "😀";

function buildEmojiPicker() {
  const wrap = document.getElementById("emojiPickerWrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  EMOJI_LIST.forEach(em => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-opt" + (em === selectedEmoji ? " selected" : "");
    btn.textContent = em;
    btn.addEventListener("click", () => {
      selectedEmoji = em;
      document.querySelectorAll(".emoji-opt").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    wrap.appendChild(btn);
  });
}

// ===================== MOBILE NAV =====================
function isMobile() { return window.innerWidth < 992; }
function showChatPanel() {
  if (!isMobile()) return;
  sidebarEl.classList.add("sidebar-hidden");
  chatWindowEl.classList.add("chat-open");
  if (sidebarOverlay) sidebarOverlay.classList.remove("visible");
}
function showSidebarPanel() {
  if (!isMobile()) return;
  sidebarEl.classList.remove("sidebar-hidden");
  chatWindowEl.classList.remove("chat-open");
}
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

function renderAvatar(el, user) {
  if (typeof user === "string") {
    el.textContent = user[0]?.toUpperCase() || "?";
    const colors = ["linear-gradient(135deg,#f59e0b,#fb923c)","linear-gradient(135deg,#ef4444,#f97316)","linear-gradient(135deg,#10b981,#34d399)","linear-gradient(135deg,#38bdf8,#818cf8)","linear-gradient(135deg,#a855f7,#ec4899)"];
    el.style.background = colors[user.charCodeAt(0) % colors.length];
    el.style.fontSize = "";
  } else if (user.emoji) {
    el.textContent = user.emoji;
    el.style.background = "transparent";
    el.style.fontSize = "1.4rem";
  } else {
    el.textContent = user.username?.[0]?.toUpperCase() || "?";
    const colors = ["linear-gradient(135deg,#f59e0b,#fb923c)","linear-gradient(135deg,#ef4444,#f97316)","linear-gradient(135deg,#10b981,#34d399)","linear-gradient(135deg,#38bdf8,#818cf8)","linear-gradient(135deg,#a855f7,#ec4899)"];
    el.style.background = colors[(user.username||"a").charCodeAt(0) % colors.length];
    el.style.fontSize = "";
  }
}
function setAvatar(el, username) { renderAvatar(el, username); }

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts), today = new Date(), yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate()-1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ===================== SESSION =====================
function saveSession(userId, username, emoji) {
  localStorage.setItem("sayhi_userId", userId);
  localStorage.setItem("sayhi_username", username);
  localStorage.setItem("sayhi_emoji", emoji || "😀");
}
function clearSession() {
  ["sayhi_userId","sayhi_username","sayhi_emoji"].forEach(k => localStorage.removeItem(k));
}
function loadSession() {
  const userId   = localStorage.getItem("sayhi_userId");
  const username = localStorage.getItem("sayhi_username");
  const emoji    = localStorage.getItem("sayhi_emoji") || "😀";
  if (userId && username) { currentUser = { userId, username, emoji }; showApp(); }
}

// ===================== SHOW APP =====================
function showApp() {
  authScreen.style.display = "none";
  appEl.style.display = "flex";
  currentUsernameEl.textContent = currentUser.username;
  currentUserAvatar.textContent = currentUser.emoji || currentUser.username[0].toUpperCase();
  currentUserAvatar.style.background = "transparent";
  currentUserAvatar.style.fontSize = "1.5rem";
  loadChatList();
  initCalling(db, currentUser);
}
function showAuth() {
  authScreen.style.display = "flex";
  appEl.style.display = "none";
  buildEmojiPicker();
}

// ===================== AUTH: SIGN UP =====================
async function handleSignup() {
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const emoji    = selectedEmoji;
  if (!username || !password) return showError("Please fill in all fields.");
  if (username.length < 3)    return showError("Username must be at least 3 characters.");
  if (password.length < 4)    return showError("Password must be at least 4 characters.");
  if (!/^[a-z0-9_]+$/.test(username)) return showError("Username: letters, numbers, underscore only.");
  try {
    const snap = await get(ref(db, "usernames/" + username));
    if (snap.exists()) return showError("❌ Username already taken. Choose another.");
    const newRef = push(ref(db, "users"));
    const userId = newRef.key;
    await set(ref(db, "users/" + userId), { username, password, emoji, createdAt: Date.now() });
    await set(ref(db, "usernames/" + username), userId);
    currentUser = { userId, username, emoji };
    saveSession(userId, username, emoji);
    showApp();
  } catch (e) { showError("Sign up failed. Check Firebase config."); console.error(e); }
}

// ===================== AUTH: LOGIN =====================
async function handleLogin() {
  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!username || !password) return showError("Please fill in all fields.");
  try {
    const snap = await get(ref(db, "usernames/" + username));
    if (!snap.exists()) return showError("Username not found.");
    const userId   = snap.val();
    const userSnap = await get(ref(db, "users/" + userId));
    if (!userSnap.exists()) return showError("User data missing.");
    const userData = userSnap.val();
    if (userData.password !== password) return showError("Wrong password.");
    const emoji = userData.emoji || "😀";
    currentUser = { userId, username, emoji };
    saveSession(userId, username, emoji);
    showApp();
  } catch (e) { showError("Login failed. Check Firebase config."); console.error(e); }
}

// ===================== LOGOUT =====================
function handleLogout() {
  if (messagesListener && activeChatId) { off(ref(db, "chats/" + activeChatId + "/messages")); messagesListener = null; }
  if (typingListener && activeChatId)   { off(ref(db, "chats/" + activeChatId + "/typing"));   typingListener = null; }
  clearTypingStatus();
  clearSession();
  currentUser = null; activeChatId = null; activeOtherUser = null; activeGroupInfo = null;
  chatList.innerHTML = ""; messagesEl.innerHTML = ""; searchInput.value = "";
  chatHeader.classList.add("hidden"); messageInputArea.classList.add("hidden");
  emptyState.style.display = "flex";
  showAuth();
}

// ===================== USER SEARCH =====================
let searchTimeout = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchResults.innerHTML = ""; searchResults.classList.add("hidden"); return; }
  searchTimeout = setTimeout(() => doSearch(q), 300);
});

async function doSearch(q) {
  try {
    const snap = await get(ref(db, "usernames"));
    if (!snap.exists()) { searchResults.classList.add("hidden"); return; }
    const all = snap.val();
    const matches = Object.keys(all).filter(u => u !== currentUser.username && u.includes(q));
    searchResults.innerHTML = "";
    if (!matches.length) {
      searchResults.innerHTML = `<div style="padding:12px 18px;color:var(--text-dim);font-size:0.82rem;">No users found</div>`;
      searchResults.classList.remove("hidden"); return;
    }
    for (const username of matches.slice(0, 8)) {
      const uid = all[username];
      const userSnap = await get(ref(db, "users/" + uid));
      const emoji = userSnap.exists() ? (userSnap.val().emoji || "😀") : "😀";
      const item = document.createElement("div");
      item.className = "search-result-item";
      const av = document.createElement("div");
      av.className = "user-avatar";
      renderAvatar(av, { username, emoji });
      const info = document.createElement("div");
      info.innerHTML = `<div class="username-text">${username}</div><div class="start-chat-hint">Click to chat</div>`;
      item.appendChild(av); item.appendChild(info);
      item.addEventListener("click", () => {
        searchInput.value = ""; searchResults.innerHTML = ""; searchResults.classList.add("hidden");
        startChatWith(uid, username, emoji);
      });
      searchResults.appendChild(item);
    }
    searchResults.classList.remove("hidden");
  } catch (e) { console.error(e); }
}

// ===================== DM CHAT =====================
async function createOrGetChat(userId1, userId2) {
  try {
    const snap = await get(ref(db, "userChats/" + userId1));
    if (snap.exists()) {
      for (const chatId of Object.keys(snap.val())) {
        const cs = await get(ref(db, "chats/" + chatId));
        if (!cs.exists()) continue;
        const cd = cs.val();
        if (cd.type === "dm" && cd.participants?.[userId2]) return chatId;
      }
    }
    const newRef = push(ref(db, "chats"));
    const chatId = newRef.key;
    await set(ref(db, "chats/" + chatId), { type:"dm", participants:{ [userId1]:true, [userId2]:true }, createdAt:Date.now() });
    await set(ref(db, "userChats/" + userId1 + "/" + chatId), true);
    await set(ref(db, "userChats/" + userId2 + "/" + chatId), true);
    return chatId;
  } catch (e) { console.error(e); return null; }
}

async function startChatWith(otherUserId, otherUsername, otherEmoji) {
  const chatId = await createOrGetChat(currentUser.userId, otherUserId);
  if (!chatId) return;
  activeOtherUser = { userId: otherUserId, username: otherUsername, emoji: otherEmoji || "😀" };
  activeGroupInfo = null; activeChatType = "dm";
  openChat(chatId, "dm"); highlightActiveChatItem(chatId);
}

// ===================== GROUP CHAT =====================
newGroupBtn?.addEventListener("click", showCreateGroupModal);

function showCreateGroupModal() {
  document.getElementById("groupModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "groupModal"; modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header"><h3>New Group</h3><button class="modal-close" id="closeGroupModal">✕</button></div>
      <input id="groupNameInput" class="modal-input" placeholder="Group name…" maxlength="40"/>
      <div class="modal-label">Add members</div>
      <input id="groupMemberSearch" class="modal-input" placeholder="Search username…"/>
      <div id="groupMemberResults"></div>
      <div class="modal-label">Members added:</div>
      <div id="selectedMembers" class="selected-members"></div>
      <button id="createGroupConfirm" class="btn-primary" style="width:100%;margin-top:12px;padding:13px">Create Group</button>
    </div>`;
  document.body.appendChild(modal);

  const selectedUsers = {};
  document.getElementById("closeGroupModal").onclick = () => modal.remove();
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  document.getElementById("groupMemberSearch").addEventListener("input", async (e) => {
    const q = e.target.value.trim().toLowerCase();
    const resultsEl = document.getElementById("groupMemberResults");
    resultsEl.innerHTML = "";
    if (!q) return;
    const snap = await get(ref(db, "usernames"));
    if (!snap.exists()) return;
    const all = snap.val();
    for (const username of Object.keys(all).filter(u => u !== currentUser.username && u.includes(q)).slice(0,6)) {
      const uid = all[username];
      const us = await get(ref(db, "users/" + uid));
      const emoji = us.exists() ? (us.val().emoji||"😀") : "😀";
      const row = document.createElement("div");
      row.className = "member-result-row" + (selectedUsers[uid] ? " added" : "");
      row.innerHTML = `<span class="member-emoji">${emoji}</span><span>${username}</span><span class="add-member-btn">${selectedUsers[uid]?"✓":"+"}</span>`;
      row.addEventListener("click", () => {
        if (selectedUsers[uid]) delete selectedUsers[uid]; else selectedUsers[uid] = { username, emoji };
        renderSelectedMembers();
        document.getElementById("groupMemberSearch").dispatchEvent(new Event("input"));
      });
      resultsEl.appendChild(row);
    }
  });

  function renderSelectedMembers() {
    const el = document.getElementById("selectedMembers"); el.innerHTML = "";
    Object.entries(selectedUsers).forEach(([uid, u]) => {
      const chip = document.createElement("div"); chip.className = "member-chip";
      chip.innerHTML = `${u.emoji} ${u.username} <span class="chip-remove">✕</span>`;
      chip.querySelector(".chip-remove").onclick = () => { delete selectedUsers[uid]; renderSelectedMembers(); };
      el.appendChild(chip);
    });
  }

  document.getElementById("createGroupConfirm").addEventListener("click", async () => {
    const name = document.getElementById("groupNameInput").value.trim();
    if (!name) { alert("Please enter a group name."); return; }
    if (!Object.keys(selectedUsers).length) { alert("Add at least 1 member."); return; }
    const allParts = { [currentUser.userId]: true };
    Object.keys(selectedUsers).forEach(uid => { allParts[uid] = true; });
    const newRef = push(ref(db, "chats"));
    const chatId = newRef.key;
    await set(ref(db, "chats/" + chatId), { type:"group", name, participants:allParts, createdBy:currentUser.userId, createdAt:Date.now() });
    for (const uid of Object.keys(allParts)) await set(ref(db, "userChats/" + uid + "/" + chatId), true);
    modal.remove();
    activeGroupInfo = { chatId, name, participants: allParts };
    activeOtherUser = null; activeChatType = "group";
    openChat(chatId, "group"); highlightActiveChatItem(chatId);
  });
}

// ===================== CHAT LIST =====================
function loadChatList() {
  const userChatsRef = ref(db, "userChats/" + currentUser.userId);
  onValue(userChatsRef, async (snap) => {
    if (!snap.exists()) { chatList.innerHTML = `<div class="sidebar-label">No conversations yet</div>`; return; }
    const chatIds = Object.keys(snap.val());
    const items = [];
    for (const chatId of chatIds) {
      try {
        const cs = await get(ref(db, "chats/" + chatId));
        if (!cs.exists()) continue;
        const cd = cs.val();
        const lms = await get(ref(db, "chats/" + chatId + "/lastMessage"));
        const lastMsg = lms.exists() ? lms.val() : null;
        if (cd.type === "group") {
          items.push({ chatId, type:"group", name:cd.name, participants:cd.participants, lastMsg });
        } else {
          const otherId = Object.keys(cd.participants||{}).find(id => id !== currentUser.userId);
          if (!otherId) continue;
          const us = await get(ref(db, "users/" + otherId));
          if (!us.exists()) continue;
          const ou = us.val();
          items.push({ chatId, type:"dm", otherUserId:otherId, username:ou.username, emoji:ou.emoji||"😀", lastMsg });
        }
      } catch(e) { console.error(e); }
    }
    items.sort((a,b) => (b.lastMsg?.timestamp||0) - (a.lastMsg?.timestamp||0));
    chatList.innerHTML = `<div class="sidebar-label">Messages</div>`;
    if (!items.length) { chatList.innerHTML = `<div class="sidebar-label">Search to start chatting</div>`; return; }

    items.forEach(item => {
      const el = document.createElement("div");
      el.className = "chat-item" + (item.chatId === activeChatId ? " active" : "");
      el.dataset.chatId = item.chatId;

      const av = document.createElement("div"); av.className = "user-avatar";
      if (item.type === "group") { av.textContent = "👥"; av.style.background="transparent"; av.style.fontSize="1.4rem"; }
      else renderAvatar(av, { username:item.username, emoji:item.emoji });

      const info = document.createElement("div"); info.className = "chat-item-info";
      const nameRow = document.createElement("div"); nameRow.className = "chat-item-name";
      nameRow.innerHTML = (item.type==="group" ? `<span class="group-badge">GROUP</span> ` : "") + (item.name||item.username);
      const preview = document.createElement("div"); preview.className = "chat-item-preview";
      if (item.lastMsg) {
        const isMine = item.lastMsg.senderId === currentUser.userId;
        preview.textContent = (isMine ? "You: " : (item.type==="group" ? (item.lastMsg.senderName+": "):"")) + item.lastMsg.text;
      } else preview.textContent = "No messages yet";
      const timeEl = document.createElement("div"); timeEl.className = "chat-item-time";
      timeEl.textContent = item.lastMsg ? formatTime(item.lastMsg.timestamp) : "";

      info.appendChild(nameRow); info.appendChild(preview);
      el.appendChild(av); el.appendChild(info); el.appendChild(timeEl);
      el.addEventListener("click", () => {
        if (item.type === "dm") {
          activeOtherUser = { userId:item.otherUserId, username:item.username, emoji:item.emoji };
          activeGroupInfo = null; activeChatType = "dm";
        } else {
          activeGroupInfo = { chatId:item.chatId, name:item.name, participants:item.participants };
          activeOtherUser = null; activeChatType = "group";
        }
        openChat(item.chatId, item.type); highlightActiveChatItem(item.chatId);
      });
      chatList.appendChild(el);
    });
  });
}

function highlightActiveChatItem(chatId) {
  document.querySelectorAll(".chat-item").forEach(el => el.classList.toggle("active", el.dataset.chatId === chatId));
}

// ===================== OPEN CHAT =====================
function openChat(chatId, type) {
  if (messagesListener && activeChatId) { off(ref(db, "chats/" + activeChatId + "/messages")); messagesListener = null; }
  if (typingListener && activeChatId)   { off(ref(db, "chats/" + activeChatId + "/typing"));   typingListener = null; }

  activeChatId = chatId; activeChatType = type;
  emptyState.style.display = "none";
  chatHeader.classList.remove("hidden");
  messageInputArea.classList.remove("hidden");
  showChatPanel();

  if (type === "group" && activeGroupInfo) {
    chatHeaderAvatar.textContent = "👥"; chatHeaderAvatar.style.background = "transparent"; chatHeaderAvatar.style.fontSize = "1.6rem";
    chatHeaderName.textContent = activeGroupInfo.name;
    const count = Object.keys(activeGroupInfo.participants||{}).length;
    if (chatHeaderSub) chatHeaderSub.textContent = count + " members";
    if (callBtn) callBtn.style.display = "none";
    if (groupCallBtn) groupCallBtn.style.display = "flex";
    setGroupCallTarget(activeGroupInfo, currentUser);
  } else if (activeOtherUser) {
    renderAvatar(chatHeaderAvatar, activeOtherUser);
    chatHeaderName.textContent = activeOtherUser.username;
    if (chatHeaderSub) chatHeaderSub.textContent = "";
    if (callBtn) callBtn.style.display = "flex";
    if (groupCallBtn) groupCallBtn.style.display = "none";
    setCallTarget(activeOtherUser);
  }

  messagesEl.innerHTML = "";
  messagesListener = onValue(ref(db, "chats/" + chatId + "/messages"), async (snap) => {
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
    if (!snap.exists()) { messagesEl.innerHTML = ""; return; }
    const msgs = snap.val();
    const sorted = Object.entries(msgs).sort((a,b) => a[1].timestamp - b[1].timestamp);
    messagesEl.innerHTML = "";
    let lastDate = null;
    for (const [msgId, msg] of sorted) {
      const msgDate = formatDate(msg.timestamp);
      if (msgDate !== lastDate) {
        const div = document.createElement("div"); div.className = "date-divider"; div.textContent = msgDate;
        messagesEl.appendChild(div); lastDate = msgDate;
      }
      await renderMessage(msgId, msg, type);
    }
    markMessagesRead(chatId, sorted);
    if (wasAtBottom) scrollToBottom();
  });

  listenTyping(chatId);
  messageInput.focus();
}

// ===================== READ RECEIPTS =====================
function markMessagesRead(chatId, sortedEntries) {
  sortedEntries.forEach(([msgId, msg]) => {
    if (msg.senderId !== currentUser.userId && !msg.readBy?.[currentUser.userId]) {
      set(ref(db, "chats/" + chatId + "/messages/" + msgId + "/readBy/" + currentUser.userId), true);
    }
  });
}

// ===================== RENDER MESSAGE =====================
async function renderMessage(msgId, msg, chatType) {
  const isOwn = msg.senderId === currentUser.userId;
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper " + (isOwn ? "own" : "other");

  if (chatType === "group" && !isOwn) {
    let senderEmoji = "😀";
    try { const ss = await get(ref(db,"users/"+msg.senderId)); if(ss.exists()) senderEmoji=ss.val().emoji||"😀"; } catch(e){}
    const senderRow = document.createElement("div");
    senderRow.className = "group-sender-name";
    senderRow.textContent = senderEmoji + " " + (msg.senderName || "");
    wrapper.appendChild(senderRow);
  }

  const bubble = document.createElement("div");
  bubble.className = "message " + (isOwn ? "own" : "other");
  bubble.textContent = msg.text;

  const metaRow = document.createElement("div");
  metaRow.className = "message-meta";
  const timeSpan = document.createElement("span");
  timeSpan.className = "message-time";
  timeSpan.textContent = formatTime(msg.timestamp);
  metaRow.appendChild(timeSpan);

  if (isOwn) {
    const receipt = document.createElement("span");
    receipt.className = "read-receipt";
    const readByOthers = Object.keys(msg.readBy||{}).filter(uid => uid !== currentUser.userId);
    receipt.textContent = readByOthers.length > 0 ? " ✓✓" : " ✓";
    receipt.style.color = readByOthers.length > 0 ? "#60a5fa" : "#7b82a0";
    receipt.title = readByOthers.length > 0 ? "Read" : "Sent";
    metaRow.appendChild(receipt);
  }

  wrapper.appendChild(bubble);
  wrapper.appendChild(metaRow);
  messagesEl.appendChild(wrapper);
}

// ===================== TYPING =====================
function listenTyping(chatId) {
  if (typingIndicator) typingIndicator.style.display = "none";
  typingListener = onValue(ref(db, "chats/" + chatId + "/typing"), (snap) => {
    if (!snap.exists() || !typingIndicator) { if(typingIndicator) typingIndicator.style.display="none"; return; }
    const typing = snap.val();
    const others = Object.entries(typing).filter(([uid,val]) => uid !== currentUser.userId && val === true);
    if (!others.length) { typingIndicator.style.display="none"; return; }
    typingIndicator.style.display = "flex";
    Promise.all(others.slice(0,2).map(([uid]) => get(ref(db,"users/"+uid)))).then(snaps => {
      const names = snaps.map(s => s.exists() ? (s.val().emoji+" "+s.val().username) : "Someone");
      const textEl = typingIndicator.querySelector(".typing-text");
      if(textEl) textEl.textContent = names.join(", ") + (others.length>2?" & others":"") + " typing…";
    });
  });
}

function setTyping(val) {
  if (!activeChatId || !currentUser) return;
  if (val) set(ref(db,"chats/"+activeChatId+"/typing/"+currentUser.userId), true).catch(()=>{});
  else remove(ref(db,"chats/"+activeChatId+"/typing/"+currentUser.userId)).catch(()=>{});
}
function clearTypingStatus() {
  if (activeChatId && currentUser) remove(ref(db,"chats/"+activeChatId+"/typing/"+currentUser.userId)).catch(()=>{});
}

messageInput.addEventListener("input", () => {
  clearTimeout(typingTimeout);
  if (messageInput.value.trim()) {
    setTyping(true);
    typingTimeout = setTimeout(() => setTyping(false), 3000);
  } else { setTyping(false); }
});

// ===================== SEND MESSAGE =====================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !activeChatId) return;
  messageInput.value = ""; messageInput.focus();
  clearTimeout(typingTimeout); setTyping(false);
  const msgData = {
    senderId: currentUser.userId, senderName: currentUser.username,
    text, timestamp: Date.now(), readBy: { [currentUser.userId]: true }
  };
  try {
    await push(ref(db, "chats/" + activeChatId + "/messages"), msgData);
    await set(ref(db, "chats/" + activeChatId + "/lastMessage"), {
      senderId: msgData.senderId, senderName: msgData.senderName, text: msgData.text, timestamp: msgData.timestamp
    });
  } catch(e) { console.error("Send error:", e); }
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ===================== EVENTS =====================
loginBtn.addEventListener("click", handleLogin);
signupBtn.addEventListener("click", handleSignup);
logoutBtn.addEventListener("click", handleLogout);
sendBtn.addEventListener("click", sendMessage);
backBtn?.addEventListener("click", () => { clearTypingStatus(); showSidebarPanel(); });
sidebarOverlay?.addEventListener("click", () => { sidebarOverlay.classList.remove("visible"); sidebarEl.classList.add("sidebar-hidden"); });
messageInput.addEventListener("keydown", (e) => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();} });
usernameInput.addEventListener("keydown", (e) => { if(e.key==="Enter") passwordInput.focus(); });
passwordInput.addEventListener("keydown", (e) => { if(e.key==="Enter") handleLogin(); });
document.addEventListener("click", (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.innerHTML = ""; searchResults.classList.add("hidden");
  }
});

// ===================== INIT =====================
buildEmojiPicker();
loadSession();
