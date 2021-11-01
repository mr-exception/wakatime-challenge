const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const app = express();
const port = 8080;

const TG_TOKEN = process.env.TG_TOKEN;
console.log(`telegram token: ${TG_TOKEN}`);
const CHAT_ID = process.env.CHAT_ID;
console.log(`target chat id: ${CHAT_ID}`);

let data = [];

function getUser(token) {
  return data.find((record) => record.token === token);
}
function createUser(name, token, link) {
  const user = getUser(token);
  if (user) {
    user.name = name;
    user.link = link;
    return false;
  } else {
    data.push({ name, token, link, records: [] });
    return true;
  }
}
function addRecords(token, records) {
  data = data.map((user) => {
    if (user.token !== token) return user;
    records.forEach((record) => {
      if (!user.records.find((r) => r.date === record.date)) {
        console.log(
          `[new] ${user.name}, score: ${record.score}, date: ${record.date}`
        );
        user.records.push(record);
      }
    });
    user.records = user.records.filter(
      (r) => r.date > Date.now() - 24 * 7 * 3600 * 1000
    );
    return user;
  });
}
function getYesterdayRecord(token) {
  const user = data.find((r) => r.token === token);
  if (!user) return undefined;
  return user.records.find((r) => r.date > Date.now() - 24 * 3600 * 1000);
}

function getWeekScore(token) {
  const user = data.find((r) => r.token === token);
  let result = 0;
  user.records.forEach((r) => {
    result += r.score;
  });
  return result;
}

app.get("/", (req, res) => {
  res.send({
    ok: true,
    name: "wakatime challenge bot",
    time: new Date(),
  });
});

app.get("/register", (req, res) => {
  const { name, source, private_token } = req.query;
  const result = createUser(name, private_token, source);
  if (!result) {
    console.log(`updated ${name} link`);
    res.send({
      ok: true,
      message: `Hi ${name}! thanks for updating your source url`,
    });
  } else {
    console.log(`registered ${name} link`);
    res.send({
      ok: true,
      message: `Hi ${name}! thanks for registering your source url`,
    });
  }
});

app.listen(port, () => {
  console.log(`listening at port ${port}`);
});

// record fetch
async function fetchSourceRecords(source) {
  try {
    const result = (await axios.get(source)).data.data;
    return result
      .filter((record) => record.range.text !== "Today")
      .map((record) => {
        const date = new Date(record.range.end);
        const score =
          record.grand_total.hours * 60 + record.grand_total.minutes;
        return { score, date: date.getTime() };
      });
  } catch (error) {
    console.log(error);
  }
}

async function updateRecords() {
  try {
    for (let i = 0; i < data.length; i++) {
      const user = data[i];
      const records = await fetchSourceRecords(user.link);
      addRecords(user.token, records);
    }
  } catch (error) {
    console.log(error);
  }
}

async function sendMessage(text, pin = false) {
  const result = (
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      text,
      chat_id: CHAT_ID,
    })
  ).data;
  if (pin) {
    const message_id = result.result.message_id;
    await axios
      .post(`https://api.telegram.org/bot${TG_TOKEN}/pinChatMessage`, {
        message_id,
        chat_id: CHAT_ID,
        disable_notification: true,
      })
      .catch((error) => {
        console.log(error);
      });
  }
}

async function sendWeeklyScores() {
  try {
    let winner = undefined;
    const text = data
      .map((user) => {
        const score = getWeekScore(user.token);
        if (!score) return undefined;
        if (!winner || winner.score < score) {
          winner = { name: user.name, score };
        }
        return `${user.name}: ${score}`;
      })
      .filter((r) => !!r)
      .join("\n");
    await sendMessage(
      `it's time for weekly reports!\n${text}\nwinner: ${winner.name}`
    );
  } catch (error) {
    console.log(error);
  }
}

async function sendDailyScores() {
  try {
    const text = data
      .map((user) => {
        const record = getYesterdayRecord(user.token);
        if (!record) return undefined;
        return `${user.name}: ${record.score}`;
      })
      .filter((r) => !!r)
      .join("\n");
    await sendMessage("what happened yesterday?\n" + text);
  } catch (error) {
    console.log(error);
  }
}

// setTimeout(async () => {
//   console.log("updating records");
//   await updateRecords();
//   console.log("updated records");
//   console.log("sending daily reports");
//   await sendDailyScores();
//   console.log("sent daily reports");
//   console.log("sending weekly reports");
//   await sendWeeklyScores();
//   console.log("sent weekly reports");
// }, 10000);
// hourly update
cron.schedule("0 * * * *", async () => {
  try {
    console.log("updating records");
    await updateRecords();
    console.log("updated records");
  } catch (error) {
    console.log(error);
  }
});
// daily report
cron.schedule("30 0 * * *", async () => {
  try {
    console.log("sending daily reports");
    await sendDailyScores();
    console.log("sent daily reports");
  } catch (error) {
    console.log(error);
  }
});
// weekly reports
cron.schedule("0 2 * * 5", async () => {
  try {
    console.log("sending weekly reports");
    await sendWeeklyScores();
    console.log("sent weekly reports");
  } catch (error) {
    console.log(error);
  }
});
