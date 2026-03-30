import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// デスクトップを公開
app.use(express.static(path.join(__dirname, "..")));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});