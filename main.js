const express = require("express");
const sqlite = require("sqlite3");
const axios = require("axios");
const Telegraf = require("telegraf");
const app = express();
const port = 8080;

const db = new sqlite.Database("./data.sqlite");

const TG_TOKEN = process.env.TG_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS "users" (ID integer primary key, name varchar(20), source text , token TEXT)`
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS "records" (ID integer primary key, user_id varchar(20), score text , date integer)`
  );
});

app.get("/register", (req, res) => {
  const { name, source, private_token } = req.query;
  db.get(
    `select id from users where token = '${private_token}'`,
    function (err, row) {
      if (err) {
        res.send({
          ok: false,
          message: "internal error",
        });
        return;
      }
      if (row) {
        db.run(
          `update users set source = '${source}', name = '${name}' where token = '${private_token}'`
        );
        console.log(`${name} updated source url`);
        res.send({
          ok: true,
          message: `Hi ${name}! thanks for updating your source url`,
        });
      } else {
        db.run(
          `insert into users (name, source, token) values ('${name}', '${source}', '${private_token}')`
        );
        console.log(`${name} registered source url`);
        res.send({
          ok: true,
          message: `Hi ${name}! thanks for registering your source url`,
        });
      }
    }
  );
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
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
        // const date = record.range.date;
        return { score, date: date.getTime() };
      });
  } catch (error) {
    console.log(error);
  }
}

function updateRecords() {
  db.each(`select * from users`, async function (err, user) {
    if (err) {
      console.log("error in quering users");
      return;
    }
    const records = await fetchSourceRecords(user.source);
    records.forEach((stat) => {
      db.get(
        `select * from records where date = '${stat.date}' and user_id = '${user.ID}'`,
        function (err, record) {
          if (err) {
            console.log("error in quering records");
            return;
          }
          if (!record) {
            db.run(
              `insert into records (user_id, score, date) values ('${user.ID}', ${stat.score}, '${stat.date}')`
            );
            console.log(`inserted new record for ${user.name} (${stat.date})`);
          }
        }
      );
    });
  });
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
  const offsetDate = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  db.all(
    `select user_id, name, sum(score) as score from records INNER JOIN users on users.ID = records.user_id where date > ${offsetDate} group by user_id`,
    async function (err, rows) {
      if (err) {
        console.log("error in quering records");
        return;
      }
      const text = rows
        .map((row) => `${row.name} got ${row.score} points`)
        .join("\n");

      let winner = rows[0];
      for (let i = 1; i < rows.length; i++) {
        if (winner.score < rows[i].score) winner = rows[i];
      }

      await sendMessage(
        `it's time for weekly reports!\n${text}\nwinner: ${winner.name}`,
        true
      );
    }
  );
}

async function sendDailyScores() {
  const offsetDate = Math.floor(Date.now() / 1000) - 24 * 3600;
  db.all(
    `select user_id, name, sum(score) as score from records INNER JOIN users on users.ID = records.user_id where date > ${offsetDate} group by user_id`,
    async function (err, rows) {
      if (err) {
        console.log("error in quering records");
        return;
      }
      const text = rows
        .map((row) => `${row.name} got ${row.score} points`)
        .join("\n");
      await sendMessage("what happened yesterday?\n" + text);
    }
  );
}

// every 6 hours
setInterval(() => {
  updateRecords();
}, 10000);
// every 24 hours
setInterval(async () => {
  sendDailyScores();
}, 20000);
// every 7 days
setInterval(() => {
  setTimeout(() => {
    sendWeeklyScores();
  }, 5000);
}, 30000);
