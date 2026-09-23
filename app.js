const API_URL = "/api/song";
const SONGS_URL = "/api/songs";
const CURRENT_SONG_URL = "/api/song/current";
const ADMIN_LOGIN_URL = "/api/admin/login";
const TRACKS_URL = "/api/song/tracks";

const state = {
  title: "尚未設定歌曲",
  currentSongId: null,
  displayedSongId: null,
  songs: [],
  tracks: [],
  managedSongId: null,
  managedTitle: "",
  managedTracks: [],
  managedTrackOrderIds: [],
  audioContext: null,
  buffers: new Map(),
  sources: new Map(),
  gains: new Map(),
  position: 0,
  startedAt: 0,
  isPlaying: false,
  isAudioReady: false,
  audioLoadId: 0,
  audioLoadFailed: false,
  timer: 0,
};

const els = {
  iosNoticeDialog: document.querySelector("#ios-notice-dialog"),
  iosNoticeConfirm: document.querySelector("#ios-notice-confirm"),
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
  managedSongSelect: document.querySelector("#managed-song-select"),
  managedSongStatus: document.querySelector("#managed-song-status"),
  trackOrderList: document.querySelector("#track-order-list"),
  trackOrderSave: document.querySelector("#track-order-save"),
  trackOrderStatus: document.querySelector("#track-order-status"),
};

init();

async function init() {
  bindEvents();
  setupTrackOrderSorting();
  setPlayerEnabled(false);
  els.iosNoticeDialog.showModal();
  await loadSong();
}

function bindEvents() {
  els.iosNoticeConfirm.addEventListener("click", () => els.iosNoticeDialog.close());
  els.iosNoticeDialog.addEventListener("cancel", (event) => event.preventDefault());
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
  els.managedSongSelect.addEventListener("change", switchManagedSong);
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
    renderSong();
    els.status.textContent = "無法讀取 /api/song，請確認 server.js 是否正在執行。";
    return false;
  }
}

async function loadManagedSong(songId = "") {
  if (!songId) {
    state.managedSongId = null;
    state.managedTitle = "";
    state.managedTracks = [];
    state.managedTrackOrderIds = [];
    els.uploadForm.reset();
    renderManagedSongOptions();
    renderTrackOrder();
    els.managedSongStatus.textContent = "新增歌曲模式";
    els.uploadStatus.textContent = "尚未上傳";
    return true;
  }

  els.managedSongSelect.disabled = true;
  els.managedSongStatus.textContent = "正在讀取歌曲資料";
  els.trackOrderList.innerHTML = "";
  els.trackOrderSave.disabled = true;
  els.trackOrderStatus.textContent = "正在讀取聲部資訊";

  try {
    const response = await fetch(`${API_URL}?song_id=${encodeURIComponent(songId)}`);
    if (!response.ok) throw new Error("managed song unavailable");

    const song = await response.json();
    state.managedSongId = song.song_id;
    state.managedTitle = song.title;
    state.managedTracks = normalizeTracks(song.tracks);
    state.managedTrackOrderIds = state.managedTracks.map((track) => track.id);
    els.adminTitle.value = state.managedTitle;
    renderManagedSongOptions();
    renderTrackOrder();
    els.managedSongStatus.textContent = `正在管理：${state.managedTitle}`;
    return true;
  } catch {
    els.managedSongStatus.textContent = "無法讀取這首歌曲，請稍後再試。";
    renderManagedSongOptions();
    return false;
  } finally {
    els.managedSongSelect.disabled = false;
  }
}

async function refreshSongs() {
  const response = await fetch(SONGS_URL);
  if (!response.ok) throw new Error("songs unavailable");

  state.songs = normalizeSongs((await response.json()).songs);
  renderCurrentSongOptions();
  renderManagedSongOptions();
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

async function setupAudios() {
  pauseAll();
  state.position = 0;
  state.buffers.clear();
  state.isAudioReady = false;
  state.audioLoadFailed = false;
  state.audioLoadId += 1;
  const loadId = state.audioLoadId;

  updatePlayerAvailability();

  if (!state.tracks.length) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API unavailable");
    state.audioContext ??= new AudioContextClass();

    const buffers = await Promise.all(
      state.tracks.map(async (track) => {
        const response = await fetch(track.audioUrl);
        if (!response.ok) throw new Error("audio unavailable");
        return [track.name, await state.audioContext.decodeAudioData(await response.arrayBuffer())];
      }),
    );

    if (loadId !== state.audioLoadId) return;
    state.buffers = new Map(buffers);
    state.isAudioReady = true;
    updateDuration();
    updatePlayerAvailability();
  } catch (error) {
    console.error("Audio load failed:", error);
    handleAudioLoadError(loadId);
  }
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
}

