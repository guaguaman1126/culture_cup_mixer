# 合唱練習網站 AGENTS.md

## 專案目標

這個專案是給合唱團員練習指定曲使用的網站。核心功能分成三個部分：

- 前端使用者介面：讓團員播放歌曲、調整各聲部音量、Mute、Solo 與跳轉時間。
- 管理者介面：讓管理者上傳歌曲名稱與各聲部音檔。
- 後端 `server.js`：管理 Firestore 歌曲資料與 Firebase Storage 音檔儲存，提供前端讀取與上傳 API。

功能要保持簡單，未來幹部只需要透過管理者介面更新歌曲與音檔，不需要修改複雜程式。

## 回覆與文件風格

- 專案說明與交接文件使用繁體中文。
- 檔名、資料夾名稱、設定鍵值使用英文小寫、數字、底線或連字號。
- 不使用中文檔名、空白或特殊符號。
- 程式碼保持短小、清楚、容易交接，不過度抽象化。
- 介面文字以合唱團員能直接理解為主，不使用太多技術詞。

## 建議檔案結構

```text
choir-practice/
├── AGENTS.md
├── index.html
├── styles.css
├── app.js
├── server.js
├── package.json
├── .env.example
└── public/
```

如需暫存上傳檔案，使用 `uploads/`。實際正式音檔應存到 Firebase Storage，不應依賴本機資料夾作為正式資料來源。

## 前端使用者介面

首頁是團員練習使用的播放介面，需包含：

- 歌曲名稱。
- 播放進度條。
- 目前時間與總長度。
- 播放與暫停按鈕。
- 往前跳轉 `5` 秒按鈕。
- 往後跳轉 `5` 秒按鈕。
- 每個聲部一條音量 bar。
- 每個聲部一個 `Mute` 按鈕。
- 每個聲部一個 `Solo` 按鈕。
- 右上角有切換到管理者介面的按鈕。
- 「目前歌曲」區塊有「切換歌曲」按鈕，按下後以彈窗顯示歌曲清單，讓一般使用者在自己的頁面播放其他歌曲。

前端要從後端 API 取得目前歌曲資料與聲部音檔，不要把歌曲資料寫死在 HTML 裡。
一般使用者切換歌曲只影響自己的頁面，不更新 `info/site.current`；重新整理後仍顯示管理者設定的目前歌曲。

## 播放邏輯

- 所有聲部音檔要同步播放、暫停與跳轉。
- 拖曳進度條時，所有聲部都要跳到同一個時間。
- 往前跳轉 `5` 秒不可小於 `0` 秒。
- 往後跳轉 `5` 秒不可超過歌曲總長度。
- 每個聲部音量 bar 控制該聲部的一般播放音量。
- `Mute` 只影響被靜音的聲部。
- `Solo` 不要把其他聲部完全靜音。
- 只能一個聲部開啟 `Solo`：
  - 被 Solo 的聲部實際音量為 `90%`。
  - 沒有被 Solo 的聲部實際音量為 `20%`。
  - 被 `Mute` 的聲部仍然維持靜音。
- `Solo`沒有開關，按了就直接觸發即可

## 管理者介面

管理者介面只保留必要欄位：

- 歌曲名稱。
- 聲部名稱。
- 對應音檔。
- 上傳按鈕。
- 可獨立選擇要管理的歌曲，再調整該歌曲的聲部名稱、順序與刪除管理。

聲部管理使用 `SortableJS`，只能按住 `↕` 把手拖曳。拖曳、改名與刪除都只調整前端草稿，必須按下「儲存聲部資訊」才把完整的 `id`、`name`、`order` 清單交給後端。後端以缺少的穩定 `id` 判斷要刪除的聲部。

置頂歌曲與管理歌曲必須分開：切換置頂歌曲只更新播放介面與 `info/site.current`，不可連動管理介面的聲部草稿或上傳表單。管理介面使用另一個歌曲清單選擇要更新的歌曲；選擇「＋ 新增歌曲」時清空歌曲名稱與聲部草稿。

管理者可重複新增多個聲部音檔。每個音檔都必須填寫聲部名稱可以自訂，例如：

- `soprano`
- `alto`
- `tenor`
- `bass`
- `piano`
- `tempo`

管理者介面暫時不需要帳號系統、留言板、練習紀錄、AI 評分或複雜後台。

## 後端需求

後端使用 `server.js` 撰寫，建議使用 Node.js 與 Express。

後端負責：

