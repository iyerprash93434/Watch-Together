/**
 * app.js — Main application logic for WatchTogether
 * Handles UI management, view transitions, chat, and user interactions
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────
  let signaling = null;
  let webrtc = null;
  let currentView = 'landing';
  let callTimerInterval = null;
  let callStartTime = null;
  let typingTimeout = null;
  let isTyping = false;
  let unreadMessages = 0;
  let isChatOpen = false;

  // ─── DOM Elements ──────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const views = {
    landing: $('landing-view'),
    lobby: $('lobby-view'),
    call: $('call-view')
  };

  // Landing
  const btnCreateRoom = $('btn-create-room');
  const btnJoinRoom = $('btn-join-room');
  const inputRoomCode = $('input-room-code');

  // Lobby
  const roomCodeText = $('room-code-text');
  const btnCopyCode = $('btn-copy-code');
  const btnLeaveLobby = $('btn-leave-lobby');
  const previewVideo = $('preview-video');
  const previewOverlay = $('preview-overlay');
  const btnToggleMicPreview = $('btn-toggle-mic-preview');
  const btnToggleCamPreview = $('btn-toggle-cam-preview');
  const waitingStatus = $('waiting-status');

  // Call
  const callRoomCode = $('call-room-code');
  const connectionStatus = $('connection-status');
  const callTimer = $('call-timer');
  const localVideo = $('local-video');
  const remoteVideo = $('remote-video');
  const screenShareVideo = $('screen-share-video');
  const screenShareWrapper = $('screen-share-wrapper');
  const localVideoWrapper = $('local-video-wrapper');
  const remoteVideoWrapper = $('remote-video-wrapper');
  const videoGrid = $('video-grid');
  const localCamOff = $('local-cam-off');
  const remoteCamOff = $('remote-cam-off');

  // Call controls
  const btnToggleMic = $('btn-toggle-mic');
  const btnToggleCam = $('btn-toggle-cam');
  const btnToggleScreen = $('btn-toggle-screen');
  const btnToggleChat = $('btn-toggle-chat');
  const btnLeaveCall = $('btn-leave-call');

  // Chat
  const chatPanel = $('chat-panel');
  const chatMessages = $('chat-messages');
  const chatInput = $('chat-input');
  const btnSendChat = $('btn-send-chat');
  const btnCloseChat = $('btn-close-chat');
  const chatBadge = $('chat-badge');
  const typingIndicator = $('typing-indicator');

  // ─── View Management ───────────────────────────────
  function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
    currentView = viewName;
  }

  // ─── Toast Notifications ──────────────────────────
  function showToast(message, type = 'info', duration = 4000) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── Initialize ────────────────────────────────────
  async function init() {
    signaling = new SignalingClient();
    await signaling.connect();

    webrtc = new WebRTCManager(signaling);

    bindLandingEvents();
    bindLobbyEvents();
    bindCallEvents();
    bindChatEvents();
    bindWebRTCEvents();
    bindSignalingRoomEvents();

    // Format room code input
    inputRoomCode.addEventListener('input', () => {
      inputRoomCode.value = inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // Allow Enter key to join room
    inputRoomCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnJoinRoom.click();
      }
    });
  }

  // ─── Landing Events ───────────────────────────────
  function bindLandingEvents() {
    btnCreateRoom.addEventListener('click', async () => {
      btnCreateRoom.disabled = true;
      btnCreateRoom.textContent = 'Creating...';

      try {
        // Start camera preview early
        await webrtc.initLocalMedia();

        const roomCode = await signaling.createRoom();
        roomCodeText.textContent = roomCode;

        // Show preview
        if (webrtc.localStream) {
          previewVideo.srcObject = webrtc.localStream;
          previewOverlay.classList.add('hidden');
        }

        switchView('lobby');
        showToast('Room created! Share the code with your partner', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to create room', 'error');
      } finally {
        btnCreateRoom.disabled = false;
        btnCreateRoom.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Create Room
        `;
      }
    });

    btnJoinRoom.addEventListener('click', async () => {
      const code = inputRoomCode.value.trim();
      if (!code || code.length < 4) {
        showToast('Please enter a valid room code', 'warning');
        inputRoomCode.focus();
        return;
      }

      btnJoinRoom.disabled = true;
      btnJoinRoom.textContent = 'Joining...';

      try {
        await webrtc.initLocalMedia();
        const roomCode = await signaling.joinRoom(code);

        // The "user-joined" event on the OTHER side will trigger WebRTC setup
        // On this side, we are the joiner — we'll be the caller (impolite)
        roomCodeText.textContent = roomCode;
        callRoomCode.textContent = `Room: ${roomCode}`;

        // Go directly to call view since the other user is already there
        if (webrtc.localStream) {
          localVideo.srcObject = webrtc.localStream;
        }

        // We are joining, so we initiate the call
        // The existing user in the room has already set up to receive
        switchView('call');
        startCallTimer();
        showToast('Joined room! Connecting...', 'success');

        // Start call — the other user's ID will come from the signaling events
        webrtc.createPeerConnection(false); // joiner is impolite (caller)

      } catch (err) {
        showToast(err.message || 'Failed to join room', 'error');
      } finally {
        btnJoinRoom.disabled = false;
        btnJoinRoom.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
          </svg>
          Join Room
        `;
      }
    });
  }

  // ─── Lobby Events ─────────────────────────────────
  function bindLobbyEvents() {
    btnCopyCode.addEventListener('click', async () => {
      const code = roomCodeText.textContent;
      try {
        await navigator.clipboard.writeText(code);
        showToast('Room code copied!', 'success', 2000);
        btnCopyCode.classList.add('copied');
        setTimeout(() => btnCopyCode.classList.remove('copied'), 2000);
      } catch {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
        showToast('Room code copied!', 'success', 2000);
      }
    });

    btnToggleMicPreview.addEventListener('click', () => {
      const isOn = webrtc.toggleMic();
      updateMicButtonState(btnToggleMicPreview, isOn);
    });

    btnToggleCamPreview.addEventListener('click', () => {
      const isOn = webrtc.toggleCam();
      updateCamButtonState(btnToggleCamPreview, isOn);
      previewOverlay.classList.toggle('hidden', isOn);
    });

    btnLeaveLobby.addEventListener('click', () => {
      signaling.leaveRoom();
      webrtc.cleanup();
      previewVideo.srcObject = null;
      switchView('landing');
      showToast('Left the room', 'info');
    });
  }

  // ─── Call Events ──────────────────────────────────
  function bindCallEvents() {
    btnToggleMic.addEventListener('click', () => {
      const isOn = webrtc.toggleMic();
      updateMicButtonState(btnToggleMic, isOn);
      btnToggleMic.classList.toggle('active', !isOn);
    });

    btnToggleCam.addEventListener('click', () => {
      const isOn = webrtc.toggleCam();
      updateCamButtonState(btnToggleCam, isOn);
      btnToggleCam.classList.toggle('active', !isOn);
      localCamOff.classList.toggle('hidden', isOn);
    });

    btnToggleScreen.addEventListener('click', async () => {
      if (webrtc.isScreenSharing) {
        await webrtc.stopScreenShare();
      } else {
        try {
          await webrtc.startScreenShare();
        } catch (err) {
          if (err.name !== 'NotAllowedError') {
            showToast('Failed to start screen sharing', 'error');
          }
        }
      }
    });

    btnToggleChat.addEventListener('click', () => {
      isChatOpen = !isChatOpen;
      chatPanel.classList.toggle('open', isChatOpen);
      btnToggleChat.classList.toggle('active', isChatOpen);
      videoGrid.classList.toggle('chat-open', isChatOpen);

      if (isChatOpen) {
        unreadMessages = 0;
        chatBadge.classList.add('hidden');
        chatInput.focus();
        scrollChatToBottom();
      }
    });

    btnLeaveCall.addEventListener('click', () => {
      leaveCall();
    });
  }

  // ─── Chat Events ──────────────────────────────────
  function bindChatEvents() {
    btnSendChat.addEventListener('click', sendMessage);

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Typing indicator
    chatInput.addEventListener('input', () => {
      if (!isTyping) {
        isTyping = true;
        signaling.sendTyping();
      }

      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        isTyping = false;
        signaling.sendStopTyping();
      }, 1500);
    });

    btnCloseChat.addEventListener('click', () => {
      isChatOpen = false;
      chatPanel.classList.remove('open');
      btnToggleChat.classList.remove('active');
      videoGrid.classList.remove('chat-open');
    });
  }

  function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // Add to local chat
    addChatBubble(message, 'sent');

    // Send to remote
    signaling.sendChatMessage(message);

    chatInput.value = '';
    chatInput.focus();

    // Stop typing
    isTyping = false;
    signaling.sendStopTyping();
  }

  function addChatBubble(message, type, timestamp) {
    const emptyState = chatMessages.querySelector('.chat-empty-state');
    if (emptyState) emptyState.remove();

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;

    const time = timestamp ? new Date(timestamp) : new Date();
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    bubble.innerHTML = `
      <p class="bubble-text">${escapeHtml(message)}</p>
      <span class="bubble-time">${timeStr}</span>
    `;

    chatMessages.appendChild(bubble);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Signaling Room Events ─────────────────────────
  function bindSignalingRoomEvents() {
    // When another user joins the room we're in
    signaling.on('user-joined', (data) => {
      console.log('[App] User joined:', data.userId);
      webrtc.remoteUserId = data.userId;

      // If we're in the lobby, transition to call
      if (currentView === 'lobby') {
        callRoomCode.textContent = `Room: ${signaling.roomCode}`;

        if (webrtc.localStream) {
          localVideo.srcObject = webrtc.localStream;
        }

        switchView('call');
        startCallTimer();
        showToast('Partner joined! 🎉', 'success');

        // We're the room creator (polite peer), prepare to receive the call
        webrtc.prepareForIncomingCall();
      } else if (currentView === 'call') {
        // We're the joiner and the room creator just acknowledged us
        // This triggers negotiation via onnegotiationneeded
        showToast('Connected to partner! 🎉', 'success');
      }
    });

    // When a user leaves
    signaling.on('user-left', (data) => {
      console.log('[App] User left:', data.userId);
      showToast('Your partner left the call', 'warning');

      // Clean up remote video
      remoteVideo.srcObject = null;
      remoteCamOff.classList.remove('hidden');

      // Hide screen share if active and restore layout
      screenShareWrapper.classList.add('hidden');
      videoGrid.classList.remove('screen-active');
      localVideoWrapper.classList.remove('pip');
      remoteVideoWrapper.classList.remove('pip');

      updateConnectionStatus('disconnected');
    });

    // Chat messages from remote
    signaling.on('chat-message', (data) => {
      addChatBubble(data.message, 'received', data.timestamp);

      if (!isChatOpen) {
        unreadMessages++;
        chatBadge.textContent = unreadMessages;
        chatBadge.classList.remove('hidden');
        showToast(`💬 ${data.message.substring(0, 50)}${data.message.length > 50 ? '...' : ''}`, 'info', 3000);
      }
    });

    // Typing indicator
    signaling.on('peer-typing', () => {
      typingIndicator.classList.remove('hidden');
      scrollChatToBottom();
    });

    signaling.on('peer-stop-typing', () => {
      typingIndicator.classList.add('hidden');
    });

    // Screen share events from remote
    signaling.on('peer-screen-share-started', () => {
      showToast('Partner started screen sharing 🖥️', 'info');
    });

    signaling.on('peer-screen-share-stopped', () => {
      showToast('Partner stopped screen sharing', 'info');
      screenShareWrapper.classList.add('hidden');
      screenShareVideo.srcObject = null;
      videoGrid.classList.remove('screen-active');
      localVideoWrapper.classList.remove('pip');
      remoteVideoWrapper.classList.remove('pip');
    });
  }

  // ─── WebRTC Events ─────────────────────────────────
  function bindWebRTCEvents() {
    webrtc.on('local-stream', (stream) => {
      localVideo.srcObject = stream;
    });

    webrtc.on('remote-stream', (stream) => {
      remoteVideo.srcObject = stream;
      remoteCamOff.classList.add('hidden');
    });

    // Remote screen share stream received (contains video + audio)
    webrtc.on('remote-screen-stream', (stream) => {
      screenShareVideo.srcObject = stream;
      screenShareWrapper.classList.remove('hidden');

      // Teams-like layout: screen share center, both cameras as PiP
      videoGrid.classList.add('screen-active');
      localVideoWrapper.classList.add('pip');
      remoteVideoWrapper.classList.add('pip');
    });

    // Remote screen share ended (track ended)
    webrtc.on('remote-screen-ended', () => {
      screenShareWrapper.classList.add('hidden');
      screenShareVideo.srcObject = null;
      videoGrid.classList.remove('screen-active');
      localVideoWrapper.classList.remove('pip');
      remoteVideoWrapper.classList.remove('pip');
    });

    webrtc.on('connection-state', (state) => {
      updateConnectionStatus(state);
    });

    // Local screen share started — camera stays visible as PiP
    webrtc.on('screen-share-started', (stream) => {
      btnToggleScreen.classList.add('active');
      screenShareVideo.srcObject = stream;
      screenShareWrapper.classList.remove('hidden');

      // Teams-like layout: screen share center, both cameras as PiP
      videoGrid.classList.add('screen-active');
      localVideoWrapper.classList.add('pip');
      remoteVideoWrapper.classList.add('pip');

      showToast('Screen sharing started. Your partner can see your screen!', 'success');
    });

    // Local screen share stopped — restore normal layout
    webrtc.on('screen-share-stopped', () => {
      btnToggleScreen.classList.remove('active');
      screenShareVideo.srcObject = null;
      screenShareWrapper.classList.add('hidden');

      // Restore normal side-by-side layout
      videoGrid.classList.remove('screen-active');
      localVideoWrapper.classList.remove('pip');
      remoteVideoWrapper.classList.remove('pip');

      showToast('Screen sharing stopped', 'info');
    });

    webrtc.on('cam-state-changed', (isOn) => {
      localCamOff.classList.toggle('hidden', isOn);
    });

    webrtc.on('remote-track-muted', (data) => {
      if (data.kind === 'video') {
        remoteCamOff.classList.remove('hidden');
      }
    });

    webrtc.on('remote-track-unmuted', (data) => {
      if (data.kind === 'video') {
        remoteCamOff.classList.add('hidden');
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────
  function updateConnectionStatus(state) {
    const dot = connectionStatus.querySelector('.status-dot');
    const text = connectionStatus.querySelector('.status-text');

    dot.className = 'status-dot';

    switch (state) {
      case 'connected':
        dot.classList.add('connected');
        text.textContent = 'Connected';
        break;
      case 'connecting':
      case 'new':
        dot.classList.add('connecting');
        text.textContent = 'Connecting...';
        break;
      case 'disconnected':
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
        break;
      case 'failed':
        dot.classList.add('disconnected');
        text.textContent = 'Connection failed';
        showToast('Connection failed. Try refreshing the page.', 'error');
        break;
      case 'closed':
        dot.classList.add('disconnected');
        text.textContent = 'Closed';
        break;
      default:
        dot.classList.add('connecting');
        text.textContent = state || 'Unknown';
    }
  }

  function updateMicButtonState(btn, isOn) {
    const iconOn = btn.querySelector('.icon-mic-on');
    const iconOff = btn.querySelector('.icon-mic-off');
    if (iconOn && iconOff) {
      iconOn.classList.toggle('hidden', !isOn);
      iconOff.classList.toggle('hidden', isOn);
    }
  }

  function updateCamButtonState(btn, isOn) {
    const iconOn = btn.querySelector('.icon-cam-on');
    const iconOff = btn.querySelector('.icon-cam-off');
    if (iconOn && iconOff) {
      iconOn.classList.toggle('hidden', !isOn);
      iconOff.classList.toggle('hidden', isOn);
    }
  }

  function startCallTimer() {
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      callTimer.textContent = `${minutes}:${seconds}`;
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    callTimer.textContent = '00:00';
  }

  function leaveCall() {
    stopCallTimer();
    webrtc.cleanup();
    signaling.leaveRoom();

    // Reset UI
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    screenShareVideo.srcObject = null;
    previewVideo.srcObject = null;
    screenShareWrapper.classList.add('hidden');
    videoGrid.classList.remove('screen-active', 'chat-open');
    localVideoWrapper.classList.remove('pip');
    remoteVideoWrapper.classList.remove('pip');
    chatPanel.classList.remove('open');
    isChatOpen = false;
    unreadMessages = 0;

    // Reset chat
    chatMessages.innerHTML = `
      <div class="chat-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <p>No messages yet.<br>Say hi! 👋</p>
      </div>
    `;

    // Reset button states
    btnToggleMic.classList.remove('active');
    btnToggleCam.classList.remove('active');
    btnToggleScreen.classList.remove('active');
    btnToggleChat.classList.remove('active');

    switchView('landing');
    showToast('You left the call', 'info');
  }

  // ─── Start the app ─────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
