const API_URL = "/api/song";
const SONGS_URL = "/api/songs";
const CURRENT_SONG_URL = "/api/song/current";
const ADMIN_LOGIN_URL = "/api/admin/login";
const TRACKS_URL = "/api/song/tracks";
const AUDIO_READY_STATE = 4;

const state = {
  title: "尚未設定歌曲",
  currentSongId: null,
  displayedSongId: null,
  songs: [],
  tracks: [],
  trackOrderIds: [],
  audios: new Map(),
  isPlaying: false,
  isAudioReady: false,
  audioLoadId: 0,
  pendingAudioNames: new Set(),
  audioLoadFailed: false,
  timer: 0,
};

const els = {
  adminToggle: document.querySelector("#admin-toggle"),
  playerView: document.querySelector("#player-view"),
  adminView: document.querySelector("#admin-view"),
  title: document.querySelector("#song-title"),
  songPickerToggle: document.querySelector("#song-picker-toggle"),
  songPickerDialog: document.querySelector("#song-picker-dialog"),
  songPicker: document.querySelector("#song-picker"),
  songPickerStatus: document.querySelector("#song-picker-status"),
  songPickerCancel: document.querySelector("#song-picker-cancel"),
  status: document.querySelector("#player-status"),
  resetVolumes: document.querySelector("#reset-volumes"),
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
  adminPasswordDialog: document.querySelector("#admin-password-dialog"),
  adminPasswordForm: document.querySelector("#admin-password-form"),
  adminPassword: document.querySelector("#admin-password"),
  adminPasswordCancel: document.querySelector("#admin-password-cancel"),
  adminPasswordStatus: document.querySelector("#admin-password-status"),
  currentSongForm: document.querySelector("#current-song-form"),
  currentSongSelect: document.querySelector("#current-song-select"),
  currentSongStatus: document.querySelector("#current-song-status"),
  trackOrderList: document.querySelector("#track-order-list"),
  trackOrderSave: document.querySelector("#track-order-save"),
  trackOrderStatus: document.querySelector("#track-order-status"),
};

init();

async function init() {
  bindEvents();
  setupTrackOrderSorting();
  setPlayerEnabled(false);
  await loadSong();
}

function bindEvents() {
  els.adminToggle.addEventListener("click", () => {
    if (els.adminView.classList.contains("is-hidden")) {
      openAdminPasswordDialog();
      return;
    }

    showAdmin(false);
  });
  els.playToggle.addEventListener("click", togglePlay);
  els.songPickerToggle.addEventListener("click", toggleSongPicker);
  els.songPicker.addEventListener("click", selectSong);
  els.songPickerCancel.addEventListener("click", closeSongPicker);
  els.songPickerDialog.addEventListener("close", resetSongPicker);
  els.backward.addEventListener("click", () => seekBy(-5));
  els.forward.addEventListener("click", () => seekBy(5));
  els.progress.addEventListener("input", () => seekTo(Number(els.progress.value)));
  els.resetVolumes.addEventListener("click", resetVolumes);
  els.adminPasswordForm.addEventListener("submit", verifyAdminPassword);
  els.adminPasswordCancel.addEventListener("click", closeAdminPasswordDialog);
  els.adminPasswordDialog.addEventListener("close", resetAdminPasswordDialog);
  els.uploadForm.addEventListener("submit", uploadSong);
  els.currentSongForm.addEventListener("submit", switchCurrentSong);
  els.trackOrderList.addEventListener("click", handleTrackInfoClick);
  els.trackOrderSave.addEventListener("click", saveTrackInfo);
}

function setupTrackOrderSorting() {
  Sortable.create(els.trackOrderList, {
    animation: 150,
    handle: ".drag-handle",
    draggable: ".track-order-item",
    ghostClass: "sortable-ghost",
    chosenClass: "sortable-chosen",
    dragClass: "sortable-drag",
    onEnd: updateTrackDraftOrder,
  });
}

