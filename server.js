require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const SIGNED_URL_MS = 24 * 60 * 60 * 1000;
const ADMIN_COOKIE = "admin_auth";
const ADMIN_SESSION_MS = 60 * 60 * 1000;
const adminSessionSecret = crypto.randomBytes(32).toString("hex");

let firebase;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, done) => {
    done(null, file.mimetype?.startsWith("audio/") === true);
  },
});

app.use(express.json());

app.get("/", sendFile("index.html"));
app.get("/index.html", sendFile("index.html"));
app.get("/styles.css", sendFile("styles.css"));
app.get("/app.js", sendFile("app.js"));
app.get("/sortable.min.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules", "sortablejs", "Sortable.min.js"));
});
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/api/songs", async (req, res) => {
  try {
    const { db } = getFirebase();
    res.json({ songs: await listSongs(db) });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/song", async (req, res) => {
  try {
    const { db, bucket } = getFirebase();
    const songs = await listSongs(db);
    const currentSongId = await getCurrentSongId(db);
    const requestedSongId = String(req.query.song_id ?? "").trim();
    const requestedSong = requestedSongId ? songs.find((song) => song.id === requestedSongId) : null;

    if (requestedSongId && !requestedSong) {
      res.status(404).json({ error: "song_not_found" });
      return;
    }

    let songRef = requestedSong
      ? db.collection("songs").doc(requestedSong.id)
      : currentSongId
        ? db.collection("songs").doc(currentSongId)
        : null;
    let songDoc = songRef ? await songRef.get() : null;

    if (!songDoc?.exists) {
      res.json({ title: "尚未設定歌曲", current_song_id: null, songs, tracks: [] });
      return;
    }

    const storedTracks = await getTracks(songRef);
    const tracks = await Promise.all(
      storedTracks.map(async ({ data: track }) => {
        const [audioUrl] = await bucket.file(track.storage_path).getSignedUrl({
          action: "read",
          expires: Date.now() + SIGNED_URL_MS,
        });

        return {
          id: track.id,
          name: track.name,
          audio_url: audioUrl,
          volume: Number(track.volume ?? 0.8),
          order: Number(track.order),
        };
      }),
    );

    res.json({
      title: songDoc.data().title,
      song_id: songRef.id,
      current_song_id: requestedSongId ? currentSongId : songRef.id,
      songs,
      tracks,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const password = String(req.body.password ?? "");
    const { db } = getFirebase();
    const adminPassword = await getAdminPassword(db);

    if (!adminPassword) {
      res.status(503).json({ error: "admin_password_missing" });
      return;
    }

    if (!sameSecret(password, adminPassword)) {
      res.status(401).json({ error: "invalid_password" });
      return;
    }

    res.setHeader("Set-Cookie", adminCookie(createAdminToken()));
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/song/current", requireAdmin, async (req, res) => {
  try {
    const songId = String(req.body.song_id ?? "").trim();
    const { db } = getFirebase();
    const songDoc = songId ? await db.collection("songs").doc(songId).get() : null;

    if (!songDoc?.exists) {
      res.status(400).json({ error: "song_not_found" });
      return;
    }

    await updateCurrentSong(db, songId);
    res.json({ ok: true, current_song_id: songId });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/song/tracks", requireAdmin, async (req, res) => {
  try {
    const songId = String(req.body.song_id ?? "").trim();
    const tracks = Array.isArray(req.body.tracks)
      ? req.body.tracks.map((track) => ({
          id: track?.id,
          name: String(track?.name ?? "").trim(),
          order: track?.order,
        }))
      : [];

    if (
      !(songId && tracks.length) ||
      tracks.some(
        (track, index) =>
          !isTrackId(track.id) || !track.name || !Number.isInteger(track.order) || track.order !== index + 1,
      )
    ) {
      res.status(400).json({ error: "song_id_tracks_required" });
      return;
    }

    if (new Set(tracks.map((track) => track.id)).size !== tracks.length) {
      res.status(400).json({ error: "duplicate_track_id" });
      return;
    }

    if (new Set(tracks.map((track) => track.name)).size !== tracks.length) {
      res.status(400).json({ error: "duplicate_track_name" });
      return;
    }

    const { db, bucket } = getFirebase();
    const songRef = db.collection("songs").doc(songId);
    const songDoc = await songRef.get();

    if (!songDoc.exists) {
      res.status(400).json({ error: "song_not_found" });
      return;
    }

    const storedTracks = await getTracks(songRef);
    const tracksById = new Map(storedTracks.map((track) => [track.data.id, track]));

    if (tracks.some((track) => !tracksById.has(track.id))) {
      res.status(400).json({ error: "track_id_mismatch" });
      return;
    }

    const batch = db.batch();
    tracks.forEach((track) => {
      batch.set(tracksById.get(track.id).ref, { name: track.name, order: track.order }, { merge: true });
    });
    const submittedIds = new Set(tracks.map((track) => track.id));
    const deletedTracks = storedTracks.filter((track) => !submittedIds.has(track.data.id));
    deletedTracks.forEach((track) => batch.delete(track.ref));
    await batch.commit();

    await Promise.all(
      deletedTracks.map(async (track) => {
        try {
          await bucket.file(track.data.storage_path).delete();
        } catch (error) {
          if (error.code !== 404) console.error(error);
        }
      }),
    );

    res.json({ ok: true, track_count: tracks.length, deleted_count: deletedTracks.length });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/song", requireAdmin, upload.single("audio"), async (req, res) => {
  try {
    const title = req.body.title?.trim();
    const trackName = req.body.track_name?.trim();

    if (!(title && trackName && req.file)) {
      res.status(400).json({ error: "title_track_name_audio_required" });
      return;
    }

    const { db, bucket } = getFirebase();
    const songId = toSongId(title);
    const songRef = db.collection("songs").doc(songId);
    const storedTracks = await getTracks(songRef);
    const storedTrack = storedTracks.find((track) => track.data.name === trackName);
    const id = storedTrack?.data.id ?? nextTrackId(storedTracks);
    const trackKey = storedTrack?.ref.id ?? nextTrackKey(storedTracks, trackName, id);
    const trackRef = songRef.collection("tracks").doc(trackKey);
    const storagePath = storedTrack?.data.storage_path ?? `songs/${songId}/${trackKey}${audioExtension(req.file)}`;
    const existingOrder = Number(storedTrack?.data.order);
    const order = storedTrack && Number.isFinite(existingOrder) ? existingOrder : nextTrackOrder(storedTracks);

    await bucket.file(storagePath).save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=3600",
      },
    });

    await songRef.set(
      {
        title,
      },
      { merge: true },
    );

    await trackRef.set(
      {
        id,
        name: trackName,
        storage_path: storagePath,
        volume: 0.8,
        order,
      },
      { merge: true },
    );

    res.status(201).json({
      ok: true,
      song_id: songId,
      title,
      track: {
        id,
        name: trackName,
        storage_path: storagePath,
        order,
      },
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code });
    return;
  }

  if (error) {
    res.status(400).json({ error: "audio_file_required" });
    return;
  }

  next();
});

app.listen(port, () => {
  console.log(`Choir practice server running at http://localhost:${port}`);
});

function sendFile(fileName) {
  return (req, res) => {
    res.sendFile(path.join(__dirname, fileName));
  };
}

function getFirebase() {
  if (firebase) return firebase;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!(projectId && storageBucket && serviceAccountPath)) {
    throw new Error("firebase_config_missing");
  }

  const serviceAccount = require(path.resolve(serviceAccountPath));
  const firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId,
    storageBucket,
  });

  firebase = {
    db: getFirestore(firebaseApp),
    bucket: getStorage(firebaseApp).bucket(),
  };

  return firebase;
}

