const API_URL = "/api/song";
const CURRENT_SONG_URL = "/api/song/current";

const state = {
  title: "尚未設定歌曲",
  updatedAt: null,
  currentSongId: null,
  songs: [],
  tracks: [],
  audios: new Map(),
  isPlaying: false,
  timer: 0,
};

const els = {
  adminToggle: document.querySelector("#admin-toggle"),
  playerView: document.querySelector("#player-view"),
  adminView: document.querySelector("#admin-view"),
  title: document.querySelector("#song-title"),
  year: document.querySelector("#song-year"),
  updated: document.querySelector("#song-updated"),
  status: document.querySelector("#player-status"),
  tracksList: document.querySelector("#tracks-list"),
  playToggle: document.querySelector("#play-toggle"),
  backward: document.querySelector("#backward"),
  forward: document.querySelector("#forward"),
  progress: document.querySelector("#progress"),
  currentTime: document.querySelector("#current-time"),
  duration: document.querySelector("#duration"),
  uploadForm: document.querySelector("#upload-form"),
  uploadStatus: document.querySelector("#upload-status"),
  adminTitle: document.querySelector("#admin-title"),
  currentSongForm: document.querySelector("#current-song-form"),
  currentSongSelect: document.querySelector("#current-song-select"),
  currentSongStatus: document.querySelector("#current-song-status"),
};

init();

async function init() {
  bindEvents();
  setPlayerEnabled(false);
  await loadSong();
}

function bindEvents() {
  els.adminToggle.addEventListener("click", () => {
    showAdmin(els.adminView.classList.contains("is-hidden"));
  });
  els.playToggle.addEventListener("click", togglePlay);
  els.backward.addEventListener("click", () => seekBy(-10));
  els.forward.addEventListener("click", () => seekBy(10));
  els.progress.addEventListener("input", () => seekTo(Number(els.progress.value)));
  els.uploadForm.addEventListener("submit", uploadSong);
  els.currentSongForm.addEventListener("submit", switchCurrentSong);
}

async function loadSong() {
  renderLoading();

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("song api unavailable");

    const song = await response.json();
    state.title = song.title;
    state.updatedAt = song.updated_at;
    state.currentSongId = song.current_song_id;
    state.songs = normalizeSongs(song.songs);
    state.tracks = normalizeTracks(song.tracks);
    setupAudios();
    renderSong();
  } catch {
    state.title = "讀取歌曲失敗";
    state.updatedAt = null;
    state.currentSongId = null;
    state.songs = [];
    state.tracks = [];
    renderSong();
    els.status.textContent = "無法讀取 /api/song，請確認 server.js 是否正在執行。";
  }
}

function normalizeSongs(songs = []) {
  return songs.filter((song) => song.id && song.title);
}

function normalizeTracks(tracks = []) {
  return tracks
    .filter((track) => track.name && track.audio_url)
    .map((track) => ({
      name: track.name,
      audioUrl: track.audio_url,
      volume: clamp(Number(track.volume ?? 0.8), 0, 1),
      muted: false,
    }));
}

function setupAudios() {
  stopTimer();
  state.audios.forEach((audio) => audio.pause());
  state.audios.clear();

  state.tracks.forEach((track) => {
    const audio = new Audio(track.audioUrl);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("ended", handleEnded);
    state.audios.set(track.name, audio);
  });

  applyVolumes();
  setPlayerEnabled(state.tracks.length > 0);
}

function renderLoading() {
  els.title.textContent = "載入中";
  els.updated.textContent = "正在讀取歌曲資料";
  els.status.textContent = "讀取音檔中";
  els.tracksList.innerHTML = "";
}

function renderSong() {
  els.title.textContent = state.title;
  els.year.textContent = "目前指定曲";
  els.updated.textContent = state.updatedAt ? `最後更新：${state.updatedAt}` : "尚未有更新時間";
  els.adminTitle.value = state.title === "讀取歌曲失敗" ? "" : state.title;
  renderCurrentSongOptions();

  if (!state.tracks.length) {
    els.tracksList.innerHTML = `<div class="empty-state">目前沒有聲部音檔，請到管理介面上傳。</div>`;
    setPlayerEnabled(false);
    return;
  }

  els.status.textContent = "歌曲資料已載入";
  els.tracksList.innerHTML = state.tracks.map(renderTrack).join("");
  els.tracksList.querySelectorAll("[data-volume]").forEach((input) => {
    input.addEventListener("input", updateTrackVolume);
  });
  els.tracksList.querySelectorAll("[data-mute]").forEach((button) => {
    button.addEventListener("click", toggleMute);
  });
  els.tracksList.querySelectorAll("[data-solo]").forEach((button) => {
    button.addEventListener("click", setSolo);
  });
  setPlayerEnabled(true);
  updateDuration();
}

function renderCurrentSongOptions() {
  if (!state.songs.length) {
    els.currentSongSelect.innerHTML = `<option value="">沒有歌曲</option>`;
    els.currentSongSelect.disabled = true;
    els.currentSongForm.querySelector("button").disabled = true;
    els.currentSongStatus.textContent = "目前沒有可選擇的歌曲";
    return;
  }

  els.currentSongSelect.disabled = false;
  els.currentSongForm.querySelector("button").disabled = false;
  els.currentSongSelect.innerHTML = state.songs
    .map((song) => `<option value="${escapeHtml(song.id)}">${escapeHtml(song.title)}</option>`)
    .join("");
  els.currentSongSelect.value = state.currentSongId ?? state.songs[0].id;
  els.currentSongStatus.textContent = "請選擇要顯示的歌曲";
}