function renderSong() {
  els.title.textContent = state.title;
  renderCurrentSongOptions();
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

function renderManagedSongOptions() {
  els.managedSongSelect.innerHTML = [
    `<option value="">＋ 新增歌曲</option>`,
    ...state.songs.map((song) => `<option value="${escapeHtml(song.id)}">${escapeHtml(song.title)}</option>`),
  ].join("");
  els.managedSongSelect.value = state.managedSongId ?? "";
}

function renderTrackOrder(message = "") {
  const orderedTracks = getOrderedTracksForAdmin();

  if (!state.managedSongId || !orderedTracks.length) {
    els.trackOrderList.innerHTML = `<div class="empty-state">目前沒有可管理的聲部。</div>`;
    els.trackOrderSave.disabled = true;
    els.trackOrderStatus.textContent = state.managedSongId
      ? "上傳聲部後即可管理聲部資訊"
      : "請先選擇既有歌曲";
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
    item.remove();
    updateTrackDraftOrder();
  }
}

function updateTrackDraftOrder() {
  const items = [...els.trackOrderList.querySelectorAll(".track-order-item")];
  state.managedTrackOrderIds = items.map((item) => Number(item.dataset.trackId));
  els.trackOrderStatus.textContent = items.length
    ? "尚未儲存聲部資訊"
    : "儲存後將刪除整首歌曲";
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

  try {
    await state.audioContext.resume();
    if (state.position >= getDuration()) state.position = 0;
    startSources();
    state.isPlaying = true;
    updatePlayButtonText();
    startTimer();
  } catch {
    els.status.textContent = "播放被瀏覽器擋下，請再按一次播放。";
  }
}

function pauseAll() {
  if (state.isPlaying) state.position = getCurrentTime();
  stopSources();
  state.isPlaying = false;
  updatePlayButtonText();
  stopTimer();
}

function startSources() {
  stopSources();
  const startAt = state.audioContext.currentTime + 0.1;

  state.tracks.forEach((track) => {
    const buffer = state.buffers.get(track.name);
    if (!buffer || state.position >= buffer.duration) return;

    const source = state.audioContext.createBufferSource();
    const gain = state.audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = track.muted ? 0 : track.volume;
    source.connect(gain);
    gain.connect(state.audioContext.destination);
    source.start(startAt, state.position);
    state.sources.set(track.name, source);
    state.gains.set(track.name, gain);
  });

  state.startedAt = startAt;
}

function stopSources() {
  state.sources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // Source may already have ended.
    }
  });
  state.sources.clear();
  state.gains.clear();
}

function seekBy(seconds) {
  seekTo(clamp(getCurrentTime() + seconds, 0, getDuration()));
}

function seekTo(seconds) {
  state.position = clamp(seconds, 0, getDuration());
  if (state.isPlaying) startSources();
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
    const gain = state.gains.get(track.name);
    if (gain) gain.gain.value = track.muted ? 0 : track.volume;
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
  if (state.isPlaying && current >= getDuration()) {
    handleEnded();
    return;
  }
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
  pauseAll();
  state.position = 0;
  updateProgress();
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
    await loadManagedSong(state.currentSongId);
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

    const result = await response.json();
    els.uploadStatus.textContent = "上傳成功，正在重新讀取歌曲資料";
    els.uploadForm.reset();
    try {
      await refreshSongs();
      const loaded = await loadManagedSong(result.song_id);
      els.uploadStatus.textContent = loaded
        ? "上傳成功"
        : "上傳成功，但歌曲資料重新讀取失敗，請重新整理。";
    } catch {
      els.uploadStatus.textContent = "上傳成功，但歌曲清單重新讀取失敗，請重新整理。";
    }
  } catch {
    els.uploadStatus.textContent = "上傳失敗，請確認 server.js 是否正常執行。";
  }
}

async function switchManagedSong() {
  await loadManagedSong(els.managedSongSelect.value);
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

    await loadSong();
    els.currentSongStatus.textContent = "已設定置頂歌曲";
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
  if (!state.managedSongId) return;

  if (
    !tracks.length &&
    !window.confirm(`確定刪除「${state.managedTitle}」及其所有聲部音檔嗎？此操作無法復原。`)
  ) {
    state.managedTrackOrderIds = state.managedTracks.map((track) => track.id);
    renderTrackOrder("已取消刪除歌曲");
    return;
  }

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

  let result;
  try {
    const response = await fetch(TRACKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        song_id: state.managedSongId,
        tracks,
      }),
    });

    if (!response.ok) throw new Error("track update failed");

    result = await response.json();
  } catch {
    els.trackOrderStatus.textContent = "儲存聲部資訊失敗，請重新整理後再試一次。";
    els.trackOrderSave.disabled = !state.managedTracks.length;
    return;
  }

  if (result.song_deleted) {
    const deletedCurrentSong = state.managedSongId === state.currentSongId;
    await loadManagedSong();
    try {
      if (deletedCurrentSong) {
        await loadSong();
        renderManagedSongOptions();
      } else {
        await refreshSongs();
      }
      els.managedSongStatus.textContent = "歌曲與所有音檔已刪除";
    } catch {
      els.managedSongStatus.textContent = "歌曲已刪除，但歌曲清單重新讀取失敗，請重新整理。";
    }
    return;
  }

  els.trackOrderStatus.textContent = "已儲存聲部資訊，正在重新讀取歌曲資料";
  await loadManagedSong(state.managedSongId);
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
  const tracksById = new Map(state.managedTracks.map((track) => [track.id, track]));
  const orderedTracks = state.managedTrackOrderIds.map((trackId) => tracksById.get(trackId)).filter(Boolean);
  const orderedTrackIds = new Set(orderedTracks.map((track) => track.id));
  const missingTracks = state.managedTracks.filter((track) => !orderedTrackIds.has(track.id));

  return [...orderedTracks, ...missingTracks];
}

function getCurrentTime() {
  if (!state.isPlaying || !state.audioContext) return state.position;
  const elapsed = Math.max(0, state.audioContext.currentTime - state.startedAt);
  return clamp(state.position + elapsed, 0, getDuration());
}

function getDuration() {
  const durations = [...state.buffers.values()].map((buffer) => buffer.duration);
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
