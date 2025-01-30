class WebRTCHandler {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.socket = null;
    this.roomId = null;
    this.isInitiator = false;
    this.pendingCandidates = [];
    this.isNegotiating = false;
    this.makingOffer = false;
  }

  async initialize(socket, roomId, isInitiator = false) {
    try {
      if (this.peerConnection) {
        console.log("Cleaning up existing connection before initializing");
        this.cleanup();
      }

      this.socket = socket;
      this.roomId = roomId;
      this.isInitiator = isInitiator;
      this.pendingCandidates = [];
      this.isNegotiating = false;
      this.makingOffer = false;

      console.log("Initializing WebRTC:", {
        roomId: this.roomId,
        isInitiator: this.isInitiator,
        socketId: this.socket.id,
      });

      // Get local stream first
      try {
        console.log("Requesting user media...");
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("Got local stream");

        const selfVideo = document.getElementById("selfVideo");
        if (selfVideo) {
          console.log("Setting local stream to video element");
          selfVideo.srcObject = this.localStream;
          selfVideo.muted = true; // Mute local video to prevent echo

          // Properly handle the play Promise
          const playPromise = selfVideo.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log("Local video playing");
                selfVideo.parentElement.classList.add("connected");
              })
              .catch((error) => {
                console.warn("Auto-play was prevented:", error);
                // Add attributes that will help with auto-play
                selfVideo.setAttribute("autoplay", "true");
                selfVideo.setAttribute("playsinline", "true");
                // Try playing again after a short delay
                setTimeout(() => {
                  selfVideo
                    .play()
                    .then(() => {
                      console.log("Local video playing after retry");
                      selfVideo.parentElement.classList.add("connected");
                    })
                    .catch((e) =>
                      console.error("Error playing self video after retry:", e)
                    );
                }, 1000);
              });
          }
        }
      } catch (error) {
        console.error("Error accessing media devices:", error);
        const errorMessage =
          error.name === "NotAllowedError"
            ? "Camera/Mic access denied. Please grant permissions and refresh."
            : "Error accessing camera/microphone. Please check your devices.";
        document.querySelector(".partner-status").textContent = errorMessage;
        throw error;
      }

      // Setup WebRTC peer connection
      const configuration = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          {
            urls: "turn:numb.viagenie.ca",
            username: "webrtc@live.com",
            credential: "muazkh",
          },
        ],
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10,
      };

      this.peerConnection = new RTCPeerConnection(configuration);
      console.log("Created peer connection");

      // Add tracks to peer connection
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          console.log("Adding local track to peer connection:", track.kind);
          this.peerConnection.addTrack(track, this.localStream);
        });
      }

      this.setupPeerConnectionHandlers();

      // If this peer is the initiator, wait for negotiation to happen naturally
      if (this.isInitiator && !this.isNegotiating && !this.makingOffer) {
        console.log("Waiting for negotiation as initiator");
      }
    } catch (error) {
      console.error("Error in WebRTC initialization:", error);
      throw error;
    }
  }

  setupPeerConnectionHandlers() {
    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      console.log(
        "Connection state change:",
        this.peerConnection.connectionState
      );
      const statusElement = document.querySelector(".partner-status");

      switch (this.peerConnection.connectionState) {
        case "new":
          statusElement.textContent = "Setting up connection... ⚡";
          break;
        case "connecting":
          statusElement.textContent = "Connecting... ⌛";
          break;
        case "connected":
          statusElement.textContent = "Connected! 💚";
          if (this.remoteStream) {
            const remoteVideo = document.getElementById("partnerVideo");
            if (remoteVideo && !remoteVideo.srcObject) {
              console.log("Reapplying remote stream");
              remoteVideo.srcObject = this.remoteStream;
            }
          }
          break;
        case "disconnected":
          statusElement.textContent = "Connection lost... 💔";
          break;
        case "failed":
          statusElement.textContent = "Connection failed... 😢";
          console.log("Connection failed, cleaning up");
          this.cleanup();
          break;
        case "closed":
          statusElement.textContent = "Connection closed";
          break;
      }
    };

    // Handle ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "ICE Connection State:",
        this.peerConnection.iceConnectionState
      );
    };

    // Handle ICE gathering state changes
    this.peerConnection.onicegatheringstatechange = () => {
      console.log(
        "ICE Gathering State:",
        this.peerConnection.iceGatheringState
      );
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Generated ICE candidate for", event.candidate.sdpMid);
        this.socket.emit("signal", {
          type: "ice-candidate",
          candidate: event.candidate,
          roomId: this.roomId,
        });
      } else {
        console.log("All ICE candidates have been gathered");
      }
    };

    // Handle negotiation needed
    this.peerConnection.onnegotiationneeded = async () => {
      try {
        if (this.isInitiator && !this.isNegotiating && !this.makingOffer) {
          console.log("Negotiation needed - creating offer");
          this.makingOffer = true;
          await this.createOffer();
        }
      } catch (err) {
        console.error("Error during negotiation:", err);
      } finally {
        this.makingOffer = false;
      }
    };

    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      const [remoteStream] = event.streams;

      if (remoteStream) {
        console.log("Setting remote stream");
        const remoteVideo = document.getElementById("partnerVideo");

        if (remoteVideo) {
          // Store the remote stream
          this.remoteStream = remoteStream;

          // Only set srcObject if it's different from the current one
          if (remoteVideo.srcObject !== remoteStream) {
            remoteVideo.srcObject = remoteStream;

            // Add event listeners to monitor the connection
            remoteStream.onaddtrack = () => {
              console.log("Track added to remote stream");
            };

            remoteStream.onremovetrack = () => {
              console.log("Track removed from remote stream");
            };

            // Wait for loadedmetadata event before playing
            remoteVideo.onloadedmetadata = () => {
              console.log("Remote video metadata loaded");
              remoteVideo
                .play()
                .then(() => {
                  console.log("Remote video playing");
                  remoteVideo.parentElement.classList.add("connected");
                  document.querySelector(".partner-status").textContent =
                    "Connected! 💚";
                })
                .catch((error) => {
                  console.warn(
                    "Auto-play was prevented for remote video:",
                    error
                  );
                  // Add attributes that will help with auto-play
                  remoteVideo.setAttribute("autoplay", "true");
                  remoteVideo.setAttribute("playsinline", "true");
                });
            };

            // Handle errors
            remoteVideo.onerror = (error) => {
              console.error("Remote video error:", error);
            };
          } else {
            console.log("Remote stream already set to video element");
          }
        } else {
          console.error("Partner video element not found");
        }
      } else {
        console.error("No remote stream in track event");
      }
    };

    // Handle signaling
    this.signalHandler = async (data) => {
      console.log("Received signal:", data.type);
      console.log(
        "Current signaling state:",
        this.peerConnection.signalingState
      );

      try {
        if (this.peerConnection.signalingState === "closed") {
          console.log("PeerConnection is closed, ignoring signal");
          return;
        }

        if (data.type === "ice-candidate" && data.candidate) {
          try {
            if (this.peerConnection.remoteDescription) {
              await this.peerConnection.addIceCandidate(
                new RTCIceCandidate(data.candidate)
              );
              console.log("Added ICE candidate");
            } else {
              console.log("Queuing ICE candidate");
              this.pendingCandidates.push(data.candidate);
            }
          } catch (e) {
            console.error("Error handling ICE candidate:", e);
          }
        } else if (data.type === "offer") {
          try {
            const offerCollision =
              this.makingOffer ||
              this.peerConnection.signalingState !== "stable";
            const polite = !this.isInitiator;

            console.log(
              `Handling offer. Collision? ${offerCollision}. Polite? ${polite}`
            );

            if (offerCollision) {
              if (!polite) {
                console.log("Ignoring offer due to collision (impolite peer)");
                return;
              }

              // If we're polite and there's a collision, we need to rollback only if we're not in stable state
              if (this.peerConnection.signalingState !== "stable") {
                console.log("Rolling back local description");
                await this.peerConnection.setLocalDescription({
                  type: "rollback",
                });
              }
            }

            console.log("Setting remote description (offer)");
            await this.peerConnection.setRemoteDescription(
              new RTCSessionDescription({
                type: "offer",
                sdp: data.sdp,
              })
            );

            console.log("Creating answer");
            const answer = await this.peerConnection.createAnswer();

            console.log("Setting local description (answer)");
            await this.peerConnection.setLocalDescription(answer);

            console.log("Sending answer");
            this.socket.emit("signal", {
              type: "answer",
              sdp: answer.sdp,
              roomId: this.roomId,
            });

            // Process any pending ICE candidates
            await this.processPendingCandidates();
          } catch (error) {
            console.error("Error handling offer:", error);
            throw error;
          }
        } else if (data.type === "answer") {
          try {
            if (this.peerConnection.signalingState === "have-local-offer") {
              console.log("Setting remote description (answer)");
              await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription({
                  type: "answer",
                  sdp: data.sdp,
                })
              );

              // Process any pending ICE candidates
              await this.processPendingCandidates();
            } else {
              console.warn(
                "Ignoring answer: Invalid signaling state",
                this.peerConnection.signalingState
              );
            }
          } catch (error) {
            console.error("Error handling answer:", error);
            throw error;
          }
        }
      } catch (error) {
        console.error("Error handling signal:", error);
      }
    };

    this.socket.on("signal", this.signalHandler);
  }

  async processPendingCandidates() {
    if (this.pendingCandidates.length > 0) {
      console.log("Processing pending ICE candidates");
      for (const candidate of this.pendingCandidates) {
        await this.peerConnection.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
      this.pendingCandidates = [];
    }
  }

  async createOffer() {
    try {
      console.log("Creating offer");
      const offer = await this.peerConnection.createOffer();
      console.log("Setting local description (offer)");
      await this.peerConnection.setLocalDescription(offer);
      console.log("Sending offer");
      this.socket.emit("signal", {
        type: "offer",
        sdp: offer.sdp,
        roomId: this.roomId,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
      throw error;
    }
  }

  cleanup() {
    console.log("Cleaning up WebRTC connection");

    if (this.socket) {
      this.socket.off("signal", this.signalHandler);
    }

    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.onsignalingstatechange = null;
      this.peerConnection.onicegatheringstatechange = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.onnegotiationneeded = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    const selfVideo = document.getElementById("selfVideo");
    const partnerVideo = document.getElementById("partnerVideo");
    if (selfVideo) {
      selfVideo.srcObject = null;
      selfVideo.parentElement.classList.remove("connected");
    }
    if (partnerVideo) {
      partnerVideo.srcObject = null;
      partnerVideo.parentElement.classList.remove("connected");
    }
  }
}

// Export for use in app.js
window.WebRTCHandler = WebRTCHandler;
