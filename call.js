// =================================================================
// CALL.JS — Say Hi Voice Calling (1-to-1 + Group)
// WebRTC + Firebase Realtime Database signaling
// Fixed: works on laptop, iPad, phone
// =================================================================

import { ref, set, get, push, onValue, off, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ---------------------------------------------------------------- STATE
let db = null, currentUser = null;
let peerConns   = {};   // uid -> RTCPeerConnection (group supports multiple)
let localStream = null, remoteStream = null;
let activeCallId = null, callRole = null;
let callTimer = null, callSeconds = 0;
let isMuted = false, isSpeaker = false;
let callStatusUnsub = null, incomingUnsub = null;
let callType = "dm";             // "dm" | "group"
let groupCallTarget = null;      // { chatId, name, participants }
let dmCallTarget    = null;      // { userId, username, emoji }

const ICE = { iceServers:[
  { urls:"stun:stun.l.google.com:19302" },
  { urls:"stun:stun1.l.google.com:19302" },
  { urls:"stun:stun2.l.google.com:19302" },
]};

// ---------------------------------------------------------------- DOM
let outgoingScreen, incomingScreen, activeScreen;
let outgoingName, outgoingStatus, outgoingAvatar;
let incomingName, incomingAvatar;
let activeCallName, activeCallTimerEl, activeAvatar;
let muteBtn, speakerBtn, callBtn, groupCallBtn, callToast, remoteAudio;

// ---------------------------------------------------------------- INIT
export function initCalling(database, user) {
  db = database; currentUser = user;
  cacheDOMRefs(); wireButtons(); listenForIncomingCalls();
}

export function setCallTarget(otherUser) {
  dmCallTarget = otherUser;
  window._callTarget = otherUser;
  if (callBtn) callBtn.style.display = "flex";
}

export function setGroupCallTarget(groupInfo, user) {
  groupCallTarget = groupInfo;
  currentUser = user || currentUser;
  if (groupCallBtn) groupCallBtn.style.display = "flex";
}

// ---------------------------------------------------------------- DOM CACHE
function cacheDOMRefs() {
  outgoingScreen = document.getElementById("outgoingCallScreen");
  incomingScreen = document.getElementById("incomingCallScreen");
  activeScreen   = document.getElementById("activeCallScreen");
  outgoingName   = document.getElementById("outgoingCallName");
  outgoingStatus = document.getElementById("outgoingCallStatus");
  outgoingAvatar = document.getElementById("outgoingCallAvatar");
  incomingName   = document.getElementById("incomingCallName");
  incomingAvatar = document.getElementById("incomingCallAvatar");
  activeCallName = document.getElementById("activeCallName");
  activeCallTimerEl = document.getElementById("activeCallTimer");
  activeAvatar   = document.getElementById("activeCallAvatar");
  muteBtn        = document.getElementById("muteBtn");
  speakerBtn     = document.getElementById("speakerBtn");
  callBtn        = document.getElementById("callBtn");
  groupCallBtn   = document.getElementById("groupCallBtn");
  callToast      = document.getElementById("callToast");

  remoteAudio = document.getElementById("remoteAudio");
  if (!remoteAudio) {
    remoteAudio = document.createElement("audio");
    remoteAudio.id = "remoteAudio"; remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline",""); remoteAudio.setAttribute("controls","");
    remoteAudio.style.display = "none";
    document.body.appendChild(remoteAudio);
  }
}

// ---------------------------------------------------------------- BUTTONS
function wireButtons() {
  callBtn?.addEventListener("click", () => startDMCall());
  groupCallBtn?.addEventListener("click", () => startGroupCall());
  document.getElementById("cancelCallBtn")?.addEventListener("click", cancelCall);
  document.getElementById("declineCallBtn")?.addEventListener("click", declineCall);
  document.getElementById("acceptCallBtn")?.addEventListener("click", acceptCall);
  muteBtn?.addEventListener("click", toggleMute);
  speakerBtn?.addEventListener("click", toggleSpeaker);
  document.getElementById("endCallBtn")?.addEventListener("click", endCall);
}

// ---------------------------------------------------------------- AVATAR
function applyAvatar(el, label, emoji) {
  if (!el) return;
  if (emoji) { el.textContent = emoji; el.style.background="transparent"; el.style.fontSize="2.4rem"; }
  else { el.textContent = (label||"?")[0].toUpperCase(); el.style.background="linear-gradient(135deg,#f59e0b,#fb923c)"; el.style.fontSize="2.4rem"; }
}

// ---------------------------------------------------------------- TOAST
function showToast(msg, icon="📞") {
  if (!callToast) return;
  callToast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  callToast.classList.add("show");
  setTimeout(() => callToast.classList.remove("show"), 3500);
}

// ---------------------------------------------------------------- SCREENS
function showScreen(name) {
  [outgoingScreen, incomingScreen, activeScreen].forEach(s => s?.classList.remove("visible"));
  if (name==="outgoing") outgoingScreen?.classList.add("visible");
  if (name==="incoming") incomingScreen?.classList.add("visible");
  if (name==="active")   activeScreen?.classList.add("visible");
}
function hideAllScreens() {
  [outgoingScreen, incomingScreen, activeScreen].forEach(s => s?.classList.remove("visible"));
}

// ---------------------------------------------------------------- GET MIC
async function getMic() {
  // Try with constraints that work across browsers
  const constraints = [
    { audio: { echoCancellation:true, noiseSuppression:true, sampleRate:48000 }, video:false },
    { audio: { echoCancellation:true, noiseSuppression:true }, video:false },
    { audio: true, video: false }
  ];
  for (const c of constraints) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch(e) { continue; }
  }
  throw new Error("Microphone unavailable");
}

