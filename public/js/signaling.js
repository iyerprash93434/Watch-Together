/**
 * signaling.js — Socket.IO signaling client for WatchTogether
 * Handles room management and WebRTC signaling relay
 */

class SignalingClient {
  constructor() {
    this.socket = null;
    this.roomCode = null;
    this.handlers = {};
  }

  /**
   * Connect to the signaling server
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      this.socket.on('connect', () => {
        console.log('[Signaling] Connected:', this.socket.id);
        this._emit('connected', { id: this.socket.id });
        resolve(this.socket.id);
      });

      this.socket.on('connect_error', (err) => {
        console.error('[Signaling] Connection error:', err.message);
        this._emit('connection-error', { error: err.message });
        reject(err);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Signaling] Disconnected:', reason);
        this._emit('disconnected', { reason });
      });

      this.socket.on('reconnect', (attempt) => {
        console.log('[Signaling] Reconnected after', attempt, 'attempts');
        this._emit('reconnected', { attempt });
      });

      // WebRTC signaling events
      this.socket.on('offer', (data) => this._emit('offer', data));
      this.socket.on('answer', (data) => this._emit('answer', data));
      this.socket.on('ice-candidate', (data) => this._emit('ice-candidate', data));

      // Room events
      this.socket.on('user-joined', (data) => this._emit('user-joined', data));
      this.socket.on('user-left', (data) => this._emit('user-left', data));

      // Screen share events
      this.socket.on('peer-screen-share-started', (data) => this._emit('peer-screen-share-started', data));
      this.socket.on('peer-screen-share-stopped', (data) => this._emit('peer-screen-share-stopped', data));

      // Chat events
      this.socket.on('chat-message', (data) => this._emit('chat-message', data));
      this.socket.on('peer-typing', () => this._emit('peer-typing'));
      this.socket.on('peer-stop-typing', () => this._emit('peer-stop-typing'));
    });
  }

  /**
   * Create a new room
   */
  createRoom() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-room', (response) => {
        if (response.success) {
          this.roomCode = response.roomCode;
          console.log('[Signaling] Room created:', this.roomCode);
          resolve(response.roomCode);
        } else {
          reject(new Error(response.error || 'Failed to create room'));
        }
      });
    });
  }

  /**
   * Join an existing room
   */
  joinRoom(roomCode) {
    return new Promise((resolve, reject) => {
      this.socket.emit('join-room', roomCode, (response) => {
        if (response.success) {
          this.roomCode = response.roomCode;
          console.log('[Signaling] Joined room:', this.roomCode);
          resolve(response.roomCode);
        } else {
          reject(new Error(response.error || 'Failed to join room'));
        }
      });
    });
  }

  /**
   * Send WebRTC offer
   */
  sendOffer(offer, to) {
    if (to) {
      this.socket.emit('offer', { offer, to });
    } else {
      this.socket.emit('offer-to-room', { offer });
    }
  }

  /**
   * Send WebRTC answer
   */
  sendAnswer(answer, to) {
    if (to) {
      this.socket.emit('answer', { answer, to });
    } else {
      this.socket.emit('answer-to-room', { answer });
    }
  }

  /**
   * Send ICE candidate
   */
  sendIceCandidate(candidate, to) {
    if (to) {
      this.socket.emit('ice-candidate', { candidate, to });
    } else {
      this.socket.emit('ice-candidate-to-room', { candidate });
    }
  }

  /**
   * Notify screen share started
   */
  notifyScreenShareStarted() {
    this.socket.emit('screen-share-started');
  }

  /**
   * Notify screen share stopped
   */
  notifyScreenShareStopped() {
    this.socket.emit('screen-share-stopped');
  }

  /**
   * Send chat message
   */
  sendChatMessage(message) {
    this.socket.emit('chat-message', { message });
  }

  /**
   * Send typing indicator
   */
  sendTyping() {
    this.socket.emit('typing');
  }

  /**
   * Send stop typing indicator
   */
  sendStopTyping() {
    this.socket.emit('stop-typing');
  }

  /**
   * Leave the current room
   */
  leaveRoom() {
    if (this.socket) {
      this.socket.emit('leave-room');
      this.roomCode = null;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.roomCode = null;
    }
  }

  /**
   * Register an event handler
   */
  on(event, callback) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(callback);
  }

  /**
   * Remove event handler
   */
  off(event, callback) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== callback);
    }
  }

  /**
   * Emit to internal handlers
   */
  _emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(handler => handler(data));
    }
  }

  /**
   * Get socket ID
   */
  get id() {
    return this.socket?.id || null;
  }
}

// Export as global
window.SignalingClient = SignalingClient;
