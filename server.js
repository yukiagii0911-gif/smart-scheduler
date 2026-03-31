import express from "express";
import cors from "cors";
import OpenAI, { toFile } from "openai";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// デスクトップを公開
app.use(express.static(path.join(__dirname, "..")));

// 音声はメモリで受ける
const upload = multer({ storage: multer.memoryStorage() });

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function extractJson(text) {
  if (!text) return null;

  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw e;
  }
}

function normalizeParsedData(parsed) {
  const safe = parsed || {};

  if (!Array.isArray(safe.tasks)) {
    safe.tasks = [];
  }

  safe.tasks = safe.tasks.map((task) => ({
    task: task?.task || "",
    duration: Number.isFinite(Number(task?.duration)) ? Number(task.duration) : 0,
    place: task?.place || "",
    taskMemo: task?.taskMemo || "",
    isFixed: Boolean(task?.isFixed),
    fixedStart: task?.fixedStart || ""
  }));

  safe.dailyGoal = safe.dailyGoal || "";
  safe.globalMemo = safe.globalMemo || "";
  safe.longTermGoal = safe.longTermGoal || "";
  safe.routineText = safe.routineText || "";
  safe.wakeTime = safe.wakeTime || "";
  safe.sleepTime = safe.sleepTime || "";

  return safe;
}

async function parseTranscriptToScheduleJson(transcript, selectedDate = "") {
  const prompt = `
あなたは音声メモをスケジュール入力フォーム用のJSONに整理するAIです。
ユーザーが話した内容を読み取り、以下のJSONだけを返してください。
説明文、補足、コードブロックは禁止です。

前提:
- 現在ユーザーが選択している日付は ${selectedDate || "不明"} です
- 「明日」「来週水曜」など相対表現は、可能なら選択日付を基準に解釈する
- 日付が明確に別日なら taskMemo にその日付情報を短く残す
- 複数の予定がある場合は tasks に複数入れる
- 「何月何日の何時からどこどこで何をする」があれば fixed task とみなす
- fixedStart は開始時刻だけ入れる
- 終了時刻しか分からない場合は taskMemo に入れる
- duration は分かるときだけ分単位整数、分からなければ 0

出力形式:
{
  "dailyGoal": "文字列",
  "globalMemo": "文字列",
  "longTermGoal": "文字列",
  "routineText": "文字列",
  "wakeTime": "HH:MM または 空文字",
  "sleepTime": "HH:MM または 空文字",
  "tasks": [
    {
      "task": "文字列",
      "duration": 数値または0,
      "place": "文字列",
      "taskMemo": "文字列",
      "isFixed": true または false,
      "fixedStart": "HH:MM または 空文字"
    }
  ]
}

ルール:
- 情報がなければ空文字にする
- tasks がなければ空配列
- 「3時」「15時」「午後3時」などは24時間表記のHH:MMにする
- 「朝7時半」は07:30
- 毎日の習慣なら routineText に寄せる
- 今日やるべきことなら tasks や dailyGoal に寄せる
- 状態や注意事項は globalMemo に寄せる
- 長期的な話は longTermGoal に寄せる
- 同じ内容を複数欄に重複させすぎない
- 必ずJSONだけを返す

ユーザー音声:
${transcript}
`;

  const response = await client.responses.create({
    model: "gpt-5.4",
    input: prompt
  });

  const parsed = extractJson(response.output_text);
  return normalizeParsedData(parsed);
}

app.post("/ai", async (req, res) => {
  const {
    wakeTime,
    sleepTime,
    dailyGoal,
    globalMemo,
    longTermGoal,
    routineText,
    tasks
  } = req.body;

  try {
    const prompt = `
あなたは時間付きスケジュールだけを返すAIです。

絶対ルール
・説明は禁止
・見出しは禁止
・理由は禁止
・絵文字は禁止
・各行は必ず「HH:MM | 内容」の形式
・左は開始時間、右はその時間にやること
・起きる時間より前は書かない
・寝る時間より後は書かない
・固定時間の予定は必ず守る
・ルーティンがある場合は自然に入れる
・内容は短くわかりやすく
・場所が必要なら短く入れる

思考ルール
・長期目標から逆算して今日やるべき行動を決める
・今日の目標は最優先で反映する
・メモから「集中できる時間帯・外出可否・疲れ」などを読み取る
・同じタスクでも中身を具体化する
・時間帯によってやる内容を変える
・重要なものは前半に配置
・軽いものは後半に配置
・固定時間は必ず守る
・ルーティンは自然に入れる
・タスクが足りない場合は目標ベースで補完する

出力例
07:30 | 朝食
09:00 | 英語勉強（家）
11:00 | 契約確認（固定）
12:30 | 昼食
15:00 | 散歩

起きる時間:
${wakeTime || ""}

寝る時間:
${sleepTime || ""}

今日の目標:
${dailyGoal || ""}

今日のメモ:
${globalMemo || ""}

長期目標:
${longTermGoal || ""}

毎日のルーティン:
${routineText || ""}

今日のタスク:
${JSON.stringify(tasks || [], null, 2)}
`;

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: prompt
    });

    res.json({ result: response.output_text });
  } catch (e) {
    console.error("OpenAI error:", e);
    res.status(500).json({ error: e.message || "server error" });
  }
});

app.post("/ai-parse", async (req, res) => {
  const { transcript, selectedDate } = req.body;

  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "transcript is required" });
  }

  try {
    const parsed = await parseTranscriptToScheduleJson(transcript, selectedDate || "");
    res.json({ parsed });
  } catch (e) {
    console.error("OpenAI parse error:", e);
    res.status(500).json({ error: e.message || "parse error" });
  }
});

app.post("/voice", upload.single("audio"), async (req, res) => {
  const selectedDate = req.body?.selectedDate || "";

  if (!req.file) {
    return res.status(400).json({ error: "audio file is required" });
  }

  try {
    const originalName = req.file.originalname || "recording.webm";
    const mimeType = req.file.mimetype || "audio/webm";

    const fileForOpenAI = await toFile(req.file.buffer, originalName, {
      type: mimeType
    });

    const transcription = await client.audio.transcriptions.create({
      file: fileForOpenAI,
      model: "gpt-4o-transcribe"
    });

    const transcript = transcription.text || "";
    const parsed = await parseTranscriptToScheduleJson(transcript, selectedDate);

    res.json({
      transcript,
      parsed
    });
  } catch (e) {
    console.error("Voice transcription error:", e);
    res.status(500).json({ error: e.message || "voice error" });
  }
});

const PORT = 3000;

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
