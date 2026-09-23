# 多聲部同步播放更新說明

## 目標

將多個獨立的 `Audio` 播放器改成共用一個 `AudioContext`，讓所有聲部從同一時間開始播放，改善 iOS 上的音檔不同步。

## 修改範圍

- 修改 `app.js` 的播放邏輯。
- 在 `server.js` 新增唯讀的 `/api/audio`，讓前端以同源網址下載 Firebase 音檔。
- 不修改畫面、Firebase 資料或管理者功能。
- 不新增套件與測試檔。
- 音量、Mute、Solo、前後跳轉與進度條操作維持不變。

## 更新方式

### 1. 載入音檔

- 全站只建立一個 `AudioContext`。
- `GET /api/song` 回傳同源的 `/api/audio` 網址，避免 Firebase Storage 的 CORS 限制。
- 使用 `fetch(track.audioUrl)` 下載每個聲部。
- 使用同一個 `AudioContext.decodeAudioData()` 解碼。
- 將解碼結果依聲部名稱存入 `Map`。
- 全部完成後才啟用播放按鈕；任一音檔失敗就顯示載入失敗。

### 2. 播放

- 每次播放都為各聲部建立新的 `AudioBufferSourceNode` 與 `GainNode`。
- 所有聲部使用同一個開始時間：

```js
const startAt = audioContext.currentTime + 0.1;
source.start(startAt, position);
```

- iOS 必須在播放按鈕的點擊事件中執行：

```js
await audioContext.resume();
```

### 3. 暫停與跳轉

- `AudioBufferSourceNode` 不能暫停後續播，暫停時直接停止目前所有 source。
- 記住目前秒數 `position`。
- 再次播放或跳轉時，重新建立所有 source，並從 `position` 同步開始。
- 往前、往後與拖曳進度條都更新同一個 `position`。

### 4. 進度與結束

- 播放時間改由 `audioContext.currentTime` 計算，不再讀取第一個音檔的 `currentTime`。
- 歌曲長度使用所有 buffer 中最長的長度。
- 到達歌曲結尾時停止所有 source，將 `position` 設回 `0`。

### 5. 音量、Mute、Solo

- 每個聲部使用自己的 `GainNode` 控制音量。
- Mute 時 gain 為 `0`。
- 其他狀況沿用目前 `track.volume` 的數值。
- 保留現有 Solo 行為，不另外改寫功能規則。

## 瀏覽器驗收

完成後直接在瀏覽器測試，不建立測試檔：

1. 四個聲部能同時開始播放。
2. 暫停後可從原位置繼續。
3. 拖曳進度條、前進 `5` 秒、後退 `5` 秒後仍同步。
4. 各聲部音量、Mute、Solo 正常。
5. 播放到結尾會停止並回到 `0` 秒。
6. 使用電腦瀏覽器與實際 iPhone 各測試一次。

## 完成條件

所有聲部由同一個 `AudioContext` 排程播放，並能透過 `/api/audio` 載入音檔；原有介面與管理功能不受影響。
