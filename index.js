require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const fs = require("fs");

const TOKEN     = process.env.DISCORD_TOKEN?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const DATA_FILE = "./data.json";

const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

const WEAO_API     = "https://weao.xyz/api/status/exploits";
const WEAO_HEADERS = { "User-Agent": "WEAO-3PService" };

const TRACKED = {
  windows: ["Potassium","Wave","Seliware","Volt","SirHurt","Synapse Z","Cosmic","Velocity","Xeno","Solara","Madium"],
  mac:     ["MacSploit","Opiumware"],
};

// ─────────────────────────────────────────
//  슬래시 커맨드 등록
// ─────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("set-channel")
    .setDescription("익스플로잇 상태를 올릴 텍스트 채널을 설정합니다 (관리자 전용)")
    .addChannelOption(opt =>
      opt.setName("채널")
        .setDescription("텍스트 채널 선택")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("update")
    .setDescription("익스플로잇 상태를 즉시 갱신합니다 (관리자 전용)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ 슬래시 커맨드 등록 완료");
}

// ─────────────────────────────────────────
//  데이터 저장/불러오기
// ─────────────────────────────────────────
function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      text: raw.text ?? { channelId: null, messageId: null },
    };
  } catch {
    return {
      text: { channelId: null, messageId: null },
    };
  }
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

let data = loadData();

// ─────────────────────────────────────────
//  WEAO API 호출
// ─────────────────────────────────────────
async function fetchExploits() {
  const res = await fetch(WEAO_API, { headers: WEAO_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ─────────────────────────────────────────
//  Embed 빌드
// ─────────────────────────────────────────
function statusEmoji(e) {
  if (!e)              return "⚫";
  if (!e.updateStatus) return "🔴";
  if (e.detected)      return "🟡";
  return "🟢";
}

function statusText(e) {
  if (!e)              return "정보 없음";
  if (!e.updateStatus) return "다운";
  if (e.detected)      return "감지됨 (주의)";
  return "정상";
}

function exploitLine(e, name) {
  const emoji  = statusEmoji(e);
  const status = statusText(e);
  const ver    = e?.version ? ` \`${e.version}\`` : "";
  const cost   = e ? (e.free ? " · 무료" : e.cost ? ` · ${e.cost}` : " · 유료") : "";
  const link   = e?.websitelink ? ` · [사이트](${e.websitelink})` : "";
  return `${emoji} **${name}**${ver} — ${status}${cost}${link}`;
}

function buildEmbed(allData) {
  const map = {};
  for (const item of allData) map[item.title.toLowerCase()] = item;

  const timeStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const embed = new EmbedBuilder()
    .setTitle("📋 Roblox Exploit 상태판")
    .setColor(0x5865f2)
    .setFooter({ text: `WEAO API 기준 · 갱신: ${timeStr}` })
    .setTimestamp();

  const winLines = TRACKED.windows.map(n => exploitLine(map[n.toLowerCase()], n));
  const macLines = TRACKED.mac.map(n => exploitLine(map[n.toLowerCase()], n));

  embed.addFields(
    { name: "🖥️ Windows", value: winLines.join("\n") },
    { name: "🍎 Mac",     value: macLines.join("\n") },
    { name: "범례",        value: "🟢 정상　🟡 감지됨　🔴 다운　⚫ 정보없음", inline: false },
  );

  return embed;
}

// ─────────────────────────────────────────
//  텍스트 채널 갱신
// ─────────────────────────────────────────
async function updateTextChannel(embed) {
  if (!data.text?.channelId) return;

  const channel = await client.channels.fetch(data.text.channelId).catch(() => null);
  if (!channel) return;

  if (data.text.messageId) {
    try {
      const msg = await channel.messages.fetch(data.text.messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      console.warn("기존 메시지 수정 실패 → 새 메시지 전송");
    }
  }

  const sent = await channel.send({ embeds: [embed] });
  data.text.messageId = sent.id;
  saveData(data);
  console.log(`새 메시지 전송 | msg: ${sent.id}`);
}

// ─────────────────────────────────────────
//  통합 갱신
// ─────────────────────────────────────────
async function postOrUpdate() {
  let allData;
  try {
    allData = await fetchExploits();
  } catch (err) {
    return console.error("WEAO API 오류:", err.message);
  }

  const embed = buildEmbed(allData);
  await updateTextChannel(embed);
  console.log(`[${new Date().toLocaleTimeString("ko-KR")}] 갱신 완료`);
}

// ─────────────────────────────────────────
//  슬래시 커맨드 핸들러
// ─────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ 관리자만 사용할 수 있습니다.", ephemeral: true });
  }

  const { commandName } = interaction;

  if (commandName === "set-channel") {
    const channel = interaction.options.getChannel("채널");
    data.text = { channelId: channel.id, messageId: null };
    saveData(data);
    await interaction.reply({ content: `✅ 채널이 <#${channel.id}>로 설정됐습니다.`, ephemeral: true });
    await postOrUpdate();
    return;
  }

  if (commandName === "update") {
    await interaction.deferReply({ ephemeral: true });
    await postOrUpdate();
    await interaction.editReply("✅ 즉시 갱신 완료!");
    return;
  }
});

// ─────────────────────────────────────────
//  봇 시작
// ─────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ 로그인: ${client.user.tag}`);
  await registerCommands();
  await postOrUpdate();
  setInterval(postOrUpdate, UPDATE_INTERVAL_MS);
});

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err.message);
});

client.login(TOKEN);
