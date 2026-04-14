// =================================================================
// CALL.JS — Say Hi Voice Calling
// WebRTC peer-to-peer audio + Firebase Realtime Database signaling
//
// Firebase DB structure used:
//   calls/{callId}/
//     offer        — SDP offer from caller
//     answer       — SDP answer from callee
//     callerCandidates/{id} — ICE candidates from caller
//     calleeCandidates/{id} — ICE candidates from callee
//     status       — "ringing" | "active" | "ended" | "declined"
//     callerId
//     calleeId
//     callerName
//     calleeName
//     startedAt
//
//   userCalls/{userId}/activeCall — callId they're involved in
// =================================================================

import {
  ref, set, get, push, onValue, off, remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------
let db            = null;
let currentUser   = null;   // injected from script.js via initCalling()

let peerConn      = null;
let localStream   = null;
let remoteStream  = null;
let activeCallId  = null;
let callRole      = null;   // "caller" | "callee"
let callTimer     = null;
let callSeconds   = 0;
let isMuted       = false;
let isSpeaker     = false;
let callStatusListener  = null;
let incomingCallListener = null;

// STUN servers (Google public)
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
};

// ----------------------------------------------------------------
// DOM REFS (injected after DOMContentLoaded)
// ----------------------------------------------------------------
let outgoingScreen, incomingScreen, activeScreen;
let outgoingName, outgoingStatus;
let incomingName, incomingAvatar;
let activeCallName, activeCallTimer;
let outgoingAvatar, activeAvatar;
let muteBtn, speakerBtn;
let callBtn, callToast;
let remoteAudio;

// ----------------------------------------------------------------
// INIT — called from script.js once user logs in
// ----------------------------------------------------------------
export function initCalling(database, user) {
  db          = database;
  currentUser = user;

  cacheDOMRefs();
  wireButtons();
  listenForIncomingCalls();
}

// ----------------------------------------------------------------
// CACHE DOM
// ----------------------------------------------------------------
function cacheDOMRefs() {
  outgoingScreen  = document.getElementById("outgoingCallScreen");
  incomingScreen  = document.getElementById("incomingCallScreen");
  activeScreen    = document.getElementById("activeCallScreen");

  outgoingName    = document.getElementById("outgoingCallName");
  outgoingStatus  = document.getElementById("outgoingCallStatus");
  outgoingAvatar  = document.getElementById("outgoingCallAvatar");

  incomingName    = document.getElementById("incomingCallName");
  incomingAvatar  = document.getElementById("incomingCallAvatar");

  activeCallName  = document.getElementById("activeCallName");
  activeCallTimer = document.getElementById("activeCallTimer");
  activeAvatar    = document.getElementById("activeCallAvatar");

  muteBtn         = document.getElementById("muteBtn");
  speakerBtn      = document.getElementById("speakerBtn");
  callBtn         = document.getElementById("callBtn");
  callToast       = document.getElementById("callToast");

  // Hidden audio element for remote stream
  remoteAudio = document.getElementById("remoteAudio");
  if (!remoteAudio) {
    remoteAudio = document.createElement("audio");
    remoteAudio.id = "remoteAudio";
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "");
    document.body.appendChild(remoteAudio);
  }
}

// ----------------------------------------------------------------
// WIRE BUTTONS
// ----------------------------------------------------------------
function wireButtons() {
  // Call button in chat header
  if (callBtn) {
    callBtn.addEventListener("click", startCall);
  }

  // Outgoing: cancel
  document.getElementById("cancelCallBtn")
    ?.addEventListener("click", cancelCall);

  // Incoming: decline
  document.getElementById("declineCallBtn")
    ?.addEventListener("click", declineCall);

  // Incoming: accept
  document.getElementById("acceptCallBtn")
    ?.addEventListener("click", acceptCall);

  // Active: mute
  muteBtn?.addEventListener("click", toggleMute);

  // Active: speaker
  speakerBtn?.addEventListener("click", toggleSpeaker);

  // Active: end
  document.getElementById("endCallBtn")
    ?.addEventListener("click", endCall);
}

// ----------------------------------------------------------------
// EXPOSE: update active other user (called from script.js when chat opens)
// ----------------------------------------------------------------
export function setCallTarget(otherUser) {
  // Store on window so startCall() can access it
  window._callTarget = otherUser;
  if (callBtn) callBtn.style.display = "flex";
}