- 接收管理者介面上傳的歌曲名稱、聲部名稱與音檔。
- 將音檔存進 Firebase Storage。
- 將歌曲名稱、聲部名稱、音檔在 Storage 裡的 `storage_path` 等資訊存進 Firestore。
- 提供 API 給前端讀取目前歌曲與所有聲部資訊。
- 避免讓前端直接持有 Firebase Admin 權限。

音檔二進位資料必須存放在 Firebase Storage。Firestore 只保存歌曲資訊、聲部資訊與 `storage_path`，不要把音檔二進位內容直接存進資料庫。

## Firebase 資料規則

Firebase 是整套後端平台，不是單一資料庫。本專案使用其中兩個服務：

- Firestore：Firebase 裡的資料庫，用來保存歌曲名稱、聲部名稱與音檔位置。
- Firebase Storage：Firebase 裡的檔案儲存空間，用來保存 `mp3`、`wav` 等音檔。

本專案資料分工如下：

- 音檔：存放在 Firebase Storage。
- 歌曲資料、聲部名稱、音檔位置：存放在 Firestore。
- 前端資料來源：只呼叫 `server.js` 提供的 API。

Firestore 只保存管理用資料，不保存前端播放用網址，也不保存音檔本身。Firestore 另外使用 `info/site.current` 保存目前前端要顯示的歌曲 ID。

聲部資料至少包含：

```json
{
  "id": 1,
  "name": "soprano",
  "storage_path": "songs/{song_id}/soprano.mp3",
  "volume": 0.8,
  "order": 1
}
```

`id` 是每首歌曲內從 `1` 開始自動產生的穩定正整數，不因 `order` 改變而重新編號。新增聲部使用目前最大 `id + 1`，更新同名聲部則保留原本的 `id`。所有聲部都必須在上傳時寫入 `id`，讀取 API 不負責補資料。

`storage_path` 是後端在 Firebase Storage 裡找檔案的位置，例如：

```text
songs/{song_id}/soprano.mp3
```

不要在 Firestore 同時保存 `file_url` 和 `storage_path`。`file_url` 是前端可播放網址，容易和 Storage 裡的實際檔案位置不同步，所以本專案資料庫只保存 `storage_path`。

`GET /api/song` 會先讀取 `info/site.current`，用這個欄位的值找出目前歌曲：

```json
{
  "current": "{song_id}"
}
```

找到目前歌曲後，`server.js` 會讀取 `songs/{song_id}` 與 `songs/{song_id}/tracks/{track_key}`。`track_key` 沿用聲部名稱產生的 Firestore 文件名稱，數字 `id` 則保存在文件內容。回傳給前端時，再由 `server.js` 把 `storage_path` 轉成前端可播放的 `audio_url`：

```json
{
  "id": 1,
  "name": "soprano",
  "audio_url": "https://...",
  "volume": 0.8,
  "order": 1
}
```

Firestore 建議結構：

```text
info/site
  current: "{song_id}"

songs/{song_id}
  title

songs/{song_id}/tracks/{track_key}
  id
  name
  storage_path
  volume
  order
```

Firebase Storage 建議結構：

```text
songs/{song_id}/{track_key}.mp3
```

同一時間以前端顯示 `info/site.current` 指向的一首目前指定曲為主。Firestore 可以保留多首 `songs/{song_id}` 供管理介面切換，但不需要先做多年度、Realtime Database 或搜尋功能。

## API 建議

`server.js` 至少提供：

- `GET /api/song`：取得目前歌曲名稱與所有聲部資料。
- `GET /api/song?song_id={song_id}`：取得指定歌曲與所有聲部資料，不更新 `info/site.current`。
- `GET /api/songs`：取得所有歌曲的 ID 與名稱。
- `POST /api/song`：上傳或更新歌曲名稱與聲部音檔，不更新 `info/site.current`。
- `POST /api/song/current`：更新 `info/site.current`，切換目前前端顯示的歌曲。
- `POST /api/song/tracks`：以完整清單更新指定歌曲的聲部名稱與順序，並刪除未出現在清單中的聲部。

`POST /api/song/tracks` 使用完整的聲部資訊清單：

```json
{
  "song_id": "{song_id}",
  "tracks": [
    { "id": 3, "name": "alto", "order": 1 },
    { "id": 1, "name": "soprano", "order": 2 }
  ]
}
```

非空清單中的 `id` 必須已存在且不可重複，`name` 不可空白或重複，`order` 必須從 `1` 連續排列。後端更新仍存在的文件，刪除清單中缺少的文件，並清理其 `storage_path` 音檔。改名只更新 `name`，不改動穩定 `id`、Firestore 文件名稱或既有 Storage 路徑。