// ---------------------------------------------------------------- START DM CALL
async function startDMCall() {
  const target = dmCallTarget || window._callTarget;
  if (!target || activeCallId) return;
  callType = "dm";

  try { localStream = await getMic(); }
  catch(e) { showToast("Microphone access denied","🎤"); return; }

  const callRef = push(ref(db,"calls"));
  activeCallId  = callRef.key; callRole = "caller";

  await set(ref(db,"calls/"+activeCallId), {
    type:"dm", callerId:currentUser.userId, calleeId:target.userId,
    callerName:currentUser.username, callerEmoji:currentUser.emoji||"😀",
    calleeName:target.username, calleeEmoji:target.emoji||"😀",
    status:"ringing", startedAt:Date.now()
  });
  await set(ref(db,"userCalls/"+currentUser.userId+"/activeCall"), activeCallId);
  await set(ref(db,"userCalls/"+target.userId+"/activeCall"), activeCallId);

  if(outgoingName) outgoingName.textContent = target.username;
  if(outgoingStatus) outgoingStatus.textContent = "Calling…";
  applyAvatar(outgoingAvatar, target.username, target.emoji);
  showScreen("outgoing");

  await setupPeerAndOffer(target.userId);
  watchCallStatus();

  // Auto-cancel after 45s
  setTimeout(async () => {
    if (!activeCallId) return;
    const ss = await get(ref(db,"calls/"+activeCallId+"/status"));
    if (ss.exists() && ss.val()==="ringing") { await updateCallStatus("ended"); cleanupCall(); showToast("No answer","📵"); }
  }, 45000);
}