// ----------------------------------------------------------------
// AVATAR HELPER
// ----------------------------------------------------------------
function applyAvatar(el, username) {
  if (!el || !username) return;
  el.textContent = username[0].toUpperCase();
  const colors = [
    "linear-gradient(135deg,#f59e0b,#fb923c)",
    "linear-gradient(135deg,#ef4444,#f97316)",
    "linear-gradient(135deg,#10b981,#34d399)",
    "linear-gradient(135deg,#38bdf8,#818cf8)",
    "linear-gradient(135deg,#a855f7,#ec4899)",
  ];
  el.style.background = colors[username.charCodeAt(0) % colors.length];
}

// ----------------------------------------------------------------
// TOAST
// ----------------------------------------------------------------
function showToast(msg, icon = "📞") {
  if (!callToast) return;
  callToast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  callToast.classList.add("show");
  setTimeout(() => callToast.classList.remove("show"), 3500);
}

// ----------------------------------------------------------------
// SHOW / HIDE SCREENS
// ----------------------------------------------------------------
function showScreen(name) {
  outgoingScreen?.classList.remove("visible");
  incomingScreen?.classList.remove("visible");
  activeScreen?.classList.remove("visible");
  if (name === "outgoing") outgoingScreen?.classList.add("visible");
  if (name === "incoming") incomingScreen?.classList.add("visible");
  if (name === "active")   activeScreen?.classList.add("visible");
}

function hideAllScreens() {
  outgoingScreen?.classList.remove("visible");
  incomingScreen?.classList.remove("visible");
  activeScreen?.classList.remove("visible");
}

// ----------------------------------------------------------------
// START CALL (caller side)
// ----------------------------------------------------------------
async function startCall() {
  const target = window._callTarget;
  if (!target) return;
  if (activeCallId) return; // already in a call

  // Check mic permission first
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showToast("Microphone access denied", "🎤");
    return;
  }

  // Create call document in Firebase
  const callRef = push(ref(db, "calls"));
  activeCallId  = callRef.key;
  callRole      = "caller";

  await set(ref(db, "calls/" + activeCallId), {
    callerId:   currentUser.userId,
    calleeId:   target.userId,
    callerName: currentUser.username,
    calleeName: target.username,
    status:     "ringing",
    startedAt:  Date.now()
  });

  // Link call to both users
  await set(ref(db, "userCalls/" + currentUser.userId + "/activeCall"), activeCallId);
  await set(ref(db, "userCalls/" + target.userId + "/activeCall"), activeCallId);

  // Show outgoing screen
  if (outgoingName) outgoingName.textContent = target.username;
  if (outgoingStatus) outgoingStatus.textContent = "Calling…";
  applyAvatar(outgoingAvatar, target.username);
  showScreen("outgoing");

  // Create peer connection & offer
  setupPeerConnection();

  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  await set(ref(db, "calls/" + activeCallId + "/offer"), {
    type: offer.type,
    sdp:  offer.sdp
  });

  // Listen for answer
  const answerRef = ref(db, "calls/" + activeCallId + "/answer");
  onValue(answerRef, async (snap) => {
    if (!snap.exists() || !peerConn) return;
    if (peerConn.currentRemoteDescription) return;
    const answer = snap.val();
    await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
  });

  // Listen for callee ICE candidates
  const calleeCandRef = ref(db, "calls/" + activeCallId + "/calleeCandidates");
  onValue(calleeCandRef, (snap) => {
    if (!snap.exists() || !peerConn) return;
    snap.forEach(child => {
      const c = child.val();
      peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    });
  });

  // Watch call status (declined / ended by other side)
  watchCallStatus();

  // Auto-cancel after 45 seconds if no answer
  setTimeout(() => {
    if (activeCallId && callRole === "caller") {
      const stillRef = ref(db, "calls/" + activeCallId + "/status");
      get(stillRef).then(s => {
        if (s.exists() && s.val() === "ringing") {
          updateCallStatus("ended");
          cleanupCall();
          showToast("No answer", "📵");
        }
      });
    }
  }, 45000);
}

// ----------------------------------------------------------------
// LISTEN FOR INCOMING CALLS (callee side)
// ----------------------------------------------------------------
function listenForIncomingCalls() {
  if (!db || !currentUser) return;

  const userCallRef = ref(db, "userCalls/" + currentUser.userId + "/activeCall");

  incomingCallListener = onValue(userCallRef, async (snap) => {
    if (!snap.exists()) return;
    const callId = snap.val();
    if (callId === activeCallId) return; // already handling this call

    // Fetch call data
    const callSnap = await get(ref(db, "calls/" + callId));
    if (!callSnap.exists()) return;
    const callData = callSnap.val();

    // Only handle if we are the callee & status is ringing
    if (callData.calleeId !== currentUser.userId) return;
    if (callData.status !== "ringing") return;
    if (activeCallId) return; // already in a call — auto-decline

    activeCallId = callId;
    callRole     = "callee";

    // Show incoming screen
    if (incomingName) incomingName.textContent = callData.callerName;
    applyAvatar(incomingAvatar, callData.callerName);
    showScreen("incoming");
    playRingtone();
    watchCallStatus();
  });
}