function renderTrack(track) {
  const name = escapeHtml(track.name);
  const muteClass = track.muted ? "small-button is-active" : "small-button";
  const disabled = track.muted ? " disabled" : "";
  const status = track.muted ? "已靜音" : "播放中";
  const volumePercent = Math.round(track.volume * 100);

  return `
    <article class="track-card">
      <div>
        <h3 class="track-name">${name}</h3>
        <div class="track-controls">
          <button class="${muteClass}" type="button" data-mute="${name}">Mute</button>
          <button class="small-button" type="button" data-solo="${name}"${disabled}>Solo</button>
        </div>
      </div>
      <label class="volume-wrap">
        <span class="meta-text">音量</span>
        <span class="volume-line">
          <input type="range" min="0" max="1" step="0.01" value="${track.volume}" data-volume="${name}" aria-label="${name} 音量"${disabled}>
          <span class="volume-value">${volumePercent}%</span>
        </span>
      </label>
      <span class="status-text">${status}</span>
    </article>
  `;
}

async function togglePlay() {
  if (!state.tracks.length) return;

  if (state.isPlaying) {
    pauseAll();
    return;
  }

  const current = getCurrentTime();
  state.audios.forEach((audio) => {
    audio.currentTime = current;
  });

  try {
    await Promise.all([...state.audios.values()].map((audio) => audio.play()));
    state.isPlaying = true;
    els.playToggle.textContent = "暫停";
    startTimer();
  } catch {
    els.status.textContent = "播放被瀏覽器擋下，請再按一次播放。";
  }
}

function pauseAll() {
  state.audios.forEach((audio) => audio.pause());
  state.isPlaying = false;
  els.playToggle.textContent = "播放";
  stopTimer();
}

function seekBy(seconds) {
  seekTo(clamp(getCurrentTime() + seconds, 0, getDuration()));
}

function seekTo(seconds) {
  state.audios.forEach((audio) => {
    audio.currentTime = seconds;
  });
  updateProgress();
}

function updateTrackVolume(event) {
  const track = getTrack(event.target.dataset.volume);
  if (!track) return;

  track.volume = Number(event.target.value);
  event.target.nextElementSibling.textContent = `${Math.round(track.volume * 100)}%`;
  applyVolumes();
}

function toggleMute(event) {
  const track = getTrack(event.target.dataset.mute);
  if (!track) return;

  track.muted = !track.muted;
  applyVolumes();
  renderSong();
}

function setSolo(event) {
  const soloName = event.target.dataset.solo;
  state.tracks.forEach((track) => {
    track.volume = track.name === soloName ? 0.9 : 0.2;
  });
  applyVolumes();
  renderSong();
}

function applyVolumes() {
  state.tracks.forEach((track) => {
    const audio = state.audios.get(track.name);
    if (!audio) return;

    if (track.muted) {
      audio.volume = 0;
    } else {
      audio.volume = track.volume;
    }
  });
}

function updateDuration() {
  const duration = getDuration();
  els.progress.max = duration;
  els.duration.textContent = formatTime(duration);
  updateProgress();
}

function updateProgress() {
  const current = getCurrentTime();
  els.progress.value = current;
  els.currentTime.textContent = formatTime(current);
}

function startTimer() {
  stopTimer();
  state.timer = window.setInterval(updateProgress, 250);
}

function stopTimer() {
  window.clearInterval(state.timer);
  state.timer = 0;
}

function handleEnded() {
  if (getCurrentTime() >= getDuration() - 0.2) {
    pauseAll();
    seekTo(0);
  }
}

async function uploadSong(event) {
  event.preventDefault();
  els.uploadStatus.textContent = "上傳中";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: new FormData(els.uploadForm),
    });

    if (!response.ok) throw new Error("upload failed");

    els.uploadStatus.textContent = "上傳成功，已重新讀取歌曲資料";
    els.uploadForm.reset();
    await loadSong();
    showAdmin(false);
  } catch {
    els.uploadStatus.textContent = "上傳失敗，請確認 server.js 是否正常執行。";
  }
}

async function switchCurrentSong(event) {
  event.preventDefault();

  const songId = els.currentSongSelect.value;
  if (!songId) return;

  els.currentSongStatus.textContent = "切換中";

  try {
    const response = await fetch(CURRENT_SONG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: songId }),
    });

    if (!response.ok) throw new Error("switch failed");

    els.currentSongStatus.textContent = "已切換歌曲，正在重新讀取資料";
    await loadSong();
    showAdmin(false);
  } catch {
    els.currentSongStatus.textContent = "切換歌曲失敗，請確認 server.js 是否正常執行。";
  }
}

function showAdmin(show) {
  if (show) pauseAll();
  els.playerView.classList.toggle("is-hidden", show);
  els.adminView.classList.toggle("is-hidden", !show);
  els.adminToggle.textContent = show ? "播放介面" : "管理介面";
  els.adminToggle.setAttribute("aria-expanded", String(show));
}

function setPlayerEnabled(enabled) {
  els.playToggle.disabled = !enabled;
  els.backward.disabled = !enabled;
  els.forward.disabled = !enabled;
  els.progress.disabled = !enabled;
}

function getTrack(name) {
  return state.tracks.find((track) => track.name === name);
}

function getCurrentTime() {
  const firstAudio = state.audios.values().next().value;
  return firstAudio ? firstAudio.currentTime : 0;
}

function getDuration() {
  const durations = [...state.audios.values()]
    .map((audio) => audio.duration)
    .filter(Number.isFinite);
  return durations.length ? Math.max(...durations) : 0;
}

function formatTime(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