function sendApiError(res, error) {
  const status = error.message === "firebase_config_missing" ? 503 : 500;
  if (status === 500) console.error(error);
  res.status(status).json({ error: error.message ? error.message : "server_error" });
}

async function listSongs(db) {
  const snapshot = await db.collection("songs").get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, title: doc.data().title }))
    .filter((song) => song.title)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
}

async function getTracks(songRef) {
  const snapshot = await songRef.collection("tracks").orderBy("order").get();
  return snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));
}

function nextTrackId(tracks) {
  return tracks.reduce((max, track) => Math.max(max, Number(track.data.id) || 0), 0) + 1;
}

function nextTrackKey(tracks, name, id) {
  const usedKeys = new Set(tracks.map((track) => track.ref.id));
  const baseKey = toTrackId(name);
  return usedKeys.has(baseKey) ? `${baseKey}-${id}` : baseKey;
}

function nextTrackOrder(tracks) {
  return tracks.reduce((max, track) => Math.max(max, Number(track.data.order) || 0), 0) + 1;
}

function isTrackId(value) {
  return Number.isInteger(value) && value > 0;
}

async function getCurrentSongId(db) {
  const doc = await db.doc("info/site").get();
  return doc.exists ? doc.data().current : null;
}

async function getAdminPassword(db) {
  const adminDoc = await db.doc("info/admin").get();
  const adminPassword = readPassword(adminDoc);
  if (adminPassword) return adminPassword;

  const infoDoc = await db.doc("info/info").get();
  const infoPassword = readPassword(infoDoc);
  if (infoPassword) return infoPassword;

  const siteDoc = await db.doc("info/site").get();
  return readPassword(siteDoc);
}

function readPassword(doc) {
  if (!doc.exists) return "";

  const data = doc.data();
  return String(data.admin_password ?? data.adminPassword ?? data.password ?? "");
}

async function updateCurrentSong(db, songId) {
  await db.doc("info/site").set(
    {
      current: songId,
    },
    { merge: true },
  );
}

function toSongId(title) {
  const id = title
    .trim()
    .toLowerCase()
    .replace(/[\\/#?%[\]]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return id && id !== "current" ? id : `song-${Date.now()}`;
}

function toTrackId(name) {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return id ? id : `track-${Date.now()}`;
}

function audioExtension(file) {
  const ext = path.extname(file.originalname ?? "").toLowerCase();
  if (ext) return ext;

  return (
    {
      "audio/mpeg": ".mp3",
      "audio/mp4": ".m4a",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
    }[file.mimetype] ?? ".mp3"
  );
}

function requireAdmin(req, res, next) {
  if (isAdminTokenValid(readCookie(req, ADMIN_COOKIE))) {
    next();
    return;
  }

  res.status(401).json({ error: "admin_login_required" });
}

function createAdminToken() {
  const expiresAt = Date.now() + ADMIN_SESSION_MS;
  const signature = crypto
    .createHmac("sha256", adminSessionSecret)
    .update(String(expiresAt))
    .digest("hex");

  return `${expiresAt}.${signature}`;
}

function isAdminTokenValid(token) {
  const [expiresAt, signature] = String(token ?? "").split(".");
  if (!(expiresAt && signature && Number(expiresAt) > Date.now())) return false;

  const expected = crypto
    .createHmac("sha256", adminSessionSecret)
    .update(expiresAt)
    .digest("hex");

  return sameSecret(signature, expected);
}

function adminCookie(token) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${
    ADMIN_SESSION_MS / 1000
  }`;
}

function readCookie(req, name) {
  return String(req.headers.cookie ?? "")
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