// ----------------------------------------------------------------
// ACCEPT CALL (callee)
// ----------------------------------------------------------------
async function acceptCall() {
  stopRingtone();
  if (!activeCallId) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showToast("Microphone access denied", "🎤");
    declineCall();
    return;
  }

  setupPeerConnection();

  // Get offer
  const offerSnap = await get(ref(db, "calls/" + activeCallId + "/offer"));
  if (!offerSnap.exists()) return;
  const offerData = offerSnap.val();

  await peerConn.setRemoteDescription(new RTCSessionDescription(offerData));

  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  await set(ref(db, "calls/" + activeCallId + "/answer"), {
    type: answer.type,
    sdp:  answer.sdp
  });

  // Listen for caller ICE candidates
  const callerCandRef = ref(db, "calls/" + activeCallId + "/callerCandidates");
  onValue(callerCandRef, (snap) => {
    if (!snap.exists() || !peerConn) return;
    snap.forEach(child => {
      const c = child.val();
      peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    });
  });

  await updateCallStatus("active");

  // Show active screen
  const callSnap = await get(ref(db, "calls/" + activeCallId));
  const callerName = callSnap.val()?.callerName || "Caller";
  showActiveCallScreen(callerName);
}

// ----------------------------------------------------------------
// DECLINE CALL (callee)
// ----------------------------------------------------------------
async function declineCall() {
  stopRingtone();
  if (!activeCallId) return;
  await updateCallStatus("declined");
  cleanupCall();
  showToast("Call declined", "📵");
}

// ----------------------------------------------------------------
// CANCEL CALL (caller, while ringing)
// ----------------------------------------------------------------
async function cancelCall() {
  if (!activeCallId) return;
  await updateCallStatus("ended");
  cleanupCall();
}

// ----------------------------------------------------------------
// END CALL (active call, either side)
// ----------------------------------------------------------------
async function endCall() {
  if (!activeCallId) return;
  await updateCallStatus("ended");
  cleanupCall();
  showToast("Call ended · " + formatDuration(callSeconds), "📞");
}

// ----------------------------------------------------------------
// WATCH CALL STATUS in Firebase
// ----------------------------------------------------------------
function watchCallStatus() {
  if (!activeCallId) return;

  const statusRef = ref(db, "calls/" + activeCallId + "/status");
  callStatusListener = onValue(statusRef, (snap) => {
    if (!snap.exists()) return;
    const status = snap.val();

    if (status === "active" && callRole === "caller") {
      // Other side accepted — show active screen
      const target = window._callTarget;
      showActiveCallScreen(target?.username || "");
    }

    if (status === "declined" && callRole === "caller") {
      cleanupCall();
      showToast("Call declined", "📵");
    }

    if (status === "ended") {
      if (activeCallId) { // still active on our side
        cleanupCall();
        showToast("Call ended", "📞");
      }
    }
  });
}

// ----------------------------------------------------------------
// SHOW ACTIVE CALL SCREEN
// ----------------------------------------------------------------
function showActiveCallScreen(otherName) {
  if (activeCallName) activeCallName.textContent = otherName;
  applyAvatar(activeAvatar, otherName);
  showScreen("active");
  startCallTimer();
}

// ----------------------------------------------------------------
// SETUP WebRTC PEER CONNECTION
// ----------------------------------------------------------------
function setupPeerConnection() {
  peerConn = new RTCPeerConnection(ICE_SERVERS);

  // Add local audio tracks
  if (localStream) {
    localStream.getTracks().forEach(track => peerConn.addTrack(track, localStream));
  }

  // Receive remote audio
  peerConn.ontrack = (event) => {
    remoteStream = event.streams[0];
    if (remoteAudio) {
      remoteAudio.srcObject = remoteStream;
    }
  };

  // Send our ICE candidates to Firebase
  const candPath = callRole === "caller"
    ? "calls/" + activeCallId + "/callerCandidates"
    : "calls/" + activeCallId + "/calleeCandidates";

  peerConn.onicecandidate = (event) => {
    if (!event.candidate) return;
    push(ref(db, candPath), event.candidate.toJSON());
  };

  peerConn.onconnectionstatechange = () => {
    if (!peerConn) return;
    const state = peerConn.connectionState;
    if (state === "failed" || state === "disconnected") {
      endCall();
    }
  };
}

