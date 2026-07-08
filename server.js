require("dotenv").config();

const path = require("path");
const express = require("express");
const multer = require("multer");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const SIGNED_URL_MS = 24 * 60 * 60 * 1000;

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
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/api/song", async (req, res) => {
  try {
    const { db, bucket } = getFirebase();
    const songs = await listSongs(db);
    const currentSongId = await getCurrentSongId(db);
    let songRef = currentSongId ? db.collection("songs").doc(currentSongId) : null;
    let songDoc = songRef ? await songRef.get() : null;

    if (!songDoc?.exists && songs.length) {
      songRef = db.collection("songs").doc(songs[0].id);
      songDoc = await songRef.get();
    }

    if (!songDoc?.exists) {
      res.json({ title: "尚未設定歌曲", updated_at: null, current_song_id: null, songs, tracks: [] });
      return;
    }

    const tracksSnapshot = await songRef.collection("tracks").orderBy("name").get();
    const tracks = await Promise.all(
      tracksSnapshot.docs.map(async (doc) => {
        const track = doc.data();
        const [audioUrl] = await bucket.file(track.storage_path).getSignedUrl({
          action: "read",
          expires: Date.now() + SIGNED_URL_MS,
        });

        return {
          name: track.name,
          audio_url: audioUrl,
          volume: Number(track.volume ?? 0.8),
        };
      }),
    );

    res.json({
      title: songDoc.data().title,
      updated_at: formatTimestamp(songDoc.data().updated_at),
      current_song_id: songRef.id,
      songs,
      tracks,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/song/current", async (req, res) => {
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

app.post("/api/song", upload.single("audio"), async (req, res) => {
  try {
    const title = req.body.title?.trim();
    const trackName = req.body.track_name?.trim();

    if (!(title && trackName && req.file)) {
      res.status(400).json({ error: "title_track_name_audio_required" });
      return;
    }

    const { db, bucket } = getFirebase();
    const songId = toSongId(title);
    const trackId = toTrackId(trackName);
    const storagePath = `songs/${songId}/${trackId}${audioExtension(req.file)}`;

    await bucket.file(storagePath).save(req.file.buffer, {
      contentType: req.file.mimetype,
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=3600",
      },
    });

    const songRef = db.collection("songs").doc(songId);
    await songRef.set(
      {
        title,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await songRef.collection("tracks").doc(trackId).set(
      {
        name: trackName,
        storage_path: storagePath,
        volume: 0.8,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await updateCurrentSong(db, songId);

    res.status(201).json({
      ok: true,
      song_id: songId,
      title,
      track: {
        name: trackName,
        storage_path: storagePath,
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

function formatTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function listSongs(db) {
  const snapshot = await db.collection("songs").get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, title: doc.data().title }))
    .filter((song) => song.title)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
}

async function getCurrentSongId(db) {
  const doc = await db.doc("info/site").get();
  return doc.exists ? doc.data().current : null;
}

async function updateCurrentSong(db, songId) {
  await db.doc("info/site").set(
    {
      current: songId,
      updated_at: FieldValue.serverTimestamp(),
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
