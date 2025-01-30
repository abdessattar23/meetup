// DOM Elements
const landingPage = document.querySelector(".landing-page");
const roomPage = document.querySelector(".room-page");
const createRoomBtn = document.querySelector(".create-room-btn");
const videoUrlInput = document.getElementById("videoUrl");
const goBtn = document.querySelector(".go-btn");
const videoPlayer = document.querySelector(".video-player");
const playPauseBtn = document.querySelector(".play-pause");
const progressBar = document.querySelector(".progress-bar");
const progress = document.querySelector(".progress");
const timestamp = document.querySelector(".timestamp");
const volumeBtn = document.querySelector(".volume-btn");
const volumeSlider = document.querySelector(".volume-slider");
const fullscreenBtn = document.querySelector(".fullscreen-btn");
const reactionBtns = document.querySelectorAll(".reaction-btn");

// State
let isPlaying = false;
let isSynced = true;
let currentTime = 0;
let duration = 0;
let socket = null;
let webrtc = null;
let player = null;
let roomId = null;

// Socket.IO Connection
function connectToServer() {
  socket = io(document.location.host, {
    secure: true,
    rejectUnauthorized: false, // Accept self-signed certificate
  });

  socket.on("connect", () => {
    console.log("Connected to server");
  });

  socket.on("room-joined", async (data) => {
    console.log("Room joined:", data);
    roomId = data.roomId;
    updateShareLink();

    try {
      // Initialize WebRTC only if we don't have a connection
      if (!webrtc) {
        webrtc = new WebRTCHandler();
        // First user is not the initiator
        await webrtc.initialize(socket, roomId, false);
        console.log("WebRTC initialized as first user");
      }

      if (data.videoUrl) {
        loadVideo(data.videoUrl);
      }

      if (data.playbackState) {
        syncPlaybackState(data.playbackState);
      }
    } catch (err) {
      console.error("Error in room-joined:", err);
      showNotification(
        "Failed to initialize video call. Please check camera permissions and try again."
      );
      webrtc = null;
    }
  });

  socket.on("partner-joined", async (data) => {
    console.log("Partner joined with data:", data);
    showNotification("Partner joined! 💕");

    try {
      // Clean up existing connection if any
      if (webrtc) {
        webrtc.cleanup();
      }

      // Create new WebRTC instance
      webrtc = new WebRTCHandler();
      await webrtc.initialize(socket, roomId, data.isInitiator);
      console.log("WebRTC initialized with isInitiator:", data.isInitiator);
    } catch (err) {
      console.error("Error in partner-joined:", err);
      showNotification(
        "Failed to establish video call. Please refresh the page."
      );
      webrtc = null;
    }
  });

  socket.on("partner-left", () => {
    console.log("Partner left");
    showNotification("Partner left 💔");
    if (webrtc) {
      webrtc.cleanup();
      webrtc = null;
    }
    document.querySelector(".partner-status").textContent =
      "Waiting for partner... ❤️";
  });

  socket.on("room-full", () => {
    console.log("Room is full");
    showNotification("Room is full 😔");
    navigateToLandingPage();
  });

  socket.on("video-url", (url) => {
    loadVideo(url);
  });

  socket.on("playback-state", (state) => {
    syncPlaybackState(state);
  });

  socket.on("reaction", (emoji) => {
    animateReaction(emoji);
  });
}

// YouTube Player Integration
function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    videoId: "",
    playerVars: {
      playsinline: 1,
      controls: 0,
      rel: 0,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
  });
}

function onPlayerReady(event) {
  // Player is ready
  console.log("Player ready");
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    isPlaying = true;
    updatePlayPauseButton();
    emitPlaybackState();
  } else if (event.data === YT.PlayerState.PAUSED) {
    isPlaying = false;
    updatePlayPauseButton();
    emitPlaybackState();
  }
}

function loadVideo(url) {
  const videoId = extractYouTubeId(url);
  if (videoId && player) {
    player.loadVideoById(videoId);
    videoUrlInput.value = url;
  }
}