若 `tracks` 是空陣列，代表管理者確認刪除整首歌曲。後端必須刪除該歌曲文件、所有聲部文件與 Storage 音檔；若該歌曲正是置頂歌曲，依現有繁中歌曲名稱排序自動把第一首剩餘歌曲設為 `info/site.current`，沒有其他歌曲時才設為 `null`。

`POST /api/song` 可使用 `multipart/form-data`，欄位包含：

- `title`：歌曲名稱。
- `track_name`：聲部名稱。
- `audio`：音檔。

若一次上傳多個聲部，也可以使用陣列欄位，但實作要保持簡單清楚。

上傳歌曲、新增聲部與更新同名歌曲都只負責保存資料，不可改動 `info/site.current`。若目前尚未設定指定曲，必須由管理者使用 `POST /api/song/current` 手動設定。


## 音檔規範

- 所有聲部音檔必須從同一個剪輯專案匯出。
- 所有音檔必須從第 `0` 秒開始。
- 不可以裁掉前面的空白。
- 不同聲部的總長度應盡量一致。
- 建議使用 `mp3`，需要高音質時才使用 `wav`。
- 上傳前先用一般播放器檢查一次，上傳後再用網站測試一次。

## 開發原則

- 優先使用原生 HTML、CSS、JavaScript。
- 後端維持單一 `server.js`，除非程式明顯過長才拆檔。
- 不加入帳號系統、留言板、練習紀錄、AI 評分等非必要功能。
- 新功能必須不影響「未來幹部只透過管理者介面更新」的原則。
- Firebase 金鑰與敏感設定放在 `.env`，不要寫死在前端或提交到版本控制。
- 前端只能呼叫後端 API，不直接使用 Firebase Admin SDK。
- 前端只使用 API 回傳的 `audio_url` 播放音檔，不需要知道 Firebase Storage 的 `storage_path`。

## 測試清單

修改播放邏輯時，必須測試：

- 播放。
- 暫停。
- 拖曳進度條。
- 往前跳轉 `5` 秒。
- 往後跳轉 `5` 秒。
- 各聲部音量 bar。
- `Mute`。
- `Solo`：Solo 聲部為 `90%`，其他聲部為 `20%`。
- 多個聲部同時 Solo。
- Mute 與 Solo 同時存在時，Mute 優先。

修改管理者介面或後端時，必須測試：

- 可輸入歌曲名稱。
- 可輸入聲部名稱。
- 可上傳音檔。
- 上傳後 Firebase Storage 有保存音檔。
- 上傳後 Firestore 有保存歌曲資料、聲部的穩定數字 `id`、`storage_path`，且 `info/site.current` 維持不變。
- 前端重新整理後能讀取最新歌曲與聲部。
- 音檔能正常播放。
- 聲部順序可儲存，播放介面重新整理後仍照 `order` 顯示。
- 聲部改名後播放介面與再次上傳同名聲部都使用新名稱。
- 刪除聲部後 Firestore 文件與 Firebase Storage 音檔都移除。
- 切換置頂歌曲不會改變管理介面目前選擇的歌曲、聲部草稿或上傳表單。
- 切換管理歌曲不會改變播放介面或 `info/site.current`。
- 刪除所有聲部並確認後，歌曲文件、聲部文件與 Storage 音檔都移除；若為置頂歌曲，排序後第一首剩餘歌曲會自動接替，沒有其他歌曲時 `info/site.current` 才清空。
- 調整順序後聲部 `id` 維持不變；新聲部使用目前最大 `id + 1`。

修改畫面時，必須檢查：

- 手機版畫面。
- 電腦版畫面。
- 按鈕文字不重疊。
- 音量 bar 與播放條寬度正常。

## 發布前檢查

- 歌曲名稱正確。
- 所有聲部都有音檔。
- 聲部名稱顯示正確。
- Firestore 資料能被後端讀取。
- Firebase Storage 音檔能被後端轉成可播放的 `audio_url`。
- 所有音檔都能播放。
- 播放、暫停、快進、倒退、進度條正常。
- 音量、Mute、Solo 正常。
- 管理者介面可以成功上傳。
- 手機版與電腦版畫面正常。

## 待確認資訊

實作 Firebase 前，需向使用者確認：

- Firebase 專案 ID。
- Firebase Storage bucket 名稱。
- 後端要使用的 Firebase Admin service account 設定方式。
- 管理者介面是否需要簡單密碼保護；若未確認，先不加入登入系統。
