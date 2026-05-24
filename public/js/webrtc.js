/**
 * webrtc.js — WebRTC peer connection manager for WatchTogether
 * Handles camera, microphone, screen sharing, and P2P streaming
 */

class WebRTCManager {
  constructor(signalingClient) {
    this.signaling = signalingClient;
    this.peerConnection = null;
    this.localStream = null;
    this.screenStream = null;
    this.remoteStream = null;
    this.remoteUserId = null;
    this.screenVideoSender = null;
    this.screenAudioSender = null;
    this.remoteStreamId = null;

    // State
    this.isMicOn = true;
    this.isCamOn = true;
    this.isScreenSharing = false;
    this.makingOffer = false;
    this.isPolite = false; // set during connection setup

    // Handlers
    this.handlers = {};

    // ICE servers configuration
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
    };

    // Bind signaling events
    this._bindSignalingEvents();
  }

  /**
   * Initialize local media (camera + mic)
   */
  async initLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this._emit('local-stream', this.localStream);
      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] Failed to get local media:', error);

      // Try audio-only if video fails
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          }
        });
        this.isCamOn = false;
        this._emit('local-stream', this.localStream);
        this._emit('cam-state-changed', false);
        return this.localStream;
      } catch (audioError) {
        console.error('[WebRTC] No media devices available:', audioError);
        // Create an empty stream so the connection can still work
        this.localStream = new MediaStream();
        this.isCamOn = false;
        this.isMicOn = false;
        this._emit('local-stream', this.localStream);
        return this.localStream;
      }
    }
  }

  /**
   * Create the peer connection and set up as caller (impolite) or callee (polite)
   */
  createPeerConnection(isPolite = false) {
    this.isPolite = isPolite;

    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(this.iceServers);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      const stream = event.streams[0];
      const streamId = stream?.id;
      console.log('[WebRTC] Remote track received:', event.track.kind, 'stream id:', streamId);

      // First stream we receive is the camera/mic stream
      if (!this.remoteStreamId) {
        this.remoteStreamId = streamId;
      }

      // Detect screen share: a track from a different stream than the camera stream
      if (streamId && streamId !== this.remoteStreamId) {
        // This is a screen share stream — emit the whole stream
        // (contains both video and audio from screen share)
        this._emit('remote-screen-stream', stream);
      } else {
        // Camera/mic stream
        if (!this.remoteStream) {
          this.remoteStream = stream || new MediaStream();
        } else if (stream && stream !== this.remoteStream) {
          // Same ID but different object — add track
          this.remoteStream.addTrack(event.track);
        }
        this._emit('remote-stream', this.remoteStream);
      }

      // Handle track ending
      event.track.onended = () => {
        console.log('[WebRTC] Remote track ended:', event.track.kind, 'stream:', streamId);
        if (streamId && streamId !== this.remoteStreamId) {
          // Screen share track ended
          this._emit('remote-screen-ended');
        } else {
          this.remoteStream?.removeTrack(event.track);
        }
      };

      // Handle track mute/unmute
      event.track.onmute = () => {
        this._emit('remote-track-muted', { kind: event.track.kind });
      };

      event.track.onunmute = () => {
        this._emit('remote-track-unmuted', { kind: event.track.kind });
      };
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(event.candidate, this.remoteUserId);
      }
    };

    // Handle negotiation needed (perfect negotiation pattern)
    this.peerConnection.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.peerConnection.setLocalDescription();
        this.signaling.sendOffer(this.peerConnection.localDescription, this.remoteUserId);
      } catch (err) {
        console.error('[WebRTC] Negotiation error:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('[WebRTC] Connection state:', state);
      this._emit('connection-state', state);
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      console.log('[WebRTC] ICE connection state:', state);
      this._emit('ice-state', state);

      if (state === 'failed') {
        // Attempt ICE restart
        this.peerConnection.restartIce();
      }
    };

    return this.peerConnection;
  }

  /**
   * Handle incoming offer (perfect negotiation pattern)
   */
  async handleOffer(offer, from) {
    this.remoteUserId = from;

    try {
      const offerCollision = this.makingOffer || this.peerConnection.signalingState !== 'stable';

      const ignoreOffer = !this.isPolite && offerCollision;
      if (ignoreOffer) {
        console.log('[WebRTC] Ignoring colliding offer (impolite peer)');
        return;
      }

      if (offerCollision) {
        await Promise.all([
          this.peerConnection.setLocalDescription({ type: 'rollback' }),
          this.peerConnection.setRemoteDescription(offer)
        ]);
      } else {
        await this.peerConnection.setRemoteDescription(offer);
      }

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.signaling.sendAnswer(this.peerConnection.localDescription, from);
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  }

  /**
   * Handle incoming answer
   */
  async handleAnswer(answer) {
    try {
      await this.peerConnection.setRemoteDescription(answer);
    } catch (err) {
      console.error('[WebRTC] Error handling answer:', err);
    }
  }

  /**
   * Handle incoming ICE candidate
   */
  async handleIceCandidate(candidate) {
    try {
      await this.peerConnection.addIceCandidate(candidate);
    } catch (err) {
      if (!this.isPolite || this.peerConnection.signalingState !== 'stable') {
        // Ignore errors from candidates arriving before remote description
        console.warn('[WebRTC] ICE candidate error (non-fatal):', err.message);
      }
    }
  }

  /**
   * Start an outgoing call (create offer)
   */
  async startCall(remoteUserId) {
    this.remoteUserId = remoteUserId;
    this.createPeerConnection(false); // caller is impolite

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.signaling.sendOffer(offer, remoteUserId);
    } catch (err) {
      console.error('[WebRTC] Error starting call:', err);
    }
  }

  /**
   * Prepare to receive an incoming call
   */
  prepareForIncomingCall() {
    this.createPeerConnection(true); // callee is polite
  }

  /**
   * Toggle microphone
   */
  toggleMic() {
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      this.isMicOn = audioTracks.length > 0 ? audioTracks[0].enabled : false;
      this._emit('mic-state-changed', this.isMicOn);
    }
    return this.isMicOn;
  }

  /**
   * Toggle camera
   */
  toggleCam() {
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      this.isCamOn = videoTracks.length > 0 ? videoTracks[0].enabled : false;
      this._emit('cam-state-changed', this.isCamOn);
    }
    return this.isCamOn;
  }

  /**
   * Start screen sharing with system audio
   * Camera stays active — screen share is added as a SEPARATE stream
   */
  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        },
        systemAudio: 'include'
      });

      const screenVideoTrack = this.screenStream.getVideoTracks()[0];
      const screenAudioTrack = this.screenStream.getAudioTracks()[0];

      if (this.peerConnection) {
        // ADD screen video as a NEW track (camera stays active)
        this.screenVideoSender = this.peerConnection.addTrack(screenVideoTrack, this.screenStream);

        // Add screen audio as an additional track if available
        if (screenAudioTrack) {
          this.screenAudioSender = this.peerConnection.addTrack(screenAudioTrack, this.screenStream);
        }
      }

      this.isScreenSharing = true;
      this._emit('screen-share-started', this.screenStream);
      this.signaling.notifyScreenShareStarted();

      // Handle the user stopping share via browser UI
      screenVideoTrack.onended = () => {
        this.stopScreenShare();
      };

      return this.screenStream;
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        console.log('[WebRTC] Screen share cancelled by user');
      } else {
        console.error('[WebRTC] Screen share error:', error);
      }
      throw error;
    }
  }

  /**
   * Stop screen sharing
   * Removes the screen share tracks, camera remains untouched
   */
  async stopScreenShare() {
    if (!this.isScreenSharing || !this.screenStream) return;

    // Remove screen share tracks from peer connection
    if (this.peerConnection) {
      if (this.screenVideoSender) {
        this.peerConnection.removeTrack(this.screenVideoSender);
        this.screenVideoSender = null;
      }
      if (this.screenAudioSender) {
        this.peerConnection.removeTrack(this.screenAudioSender);
        this.screenAudioSender = null;
      }
    }

    // Stop all screen share tracks
    this.screenStream.getTracks().forEach(track => track.stop());
    this.screenStream = null;
    this.isScreenSharing = false;

    this._emit('screen-share-stopped');
    this.signaling.notifyScreenShareStopped();
  }

  /**
   * Bind signaling events to WebRTC handlers
   */
  _bindSignalingEvents() {
    this.signaling.on('offer', async (data) => {
      await this.handleOffer(data.offer, data.from);
    });

    this.signaling.on('answer', async (data) => {
      await this.handleAnswer(data.answer);
    });

    this.signaling.on('ice-candidate', async (data) => {
      await this.handleIceCandidate(data.candidate);
    });
  }

  /**
   * Clean up all connections and streams
   */
  cleanup() {
    // Stop screen share
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.remoteUserId = null;
    this.remoteStreamId = null;
    this.isScreenSharing = false;
    this.screenVideoSender = null;
    this.screenAudioSender = null;
    this.isMicOn = true;
    this.isCamOn = true;
    this.makingOffer = false;
  }

  // Event system
  on(event, callback) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(callback);
  }

  off(event, callback) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== callback);
    }
  }

  _emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(handler => handler(data));
    }
  }
}

// Export as global
window.WebRTCManager = WebRTCManager;