// ---------------------------------------------------------------- START GROUP CALL
async function startGroupCall() {
  const group = groupCallTarget;
  if (!group || activeCallId) return;
  callType = "group";

  try { localStream = await getMic(); }
  catch(e) { showToast("Microphone access denied","🎤"); return; }

  const callRef = push(ref(db,"calls"));
  activeCallId  = callRef.key; callRole = "caller";

  const participants = group.participants || {};
  await set(ref(db,"calls/"+activeCallId), {
    type:"group", groupName:group.name, callerId:currentUser.userId,
    callerName:currentUser.username, callerEmoji:currentUser.emoji||"😀",
    participants, status:"ringing", startedAt:Date.now()
  });
  // Notify all participants
  for (const uid of Object.keys(participants)) {
    if (uid !== currentUser.userId) await set(ref(db,"userCalls/"+uid+"/activeCall"), activeCallId);
  }
  await set(ref(db,"userCalls/"+currentUser.userId+"/activeCall"), activeCallId);

  if(outgoingName) outgoingName.textContent = group.name;
  if(outgoingStatus) outgoingStatus.textContent = "Calling group…";
  applyAvatar(outgoingAvatar, group.name, "👥");
  showScreen("outgoing");

  // For group: listen for each participant's answer
  listenGroupAnswers(participants);
  watchCallStatus();
}