async function loadSong(songId = "") {
  if (!songId) renderLoading();

  try {
    const url = songId ? `${API_URL}?song_id=${encodeURIComponent(songId)}` : API_URL;
    const response = await fetch(url);
    if (!response.ok) throw new Error("song api unavailable");

    const song = await response.json();
    if (songId) renderLoading();
    state.title = song.title;
    state.currentSongId = song.current_song_id;
    state.displayedSongId = song.song_id ?? song.current_song_id;
    state.songs = normalizeSongs(song.songs);
    state.tracks = normalizeTracks(song.tracks);
    state.trackOrderIds = state.tracks.map((track) => track.id);
    setupAudios();
    renderSong();
    return true;
  } catch {
    if (songId) {
      els.songPickerStatus.textContent = "無法讀取這首歌曲，請稍後再試。";
      return false;
    }

    state.title = "讀取歌曲失敗";
    state.currentSongId = null;
    state.displayedSongId = null;
    state.songs = [];
    state.tracks = [];
    state.trackOrderIds = [];
    renderSong();
    els.status.textContent = "無法讀取 /api/song，請確認 server.js 是否正在執行。";
    return false;
  }
}

async function toggleSongPicker() {
  els.songPickerToggle.disabled = true;
  els.songPicker.innerHTML = "";
  els.songPickerStatus.textContent = "正在讀取歌曲清單";
  els.songPickerDialog.showModal();
  els.songPickerToggle.setAttribute("aria-expanded", "true");

  try {
    const response = await fetch(SONGS_URL);
    if (!response.ok) throw new Error("songs api unavailable");

    const songs = normalizeSongs((await response.json()).songs);
    els.songPicker.innerHTML = songs.length
      ? songs
          .map(
            (song) => {
              const current = song.id === state.displayedSongId ? ` aria-current="true"` : "";
              return `<button class="ghost-button" type="button" data-song-id="${escapeHtml(song.id)}"${current}>${escapeHtml(song.title)}</button>`;
            },
          )
          .join("")
      : `<div class="empty-state">目前沒有可選擇的歌曲。</div>`;
    els.songPickerStatus.textContent = songs.length ? "請選擇歌曲" : "";
  } catch {
    els.songPickerStatus.textContent = "無法讀取歌曲清單，請稍後再試。";
  } finally {
    els.songPickerToggle.disabled = false;
  }
}

async function selectSong(event) {
  const button = event.target.closest("[data-song-id]");
  if (!button) return;

  els.songPicker.querySelectorAll("button").forEach((item) => {
    item.disabled = true;
  });
  els.songPickerStatus.textContent = "正在切換歌曲";
  pauseAll();

  if (await loadSong(button.dataset.songId)) {
    closeSongPicker();
    return;
  }

  els.songPicker.querySelectorAll("button").forEach((item) => {
    item.disabled = false;
  });
}

function closeSongPicker() {
  els.songPickerDialog.close();
}

function resetSongPicker() {
  els.songPickerToggle.setAttribute("aria-expanded", "false");
  els.songPickerStatus.textContent = "";
}

function normalizeSongs(songs = []) {
  return songs.filter((song) => song.id && song.title);
}

function normalizeTracks(tracks = []) {
  return tracks
    .map((track) => ({
      id: Number(track.id),
      name: track.name,
      audioUrl: track.audio_url,
      volume: clamp(Number(track.volume ?? 0.8), 0, 1),
      order: Number(track.order),
      muted: false,
    }))
    .filter((track) => Number.isInteger(track.id) && track.id > 0 && track.name && track.audioUrl);
}

function setupAudios() {
  stopTimer();
  state.audios.forEach((audio) => audio.pause());
  state.audios.clear();
  state.isPlaying = false;
  state.isAudioReady = false;
  state.audioLoadFailed = false;
  state.audioLoadId += 1;
  state.pendingAudioNames = new Set(state.tracks.map((track) => track.name));

  const loadId = state.audioLoadId;

  state.tracks.forEach((track) => {
    const audio = new Audio(track.audioUrl);
    audio.preload = "auto";
    audio.addEventListener("loadedmetadata", () => {
      if (loadId !== state.audioLoadId) return;
      updateDuration();
      markAudioReadyIfPossible(track.name, audio, loadId);
    });
    audio.addEventListener("loadeddata", () => markAudioReadyIfPossible(track.name, audio, loadId));
    audio.addEventListener("canplay", () => markAudioReadyIfPossible(track.name, audio, loadId));
    audio.addEventListener("canplaythrough", () => markAudioReady(track.name, loadId));
    audio.addEventListener("error", () => handleAudioLoadError(loadId));
    audio.addEventListener("ended", handleEnded);
    state.audios.set(track.name, audio);
    audio.load();
    markAudioReadyIfPossible(track.name, audio, loadId);
  });

  applyVolumes();
  updatePlayerAvailability();
}