function extractYouTubeId(url) {
  const regex =
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Room Creation
createRoomBtn.addEventListener("click", () => {
  socket.emit("join-room");
});

function updateShareLink() {
  const shareUrl = `${window.location.origin}?room=${roomId}`;
  // Update URL without reloading
  window.history.pushState({}, "", `?room=${roomId}`);
  showNotification(`Room created! Share this link: ${shareUrl}`);
}

// Video Player Controls
playPauseBtn.addEventListener("click", togglePlayPause);
progressBar.addEventListener("click", seek);
volumeSlider.addEventListener("input", adjustVolume);
fullscreenBtn.addEventListener("click", toggleFullscreen);

function togglePlayPause() {
  if (player) {
    if (isPlaying) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }
}

function seek(e) {
  if (player) {
    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = pos * player.getDuration();
    player.seekTo(newTime, true);
    emitPlaybackState();
  }
}

function adjustVolume(e) {
  const volume = e.target.value;
  if (player) {
    player.setVolume(volume);
  }
  updateVolumeIcon(volume);
}

function updatePlayPauseButton() {
  const playIcon = playPauseBtn.querySelector(".play-icon");
  const pauseIcon = playPauseBtn.querySelector(".pause-icon");

  if (isPlaying) {
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
  } else {
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
  }
}

function updateVolumeIcon(volume) {
  volumeBtn.textContent = volume > 50 ? "🔊" : volume > 0 ? "🔉" : "🔇";
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    videoPlayer.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

// Reactions
reactionBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    sendReaction(btn.textContent);
    animateReaction(btn.textContent);
  });
});

function sendReaction(emoji) {
  socket.emit("reaction", emoji);
  animateReaction(emoji);
}

function animateReaction(emoji) {
  const reaction = document.createElement("div");
  reaction.textContent = emoji;
  reaction.style.cssText = `
        position: fixed;
        font-size: 2rem;
        pointer-events: none;
        animation: float 2s ease-out forwards;
        z-index: 999;
    `;

  // Random position near the video call window
  const videoCall = document.querySelector(".video-call");
  const rect = videoCall.getBoundingClientRect();
  reaction.style.left = `${rect.left + Math.random() * rect.width}px`;
  reaction.style.top = `${rect.top + rect.height / 2}px`;

  document.body.appendChild(reaction);

  reaction.addEventListener("animationend", () => {
    reaction.remove();
  });
}

// Sync Functions
function emitPlaybackState() {
  if (socket && player) {
    socket.emit("playback-state", {
      isPlaying,
      currentTime: player.getCurrentTime(),
    });
  }
}

function syncPlaybackState(state) {
  if (player) {
    if (state.isPlaying) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }

    // Only seek if time difference is significant
    const timeDiff = Math.abs(player.getCurrentTime() - state.currentTime);
    if (timeDiff > 1) {
      player.seekTo(state.currentTime, true);
    }
  }
}

// Notifications
function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// Initialize on page load
window.addEventListener("load", () => {
  connectToServer();

  // Check if user arrived via shared link
  const params = new URLSearchParams(window.location.search);
  const sharedRoomId = params.get("room");

  if (sharedRoomId) {
    navigateToRoom(sharedRoomId);
    socket.emit("join-room", sharedRoomId);
  }
});

// Room Navigation
function navigateToRoom(newRoomId) {
  landingPage.classList.add("hidden");
  roomPage.classList.remove("hidden");

  // Cleanup existing WebRTC if any
  if (webrtc) {
    webrtc.cleanup();
    webrtc = null;
  }

  // WebRTC will be initialized when receiving room-joined event
  socket.emit("join-room", newRoomId);
}

function navigateToLandingPage() {
  landingPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
  if (webrtc) {
    webrtc.cleanup();
    webrtc = null;
  }
  if (player) {
    player.destroy();
    player = null;
  }
}

// URL Input
goBtn.addEventListener("click", () => {
  const url = videoUrlInput.value.trim();
  if (url) {
    socket.emit("video-url", url);
    loadVideo(url);
  }
});

// Add notification styles
const notificationStyles = document.createElement("style");
notificationStyles.textContent = `
    .notification {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--primary);
        color: var(--background);
        padding: 1rem 2rem;
        border-radius: 30px;
        z-index: 1000;
        animation: slideDown 0.3s ease-out;
    }
    
    @keyframes slideDown {
        from {
            transform: translate(-50%, -100%);
            opacity: 0;
        }
        to {
            transform: translate(-50%, 0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(notificationStyles);

// Add floating animation
const style = document.createElement("style");
style.textContent = `
    @keyframes float {
        0% {
            transform: translateY(0) scale(1);
            opacity: 1;
        }
        100% {
            transform: translateY(-100px) scale(1.5);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Make self-video draggable
const selfVideo = document.querySelector(".self-video");
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

selfVideo.addEventListener("mousedown", dragStart);
document.addEventListener("mousemove", drag);
document.addEventListener("mouseup", dragEnd);

function dragStart(e) {
  initialX = e.clientX - xOffset;
  initialY = e.clientY - yOffset;

  if (e.target === selfVideo) {
    isDragging = true;
  }
}

function drag(e) {
  if (isDragging) {
    e.preventDefault();

    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;

    xOffset = currentX;
    yOffset = currentY;

    setTranslate(currentX, currentY, selfVideo);
  }
}

function dragEnd(e) {
  initialX = currentX;
  initialY = currentY;

  isDragging = false;
}

function setTranslate(xPos, yPos, el) {
  el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
}