// ---------------------------------------------------------------- PEER CONNECTION for DM
async function setupPeerAndOffer(calleeId) {
  const pc = new RTCPeerConnection(ICE);
  peerConns[calleeId] = pc;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    remoteStream = e.streams[0];
    remoteAudio.srcObject = remoteStream;
    // Force play (required on some browsers/iOS)
    remoteAudio.play().catch(()=>{});
  };

  const candPath = "calls/"+activeCallId+"/callerCandidates";
  pc.onicecandidate = (e) => { if(e.candidate) push(ref(db,candPath), e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => {
    if (["failed","disconnected"].includes(pc.connectionState)) endCall();
  };

  const offer = await pc.createOffer({ offerToReceiveAudio:true });
  await pc.setLocalDescription(offer);
  await set(ref(db,"calls/"+activeCallId+"/offer"), { type:offer.type, sdp:offer.sdp });

  // Listen for answer
  onValue(ref(db,"calls/"+activeCallId+"/answer"), async (snap) => {
    if (!snap.exists() || !pc || pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
  });

  // Callee ICE
  onValue(ref(db,"calls/"+activeCallId+"/calleeCandidates"), (snap) => {
    if (!snap.exists()) return;
    snap.forEach(child => { pc.addIceCandidate(new RTCIceCandidate(child.val())).catch(()=>{}); });
  });
}

// ---------------------------------------------------------------- LISTEN FOR GROUP ANSWERS
function listenGroupAnswers(participants) {
  Object.keys(participants).forEach(uid => {
    if (uid === currentUser.userId) return;
    onValue(ref(db,"calls/"+activeCallId+"/answers/"+uid), async (snap) => {
      if (!snap.exists()) return;
      const pc = peerConns[uid];
      if (!pc || pc.currentRemoteDescription) return;
      await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
    });
    onValue(ref(db,"calls/"+activeCallId+"/calleeCandidates/"+uid), (snap) => {
      if (!snap.exists()) return;
      snap.forEach(child => { peerConns[uid]?.addIceCandidate(new RTCIceCandidate(child.val())).catch(()=>{}); });
    });
  });
}

// ---------------------------------------------------------------- LISTEN FOR INCOMING
function listenForIncomingCalls() {
  if (!db || !currentUser) return;
  incomingUnsub = onValue(ref(db,"userCalls/"+currentUser.userId+"/activeCall"), async (snap) => {
    if (!snap.exists()) return;
    const callId = snap.val();
    if (callId === activeCallId) return;

    const cs = await get(ref(db,"calls/"+callId));
    if (!cs.exists()) return;
    const cd = cs.val();
    if (cd.callerId === currentUser.userId) return;
    if (cd.status !== "ringing") return;
    if (activeCallId) { await set(ref(db,"calls/"+callId+"/status"),"ended"); return; }

    activeCallId = callId; callRole = "callee";
    callType = cd.type || "dm";

    const displayName = cd.type==="group" ? (cd.callerName + " · " + cd.groupName) : cd.callerName;
    const displayEmoji = cd.type==="group" ? "👥" : (cd.callerEmoji||"😀");

    if(incomingName) incomingName.textContent = displayName;
    applyAvatar(incomingAvatar, displayName, displayEmoji);
    showScreen("incoming");
    playRingtone();
    watchCallStatus();
  });
}

// ---------------------------------------------------------------- ACCEPT
async function acceptCall() {
  stopRingtone();
  if (!activeCallId) return;

  try { localStream = await getMic(); }
  catch(e) { showToast("Microphone access denied","🎤"); declineCall(); return; }

  const cs = await get(ref(db,"calls/"+activeCallId));
  if (!cs.exists()) return;
  const cd = cs.val();

  const pc = new RTCPeerConnection(ICE);
  peerConns[cd.callerId] = pc;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    remoteStream = e.streams[0];
    remoteAudio.srcObject = remoteStream;
    remoteAudio.play().catch(()=>{});
  };

  const candPath = "calls/"+activeCallId+"/calleeCandidates";
  pc.onicecandidate = (e) => { if(e.candidate) push(ref(db,candPath), e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => {
    if (["failed","disconnected"].includes(pc.connectionState)) endCall();
  };

  const offerSnap = await get(ref(db,"calls/"+activeCallId+"/offer"));
  if (!offerSnap.exists()) return;
  await pc.setRemoteDescription(new RTCSessionDescription(offerSnap.val()));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await set(ref(db,"calls/"+activeCallId+"/answer"), { type:answer.type, sdp:answer.sdp });

  // Caller ICE
  onValue(ref(db,"calls/"+activeCallId+"/callerCandidates"), (snap) => {
    if (!snap.exists()) return;
    snap.forEach(child => { pc.addIceCandidate(new RTCIceCandidate(child.val())).catch(()=>{}); });
  });

  await updateCallStatus("active");
  const name = cd.type==="group" ? cd.groupName : cd.callerName;
  const emoji = cd.type==="group" ? "👥" : (cd.callerEmoji||"😀");
  showActiveCallScreen(name, emoji);
}

// ---------------------------------------------------------------- DECLINE / CANCEL / END
async function declineCall() {
  stopRingtone(); if (!activeCallId) return;
  await updateCallStatus("declined"); cleanupCall(); showToast("Call declined","📵");
}
async function cancelCall() {
  if (!activeCallId) return;
  await updateCallStatus("ended"); cleanupCall();
}
async function endCall() {
  const secs = callSeconds;
  if (!activeCallId) return;
  await updateCallStatus("ended"); cleanupCall();
  showToast("Call ended · " + formatDuration(secs),"📞");
}

// ---------------------------------------------------------------- WATCH STATUS
function watchCallStatus() {
  if (!activeCallId) return;
  callStatusUnsub = onValue(ref(db,"calls/"+activeCallId+"/status"), (snap) => {
    if (!snap.exists()) return;
    const status = snap.val();
    if (status==="active" && callRole==="caller") {
      const target = dmCallTarget || window._callTarget;
      const name  = callType==="group" ? (groupCallTarget?.name||"Group") : (target?.username||"");
      const emoji = callType==="group" ? "👥" : (target?.emoji||"😀");
      showActiveCallScreen(name, emoji);
    }
    if (status==="declined" && callRole==="caller") { cleanupCall(); showToast("Call declined","📵"); }
    if (status==="ended" && activeCallId) { cleanupCall(); showToast("Call ended","📞"); }
  });
}

// ---------------------------------------------------------------- ACTIVE SCREEN
function showActiveCallScreen(name, emoji) {
  if (activeCallName) activeCallName.textContent = name;
  applyAvatar(activeAvatar, name, emoji);
  showScreen("active");
  startCallTimer();
}

// ---------------------------------------------------------------- CLEANUP
async function updateCallStatus(status) {
  if (!activeCallId||!db) return;
  try { await set(ref(db,"calls/"+activeCallId+"/status"), status); } catch(e){}
}

function cleanupCall() {
  stopCallTimer(); stopRingtone(); hideAllScreens();

  // Detach Firebase listeners
  if (activeCallId) {
    ["status","offer","answer","callerCandidates","calleeCandidates"].forEach(p => {
      try { off(ref(db,"calls/"+activeCallId+"/"+p)); } catch(e){}
    });
  }
  if (callStatusUnsub) { try { off(ref(db,"calls/"+(activeCallId||"_")+"/status")); }catch(e){} callStatusUnsub = null; }

  // Cleanup userCalls
  if (currentUser) remove(ref(db,"userCalls/"+currentUser.userId+"/activeCall")).catch(()=>{});

  // Stop media
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  if (remoteAudio) { remoteAudio.srcObject=null; remoteAudio.pause(); }

  // Close peers
  Object.values(peerConns).forEach(pc => { try{pc.close();}catch(e){} });
  peerConns = {};

  activeCallId=null; callRole=null; callSeconds=0; isMuted=false; isSpeaker=false;
}

// ---------------------------------------------------------------- TIMER
function startCallTimer() {
  callSeconds=0;
  if(activeCallTimerEl) activeCallTimerEl.textContent="00:00";
  callTimer = setInterval(()=>{ callSeconds++; if(activeCallTimerEl) activeCallTimerEl.textContent=formatDuration(callSeconds); },1000);
}
function stopCallTimer() { if(callTimer){clearInterval(callTimer);callTimer=null;} }
function formatDuration(s) { return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }

// ---------------------------------------------------------------- MUTE / SPEAKER
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  const icon  = muteBtn?.querySelector(".call-btn-icon");
  const label = muteBtn?.querySelector(".call-btn-label");
  if(icon)  icon.classList.toggle("muted", isMuted);
  if(label) label.textContent = isMuted ? "Unmute" : "Mute";
}

function toggleSpeaker() {
  isSpeaker = !isSpeaker;
  // setSinkId for desktop browsers that support it
  if (remoteAudio?.setSinkId) {
    remoteAudio.setSinkId(isSpeaker ? "" : "").catch(()=>{});
  }
  const icon  = speakerBtn?.querySelector(".call-btn-icon");
  const label = speakerBtn?.querySelector(".call-btn-label");
  if(icon)  icon.classList.toggle("on", isSpeaker);
  if(label) label.textContent = isSpeaker ? "Speaker On" : "Speaker";
}

// ---------------------------------------------------------------- RINGTONE
let ringtoneCtx=null, ringtoneLoop=null, ringtoneNodes=[];
function playRingtone() {
  stopRingtone();
  function beep() {
    try {
      ringtoneCtx = ringtoneCtx || new (window.AudioContext||window.webkitAudioContext)();
      if (ringtoneCtx.state==="suspended") ringtoneCtx.resume();
      [480,0].forEach((freq,i) => {
        if(!freq) return;
        const osc=ringtoneCtx.createOscillator(), gain=ringtoneCtx.createGain();
        osc.connect(gain); gain.connect(ringtoneCtx.destination);
        osc.type="sine"; osc.frequency.value=freq;
        const t=ringtoneCtx.currentTime + i*0.18;
        gain.gain.setValueAtTime(0.25,t);
        gain.gain.exponentialRampToValueAtTime(0.001,t+0.4);
        osc.start(t); osc.stop(t+0.4);
        ringtoneNodes.push(osc);
      });
    } catch(e){}
  }
  beep(); ringtoneLoop=setInterval(beep,1800);
}
function stopRingtone() {
  if(ringtoneLoop){clearInterval(ringtoneLoop);ringtoneLoop=null;}
  ringtoneNodes.forEach(n=>{try{n.stop();}catch(e){}});
  ringtoneNodes=[];
}