// ----------------------------------------------------------------
// UPDATE CALL STATUS in Firebase
// ----------------------------------------------------------------
async function updateCallStatus(status) {
  if (!activeCallId || !db) return;
  try {
    await set(ref(db, "calls/" + activeCallId + "/status"), status);
  } catch (e) { /* ignore */ }
}

// ----------------------------------------------------------------
// CLEANUP
// ----------------------------------------------------------------
function cleanupCall() {
  stopCallTimer();
  stopRingtone();
  hideAllScreens();

  // Detach listeners
  if (callStatusListener && activeCallId) {
    off(ref(db, "calls/" + activeCallId + "/status"));
    off(ref(db, "calls/" + activeCallId + "/answer"));
    off(ref(db, "calls/" + activeCallId + "/callerCandidates"));
    off(ref(db, "calls/" + activeCallId + "/calleeCandidates"));
    callStatusListener = null;
  }

  // Clean up userCalls pointers
  if (currentUser) {
    remove(ref(db, "userCalls/" + currentUser.userId + "/activeCall")).catch(() => {});
  }

  // Stop media
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }

  // Close peer connection
  if (peerConn) {
    peerConn.close();
    peerConn = null;
  }

  // Reset state
  activeCallId = null;
  callRole     = null;
  callSeconds  = 0;
  isMuted      = false;
  isSpeaker    = false;
}

// ----------------------------------------------------------------
// CALL TIMER
// ----------------------------------------------------------------
function startCallTimer() {
  callSeconds = 0;
  if (activeCallTimer) activeCallTimer.textContent = "00:00";
  callTimer = setInterval(() => {
    callSeconds++;
    if (activeCallTimer) activeCallTimer.textContent = formatDuration(callSeconds);
  }, 1000);
}

function stopCallTimer() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

// ----------------------------------------------------------------
// MUTE / SPEAKER
// ----------------------------------------------------------------
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });

  const icon = muteBtn?.querySelector(".call-btn-icon");
  const label = muteBtn?.querySelector(".call-btn-label");
  if (icon) icon.classList.toggle("muted", isMuted);
  if (label) label.textContent = isMuted ? "Unmute" : "Mute";

  // Swap icon
  const svg = muteBtn?.querySelector("svg");
  if (svg) svg.innerHTML = isMuted ? ICON_MIC_OFF : ICON_MIC;
}

function toggleSpeaker() {
  isSpeaker = !isSpeaker;
  // On mobile, switch audio output if supported
  if (remoteAudio && remoteAudio.setSinkId) {
    remoteAudio.setSinkId(isSpeaker ? "default" : "").catch(() => {});
  }

  const icon = speakerBtn?.querySelector(".call-btn-icon");
  const label = speakerBtn?.querySelector(".call-btn-label");
  if (icon) icon.classList.toggle("on", isSpeaker);
  if (label) label.textContent = isSpeaker ? "Speaker On" : "Speaker";
}

// ----------------------------------------------------------------
// RINGTONE (Web Audio API — no file needed)
// ----------------------------------------------------------------
let ringtoneCtx   = null;
let ringtoneNodes = [];
let ringtoneLoop  = null;

function playRingtone() {
  stopRingtone();
  function beep() {
    try {
      ringtoneCtx = ringtoneCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ringtoneCtx.createOscillator();
      const gain = ringtoneCtx.createGain();
      osc.connect(gain);
      gain.connect(ringtoneCtx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(480, ringtoneCtx.currentTime);
      gain.gain.setValueAtTime(0.3, ringtoneCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ringtoneCtx.currentTime + 0.5);
      osc.start(ringtoneCtx.currentTime);
      osc.stop(ringtoneCtx.currentTime + 0.5);
      ringtoneNodes.push(osc);
    } catch (e) { /* audio not available */ }
  }
  beep();
  ringtoneLoop = setInterval(beep, 1800);
}

function stopRingtone() {
  if (ringtoneLoop) { clearInterval(ringtoneLoop); ringtoneLoop = null; }
  ringtoneNodes.forEach(n => { try { n.stop(); } catch(e){} });
  ringtoneNodes = [];
}

// ----------------------------------------------------------------
// SVG ICON STRINGS (inline, no external files)
// ----------------------------------------------------------------
const ICON_MIC = `<line x1="12" y1="1" x2="12" y2="1"/><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>`;
const ICON_MIC_OFF = `<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>`;