function renderLoading() {
  pauseAll();
  state.isAudioReady = false;
  state.audioLoadFailed = false;
  setPlayerEnabled(false);
  els.resetVolumes.disabled = true;
  updatePlayButtonText();
  els.title.textContent = "載入中";
  els.status.textContent = "讀取音檔中";
  els.tracksList.innerHTML = "";
  els.trackOrderList.innerHTML = "";
  els.trackOrderSave.disabled = true;
  els.trackOrderStatus.textContent = "正在讀取聲部資訊";
}

function renderSong() {
  els.title.textContent = state.title;
  els.adminTitle.value = state.title === "讀取歌曲失敗" ? "" : state.title;
  renderCurrentSongOptions();
  renderTrackOrder();
  els.resetVolumes.disabled = !state.tracks.length;

  if (!state.tracks.length) {
    els.tracksList.innerHTML = `<div class="empty-state">目前沒有聲部音檔，請到管理介面上傳。</div>`;
    setPlayerEnabled(false);
    updatePlayButtonText();
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
  updatePlayerAvailability();
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

function renderTrackOrder(message = "") {
  const orderedTracks = getOrderedTracksForAdmin();

  if (!state.currentSongId || !orderedTracks.length) {
    els.trackOrderList.innerHTML = `<div class="empty-state">目前沒有可管理的聲部。</div>`;
    els.trackOrderSave.disabled = true;
    els.trackOrderStatus.textContent = "上傳聲部後即可管理聲部資訊";
    return;
  }

  els.trackOrderSave.disabled = false;
  els.trackOrderList.innerHTML = orderedTracks.map(renderTrackOrderItem).join("");
  els.trackOrderStatus.textContent = message || "可拖曳排序、修改名稱或刪除聲部，完成後再儲存";
}

function renderTrackOrderItem(track) {
  const id = escapeHtml(track.id);
  const name = escapeHtml(track.name);

  return `
    <div class="track-order-item" data-track-id="${id}">
      <span class="drag-handle" aria-hidden="true">↕</span>
      <input class="track-order-name" type="text" value="${name}" aria-label="聲部名稱" tabindex="-1" readonly>
      <button class="small-button track-order-action" type="button" data-edit-track>修改</button>
      <button class="small-button track-order-action" type="button" data-delete-track>刪除</button>
    </div>
  `;
}

function handleTrackInfoClick(event) {
  const item = event.target.closest(".track-order-item");
  if (!item) return;

  if (event.target.matches("[data-edit-track]")) {
    const input = item.querySelector(".track-order-name");
    input.readOnly = !input.readOnly;
    input.tabIndex = input.readOnly ? -1 : 0;
    event.target.textContent = input.readOnly ? "修改" : "完成";
    if (!input.readOnly) {
      input.focus();
      input.select();
    }
    els.trackOrderStatus.textContent = "尚未儲存聲部資訊";
  }

  if (event.target.matches("[data-delete-track]")) {
    const items = els.trackOrderList.querySelectorAll(".track-order-item");
    if (items.length === 1) {
      els.trackOrderStatus.textContent = "至少需要保留一個聲部";
      return;
    }
    item.remove();
    updateTrackDraftOrder();
  }
}

function updateTrackDraftOrder() {
  const items = [...els.trackOrderList.querySelectorAll(".track-order-item")];
  state.trackOrderIds = items.map((item) => Number(item.dataset.trackId));
  els.trackOrderStatus.textContent = "尚未儲存聲部資訊";
}

function renderTrack(track) {
  const name = escapeHtml(track.name);
  const muteClass = track.muted ? "small-button is-active" : "small-button";
  const disabled = track.muted ? " disabled" : "";
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
    </article>
  `;
}

async function togglePlay() {
  if (!state.tracks.length || !state.isAudioReady) return;

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
    updatePlayButtonText();
    startTimer();
  } catch {
    els.status.textContent = "播放被瀏覽器擋下，請再按一次播放。";
  }
}

function pauseAll() {
  state.audios.forEach((audio) => audio.pause());
  state.isPlaying = false;
  updatePlayButtonText();
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

function resetVolumes() {
  state.tracks.forEach((track) => {
    track.volume = 0.8;
  });
  applyVolumes();
  renderSong();
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

function markAudioReadyIfPossible(trackName, audio, loadId) {
  if (audio.readyState >= AUDIO_READY_STATE) {
    markAudioReady(trackName, loadId);
  }
}

function markAudioReady(trackName, loadId) {
  if (loadId !== state.audioLoadId || state.audioLoadFailed || state.isAudioReady) return;

  state.pendingAudioNames.delete(trackName);

  if (state.pendingAudioNames.size > 0) return;

  state.isAudioReady = state.tracks.length > 0;
  updatePlayerAvailability();
}

function handleAudioLoadError(loadId) {
  if (loadId !== state.audioLoadId) return;

  state.audioLoadFailed = true;
  state.isAudioReady = false;
  updatePlayerAvailability();
}

function updatePlayerAvailability() {
  if (!state.tracks.length) {
    setPlayerEnabled(false);
    updatePlayButtonText();
    return;
  }

  if (state.audioLoadFailed) {
    setPlayerEnabled(false);
    updatePlayButtonText();
    els.status.textContent = "音檔載入失敗，請重新整理或重新上傳音檔。";
    return;
  }

  if (!state.isAudioReady) {
    setPlayerEnabled(false);
    updatePlayButtonText();
    els.status.textContent = "音檔下載中，請稍候。";
    return;
  }

  setPlayerEnabled(true);
  updatePlayButtonText();
  els.status.textContent = "歌曲資料已載入";
}

function updatePlayButtonText() {
  if (state.isPlaying) {
    els.playToggle.textContent = "暫停";
  } else if (state.tracks.length && !state.isAudioReady) {
    els.playToggle.textContent = "下載中";
  } else {
    els.playToggle.textContent = "播放";
  }
}

function openAdminPasswordDialog() {
  resetAdminPasswordDialog();
  els.adminPasswordDialog.showModal();
  els.adminPassword.focus();
}

function closeAdminPasswordDialog() {
  els.adminPasswordDialog.close();
}

function resetAdminPasswordDialog() {
  els.adminPasswordForm.reset();
  els.adminPasswordStatus.textContent = "";
}

async function verifyAdminPassword(event) {
  event.preventDefault();

  const submitButton = els.adminPasswordForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  els.adminPasswordStatus.textContent = "驗證中...";

  try {
    const response = await fetch(ADMIN_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: els.adminPassword.value }),
    });

    if (!response.ok) throw new Error("login failed");

    await loadSong();
    closeAdminPasswordDialog();
    showAdmin(true);
  } catch {
    els.adminPasswordStatus.textContent = "密碼錯誤，請重新輸入。";
    els.adminPassword.select();
  } finally {
    submitButton.disabled = false;
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
  } catch {
    els.currentSongStatus.textContent = "切換歌曲失敗，請確認 server.js 是否正常執行。";
  }
}

async function saveTrackInfo() {
  const tracks = [...els.trackOrderList.querySelectorAll(".track-order-item")].map((item, index) => ({
    id: Number(item.dataset.trackId),
    name: item.querySelector(".track-order-name").value.trim(),
    order: index + 1,
  }));
  if (!(state.currentSongId && tracks.length)) return;

  if (tracks.some((track) => !track.name)) {
    els.trackOrderStatus.textContent = "聲部名稱不可空白";
    return;
  }

  if (new Set(tracks.map((track) => track.name)).size !== tracks.length) {
    els.trackOrderStatus.textContent = "聲部名稱不可重複";
    return;
  }

  els.trackOrderSave.disabled = true;
  els.trackOrderStatus.textContent = "儲存中";

  try {
    const response = await fetch(TRACKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        song_id: state.currentSongId,
        tracks,
      }),
    });

    if (!response.ok) throw new Error("track update failed");

    els.trackOrderStatus.textContent = "已儲存聲部資訊，正在重新讀取歌曲資料";
    await loadSong();
  } catch {
    els.trackOrderStatus.textContent = "儲存聲部資訊失敗，請重新整理後再試一次。";
    els.trackOrderSave.disabled = !state.tracks.length;
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

function getOrderedTracksForAdmin() {
  const tracksById = new Map(state.tracks.map((track) => [track.id, track]));
  const orderedTracks = state.trackOrderIds.map((trackId) => tracksById.get(trackId)).filter(Boolean);
  const orderedTrackIds = new Set(orderedTracks.map((track) => track.id));
  const missingTracks = state.tracks.filter((track) => !orderedTrackIds.has(track.id));

  return [...orderedTracks, ...missingTracks];
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
